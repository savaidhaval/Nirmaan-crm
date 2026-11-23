// routes/quality.js — pour cards (checked and approved before concrete goes in), cube tests at 7 and 28 days, non-conformance reports (NCR).
// A failed cube raises an NCR by itself; an open 28-day cube NCR stops the PM certifying that floor (see the milestone route).
import { approvalState, isDate, todayIST } from '../core/gates.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ELEMENTS = ['slab', 'beam', 'column', 'footing', 'raft', 'wall', 'staircase', 'other'];
export const DEFAULT_CHECKLIST = [
  'Drawing is the current issued-for-construction revision', 'Shuttering, levels and props checked', 'Reinforcement as per drawing (sizes, spacing, laps)',
  'Cover blocks in place', 'Electrical and plumbing sleeves / conduits in place', 'Vibrator, standby vibrator and lighting ready',
  'Cube moulds ready (a set of 3 for each test age)', 'Curing arranged',
];
export const DEFAULT_SAFETY = ['Toolbox talk held', 'Helmets, shoes and harnesses worn (PPE)', 'Edge protection and railings in place', 'Scaffolding checked and tagged', 'Site clean, walkways clear', 'First-aid kit stocked'];
export const DEFAULT_ACTIVITIES = ['Excavation', 'PCC', 'Footing / raft', 'Column', 'Beam', 'Slab', 'Staircase', 'Blockwork', 'Plaster (internal)', 'Plaster (external)',
  'Waterproofing', 'Electrical', 'Plumbing', 'Flooring / tiling', 'Doors and windows', 'Painting', 'Other'];
const listSetting = (v, dflt) => { const l = String(v || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean); return l.length ? l : dflt; };

