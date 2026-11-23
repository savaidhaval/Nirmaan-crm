// routes/siteboard.js — Module 1 step 3: the site readiness score, the inspection board (latest approvals and drawings for the gate QR),
// and the Monday follow-up messages for consultants. Read-only. Free-plan caps: each route is 2 to 5 statements.
import { PROOF_LABEL, demolitionStatus } from '../core/gates.js';

const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

export function registerSiteBoard(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const canSee = async (env, req, pid) => (await visibleProjectIds(env, req.user)).includes(pid);

  // ---------- Site readiness % ----------
  // The score is the plain average of the checks that apply to this project; every pending check is listed so nobody has to guess.
  router.get('/api/projects/:id/readiness', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id); if (!(await canSee(env, req, pid))) return bad('Not allowed.', 403);
      const [d, m] = await Promise.all([
        demolitionStatus(env, pid, getSetting),
        env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(m.paaa_reg_no IS NOT NULL), 0) AS paaa, COALESCE(SUM(m.vacated_on IS NOT NULL), 0) AS vacated, COALESCE(SUM(m.utilities_disconnected), 0) AS utilities
          FROM red_members m JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL WHERE s.project_id = ? AND m.deleted_at IS NULL`).bind(pid).first(),
      ]);
      const checks = [], pending = [];
      const add = (key, label, done, total, pendingText) => { if (!(total > 0)) return; checks.push({ key, label, done, total, pct: Math.round(100 * done / total) }); if (done < total) pending.push(pendingText); };
      add('iod', 'IOD approved', d.iodOk ? 1 : 0, 1, 'IOD is not approved');
      add('cc', 'Commencement Certificate', (d.st.approved('cc') || d.st.approved('plinth_cc')) ? 1 : 0, 1, 'CC is not approved');
      add('proofs', 'Site proofs (meters, NOCs)', d.need.filter((k) => d.have.has(k)).length, d.need.length, `${d.need.filter((k) => !d.have.has(k)).map((k) => PROOF_LABEL[k]).slice(0, 2).join(' and ')} pending`);
      add('paaa', 'PAAA registered', m.paaa, m.total, `${m.total - m.paaa} of ${m.total} PAAA not registered`);
      add('vacated', 'Flats vacated', m.vacated, m.total, `${m.total - m.vacated} of ${m.total} members still to vacate`);
      add('utilities', 'Utilities disconnected', m.utilities, m.total, `${m.total - m.utilities} flat(s) still have utilities connected`);
      const pct = checks.length ? Math.round(checks.reduce((t, c) => t + c.pct, 0) / checks.length) : 0;
      return json({ ok: true, data: { pct, checks, pending, headline: `${pct}% ready${pending.length ? ' — ' + pending.slice(0, 2).join('; ') : ''}`, how: 'The average of the checks listed. Each check counts equally.' } });
    } catch (e) { return serverError(e, 'site-readiness'); }
  }));

  // ---------- Inspection board ----------
  router.get('/api/projects/:id/inspection', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id); if (!(await canSee(env, req, pid))) return bad('Not allowed.', 403);
      const [p, apr, drw] = await env.DB.batch([
        env.DB.prepare('SELECT id, name, code, rera_no, address FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid),
        env.DB.prepare("SELECT id, name, gate_key, wing, approved_on, letter_no, letter_date, valid_till, letter_doc_id, cc_upto_floor FROM apr_items WHERE project_id = ? AND deleted_at IS NULL AND status = 'approved' ORDER BY COALESCE(letter_date, approved_on) DESC, id DESC LIMIT 60").bind(pid),
        env.DB.prepare("SELECT d.id, d.code, d.title, d.discipline, r.rev_no, r.document_id FROM drw_drawings d JOIN drw_revisions r ON r.drawing_id = d.id AND r.status = 'ifc' WHERE d.project_id = ? AND d.deleted_at IS NULL ORDER BY d.discipline, d.code LIMIT 120").bind(pid),
      ]);
      if (!p.results.length) return bad('Project not found.', 404);
      const t = today();
      const items = apr.results.map((i) => ({ ...i, expired: !!(i.valid_till && String(i.valid_till).slice(0, 10) < t) }));
      return json({ ok: true, data: { project: p.results[0], approvals: items, drawings: drw.results, as_of: t } });
    } catch (e) { return serverError(e, 'site-inspection'); }
  }));

  // ---------- Consultant follow-ups (messages the sender opens in WhatsApp; nothing is sent automatically) ----------
  router.get('/api/projects/:id/consultant-summary', async (req, env) => withAuth(req, env, 'approvals', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id); if (!(await canSee(env, req, pid))) return bad('Not allowed.', 403);
      const [p, apr, drw] = await env.DB.batch([
        env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid),
        env.DB.prepare("SELECT name, status, consultant, target_date, valid_till FROM apr_items WHERE project_id = ? AND deleted_at IS NULL AND status NOT IN ('approved', 'na', 'rejected') ORDER BY COALESCE(target_date, '9999') LIMIT 200").bind(pid),
        env.DB.prepare("SELECT code, title FROM drw_drawings WHERE project_id = ? AND deleted_at IS NULL AND waiting_consultant = 1 ORDER BY code LIMIT 100").bind(pid),
      ]);
      if (!p.results.length) return bad('Project not found.', 404);
      const t = today(); const groups = new Map();
      for (const i of apr.results) {
        const k = String(i.consultant || '').trim() || 'Not assigned';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ name: i.name, status: i.status, target_date: i.target_date, late: !!(i.target_date && i.target_date < t) });
      }
      const label = { not_started: 'not started', applied: 'applied', query: 'BMC query open', in_progress: 'in progress' };
      const out = [...groups.entries()].map(([consultant, items]) => {
        const lines = items.map((i, n) => `${n + 1}. ${i.name} (${label[i.status] || i.status}${i.target_date ? ', due ' + i.target_date : ''}${i.late ? ', LATE' : ''})`);
        const text = `Good morning. Pending items for ${p.results[0].name} as of ${t}:\n${lines.join('\n')}\nPlease send an update on each item today.`;
        return { consultant, count: items.length, late: items.filter((i) => i.late).length, items, text };
      }).sort((a, b) => b.late - a.late || b.count - a.count);
      const dtext = drw.results.length ? `Drawings waiting for consultant review (${drw.results.length}): ${drw.results.slice(0, 15).map((d) => d.code).join(', ')}${drw.results.length > 15 ? '…' : ''}` : '';
      return json({ ok: true, data: { groups: out, drawings_waiting: drw.results, drawings_text: dtext, as_of: t } });
    } catch (e) { return serverError(e, 'site-consultants'); }
  }));
}
