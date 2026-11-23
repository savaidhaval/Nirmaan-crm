// routes/redevelopment.js — Redevelopment: societies and members with a consent meter (WP-1), rehab flats, transit rent,
// corpus and bank guarantees (WP-2), and meetings and resolutions (WP-3).
// Records only. The required majority and every legal procedure must be confirmed with the advocate; nothing legal is hard-coded.
// Free-plan caps: the consent meter is ONE grouped query; transit schedules are filled by one set-based statement; the sweep is five fixed statements.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const STATUSES = ['pending', 'consented', 'declined'];
const TYPES = ['owner', 'residential', 'tenant', 'commercial', 'other'];
const AADHAAR = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const PAGE = 25;
// The member-document checklist is a setting the Owner fills in (items separated by ; or new lines). Nothing is pre-filled.
const checklistOf = (v) => String(v || '').split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);

// Fills the transit-rent schedule for every term (or one member): from the start month up to 12 months ahead, never past the end date.
// INSERT OR IGNORE on UNIQUE(member_id, period) means it can run any number of times safely.
// Year-wise rent from the member's terms (year 1 to 5; later years use year 5). NULL when not set, so the term's monthly rent is used.
// nExpr is the month number counted from the first rent month (0 = first month).
const YEAR_RENT = (nExpr) => `NULLIF(CAST(ROUND((CASE (${nExpr}) / 12 WHEN 0 THEN rm.rent_y1_paise WHEN 1 THEN rm.rent_y2_paise WHEN 2 THEN rm.rent_y3_paise WHEN 3 THEN rm.rent_y4_paise ELSE rm.rent_y5_paise END)
  * (CASE WHEN rm.rent_basis = 'per_sqft' THEN COALESCE(rm.carpet_sqft, 0) ELSE 1 END)) AS INTEGER), 0)`;
const FILL_SQL = (one) => `INSERT OR IGNORE INTO red_transit_schedule (member_id, period, due_paise, due_on)
  WITH RECURSIVE m(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM m WHERE n < 119)
  SELECT t.member_id, strftime('%Y-%m', date(t.start_date, 'start of month', '+' || m.n || ' months')), COALESCE(${YEAR_RENT('m.n')}, t.monthly_rent_paise),
    date(t.start_date, 'start of month', '+' || m.n || ' months', '+' || (?1 - 1) || ' days')
  FROM red_transit_terms t JOIN m LEFT JOIN red_members rm ON rm.id = t.member_id
  WHERE date(t.start_date, 'start of month', '+' || m.n || ' months') <= date('now', 'start of month', '+12 months')
    AND (t.end_date IS NULL OR date(t.start_date, 'start of month', '+' || m.n || ' months') <= t.end_date)${one ? ' AND t.member_id = ?2' : ''}`;
// Months with no payment yet take the year-wise rent (when set). Bind: member id.
const MONTHS_FROM_START = `((CAST(substr(red_transit_schedule.period, 1, 4) AS INTEGER) - CAST(substr(t.start_date, 1, 4) AS INTEGER)) * 12 + CAST(substr(red_transit_schedule.period, 6, 2) AS INTEGER) - CAST(substr(t.start_date, 6, 2) AS INTEGER))`;
const REPRICE_SQL = `UPDATE red_transit_schedule SET due_paise = COALESCE((SELECT ${YEAR_RENT(MONTHS_FROM_START)} FROM red_transit_terms t JOIN red_members rm ON rm.id = t.member_id WHERE t.member_id = red_transit_schedule.member_id), due_paise)
  WHERE member_id = ? AND NOT EXISTS (SELECT 1 FROM red_transit_payments p WHERE p.schedule_id = red_transit_schedule.id AND p.reversed_at IS NULL)`;

export async function redevSweep(env, getSetting) {
  const day = Math.min(28, Math.max(1, Math.round(Number(await getSetting(env, 'red.rent_due_day')) || 1)));
  await env.DB.prepare(FILL_SQL(false)).bind(day).run();
  await env.DB.batch([
    // rent falling due in 3 days: Accounts, one line per society
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, 'Transit rent due soon: ' || x.name, x.n || ' member(s) have rent due within 3 days.', 'redevelopment', datetime('now')
      FROM (SELECT s.id AS sid, s.name, COUNT(*) AS n FROM red_transit_schedule r JOIN red_members m ON m.id = r.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL
        WHERE r.due_on BETWEEN date('now') AND date('now', '+3 days') AND r.due_paise > COALESCE((SELECT SUM(p.amount_paise) FROM red_transit_payments p WHERE p.schedule_id = r.id AND p.reversed_at IS NULL), 0) GROUP BY s.id) x
      JOIN users u ON u.role = 'accounts' AND u.active = 1 AND u.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Transit rent due soon: ' || x.name AND date(n.created_at) = date('now'))`),
    // overdue rent: Owner and Accounts
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, 'Transit rent overdue: ' || x.name, x.n || ' month(s) of rent are overdue.', 'redevelopment', datetime('now')
      FROM (SELECT s.id AS sid, s.name, COUNT(*) AS n FROM red_transit_schedule r JOIN red_members m ON m.id = r.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL
        WHERE r.due_on < date('now') AND r.due_paise > COALESCE((SELECT SUM(p.amount_paise) FROM red_transit_payments p WHERE p.schedule_id = r.id AND p.reversed_at IS NULL), 0) GROUP BY s.id) x
      JOIN users u ON u.role IN ('owner', 'accounts') AND u.active = 1 AND u.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Transit rent overdue: ' || x.name AND date(n.created_at) = date('now'))`),
    // bank guarantees expiring within 30 days: Owner and Accounts
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, 'Bank guarantee expiring: ' || m.member_name, 'Guarantee ' || COALESCE(t.bg_ref, '') || ' expires on ' || t.bg_expiry || '.', 'redevelopment', datetime('now')
      FROM red_transit_terms t JOIN red_members m ON m.id = t.member_id AND m.deleted_at IS NULL JOIN users u ON u.role IN ('owner', 'accounts') AND u.active = 1 AND u.deleted_at IS NULL
      WHERE t.bg_expiry BETWEEN date('now') AND date('now', '+30 days')
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Bank guarantee expiring: ' || m.member_name AND date(n.created_at) = date('now'))`),
    // meeting follow-ups due within 2 days: the PMs
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, 'Meeting action due: ' || s.name, mt.next_action || ' (due ' || mt.next_action_due || ')', 'redevelopment', datetime('now')
      FROM red_meetings mt JOIN red_societies s ON s.id = mt.society_id AND s.deleted_at IS NULL JOIN users u ON u.role = 'pm' AND u.active = 1 AND u.deleted_at IS NULL
      WHERE mt.deleted_at IS NULL AND mt.next_action_done = 0 AND mt.next_action_due IS NOT NULL AND mt.next_action_due <= date('now', '+2 days')
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Meeting action due: ' || s.name AND n.body = mt.next_action || ' (due ' || mt.next_action_due || ')' AND date(n.created_at) = date('now'))`),
  ]);
}

