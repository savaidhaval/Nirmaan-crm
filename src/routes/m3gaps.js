// routes/m3gaps.js — Module 3 gaps, step 1: CC-floor check for work orders and daily reports, work-order cap against the BOQ,
// BOQ allowance on indent lines, the gate-receipt rules, and the weekly wastage alert. Limits come from Settings; confirm with your PM / QS.
import { approvalState } from '../core/gates.js';

// Soft CC-floor check: only when a CC floor is on record for the wing. (No CC recorded = no lock, as for sales.)
export async function ccOverFloor(env, projectId, wing, floors, stateCache) {
  const list = [...new Set(floors.filter((f) => f != null))];
  if (!list.length) return null;
  const st = stateCache || await approvalState(env, projectId);
  const upto = st.ccUpto(wing || null);
  if (upto == null) return null;
  const over = list.filter((f) => f > upto);
  return over.length ? `The approved CC covers work up to floor ${upto}; this is for floor ${Math.max(...over)}.` : null;
}

// Work-order lines tied to BOQ items: quantity may not exceed what the BOQ still has free (after other live work orders), nor the rate the BOQ rate.
// Returns a plain message or null. Pass the lines being drafted ({boq, qty, rate}) and the work order being replaced (none for a new one).
export async function boqCapProblem(env, projectId, items, exceptWoId = 0) {
  const ids = [...new Set(items.filter((i) => i.boq).map((i) => i.boq))];
  if (!ids.length) return null;
  const j = JSON.stringify(ids);
  const [boq, used] = await env.DB.batch([
    env.DB.prepare('SELECT id, code, description, qty, rate_paise, unit FROM bud_items WHERE project_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(projectId, j),
    env.DB.prepare(`SELECT i.boq_item_id AS b, SUM(i.qty) AS q FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id
      WHERE w.project_id = ? AND w.id != ? AND w.status NOT IN ('rejected', 'cancelled', 'closed') AND i.boq_item_id IN (SELECT value FROM json_each(?)) GROUP BY i.boq_item_id`).bind(projectId, exceptWoId, j),
  ]);
  const usedBy = Object.fromEntries(used.results.map((u) => [u.b, u.q]));
  const mine = {};
  for (const i of items) if (i.boq) mine[i.boq] = (mine[i.boq] || 0) + i.qty;
  for (const b of boq.results) {
    const free = b.qty - (usedBy[b.id] || 0);
    if (mine[b.id] > free + 1e-9) return `${b.description}${b.code ? ' (' + b.code + ')' : ''}: the BOQ has ${+free.toFixed(3)} ${b.unit || ''} still free (BOQ ${b.qty}, other work orders ${+(usedBy[b.id] || 0).toFixed(3)}), but this order asks for ${+mine[b.id].toFixed(3)}.`;
    const dear = items.find((i) => i.boq === b.id && i.rate > b.rate_paise);
    if (dear) return `${b.description}${b.code ? ' (' + b.code + ')' : ''}: the rate is more than the BOQ rate (BOQ rate ${b.rate_paise / 100}, this order ${dear.rate / 100}).`;
  }
  return null;
}

// Indent lines against the BOQ: mark a line "over BOQ" when the quantity already asked for (not rejected) plus this one passes the BOQ quantity.
export async function indentBoqFlags(env, projectId, items) {
  const ids = [...new Set(items.map((i) => i.boq).filter(Boolean))];
  if (!ids.length) return { flags: new Map(), names: {} };
  const j = JSON.stringify(ids);
  const [boq, asked] = await env.DB.batch([
    env.DB.prepare('SELECT id, description, qty, unit FROM bud_items WHERE project_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(projectId, j),
    env.DB.prepare(`SELECT ii.boq_item_id AS b, SUM(ii.qty) AS q FROM pro_indent_items ii JOIN pro_indents x ON x.id = ii.indent_id
      WHERE x.project_id = ? AND x.deleted_at IS NULL AND x.status != 'rejected' AND ii.boq_item_id IN (SELECT value FROM json_each(?)) GROUP BY ii.boq_item_id`).bind(projectId, j),
  ]);
  const by = Object.fromEntries(boq.results.map((b) => [b.id, b])); const before = Object.fromEntries(asked.results.map((a) => [a.b, a.q]));
  const running = { ...before }; const flags = new Map(); const names = {};
  items.forEach((it, idx) => {
    const b = by[it.boq]; if (!b) return;
    running[b.id] = (running[b.id] || 0) + it.qty;
    if (running[b.id] > b.qty + 1e-9) { flags.set(idx, true); names[idx] = `${b.description}: ${+running[b.id].toFixed(3)} asked in all, BOQ ${b.qty} ${b.unit || ''}`; }
  });
  return { flags, names };
}

// Monday 10:00-10:59 India time (called from the hourly sweep): material issued to work orders beyond what the measured work needed plus the allowed wastage.
// Three statements however many materials there are.
export async function wastageSweep(env, getSetting, nowStr) {
  const ist = new Date(Date.now() + 19800000);
  if (!env.WASTAGE_TEST && (ist.getUTCDay() !== 1 || ist.getUTCHours() !== 10)) return 0;   // WASTAGE_TEST exists only in test builds (.dev.vars / CI)
  const raw = Number(await getSetting(env, 'stk.wastage_alert_bp')); const tol = Number.isFinite(raw) && raw >= 0 && (await getSetting(env, 'stk.wastage_alert_bp')) !== null ? raw : 250;
  const [theo, issued] = await env.DB.batch([
    env.DB.prepare(`SELECT w.project_id AS p, i.stock_item_id AS s, SUM(COALESCE(m.q, 0) * i.consumption_per_unit) AS t FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id
      LEFT JOIN (SELECT wo_item_id, SUM(qty) AS q FROM con_measurements WHERE status = 'approved' GROUP BY wo_item_id) m ON m.wo_item_id = i.id
      WHERE w.status IN ('approved', 'closed') AND i.stock_item_id IS NOT NULL AND i.consumption_per_unit > 0 GROUP BY w.project_id, i.stock_item_id`),
    env.DB.prepare(`SELECT project_id AS p, item_id AS s, SUM(CASE kind WHEN 'issue' THEN qty WHEN 'receipt' THEN -qty ELSE 0 END) AS q FROM stk_moves WHERE wo_id IS NOT NULL AND status = 'posted' GROUP BY project_id, item_id`),
  ]);
  const iss = Object.fromEntries(issued.results.map((r) => [r.p + ':' + r.s, r.q]));
  const week = `${ist.getUTCFullYear()}-${String(Math.ceil((((ist - Date.UTC(ist.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
  const alerts = theo.results.filter((r) => r.t > 0 && (iss[r.p + ':' + r.s] || 0) > r.t * (10000 + tol) / 10000 + 1e-9)
    .map((r) => ({ p: r.p, s: r.s, t: Math.round(r.t * 1000) / 1000, q: Math.round((iss[r.p + ':' + r.s] || 0) * 1000) / 1000, k: `wastage:${r.p}:${r.s}:${week}` })).slice(0, 50);
  if (!alerts.length) return 0;
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'Material wastage above ' || (?3 / 100.0) || '%: ' || COALESCE((SELECT name FROM stk_items WHERE id = json_extract(a.value, '$.s')), 'item'),
      'Issued ' || json_extract(a.value, '$.q') || ' against ' || json_extract(a.value, '$.t') || ' needed for the measured work. Check the store and the work orders.', json_extract(a.value, '$.k'), ?2
    FROM json_each(?1) a JOIN users u ON u.active = 1 AND u.deleted_at IS NULL AND u.role IN ('owner', 'pm')
    WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.link = json_extract(a.value, '$.k'))`).bind(JSON.stringify(alerts), nowStr(), tol).run();
  return alerts.length;
}

// ---------- Slab sign-offs ----------
// A milestone that triggers buyer demands (it has a payment-stage key) can be certified only when the Site Engineer's sign-off photo is on file
// AND the RCC consultant's inspection report is on file and confirmed by the Owner. Switch: site.dual_signoff (on unless set to Off).
export async function signoffBlock(env, getSetting, ms) {
  if (!ms.milestone_key || (await getSetting(env, 'site.dual_signoff')) === 'off') return null;
  const rows = (await env.DB.prepare('SELECT kind, confirmed_at FROM site_ms_signoffs WHERE milestone_id = ? AND superseded = 0').bind(ms.id).all()).results;
  const eng = rows.some((r) => r.kind === 'site_engineer');
  const rcc = rows.find((r) => r.kind === 'rcc_consultant');
  if (!eng && !rcc) return 'This stage releases buyer demand letters, so it needs two sign-offs first: the Site Engineer\'s photo, and the RCC consultant\'s inspection report confirmed by the Owner. Neither is on file yet.';
  if (!eng) return 'The Site Engineer\'s sign-off photo is not on file yet.';
  if (!rcc) return 'The RCC consultant\'s inspection report is not on file yet.';
  if (!rcc.confirmed_at) return 'The RCC consultant\'s report is on file but the Owner has not confirmed it yet.';
  return null;
}

export function registerM3Gaps(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const KINDS = ['site_engineer', 'rcc_consultant'];

  const msOf = async (env, req) => {
    const ms = await env.DB.prepare('SELECT id, project_id, name, wing, milestone_key, status FROM site_milestones WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!ms || !(await visibleProjectIds(env, req.user)).includes(ms.project_id)) return { err: bad('Milestone not found.', 404) };
    return { ms };
  };

  router.get('/api/site/milestones/:id/signoffs', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const { ms, err } = await msOf(env, req); if (err) return err;
      const rows = (await env.DB.prepare('SELECT s.id, s.kind, s.document_id, s.note, s.uploaded_at, s.confirmed_at, u.name AS uploaded_by_name, c.name AS confirmed_by_name FROM site_ms_signoffs s LEFT JOIN users u ON u.id = s.uploaded_by LEFT JOIN users c ON c.id = s.confirmed_by WHERE s.milestone_id = ? AND s.superseded = 0 ORDER BY s.id').bind(ms.id).all()).results;
      return json({ ok: true, data: { signoffs: rows, needed: !!ms.milestone_key && (await getSetting(env, 'site.dual_signoff')) !== 'off', block: await signoffBlock(env, getSetting, ms) } });
    } catch (e) { return serverError(e, 'signoffs'); }
  }));

  // Anyone on the site team, the PM or the Owner may upload either document (the consultant signs on paper on site; someone photographs it).
  router.post('/api/site/milestones/:id/signoffs', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const { ms, err } = await msOf(env, req); if (err) return err;
      if (ms.status === 'done') return bad('This stage is already certified.', 409);
      const b = await req.json().catch(() => ({}));
      if (!KINDS.includes(b.kind)) return bad('Say which sign-off this is: the Site Engineer\'s, or the RCC consultant\'s report.');
      const d = await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(b.document_id), ms.project_id).first();
      if (!d) return bad('Attach the photo or scan first.');
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare('UPDATE site_ms_signoffs SET superseded = 1 WHERE milestone_id = ? AND kind = ? AND superseded = 0').bind(ms.id, b.kind),
        env.DB.prepare('INSERT INTO site_ms_signoffs (milestone_id, kind, document_id, note, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ms.id, b.kind, d.id, String(b.note || '').slice(0, 200), req.user.user_id, now),
        ...(b.kind === 'rcc_consultant' ? [env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'site', ? FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL")
          .bind(`Confirm the RCC report: ${ms.name}${ms.wing ? ' · ' + ms.wing : ''}`, `${req.user.name} uploaded the consultant's inspection report. Open the stage to read it and confirm.`, now)] : []),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'signoff_upload', 'site_milestones', ms.id, `${b.kind === 'rcc_consultant' ? 'RCC consultant report' : 'Site Engineer sign-off'} uploaded for ${ms.name}`, now),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'signoff-upload'); }
  }));

  router.post('/api/site/signoffs/:id/confirm', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can confirm the consultant\'s report.', 403);
      const s = await env.DB.prepare('SELECT s.*, m.project_id, m.name AS ms_name FROM site_ms_signoffs s JOIN site_milestones m ON m.id = s.milestone_id WHERE s.id = ? AND s.superseded = 0').bind(Number(req.params.id)).first();
      if (!s || !(await visibleProjectIds(env, req.user)).includes(s.project_id)) return bad('Not found.', 404);
      if (s.kind !== 'rcc_consultant') return bad('Only the consultant\'s report needs the Owner\'s confirmation.', 400);
      const r = await env.DB.prepare('UPDATE site_ms_signoffs SET confirmed_by = ?, confirmed_at = ? WHERE id = ? AND confirmed_at IS NULL AND superseded = 0').bind(req.user.user_id, nowStr(), s.id).run();
      if (!r.meta.changes) return bad('This report is already confirmed.', 409);
      await audit(env, req.user, 'signoff_confirm', 'site_milestones', s.milestone_id, `RCC consultant report confirmed for ${s.ms_name}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'signoff-confirm'); }
  }));

  // ---------- Physical completion by wing, and the cost-to-complete meter ----------
  router.post('/api/site/wing-progress', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or the Owner can enter the physical completion.', 403);
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const pct = Number(b.pct); if (!(pct >= 0 && pct <= 100)) return bad('Completion must be between 0 and 100 per cent.');
      const wing = String(b.wing || '').trim().slice(0, 30);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO site_wing_progress (project_id, wing, pct_bp, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, wing) DO UPDATE SET pct_bp = excluded.pct_bp, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(pid, wing, Math.round(pct * 100), String(b.note || '').slice(0, 200), req.user.user_id, nowStr()),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'wing_progress', 'site_wing_progress', pid, `Physical completion of ${wing || 'the building'} set to ${pct}%`, nowStr()),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'wing-progress'); }
  }));

  // Spent so far (supplier bills before GST plus contractor RA bills gross) against the budget, and what the project would cost at completion at this rate of spending.
  // Completion per wing comes from two sources: certified milestones and the PM's own figure. If both exist the lower one is used (the cautious reading);
  // a wing counts as complete only when both say 100%. If only one exists that one is used.
  router.get('/api/budget/cost-to-complete', async (req, env) => withAuth(req, env, 'budget', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const [budget, ven, con, ms, pm] = await Promise.all([
        env.DB.prepare('SELECT COALESCE(SUM(budget_paise), 0) AS v FROM bud_heads WHERE project_id = ? AND deleted_at IS NULL').bind(pid).first(),
        env.DB.prepare("SELECT COALESCE(SUM(COALESCE(taxable_paise, amount_paise - COALESCE(gst_paise, 0))), 0) AS v FROM pro_bills WHERE project_id = ?").bind(pid).first(),
        env.DB.prepare("SELECT COALESCE(SUM(r.gross_paise), 0) AS v FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id WHERE w.project_id = ? AND r.status != 'cancelled'").bind(pid).first(),
        env.DB.prepare("SELECT COALESCE(wing, '') AS wing, COALESCE(all_wings, 0) AS all_wings, COUNT(*) AS n, SUM(status = 'done') AS d FROM site_milestones WHERE project_id = ? AND deleted_at IS NULL GROUP BY COALESCE(wing, ''), COALESCE(all_wings, 0)").bind(pid).all(),
        env.DB.prepare('SELECT wing, pct_bp, updated_at FROM site_wing_progress WHERE project_id = ?').bind(pid).all(),
      ]);
      const wings = new Set([...ms.results.filter((r) => r.wing && !r.all_wings).map((r) => r.wing), ...pm.results.map((r) => r.wing)]);
      if (!wings.size) wings.add('');
      const allRows = ms.results.filter((r) => r.all_wings || !r.wing);
      const rows = [...wings].map((w) => {
        const mine = ms.results.filter((r) => r.wing === w && w), pool = [...mine, ...allRows];
        const n = pool.reduce((t, r) => t + r.n, 0), d = pool.reduce((t, r) => t + (r.d || 0), 0);
        const mPct = n ? Math.round((d * 10000) / n) : null;
        const p = pm.results.find((x) => x.wing === w); const pPct = p ? p.pct_bp : null;
        const used = mPct != null && pPct != null ? Math.min(mPct, pPct) : (mPct != null ? mPct : pPct);
        return { wing: w, milestone_pct_bp: mPct, pm_pct_bp: pPct, used_pct_bp: used, complete: mPct === 10000 && pPct === 10000, pm_updated_at: p ? p.updated_at : null };
      });
      const known = rows.filter((r) => r.used_pct_bp != null);
      const projPct = known.length ? Math.round(known.reduce((t, r) => t + r.used_pct_bp, 0) / known.length) : null;
      const spent = ven.v + con.v;
      const projected = projPct ? Math.round((spent * 10000) / projPct) : null;
      return json({ ok: true, data: { budget_paise: budget.v, spent_paise: spent, spent_pct_bp: budget.v ? Math.round((spent * 10000) / budget.v) : null, completion_pct_bp: projPct, all_complete: known.length > 0 && rows.every((r) => r.complete),
        projected_total_paise: projected, projected_over_paise: projected != null && budget.v ? Math.max(0, projected - budget.v) : null, wings: rows,
        note: 'Spent = supplier bills before GST plus contractor RA bills (gross), cancelled bills left out. Completion = the lower of the certified-stage figure and the PM\'s figure; a wing is complete only when both say 100%. A projection from early stages is rough.' } });
    } catch (e) { return serverError(e, 'cost-to-complete'); }
  }));
}
