// routes/profile.js — staff profile (position, mobile, display picture), team directory, kudos, the daily line, and each person's work report.
import { QUOTES } from '../core/quotes.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const AVATAR_MAX = 400 * 1024;
const ENTITY_LABEL = { sal_leads: 'Leads', sal_visits: 'Site visits', sal_bookings: 'Bookings', sal_receipts: 'Receipts', sal_demands: 'Demand letters', sal_adjustments: 'Credit and debit notes', sal_cost_sheets: 'Cost sheets',
  sal_handover: 'Handovers', sal_booking_parties: 'Co-applicants', sal_inventory: 'Flats', sal_partners: 'Channel partners', sal_refunds: 'Refunds', pro_pos: 'Purchase orders', pro_vendors: 'Vendors', pro_bills: 'Vendor bills',
  pro_payments: 'Vendor payments', pro_indents: 'Material requests', pro_rfqs: 'RFQs', pro_party_docs: 'Contracts and documents', pro_professionals: 'Professionals', site_dprs: 'Daily site reports', site_snags: 'Snags',
  site_milestones: 'Milestones', apr_items: 'Approvals', drw_drawings: 'Drawings', drw_revisions: 'Drawing revisions', documents: 'Documents', con_contractors: 'Contractors', con_work_orders: 'Work orders', con_ra_bills: 'RA bills',
  con_payments: 'Contractor payments', stk_moves: 'Store movements', pty_entries: 'Petty cash', rera_account_entries: 'RERA account', bud_heads: 'Budget', users: 'Team and access', projects: 'Projects', fea_versions: 'Feasibility', settings: 'Settings' };

const istDay = (offset = 0) => new Date(Date.now() + 19800000 + offset * 86400000).toISOString().substring(0, 10);
const utcStamp = (d) => d.toISOString().replace('T', ' ').substring(0, 19);
// IST calendar day bounds as UTC timestamps (the database stores UTC).
const dayStartUtc = (day) => utcStamp(new Date(`${day}T00:00:00+05:30`));