export function registerRedevelopment(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, csvBom, onConsent } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 300), nowStr());
  const csvResponse = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  const canPhone = (u) => ['owner', 'pm'].includes(u.role);
  const today = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);

  async function loadSociety(env, req, id) {
    const s = await env.DB.prepare('SELECT s.*, p.name AS project_name FROM red_societies s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.deleted_at IS NULL').bind(id).first();
    if (!s) return { err: bad('Society not found.', 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(s.project_id)) return { err: bad('Not allowed.', 403) };
    return { soc: s };
  }
  async function loadMember(env, req, id) {
    const m = await env.DB.prepare('SELECT m.*, s.project_id, s.name AS society_name FROM red_members m JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL WHERE m.id = ? AND m.deleted_at IS NULL').bind(id).first();
    if (!m) return { err: bad('Member not found.', 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(m.project_id)) return { err: bad('Not allowed.', 403) };
    return { mem: m };
  }

  // The consent meter: ONE grouped query.
  async function consentSummary(env, soc) {
    const rows = (await env.DB.prepare("SELECT consent_status AS s, COUNT(*) AS n, COALESCE(SUM(carpet_sqft), 0) AS a FROM red_members WHERE society_id = ? AND deleted_at IS NULL GROUP BY consent_status").bind(soc.id).all()).results;
    const c = { total: 0, consented: 0, declined: 0, pending: 0, area_total: 0, area_consented: 0 };
    for (const r of rows) { c[r.s] = r.n; c.total += r.n; c.area_total += r.a; if (r.s === 'consented') c.area_consented = r.a; }
    const byArea = soc.count_basis === 'area' && c.area_total > 0;
    c.basis = byArea ? 'area' : 'members';
    c.pct_bp = c.total === 0 ? 0 : Math.round(((byArea ? c.area_consented : c.consented) * 10000) / (byArea ? c.area_total : c.total));
    c.threshold_bp = soc.consent_threshold_bp; c.reached = c.total > 0 && c.pct_bp >= soc.consent_threshold_bp;
    return c;
  }
  const meterText = (soc, c) => `${c.consented} of ${c.total} members = ${(c.pct_bp / 100).toFixed(1)}%`;

  // After a consent change: announce a crossing once, and only once (the flag is flipped by a conditional UPDATE).
  async function afterConsent(env, req, soc, c) {
    const flip = await env.DB.prepare('UPDATE red_societies SET threshold_reached = ?1 WHERE id = ?2 AND threshold_reached != ?1').bind(c.reached ? 1 : 0, soc.id).run();
    if (!flip.meta.changes) return { crossed: null };
    const title = c.reached ? `Consent threshold reached: ${soc.name}` : `Consent dropped below the threshold: ${soc.name}`;
    const body = `${meterText(soc, c)}; the threshold is ${(soc.consent_threshold_bp / 100).toFixed(1)}%. Confirm the required majority with your advocate.`;
    await env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'redevelopment', ? FROM users WHERE role IN ('owner', 'pm') AND active = 1 AND deleted_at IS NULL").bind(title, body, nowStr()).run();
    if (onConsent) { try { await onConsent(env, { society: soc, reached: c.reached, summary: c, text: meterText(soc, c) }); } catch (e) { console.error('onConsent', e.message); } }
    return { crossed: c.reached ? 'reached' : 'dropped_below' };
  }

  // ======================= societies =======================
  router.get('/api/redev/societies', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { societies: [] } });
      const pid = Number(new URL(req.url).searchParams.get('project_id')) || 0; if (pid && !ids.includes(pid)) return bad('Not allowed.', 403);
      const rows = (await env.DB.prepare(`SELECT s.*, p.name AS project_name, COUNT(m.id) AS total, COALESCE(SUM(m.consent_status = 'consented'), 0) AS consented, COALESCE(SUM(m.consent_status = 'declined'), 0) AS declined,
          COALESCE(SUM(m.carpet_sqft), 0) AS area_total, COALESCE(SUM(CASE WHEN m.consent_status = 'consented' THEN m.carpet_sqft END), 0) AS area_consented
        FROM red_societies s JOIN projects p ON p.id = s.project_id LEFT JOIN red_members m ON m.society_id = s.id AND m.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND s.project_id IN (SELECT value FROM json_each(?1)) AND (?2 = 0 OR s.project_id = ?2) GROUP BY s.id ORDER BY p.name, s.name LIMIT 200`).bind(JSON.stringify(ids), pid).all()).results;
      for (const r of rows) { const byArea = r.count_basis === 'area' && r.area_total > 0; r.pct_bp = r.total ? Math.round(((byArea ? r.area_consented : r.consented) * 10000) / (byArea ? r.area_total : r.total)) : 0; r.reached = r.total > 0 && r.pct_bp >= r.consent_threshold_bp; }
      return json({ ok: true, data: { societies: rows } });
    } catch (e) { return serverError(e, 'red-societies'); }
  }));

  const societyFields = (b) => {
    const name = txt(b.name, 150); if (!name) return { error: 'Enter the society name.' };
    const pctIn = num(b.consent_threshold_pct); const bp = pctIn != null ? Math.round(pctIn * 100) : (b.consent_threshold_bp != null ? Math.round(Number(b.consent_threshold_bp)) : 5100);
    if (!(bp > 0 && bp <= 10000)) return { error: 'The threshold must be between 1% and 100%.' };
    const basis = ['members', 'area'].includes(b.count_basis) ? b.count_basis : 'members';
    return { v: { name, registration_no: txt(b.registration_no, 60), address: txt(b.address, 300), bp, basis, notes: txt(b.notes, 500) } };
  };

  router.post('/api/redev/societies', async (req, env) => withAuth(req, env, 'redevelopment', 'C', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({})); const pid = Number(b.project_id);
      const proj = await env.DB.prepare('SELECT id, name, type FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid).first();
      if (!proj || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      if (proj.type !== 'redevelopment') return bad('This project is not a redevelopment project. Change its type first.');
      if (await env.DB.prepare('SELECT 1 AS x FROM red_societies WHERE project_id = ? AND deleted_at IS NULL').bind(pid).first()) return bad('This project already has its society. A project has one society: open it from the list.', 409);
      const f = societyFields(b); if (f.error) return bad(f.error);
      const r = await env.DB.prepare('INSERT INTO red_societies (project_id, name, registration_no, address, consent_threshold_bp, count_basis, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(pid, f.v.name, f.v.registration_no, f.v.address, f.v.bp, f.v.basis, f.v.notes, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', 'red_societies', r.meta.last_row_id, `Added society ${f.v.name}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'red-soc-create'); }
  }));

  router.put('/api/redev/societies/:id', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const f = societyFields({ ...soc, consent_threshold_bp: soc.consent_threshold_bp, ...b }); if (f.error) return bad(f.error);
      await env.DB.batch([env.DB.prepare('UPDATE red_societies SET name = ?, registration_no = ?, address = ?, consent_threshold_bp = ?, count_basis = ?, notes = ? WHERE id = ?').bind(f.v.name, f.v.registration_no, f.v.address, f.v.bp, f.v.basis, f.v.notes, soc.id),
        audit(env, req.user, 'update', 'red_societies', soc.id, `Edited society ${soc.name}${f.v.bp !== soc.consent_threshold_bp ? ` (threshold now ${(f.v.bp / 100).toFixed(1)}%)` : ''}`)]);
      const fresh = (await loadSociety(env, req, soc.id)).soc; const c = await consentSummary(env, fresh); await afterConsent(env, req, fresh, c);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-soc-edit'); }
  }));

  router.get('/api/redev/societies/:id', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const checklist = checklistOf(await getSetting(env, 'red.member_doc_checklist'));
      return json({ ok: true, data: { society: soc, consent: await consentSummary(env, soc), meter_text: null, checklist, can_phone: canPhone(req.user), legal_note: 'Confirm the required majority with your advocate. This meter is a record, not legal advice.' } });
    } catch (e) { return serverError(e, 'red-soc'); }
  }));

  // ======================= members =======================
  const memberFields = (b, soc) => {
    const name = txt(b.member_name, 150), unit = txt(b.unit_label, 40); if (!name || !unit) return { error: 'Enter the member name and the flat.' };
    const notes = txt(b.notes, 500); if (AADHAAR.test(notes + ' ' + name + ' ' + unit)) return { error: 'Please do not enter Aadhaar numbers here.' };
    const digits = String(b.phone || '').replace(/\D/g, '').slice(-10); if (b.phone && digits.length !== 10) return { error: 'The mobile number must be 10 digits.' };
    const type = TYPES.includes(b.member_type) ? b.member_type : 'owner'; const area = b.carpet_sqft === '' || b.carpet_sqft == null ? null : num(b.carpet_sqft);
    if (area != null && (area < 0 || area > 100000)) return { error: 'Check the carpet area.' };
    return { v: { name, unit, wing: txt(b.wing, 20), phone: digits ? '+91' + digits : '', type, area, notes } };
  };

  router.get('/api/redev/societies/:id/members', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const q = new URL(req.url).searchParams; const st = STATUSES.includes(q.get('status')) ? q.get('status') : ''; const term = txt(q.get('q'), 60).replace(/[%_\\]/g, ''); const page = Math.max(1, Number(q.get('page')) || 1);
      const like = term ? `%${term}%` : '';
      const where = `society_id = ?1 AND deleted_at IS NULL AND (?2 = '' OR consent_status = ?2) AND (?3 = '' OR member_name LIKE ?3 OR unit_label LIKE ?3 OR wing LIKE ?3)`;
      const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM red_members WHERE ${where}`).bind(soc.id, st, like).first()).n;
      const rows = (await env.DB.prepare(`SELECT id, wing, unit_label, member_name, phone, member_type, carpet_sqft, consent_status, consent_date, notes, extra_area_bp, new_rera_sqft, buys_extra, buys_extra_sqft, car_parks FROM red_members WHERE ${where} ORDER BY wing, unit_label, id LIMIT ${PAGE} OFFSET ?4`).bind(soc.id, st, like, (page - 1) * PAGE).all()).results;
      if (!canPhone(req.user)) for (const r of rows) delete r.phone;
      return json({ ok: true, data: { members: rows, total, page, page_size: PAGE } });
    } catch (e) { return serverError(e, 'red-members'); }
  }));

  // Names only, for pick lists (meeting attendance). No phone numbers.
  router.get('/api/redev/societies/:id/member-names', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare('SELECT id, wing, unit_label, member_name FROM red_members WHERE society_id = ? AND deleted_at IS NULL ORDER BY wing, unit_label, id LIMIT 2000').bind(soc.id).all()).results;
      return json({ ok: true, data: { members: rows } });
    } catch (e) { return serverError(e, 'red-member-names'); }
  }));

  router.post('/api/redev/societies/:id/members', async (req, env) => withAuth(req, env, 'redevelopment', 'C', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const f = memberFields(b, soc); if (f.error) return bad(f.error);
      const uuid = txt(b.client_uuid, 60) || crypto.randomUUID();
      const dup = await env.DB.prepare('SELECT id FROM red_members WHERE client_uuid = ?').bind(uuid).first(); if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const r = await env.DB.prepare('INSERT INTO red_members (society_id, wing, unit_label, member_name, phone, member_type, carpet_sqft, notes, client_uuid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(soc.id, f.v.wing, f.v.unit, f.v.name, f.v.phone, f.v.type, f.v.area, f.v.notes, uuid, nowStr()).run();
      await audit(env, req.user, 'create', 'red_members', r.meta.last_row_id, `Added member ${f.v.name} (${f.v.unit}) to ${soc.name}`).run();
      const c = await consentSummary(env, soc); await afterConsent(env, req, soc, c);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'red-member-add'); }
  }));

  // Paste-in import: the screen turns the pasted CSV into rows; at most 200 at a time, one statement.
  router.post('/api/redev/societies/:id/members/import', async (req, env) => withAuth(req, env, 'redevelopment', 'C', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await req.json().catch(() => ({}))).rows; if (!Array.isArray(rows) || !rows.length) return bad('Paste at least one member.');
      if (rows.length > 200) return bad('Import at most 200 members at a time.');
      const good = [], errors = [];
      rows.forEach((r, i) => { const f = memberFields(r, soc); if (f.error) errors.push(`Row ${i + 1}: ${f.error}`); else good.push({ w: f.v.wing, u: f.v.unit, n: f.v.name, p: f.v.phone, t: f.v.type, a: f.v.area }); });
      if (errors.length) return bad(errors.slice(0, 3).join(' '));
      const r = await env.DB.prepare(`INSERT INTO red_members (society_id, wing, unit_label, member_name, phone, member_type, carpet_sqft, client_uuid, created_at)
        SELECT ?1, json_extract(value, '$.w'), json_extract(value, '$.u'), json_extract(value, '$.n'), json_extract(value, '$.p'), json_extract(value, '$.t'), json_extract(value, '$.a'), lower(hex(randomblob(16))), ?2 FROM json_each(?3)
        WHERE NOT EXISTS (SELECT 1 FROM red_members m WHERE m.society_id = ?1 AND m.deleted_at IS NULL AND COALESCE(m.wing, '') = COALESCE(json_extract(value, '$.w'), '') AND m.unit_label = json_extract(value, '$.u') AND m.member_name = json_extract(value, '$.n'))`)
        .bind(soc.id, nowStr(), JSON.stringify(good)).run();
      await audit(env, req.user, 'import', 'red_members', soc.id, `Imported ${r.meta.changes} member(s) into ${soc.name}`).run();
      const c = await consentSummary(env, soc); await afterConsent(env, req, soc, c);
      return json({ ok: true, data: { added: r.meta.changes, skipped_duplicates: good.length - r.meta.changes } });
    } catch (e) { return serverError(e, 'red-import'); }
  }));

  router.put('/api/redev/members/:id', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const soc = (await loadSociety(env, req, mem.society_id)).soc;
      const f = memberFields({ ...mem, ...b, phone: b.phone !== undefined ? b.phone : mem.phone }, soc); if (f.error) return bad(f.error);
      await env.DB.batch([env.DB.prepare('UPDATE red_members SET wing = ?, unit_label = ?, member_name = ?, phone = ?, member_type = ?, carpet_sqft = ?, notes = ? WHERE id = ?').bind(f.v.wing, f.v.unit, f.v.name, f.v.phone, f.v.type, f.v.area, f.v.notes, mem.id),
        audit(env, req.user, 'update', 'red_members', mem.id, `Edited member ${f.v.name} (${f.v.unit})`)]);
      await afterConsent(env, req, soc, await consentSummary(env, soc));
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-member-edit'); }
  }));

  router.post('/api/redev/members/:id/remove', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can remove a member.' }, 403);
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const reason = txt((await req.json().catch(() => ({}))).reason, 200); if (!reason) return bad('Say why this member is being removed.');
      await env.DB.batch([env.DB.prepare("UPDATE red_members SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(nowStr(), mem.id), audit(env, req.user, 'delete', 'red_members', mem.id, `Removed member ${mem.member_name} (${mem.unit_label}): ${reason}`)]);
      const soc = (await loadSociety(env, req, mem.society_id)).soc; await afterConsent(env, req, soc, await consentSummary(env, soc));
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-member-del'); }
  }));

  // One tap: Consented / Declined / Pending. Every change is logged; the meter then recomputes and may announce a crossing.
  router.post('/api/redev/members/:id/consent', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const to = String(b.status || ''); const note = txt(b.note, 300);
      if (!STATUSES.includes(to)) return bad('Pick Consented, Declined or Pending.');
      if (AADHAAR.test(note)) return bad('Please do not enter Aadhaar numbers here.');
      const soc = (await loadSociety(env, req, mem.society_id)).soc; const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE red_members SET consent_status = ?1, consent_date = CASE WHEN ?1 = 'pending' THEN NULL ELSE ?2 END WHERE id = ?3 AND deleted_at IS NULL AND consent_status != ?1").bind(to, now.substring(0, 10), mem.id),
        env.DB.prepare('INSERT INTO red_consent_events (society_id, member_id, from_status, to_status, note, by_user, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() > 0').bind(soc.id, mem.id, mem.consent_status, to, note, req.user.user_id, now),
      ]);
      if (!res[0].meta.changes) return json({ ok: true, data: { unchanged: true, consent: await consentSummary(env, soc) } });
      await audit(env, req.user, 'update', 'red_members', mem.id, `Consent for ${mem.member_name} (${mem.unit_label}): ${mem.consent_status} to ${to}`).run();
      const c = await consentSummary(env, soc); const crossed = await afterConsent(env, req, soc, c);
      return json({ ok: true, data: { consent: c, crossed: crossed.crossed } });
    } catch (e) { return serverError(e, 'red-consent'); }
  }));

  router.get('/api/redev/societies/:id/consent-log', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const page = Math.max(1, Number(new URL(req.url).searchParams.get('page')) || 1);
      const rows = (await env.DB.prepare(`SELECT e.id, e.from_status, e.to_status, e.note, e.created_at, m.member_name, m.unit_label, m.wing, u.name AS by_name FROM red_consent_events e JOIN red_members m ON m.id = e.member_id LEFT JOIN users u ON u.id = e.by_user
        WHERE e.society_id = ? ORDER BY e.id DESC LIMIT ${PAGE} OFFSET ?`).bind(soc.id, (page - 1) * PAGE).all()).results;
      return json({ ok: true, data: { events: rows, page } });
    } catch (e) { return serverError(e, 'red-log'); }
  }));

  // Follow-up list: everyone who has not consented yet (pending first, then declined). CSV on request.
  router.get('/api/redev/societies/:id/pending', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare("SELECT id, wing, unit_label, member_name, phone, member_type, carpet_sqft, consent_status, consent_date, notes FROM red_members WHERE society_id = ? AND deleted_at IS NULL AND consent_status != 'consented' ORDER BY CASE consent_status WHEN 'pending' THEN 0 ELSE 1 END, wing, unit_label LIMIT 500").bind(soc.id).all()).results;
      if (!canPhone(req.user)) for (const r of rows) delete r.phone;
      if (new URL(req.url).searchParams.get('csv')) return csvResponse(`follow-up-${soc.id}.csv`, [['Wing', 'Flat', 'Member', 'Type', 'Carpet sq ft', 'Status', ...(canPhone(req.user) ? ['Phone'] : []), 'Notes'], ...rows.map((r) => [r.wing || '', r.unit_label, r.member_name, r.member_type, r.carpet_sqft ?? '', r.consent_status, ...(canPhone(req.user) ? [r.phone || ''] : []), r.notes || ''])]);
      return json({ ok: true, data: { members: rows } });
    } catch (e) { return serverError(e, 'red-pending'); }
  }));

  // Consent % for every society (CSV on request)
  router.get('/api/redev/report', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      const rows = (await env.DB.prepare(`SELECT s.id, s.name, p.name AS project_name, s.consent_threshold_bp, s.count_basis, COUNT(m.id) AS total, COALESCE(SUM(m.consent_status = 'consented'), 0) AS consented, COALESCE(SUM(m.consent_status = 'declined'), 0) AS declined,
          COALESCE(SUM(m.carpet_sqft), 0) AS area_total, COALESCE(SUM(CASE WHEN m.consent_status = 'consented' THEN m.carpet_sqft END), 0) AS area_consented
        FROM red_societies s JOIN projects p ON p.id = s.project_id LEFT JOIN red_members m ON m.society_id = s.id AND m.deleted_at IS NULL WHERE s.deleted_at IS NULL AND s.project_id IN (SELECT value FROM json_each(?)) GROUP BY s.id ORDER BY p.name, s.name`).bind(JSON.stringify(ids)).all()).results;
      for (const r of rows) { const a = r.count_basis === 'area' && r.area_total > 0; r.pct = r.total ? Math.round(((a ? r.area_consented : r.consented) * 1000) / (a ? r.area_total : r.total)) / 10 : 0; r.reached = r.pct * 100 >= r.consent_threshold_bp && r.total > 0; }
      if (new URL(req.url).searchParams.get('csv')) return csvResponse('consent-by-society.csv', [['Project', 'Society', 'Members', 'Consented', 'Declined', 'Pending', 'Consent %', 'Threshold %', 'Reached'], ...rows.map((r) => [r.project_name, r.name, r.total, r.consented, r.declined, r.total - r.consented - r.declined, r.pct, r.consent_threshold_bp / 100, r.reached ? 'yes' : 'no'])]);
      return json({ ok: true, data: { societies: rows } });
    } catch (e) { return serverError(e, 'red-report'); }
  }));

  // ----- member documents (checklist comes from the setting red.member_doc_checklist; nothing is invented) -----
  router.get('/api/redev/members/:id/docs', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const items = checklistOf(await getSetting(env, 'red.member_doc_checklist'));
      const have = (await env.DB.prepare('SELECT d.item_key, d.status, d.document_id, o.title AS file_title FROM red_member_docs d LEFT JOIN documents o ON o.id = d.document_id AND o.deleted_at IS NULL WHERE d.member_id = ?').bind(mem.id).all()).results;
      return json({ ok: true, data: { items: items.map((k) => ({ key: k, ...(have.find((x) => x.item_key === k) || { status: 'pending', document_id: null }) })) } });
    } catch (e) { return serverError(e, 'red-docs'); }
  }));
  router.post('/api/redev/members/:id/docs', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const key = txt(b.item_key, 120); const status = ['pending', 'received', 'not_needed'].includes(b.status) ? b.status : 'received';
      const items = checklistOf(await getSetting(env, 'red.member_doc_checklist'));
      if (!items.includes(key)) return bad('That item is not on the checklist.');
      let docId = null;
      if (b.document_id) { const d = await env.DB.prepare("SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND category = 'society' AND project_id = ?").bind(Number(b.document_id), mem.project_id).first(); if (!d) return bad('That file is not a society file of this project.'); docId = d.id; }
      await env.DB.batch([env.DB.prepare(`INSERT INTO red_member_docs (member_id, item_key, document_id, status, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(member_id, item_key) DO UPDATE SET status = ?4, document_id = COALESCE(?3, document_id), updated_by = ?5, updated_at = ?6`).bind(mem.id, key, docId, status, req.user.user_id, nowStr()),
        audit(env, req.user, 'update', 'red_member_docs', mem.id, `${mem.member_name}: "${key}" marked ${status}`)]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-docs-set'); }
  }));

  // ======================= WP-2: rehab flats =======================
  router.get('/api/redev/societies/:id/rehab', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare(`SELECT m.id AS member_id, m.wing, m.unit_label, m.member_name, m.carpet_sqft, a.entitlement_sqft, a.status, a.allotted_on, a.inventory_id, i.wing AS inv_wing, i.unit_no AS inv_unit, i.floor AS inv_floor, i.carpet_sqft AS inv_sqft
        FROM red_members m LEFT JOIN red_rehab_allotments a ON a.member_id = m.id LEFT JOIN sal_inventory i ON i.id = a.inventory_id WHERE m.society_id = ? AND m.deleted_at IS NULL ORDER BY m.wing, m.unit_label LIMIT 500`).bind(soc.id).all()).results;
      const units = (await env.DB.prepare(`SELECT i.id, i.wing, i.unit_no, i.floor, i.carpet_sqft FROM sal_inventory i WHERE i.project_id = ? AND i.category = 'rehab' AND i.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM red_rehab_allotments a WHERE a.inventory_id = i.id AND a.status != 'cancelled') ORDER BY i.wing, i.floor, i.unit_no LIMIT 300`).bind(soc.project_id).all()).results;
      return json({ ok: true, data: { members: rows, free_units: units } });
    } catch (e) { return serverError(e, 'red-rehab'); }
  }));
  router.post('/api/redev/members/:id/rehab', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const status = ['proposed', 'allotted', 'possessed', 'cancelled'].includes(b.status) ? b.status : 'proposed';
      const ent = b.entitlement_sqft === '' || b.entitlement_sqft == null ? null : num(b.entitlement_sqft); if (ent != null && (ent < 0 || ent > 100000)) return bad('Check the entitlement area.');
      let inv = null;
      if (b.inventory_id) {
        inv = await env.DB.prepare("SELECT id FROM sal_inventory WHERE id = ? AND project_id = ? AND category = 'rehab' AND deleted_at IS NULL").bind(Number(b.inventory_id), mem.project_id).first();
        if (!inv) return bad('Pick a rehab flat of this project. (Mark a flat as "rehab" in the Sales inventory first.)');
        const taken = await env.DB.prepare("SELECT member_id FROM red_rehab_allotments WHERE inventory_id = ? AND status != 'cancelled' AND member_id != ?").bind(inv.id, mem.id).first(); if (taken) return bad('That flat is already allotted to another member.', 409);
      }
      if (['allotted', 'possessed'].includes(status) && !inv && !b.keep_unit) { const cur = await env.DB.prepare('SELECT inventory_id FROM red_rehab_allotments WHERE member_id = ?').bind(mem.id).first(); if (!cur || !cur.inventory_id) return bad('Pick the flat before marking it allotted.'); }
      await env.DB.batch([env.DB.prepare(`INSERT INTO red_rehab_allotments (member_id, inventory_id, entitlement_sqft, allotted_on, status, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(member_id) DO UPDATE SET inventory_id = COALESCE(?2, inventory_id), entitlement_sqft = COALESCE(?3, entitlement_sqft), status = ?5, allotted_on = CASE WHEN ?5 IN ('allotted', 'possessed') THEN COALESCE(allotted_on, ?4) ELSE allotted_on END`)
        .bind(mem.id, inv ? inv.id : null, ent, today(), status, req.user.user_id, nowStr()), audit(env, req.user, 'update', 'red_rehab_allotments', mem.id, `Rehab flat for ${mem.member_name}: ${status}`)]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-rehab-set'); }
  }));

  // ======================= member terms: year-wise rent, corpus, parking, shifting, area =======================
  const TERM_COLS = 'rent_basis, rent_y1_paise, rent_y2_paise, rent_y3_paise, rent_y4_paise, rent_y5_paise, corpus_paise, car_parks, shifting_paise, extra_area_bp, new_rera_sqft, buys_extra, buys_extra_sqft';
  router.get('/api/redev/members/:id/terms', async (req, env) => withAuth(req, env, 'transit', 'V', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const t = await env.DB.prepare(`SELECT id, member_name, unit_label, wing, member_type, carpet_sqft, ${TERM_COLS} FROM red_members WHERE id = ?`).bind(mem.id).first();
      return json({ ok: true, data: { terms: t } });
    } catch (e) { return serverError(e, 'red-terms'); }
  }));
  router.put('/api/redev/members/:id/terms', async (req, env) => withAuth(req, env, 'transit', 'E', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({}));
      const basis = ['per_sqft', 'monthly'].includes(b.rent_basis) ? b.rent_basis : null;
      const money = (k) => { if (b[k] === '' || b[k] == null) return null; const v = Math.round(num(b[k])); return v >= 0 && v <= 1e12 ? v : NaN; };
      const rents = [1, 2, 3, 4, 5].map((y) => money(`rent_y${y}_paise`));
      const corpus = money('corpus_paise'), shifting = money('shifting_paise');
      if ([...rents, corpus, shifting].some((v) => Number.isNaN(v))) return bad('Check the amounts.');
      if (rents.some((v) => v != null) && !basis) return bad('Say whether the rent is per sq ft or a monthly amount.');
      const area = b.carpet_sqft === '' || b.carpet_sqft == null ? mem.carpet_sqft : num(b.carpet_sqft);
      if (area != null && !(area >= 0 && area <= 100000)) return bad('Check the current flat area.');
      if (basis === 'per_sqft' && rents.some((v) => v != null) && !(area > 0)) return bad('Enter the current flat area to work out rent per sq ft.');
      const cars = b.car_parks === '' || b.car_parks == null ? null : Math.round(num(b.car_parks)); if (cars != null && !(cars >= 0 && cars <= 50)) return bad('Check the number of car parkings.');
      const pct = b.extra_area_pct === '' || b.extra_area_pct == null ? null : num(b.extra_area_pct); if (pct != null && !(pct >= 0 && pct <= 500)) return bad('Check the extra area %.');
      const bp = pct == null ? null : Math.round(pct * 100);
      const newArea = area != null && bp != null ? Math.round(area * (10000 + bp)) / 10000 : null;
      const buys = b.buys_extra ? 1 : 0; const buysSqft = buys && b.buys_extra_sqft !== '' && b.buys_extra_sqft != null ? num(b.buys_extra_sqft) : null;
      if (buysSqft != null && !(buysSqft > 0 && buysSqft <= 100000)) return bad('Check the extra area being bought.');
      await env.DB.batch([
        env.DB.prepare(`UPDATE red_members SET carpet_sqft = ?, rent_basis = ?, rent_y1_paise = ?, rent_y2_paise = ?, rent_y3_paise = ?, rent_y4_paise = ?, rent_y5_paise = ?, corpus_paise = ?, car_parks = ?, shifting_paise = ?, extra_area_bp = ?, new_rera_sqft = ?, buys_extra = ?, buys_extra_sqft = ? WHERE id = ?`)
          .bind(area, basis, ...rents, corpus, cars, shifting, bp, newArea, buys, buysSqft, mem.id),
        env.DB.prepare(REPRICE_SQL).bind(mem.id),
        audit(env, req.user, 'update', 'red_members', mem.id, `Terms for ${mem.member_name}: ${basis ? 'rent set year-wise' : 'no rent'}${bp != null ? `, extra area ${pct}% (new RERA carpet ${newArea} sq ft)` : ''}${buys ? ', buying extra area' : ''}`),
      ]);
      return json({ ok: true, data: { new_rera_sqft: newArea } });
    } catch (e) { return serverError(e, 'red-terms-set'); }
  }));

  // ======================= WP-2: transit rent =======================
  const dueDay = async (env) => Math.min(28, Math.max(1, Math.round(Number(await getSetting(env, 'red.rent_due_day')) || 1)));
  router.post('/api/redev/members/:id/transit-term', async (req, env) => withAuth(req, env, 'transit', 'E', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const rent = Math.round(num(b.monthly_rent_paise) || 0);
      if (!(rent > 0)) return bad('Enter the monthly rent.'); if (!dateOk(b.start_date)) return bad('Enter the first month of rent.');
      if (b.end_date && (!dateOk(b.end_date) || b.end_date < b.start_date)) return bad('The end date must be after the start date.');
      if (b.bg_expiry && !dateOk(b.bg_expiry)) return bad('Check the guarantee expiry date.');
      const old = await env.DB.prepare('SELECT monthly_rent_paise, start_date FROM red_transit_terms WHERE member_id = ?').bind(mem.id).first();
      if (old && old.start_date !== b.start_date) return bad('The start month cannot be changed once rent is scheduled. Change the end date or rent instead.', 409);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO red_transit_terms (member_id, monthly_rent_paise, start_date, end_date, deposit_paise, bg_ref, bg_amount_paise, bg_expiry, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(member_id) DO UPDATE SET monthly_rent_paise = excluded.monthly_rent_paise, end_date = excluded.end_date, deposit_paise = excluded.deposit_paise, bg_ref = excluded.bg_ref, bg_amount_paise = excluded.bg_amount_paise, bg_expiry = excluded.bg_expiry, notes = excluded.notes`)
          .bind(mem.id, rent, b.start_date, b.end_date || null, Math.max(0, Math.round(num(b.deposit_paise) || 0)), txt(b.bg_ref, 60), b.bg_amount_paise ? Math.round(num(b.bg_amount_paise)) : null, b.bg_expiry || null, txt(b.notes, 300), req.user.user_id, nowStr()),
        env.DB.prepare(FILL_SQL(true)).bind(await dueDay(env), mem.id),
        // a changed rent applies to months that have no payment against them yet
        env.DB.prepare('UPDATE red_transit_schedule SET due_paise = ? WHERE member_id = ? AND NOT EXISTS (SELECT 1 FROM red_transit_payments p WHERE p.schedule_id = red_transit_schedule.id AND p.reversed_at IS NULL)').bind(rent, mem.id),
        env.DB.prepare(REPRICE_SQL).bind(mem.id),
        audit(env, req.user, 'update', 'red_transit_terms', mem.id, `Transit rent for ${mem.member_name}: ${rupees(rent)} a month from ${b.start_date}`),
      ]);
      const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM red_transit_schedule WHERE member_id = ?').bind(mem.id).first()).n;
      return json({ ok: true, data: { months_scheduled: n } });
    } catch (e) { return serverError(e, 'red-term'); }
  }));

  const STATE = `CASE WHEN r.id IS NULL THEN NULL WHEN COALESCE(pd.paid, 0) >= r.due_paise THEN 'paid' WHEN r.due_on < date('now') THEN 'overdue' WHEN COALESCE(pd.paid, 0) > 0 THEN 'partial' ELSE 'due' END`;
  const PAID_JOIN = 'LEFT JOIN (SELECT schedule_id, SUM(amount_paise) AS paid FROM red_transit_payments WHERE reversed_at IS NULL GROUP BY schedule_id) pd ON pd.schedule_id = r.id';

  // Month grid for a society: one row per member with a term, for the chosen month.
  router.get('/api/redev/societies/:id/transit', async (req, env) => withAuth(req, env, 'transit', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const month = /^\d{4}-\d{2}$/.test(new URL(req.url).searchParams.get('month') || '') ? new URL(req.url).searchParams.get('month') : today().substring(0, 7);
      const rows = (await env.DB.prepare(`SELECT m.id AS member_id, m.wing, m.unit_label, m.member_name, t.monthly_rent_paise, t.bg_ref, t.bg_amount_paise, t.bg_expiry, r.id AS schedule_id, r.due_paise, r.due_on, COALESCE(pd.paid, 0) AS paid_paise, ${STATE} AS state
        FROM red_members m JOIN red_transit_terms t ON t.member_id = m.id LEFT JOIN red_transit_schedule r ON r.member_id = m.id AND r.period = ?2 ${PAID_JOIN}
        WHERE m.society_id = ?1 AND m.deleted_at IS NULL ORDER BY m.wing, m.unit_label LIMIT 500`).bind(soc.id, month).all()).results;
      const without = (await env.DB.prepare("SELECT COUNT(*) AS n FROM red_members m WHERE m.society_id = ? AND m.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM red_transit_terms t WHERE t.member_id = m.id)").bind(soc.id).first()).n;
      const out = { month, rows, members_without_term: without, totals: { due_paise: rows.reduce((s, r) => s + (r.due_paise || 0), 0), paid_paise: rows.reduce((s, r) => s + (r.state ? r.paid_paise : 0), 0) } };
      return json({ ok: true, data: out });
    } catch (e) { return serverError(e, 'red-transit'); }
  }));

  router.get('/api/redev/members/:id/transit', async (req, env) => withAuth(req, env, 'transit', 'V', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const term = await env.DB.prepare('SELECT * FROM red_transit_terms WHERE member_id = ?').bind(mem.id).first();
      const months = (await env.DB.prepare(`SELECT r.id, r.period, r.due_paise, r.due_on, COALESCE(pd.paid, 0) AS paid_paise, ${STATE} AS state FROM red_transit_schedule r ${PAID_JOIN} WHERE r.member_id = ? ORDER BY r.period LIMIT 60`).bind(mem.id).all()).results;
      const payments = (await env.DB.prepare('SELECT p.id, p.schedule_id, r.period, p.amount_paise, p.paid_on, p.mode, p.ref_no, p.reversed_at, p.reversal_note FROM red_transit_payments p JOIN red_transit_schedule r ON r.id = p.schedule_id WHERE p.member_id = ? ORDER BY p.id DESC LIMIT 60').bind(mem.id).all()).results;
      return json({ ok: true, data: { member: { id: mem.id, member_name: mem.member_name, unit_label: mem.unit_label }, term, months, payments } });
    } catch (e) { return serverError(e, 'red-member-transit'); }
  }));

  router.post('/api/redev/transit/:id/pay', async (req, env) => withAuth(req, env, 'transit', 'C', async (req, env) => {
    try {
      const r = await env.DB.prepare('SELECT r.*, m.society_id, m.member_name, s.project_id FROM red_transit_schedule r JOIN red_members m ON m.id = r.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id WHERE r.id = ?').bind(Number(req.params.id)).first();
      if (!r) return bad('That month was not found.', 404); if (!(await visibleProjectIds(env, req.user)).includes(r.project_id)) return bad('Not allowed.', 403);
      const b = await req.json().catch(() => ({})); const paid = (await env.DB.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS p FROM red_transit_payments WHERE schedule_id = ? AND reversed_at IS NULL').bind(r.id).first()).p;
      const amount = Math.round(num(b.amount_paise) ?? (r.due_paise - paid)); if (!(amount > 0)) return bad('Enter the amount received.');
      const on = dateOk(b.paid_on) ? b.paid_on : today(); if (on > today()) return bad('The payment date cannot be in the future.');
      const uuid = txt(b.client_uuid, 60) || crypto.randomUUID(); const dup = await env.DB.prepare('SELECT id FROM red_transit_payments WHERE client_uuid = ?').bind(uuid).first(); if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      // the cap is checked inside the INSERT, so two people paying at once cannot overpay the month
      const ins = await env.DB.prepare(`INSERT INTO red_transit_payments (schedule_id, member_id, amount_paise, paid_on, mode, ref_no, client_uuid, created_by, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT due_paise FROM red_transit_schedule WHERE id = ?1) - COALESCE((SELECT SUM(amount_paise) FROM red_transit_payments WHERE schedule_id = ?1 AND reversed_at IS NULL), 0) >= ?3`)
        .bind(r.id, r.member_id, amount, on, txt(b.mode, 20) || 'cheque', txt(b.ref_no, 60), uuid, req.user.user_id, nowStr()).run();
      if (!ins.meta.changes) return bad('That is more than is still due for this month.', 409);
      await audit(env, req.user, 'create', 'red_transit_payments', ins.meta.last_row_id, `Transit rent ${rupees(amount)} for ${r.member_name}, ${r.period}`).run();
      return json({ ok: true, data: { id: ins.meta.last_row_id } });
    } catch (e) { return serverError(e, 'red-pay'); }
  }));

  router.post('/api/redev/transit-payments/:id/reverse', async (req, env) => withAuth(req, env, 'transit', 'E', async (req, env) => {
    try {
      const p = await env.DB.prepare('SELECT p.*, s.project_id, m.member_name, r.period FROM red_transit_payments p JOIN red_transit_schedule r ON r.id = p.schedule_id JOIN red_members m ON m.id = p.member_id JOIN red_societies s ON s.id = m.society_id WHERE p.id = ?').bind(Number(req.params.id)).first();
      if (!p) return bad('Payment not found.', 404); if (!(await visibleProjectIds(env, req.user)).includes(p.project_id)) return bad('Not allowed.', 403);
      const reason = txt((await req.json().catch(() => ({}))).reason, 200); if (!reason) return bad('Say why this payment is being reversed.');
      const r = await env.DB.prepare('UPDATE red_transit_payments SET reversed_at = ?, reversal_note = ?, reversed_by = ? WHERE id = ? AND reversed_at IS NULL').bind(nowStr(), reason, req.user.user_id, p.id).run();
      if (!r.meta.changes) return bad('This payment was already reversed.', 409);
      await audit(env, req.user, 'reverse', 'red_transit_payments', p.id, `Reversed transit rent ${rupees(p.amount_paise)} for ${p.member_name}, ${p.period}: ${reason}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-reverse'); }
  }));

  // ======================= WP-2: corpus =======================
  router.get('/api/redev/societies/:id/corpus', async (req, env) => withAuth(req, env, 'transit', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare(`SELECT c.id, c.member_id, m.member_name, m.unit_label, m.wing, c.label, c.amount_paise, c.due_on, c.paid_on, c.ref_no, c.reversed_at, c.reversal_note FROM red_corpus_entries c JOIN red_members m ON m.id = c.member_id
        WHERE m.society_id = ? ORDER BY c.id DESC LIMIT 300`).bind(soc.id).all()).results;
      const live = rows.filter((r) => !r.reversed_at);
      return json({ ok: true, data: { entries: rows, due_paise: live.reduce((s, r) => s + r.amount_paise, 0), paid_paise: live.filter((r) => r.paid_on).reduce((s, r) => s + r.amount_paise, 0) } });
    } catch (e) { return serverError(e, 'red-corpus'); }
  }));
  router.post('/api/redev/members/:id/corpus', async (req, env) => withAuth(req, env, 'transit', 'C', async (req, env) => {
    try {
      const { mem, err } = await loadMember(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json().catch(() => ({})); const amount = Math.round(num(b.amount_paise) || 0); const label = txt(b.label, 120);
      if (!(amount > 0) || !label) return bad('Enter what it is for and the amount.'); if (b.due_on && !dateOk(b.due_on)) return bad('Check the due date.');
      const r = await env.DB.prepare('INSERT INTO red_corpus_entries (member_id, label, amount_paise, due_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(mem.id, label, amount, b.due_on || null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', 'red_corpus_entries', r.meta.last_row_id, `Corpus item "${label}" ${rupees(amount)} for ${mem.member_name}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'red-corpus-add'); }
  }));
  const corpusRow = async (env, req, id) => env.DB.prepare('SELECT c.*, s.project_id, m.member_name FROM red_corpus_entries c JOIN red_members m ON m.id = c.member_id JOIN red_societies s ON s.id = m.society_id WHERE c.id = ?').bind(id).first();
  router.post('/api/redev/corpus/:id/pay', async (req, env) => withAuth(req, env, 'transit', 'E', async (req, env) => {
    try {
      const c = await corpusRow(env, req, Number(req.params.id)); if (!c) return bad('Entry not found.', 404); if (!(await visibleProjectIds(env, req.user)).includes(c.project_id)) return bad('Not allowed.', 403);
      const b = await req.json().catch(() => ({})); const on = dateOk(b.paid_on) ? b.paid_on : today(); if (on > today()) return bad('The date cannot be in the future.');
      const r = await env.DB.prepare('UPDATE red_corpus_entries SET paid_on = ?, ref_no = ? WHERE id = ? AND paid_on IS NULL AND reversed_at IS NULL').bind(on, txt(b.ref_no, 60), c.id).run();
      if (!r.meta.changes) return bad('This entry is already paid or reversed.', 409);
      await audit(env, req.user, 'update', 'red_corpus_entries', c.id, `Corpus "${c.label}" ${rupees(c.amount_paise)} received from ${c.member_name}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-corpus-pay'); }
  }));
  router.post('/api/redev/corpus/:id/reverse', async (req, env) => withAuth(req, env, 'transit', 'E', async (req, env) => {
    try {
      const c = await corpusRow(env, req, Number(req.params.id)); if (!c) return bad('Entry not found.', 404); if (!(await visibleProjectIds(env, req.user)).includes(c.project_id)) return bad('Not allowed.', 403);
      const reason = txt((await req.json().catch(() => ({}))).reason, 200); if (!reason) return bad('Say why this is being reversed.');
      const r = await env.DB.prepare('UPDATE red_corpus_entries SET reversed_at = ?, reversal_note = ?, reversed_by = ? WHERE id = ? AND reversed_at IS NULL').bind(nowStr(), reason, req.user.user_id, c.id).run();
      if (!r.meta.changes) return bad('This entry was already reversed.', 409);
      await audit(env, req.user, 'reverse', 'red_corpus_entries', c.id, `Reversed corpus "${c.label}" for ${c.member_name}: ${reason}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-corpus-rev'); }
  }));

  // ----- reports: rent due this month, overdue, guarantees expiring in 60 days, corpus paid vs due (CSV on request) -----
  router.get('/api/redev/reports/:kind', async (req, env) => withAuth(req, env, 'transit', 'V', async (req, env) => {
    try {
      const ids = JSON.stringify(await visibleProjectIds(env, req.user)); const kind = req.params.kind; const csv = new URL(req.url).searchParams.get('csv');
      let head, rows;
      const base = `FROM red_transit_schedule r JOIN red_members m ON m.id = r.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL ${PAID_JOIN} WHERE s.project_id IN (SELECT value FROM json_each(?1))`;
      if (kind === 'rent_due') { head = ['Society', 'Flat', 'Member', 'Month', 'Due', 'Paid', 'Due on']; rows = (await env.DB.prepare(`SELECT s.name AS a, m.unit_label AS b, m.member_name AS c, r.period AS d, r.due_paise AS e, COALESCE(pd.paid, 0) AS f, r.due_on AS g ${base} AND r.period = strftime('%Y-%m', 'now', '+5 hours', '+30 minutes') ORDER BY s.name, m.unit_label LIMIT 500`).bind(ids).all()).results; }
      else if (kind === 'overdue') { head = ['Society', 'Flat', 'Member', 'Month', 'Due', 'Paid', 'Due on']; rows = (await env.DB.prepare(`SELECT s.name AS a, m.unit_label AS b, m.member_name AS c, r.period AS d, r.due_paise AS e, COALESCE(pd.paid, 0) AS f, r.due_on AS g ${base} AND r.due_on < date('now') AND COALESCE(pd.paid, 0) < r.due_paise ORDER BY r.due_on LIMIT 500`).bind(ids).all()).results; }
      else if (kind === 'guarantees') { head = ['Society', 'Flat', 'Member', 'Guarantee', 'Amount', 'Expires', '']; rows = (await env.DB.prepare(`SELECT s.name AS a, m.unit_label AS b, m.member_name AS c, t.bg_ref AS d, t.bg_amount_paise AS e, t.bg_expiry AS f, '' AS g FROM red_transit_terms t JOIN red_members m ON m.id = t.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL
        WHERE s.project_id IN (SELECT value FROM json_each(?1)) AND t.bg_expiry IS NOT NULL AND t.bg_expiry <= date('now', '+60 days') ORDER BY t.bg_expiry LIMIT 500`).bind(ids).all()).results; }
      else if (kind === 'corpus') { head = ['Society', 'Entries', 'Due (all)', 'Paid', '', '', '']; rows = (await env.DB.prepare(`SELECT s.name AS a, COUNT(*) AS b, SUM(c.amount_paise) AS c, COALESCE(SUM(CASE WHEN c.paid_on IS NOT NULL THEN c.amount_paise END), 0) AS d, '' AS e, '' AS f, '' AS g FROM red_corpus_entries c JOIN red_members m ON m.id = c.member_id JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL
        WHERE s.project_id IN (SELECT value FROM json_each(?1)) AND c.reversed_at IS NULL GROUP BY s.id ORDER BY s.name LIMIT 200`).bind(ids).all()).results; }
      else return bad('Unknown report.', 404);
      const money = (kind === 'guarantees' ? [4] : kind === 'corpus' ? [2, 3] : [4, 5]);
      const table = rows.map((r) => ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => (money.includes(i) && r[k] != null && r[k] !== '' ? (Number(r[k]) / 100).toFixed(2) : r[k] ?? '')));
      if (csv) return csvResponse(`redevelopment-${kind}.csv`, [head, ...table]);
      return json({ ok: true, data: { head, rows: table } });
    } catch (e) { return serverError(e, 'red-reports'); }
  }));

  // ======================= WP-3: meetings =======================
  router.get('/api/redev/societies/:id/meetings', async (req, env) => withAuth(req, env, 'redevelopment', 'V', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare(`SELECT mt.*, d.title AS minutes_title, u.name AS next_action_owner_name, (SELECT json_group_array(a.member_id) FROM red_meeting_attendees a WHERE a.meeting_id = mt.id) AS attendee_ids FROM red_meetings mt LEFT JOIN documents d ON d.id = mt.minutes_document_id AND d.deleted_at IS NULL LEFT JOIN users u ON u.id = mt.next_action_owner WHERE mt.society_id = ? AND mt.deleted_at IS NULL ORDER BY mt.held_on DESC, mt.id DESC LIMIT 200`).bind(soc.id).all()).results;
      for (const r of rows) { try { r.attendee_ids = JSON.parse(r.attendee_ids || '[]'); } catch (e) { r.attendee_ids = []; } }
      if (new URL(req.url).searchParams.get('csv')) return csvResponse(`meetings-${soc.id}.csv`, [['Date', 'Kind', 'Agenda', 'Attendees', 'Resolution', 'Passed', 'Next action', 'Due', 'Done'], ...rows.map((r) => [r.held_on, r.kind, r.agenda || '', r.attendees_count ?? '', r.resolution_text || '', r.resolution_passed ? 'yes' : 'no', r.next_action || '', r.next_action_due || '', r.next_action_done ? 'yes' : 'no'])]);
      return json({ ok: true, data: { meetings: rows, note: 'Record only. Confirm required procedures with your advocate.' } });
    } catch (e) { return serverError(e, 'red-meetings'); }
  }));
  const meetingFields = async (env, b, soc) => {
    const held = dateOk(b.held_on) ? b.held_on : null; if (!held) return { error: 'Enter the meeting date.' };
    if (b.next_action_due && !dateOk(b.next_action_due)) return { error: 'Check the due date.' };
    if (b.next_action_due && !txt(b.next_action, 200)) return { error: 'Say what the next action is.' };
    let doc = null; if (b.minutes_document_id) { doc = await env.DB.prepare("SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND category = 'society' AND project_id = ?").bind(Number(b.minutes_document_id), soc.project_id).first(); if (!doc) return { error: 'That file is not a society file of this project.' }; }
    const att = b.attendees_count === '' || b.attendees_count == null ? null : Math.round(num(b.attendees_count)); if (att != null && (att < 0 || att > 100000)) return { error: 'Check the number of attendees.' };
    const ids = Array.isArray(b.attendee_ids) ? [...new Set(b.attendee_ids.map(Number).filter((x) => x > 0))].slice(0, 2000) : null;
    const owner = b.next_action_owner === '' || b.next_action_owner == null ? null : Number(b.next_action_owner);
    if (owner && !(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(owner).first())) return { error: 'Pick the person in charge from the list.' };
    return { v: { kind: ['general_body', 'committee', 'other'].includes(b.kind) ? b.kind : 'general_body', held, agenda: txt(b.agenda, 600), att, text: txt(b.resolution_text, 1000), passed: b.resolution_passed ? 1 : 0, doc: doc ? doc.id : null, action: txt(b.next_action, 200), due: b.next_action_due || null, ids, owner } };
  };
  const ATTEND_SQL = [
    'DELETE FROM red_meeting_attendees WHERE meeting_id = ?1',
    'INSERT OR IGNORE INTO red_meeting_attendees (meeting_id, member_id) SELECT ?1, m.id FROM json_each(?2) j JOIN red_members m ON m.id = j.value AND m.society_id = ?3 AND m.deleted_at IS NULL',
    'UPDATE red_meetings SET attendees_count = (SELECT COUNT(*) FROM red_meeting_attendees WHERE meeting_id = ?1) WHERE id = ?1',
  ];
  const attendStmts = (env, meetingId, ids, societyId) => (ids ? ATTEND_SQL.map((q, i) => (i === 1 ? env.DB.prepare(q).bind(meetingId, JSON.stringify(ids), societyId) : env.DB.prepare(q).bind(meetingId))) : []);
  router.post('/api/redev/societies/:id/meetings', async (req, env) => withAuth(req, env, 'redevelopment', 'C', async (req, env) => {
    try {
      const { soc, err } = await loadSociety(env, req, Number(req.params.id)); if (err) return err;
      const f = await meetingFields(env, await req.json().catch(() => ({})), soc); if (f.error) return bad(f.error); const v = f.v;
      const r = await env.DB.prepare('INSERT INTO red_meetings (society_id, kind, held_on, agenda, attendees_count, resolution_text, resolution_passed, minutes_document_id, next_action, next_action_due, created_by, created_at, next_action_owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(soc.id, v.kind, v.held, v.agenda, v.att, v.text, v.passed, v.doc, v.action, v.due, req.user.user_id, nowStr(), v.owner).run();
      if (v.ids) await env.DB.batch(attendStmts(env, r.meta.last_row_id, v.ids, soc.id));
      await audit(env, req.user, 'create', 'red_meetings', r.meta.last_row_id, `Logged a ${v.kind.replace('_', ' ')} meeting of ${soc.name} on ${v.held}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'red-meeting-add'); }
  }));
  router.put('/api/redev/meetings/:id', async (req, env) => withAuth(req, env, 'redevelopment', 'E', async (req, env) => {
    try {
      const mt = await env.DB.prepare('SELECT mt.*, s.project_id, s.name AS society_name FROM red_meetings mt JOIN red_societies s ON s.id = mt.society_id WHERE mt.id = ? AND mt.deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!mt) return bad('Meeting not found.', 404); if (!(await visibleProjectIds(env, req.user)).includes(mt.project_id)) return bad('Not allowed.', 403);
      const b = await req.json().catch(() => ({}));
      const f = await meetingFields(env, { ...mt, ...b, minutes_document_id: b.minutes_document_id !== undefined ? b.minutes_document_id : mt.minutes_document_id }, { project_id: mt.project_id }); if (f.error) return bad(f.error); const v = f.v;
      const done = b.next_action_done !== undefined ? (b.next_action_done ? 1 : 0) : mt.next_action_done;
      await env.DB.batch([env.DB.prepare('UPDATE red_meetings SET kind = ?, held_on = ?, agenda = ?, attendees_count = ?, resolution_text = ?, resolution_passed = ?, minutes_document_id = ?, next_action = ?, next_action_due = ?, next_action_done = ?, next_action_owner = ? WHERE id = ?')
        .bind(v.kind, v.held, v.agenda, v.att, v.text, v.passed, v.doc, v.action, v.due, done, b.next_action_owner !== undefined ? v.owner : mt.next_action_owner, mt.id), ...attendStmts(env, mt.id, v.ids, mt.society_id), audit(env, req.user, 'update', 'red_meetings', mt.id, `Edited the meeting of ${mt.society_name} on ${v.held}`)]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'red-meeting-edit'); }
  }));
}
