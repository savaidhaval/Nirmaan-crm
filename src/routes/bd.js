// routes/bd.js — Business Development: where new projects come from.
// Opportunity → follow-ups → feasibility study → 79A process (societies) → development agreement signed → registered → becomes a project.
import { isDate, todayIST } from '../core/gates.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
const rupees = (p) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');
export const KINDS = ['society', 'land', 'jv', 'other'];
export const STAGES = ['identified', 'follow_up', 'feasibility', 'process_79a', 'da_signed', 'da_registered'];
export const STAGE_LABEL = { identified: 'Identified', follow_up: 'Follow-ups', feasibility: 'Feasibility study', process_79a: '79A process', da_signed: 'DA signed', da_registered: 'DA registered' };
// Steps of the 79A process for a co-operative housing society (record only; the exact procedure is the society's and its advocate's).
export const DEFAULT_79A = [
  'Members asked for redevelopment (requisition / letter to the committee)', 'Special general body meeting resolves to redevelop',
  'Project management consultant / architect appointed by the society', 'Feasibility report approved in the general body',
  'Tender / offers invited from developers', 'Developer selected in the general body (in the presence of the registrar\'s officer)',
  'Letter of intent / appointment letter issued to us', 'Draft development agreement approved by the general body',
];
// Construction milestones created with the project (site certifies them against the CC). [name, floor]
const BUILD_MILESTONES = [['Excavation', null], ['Foundation', null], ['Basement', -1], ['Plinth', 0]];