// Cubes due today or overdue without a result: one reminder a day to the PM and the Owner (one statement, in the hourly sweep).
export async function cubeSweep(env) {
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'Cube test due: ' || p.name, COUNT(*) || ' cube test(s) are due or overdue. Enter the lab results.', 'quality', datetime('now')
    FROM qa_cubes c JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL JOIN users u ON u.role IN ('pm', 'owner') AND u.active = 1 AND u.deleted_at IS NULL
    WHERE c.status = 'pending' AND c.due_date <= date('now', '+5 hours', '+30 minutes')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Cube test due: ' || p.name AND date(n.created_at) = date('now'))
    GROUP BY u.id, p.id`).run();
}

export function registerQuality(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, userCan } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 300), nowStr());
  const canSee = async (env, req, pid) => pid > 0 && (await visibleProjectIds(env, req.user)).includes(pid);
  const docOk = async (env, id, pid) => !id || !!(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL AND (project_id = ? OR project_id IS NULL)').bind(id, pid).first());
  // The project's own PMs first, then the most recent PM / Owner accounts (at most 20 people).
  const notifyPm = (env, pid, title, body) => env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?1, ?2, 'quality', ?3 FROM users
    WHERE role IN ('pm', 'owner') AND active = 1 AND deleted_at IS NULL ORDER BY role = 'owner' DESC, id IN (SELECT user_id FROM project_members WHERE project_id = ?4) DESC, id DESC LIMIT 20`).bind(title, body, nowStr(), pid);
  async function checklist(env) { return listSetting(await getSetting(env, 'qa.pour_checklist'), DEFAULT_CHECKLIST); }
  async function sevenDayBp(env) { const v = Math.round(num(await getSetting(env, 'qa.cube_7day_pct_bp'))); return v > 0 && v <= 10000 ? v : 6500; }
  const fck = (grade) => { const m = String(grade || '').match(/M\s*(\d+)/i); return m ? Number(m[1]) : null; };
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  async function loadPour(env, req) {
    const p = await env.DB.prepare('SELECT * FROM qa_pours WHERE id = ?').bind(Number(req.params.id)).first();
    return p && (await canSee(env, req, p.project_id)) ? p : null;
  }

  router.get('/api/qa/meta', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      return json({ ok: true, data: { checklist: await checklist(env), elements: ELEMENTS, activities: listSetting(await getSetting(env, 'dpr.activities'), DEFAULT_ACTIVITIES), safety: listSetting(await getSetting(env, 'dpr.safety_checks'), DEFAULT_SAFETY), seven_day_pct: (await sevenDayBp(env)) / 100 } });
    } catch (e) { return serverError(e, 'qa-meta'); }
  }));

  // ----- pour cards -----
  router.get('/api/qa/pours', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const [pours, cubes] = await env.DB.batch([
        env.DB.prepare(`SELECT p.*, u.name AS requested_by_name, a.name AS approved_by_name FROM qa_pours p LEFT JOIN users u ON u.id = p.requested_by LEFT JOIN users a ON a.id = p.approved_by
          WHERE p.project_id = ? ORDER BY CASE p.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, COALESCE(p.poured_on, p.planned_date) DESC, p.id DESC LIMIT 100`).bind(pid),
        env.DB.prepare('SELECT * FROM qa_cubes WHERE project_id = ? ORDER BY due_date LIMIT 400').bind(pid),
      ]);
      const by = {}; for (const c of cubes.results) (by[c.pour_id] = by[c.pour_id] || []).push(c);
      for (const p of pours.results) { p.cubes = by[p.id] || []; try { p.checklist = JSON.parse(p.checklist || '{}'); } catch (e) { p.checklist = {}; } }
      return json({ ok: true, data: { pours: pours.results } });
    } catch (e) { return serverError(e, 'qa-pours'); }
  }));

  router.post('/api/qa/pours', async (req, env) => withAuth(req, env, 'site', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id);
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM qa_pours WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const element = ELEMENTS.includes(b.element) ? b.element : null;
      if (!element) return json({ ok: false, error: 'Pick what is being poured (slab, beam, column...).' }, 400);
      const grade = String(b.grade || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!fck(grade)) return json({ ok: false, error: 'Enter the concrete grade, like M25.' }, 400);
      const qty = num(b.qty_cum); if (!(qty > 0 && qty < 10000)) return json({ ok: false, error: 'Enter the quantity in cubic metres.' }, 400);
      const floor = b.floor === '' || b.floor == null ? null : Math.round(num(b.floor));
      if (b.planned_date && !isDate(b.planned_date)) return json({ ok: false, error: 'Check the planned date.' }, 400);
      const items = await checklist(env);
      const ticks = Object.fromEntries(items.map((i) => [i, !!(b.checklist && b.checklist[i])]));
      const photo = Number(b.photo_doc_id) || null; if (!(await docOk(env, photo, pid))) return json({ ok: false, error: 'That photo was not found.' }, 400);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare(`INSERT INTO qa_pours (project_id, wing, floor, element, location, grade, qty_cum, planned_date, drawing_ref, rmc_supplier, checklist, photo_doc_id, status, requested_by, created_at, client_uuid)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`).bind(pid, String(b.wing || '').trim().slice(0, 20) || null, floor, element, String(b.location || '').slice(0, 120) || null, grade, qty,
          b.planned_date || null, String(b.drawing_ref || '').slice(0, 80) || null, String(b.rmc_supplier || '').slice(0, 80) || null, JSON.stringify(ticks), photo, req.user.user_id, now, uuid),
        audit(env, req.user, 'create', 'qa_pours', 0, `Pour card: ${element} ${grade} ${qty} cum${b.wing ? ' wing ' + b.wing : ''}${floor != null ? ' floor ' + floor : ''}`),
        notifyPm(env, pid, `Pour card to approve`, `${element} ${grade}, ${qty} cum${b.wing ? ', wing ' + b.wing : ''}${floor != null ? ', floor ' + floor : ''}${b.planned_date ? ', on ' + b.planned_date : ''}.`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id, unticked: items.filter((i) => !ticks[i]) } });
    } catch (e) { return serverError(e, 'qa-pour-add'); }
  }));

  // Approve: every check ticked (the PM can tick what they checked), not by the person who asked, and the floor covered by the CC.
  router.post('/api/qa/pours/:id/approve', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      const p = await loadPour(env, req); if (!p) return json({ ok: false, error: 'Pour card not found.' }, 404);
      if (p.status !== 'requested') return json({ ok: false, error: 'This pour card is not waiting for approval.' }, 409);
      if (p.requested_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'Someone else must approve a pour card you asked for.' }, 403);
      const b = await req.json().catch(() => ({}));
      let ticks = {}; try { ticks = JSON.parse(p.checklist || '{}'); } catch (e) { ticks = {}; }
      if (b.checklist && typeof b.checklist === 'object') for (const k of Object.keys(ticks)) if (b.checklist[k]) ticks[k] = true;
      const open = Object.keys(ticks).filter((k) => !ticks[k]);
      if (open.length) return json({ ok: false, error: `Not checked yet: ${open.join('; ')}.`, code: 'checklist', open }, 409);
      const st = await approvalState(env, p.project_id);
      const upto = st.ccUpto(p.wing);
      let block = null;
      if (!(st.approved('cc', p.wing) || st.approved('plinth_cc', p.wing) || st.approved('further_cc', p.wing))) block = 'No Commencement Certificate is marked approved in Approvals.';
      else if (p.floor != null && (upto == null || p.floor > upto)) block = `The approved CC covers work up to floor ${upto == null ? '(not recorded)' : upto}; this pour is floor ${p.floor}.`;
      const override = String(b.override_note || '').trim().slice(0, 300);
      if (block && (req.user.role !== 'owner' || !override)) return json({ ok: false, error: block + (req.user.role === 'owner' ? ' As the Owner you can go ahead only with a written reason.' : ''), code: 'cc' }, 409);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE qa_pours SET status = 'approved', checklist = ?, approved_by = ?, approved_at = ?, override_note = ? WHERE id = ? AND status = 'requested'").bind(JSON.stringify(ticks), req.user.user_id, now, block ? override : null, p.id),
        audit(env, req.user, 'approve', 'qa_pours', p.id, `Pour approved: ${p.element} ${p.grade}${block ? ' — Owner went past: ' + block + ' Reason: ' + override : ''}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'Already decided.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'qa-pour-approve'); }
  }));

  // Poured: records the actual pour and makes the 7-day and 28-day cube tests with their due dates and the strength each must reach.
  router.post('/api/qa/pours/:id/poured', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const p = await loadPour(env, req); if (!p) return json({ ok: false, error: 'Pour card not found.' }, 404);
      if (p.status !== 'approved') return json({ ok: false, error: p.status === 'requested' ? 'The PM has not approved this pour card yet. Do not pour.' : 'This pour is already recorded.' }, 409);
      const b = await req.json().catch(() => ({}));
      const d = String(b.poured_on || todayIST()).slice(0, 10);
      if (!isDate(d) || d > todayIST()) return json({ ok: false, error: 'The pour date cannot be in the future.' }, 400);
      const qty = b.poured_qty_cum === '' || b.poured_qty_cum == null ? p.qty_cum : num(b.poured_qty_cum);
      if (!(qty > 0)) return json({ ok: false, error: 'Enter the quantity poured.' }, 400);
      const f = fck(p.grade), seven = Math.round(f * (await sevenDayBp(env)) / 100) / 100;
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE qa_pours SET status = 'poured', poured_on = ?, poured_qty_cum = ?, rmc_tickets = ?, poured_by = ? WHERE id = ? AND status = 'approved'").bind(d, qty, String(b.rmc_tickets || '').slice(0, 300) || null, req.user.user_id, p.id),
        env.DB.prepare("INSERT OR IGNORE INTO qa_cubes (pour_id, project_id, age_days, due_date, required_mpa) SELECT ?, ?, 7, ?, ? WHERE changes() > 0").bind(p.id, p.project_id, addDays(d, 7), seven),
        env.DB.prepare("INSERT OR IGNORE INTO qa_cubes (pour_id, project_id, age_days, due_date, required_mpa) SELECT ?, ?, 28, ?, ? WHERE EXISTS (SELECT 1 FROM qa_pours WHERE id = ? AND status = 'poured')").bind(p.id, p.project_id, addDays(d, 28), f, p.id),
        audit(env, req.user, 'poured', 'qa_pours', p.id, `Poured ${qty} cum ${p.grade} on ${d}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'This pour is already recorded.' }, 409);
      return json({ ok: true, data: { cube_7_due: addDays(d, 7), cube_28_due: addDays(d, 28), required_7_mpa: seven, required_28_mpa: f } });
    } catch (e) { return serverError(e, 'qa-poured'); }
  }));

  router.post('/api/qa/pours/:id/cancel', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      const p = await loadPour(env, req); if (!p) return json({ ok: false, error: 'Pour card not found.' }, 404);
      const b = await req.json().catch(() => ({}));
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why.' }, 400);
      const r = await env.DB.prepare("UPDATE qa_pours SET status = 'cancelled', cancel_note = ? WHERE id = ? AND status IN ('requested', 'approved')").bind(String(b.reason).slice(0, 200), p.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'A poured pour cannot be cancelled.' }, 409);
      await audit(env, req.user, 'cancel', 'qa_pours', p.id, `Pour card cancelled: ${String(b.reason).slice(0, 100)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'qa-pour-cancel'); }
  }));

  // ----- cube results: a fail raises an NCR by itself -----
  router.post('/api/qa/cubes/:id/result', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const c = await env.DB.prepare('SELECT c.*, p.wing, p.floor, p.element, p.grade, p.poured_on FROM qa_cubes c JOIN qa_pours p ON p.id = c.pour_id WHERE c.id = ?').bind(Number(req.params.id)).first();
      if (!c || !(await canSee(env, req, c.project_id))) return json({ ok: false, error: 'Cube test not found.' }, 404);
      if (c.status !== 'pending') return json({ ok: false, error: 'The result is already entered.' }, 409);
      const b = await req.json().catch(() => ({}));
      const mpa = num(b.result_mpa); if (!(mpa > 0 && mpa < 200)) return json({ ok: false, error: 'Enter the average strength of the set (N/mm²).' }, 400);
      const tested = String(b.tested_on || todayIST()).slice(0, 10);
      if (!isDate(tested) || tested > todayIST()) return json({ ok: false, error: 'The test date cannot be in the future.' }, 400);
      if (c.poured_on && tested < addDays(c.poured_on, c.age_days - 1)) return json({ ok: false, error: `A ${c.age_days}-day cube cannot be tested before ${addDays(c.poured_on, c.age_days - 1)}.` }, 400);
      const doc = Number(b.report_doc_id) || null; if (!(await docOk(env, doc, c.project_id))) return json({ ok: false, error: 'That file was not found.' }, 400);
      const pass = mpa + 1e-9 >= c.required_mpa, now = nowStr();
      const where = `${c.element} ${c.grade}${c.wing ? ', wing ' + c.wing : ''}${c.floor != null ? ', floor ' + c.floor : ''}`;
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE qa_cubes SET status = ?, result_mpa = ?, tested_on = ?, lab = ?, report_doc_id = ?, entered_by = ?, entered_at = ? WHERE id = ? AND status = 'pending'")
          .bind(pass ? 'pass' : 'fail', mpa, tested, String(b.lab || '').slice(0, 80) || null, doc, req.user.user_id, now, c.id),
        ...(pass ? [] : [
          env.DB.prepare(`INSERT INTO qa_ncrs (project_id, wing, floor, source, pour_id, cube_id, title, details, status, created_by, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ? WHERE changes() > 0`)
            .bind(c.project_id, c.wing, c.floor, c.age_days === 28 ? 'cube28' : 'cube7', c.pour_id, c.id, `${c.age_days}-day cube failed: ${where}`, `Result ${mpa} N/mm², required ${c.required_mpa} N/mm².`, req.user.user_id, now),
          notifyPm(env, c.project_id, `Cube test FAILED: ${where}`, `${c.age_days}-day result ${mpa} N/mm² against ${c.required_mpa} required. An NCR is open.${c.age_days === 28 ? ' Certifying this floor is stopped until it is closed.' : ''}`),
        ]),
        audit(env, req.user, 'result', 'qa_cubes', c.id, `${c.age_days}-day cube ${where}: ${mpa} N/mm² (${pass ? 'pass' : 'FAIL'}, required ${c.required_mpa})`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'The result is already entered.' }, 409);
      return json({ ok: true, data: { status: pass ? 'pass' : 'fail', required_mpa: c.required_mpa, ncr: !pass } });
    } catch (e) { return serverError(e, 'qa-cube'); }
  }));

  // ----- NCRs -----
  router.get('/api/qa/ncrs', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const pid = Number(q.get('project_id'));
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const rows = (await env.DB.prepare(`SELECT n.*, u.name AS assigned_name, c.name AS created_by_name, x.name AS closed_by_name FROM qa_ncrs n LEFT JOIN users u ON u.id = n.assigned_to LEFT JOIN users c ON c.id = n.created_by LEFT JOIN users x ON x.id = n.closed_by
        WHERE n.project_id = ? AND (? = '' OR n.status = ?) ORDER BY n.status = 'closed', n.id DESC LIMIT 200`).bind(pid, q.get('status') || '', q.get('status') || '').all()).results;
      return json({ ok: true, data: { ncrs: rows } });
    } catch (e) { return serverError(e, 'qa-ncrs'); }
  }));

  router.post('/api/qa/ncrs', async (req, env) => withAuth(req, env, 'site', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id);
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM qa_ncrs WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const title = String(b.title || '').trim().slice(0, 200); if (!title) return json({ ok: false, error: 'Say what is wrong.' }, 400);
      if (b.due_date && !isDate(b.due_date)) return json({ ok: false, error: 'Check the date.' }, 400);
      const uid = Number(b.assigned_to) || null;
      if (uid && !(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(uid).first())) return json({ ok: false, error: 'Pick a person from the list.' }, 400);
      const photo = Number(b.photo_doc_id) || null; if (!(await docOk(env, photo, pid))) return json({ ok: false, error: 'That photo was not found.' }, 400);
      const floor = b.floor === '' || b.floor == null ? null : Math.round(num(b.floor));
      const res = await env.DB.batch([
        env.DB.prepare("INSERT INTO qa_ncrs (project_id, wing, floor, source, title, details, contractor_id, assigned_to, due_date, status, photo_doc_id, created_by, created_at, client_uuid) VALUES (?, ?, ?, 'site', ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)")
          .bind(pid, String(b.wing || '').trim().slice(0, 20) || null, floor, title, String(b.details || '').slice(0, 1000) || null, Number(b.contractor_id) || null, uid, b.due_date || null, photo, req.user.user_id, nowStr(), uuid),
        audit(env, req.user, 'create', 'qa_ncrs', 0, `NCR raised: ${title}`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'qa-ncr-add'); }
  }));

  router.post('/api/qa/ncrs/:id/close', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      const n = await env.DB.prepare('SELECT * FROM qa_ncrs WHERE id = ?').bind(Number(req.params.id)).first();
      if (!n || !(await canSee(env, req, n.project_id))) return json({ ok: false, error: 'NCR not found.' }, 404);
      const b = await req.json().catch(() => ({}));
      const corr = String(b.correction || '').trim().slice(0, 1000);
      if (!corr) return json({ ok: false, error: 'Write what was done to correct it (e.g. core test passed, member strengthened, recast).' }, 400);
      const doc = Number(b.closing_doc_id) || null; if (!(await docOk(env, doc, n.project_id))) return json({ ok: false, error: 'That file was not found.' }, 400);
      const r = await env.DB.prepare("UPDATE qa_ncrs SET status = 'closed', correction = ?, closed_by = ?, closed_at = ?, closing_doc_id = ? WHERE id = ? AND status = 'open'").bind(corr, req.user.user_id, nowStr(), doc, n.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Already closed.' }, 409);
      await audit(env, req.user, 'close', 'qa_ncrs', n.id, `NCR closed: ${n.title}. ${corr.slice(0, 120)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'qa-ncr-close'); }
  }));
}
