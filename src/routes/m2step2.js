// routes/m2step2.js — Module 2 gaps, step 2: token proof on holds (cleared by Accounts), reception check-in with buyer confirmation
// and the broker source lock, one-tap WhatsApp texts (welcome pack, site updates). No SMS and no WhatsApp API: nothing here costs money.
// Rules and days come from Settings. Buyers and brokers never get a login: the buyer opens a one-time page from the reception QR.
import { shared, phone10 } from './sales_ops.js';

const TOKEN_MODES = ['upi', 'neft', 'cheque'];
const MANAGER = ['owner', 'pm'];
const CLEARERS = ['owner', 'pm', 'accounts'];
const CHECKIN_MINUTES = 30;
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const sha256hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const newToken = () => { const a = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const addMinutes = (m) => new Date(Date.now() + m * 60000).toISOString().replace('T', ' ').substring(0, 19);
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const plusDaysIST = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const positive = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

// ---- used by the hold route in sales_ops.js ----
// A salesperson must give the token proof (UTR or cheque number, amount) to block a flat. Owner and PM may block without it.
export async function holdTokenCheck(env, getSetting, user, b) {
  const given = b.token_ref || b.token_mode || b.token_amount_paise;
  const needed = !MANAGER.includes(user.role) && (await getSetting(env, 'sales.hold_needs_token')) !== 'off';
  if (!given && !needed) return { token: null };
  const mode = String(b.token_mode || '').toLowerCase(); const ref = String(b.token_ref || '').trim().slice(0, 40); const amount = Math.round(Number(b.token_amount_paise) || 0);
  if (!TOKEN_MODES.includes(mode)) return { error: 'To block a flat, say how the token was paid: UPI, NEFT or cheque.' };
  if (ref.length < 4) return { error: 'Enter the UTR number or the cheque number of the token.' };
  if (!(amount > 0)) return { error: 'Enter the token amount received.' };
  const proof = b.proof_doc_id ? Number(b.proof_doc_id) : null;
  if (proof && !(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL').bind(proof).first())) return { error: 'The proof document was not found.' };
  return { token: { mode, ref, amount, proof } };
}
export function holdTokenInsert(env, unit, user, leadId, holdAt, t, nowStr) {
  return env.DB.batch([
    env.DB.prepare('INSERT INTO sal_hold_tokens (unit_id, lead_id, held_by, hold_at, amount_paise, mode, ref_no, proof_doc_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(unit.id, leadId, user.user_id, holdAt, t.amount, t.mode, t.ref, t.proof, nowStr()),
    env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'tokens', ? FROM users WHERE active = 1 AND deleted_at IS NULL AND role = 'accounts'")
      .bind(`Token to clear: ${unit.wing ? unit.wing + '-' : ''}${unit.unit_no}`, `${rupees(t.amount)} by ${t.mode.toUpperCase()}, ref ${t.ref}. Confirm it reached the bank within 48 hours or the flat goes back on sale.`, nowStr()),
  ]);
}

export function registerM2Step2(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, checkRateLimit, clientIp, printBrand } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const ph = (a) => a.map(() => '?').join(',');

  // ================= Token holds: Accounts confirms the token reached the bank =================
  router.get('/api/sales/token-holds', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!CLEARERS.includes(req.user.role)) return bad('Not allowed.', 403);
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { tokens: [] } });
      const rows = (await env.DB.prepare(`SELECT t.id, t.amount_paise, t.mode, t.ref_no, t.proof_doc_id, t.created_at, i.wing, i.unit_no, i.blocked_till, u.name AS holder, l.name AS lead_name
        FROM sal_hold_tokens t JOIN sal_inventory i ON i.id = t.unit_id AND i.status = 'held' AND i.hold_at = t.hold_at LEFT JOIN users u ON u.id = t.held_by LEFT JOIN sal_leads l ON l.id = t.lead_id
        WHERE t.status = 'pending' AND i.project_id IN (${ph(ids)}) ORDER BY i.blocked_till LIMIT 100`).bind(...ids).all()).results;
      return json({ ok: true, data: { tokens: rows } });
    } catch (e) { return serverError(e, 'tokens'); }
  }));

  const loadToken = async (env, req) => {
    const t = await env.DB.prepare(`SELECT t.*, i.project_id, i.wing, i.unit_no, i.status AS unit_status, i.hold_at AS unit_hold_at, i.hold_by FROM sal_hold_tokens t JOIN sal_inventory i ON i.id = t.unit_id WHERE t.id = ?`).bind(Number(req.params.id)).first();
    if (!t || !(await visibleProjectIds(env, req.user)).includes(t.project_id)) return { err: bad('Token not found.', 404) };
    if (!CLEARERS.includes(req.user.role)) return { err: bad('Only Accounts, the PM or the Owner can do this.', 403) };
    return { t };
  };

  router.post('/api/sales/token-holds/:id/clear', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { t, err } = await loadToken(env, req); if (err) return err;
      if (t.unit_status !== 'held' || t.unit_hold_at !== t.hold_at) return bad('This hold has already ended, so the token cannot be cleared. The flat is back on sale.', 409);
      const r = await env.DB.prepare("UPDATE sal_hold_tokens SET status = 'cleared', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(req.user.user_id, nowStr(), t.id).run();
      if (!r.meta.changes) return bad('This token was already decided.', 409);
      const days = positive(await getSetting(env, 'sales.token_cleared_hold_days'), 7);
      const until = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.batch([
        env.DB.prepare("UPDATE sal_inventory SET blocked_till = ? WHERE id = ? AND status = 'held' AND hold_at = ?").bind(until, t.unit_id, t.hold_at),
        env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(t.held_by, `Token cleared: ${t.wing ? t.wing + '-' : ''}${t.unit_no}`, `The flat stays yours for ${days} days. Complete the booking.`, 'sales', nowStr()),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'token_clear', 'sal_inventory', t.unit_id, `Token ${rupees(t.amount_paise)} (${t.mode} ${t.ref_no}) cleared for ${t.wing ? t.wing + '-' : ''}${t.unit_no}; hold extended to ${until}`, nowStr()),
      ]);
      return json({ ok: true, data: { blocked_till: until } });
    } catch (e) { return serverError(e, 'token-clear'); }
  }));

  router.post('/api/sales/token-holds/:id/reject', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { t, err } = await loadToken(env, req); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (String(b.note || '').trim().length < 3) return bad('Say why the token is not accepted (for example: not received in the bank).');
      const r = await env.DB.prepare("UPDATE sal_hold_tokens SET status = 'rejected', decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND status = 'pending'").bind(req.user.user_id, nowStr(), String(b.note).trim().slice(0, 200), t.id).run();
      if (!r.meta.changes) return bad('This token was already decided.', 409);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO sal_hold_log (unit_id, user_id, lead_id, held_at, ended_at, reason) SELECT id, hold_by, hold_lead_id, hold_at, ?, 'rejected' FROM sal_inventory WHERE id = ? AND status = 'held' AND hold_at = ?").bind(nowStr(), t.unit_id, t.hold_at),
        env.DB.prepare("UPDATE sal_inventory SET status = 'available', hold_by = NULL, hold_lead_id = NULL, hold_at = NULL, blocked_till = NULL WHERE id = ? AND status = 'held' AND hold_at = ?").bind(t.unit_id, t.hold_at),
        env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(t.held_by, `Token not accepted: ${t.wing ? t.wing + '-' : ''}${t.unit_no}`, `${String(b.note).trim().slice(0, 150)}. The flat is back on sale.`, 'sales', nowStr()),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'token_reject', 'sal_inventory', t.unit_id, `Token ${rupees(t.amount_paise)} (${t.mode} ${t.ref_no}) rejected for ${t.wing ? t.wing + '-' : ''}${t.unit_no}: ${String(b.note).trim().slice(0, 200)}. Hold released.`, nowStr()),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'token-reject'); }
  }));

  // ================= Reception check-in =================
  router.get('/api/sales/partner-names', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try { return json({ ok: true, data: { partners: (await env.DB.prepare('SELECT id, firm FROM sal_partners WHERE deleted_at IS NULL AND active = 1 ORDER BY firm LIMIT 300').all()).results } }); } catch (e) { return serverError(e, 'partner-names'); }
  }));

  router.post('/api/sales/checkins', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const n = phone10(b.phone); if (n.length !== 10) return bad('Enter the buyer\'s 10-digit mobile number.');
      const name = String(b.name || '').trim().slice(0, 120); if (name.length < 2) return bad('Enter the buyer\'s name.');
      const claimed = b.partner_id ? await env.DB.prepare('SELECT id, firm FROM sal_partners WHERE id = ? AND deleted_at IS NULL AND active = 1').bind(Number(b.partner_id)).first() : null;
      if (b.partner_id && !claimed) return bad('Unknown channel partner.');
      const lead = await env.DB.prepare(`SELECT l.id, l.name, l.channel_partner_id, l.created_at, l.source_confirmed_at, l.source_locked_until, p.firm FROM sal_leads l LEFT JOIN sal_partners p ON p.id = l.channel_partner_id WHERE l.phone_norm = ? AND l.deleted_at IS NULL ORDER BY l.id LIMIT 1`).bind(n).first();
      // First registration wins. A broker who claims a buyer somebody else (or our own team) registered first does not get the claim.
      let partnerId = claimed ? claimed.id : null, conflict = null;
      if (lead) {
        const first = lead.channel_partner_id || null;
        if (claimed && first !== claimed.id) { conflict = `This number was registered earlier (${String(lead.created_at).slice(0, 10)}) by ${lead.firm ? 'channel partner ' + lead.firm : 'our direct team'}. The broker you picked does not get the claim.`; partnerId = first; }
        else if (!claimed) partnerId = first;
      }
      const token = newToken(); const now = nowStr();
      const r = await env.DB.prepare('INSERT INTO sal_checkins (project_id, phone_norm, name, partner_id, token_hash, lead_id, conflict_note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(pid, n, name, partnerId, await sha256hex(token), lead ? lead.id : null, conflict, req.user.user_id, now, addMinutes(CHECKIN_MINUTES)).run();
      let firm = claimed && partnerId === claimed.id ? claimed.firm : (lead && lead.firm && partnerId === lead.channel_partner_id ? lead.firm : null);
      return json({ ok: true, data: { id: r.meta.last_row_id, link: `/c/${token}`, minutes: CHECKIN_MINUTES, partner_firm: firm, conflict, returning: lead ? { name: lead.name, on: String(lead.created_at).slice(0, 10) } : null } });
    } catch (e) { return serverError(e, 'checkin-create'); }
  }));

  router.get('/api/sales/checkins', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { checkins: [] } });
      const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
      const rows = (await env.DB.prepare(`SELECT c.id, c.name, c.status, c.answer, c.conflict_note, c.created_at, c.confirmed_at, c.expires_at, p.firm FROM sal_checkins c LEFT JOIN sal_partners p ON p.id = c.partner_id
        WHERE c.project_id IN (${ph(ids)}) AND c.created_at >= ? ORDER BY c.id DESC LIMIT 100`).bind(...ids, new Date(Date.parse(today + 'T00:00:00Z') - 19800000).toISOString().replace('T', ' ').substring(0, 19)).all()).results;
      return json({ ok: true, data: { checkins: rows } });
    } catch (e) { return serverError(e, 'checkin-list'); }
  }));

  // ---- the buyer's page: no login. A one-time link, 30 minutes, the buyer types their own number. ----
  const findCheckin = async (env, token) => env.DB.prepare(`SELECT c.*, pr.name AS project_name, pa.firm FROM sal_checkins c JOIN projects pr ON pr.id = c.project_id LEFT JOIN sal_partners pa ON pa.id = c.partner_id WHERE c.token_hash = ?`).bind(await sha256hex(token)).first();

  router.get('/c/:token', async (req, env) => env.ASSETS.fetch(new Request(`${new URL(req.url).origin}/c`, { method: 'GET', headers: req.headers })));

  router.get('/api/public/checkin/:token', async (req, env) => {
    try {
      const rl = await checkRateLimit(env, `ci-ip:${clientIp(req)}`, 60, 10); if (!rl.allowed) return bad('Too many tries. Please wait a few minutes.', 429);
      const c = await findCheckin(env, String(req.params.token));
      if (!c) return json({ ok: true, data: { state: 'invalid' } });
      const state = c.status !== 'pending' ? 'done' : (c.expires_at < nowStr() ? 'expired' : 'pending');
      const brand = await printBrand(env, c.project_id);
      return json({ ok: true, data: { state, project: c.project_name, company: brand.trade_name || brand.legal_name || '', firm: state === 'pending' ? c.firm : null } });
    } catch (e) { return serverError(e, 'checkin-get'); }
  });

  router.post('/api/public/checkin/:token', async (req, env) => {
    try {
      const rl = await checkRateLimit(env, `ci-ip:${clientIp(req)}`, 60, 10); if (!rl.allowed) return bad('Too many tries. Please wait a few minutes.', 429);
      const c = await findCheckin(env, String(req.params.token));
      if (!c) return bad('This link is not valid.', 404);
      const tries = await checkRateLimit(env, `ci-tok:${c.id}`, 6, 30); if (!tries.allowed) return bad('Too many wrong tries. Please ask at the reception desk.', 429);
      const b = await req.json().catch(() => ({}));
      if (c.status !== 'pending') return bad('This check-in is already done.', 409);
      if (c.expires_at < nowStr()) return bad('This link has expired. Please ask at the reception desk for a new one.', 410);
      if (phone10(b.phone) !== c.phone_norm) return bad('That mobile number does not match the one given at the reception desk.');
      if (!['yes', 'no'].includes(b.answer)) return bad('Please choose Yes or No.');
      const status = b.answer === 'yes' ? 'confirmed' : 'declined'; const now = nowStr();
      const claim = await env.DB.prepare("UPDATE sal_checkins SET status = ?, answer = ?, confirmed_at = ? WHERE id = ? AND status = 'pending' AND expires_at >= ?").bind(status, b.answer, now, c.id, now).run();
      if (!claim.meta.changes) return bad('This check-in is already done.', 409);
      // find or make the lead
      let lead = await env.DB.prepare('SELECT id, name, channel_partner_id, assigned_to, status, source_confirmed_at, source_locked_until FROM sal_leads WHERE phone_norm = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').bind(c.phone_norm).first();
      const withPartner = b.answer === 'yes' && c.partner_id ? c.partner_id : null;
      let assignee = lead ? lead.assigned_to : null, leadId = lead ? lead.id : null;
      if (!lead) {
        const made = await shared.createLead(env, null, { name: c.name, phone: c.phone_norm, project_id: c.project_id, channel_partner_id: withPartner, source_detail: 'reception check-in', consent: false }, { systemSource: 'walk_in' });
        if (made.status === 409 && made.duplicate) { leadId = made.duplicate; lead = await env.DB.prepare('SELECT id, assigned_to, channel_partner_id, source_confirmed_at, source_locked_until FROM sal_leads WHERE id = ?').bind(leadId).first(); assignee = lead && lead.assigned_to; }
        else if (made.status === 200) { leadId = made.id; assignee = made.assignee; lead = { id: leadId, channel_partner_id: withPartner, source_confirmed_at: null, source_locked_until: null }; }
        else return bad('Something went wrong. Please ask at the reception desk.', 500);
      }
      const days = positive(await getSetting(env, 'sales.source_lock_days'), 45);
      const stmts = [
        env.DB.prepare("INSERT INTO sal_visits (lead_id, project_id, visit_at, status, by_user, checked_in_at, created_at) VALUES (?, ?, ?, 'done', NULL, ?, ?)").bind(leadId, c.project_id, now, now, now),
        env.DB.prepare("UPDATE sal_leads SET status = 'visited' WHERE id = ? AND status IN ('new', 'contacted', 'interested', 'visit_scheduled')").bind(leadId),
        env.DB.prepare('UPDATE sal_checkins SET lead_id = ? WHERE id = ?').bind(leadId, c.id),
      ];
      let note = '';
      if (withPartner && lead.channel_partner_id === withPartner) {
        // The lock is set once and never edited; it can be renewed only after it has ended.
        stmts.push(env.DB.prepare('UPDATE sal_leads SET source_confirmed_at = ?, source_locked_until = ?, source_checkin_id = ? WHERE id = ? AND channel_partner_id = ? AND (source_confirmed_at IS NULL OR source_locked_until < ?)').bind(now, plusDaysIST(days), c.id, leadId, withPartner, todayIST()));
        note = `Buyer confirmed at reception that they came with ${c.firm}. ${c.firm} keeps this buyer for ${days} days.`;
      } else if (b.answer === 'no' && lead.channel_partner_id) {
        note = 'Buyer said they came on their own, but a channel partner had registered them earlier. Owner / PM to check before any brokerage is promised.';
        stmts.push(env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, ?, ? FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm')").bind(`Broker claim disputed: ${String(c.name).slice(0, 60)}`, note, `lead#${leadId}`, now));
      } else note = b.answer === 'yes' ? 'Buyer confirmed the visit at reception.' : 'Buyer came on their own.';
      stmts.push(env.DB.prepare("INSERT INTO sal_activities (lead_id, type, outcome, note, by_user, created_at) VALUES (?, 'note', 'checkin', ?, NULL, ?)").bind(leadId, note, now));
      stmts.push(env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (NULL, ?, ?, ?, ?, ?)').bind('checkin', 'sal_leads', leadId, `Reception check-in ${c.id}: ${note}`.slice(0, 600), now));
      if (assignee) stmts.push(env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(assignee, `Walk-in at reception: ${String(c.name).slice(0, 60)}`, note, `lead#${leadId}`, now));
      await env.DB.batch(stmts);
      return json({ ok: true, data: { done: true } });
    } catch (e) { return serverError(e, 'checkin-confirm'); }
  });

  // ================= One-tap WhatsApp texts (the executive's own WhatsApp opens with the text filled in) =================
  router.get('/api/sales/leads/:id/welcome', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const l = await env.DB.prepare('SELECT id, name, phone, project_id, assigned_to FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!l) return bad('Lead not found.', 404);
      const seeAll = MANAGER.includes(req.user.role) || l.assigned_to === req.user.user_id || (await getSetting(env, 'sales.share_all_leads')) === 'on';
      if (!seeAll) return bad('Not allowed.', 403);
      if (l.project_id && !(await visibleProjectIds(env, req.user)).includes(l.project_id)) return bad('Not allowed.', 403);
      const p = l.project_id ? await env.DB.prepare('SELECT name, rera_no, lat, lng FROM projects WHERE id = ?').bind(l.project_id).first() : null;
      const brochure = String((await getSetting(env, 'sales.brochure_url')) || '').trim(); const mapUrl = String((await getSetting(env, 'sales.map_url')) || '').trim() || (p && p.lat != null && p.lng != null ? `https://www.google.com/maps?q=${p.lat},${p.lng}` : '');
      const lines = [`Hello ${l.name}, thank you for your interest${p ? ' in ' + p.name : ''}.`];
      if (p && p.rera_no) lines.push(`MahaRERA registration: ${p.rera_no}`);
      if (brochure) lines.push(`Brochure and floor plans: ${brochure}`);
      if (mapUrl) lines.push(`Site office location: ${mapUrl}`);
      lines.push('Please reply here or call us to plan your visit.');
      return json({ ok: true, data: { phone: l.phone, text: lines.join('\n'), has_brochure: !!brochure, has_map: !!mapUrl } });
    } catch (e) { return serverError(e, 'welcome'); }
  }));

  // Warm buyers (with consent) and the milestones certified in the last 30 days, for "send a site update" links.
  router.get('/api/sales/reengage', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const seeAll = MANAGER.includes(req.user.role) || (await getSetting(env, 'sales.share_all_leads')) === 'on';
      const [proj, ms, leads] = await Promise.all([
        env.DB.prepare('SELECT name, rera_no FROM projects WHERE id = ?').bind(pid).first(),
        env.DB.prepare("SELECT name, wing, actual_date FROM site_milestones WHERE project_id = ? AND status = 'done' AND deleted_at IS NULL AND actual_date >= date('now', '+5 hours', '-30 days') ORDER BY actual_date DESC LIMIT 10").bind(pid).all(),
        env.DB.prepare(`SELECT DISTINCT l.id, l.name, l.phone FROM sal_leads l JOIN sal_visits v ON v.lead_id = l.id AND v.interest = 'warm' AND v.deleted_at IS NULL
          WHERE l.project_id = ? AND l.deleted_at IS NULL AND l.consent = 1 AND l.status NOT IN ('booked', 'lost') ${seeAll ? '' : 'AND l.assigned_to = ' + Number(req.user.user_id)} ORDER BY l.name LIMIT 100`).bind(pid).all(),
      ]);
      return json({ ok: true, data: { project: proj, milestones: ms.results, leads: leads.results } });
    } catch (e) { return serverError(e, 'reengage'); }
  }));
}
