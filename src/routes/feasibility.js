// routes/feasibility.js — project feasibility studies kept as versions 1, 2, 3 ... Old versions are never overwritten or deleted.
// Cost and revenue forecasts are sensitive: Owner and PM add versions, Accounts and the CA (viewer) can read, nobody else sees them.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const rupees = (p) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');

// Weekly (Monday after 9 am IST): a project whose latest feasibility version is older than the review interval gets a reminder to Owner and PM.
export async function feasibilitySweep(env, getSetting) {
  const ist = new Date(Date.now() + 19800000);
  if (ist.getUTCDay() !== 1 || ist.getUTCHours() < 9) return;
  const days = Math.max(7, Math.round(Number(await getSetting(env, 'fea.review_days')) || 90));
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'Feasibility review due: ' || p.name, 'The latest version (v' || x.v || ') is from ' || substr(x.last_at, 1, 10) || '. Add an updated version when the numbers have been reviewed.', 'feasibility', datetime('now')
    FROM (SELECT project_id, MAX(version) AS v, MAX(created_at) AS last_at FROM fea_versions GROUP BY project_id) x
    JOIN projects p ON p.id = x.project_id AND p.deleted_at IS NULL AND COALESCE(p.status, '') != 'archived'
    JOIN users u ON u.role IN ('owner', 'pm') AND u.active = 1 AND u.deleted_at IS NULL
    WHERE x.last_at < datetime('now', '-' || ?1 || ' days')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Feasibility review due: ' || p.name AND n.created_at > datetime('now', '-7 days'))`).bind(days).run();
}

export function registerFeasibility(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'fea_versions', id || 0, String(summary).slice(0, 300), nowStr());
  const projectOk = async (env, req, pid) => pid > 0 && (await visibleProjectIds(env, req.user)).includes(pid);

  router.get('/api/feasibility', async (req, env) => withAuth(req, env, 'feasibility', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const rows = (await env.DB.prepare(`SELECT v.*, u.name AS by_name, d.title AS file_title, d.mime AS file_mime, d.size_bytes AS file_size FROM fea_versions v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN documents d ON d.id = v.document_id AND d.deleted_at IS NULL
        WHERE v.project_id = ? ORDER BY v.version DESC`).bind(pid).all()).results;
      for (const r of rows) { r.is_latest = r.version === rows[0].version; r.margin_paise = r.est_cost_paise != null && r.est_revenue_paise != null ? r.est_revenue_paise - r.est_cost_paise : null; r.margin_pct = r.margin_paise != null && r.est_revenue_paise > 0 ? Math.round((r.margin_paise * 1000) / r.est_revenue_paise) / 10 : null; }
      return json({ ok: true, data: { versions: rows } });
    } catch (e) { return serverError(e, 'fea-list'); }
  }));

  // A new version is always the next number, chosen inside the insert itself so two people saving at once cannot collide.
  router.post('/api/feasibility', async (req, env) => withAuth(req, env, 'feasibility', 'C', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or the PM can add a feasibility version.' }, 403);
      const b = await req.json(); const pid = Number(b.project_id);
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const title = String(b.title || '').trim().slice(0, 120);
      if (!title && !b.document_id) return json({ ok: false, error: 'Give this version a title or attach the study.' }, 400);
      const date = b.study_date && /^\d{4}-\d{2}-\d{2}$/.test(b.study_date) ? b.study_date : new Date(Date.now() + 19800000).toISOString().substring(0, 10);
      const cost = b.est_cost_paise !== undefined && b.est_cost_paise !== '' && b.est_cost_paise !== null ? Math.round(num(b.est_cost_paise)) : null;
      const rev = b.est_revenue_paise !== undefined && b.est_revenue_paise !== '' && b.est_revenue_paise !== null ? Math.round(num(b.est_revenue_paise)) : null;
      const area = b.saleable_sqft ? num(b.saleable_sqft) : null; const months = b.completion_months ? Math.round(num(b.completion_months)) : null;
      if ([cost, rev, area, months].some((x) => x !== null && (x === undefined || x < 0))) return json({ ok: false, error: 'Figures cannot be negative.' }, 400);
      let docId = null;
      if (b.document_id) {
        const d = await env.DB.prepare("SELECT id FROM documents WHERE id = ? AND category = 'feasibility' AND project_id = ? AND deleted_at IS NULL").bind(Number(b.document_id), pid).first();
        if (!d) return json({ ok: false, error: 'The attached file was not found for this project.' }, 400);
        docId = d.id;
      }
      const r = await env.DB.prepare(`INSERT INTO fea_versions (project_id, version, title, notes, study_date, est_cost_paise, est_revenue_paise, saleable_sqft, completion_months, document_id, created_by, created_at)
        SELECT ?1, COALESCE(MAX(version), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 FROM fea_versions WHERE project_id = ?1`)
        .bind(pid, title, String(b.notes || '').slice(0, 1000), date, cost, rev, area, months, docId, req.user.user_id, nowStr()).run();
      const v = await env.DB.prepare('SELECT version FROM fea_versions WHERE id = ?').bind(r.meta.last_row_id).first();
      await audit(env, req.user, 'create', r.meta.last_row_id, `Feasibility version ${v.version} added${cost != null ? ', cost ' + rupees(cost) : ''}${rev != null ? ', revenue ' + rupees(rev) : ''}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id, version: v.version } });
    } catch (e) { return serverError(e, 'fea-create'); }
  }));
}