export function dailyQuote(userId, date = istDay()) {
  const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
  return QUOTES[(((day + Number(userId) * 37) % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

function magicOk(mime, b) {
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/webp') return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
}

const W = 'created_at >= ?2 AND created_at < ?3';
// D1 allows only a few terms in a compound SELECT, so each count is its own statement, run together in one batch.
const HIGHLIGHTS = [
  ['Calls and notes logged on leads', `sal_activities WHERE by_user = ?1 AND ${W}`],
  ['Site visits marked done', `sal_visits WHERE by_user = ?1 AND status = 'done' AND ${W}`],
  ['Bookings made', `sal_bookings WHERE created_by = ?1 AND ${W}`],
  ['Receipts recorded', `sal_receipts WHERE received_by = ?1 AND ${W}`],
  ['Purchase orders raised', `pro_pos WHERE created_by = ?1 AND ${W}`],
  ['Material requests raised', `pro_indents WHERE requested_by = ?1 AND ${W}`],
  ['Daily site reports filed', `site_dprs WHERE created_by = ?1 AND ${W}`],
  ['Snags raised', `site_snags WHERE created_by = ?1 AND ${W}`],
  ['Work orders drawn up', `con_work_orders WHERE created_by = ?1 AND ${W}`],
  ['RA bills drawn up', `con_ra_bills WHERE created_by = ?1 AND ${W}`],
  ['Petty cash entries', `pty_entries WHERE created_by = ?1 AND ${W}`],
  ['Approvals and decisions given', `audit_log WHERE user_id = ?1 AND action IN ('approve', 'reject') AND ${W}`],
  ['Kudos given', `eng_kudos WHERE from_user = ?1 AND ${W}`],
];

export async function buildWorkReport(env, userId, from, to) {
  const f = dayStartUtc(from), t = dayStartUtc(new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString().substring(0, 10));
  const [days, areas, high, recent] = await Promise.all([
    env.DB.prepare("SELECT date(datetime(created_at, '+5 hours', '+30 minutes')) AS d, COUNT(*) AS n FROM audit_log WHERE user_id = ? AND created_at >= ? AND created_at < ? GROUP BY d ORDER BY d").bind(userId, f, t).all(),
    env.DB.prepare('SELECT entity, COUNT(*) AS n FROM audit_log WHERE user_id = ? AND created_at >= ? AND created_at < ? GROUP BY entity ORDER BY n DESC LIMIT 12').bind(userId, f, t).all(),
    env.DB.batch(HIGHLIGHTS.map(([, sql]) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(userId, f, t))),
    env.DB.prepare("SELECT datetime(created_at, '+5 hours', '+30 minutes') AS at, summary FROM audit_log WHERE user_id = ? AND created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT 15").bind(userId, f, t).all(),
  ]);
  // every day in the range, including the quiet ones, so the chart has no gaps
  const byDay = Object.fromEntries(days.results.map((r) => [r.d, r.n])); const series = [];
  for (let d = Date.parse(from + 'T00:00:00Z'); d <= Date.parse(to + 'T00:00:00Z'); d += 86400000) { const k = new Date(d).toISOString().substring(0, 10); series.push({ date: k, count: byDay[k] || 0 }); }
  const total = days.results.reduce((s, r) => s + r.n, 0);
  return { from, to, total, days: series, active_days: days.results.length,
    areas: areas.results.map((r) => ({ label: ENTITY_LABEL[r.entity] || String(r.entity || 'Other').replace(/_/g, ' '), n: r.n })),
    highlights: HIGHLIGHTS.map(([label], i) => ({ label, n: high[i].results[0].n })).filter((r) => r.n > 0), recent: recent.results };
}

export function registerProfile(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, printBrand, csvBom } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 300), nowStr());

  // ----- the line for today -----
  router.get('/api/me/quote', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    const date = istDay();
    return json({ ok: true, data: { quote: dailyQuote(req.user.user_id, date), date } });
  }));

  // ----- my profile -----
  router.put('/api/me/profile', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const b = await req.json();
      const name = String(b.name !== undefined ? b.name : req.user.name).trim().slice(0, 80);
      if (!name) return json({ ok: false, error: 'Your name cannot be empty.' }, 400);
      let phone = req.user.phone || '';
      if (b.phone !== undefined) {
        const dg = String(b.phone).replace(/\D/g, '');
        if (dg && dg.slice(-10).length !== 10) return json({ ok: false, error: 'Enter a 10-digit mobile number.' }, 400);
        phone = dg ? '+91' + dg.slice(-10) : '';
      }
      const position = b.position !== undefined ? String(b.position).trim().slice(0, 60) : (req.user.position || '');
      const about = b.about !== undefined ? String(b.about).trim().slice(0, 300) : (req.user.about || '');
      await env.DB.batch([env.DB.prepare('UPDATE users SET name = ?, phone = ?, position = ?, about = ? WHERE id = ?').bind(name, phone, position, about, req.user.user_id), audit(env, req.user, 'update', 'users', req.user.user_id, 'Updated own profile')]);
      return json({ ok: true, data: { name, phone, position, about } });
    } catch (e) { return serverError(e, 'profile-update'); }
  }));

  // ----- display picture: small, checked by its first bytes, shown only to signed-in colleagues -----
  router.post('/api/me/avatar', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const fd = await req.formData(); const file = fd.get('file');
      if (!file || typeof file === 'string') return json({ ok: false, error: 'Choose a picture first.' }, 400);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return json({ ok: false, error: 'Use a JPG, PNG or WebP picture.' }, 400);
      if (file.size > AVATAR_MAX) return json({ ok: false, error: 'That picture is too big. A small square photo is enough.' }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!magicOk(file.type, bytes)) return json({ ok: false, error: 'That file does not look like a picture. Please choose another.' }, 400);
      const old = (await env.DB.prepare('SELECT avatar_blob_id FROM users WHERE id = ?').bind(req.user.user_id).first()).avatar_blob_id;
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO file_blobs (mime, size_bytes, data, created_at) VALUES (?, ?, ?, ?)').bind(file.type, bytes.length, bytes, now),
        env.DB.prepare('UPDATE users SET avatar_blob_id = last_insert_rowid(), avatar_updated_at = ? WHERE id = ?').bind(now, req.user.user_id),
        ...(old ? [env.DB.prepare('DELETE FROM file_blobs WHERE id = ?').bind(old)] : []),
        audit(env, req.user, 'update', 'users', req.user.user_id, 'Changed own display picture'),
      ]);
      return json({ ok: true, data: { avatar_v: now } });
    } catch (e) { return serverError(e, 'avatar-upload'); }
  }));

  router.delete('/api/me/avatar', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const old = (await env.DB.prepare('SELECT avatar_blob_id FROM users WHERE id = ?').bind(req.user.user_id).first()).avatar_blob_id;
      await env.DB.batch([env.DB.prepare('UPDATE users SET avatar_blob_id = NULL, avatar_updated_at = NULL WHERE id = ?').bind(req.user.user_id), ...(old ? [env.DB.prepare('DELETE FROM file_blobs WHERE id = ?').bind(old)] : [])]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'avatar-delete'); }
  }));

  router.get('/api/users/:id/avatar', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const r = await env.DB.prepare(`SELECT b.mime, b.data FROM users u JOIN file_blobs b ON b.id = u.avatar_blob_id WHERE u.id = ? AND u.active = 1 AND u.deleted_at IS NULL`).bind(Number(req.params.id)).first();
      if (!r) return json({ ok: false, error: 'No picture.' }, 404);
      const bytes = r.data instanceof Uint8Array ? r.data : r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : Uint8Array.from(r.data || []);
      return new Response(bytes, { headers: { 'Content-Type': r.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' } });
    } catch (e) { return serverError(e, 'avatar-get'); }
  }));

  // ----- team directory (names, positions and pictures for everyone; phone numbers only for Owner and PM) -----
  router.get('/api/team', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const seePhone = ['owner', 'pm'].includes(req.user.role);
      const rows = (await env.DB.prepare(`SELECT u.id, u.name, u.position, u.about, u.role, u.phone, u.avatar_blob_id IS NOT NULL AS has_avatar, u.avatar_updated_at AS avatar_v,
          (SELECT COUNT(*) FROM eng_kudos k WHERE k.to_user = u.id AND k.deleted_at IS NULL AND k.created_at >= datetime('now', '-30 days')) AS kudos_30d
        FROM users u WHERE u.active = 1 AND u.deleted_at IS NULL ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'pm' THEN 1 ELSE 2 END, u.name LIMIT 200`).all()).results;
      for (const r of rows) { r.has_avatar = !!r.has_avatar; if (!seePhone) delete r.phone; }
      return json({ ok: true, data: { team: rows } });
    } catch (e) { return serverError(e, 'team'); }
  }));

  // ----- kudos: a short thank-you to a colleague -----
  router.post('/api/kudos', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const b = await req.json(); const to = Number(b.to_user); const msg = String(b.message || '').trim().slice(0, 140);
      if (!to || to === req.user.user_id) return json({ ok: false, error: 'Pick a colleague (not yourself).' }, 400);
      if (msg.length < 3) return json({ ok: false, error: 'Write a few words of thanks.' }, 400);
      const u = await env.DB.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(to).first();
      if (!u) return json({ ok: false, error: 'Colleague not found.' }, 404);
      const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM eng_kudos WHERE from_user = ? AND date(datetime(created_at, '+5 hours', '+30 minutes')) = ?").bind(req.user.user_id, istDay()).first();
      if (today.n >= 5) return json({ ok: false, error: 'You have already sent 5 thank-yous today. Come back tomorrow.' }, 429);
      const now = nowStr();
      await env.DB.batch([env.DB.prepare('INSERT INTO eng_kudos (from_user, to_user, message, created_at) VALUES (?, ?, ?, ?)').bind(req.user.user_id, to, msg, now),
        env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(to, `Thank you from ${req.user.name}`, msg, 'team', now)]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'kudos'); }
  }));

  router.get('/api/kudos', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const rows = (await env.DB.prepare(`SELECT k.id, k.message, k.created_at, f.name AS from_name, f.id AS from_id, t.name AS to_name, t.id AS to_id FROM eng_kudos k JOIN users f ON f.id = k.from_user JOIN users t ON t.id = k.to_user
        WHERE k.deleted_at IS NULL ORDER BY k.id DESC LIMIT 15`).all()).results;
      return json({ ok: true, data: { kudos: rows } });
    } catch (e) { return serverError(e, 'kudos-list'); }
  }));

  // ----- work report -----
  async function reportFor(env, req, forcedUid) {
    const q = new URL(req.url).searchParams;
    const uid = Number(forcedUid || q.get('user_id')) || req.user.user_id;
    if (uid !== req.user.user_id && !['owner', 'pm'].includes(req.user.role)) return { err: json({ ok: false, error: 'You can see your own work report. The Owner and PM can see anyone\'s.' }, 403) };
    const u = await env.DB.prepare('SELECT id, name, role, position FROM users WHERE id = ? AND deleted_at IS NULL').bind(uid).first();
    if (!u) return { err: json({ ok: false, error: 'Person not found.' }, 404) };
    const re = /^\d{4}-\d{2}-\d{2}$/;
    let to = re.test(q.get('to') || '') ? q.get('to') : istDay(); let from = re.test(q.get('from') || '') ? q.get('from') : istDay().substring(0, 8) + '01';
    if (from > to) [from, to] = [to, from];
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) from = new Date(Date.parse(to) - 92 * 86400000).toISOString().substring(0, 10);
    const rep = await buildWorkReport(env, uid, from, to);
    if (uid !== req.user.user_id) await audit(env, req.user, 'view', 'users', uid, `Viewed the work report of ${u.name}`).run();
    return { report: { person: u, ...rep } };
  }

  router.get('/api/reports/work', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const { report, err } = await reportFor(env, req); if (err) return err;
      if (new URL(req.url).searchParams.get('csv')) {
        const rows = [['Work report', report.person.name, report.person.position || '', `${report.from} to ${report.to}`], [], ['What', 'Count'], ...report.highlights.map((x) => [x.label, x.n]), [], ['Day', 'Actions recorded'], ...report.days.map((d) => [d.date, d.count]), [], ['Area', 'Actions'], ...report.areas.map((a) => [a.label, a.n])];
        return new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="work-report.csv"', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, data: report });
    } catch (e) { return serverError(e, 'work-report'); }
  }));

  router.get('/api/print/workreport/:id', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const { report, err } = await reportFor(env, req, Number(req.params.id)); if (err) return err;
      return json({ ok: true, data: { kind: 'workreport', draft: false, report, brand: await printBrand(env, null) } });
    } catch (e) { return serverError(e, 'print-workreport'); }
  }));
}
