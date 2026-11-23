// routes/projectplus.js — project profile, AutoDCR link, approval sub-steps and file movement, tasks with a person in charge, project quick view.
import { gateOf, GATE_LABEL, todayIST } from '../core/gates.js';
// Every route checks the module permission and the project the person may see. Every write is audited.

const str = (v, n = 300) => String(v == null ? '' : v).trim().slice(0, n);
const numOrNull = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

export const PLANNING_AUTHORITIES = ['MCGM (BMC)', 'SRA', 'MHADA', 'MMRDA', 'CIDCO', 'Collector', 'Other'];
export const OTHER_AUTHORITIES = ['SRA', 'MHADA', 'Estate Department (MCGM)', 'Collector', 'MMRDA', 'Cooperative Department (Registrar)', 'MCZMA (CRZ)', 'Airports Authority (Height)', 'Tree Authority', 'Fire Brigade', 'Traffic Police', 'Railways', 'Defence', 'Heritage Committee'];

// Officer designations offered in the approval drop-downs. Editable by the Owner (setting apr.designations, one per line).
// These are the titles commonly used in the building-proposal process; check the exact title on each letter with your architect.
export const DEFAULT_DESIGNATIONS = [
  'Sub Engineer (Building Proposal)', 'Assistant Engineer (Building Proposal)', 'Executive Engineer (Building Proposal)',
  'Deputy Chief Engineer (Building Proposal)', 'Chief Engineer (Development Plan)', 'Assistant Commissioner (Ward)',
  'Deputy Municipal Commissioner', 'Additional Municipal Commissioner', 'Municipal Commissioner (BMC Commissioner)',
  'Chief Fire Officer', 'Superintendent of Gardens / Tree Officer', 'Assessor and Collector', 'Hydraulic Engineer',
  'Executive Engineer (Storm Water Drains)', 'Executive Engineer (Sewerage)', 'Executive Engineer (Roads / Traffic)',
  'Executive Engineer (SRA)', 'Deputy Chief Engineer (SRA)', 'Chief Executive Officer (SRA)',
  'Executive Engineer (MHADA)', 'Chief Officer (MHADA Mumbai Board)', 'Estate Officer', 'Collector / Tahsildar',
  'Our Architect', 'Our Liaison Consultant', 'Our Advocate',
];

// Usual sub-steps for the main approvals. [title, responsible designation]. Loaded only when an approval has no steps yet.
const STEP_TEMPLATES = [
  [/\bconcession/i, [['File the concession proposal', 'Our Architect'], ['Scrutiny', 'Sub Engineer (Building Proposal)'], ['Report and recommendation', 'Assistant Engineer (Building Proposal)'],
    ['Approval at division level', 'Executive Engineer (Building Proposal)'], ['Recommendation', 'Deputy Chief Engineer (Building Proposal)'], ['Recommendation', 'Chief Engineer (Development Plan)'],
    ['Recommendation', 'Additional Municipal Commissioner'], ['Final approval of concessions', 'Municipal Commissioner (BMC Commissioner)']]],
  [/\biod\b|intimation of disapproval/i, [['Submit plans on AutoDCR', 'Our Architect'], ['Scrutiny of plans', 'Sub Engineer (Building Proposal)'], ['IOD prepared and put up', 'Assistant Engineer (Building Proposal)'],
    ['IOD approved and issued', 'Executive Engineer (Building Proposal)']]],
  [/commencement|\bcc\b|further cc/i, [['Apply with IOD compliance', 'Our Architect'], ['Site inspection and scrutiny', 'Sub Engineer (Building Proposal)'], ['CC put up', 'Assistant Engineer (Building Proposal)'],
    ['CC approved and issued', 'Executive Engineer (Building Proposal)']]],
  [/occupa|\boc\b|completion certificate|\bbcc\b/i, [['Apply with completion drawings and NOCs', 'Our Architect'], ['Site inspection', 'Sub Engineer (Building Proposal)'], ['Report put up', 'Assistant Engineer (Building Proposal)'],
    ['Certificate approved and issued', 'Executive Engineer (Building Proposal)']]],
  [/fire/i, [['Apply with fire drawings', 'Our Architect'], ['Site inspection', 'Chief Fire Officer'], ['NOC issued', 'Chief Fire Officer']]],
  [/tree/i, [['Apply with tree survey', 'Our Architect'], ['Site inspection', 'Superintendent of Gardens / Tree Officer'], ['Permission issued', 'Superintendent of Gardens / Tree Officer']]],
];

// Read latitude and longitude from a Google Maps link (several link shapes). Short links (maps.app.goo.gl) are followed once.
export function coordsFromMapsUrl(u) {
  const s = decodeURIComponent(String(u || ''));
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/];
  for (const p of pats) { const m = s.match(p); if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
  return null;
}
const MAPS_HOSTS = /^(www\.)?(google\.[a-z.]+|maps\.google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)$/i;
export function cleanMapsUrl(u) {
  let url; try { url = new URL(String(u || '').trim()); } catch (e) { return null; }
  if (url.protocol !== 'https:' || !MAPS_HOSTS.test(url.hostname)) return null;
  if (/^(www\.)?google\./i.test(url.hostname) && !url.pathname.startsWith('/maps')) return null;
  return url.toString().slice(0, 1000);
}
async function resolveCoords(url) {
  const c = coordsFromMapsUrl(url); if (c) return c;
  if (!/goo\.gl/i.test(new URL(url).hostname)) return null;
  try { // one subrequest, no body read
    const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(3000) });
    return coordsFromMapsUrl(r.headers.get('location') || '');
  } catch (e) { return null; }
}

