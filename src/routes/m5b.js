// routes/m5b.js — Module 5, step 2: floor-plan library, possession notice, buyer links (joint inspection, handover slot, baseline sign-off),
// fit-out NOC, numbered debit note for a back-charge, the QR complaint form, common-area costs with the society statement, society formation.
// Buyers and residents never get a login: they use one-time links (token hashes only) or a public form behind Cloudflare Turnstile.
import { noDuesPoints, FUND_HEADS } from './m5.js';
import { phone10 } from './sales_ops.js';

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const MONEY = ['owner', 'pm', 'accounts'];
const sha256hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const newToken = () => { const a = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const nowPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').substring(0, 19);
export const EXPENSE_HEADS = { electricity: 'Electricity (common areas, lifts)', security: 'Security', housekeeping: 'Housekeeping', water: 'Water', lift_amc: 'Lift / equipment AMC', repairs: 'Repairs', other: 'Other' };
const STAGES = ['proposed', 'provisional', 'registered'];
const COMMITTEE_ROLES = ['chairman', 'secretary', 'treasurer', 'member'];

export function registerM5b(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, printBrand, sendMail, publicBase, clientIp, checkRateLimit } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const num = async (env, key, d) => { const raw = await getSetting(env, key); if (raw === null || raw === undefined || raw === '') return d; const v = Number(raw); return Number.isFinite(v) && v >= 0 ? v : d; };
  const proj = async (env, req, id) => { const pid = Number(id); return pid && (await visibleProjectIds(env, req.user)).includes(pid) ? pid : null; };
  const bookingOf = async (env, req, id) => {
    const b = await env.DB.prepare('SELECT b.*, i.wing, i.unit_no, i.type AS unit_type FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.id = ? AND b.deleted_at IS NULL').bind(Number(id)).first();
    if (!b || !(await visibleProjectIds(env, req.user)).includes(b.project_id)) return { err: bad('Booking not found.', 404) };
    return { b };
  };
  const flat = (b) => (b.wing ? b.wing + '-' : '') + b.unit_no;

  // ---------- floor-plan library ----------
  router.get('/api/plans', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const pid = await proj(env, req, new URL(req.url).searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      const rows = (await env.DB.prepare('SELECT p.id, p.unit_type, p.label, p.doc_id, p.created_at FROM plan_library p WHERE p.project_id = ? AND p.deleted_at IS NULL ORDER BY p.unit_type').bind(pid).all()).results;
      const types = (await env.DB.prepare("SELECT DISTINCT type FROM sal_inventory WHERE project_id = ? AND type IS NOT NULL AND type <> '' ORDER BY type").bind(pid).all()).results.map((r) => r.type);
      return json({ ok: true, data: { plans: rows, unit_types: types } });
    } catch (e) { return serverError(e, 'plans'); }
  }));
  router.post('/api/plans', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'site'].includes(req.user.role)) return bad('Not allowed.', 403);
      const b = await req.json().catch(() => ({})); const pid = await proj(env, req, b.project_id); if (!pid) return bad('Pick a project.');
      const type = String(b.unit_type || '').trim().slice(0, 30); if (!type) return bad('Enter the flat type (for example 2BHK).');
      if (!(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(b.doc_id), pid).first())) return bad('That plan file was not found in this project.');
      await env.DB.batch([
        env.DB.prepare('UPDATE plan_library SET deleted_at = ? WHERE project_id = ? AND unit_type = ? AND deleted_at IS NULL').bind(nowStr(), pid, type),
        env.DB.prepare('INSERT INTO plan_library (project_id, unit_type, label, doc_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(pid, type, String(b.label || '').trim().slice(0, 60) || null, Number(b.doc_id), req.user.user_id, nowStr()),
      ]);
      await audit(env, req.user, 'plan_library', 'plan_library', pid, `Floor plan for ${type} saved`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'plan-save'); }
  }));
  router.delete('/api/plans/:id', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can remove a plan.', 403);
      const p = await env.DB.prepare('SELECT id, project_id, unit_type FROM plan_library WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!p || !(await visibleProjectIds(env, req.user)).includes(p.project_id)) return bad('Not found.', 404);
      await env.DB.prepare('UPDATE plan_library SET deleted_at = ? WHERE id = ?').bind(nowStr(), p.id).run();
      await audit(env, req.user, 'plan_library_remove', 'plan_library', p.id, `Floor plan for ${p.unit_type} removed`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'plan-remove'); }
  }));
  router.get('/api/plans/for-unit', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const u = await env.DB.prepare('SELECT id, project_id, type FROM sal_inventory WHERE id = ?').bind(Number(new URL(req.url).searchParams.get('unit_id'))).first();
      if (!u || !(await visibleProjectIds(env, req.user)).includes(u.project_id)) return bad('Flat not found.', 404);
      const p = u.type ? await env.DB.prepare('SELECT doc_id FROM plan_library WHERE project_id = ? AND unit_type = ? AND deleted_at IS NULL').bind(u.project_id, u.type).first() : null;
      return json({ ok: true, data: { unit_type: u.type || '', doc_id: p ? p.doc_id : null } });
    } catch (e) { return serverError(e, 'plan-for-unit'); }
  }));

  // ---------- possession notice (amounts are typed by the team; this sets the date and prints the notice) ----------
  router.post('/api/sales/bookings/:id/possession-notice', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Only the Owner, PM or Accounts can issue the possession notice.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const ho = await env.DB.prepare('SELECT id, status FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      if (!ho) return bad('Open the handover first.', 404);
      if (ho.status === 'handed_over') return bad('The flat is already handed over.', 409);
      const body = await req.json().catch(() => ({}));
      const today = todayIST(); const days = await num(env, 'sales.possession_notice_days', 30);
      const due = body.pay_by ? String(body.pay_by) : plusDays(today, days);
      if (!isDate(due) || due < today) return bad('Enter the last date to pay as a date from today onwards.');
      await env.DB.prepare('UPDATE sal_handover SET notice_on = ?, notice_due_on = ? WHERE id = ?').bind(today, due, ho.id).run();
      await audit(env, req.user, 'possession_notice', 'sal_handover', ho.id, `Possession notice for ${b.customer_name} (${flat(b)}): pay by ${due}`);
      return json({ ok: true, data: { notice_on: today, notice_due_on: due } });
    } catch (e) { return serverError(e, 'poss-notice'); }
  }));
  router.get('/api/print/possnotice/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role) && req.user.role !== 'sales') return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      if (!ho || !ho.notice_on) return bad('Issue the possession notice first (booking, Possession notice).', 409);
      const [dem, funds, p] = await Promise.all([
        env.DB.prepare("SELECT label, amount_paise + COALESCE(gst_paise, 0) - settled_paise AS due FROM sal_demands WHERE booking_id = ? AND status NOT IN ('cancelled', 'scheduled') AND amount_paise + COALESCE(gst_paise, 0) - settled_paise > 0 ORDER BY id").bind(b.id).all(),
        env.DB.prepare("SELECT head, COALESCE(SUM(CASE kind WHEN 'due' THEN amount_paise END), 0) AS due, COALESCE(SUM(CASE kind WHEN 'received' THEN amount_paise END), 0) AS got FROM sal_possession_funds WHERE booking_id = ? AND reversed_at IS NULL GROUP BY head").bind(b.id).all(),
        env.DB.prepare('SELECT name, rera_no FROM projects WHERE id = ?').bind(b.project_id).first(),
      ]);
      const lines = [...dem.results.map((d) => ({ label: d.label, paise: d.due })), ...funds.results.filter((f) => f.due - f.got > 0).map((f) => ({ label: FUND_HEADS[f.head], paise: f.due - f.got }))];
      const brand = await printBrand(env, b.project_id).catch(() => ({}));
      return json({ ok: true, data: { kind: 'possnotice', draft: false, brand, customer_name: b.customer_name, address: b.address || '', project: p.name, rera_no: p.rera_no, flat: flat(b), notice_on: ho.notice_on, pay_by: ho.notice_due_on, lines, total_paise: lines.reduce((t, l) => t + l.paise, 0), bank: String((await getSetting(env, 'sales.collection_account_text')) || '') } });
    } catch (e) { return serverError(e, 'print-possnotice'); }
  }));

  // ---------- buyer links: joint inspection, handover slot, baseline sign-off ----------
  router.post('/api/sales/bookings/:id/hv-link', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const body = await req.json().catch(() => ({})); const kind = body.kind;
      if (!['inspection', 'slot', 'baseline'].includes(kind)) return bad('Pick inspection, slot or baseline.');
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      if (!ho) return bad('Open the handover first.', 404);
      if (ho.status === 'handed_over') return bad('The flat is already handed over.', 409);
      if (kind === 'inspection') {
        const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM site_snags WHERE unit_id = ? AND deleted_at IS NULL AND status <> 'verified'").bind(b.unit_id).first()).n;
        if (open) return bad(`${open} snag${open === 1 ? ' is' : 's are'} still open. Finish the builder's own snagging first; the buyer inspects only when it is zero.`, 409, 'snags_open');
      }
      if (kind === 'slot') {
        const nd = await noDuesPoints(env, getSetting, b);
        const red = nd.points.filter((p) => !p.ok);
        if (red.length) return bad(`The buyer can book a handover slot only when all six no-dues points are green. Not green: ${red.map((p) => p.label).join('; ')}.`, 409, 'nodues');
      }
      if (kind === 'baseline') {
        const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE entity = 'sal_handover' AND entity_id = ? AND deleted_at IS NULL AND title LIKE 'Baseline%'").bind(ho.id).first()).n;
        if (!n) return bad('Take and upload the baseline photographs of the flat first.', 409, 'no_baseline');
      }
      const token = newToken(); const days = await num(env, 'hv.link_days', 14);
      await env.DB.prepare('INSERT INTO sal_hv_links (booking_id, kind, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(b.id, kind, await sha256hex(token), nowPlus(days), req.user.user_id, nowStr()).run();
      const url = `${publicBase(env, req)}/h/${token}`;
      let emailed = null;
      if (body.send_email) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || ''))) return bad('This buyer has no email address on file.', 400);
        const brand = await printBrand(env, b.project_id).catch(() => ({})); const co = brand.trade_name || brand.legal_name || 'our team';
        const what = { inspection: 'inspect your flat and sign the joint inspection report', slot: 'choose a time to collect your keys', baseline: 'confirm the condition photographs of your flat at handover' }[kind];
        const r = await sendMail(env, b.email, `Your flat ${flat(b)}: ${kind === 'slot' ? 'choose your handover time' : 'please confirm'}`, `<p>Dear ${String(b.customer_name).replace(/[<>&]/g, '')},</p><p>Please use this link to ${what}:</p><p><a href="${url}">${url}</a></p><p>The link works for ${days} days and only once or twice. If you did not expect this, ignore it.</p><p>${co}</p>`, { template: 'hv_link' });
        emailed = r.sent;
      }
      await audit(env, req.user, 'hv_link', 'sal_handover', ho.id, `Buyer link (${kind}) made for ${b.customer_name} (${flat(b)})${emailed ? ' and emailed' : ''}`);
      return json({ ok: true, data: { url, days, emailed } });
    } catch (e) { return serverError(e, 'hv-link'); }
  }));

  router.get('/h/:token', async (req, env) => env.ASSETS.fetch(new Request(`${new URL(req.url).origin}/hv`, { method: 'GET', headers: req.headers })));
  const findLink = async (env, token) => env.DB.prepare(`SELECT l.*, b.customer_name, b.project_id, b.unit_id, b.status AS bk_status, i.wing, i.unit_no, p.name AS project_name FROM sal_hv_links l JOIN sal_bookings b ON b.id = l.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id WHERE l.token_hash = ?`).bind(await sha256hex(String(token))).first();

  router.get('/api/public/hv/:token', async (req, env) => {
    try {
      const rl = await checkRateLimit(env, `hv-ip:${clientIp(req)}`, 60, 10); if (!rl.allowed) return bad('Too many tries. Please wait a few minutes.', 429);
      const l = await findLink(env, req.params.token);
      if (!l || l.bk_status === 'cancelled') return json({ ok: true, data: { state: 'invalid' } });
      const brand = await printBrand(env, l.project_id).catch(() => ({}));
      const state = l.kind !== 'slot' && l.used_at ? 'done' : l.expires_at < nowStr() ? 'expired' : 'open';
      const out = { state, kind: l.kind, project: l.project_name, company: brand.trade_name || brand.legal_name || '', email: brand.email || '', phone: brand.phone || '', customer: String(l.customer_name).split(' ')[0], flat: (l.wing ? l.wing + '-' : '') + l.unit_no };
      if (state === 'open' && l.kind === 'slot') {
        const mine = await env.DB.prepare('SELECT id, slot_on, start_time, end_time FROM sal_handover_slots WHERE booking_id = ?').bind(l.booking_id).first();
        const free = (await env.DB.prepare('SELECT id, slot_on, start_time, end_time FROM sal_handover_slots WHERE project_id = ? AND booking_id IS NULL AND slot_on >= ? ORDER BY slot_on, start_time LIMIT 60').bind(l.project_id, todayIST()).all()).results;
        out.mine = mine || null; out.slots = free;
      }
      if (state === 'open' && l.kind === 'inspection') out.touchup_days = await num(env, 'hv.touchup_days', 7);
      return json({ ok: true, data: out });
    } catch (e) { return serverError(e, 'hv-get'); }
  });

  router.post('/api/public/hv/:token', async (req, env) => {
    try {
      const ip = clientIp(req);
      const rl = await checkRateLimit(env, `hv-ip:${ip}`, 60, 10); if (!rl.allowed) return bad('Too many tries. Please wait a few minutes.', 429);
      const l = await findLink(env, req.params.token); if (!l || l.bk_status === 'cancelled') return bad('This link is not valid.', 404);
      const tries = await checkRateLimit(env, `hv-tok:${l.id}`, 12, 30); if (!tries.allowed) return bad('Too many tries. Please call us.', 429);
      if (l.expires_at < nowStr()) return bad('This link has expired. Please ask us for a new one.', 410);
      if (l.kind !== 'slot' && l.used_at) return bad('This link has already been used.', 409);
      const b = await req.json().catch(() => ({})); const now = nowStr();
      const ho = await env.DB.prepare('SELECT id, status FROM sal_handover WHERE booking_id = ?').bind(l.booking_id).first();
      if (!ho || ho.status === 'handed_over') return bad('This handover is already complete.', 409);
      if (l.kind === 'slot') {
        const sid = Number(b.slot_id); if (!sid) return bad('Pick a time.');
        const claim = await env.DB.prepare('UPDATE sal_handover_slots SET booking_id = ?, booked_at = ? WHERE id = ? AND project_id = ? AND booking_id IS NULL AND slot_on >= ?').bind(l.booking_id, now, sid, l.project_id, todayIST()).run();
        if (!claim.meta.changes) return bad('That time was just taken. Please pick another.', 409);
        await env.DB.prepare('UPDATE sal_handover_slots SET booking_id = NULL, booked_at = NULL WHERE booking_id = ? AND id <> ?').bind(l.booking_id, sid).run();
        const slot = await env.DB.prepare('SELECT slot_on, start_time FROM sal_handover_slots WHERE id = ?').bind(sid).first();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'possession', ? FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm')").bind(`Handover time booked: ${(l.wing ? l.wing + '-' : '') + l.unit_no}`, `${l.customer_name} chose ${slot.slot_on} at ${slot.start_time}.`, now),
          env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (NULL, ?, ?, ?, ?, ?)').bind('hv_slot', 'sal_handover', ho.id, `${l.customer_name} booked the handover time ${slot.slot_on} ${slot.start_time}`, now),
        ]);
        return json({ ok: true, data: { slot_on: slot.slot_on, start_time: slot.start_time } });
      }
      const name = String(b.name || '').trim().slice(0, 80); if (name.length < 3) return bad('Please type your full name to sign.');
      if (b.confirm !== true) return bad('Please tick the box to confirm.');
      if (l.kind === 'inspection') {
        const touch = (Array.isArray(b.touchups) ? b.touchups : []).map((x) => String(x || '').trim().slice(0, 120)).filter(Boolean).slice(0, 8);
        const days = await num(env, 'hv.touchup_days', 7);
        const claim = await env.DB.prepare('UPDATE sal_hv_links SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now, l.id).run(); if (!claim.meta.changes) return bad('This link has already been used.', 409);
        await env.DB.batch([
          env.DB.prepare('UPDATE sal_handover SET inspection_on = ?, inspection_name = ?, inspection_remarks = ? WHERE id = ?').bind(todayIST(), name, touch.length ? touch.join('; ').slice(0, 480) : null, ho.id),
          ...touch.map((t) => env.DB.prepare("INSERT INTO site_snags (project_id, title, severity, status, unit_id, due_date, location, created_at) VALUES (?, ?, 'low', 'open', ?, ?, 'Buyer touch-up at joint inspection', ?)").bind(l.project_id, t, l.unit_id, plusDays(todayIST(), days), now)),
          env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'possession', ? FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm')").bind(`Joint inspection signed: ${(l.wing ? l.wing + '-' : '') + l.unit_no}`, `${name} signed${touch.length ? ' with ' + touch.length + ' touch-up(s) due in ' + days + ' days' : ' with no touch-ups'}.`, now),
          env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (NULL, ?, ?, ?, ?, ?)').bind('hv_inspection', 'sal_handover', ho.id, `Joint inspection signed by ${name}${touch.length ? '; touch-ups: ' + touch.join('; ').slice(0, 300) : ''}`.slice(0, 590), now),
        ]);
        return json({ ok: true, data: { touchups: touch.length, due_days: days } });
      }
      // baseline
      const claim = await env.DB.prepare('UPDATE sal_hv_links SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now, l.id).run(); if (!claim.meta.changes) return bad('This link has already been used.', 409);
      await env.DB.batch([
        env.DB.prepare('UPDATE sal_handover SET baseline_signed_on = ?, baseline_signed_name = ? WHERE id = ?').bind(now, name, ho.id),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (NULL, ?, ?, ?, ?, ?)').bind('hv_baseline', 'sal_handover', ho.id, `Baseline of the flat as handed over signed by ${name}`, now),
      ]);
      return json({ ok: true, data: { signed: true } });
    } catch (e) { return serverError(e, 'hv-post'); }
  });

  // ---------- handover slots (staff) ----------
  router.post('/api/sales/slots', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const b = await req.json().catch(() => ({})); const pid = await proj(env, req, b.project_id); if (!pid) return bad('Pick a project.');
      if (!isDate(b.date) || b.date < todayIST()) return bad('Pick a date from today onwards.');
      if (!isTime(b.start) || !isTime(b.end) || b.end <= b.start) return bad('Enter the start and end times (for example 10:00 and 13:00).');
      const mins = Math.round(Number(b.minutes) || 45); if (mins < 15 || mins > 180) return bad('A slot is between 15 and 180 minutes.');
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const rows = []; for (let m = toMin(b.start); m + mins <= toMin(b.end); m += mins) rows.push([fmt(m), fmt(m + mins)]);
      if (!rows.length) return bad('That time window is shorter than one slot.'); if (rows.length > 24) return bad('At most 24 slots a day in one go.');
      const res = await env.DB.batch(rows.map(([s, e]) => env.DB.prepare('INSERT OR IGNORE INTO sal_handover_slots (project_id, slot_on, start_time, end_time, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(pid, b.date, s, e, req.user.user_id, nowStr())));
      const added = res.reduce((t, r) => t + r.meta.changes, 0);
      await audit(env, req.user, 'slots_add', 'sal_handover_slots', pid, `${added} handover slot(s) added for ${b.date}`);
      return json({ ok: true, data: { added } });
    } catch (e) { return serverError(e, 'slots-add'); }
  }));
  router.get('/api/sales/slots', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const pid = await proj(env, req, new URL(req.url).searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      const rows = (await env.DB.prepare(`SELECT s.id, s.slot_on, s.start_time, s.end_time, s.booking_id, s.booked_at, b.customer_name, i.wing, i.unit_no FROM sal_handover_slots s LEFT JOIN sal_bookings b ON b.id = s.booking_id LEFT JOIN sal_inventory i ON i.id = b.unit_id WHERE s.project_id = ? AND s.slot_on >= ? ORDER BY s.slot_on, s.start_time LIMIT 300`).bind(pid, todayIST()).all()).results;
      return json({ ok: true, data: { slots: rows.map((r) => ({ ...r, flat: r.unit_no ? (r.wing ? r.wing + '-' : '') + r.unit_no : '' })) } });
    } catch (e) { return serverError(e, 'slots-list'); }
  }));
  router.delete('/api/sales/slots/:id', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const s = await env.DB.prepare('SELECT id, project_id, booking_id FROM sal_handover_slots WHERE id = ?').bind(Number(req.params.id)).first();
      if (!s || !(await visibleProjectIds(env, req.user)).includes(s.project_id)) return bad('Not found.', 404);
      if (s.booking_id) return bad('A buyer has booked this time. Ask them to pick another first.', 409);
      await env.DB.prepare('DELETE FROM sal_handover_slots WHERE id = ? AND booking_id IS NULL').bind(s.id).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'slots-del'); }
  }));

  // ---------- fit-out NOC ----------
  router.get('/api/sales/bookings/:id/fitout', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      const [dep, photos, noc, slot] = await Promise.all([
        env.DB.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'due' THEN amount_paise END), 0) AS due, COALESCE(SUM(CASE kind WHEN 'received' THEN amount_paise END), 0) AS got, COALESCE(SUM(CASE kind WHEN 'refunded' THEN amount_paise END), 0) AS back FROM sal_possession_funds WHERE booking_id = ? AND head = 'fitout_deposit' AND reversed_at IS NULL").bind(b.id).first(),
        ho ? env.DB.prepare("SELECT id, title, created_at FROM documents WHERE entity = 'sal_handover' AND entity_id = ? AND deleted_at IS NULL AND title LIKE 'Baseline%' ORDER BY id").bind(ho.id).all() : { results: [] },
        env.DB.prepare('SELECT * FROM sal_fitout_noc WHERE booking_id = ?').bind(b.id).first(),
        env.DB.prepare('SELECT slot_on, start_time, end_time FROM sal_handover_slots WHERE booking_id = ?').bind(b.id).first(),
      ]);
      return json({ ok: true, data: { handover: ho ? { id: ho.id, status: ho.status, inspection_on: ho.inspection_on, inspection_name: ho.inspection_name, inspection_remarks: ho.inspection_remarks, baseline_signed_on: ho.baseline_signed_on, baseline_signed_name: ho.baseline_signed_name, notice_on: ho.notice_on, notice_due_on: ho.notice_due_on } : null, deposit: { due: dep.due, received: dep.got, refunded: dep.back }, photos: photos.results, noc: noc || null, slot: slot || null } });
    } catch (e) { return serverError(e, 'fitout'); }
  }));
  router.post('/api/sales/bookings/:id/fitout-noc', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can issue the fit-out NOC.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      if (!ho || ho.status !== 'handed_over') return bad('The NOC is issued after the flat is handed over.', 409);
      if (await env.DB.prepare('SELECT id FROM sal_fitout_noc WHERE booking_id = ?').bind(b.id).first()) return bad('A fit-out NOC already exists for this flat.', 409);
      const dep = await env.DB.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'due' THEN amount_paise END), 0) AS due, COALESCE(SUM(CASE kind WHEN 'received' THEN amount_paise WHEN 'refunded' THEN -amount_paise END), 0) AS held FROM sal_possession_funds WHERE booking_id = ? AND head = 'fitout_deposit' AND reversed_at IS NULL").bind(b.id).first();
      if (!(dep.due > 0)) return bad('Set the fit-out deposit amount for this flat first.', 409, 'no_deposit');
      if (dep.held < dep.due) return bad(`The fit-out deposit is short by ${rupees(dep.due - dep.held)}.`, 409, 'deposit_short');
      if (!ho.baseline_signed_on) return bad('The buyer has not signed the baseline of the flat yet.', 409, 'no_baseline');
      const body = await req.json().catch(() => ({}));
      if (body.valid_till && (!isDate(body.valid_till) || body.valid_till < todayIST())) return bad('Enter the end date as a date from today onwards.');
      const proj0 = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(b.project_id).first();
      const no = `NOC-${proj0.code}-${String(b.id).padStart(5, '0')}`;
      await env.DB.prepare('INSERT INTO sal_fitout_noc (booking_id, noc_no, issued_on, valid_till, note, issued_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(b.id, no, todayIST(), body.valid_till || null, String(body.note || '').trim().slice(0, 200) || null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'fitout_noc', 'sal_bookings', b.id, `Fit-out NOC ${no} issued to ${b.customer_name} (${flat(b)})`);
      return json({ ok: true, data: { noc_no: no } });
    } catch (e) { return serverError(e, 'fitout-noc'); }
  }));
  router.post('/api/sales/bookings/:id/fitout-noc/revoke', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can revoke a NOC.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const reason = String((await req.json().catch(() => ({}))).reason || '').trim(); if (reason.length < 5) return bad('Write why it is being revoked.');
      const r = await env.DB.prepare("UPDATE sal_fitout_noc SET status = 'revoked', revoked_on = ?, revoked_reason = ? WHERE booking_id = ? AND status = 'issued'").bind(todayIST(), reason.slice(0, 200), b.id).run();
      if (!r.meta.changes) return bad('There is no live NOC for this flat.', 409);
      await audit(env, req.user, 'fitout_noc_revoke', 'sal_bookings', b.id, `Fit-out NOC of ${b.customer_name} revoked: ${reason.slice(0, 120)}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'fitout-revoke'); }
  }));
  router.get('/api/print/fitoutnoc/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const n = await env.DB.prepare('SELECT * FROM sal_fitout_noc WHERE booking_id = ?').bind(b.id).first();
      if (!n) return bad('No fit-out NOC has been issued for this flat.', 409);
      const p = await env.DB.prepare('SELECT name, rera_no FROM projects WHERE id = ?').bind(b.project_id).first();
      const dep = await env.DB.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'received' THEN amount_paise WHEN 'refunded' THEN -amount_paise END), 0) AS held FROM sal_possession_funds WHERE booking_id = ? AND head = 'fitout_deposit' AND reversed_at IS NULL").bind(b.id).first();
      return json({ ok: true, data: { kind: 'fitoutnoc', draft: n.status !== 'issued', brand: await printBrand(env, b.project_id).catch(() => ({})), noc_no: n.noc_no, status: n.status, issued_on: n.issued_on, valid_till: n.valid_till, customer_name: b.customer_name, project: p.name, flat: flat(b), deposit_paise: dep.held, baseline_signed_on: (await env.DB.prepare('SELECT baseline_signed_on FROM sal_handover WHERE booking_id = ?').bind(b.id).first() || {}).baseline_signed_on || null } });
    } catch (e) { return serverError(e, 'print-noc'); }
  }));

  // ---------- numbered debit note for a back-charge ----------
  router.get('/api/print/dlpdebit/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const t = await env.DB.prepare('SELECT t.*, c.name AS contractor, c.gstin, w.wo_no, p.name AS project, p.code FROM dlp_tickets t JOIN projects p ON p.id = t.project_id LEFT JOIN con_contractors c ON c.id = t.contractor_id LEFT JOIN con_work_orders w ON w.id = t.wo_id WHERE t.id = ? AND t.deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!t || !(await visibleProjectIds(env, req.user)).includes(t.project_id)) return bad('Ticket not found.', 404);
      if (t.backcharge_status !== 'cleared' || !t.debit_no) return bad('The debit note is made when Accounts confirms the back-charge.', 409);
      const left = (await env.DB.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'retention_held' THEN amount_paise WHEN 'retention_released' THEN -amount_paise END), 0) AS h FROM con_ledger WHERE wo_id = ?").bind(t.wo_id).first()).h;
      return json({ ok: true, data: { kind: 'dlpdebit', draft: false, brand: await printBrand(env, t.project_id).catch(() => ({})), debit_no: t.debit_no, debit_on: t.debit_on, contractor: t.contractor, gstin: t.gstin || '', wo_no: t.wo_no, project: t.project, ticket_title: t.title, raised_on: t.raised_on, sla_due_on: t.sla_due_on, repair_vendor: t.repair_vendor, amount_paise: t.backcharge_paise, retention_left_paise: left, note: t.backcharge_note || '' } });
    } catch (e) { return serverError(e, 'print-dlpdebit'); }
  }));

  // ---------- the QR complaint form (public) ----------
  const live = (env) => !!(env.TURNSTILE_MOCK || (env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY));
  const projByCode = (env, code) => (code ? env.DB.prepare("SELECT id, name, code FROM projects WHERE code = ? AND deleted_at IS NULL AND COALESCE(status, '') <> 'archived'").bind(String(code)).first() : null);
  router.get('/api/public/complaint-config', async (req, env) => {
    try {
      const p = await projByCode(env, new URL(req.url).searchParams.get('project'));
      if (!p) return json({ ok: true, data: { enabled: false } });
      const brand = await printBrand(env, p.id).catch(() => ({}));
      return json({ ok: true, data: { enabled: live(env), site_key: env.TURNSTILE_MOCK ? 'mock' : (env.TURNSTILE_SITE_KEY || ''), project: p.name, company: brand.trade_name || brand.legal_name || '', email: brand.email || '', phone: brand.phone || '' } });
    } catch (e) { return serverError(e, 'complaint-config'); }
  });
  router.post('/api/public/complaint', async (req, env) => {
    try {
      if (!live(env)) return bad('This form is not switched on yet. Please call or email us.', 503);
      const raw = await req.text(); if (raw.length > 6000) return bad('That is too long.', 413);
      let b; try { b = JSON.parse(raw); } catch (e) { return bad('Something went wrong. Please try again.'); }
      const ip = clientIp(req);
      if (!(await checkRateLimit(env, `cmp-ip:${ip}`, 6, 60)).allowed) return bad('Too many complaints from this connection. Please try again later or call us.', 429);
      if (!(await checkRateLimit(env, 'cmp-day', 300, 1440)).allowed) return bad('We are receiving a lot of messages. Please call us.', 429);
      if (String(b.company_website || '').trim()) return json({ ok: true, data: { received: true } });
      if (b.consent !== true) return bad('Please tick the box to say we may contact you.');
      const name = String(b.name || '').trim().slice(0, 80); const ph = phone10(b.phone);
      if (name.length < 2) return bad('Please enter your name.'); if (ph.length !== 10) return bad('Please enter a 10-digit mobile number.');
      const title = String(b.title || '').trim().slice(0, 120); if (title.length < 3) return bad('Please tell us what is wrong.');
      const token = String(b.token || ''); let human = false;
      if (env.TURNSTILE_MOCK) human = token === 'ok-token';
      else if (token) { const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }) }); human = !!((await r.json().catch(() => ({}))).success); }
      if (!human) return bad('We could not confirm you are a person. Please tick the check box and try again.', 403);
      const p = await projByCode(env, b.project); if (!p) return bad('This link is not valid. Please call us.', 404);
      const flatTxt = String(b.flat || '').trim().slice(0, 20);
      const unit = flatTxt ? await env.DB.prepare("SELECT id FROM sal_inventory WHERE project_id = ? AND (lower(unit_no) = lower(?) OR lower(COALESCE(wing, '') || '-' || unit_no) = lower(?)) LIMIT 1").bind(p.id, flatTxt, flatTxt).first() : null;
      const cat = ['plumbing', 'electrical', 'seepage', 'civil', 'finishing', 'other'].includes(b.category) ? b.category : 'other';
      const raised = todayIST(); const sla = await num(env, 'dlp.sla_days', 7);
      const detail = `${String(b.detail || '').trim().slice(0, 500)}${unit || !flatTxt ? '' : ` (flat typed: ${flatTxt})`}`.trim() || null;
      const r = await env.DB.prepare("INSERT INTO dlp_tickets (project_id, unit_id, raised_by_name, raised_phone, raised_via, category, title, detail, raised_on, sla_due_on, created_at) VALUES (?, ?, ?, ?, 'qr', ?, ?, ?, ?, ?, ?)")
        .bind(p.id, unit ? unit.id : null, name, ph, cat, title, detail, raised, plusDays(raised, sla), nowStr()).run();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'dlp', ? FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm', 'site')").bind(`New complaint: ${title.slice(0, 60)}`, `${name}${flatTxt ? ' (' + flatTxt + ')' : ''}, ${p.name}. Due by ${plusDays(raised, sla)}.`, nowStr()),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (NULL, ?, ?, ?, ?, ?)').bind('dlp_create', 'dlp_tickets', r.meta.last_row_id, `Complaint through the QR form: ${title.slice(0, 80)}`, nowStr()),
      ]);
      return json({ ok: true, data: { received: true, due_by: plusDays(raised, sla) } });
    } catch (e) { return serverError(e, 'complaint'); }
  });
  router.get('/api/dlp/qr-link', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const pid = await proj(env, req, new URL(req.url).searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      const p = await env.DB.prepare('SELECT code, name FROM projects WHERE id = ?').bind(pid).first(); const brand = await printBrand(env, pid).catch(() => ({}));
      return json({ ok: true, data: { url: `${publicBase(env, req)}/complaint?project=${encodeURIComponent(p.code)}`, project: p.name, email: brand.email || '', phone: brand.phone || '', live: live(env) } });
    } catch (e) { return serverError(e, 'dlp-qr'); }
  }));

  // ---------- common-area costs and the society statement ----------
  router.post('/api/chs/expenses', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Only the Owner, PM or Accounts can enter costs.', 403);
      const b = await req.json().catch(() => ({})); const pid = await proj(env, req, b.project_id); if (!pid) return bad('Pick a project.');
      if (!EXPENSE_HEADS[b.head]) return bad('Pick what the cost is for.');
      const amount = Math.round(Number(b.amount_paise)); if (!(amount > 0)) return bad('Enter the amount.');
      const on = b.spent_on ? String(b.spent_on) : todayIST(); if (!isDate(on) || on > todayIST()) return bad('Enter the date as a proper date, not in the future.');
      if (String(b.bill_no || '').trim().length < 2) return bad('Enter the bill or voucher number.');
      const r = await env.DB.prepare('INSERT INTO chs_expenses (project_id, spent_on, head, amount_paise, bill_no, paid_to, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(pid, on, b.head, amount, String(b.bill_no).trim().slice(0, 40), String(b.paid_to || '').trim().slice(0, 80) || null, String(b.note || '').trim().slice(0, 200) || null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'chs_expense', 'chs_expenses', r.meta.last_row_id, `Common-area cost ${rupees(amount)} (${EXPENSE_HEADS[b.head]}), bill ${String(b.bill_no).slice(0, 30)}`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'chs-expense'); }
  }));
  router.post('/api/chs/expenses/:id/certify', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return bad('Only the Owner or Accounts can record the CA certification.', 403);
      const x = await env.DB.prepare('SELECT * FROM chs_expenses WHERE id = ?').bind(Number(req.params.id)).first();
      if (!x || !(await visibleProjectIds(env, req.user)).includes(x.project_id)) return bad('Not found.', 404);
      if (x.reversed_at) return bad('This entry was reversed.', 409); if (x.certified_on) return bad('Already certified.', 409);
      const who = String((await req.json().catch(() => ({}))).certified_by_name || '').trim(); if (who.length < 3) return bad("Type the name of the CA who certified it.");
      await env.DB.prepare('UPDATE chs_expenses SET certified_by_name = ?, certified_on = ? WHERE id = ? AND certified_on IS NULL').bind(who.slice(0, 80), todayIST(), x.id).run();
      await audit(env, req.user, 'chs_expense_certify', 'chs_expenses', x.id, `Cost ${rupees(x.amount_paise)} (bill ${x.bill_no}) certified by ${who.slice(0, 60)}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-certify'); }
  }));
  router.post('/api/chs/expenses/:id/reverse', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can reverse an entry.', 403);
      const x = await env.DB.prepare('SELECT * FROM chs_expenses WHERE id = ?').bind(Number(req.params.id)).first();
      if (!x || !(await visibleProjectIds(env, req.user)).includes(x.project_id)) return bad('Not found.', 404);
      if (x.reversed_at) return bad('Already reversed.', 409);
      const reason = String((await req.json().catch(() => ({}))).reason || '').trim(); if (reason.length < 5) return bad('Write why it is being reversed.');
      await env.DB.prepare('UPDATE chs_expenses SET reversed_at = ?, reversed_by = ?, reverse_reason = ? WHERE id = ?').bind(nowStr(), req.user.user_id, reason.slice(0, 200), x.id).run();
      await audit(env, req.user, 'chs_expense_reverse', 'chs_expenses', x.id, `Cost ${rupees(x.amount_paise)} (bill ${x.bill_no}) reversed: ${reason.slice(0, 120)}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-exp-rev'); }
  }));
  const statement = async (env, pid) => {
    const [col, ex, p] = await Promise.all([
      env.DB.prepare(`SELECT f.head, COALESCE(SUM(CASE WHEN f.kind = 'received' THEN f.amount_paise END), 0) AS got, COALESCE(SUM(CASE WHEN f.kind = 'refunded' THEN f.amount_paise END), 0) AS back FROM sal_possession_funds f JOIN sal_bookings b ON b.id = f.booking_id WHERE b.project_id = ? AND f.reversed_at IS NULL GROUP BY f.head`).bind(pid).all(),
      env.DB.prepare('SELECT * FROM chs_expenses WHERE project_id = ? AND reversed_at IS NULL ORDER BY spent_on, id LIMIT 2000').bind(pid).all(),
      env.DB.prepare('SELECT name, rera_no FROM projects WHERE id = ?').bind(pid).first(),
    ]);
    const heads = {}; for (const r of col.results) heads[r.head] = { label: FUND_HEADS[r.head], collected: r.got - r.back };
    const spend = ex.results; const cert = spend.filter((x) => x.certified_on), uncert = spend.filter((x) => !x.certified_on);
    const sum = (a) => a.reduce((t, x) => t + x.amount_paise, 0);
    const byHead = {}; for (const x of cert) byHead[x.head] = (byHead[x.head] || 0) + x.amount_paise;
    const collected = ((heads.maintenance || {}).collected || 0);   // advance maintenance pays for running costs; corpus is held for the society, not spent
    return { project: p.name, rera_no: p.rera_no, heads, maintenance_collected_paise: collected, corpus_held_paise: (heads.corpus || {}).collected || 0, share_money_paise: (heads.share_money || {}).collected || 0,
      certified_paise: sum(cert), uncertified_paise: sum(uncert), by_head: Object.entries(byHead).map(([k, v]) => ({ head: k, label: EXPENSE_HEADS[k] || k, paise: v })), expenses: spend,
      balance_to_hand_over_paise: collected - sum(cert), note: 'Advance maintenance collected, less costs the CA has certified. Corpus and share money are held for the society and are not spent. Costs not yet certified are listed but not deducted.' };
  };
  router.get('/api/chs/statement', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const u = new URL(req.url); const pid = await proj(env, req, u.searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      const s = await statement(env, pid);
      if (u.searchParams.get('csv')) {
        const cell = (v) => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const lines = [['Date', 'Head', 'Bill no.', 'Paid to', 'Amount', 'Certified by', 'Certified on'].join(','), ...s.expenses.map((x) => [x.spent_on, EXPENSE_HEADS[x.head], x.bill_no, x.paid_to, x.amount_paise / 100, x.certified_by_name, x.certified_on].map(cell).join(',')), '', ['Advance maintenance collected', s.maintenance_collected_paise / 100].join(','), ['Certified costs', s.certified_paise / 100].join(','), ['Balance to hand over', s.balance_to_hand_over_paise / 100].join(',')];
        return new Response('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="society-statement.csv"', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, data: s });
    } catch (e) { return serverError(e, 'chs-statement'); }
  }));
  router.get('/api/print/chsstatement/:id', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const pid = await proj(env, req, req.params.id); if (!pid) return bad('Project not found.', 404);
      const s = await statement(env, pid);
      return json({ ok: true, data: { kind: 'chsstatement', draft: s.uncertified_paise > 0, brand: await printBrand(env, pid).catch(() => ({})), as_on: todayIST(), ...s, expenses: s.expenses.map((x) => ({ spent_on: x.spent_on, head: EXPENSE_HEADS[x.head], bill_no: x.bill_no, paid_to: x.paid_to, amount_paise: x.amount_paise, certified: !!x.certified_on })) } });
    } catch (e) { return serverError(e, 'print-chs'); }
  }));
  router.get('/api/chs/expenses', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const pid = await proj(env, req, new URL(req.url).searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      const rows = (await env.DB.prepare('SELECT * FROM chs_expenses WHERE project_id = ? ORDER BY spent_on DESC, id DESC LIMIT 300').bind(pid).all()).results;
      return json({ ok: true, data: { expenses: rows, heads: EXPENSE_HEADS } });
    } catch (e) { return serverError(e, 'chs-exp-list'); }
  }));

  // ---------- society formation ----------
  router.get('/api/chs/society', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = await proj(env, req, new URL(req.url).searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      const [s, c] = await Promise.all([env.DB.prepare('SELECT * FROM chs_society WHERE project_id = ?').bind(pid).first(), env.DB.prepare('SELECT id, role, name, phone, since FROM chs_committee WHERE project_id = ? AND deleted_at IS NULL ORDER BY id').bind(pid).all()]);
      return json({ ok: true, data: { society: s || { project_id: pid, stage: 'proposed', share_cert_count: 0 }, committee: c.results } });
    } catch (e) { return serverError(e, 'chs-society'); }
  }));
  router.put('/api/chs/society', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can update the society.', 403);
      const b = await req.json().catch(() => ({})); const pid = await proj(env, req, b.project_id); if (!pid) return bad('Pick a project.');
      const cur = (await env.DB.prepare('SELECT * FROM chs_society WHERE project_id = ?').bind(pid).first()) || {};
      const v = { ...cur, ...b };
      const stage = STAGES.includes(v.stage) ? v.stage : 'proposed';
      if (stage === 'registered' && (!String(v.registration_no || '').trim() || !isDate(v.registered_on))) return bad('A registered society needs its registration number and the date of registration.');
      if (v.registered_on && !isDate(v.registered_on)) return bad('Enter the registration date as a proper date.');
      if (v.shares_issued_on && !isDate(v.shares_issued_on)) return bad('Enter the share-certificate date as a proper date.');
      if (v.conveyance_on) { if (!isDate(v.conveyance_on)) return bad('Enter the conveyance date as a proper date.'); if (stage !== 'registered') return bad('Conveyance can be recorded only after the society is registered.'); if (String(v.conveyance_ref || '').trim().length < 3) return bad('Enter the conveyance deed registration reference.'); }
      const certs = Math.round(Number(v.share_cert_count) || 0); if (certs < 0 || certs > 5000) return bad('Check the number of share certificates.');
      await env.DB.prepare(`INSERT INTO chs_society (project_id, society_name, stage, registration_no, registered_on, share_cert_count, shares_issued_on, conveyance_on, conveyance_ref, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET society_name = excluded.society_name, stage = excluded.stage, registration_no = excluded.registration_no, registered_on = excluded.registered_on, share_cert_count = excluded.share_cert_count, shares_issued_on = excluded.shares_issued_on, conveyance_on = excluded.conveyance_on, conveyance_ref = excluded.conveyance_ref, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(pid, String(v.society_name || '').trim().slice(0, 120) || null, stage, String(v.registration_no || '').trim().slice(0, 60) || null, v.registered_on || null, certs, v.shares_issued_on || null, v.conveyance_on || null, String(v.conveyance_ref || '').trim().slice(0, 80) || null, String(v.notes || '').trim().slice(0, 300) || null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'chs_society', 'chs_society', pid, `Society record updated: ${stage}${v.registration_no ? ', reg. ' + String(v.registration_no).slice(0, 30) : ''}${v.conveyance_on ? ', conveyance ' + v.conveyance_on : ''}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-society-save'); }
  }));
  router.post('/api/chs/committee', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can update the committee.', 403);
      const b = await req.json().catch(() => ({})); const pid = await proj(env, req, b.project_id); if (!pid) return bad('Pick a project.');
      if (!COMMITTEE_ROLES.includes(b.role)) return bad('Pick the role.'); const name = String(b.name || '').trim(); if (name.length < 3) return bad("Enter the member's name.");
      if (b.phone && phone10(b.phone).length !== 10) return bad('Enter a 10-digit mobile number.'); if (b.since && !isDate(b.since)) return bad('Enter the date as a proper date.');
      if (['chairman', 'secretary', 'treasurer'].includes(b.role) && (await env.DB.prepare('SELECT id FROM chs_committee WHERE project_id = ? AND role = ? AND deleted_at IS NULL').bind(pid, b.role).first())) return bad(`There is already a ${b.role}. Remove them first.`, 409);
      const r = await env.DB.prepare('INSERT INTO chs_committee (project_id, role, name, phone, since, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(pid, b.role, name.slice(0, 80), b.phone ? phone10(b.phone) : null, b.since || null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'chs_committee', 'chs_committee', r.meta.last_row_id, `Committee: ${b.role} ${name.slice(0, 60)} added`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'chs-committee'); }
  }));
  router.delete('/api/chs/committee/:id', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Not allowed.', 403);
      const c = await env.DB.prepare('SELECT * FROM chs_committee WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!c || !(await visibleProjectIds(env, req.user)).includes(c.project_id)) return bad('Not found.', 404);
      await env.DB.prepare('UPDATE chs_committee SET deleted_at = ? WHERE id = ?').bind(nowStr(), c.id).run();
      await audit(env, req.user, 'chs_committee_remove', 'chs_committee', c.id, `Committee: ${c.role} ${c.name.slice(0, 60)} removed`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-committee-rm'); }
  }));
}