// Hourly: one reminder a day to the person in charge when a follow-up is due today or overdue (one statement).
export async function bdSweep(env) {
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT o.owner_user_id, 'Follow up: ' || o.name, 'A follow-up was due on ' || o.next_followup || '. Call or meet, then record it in Business Development.', 'bd', datetime('now')
    FROM bd_opportunities o JOIN users u ON u.id = o.owner_user_id AND u.active = 1 AND u.deleted_at IS NULL
    WHERE o.status = 'open' AND o.next_followup IS NOT NULL AND o.next_followup <= date('now', '+5 hours', '+30 minutes')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = o.owner_user_id AND n.title = 'Follow up: ' || o.name AND date(n.created_at) = date('now'))
    LIMIT 200`).run();
}

export function registerBd(router, h) {
  const { withAuth, json, serverError, nowStr, getSetting, defaultBrandId, loadMumbaiTemplate, feasibilityFromStudy, societyForProject } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'bd_opportunities', id || 0, String(summary).slice(0, 300), nowStr());
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  async function steps79a(env) { const l = String((await getSetting(env, 'bd.steps_79a')) || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean); return l.length ? l : DEFAULT_79A; }
  async function load(env, id) { return env.DB.prepare('SELECT * FROM bd_opportunities WHERE id = ?').bind(Number(id)).first(); }
  const userOk = async (env, uid) => !uid || !!(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(uid).first());
  const docOk = async (env, id) => !id || !!(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL').bind(id).first());
  const phone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '+91' + d : null; };

  router.get('/api/bd/meta', async (req, env) => withAuth(req, env, 'bd', 'V', async (req, env) => {
    try {
      const people = (await env.DB.prepare("SELECT id, name, role FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm') ORDER BY name LIMIT 100").all()).results;
      return json({ ok: true, data: { stages: STAGES.map((s) => [s, STAGE_LABEL[s]]), kinds: KINDS, steps_79a: await steps79a(env), people,
        vacate_to_plinth_months: num(await getSetting(env, 'bd.vacate_to_plinth_months')) || 7, completion_months: num(await getSetting(env, 'bd.completion_months')) || 36 } });
    } catch (e) { return serverError(e, 'bd-meta'); }
  }));

  router.get('/api/bd/opportunities', async (req, env) => withAuth(req, env, 'bd', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const status = ['open', 'won', 'lost', 'dropped'].includes(q.get('status')) ? q.get('status') : 'open';
      const rows = (await env.DB.prepare(`SELECT o.*, u.name AS owner_name, p.name AS project_name,
          (SELECT COUNT(*) FROM bd_followups f WHERE f.opportunity_id = o.id) AS followups,
          (SELECT MAX(version) FROM bd_studies s WHERE s.opportunity_id = o.id) AS study_version,
          (SELECT COUNT(*) FROM bd_steps s WHERE s.opportunity_id = o.id AND s.done_on IS NOT NULL) AS steps_done
        FROM bd_opportunities o LEFT JOIN users u ON u.id = o.owner_user_id LEFT JOIN projects p ON p.id = o.project_id
        WHERE o.status = ? ORDER BY CASE o.stage WHEN 'da_registered' THEN 0 WHEN 'da_signed' THEN 1 WHEN 'process_79a' THEN 2 WHEN 'feasibility' THEN 3 WHEN 'follow_up' THEN 4 ELSE 5 END, o.next_followup IS NULL, o.next_followup LIMIT 300`).bind(status).all()).results;
      const today = todayIST();
      for (const r of rows) r.followup_late = !!(r.status === 'open' && r.next_followup && r.next_followup < today);
      return json({ ok: true, data: { opportunities: rows, steps_total: (await steps79a(env)).length } });
    } catch (e) { return serverError(e, 'bd-list'); }
  }));

  router.post('/api/bd/opportunities', async (req, env) => withAuth(req, env, 'bd', 'C', async (req, env) => {
    try {
      const b = await req.json();
      const name = str(b.name, 150); if (!name) return bad('Give the opportunity a name (society or land).');
      const kind = KINDS.includes(b.kind) ? b.kind : 'society';
      const owner = Number(b.owner_user_id) || req.user.user_id; if (!(await userOk(env, owner))) return bad('Pick a person from the list.');
      if (b.contact_phone && !phone(b.contact_phone)) return bad('The mobile number must be 10 digits.');
      if (b.next_followup && !isDate(b.next_followup)) return bad('Check the follow-up date.');
      const area = b.plot_area_sqm === '' || b.plot_area_sqm == null ? null : num(b.plot_area_sqm), mem = b.members_count === '' || b.members_count == null ? null : Math.round(num(b.members_count));
      if ((area != null && !(area > 0)) || (mem != null && !(mem >= 0))) return bad('Check the plot area and number of members.');
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare(`INSERT INTO bd_opportunities (name, kind, society_name, address, ward, plot_area_sqm, members_count, source, contact_name, contact_phone, owner_user_id, stage, status, next_followup, notes, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'identified', 'open', ?, ?, ?, ?)`).bind(name, kind, str(b.society_name, 150) || (kind === 'society' ? name : null), str(b.address, 300) || null, str(b.ward, 40) || null, area, mem,
          str(b.source, 80) || null, str(b.contact_name, 100) || null, phone(b.contact_phone), owner, b.next_followup || null, str(b.notes, 1000) || null, req.user.user_id, now),
        audit(env, req.user, 'create', 0, `New opportunity: ${name} (${kind})`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'bd-add'); }
  }));

  router.get('/api/bd/opportunities/:id', async (req, env) => withAuth(req, env, 'bd', 'V', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      const [f, s, st, own] = await env.DB.batch([
        env.DB.prepare('SELECT f.*, u.name AS by_name FROM bd_followups f LEFT JOIN users u ON u.id = f.created_by WHERE f.opportunity_id = ? ORDER BY f.on_date DESC, f.id DESC LIMIT 100').bind(o.id),
        env.DB.prepare('SELECT * FROM bd_studies WHERE opportunity_id = ? ORDER BY version DESC').bind(o.id),
        env.DB.prepare('SELECT s.*, u.name AS by_name FROM bd_steps s LEFT JOIN users u ON u.id = s.done_by WHERE s.opportunity_id = ?').bind(o.id),
        env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(o.owner_user_id || 0),
      ]);
      const done = Object.fromEntries(st.results.map((x) => [x.step, x]));
      return json({ ok: true, data: { opportunity: { ...o, owner_name: own.results[0] ? own.results[0].name : null }, followups: f.results, studies: s.results,
        steps: o.kind === 'society' ? (await steps79a(env)).map((t) => ({ step: t, ...(done[t] || {}) })) : [] } });
    } catch (e) { return serverError(e, 'bd-get'); }
  }));

  // follow-up: what happened and when to follow up next (the next date moves the reminder)
  router.post('/api/bd/opportunities/:id/followups', async (req, env) => withAuth(req, env, 'bd', 'C', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      if (o.status !== 'open') return bad('This opportunity is closed.', 409);
      const b = await req.json(); const note = str(b.note, 1000); if (!note) return bad('Write what was discussed.');
      const on = b.on_date || todayIST(); if (!isDate(on) || on > todayIST()) return bad('The date cannot be in the future.');
      if (b.next_date && (!isDate(b.next_date) || b.next_date < todayIST())) return bad('The next follow-up must be today or later.');
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO bd_followups (opportunity_id, on_date, kind, note, next_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(o.id, on, str(b.kind, 20) || 'call', note, b.next_date || null, req.user.user_id, now),
        env.DB.prepare("UPDATE bd_opportunities SET next_followup = ?, stage = CASE WHEN stage = 'identified' THEN 'follow_up' ELSE stage END WHERE id = ?").bind(b.next_date || null, o.id),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bd-fu'); }
  }));

  router.post('/api/bd/opportunities/:id/studies', async (req, env) => withAuth(req, env, 'bd', 'C', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      const b = await req.json();
      const money = (k) => (b[k] === '' || b[k] == null ? null : Math.round(num(b[k])));
      const cost = money('est_cost_paise'), rev = money('est_revenue_paise');
      if (!b.document_id && cost == null) return bad('Attach the feasibility report or enter the estimated cost.');
      if ([cost, rev].some((x) => x != null && x < 0)) return bad('Figures cannot be negative.');
      const doc = Number(b.document_id) || null; if (!(await docOk(env, doc))) return bad('That file was not found.');
      const d = b.study_date && isDate(b.study_date) ? b.study_date : todayIST();
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare(`INSERT INTO bd_studies (opportunity_id, version, study_date, title, est_cost_paise, est_revenue_paise, saleable_sqft, completion_months, document_id, notes, created_by, created_at)
          SELECT ?1, COALESCE(MAX(version), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 FROM bd_studies WHERE opportunity_id = ?1`)
          .bind(o.id, d, str(b.title, 120) || 'Feasibility study', cost, rev, b.saleable_sqft ? num(b.saleable_sqft) : null, b.completion_months ? Math.round(num(b.completion_months)) : null, doc, str(b.notes, 1000) || null, req.user.user_id, now),
        env.DB.prepare("UPDATE bd_opportunities SET stage = 'feasibility' WHERE id = ? AND stage IN ('identified', 'follow_up')").bind(o.id),
        audit(env, req.user, 'study', o.id, `Feasibility study for ${o.name}${cost != null ? ': cost ' + rupees(cost) : ''}${rev != null ? ', revenue ' + rupees(rev) : ''}`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'bd-study'); }
  }));

  router.post('/api/bd/opportunities/:id/steps', async (req, env) => withAuth(req, env, 'bd', 'E', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      if (o.kind !== 'society') return bad('The 79A process is for societies.');
      const b = await req.json(); const list = await steps79a(env);
      if (!list.includes(b.step)) return bad('Unknown step.');
      const done = b.done_on === '' || b.done_on == null ? null : b.done_on;
      if (done && (!isDate(done) || done > todayIST())) return bad('The date cannot be in the future.');
      const doc = Number(b.document_id) || null; if (!(await docOk(env, doc))) return bad('That file was not found.');
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO bd_steps (opportunity_id, step, done_on, note, document_id, done_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(opportunity_id, step) DO UPDATE SET done_on = excluded.done_on, note = excluded.note, document_id = COALESCE(excluded.document_id, document_id), done_by = excluded.done_by`)
          .bind(o.id, b.step, done, str(b.note, 300) || null, doc, req.user.user_id, now),
        env.DB.prepare("UPDATE bd_opportunities SET stage = 'process_79a' WHERE id = ? AND stage IN ('identified', 'follow_up', 'feasibility') AND ? IS NOT NULL").bind(o.id, done),
        audit(env, req.user, 'step', o.id, `${o.name} 79A: ${b.step} ${done ? 'done ' + done : 'not done'}`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bd-step'); }
  }));

  // DA signed: after a study and (society) the 79A steps; registered: with its number and date
  router.post('/api/bd/opportunities/:id/da', async (req, env) => withAuth(req, env, 'bd', 'A', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      if (o.status !== 'open') return bad('This opportunity is closed.', 409);
      const b = await req.json(); const now = nowStr();
      if (b.action === 'signed') {
        if (!isDate(b.da_signed_on) || b.da_signed_on > todayIST()) return bad('Enter the date the DA was signed.');
        const doc = Number(b.da_doc_id) || 0; if (!doc || !(await docOk(env, doc))) return bad('Attach the signed development agreement.');
        if (!(await env.DB.prepare('SELECT 1 AS x FROM bd_studies WHERE opportunity_id = ?').bind(o.id).first())) return bad('Record the feasibility study first.', 409, 'study');
        let override = null;
        if (o.kind === 'society') {
          const list = await steps79a(env);
          const got = (await env.DB.prepare('SELECT step FROM bd_steps WHERE opportunity_id = ? AND done_on IS NOT NULL').bind(o.id).all()).results.map((x) => x.step);
          const open = list.filter((x) => !got.includes(x));
          if (open.length) {
            override = str(b.override_note, 300);
            if (req.user.role !== 'owner' || !override) return bad(`79A steps not recorded yet: ${open.join('; ')}.${req.user.role === 'owner' ? ' As the Owner you can go ahead only with a written reason.' : ''}`, 409, '79a');
          }
        }
        await env.DB.batch([
          env.DB.prepare("UPDATE bd_opportunities SET stage = 'da_signed', da_signed_on = ?, da_doc_id = ?, override_note = ? WHERE id = ?").bind(b.da_signed_on, doc, override, o.id),
          audit(env, req.user, 'da_signed', o.id, `${o.name}: development agreement signed ${b.da_signed_on}${override ? ' (Owner went past open 79A steps: ' + override + ')' : ''}`),
        ]);
        return json({ ok: true });
      }
      if (b.action === 'registered') {
        if (o.stage !== 'da_signed') return bad('Record the signed DA first.', 409);
        const no = str(b.da_reg_no, 80); if (!no) return bad('Enter the registration number.');
        if (!isDate(b.da_registered_on) || b.da_registered_on > todayIST() || b.da_registered_on < o.da_signed_on) return bad('Enter the registration date (on or after signing, not in the future).');
        await env.DB.batch([
          env.DB.prepare("UPDATE bd_opportunities SET stage = 'da_registered', da_registered_on = ?, da_reg_no = ? WHERE id = ?").bind(b.da_registered_on, no, o.id),
          audit(env, req.user, 'da_registered', o.id, `${o.name}: DA registered ${no} on ${b.da_registered_on}`),
        ]);
        return json({ ok: true });
      }
      return bad('Unknown step.');
    } catch (e) { return serverError(e, 'bd-da'); }
  }));

  router.post('/api/bd/opportunities/:id/close', async (req, env) => withAuth(req, env, 'bd', 'E', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      const b = await req.json(); const status = ['lost', 'dropped'].includes(b.status) ? b.status : null;
      if (!status) return bad('Pick lost or dropped.');
      const reason = str(b.reason, 300); if (!reason) return bad('Say why.');
      const r = await env.DB.prepare("UPDATE bd_opportunities SET status = ?, lost_reason = ?, closed_at = ? WHERE id = ? AND status = 'open'").bind(status, reason, nowStr(), o.id).run();
      if (!r.meta.changes) return bad('Already closed.', 409);
      await audit(env, req.user, status, o.id, `${o.name} ${status}: ${reason}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bd-close'); }
  }));

  router.post('/api/bd/opportunities/:id/edit', async (req, env) => withAuth(req, env, 'bd', 'E', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      const b = await req.json();
      const owner = b.owner_user_id !== undefined ? Number(b.owner_user_id) || null : o.owner_user_id; if (!(await userOk(env, owner))) return bad('Pick a person from the list.');
      if (b.next_followup && !isDate(b.next_followup)) return bad('Check the follow-up date.');
      if (b.contact_phone && !phone(b.contact_phone)) return bad('The mobile number must be 10 digits.');
      const pick = (k, n) => (b[k] !== undefined ? (str(b[k], n) || null) : o[k]);
      await env.DB.batch([
        env.DB.prepare('UPDATE bd_opportunities SET owner_user_id = ?, next_followup = ?, contact_name = ?, contact_phone = ?, address = ?, ward = ?, source = ?, notes = ?, members_count = ?, plot_area_sqm = ? WHERE id = ?')
          .bind(owner, b.next_followup !== undefined ? (b.next_followup || null) : o.next_followup, pick('contact_name', 100), b.contact_phone !== undefined ? phone(b.contact_phone) : o.contact_phone, pick('address', 300), pick('ward', 40), pick('source', 80), pick('notes', 1000),
            b.members_count !== undefined && b.members_count !== '' ? Math.round(num(b.members_count)) : o.members_count, b.plot_area_sqm !== undefined && b.plot_area_sqm !== '' ? num(b.plot_area_sqm) : o.plot_area_sqm, o.id),
        audit(env, req.user, 'edit', o.id, `${o.name}: details updated`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bd-edit'); }
  }));

  // The paper that lets the deal become a project: the society's appointment letter (after the 79A process) or the registered sale deed for land.
  router.post('/api/bd/opportunities/:id/start-paper', async (req, env) => withAuth(req, env, 'bd', 'A', async (req, env) => {
    try {
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      if (o.status !== 'open') return bad('This opportunity is closed.', 409);
      if (o.kind !== 'society' && o.kind !== 'land') return bad('A JV or other deal becomes a project once its development agreement is registered.', 400);
      const b = await req.json();
      if (!isDate(b.on) || b.on > todayIST()) return bad(o.kind === 'society' ? 'Enter the date on the appointment letter (not in the future).' : 'Enter the date the sale deed was registered (not in the future).');
      const ref = str(b.ref, 80); if (!ref) return bad(o.kind === 'society' ? 'Enter the letter number or reference.' : 'Enter the sale deed registration number.');
      const doc = Number(b.doc_id) || 0; if (!doc || !(await docOk(env, doc))) return bad(o.kind === 'society' ? 'Attach the scanned appointment letter.' : 'Attach the scanned sale deed (or its Index-II).');
      const what = o.kind === 'society' ? 'appointment letter' : 'land purchase';
      await env.DB.batch([
        env.DB.prepare('UPDATE bd_opportunities SET start_paper_on = ?, start_paper_ref = ?, start_paper_doc_id = ? WHERE id = ?').bind(b.on, ref, doc, o.id),
        audit(env, req.user, 'start_paper', o.id, `${o.name}: ${what} ${ref} dated ${b.on}`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bd-start-paper'); }
  }));

  // Becomes a project: the project, its approvals checklist (with CFO NOC and concessions before the IOD), the lifecycle milestones,
  // the latest feasibility study and (society) the society record. Only once the project may start (see below).
  router.post('/api/bd/opportunities/:id/convert', async (req, env) => withAuth(req, env, 'bd', 'A', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the Owner or the PM can open the project.', 403);
      const o = await load(env, req.params.id); if (!o) return bad('Not found.', 404);
      if (o.project_id) return bad('This opportunity is already a project.', 409);
      // When a project may start (Dhaval, Nov 2026): a society after the 79A process, with the appointment letter;
      // land once it is bought (sale deed); a JV or other deal once the development agreement is registered.
      let start;
      if (o.kind === 'society' || o.kind === 'land') {
        if (o.kind === 'society' && !o.override_note) {
          const list = await steps79a(env);
          const got = (await env.DB.prepare('SELECT step FROM bd_steps WHERE opportunity_id = ? AND done_on IS NOT NULL').bind(o.id).all()).results.map((x) => x.step);
          const open = list.filter((x) => !got.includes(x));
          if (open.length) return bad(`The 79A process is not complete: ${open.join('; ')}.`, 409, '79a');
        }
        if (!o.start_paper_on || !o.start_paper_doc_id) return bad(o.kind === 'society' ? "Record the society's appointment letter first." : 'Record the land purchase (registered sale deed) first.', 409, 'start_paper');
        start = [o.kind === 'society' ? 'appointment_letter' : 'land_purchase', o.start_paper_on, o.start_paper_ref, o.start_paper_doc_id];
      } else {
        if (o.stage !== 'da_registered') return bad('The development agreement must be registered first.', 409, 'da');
        start = ['da_registered', o.da_registered_on, o.da_reg_no, o.da_doc_id];
      }
      const b = await req.json();
      const code = str(b.code, 20).toUpperCase(); if (!code) return bad('Give the project a short code (used in PO numbers).');
      if (await env.DB.prepare('SELECT 1 AS x FROM projects WHERE code = ?').bind(code).first()) return bad('That project code is taken.', 409);
      const name = str(b.name, 150) || o.name; const redev = o.kind === 'society';
      const study = await env.DB.prepare('SELECT * FROM bd_studies WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1').bind(o.id).first();
      const now = nowStr();
      const p = await env.DB.prepare(`INSERT INTO projects (name, code, address, ward, city, type, status, rera_no, budget_paise, notes, created_at, members_count, plot_area_sqm, brand_id, start_basis, started_on, start_ref, start_doc_id)
        VALUES (?, ?, ?, ?, 'Mumbai', ?, 'planning', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(name, code, o.address || '', o.ward || '', redev ? 'redevelopment' : 'new_build', study && study.est_cost_paise ? study.est_cost_paise : 0,
        o.da_registered_on ? `From Business Development: DA ${o.da_reg_no || ''} registered ${o.da_registered_on}` : `From Business Development: ${start[0] === 'appointment_letter' ? 'appointment letter' : 'sale deed'} ${start[2] || ''} dated ${start[1]}`,
        now, o.members_count, o.plot_area_sqm, await defaultBrandId(env), start[0], start[1], start[2] || null, start[3] || null).run();
      const pid = p.meta.last_row_id;
      const ms = BUILD_MILESTONES.filter(([n]) => n !== 'Basement' || b.has_basement).map(([n, floor], i) => ({ n, floor, sort: (i + 1) * 10 }));
      const stmts = [
        env.DB.prepare(`INSERT INTO site_milestones (project_id, name, floor, all_wings, sort_order, created_at) SELECT ?1, json_extract(value, '$.n'), json_extract(value, '$.floor'), 1, json_extract(value, '$.sort'), ?2 FROM json_each(?3)`)
          .bind(pid, now, JSON.stringify(ms)),
        env.DB.prepare("UPDATE bd_opportunities SET project_id = ?, status = 'won', closed_at = ? WHERE id = ? AND project_id IS NULL").bind(pid, now, o.id),
        env.DB.prepare(`INSERT INTO project_members (project_id, user_id, added_by, created_at) SELECT ?, ?, ?, ? WHERE ? IS NOT NULL`).bind(pid, o.owner_user_id, req.user.user_id, now, o.owner_user_id),
        audit(env, req.user, 'convert', o.id, `${o.name} became project ${code}`),
      ];
      if (study) stmts.push(feasibilityFromStudy(env, pid, study, req.user.user_id, now));
      if (redev) stmts.push(societyForProject(env, pid, o.society_name || o.name, o.address, req.user.user_id, now));
      await env.DB.batch(stmts);
      const t = await loadMumbaiTemplate(env, pid, redev, req.user.user_id);
      return json({ ok: true, data: { project_id: pid, approvals: t.count || 0, milestones: ms.length } });
    } catch (e) { return serverError(e, 'bd-convert'); }
  }));
}