export function registerProjectPlus(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 300), nowStr());
  const canSee = async (env, req, pid) => pid > 0 && (await visibleProjectIds(env, req.user)).includes(pid);
  const userOk = async (env, uid) => !uid || !!(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(uid).first());
  async function designations(env) {
    const v = await getSetting(env, 'apr.designations');
    const list = String(v || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    return list.length ? list : DEFAULT_DESIGNATIONS;
  }

  // ----- choices for the forms -----
  router.get('/api/projects-meta/choices', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const people = (await env.DB.prepare("SELECT id, name, role, position FROM users WHERE active = 1 AND deleted_at IS NULL AND role NOT IN ('viewer') ORDER BY name LIMIT 300").all()).results;
      return json({ ok: true, data: { planning_authorities: PLANNING_AUTHORITIES, other_authorities: OTHER_AUTHORITIES, designations: await designations(env), people } });
    } catch (e) { return serverError(e, 'pp-choices'); }
  }));

  // ----- project profile (asked when a project is created; editable later) -----
  router.put('/api/projects/:id/profile', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const pid = Number(req.params.id);
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      const members = numOrNull(b.members_count), plot = numOrNull(b.plot_area_sqm);
      if (members !== null && (members < 0 || members > 100000 || !Number.isInteger(members))) return json({ ok: false, error: 'Number of members looks wrong.' }, 400);
      if (plot !== null && (plot <= 0 || plot > 10000000)) return json({ ok: false, error: 'Plot area looks wrong.' }, 400);
      const fsiVals = {};
      for (const k of ['sanctioned_fsi', 'fungible_fsi', 'tdr_purchased']) { const v = numOrNull(b[k]); if (v !== null && !(v >= 0 && v <= 100000000)) return json({ ok: false, error: 'Check the FSI / TDR figures.' }, 400); fsiVals[k] = v; }
      const others = (Array.isArray(b.other_authorities) ? b.other_authorities : String(b.other_authorities || '').split(',')).map((x) => str(x, 60)).filter(Boolean).slice(0, 20);
      for (const k of ['property_card_doc_id', 'conveyance_doc_id']) {
        const d = numOrNull(b[k]);
        if (d && !(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL AND (project_id = ? OR project_id IS NULL)').bind(d, pid).first())) return json({ ok: false, error: 'That file was not found in this project.' }, 400);
      }
      let maps = null, coords = null;
      if (b.maps_url !== undefined && str(b.maps_url)) {
        maps = cleanMapsUrl(b.maps_url);
        if (!maps) return json({ ok: false, error: 'Paste the link from Google Maps (Share → Copy link).' }, 400);
        coords = await resolveCoords(maps);
      }
      const set = { members_count: members, plot_area_sqm: plot, planning_authority: str(b.planning_authority, 60) || null, other_authorities: others.length ? JSON.stringify(others) : null,
        cts_no: str(b.cts_no, 120) || null, village: str(b.village, 120) || null, ward: str(b.ward, 40) || null, property_card_details: str(b.property_card_details, 1000) || null,
        property_card_doc_id: numOrNull(b.property_card_doc_id), conveyance_details: str(b.conveyance_details, 1000) || null, conveyance_doc_id: numOrNull(b.conveyance_doc_id), extra_info: str(b.extra_info, 2000) || null,
        dcpr_regulation: str(b.dcpr_regulation, 60) || null, ...fsiVals };
      const keys = Object.keys(set).filter((k) => b[k] !== undefined);
      const cols = keys.map((k) => `${k} = ?`); const vals = keys.map((k) => set[k]);
      if (maps) { cols.push('maps_url = ?', 'lat = ?', 'lng = ?'); vals.push(maps, coords ? coords.lat : null, coords ? coords.lng : null); }
      if (!cols.length) return json({ ok: true, data: { id: pid } });
      await env.DB.batch([
        env.DB.prepare(`UPDATE projects SET ${cols.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...vals, pid),
        audit(env, req.user, 'edit', 'projects', pid, `Project details updated${maps ? ' (site location link)' : ''}`),
      ]);
      return json({ ok: true, data: { id: pid, location_found: maps ? !!coords : undefined } });
    } catch (e) { return serverError(e, 'pp-profile'); }
  }));

  // ----- AutoDCR link: Owner sets it; it can be corrected (history kept) but never removed -----
  router.post('/api/projects/:id/autodcr', async (req, env) => withAuth(req, env, 'approvals', 'V', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can set the AutoDCR link.' }, 403);
      const pid = Number(req.params.id);
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json(); let url;
      try { url = new URL(str(b.url, 1000)); } catch (e) { return json({ ok: false, error: 'Paste the full AutoDCR link (it starts with https://). It cannot be left empty.' }, 400); }
      if (url.protocol !== 'https:') return json({ ok: false, error: 'The link must start with https://' }, 400);
      const p = await env.DB.prepare('SELECT autodcr_url FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid).first();
      if (!p) return json({ ok: false, error: 'Project not found.' }, 404);
      const reason = str(b.reason, 200);
      if (p.autodcr_url && !reason) return json({ ok: false, error: 'Say why the link is being corrected. The old link is kept in the history.' }, 400);
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare('UPDATE projects SET autodcr_url = ?, autodcr_set_by = ?, autodcr_set_at = ? WHERE id = ?').bind(url.toString(), req.user.user_id, now, pid),
        env.DB.prepare('INSERT INTO prj_autodcr_history (project_id, url, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?)').bind(pid, url.toString(), reason || 'First set', req.user.user_id, now),
        audit(env, req.user, p.autodcr_url ? 'correct' : 'create', 'projects', pid, p.autodcr_url ? `AutoDCR link corrected: ${reason}` : 'AutoDCR link set'),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-autodcr'); }
  }));

  router.get('/api/projects/:id/autodcr', async (req, env) => withAuth(req, env, 'approvals', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id);
      if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const [p, hist] = await env.DB.batch([
        env.DB.prepare('SELECT p.autodcr_url, p.autodcr_set_at, u.name AS set_by_name FROM projects p LEFT JOIN users u ON u.id = p.autodcr_set_by WHERE p.id = ?').bind(pid),
        env.DB.prepare('SELECT h.url, h.reason, h.set_at, u.name AS set_by_name FROM prj_autodcr_history h LEFT JOIN users u ON u.id = h.set_by WHERE h.project_id = ? ORDER BY h.id DESC LIMIT 20').bind(pid),
      ]);
      return json({ ok: true, data: { ...(p.results[0] || {}), history: hist.results } });
    } catch (e) { return serverError(e, 'pp-autodcr-get'); }
  }));

  // ----- approval: where the file is, who has it next, who chases it and by when -----
  const loadItem = async (env, req, id) => {
    const it = await env.DB.prepare('SELECT * FROM apr_items WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    return it && (await canSee(env, req, it.project_id)) ? it : null;
  };

  router.put('/api/approvals/:id/file', async (req, env) => withAuth(req, env, 'approvals', 'E', async (req, env) => {
    try {
      const it = await loadItem(env, req, Number(req.params.id));
      if (!it) return json({ ok: false, error: 'Approval not found.' }, 404);
      const b = await req.json();
      if (b.target_date && !isDate(b.target_date)) return json({ ok: false, error: 'Pick the expected date.' }, 400);
      const owner = numOrNull(b.owner_user_id);
      if (!(await userOk(env, owner))) return json({ ok: false, error: 'Pick a person from the list.' }, 400);
      const holder = str(b.holder_designation, 120), next = str(b.next_designation, 120);
      const moved = holder && holder !== (it.holder_designation || '');
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare(`UPDATE apr_items SET holder_designation = ?, holder_name = ?, next_designation = ?, next_name = ?, target_date = COALESCE(?, target_date), owner_user_id = COALESCE(?, owner_user_id)${moved ? ', file_moved_at = ?' : ''} WHERE id = ?`)
          .bind(holder || null, str(b.holder_name, 120) || null, next || null, str(b.next_name, 120) || null, b.target_date || null, owner, ...(moved ? [now] : []), it.id),
        env.DB.prepare('INSERT INTO apr_events (item_id, event, note, by_user, created_at) VALUES (?, ?, ?, ?, ?)').bind(it.id, 'file_moved', `File with: ${holder || '—'}${b.holder_name ? ' (' + str(b.holder_name, 120) + ')' : ''}. Next: ${next || '—'}`, req.user.user_id, now),
        audit(env, req.user, 'event', 'apr_items', it.id, `File position updated: with ${holder || '—'}, next ${next || '—'}`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-file'); }
  }));

  // What kind of approval this is, which wing it covers, and which approvals must come first.
  router.put('/api/approvals/:id/gate', async (req, env) => withAuth(req, env, 'approvals', 'E', async (req, env) => {
    try {
      const it = await loadItem(env, req, Number(req.params.id));
      if (!it) return json({ ok: false, error: 'Approval not found.' }, 404);
      const b = await req.json();
      const gate = b.gate_key === '' || b.gate_key == null ? null : String(b.gate_key);
      if (gate && !GATE_LABEL[gate]) return json({ ok: false, error: 'Unknown approval type.' }, 400);
      const deps = Array.isArray(b.depends_on) ? [...new Set(b.depends_on.map(Number).filter((x) => x > 0 && x !== it.id))].slice(0, 30) : null;
      if (deps && deps.length) {
        const ok = (await env.DB.prepare('SELECT COUNT(*) AS n FROM apr_items WHERE project_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(it.project_id, JSON.stringify(deps)).first()).n;
        if (ok !== deps.length) return json({ ok: false, error: 'Pick approvals from this project only.' }, 400);
        // no loops: none of the chosen approvals may (directly or further back) depend on this one
        const loop = await env.DB.prepare(`WITH RECURSIVE up(id) AS (SELECT value FROM json_each(?1) UNION SELECT d.depends_on_id FROM apr_deps d JOIN up ON d.item_id = up.id) SELECT 1 AS x FROM up WHERE id = ?2 LIMIT 1`).bind(JSON.stringify(deps), it.id).first();
        if (loop) return json({ ok: false, error: 'That would make the approvals wait for each other in a circle.' }, 400);
      }
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare('UPDATE apr_items SET gate_key = ?, wing = ? WHERE id = ?').bind(gate, String(b.wing || '').trim().slice(0, 20) || null, it.id),
        ...(deps ? [env.DB.prepare('DELETE FROM apr_deps WHERE item_id = ?').bind(it.id), env.DB.prepare('INSERT OR IGNORE INTO apr_deps (item_id, depends_on_id, created_by, created_at) SELECT ?, value, ?, ? FROM json_each(?)').bind(it.id, req.user.user_id, now, JSON.stringify(deps))] : []),
        audit(env, req.user, 'edit', 'apr_items', it.id, `${it.name}: type ${gate ? GATE_LABEL[gate] : 'none'}${deps ? `, needs ${deps.length} approval(s) first` : ''}`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-gate'); }
  }));

  router.get('/api/approvals/:id/steps', async (req, env) => withAuth(req, env, 'approvals', 'V', async (req, env) => {
    try {
      const it = await loadItem(env, req, Number(req.params.id));
      if (!it) return json({ ok: false, error: 'Approval not found.' }, 404);
      const [steps, owner, deps, others] = await env.DB.batch([
        env.DB.prepare('SELECT s.*, u.name AS assigned_name FROM apr_steps s LEFT JOIN users u ON u.id = s.assigned_to WHERE s.item_id = ? AND s.deleted_at IS NULL ORDER BY s.seq, s.id').bind(it.id),
        env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(it.owner_user_id || 0),
        env.DB.prepare('SELECT a.id, a.name, a.status FROM apr_deps d JOIN apr_items a ON a.id = d.depends_on_id WHERE d.item_id = ? AND a.deleted_at IS NULL ORDER BY a.stage_order').bind(it.id),
        env.DB.prepare('SELECT id, name FROM apr_items WHERE project_id = ? AND deleted_at IS NULL AND id != ? ORDER BY stage_order, name LIMIT 200').bind(it.project_id, it.id),
      ]);
      return json({ ok: true, data: { item: { ...it, owner_name: owner.results[0] ? owner.results[0].name : null, gate: gateOf(it) }, depends_on: deps.results, others: others.results, gate_labels: GATE_LABEL, steps: steps.results, has_template: STEP_TEMPLATES.some(([re]) => re.test(it.name)) } });
    } catch (e) { return serverError(e, 'pp-steps'); }
  }));

  router.post('/api/approvals/:id/steps', async (req, env) => withAuth(req, env, 'approvals', 'C', async (req, env) => {
    try {
      const it = await loadItem(env, req, Number(req.params.id));
      if (!it) return json({ ok: false, error: 'Approval not found.' }, 404);
      const b = await req.json(); const now = nowStr();
      if (b.template) {
        const tpl = STEP_TEMPLATES.find(([re]) => re.test(it.name));
        if (!tpl) return json({ ok: false, error: 'There are no usual steps for this approval. Add the steps one by one.' }, 400);
        const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM apr_steps WHERE item_id = ? AND deleted_at IS NULL').bind(it.id).first();
        if (have.n > 0) return json({ ok: false, error: 'This approval already has steps.' }, 400);
        await env.DB.batch([...tpl[1].map(([t, d], i) => env.DB.prepare('INSERT INTO apr_steps (item_id, project_id, seq, title, responsible_designation, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(it.id, it.project_id, (i + 1) * 10, t.toUpperCase(), d, req.user.user_id, now)), audit(env, req.user, 'create', 'apr_steps', it.id, `Usual steps loaded for ${it.name}`)]);
        return json({ ok: true, data: { count: tpl[1].length } });
      }
      const title = str(b.title, 200).toUpperCase();
      if (!title) return json({ ok: false, error: 'Say what the step is.' }, 400);
      if (b.target_date && !isDate(b.target_date)) return json({ ok: false, error: 'Pick the expected date.' }, 400);
      const assigned = numOrNull(b.assigned_to);
      if (!(await userOk(env, assigned))) return json({ ok: false, error: 'Pick a person from the list.' }, 400);
      const last = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM apr_steps WHERE item_id = ? AND deleted_at IS NULL').bind(it.id).first();
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO apr_steps (item_id, project_id, seq, title, responsible_designation, responsible_name, assigned_to, target_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(it.id, it.project_id, last.s + 10, title, str(b.responsible_designation, 120) || null, str(b.responsible_name, 120) || null, assigned, b.target_date || null, req.user.user_id, now),
        audit(env, req.user, 'create', 'apr_steps', it.id, `Step added to ${it.name}: ${title}`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'pp-step-add'); }
  }));

  router.put('/api/approval-steps/:id', async (req, env) => withAuth(req, env, 'approvals', 'E', async (req, env) => {
    try {
      const s = await env.DB.prepare('SELECT * FROM apr_steps WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!s || !(await canSee(env, req, s.project_id))) return json({ ok: false, error: 'Step not found.' }, 404);
      const b = await req.json();
      const status = b.status !== undefined ? String(b.status) : s.status;
      if (!['pending', 'in_progress', 'done', 'na'].includes(status)) return json({ ok: false, error: 'Unknown status.' }, 400);
      if (b.target_date && !isDate(b.target_date)) return json({ ok: false, error: 'Pick the expected date.' }, 400);
      const assigned = b.assigned_to !== undefined ? numOrNull(b.assigned_to) : s.assigned_to;
      if (!(await userOk(env, assigned))) return json({ ok: false, error: 'Pick a person from the list.' }, 400);
      const pick = (k, n) => (b[k] !== undefined ? (str(b[k], n) || null) : s[k]);
      const doneOn = status === 'done' ? (s.done_on || todayIST()) : null;
      await env.DB.batch([
        env.DB.prepare('UPDATE apr_steps SET title = ?, responsible_designation = ?, responsible_name = ?, assigned_to = ?, target_date = ?, status = ?, done_on = ?, note = ? WHERE id = ?')
          .bind((pick('title', 200) || s.title).toUpperCase(), pick('responsible_designation', 120), pick('responsible_name', 120), assigned, b.target_date !== undefined ? (b.target_date || null) : s.target_date, status, doneOn, pick('note', 300), s.id),
        audit(env, req.user, 'edit', 'apr_steps', s.id, `Step ${s.title}: ${status}`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-step-edit'); }
  }));

  // ----- tasks: one list of open work with the person in charge and the expected date -----
  // Kinds: approval, step, milestone, snag, meeting. Small pages; every column used is indexed.
  async function openTasks(env, ids, onlyPid, mine) {
    const P = onlyPid ? [onlyPid] : ids.slice(0, 90);
    if (!P.length) return [];
    const inP = `IN (${P.map(() => '?').join(',')})`;
    const w = (col) => (mine ? ` AND ${col} = ?` : '');
    const args = (extra) => [...P, ...(mine ? [mine] : []), ...(extra || [])];
    const [a, s, m, n, g, q] = await env.DB.batch([
      env.DB.prepare(`SELECT 'approval' AS kind, i.id, i.project_id, i.name AS title, i.status, i.target_date AS due, i.owner_user_id AS user_id, u.name AS in_charge, i.holder_designation AS detail
        FROM apr_items i LEFT JOIN users u ON u.id = i.owner_user_id WHERE i.deleted_at IS NULL AND i.project_id ${inP} AND (i.status IN ('applied', 'query', 'in_progress') OR (i.status = 'not_started' AND (i.owner_user_id IS NOT NULL OR i.target_date IS NOT NULL)))${w('i.owner_user_id')} ORDER BY i.target_date IS NULL, i.target_date LIMIT 30`).bind(...args()),
      env.DB.prepare(`SELECT 'step' AS kind, s.id, s.project_id, s.title || ' · ' || i.name AS title, s.status, s.target_date AS due, s.assigned_to AS user_id, u.name AS in_charge, s.responsible_designation AS detail, s.item_id
        FROM apr_steps s JOIN apr_items i ON i.id = s.item_id LEFT JOIN users u ON u.id = s.assigned_to WHERE s.deleted_at IS NULL AND s.project_id ${inP} AND s.status IN ('pending', 'in_progress')${w('s.assigned_to')} ORDER BY s.status = 'pending', s.target_date IS NULL, s.target_date LIMIT 30`).bind(...args()),
      env.DB.prepare(`SELECT 'milestone' AS kind, m.id, m.project_id, m.name || COALESCE(' · ' || m.wing, '') AS title, m.status, m.planned_date AS due, m.assigned_to AS user_id, u.name AS in_charge, NULL AS detail
        FROM site_milestones m LEFT JOIN users u ON u.id = m.assigned_to WHERE m.deleted_at IS NULL AND m.project_id ${inP} AND m.status != 'done'${w('m.assigned_to')} ORDER BY m.planned_date IS NULL, m.planned_date LIMIT 20`).bind(...args()),
      env.DB.prepare(`SELECT 'snag' AS kind, s.id, s.project_id, s.title, s.status, s.due_date AS due, s.assigned_to AS user_id, u.name AS in_charge, s.severity AS detail
        FROM site_snags s LEFT JOIN users u ON u.id = s.assigned_to WHERE s.deleted_at IS NULL AND s.project_id ${inP} AND s.status = 'open'${w('s.assigned_to')} ORDER BY s.due_date IS NULL, s.due_date LIMIT 20`).bind(...args()),
      env.DB.prepare(`SELECT 'meeting' AS kind, mt.id, so.project_id, mt.next_action AS title, 'pending' AS status, mt.next_action_due AS due, mt.next_action_owner AS user_id, u.name AS in_charge, so.name AS detail
        FROM red_meetings mt JOIN red_societies so ON so.id = mt.society_id LEFT JOIN users u ON u.id = mt.next_action_owner
        WHERE mt.deleted_at IS NULL AND so.deleted_at IS NULL AND so.project_id ${inP} AND mt.next_action_done = 0 AND COALESCE(mt.next_action, '') != ''${w('mt.next_action_owner')} ORDER BY mt.next_action_due IS NULL, mt.next_action_due LIMIT 10`).bind(...args()),
      env.DB.prepare(`SELECT 'ncr' AS kind, q.id, q.project_id, q.title, q.status, q.due_date AS due, q.assigned_to AS user_id, u.name AS in_charge, q.source AS detail
        FROM qa_ncrs q LEFT JOIN users u ON u.id = q.assigned_to WHERE q.project_id ${inP} AND q.status = 'open'${w('q.assigned_to')} ORDER BY q.due_date IS NULL, q.due_date LIMIT 20`).bind(...args()),
    ]);
    return [...a.results, ...s.results, ...m.results, ...n.results, ...g.results, ...q.results];
  }

  router.get('/api/tasks', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const pid = Number(q.get('project_id')) || 0;
      const ids = await visibleProjectIds(env, req.user);
      if (pid && !ids.includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const tasks = await openTasks(env, ids, pid, q.get('mine') ? req.user.user_id : 0);
      const today = todayIST();
      tasks.forEach((t) => { t.late = !!(t.due && t.due < today); });
      tasks.sort((x, y) => (x.due || '9999') < (y.due || '9999') ? -1 : 1);
      return json({ ok: true, data: { tasks } });
    } catch (e) { return serverError(e, 'pp-tasks'); }
  }));

  // Set the person in charge and the expected completion date on any task.
  const TASK = {
    approval: ['apr_items', 'owner_user_id', 'target_date', 'project_id', 'approvals'],
    step: ['apr_steps', 'assigned_to', 'target_date', 'project_id', 'approvals'],
    milestone: ['site_milestones', 'assigned_to', 'planned_date', 'project_id', 'site'],
    snag: ['site_snags', 'assigned_to', 'due_date', 'project_id', 'site'],
    ncr: ['qa_ncrs', 'assigned_to', 'due_date', 'project_id', 'site'],
  };
  router.post('/api/tasks/assign', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const b = await req.json(); const id = Number(b.id); const uid = numOrNull(b.assigned_to);
      if (b.due && !isDate(b.due)) return json({ ok: false, error: 'Pick the expected completion date.' }, 400);
      if (!uid) return json({ ok: false, error: 'Pick the person in charge.' }, 400);
      if (!(await userOk(env, uid))) return json({ ok: false, error: 'Pick a person from the list.' }, 400);
      if (['viewer', 'site'].includes(req.user.role) && b.kind !== 'snag') return json({ ok: false, error: 'Ask the PM to change who is in charge.' }, 403);
      let pid;
      if (b.kind === 'meeting') {
        const r = await env.DB.prepare('SELECT so.project_id FROM red_meetings mt JOIN red_societies so ON so.id = mt.society_id WHERE mt.id = ? AND mt.deleted_at IS NULL').bind(id).first();
        pid = r && r.project_id;
        if (!pid || !(await canSee(env, req, pid))) return json({ ok: false, error: 'Not found.' }, 404);
        await env.DB.batch([env.DB.prepare('UPDATE red_meetings SET next_action_owner = ?, next_action_due = COALESCE(?, next_action_due) WHERE id = ?').bind(uid, b.due || null, id),
          audit(env, req.user, 'assign', 'red_meetings', id, 'Next action: person in charge set')]);
        return json({ ok: true });
      }
      const t = TASK[b.kind]; if (!t) return json({ ok: false, error: 'Unknown task.' }, 400);
      const row = await env.DB.prepare(`SELECT ${t[3]} AS pid FROM ${t[0]} WHERE id = ?${t[0] === 'qa_ncrs' ? " AND status = 'open'" : ' AND deleted_at IS NULL'}`).bind(id).first();
      if (!row || !(await canSee(env, req, row.pid))) return json({ ok: false, error: 'Not found.' }, 404);
      await env.DB.batch([env.DB.prepare(`UPDATE ${t[0]} SET ${t[1]} = ?, ${t[2]} = COALESCE(?, ${t[2]}) WHERE id = ?`).bind(uid, b.due || null, id),
        audit(env, req.user, 'assign', t[0], id, 'Person in charge and expected date set')]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-assign'); }
  }));

  // ----- wing on hold (redesign, stay order, dispute): stops certifying, pouring and selling in that wing -----
  router.get('/api/projects/:id/holds', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id); if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const rows = (await env.DB.prepare('SELECT h.*, u.name AS held_by_name, r.name AS released_by_name FROM prj_holds h LEFT JOIN users u ON u.id = h.held_by LEFT JOIN users r ON r.id = h.released_by WHERE h.project_id = ? ORDER BY h.released_at IS NOT NULL, h.id DESC LIMIT 50').bind(pid).all()).results;
      return json({ ok: true, data: { holds: rows } });
    } catch (e) { return serverError(e, 'pp-holds'); }
  }));
  router.post('/api/projects/:id/holds', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Only the PM or the Owner can put work on hold.' }, 403);
      const pid = Number(req.params.id); if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json(); const reason = str(b.reason, 300); const wing = str(b.wing, 20) || null;
      if (!reason) return json({ ok: false, error: 'Say why (redesign, stay order, dispute...).' }, 400);
      if (await env.DB.prepare('SELECT 1 AS x FROM prj_holds WHERE project_id = ? AND released_at IS NULL AND COALESCE(wing, \'\') = COALESCE(?, \'\')').bind(pid, wing).first()) return json({ ok: false, error: 'It is already on hold.' }, 409);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO prj_holds (project_id, wing, reason, held_by, held_at) VALUES (?, ?, ?, ?, ?)').bind(pid, wing, reason, req.user.user_id, now),
        env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'projects', ? FROM users WHERE role IN ('owner', 'pm', 'sales', 'site') AND active = 1 AND deleted_at IS NULL AND id != ? ORDER BY role = 'owner' DESC, id IN (SELECT user_id FROM project_members WHERE project_id = ?) DESC, id DESC LIMIT 40")
          .bind(`On hold: ${wing ? 'wing ' + wing : 'whole project'}`, `${reason}. No certifying, pouring or booking there until released.`, now, req.user.user_id, pid),
        audit(env, req.user, 'hold', 'projects', pid, `Put ${wing ? 'wing ' + wing : 'the project'} on hold: ${reason}`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'pp-hold'); }
  }));
  router.post('/api/holds/:id/release', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Only the PM or the Owner can release a hold.' }, 403);
      const h = await env.DB.prepare('SELECT * FROM prj_holds WHERE id = ?').bind(Number(req.params.id)).first();
      if (!h || !(await canSee(env, req, h.project_id))) return json({ ok: false, error: 'Not found.' }, 404);
      const b = await req.json().catch(() => ({})); const note = str(b.note, 300);
      if (!note) return json({ ok: false, error: 'Say why it is released.' }, 400);
      const r = await env.DB.prepare('UPDATE prj_holds SET released_by = ?, released_at = ?, release_note = ? WHERE id = ? AND released_at IS NULL').bind(req.user.user_id, nowStr(), note, h.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Already released.' }, 409);
      await audit(env, req.user, 'release', 'projects', h.project_id, `Hold released (${h.wing ? 'wing ' + h.wing : 'project'}): ${note}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-release'); }
  }));

  // ----- milestone dates: a baseline fixed once, then every change has a reason -----
  const SLIP = ['monsoon', 'approvals', 'contractor', 'material', 'funds', 'design', 'other'];
  router.post('/api/projects/:id/baseline', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      const pid = Number(req.params.id); if (!(await canSee(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const res = await env.DB.batch([
        env.DB.prepare('UPDATE site_milestones SET baseline_date = planned_date WHERE project_id = ? AND deleted_at IS NULL AND baseline_date IS NULL AND planned_date IS NOT NULL').bind(pid),
        audit(env, req.user, 'baseline', 'projects', pid, 'Milestone dates fixed as the baseline'),
      ]);
      return json({ ok: true, data: { fixed: res[0].meta.changes || 0 } });
    } catch (e) { return serverError(e, 'pp-baseline'); }
  }));
  router.post('/api/site/milestones/:id/reschedule', async (req, env) => withAuth(req, env, 'site', 'A', async (req, env) => {
    try {
      const m = await env.DB.prepare('SELECT * FROM site_milestones WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!m || !(await canSee(env, req, m.project_id))) return json({ ok: false, error: 'Milestone not found.' }, 404);
      if (m.status === 'done') return json({ ok: false, error: 'A certified milestone has its date.' }, 409);
      const b = await req.json();
      if (!isDate(b.planned_date)) return json({ ok: false, error: 'Pick the new expected date.' }, 400);
      if (!SLIP.includes(b.reason)) return json({ ok: false, error: 'Pick why the date changed.' }, 400);
      if (b.planned_date === m.planned_date) return json({ ok: false, error: 'That is the same date.' }, 400);
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare('UPDATE site_milestones SET planned_date = ?, baseline_date = COALESCE(baseline_date, ?) WHERE id = ?').bind(b.planned_date, m.planned_date, m.id),
        env.DB.prepare('INSERT INTO site_ms_changes (milestone_id, old_date, new_date, reason, note, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(m.id, m.planned_date, b.planned_date, b.reason, str(b.note, 300) || null, req.user.user_id, now),
        audit(env, req.user, 'reschedule', 'site_milestones', m.id, `${m.name}: ${m.planned_date || 'no date'} → ${b.planned_date} (${b.reason})`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pp-resched'); }
  }));
  router.get('/api/site/milestones/:id/changes', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const m = await env.DB.prepare('SELECT project_id FROM site_milestones WHERE id = ?').bind(Number(req.params.id)).first();
      if (!m || !(await canSee(env, req, m.project_id))) return json({ ok: false, error: 'Milestone not found.' }, 404);
      const rows = (await env.DB.prepare('SELECT c.*, u.name AS by_name FROM site_ms_changes c LEFT JOIN users u ON u.id = c.changed_by WHERE c.milestone_id = ? ORDER BY c.id').bind(Number(req.params.id)).all()).results;
      return json({ ok: true, data: { changes: rows } });
    } catch (e) { return serverError(e, 'pp-ms-changes'); }
  }));

  // ----- project quick view: details, where it stands, open work and who is on it -----
  router.get('/api/projects/:id/overview', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const [p, apr, soc, sales, current, holds] = await env.DB.batch([
        env.DB.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid),
        env.DB.prepare("SELECT status, COUNT(*) AS n FROM apr_items WHERE project_id = ? AND deleted_at IS NULL GROUP BY status").bind(pid),
        env.DB.prepare(`SELECT s.id, s.name, COUNT(m.id) AS members, COALESCE(SUM(m.consent_status = 'consented'), 0) AS consented
          FROM red_societies s LEFT JOIN red_members m ON m.society_id = s.id AND m.deleted_at IS NULL WHERE s.project_id = ? AND s.deleted_at IS NULL GROUP BY s.id LIMIT 1`).bind(pid),
        env.DB.prepare("SELECT COUNT(*) AS units, COALESCE(SUM(status IN ('booked', 'possessed', 'sold')), 0) AS sold FROM sal_inventory WHERE project_id = ? AND deleted_at IS NULL").bind(pid),
        env.DB.prepare(`SELECT i.id, i.name, i.status, i.holder_designation, i.next_designation, i.target_date, u.name AS in_charge FROM apr_items i LEFT JOIN users u ON u.id = i.owner_user_id
          WHERE i.project_id = ? AND i.deleted_at IS NULL AND i.status IN ('applied', 'query', 'in_progress') ORDER BY i.stage_order LIMIT 3`).bind(pid),
        env.DB.prepare('SELECT id, wing, reason, held_at FROM prj_holds WHERE project_id = ? AND released_at IS NULL').bind(pid),
      ]);
      const project = p.results[0];
      if (!project) return json({ ok: false, error: 'Project not found.' }, 404);
      const tasks = await openTasks(env, ids, pid, 0);
      const today = todayIST();
      tasks.forEach((t) => { t.late = !!(t.due && t.due < today); });
      tasks.sort((x, y) => (x.due || '9999') < (y.due || '9999') ? -1 : 1);
      const counts = Object.fromEntries(apr.results.map((r) => [r.status, r.n]));
      const total = apr.results.reduce((t, r) => t + r.n, 0);
      return json({ ok: true, data: { project, approvals: { total, approved: counts.approved || 0, in_progress: (counts.applied || 0) + (counts.query || 0) + (counts.in_progress || 0), query: counts.query || 0, current: current.results },
        society: soc.results[0] || null, sales: sales.results[0] || null, holds: holds.results, tasks: tasks.slice(0, 40) } });
    } catch (e) { return serverError(e, 'pp-overview'); }
  }));

  // ---------- Project life cycle: from the registered DA to the OC, in the usual Mumbai order ----------
  // Read from approvals, society members, site milestones, bookings and the Business Development deal; the few steps that live nowhere else
  // (designs finalised, vacating notice, demolition...) are ticked here. Targets: plinth CC = vacating + N months; OC = plinth CC + M months (settings).
  const addMonths = (d, m) => { if (!d) return null; const x = new Date(d.slice(0, 10) + 'T00:00:00Z'); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
  const LC_MANUAL = { da_registered: 'Development agreement registered', designs: 'Designs finalised', vacating_notice: 'Vacating notice issued', vacating: 'Vacating complete', demolition: 'Old building demolished' };
  const d10 = (v) => (v ? String(v).slice(0, 10) : null);
  async function lifecycle(env, pid) {
    const [pr, apr, mem, ms, bk, bd, man] = await env.DB.batch([
      env.DB.prepare('SELECT id, name, type, rera_no FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid),
      env.DB.prepare('SELECT id, name, category, gate_key, status, approved_on, letter_date FROM apr_items WHERE project_id = ? AND deleted_at IS NULL').bind(pid),
      env.DB.prepare(`SELECT COUNT(m.id) AS total, COALESCE(SUM(m.paaa_reg_date IS NOT NULL), 0) AS paaa, MAX(m.paaa_reg_date) AS paaa_last, COALESCE(SUM(m.vacated_on IS NOT NULL), 0) AS gone, MAX(m.vacated_on) AS gone_last
        FROM red_societies s JOIN red_members m ON m.society_id = s.id AND m.deleted_at IS NULL WHERE s.project_id = ? AND s.deleted_at IS NULL`).bind(pid),
      env.DB.prepare("SELECT name, floor, status, actual_date FROM site_milestones WHERE project_id = ? AND deleted_at IS NULL AND (floor IS NULL OR floor <= 0)").bind(pid),
      env.DB.prepare("SELECT MIN(COALESCE(booking_date, substr(created_at, 1, 10))) AS first FROM sal_bookings WHERE project_id = ? AND deleted_at IS NULL AND status != 'cancelled'").bind(pid),
      env.DB.prepare('SELECT id, name, da_registered_on, da_reg_no FROM bd_opportunities WHERE project_id = ? LIMIT 1').bind(pid),
      env.DB.prepare('SELECT step, done_on, note, override_note FROM prj_lifecycle WHERE project_id = ?').bind(pid),
    ]);
    const p = pr.results[0]; if (!p) return null;
    const society = p.type === 'redevelopment';
    const items = apr.results.map((i) => ({ ...i, gate: gateOf(i), on: d10(i.letter_date || i.approved_on) }));
    const manual = Object.fromEntries(man.results.map((r) => [r.step, r]));
    const m = mem.results[0] || { total: 0 };
    const deal = bd.results[0] || null;
    const today = todayIST();
    const vacMonths = Number(await getSetting(env, 'bd.vacate_to_plinth_months')) || 7;
    const doneMonths = Number(await getSetting(env, 'bd.completion_months')) || 36;
    // one approval kind: done when every matching item is approved (date = the last approval)
    const apr1 = (test) => { const l = items.filter((i) => i.status !== 'na' && test(i)); if (!l.length) return { missing: true }; const ok = l.filter((i) => i.status === 'approved'); return { done: ok.length === l.length, on: ok.length === l.length ? ok.map((i) => i.on).filter(Boolean).sort().pop() || null : null, detail: l.length > 1 ? `${ok.length} of ${l.length} approved` : null }; };
    const msOf = (re) => { const l = ms.results.filter((x) => re.test(x.name || '')); if (!l.length) return { missing: true }; const ok = l.filter((x) => x.status === 'done'); return { done: ok.length === l.length, on: ok.length === l.length ? ok.map((x) => d10(x.actual_date)).filter(Boolean).sort().pop() || null : null, detail: l.length > 1 ? `${ok.length} of ${l.length} done` : null }; };
    const man1 = (k) => (manual[k] && manual[k].done_on ? { done: true, on: manual[k].done_on, detail: manual[k].note || null } : { done: false, manual: true });
    const isCfo = (i) => /\bcfo\b|fire noc|fire brigade/i.test(i.name) && i.gate !== 'fire_final';
    const plinthCc = apr1((i) => i.gate === 'cc'); // in Mumbai the first CC covers work up to plinth
    const steps = [];
    const add = (key, label, st, extra = {}) => steps.push({ key, label, ...st, ...extra });
    add('da_registered', 'Development agreement registered', deal && deal.da_registered_on ? { done: true, on: deal.da_registered_on, detail: deal.da_reg_no } : man1('da_registered'), { phase: 'Business development' });
    add('designs', 'Designs finalised', man1('designs'), { phase: 'Design and approvals' });
    add('cfo', 'CFO (fire) NOC', apr1(isCfo), { phase: 'Design and approvals' });
    add('concessions', 'Concessions', apr1((i) => /concession/i.test(i.name)), { phase: 'Design and approvals' });
    add('iod', 'IOD', apr1((i) => i.gate === 'iod'), { phase: 'Design and approvals' });
    if (society) {
      add('paaa', 'PAAA signed with all members', m.total ? { done: m.paaa === m.total, on: m.paaa === m.total ? d10(m.paaa_last) : null, detail: `${m.paaa} of ${m.total} registered` } : { missing: true }, { phase: 'Members and vacating' });
      add('vacating_notice', 'Vacating notice issued', man1('vacating_notice'), { phase: 'Members and vacating' });
      add('vacating', 'Vacating complete', m.total ? { done: m.gone === m.total, on: m.gone === m.total ? d10(m.gone_last) : null, detail: `${m.gone} of ${m.total} vacated` } : { missing: true }, { phase: 'Members and vacating' });
    } else add('vacating', 'Site vacant / possession of land', man1('vacating'), { phase: 'Members and vacating' });
    add('demolition', 'Old building demolished', man1('demolition'), { phase: 'Members and vacating', optional: !society });
    add('nocs', 'NOCs for plinth CC', apr1((i) => i.category === 'noc' && !isCfo(i) && i.gate !== 'fire_final' && !/completion|occupa|lift|electric/i.test(i.name)), { phase: 'Commencement' });
    const vac = steps.find((x) => x.key === 'vacating');
    add('plinth_cc', 'Plinth CC (commencement)', plinthCc, { phase: 'Commencement', target: vac && vac.on ? addMonths(vac.on, vacMonths) : null, target_note: `${vacMonths} months from vacating` });
    add('rera', 'MahaRERA registration', p.rera_no && String(p.rera_no).trim() ? { done: true, on: apr1((i) => i.gate === 'rera_reg').on || null, detail: p.rera_no } : { done: false }, { phase: 'Commencement', note: 'Apply after the CC' });
    add('sales', 'Sales and marketing started', bk.results[0] && bk.results[0].first ? { done: true, on: d10(bk.results[0].first), detail: 'first booking' } : { done: false }, { phase: 'Commencement' });
    add('excavation', 'Excavation', msOf(/excavat/i), { phase: 'Construction' });
    add('foundation', 'Foundation', msOf(/foundation|footing|piling|raft/i), { phase: 'Construction' });
    const base = msOf(/basement/i); if (!base.missing) add('basement', 'Basement', base, { phase: 'Construction' });
    add('plinth', 'Plinth', msOf(/plinth/i), { phase: 'Construction' });
    add('further_cc', 'Further CC (above plinth)', apr1((i) => i.gate === 'plinth_cc' || i.gate === 'further_cc'), { phase: 'Construction' });
    add('oc', 'Occupation certificate (OC)', apr1((i) => i.gate === 'oc'), { phase: 'Completion', target: plinthCc.on ? addMonths(plinthCc.on, doneMonths) : null, target_note: `${doneMonths} months from plinth CC` });
    for (const x of steps) { x.done = !!x.done; x.late = !!(x.target && !x.done && x.target < today); if (x.manual === undefined) x.manual = !!LC_MANUAL[x.key] && !(x.key === 'da_registered' && deal) && !(x.key === 'vacating' && society); }
    const next = steps.find((x) => !x.done && !x.optional);
    return { project: { id: p.id, name: p.name, society }, steps, next: next ? next.key : null, deal: deal ? { id: deal.id, name: deal.name } : null, settings: { vacate_to_plinth_months: vacMonths, completion_months: doneMonths } };
  }
  router.get('/api/projects/:id/lifecycle', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = Number(req.params.id);
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const out = await lifecycle(env, pid); if (!out) return json({ ok: false, error: 'Project not found.' }, 404);
      return json({ ok: true, data: out });
    } catch (e) { return serverError(e, 'lifecycle'); }
  }));
  // Tick (or clear) a life-cycle step that has no other record. Demolition waits for every member to vacate unless the Owner writes why.
  router.post('/api/projects/:id/lifecycle/:step', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const pid = Number(req.params.id); const step = req.params.step;
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (!LC_MANUAL[step]) return json({ ok: false, error: 'This step is recorded elsewhere (Approvals, Redevelopment or Site).' }, 400);
      const cur = await lifecycle(env, pid); if (!cur) return json({ ok: false, error: 'Project not found.' }, 404);
      const row = cur.steps.find((x) => x.key === step);
      if (!row || !row.manual) return json({ ok: false, error: 'This step is recorded elsewhere (Business Development or Redevelopment).' }, 400);
      const b = await req.json();
      const done = b.done_on === '' || b.done_on == null ? null : String(b.done_on);
      if (done && (!isDate(done) || done > todayIST())) return json({ ok: false, error: 'Enter the date (not in the future).' }, 400);
      let override = null;
      if (done && step === 'demolition' && cur.project.society) {
        const v = cur.steps.find((x) => x.key === 'vacating');
        if (!v.done) {
          override = str(b.override_note, 300);
          if (req.user.role !== 'owner' || !override) return json({ ok: false, error: `Not everyone has vacated (${v.detail || 'no members listed'}).${req.user.role === 'owner' ? ' As the Owner you can go ahead only with a written reason.' : ''}`, code: 'vacating' }, 409);
        }
      }
      const doc = Number(b.document_id) || null;
      if (doc && !(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL AND (project_id = ? OR project_id IS NULL)').bind(doc, pid).first())) return json({ ok: false, error: 'That file was not found.' }, 400);
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO prj_lifecycle (project_id, step, done_on, note, document_id, override_note, done_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, step) DO UPDATE SET done_on = excluded.done_on, note = excluded.note, document_id = COALESCE(excluded.document_id, document_id), override_note = excluded.override_note, done_by = excluded.done_by`)
          .bind(pid, step, done, str(b.note, 300) || null, doc, override, req.user.user_id, now),
        env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'lifecycle', 'projects', ?, ?, ?)").bind(req.user.user_id, pid, `${LC_MANUAL[step]}: ${done || 'cleared'}${override ? ' (Owner went ahead: ' + override + ')' : ''}`, now),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'lifecycle-step'); }
  }));
}
