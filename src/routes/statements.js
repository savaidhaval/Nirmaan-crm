// routes/statements.js — WP-25: send a customer their statement without a login.
// SNAPSHOT approach: Accounts prints the statement on the letterhead, saves it as a PDF, uploads it as a customer-shareable file and gets an
// expiring, revocable /s/<token> link (default 14 days, setting share.default_expiry_days). No live ledger is ever exposed, and no new public page exists.
// Only Accounts and the Owner create or revoke these links; Sales cannot. Every step is in the audit log.

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function registerStatements(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const may = (u) => ['owner', 'accounts'].includes(u.role);

  async function loadBooking(env, req, id) {
    const b = await env.DB.prepare('SELECT id, project_id, customer_name FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!b) return { err: bad('Booking not found.', 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(b.project_id)) return { err: bad('Not allowed.', 403) };
    return { b };
  }
  const state = `CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at <= datetime('now') THEN 'expired' ELSE 'active' END`;

  router.get('/api/sales/bookings/:id/statement-links', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!may(req.user) && req.user.role !== 'pm') return bad('Only Accounts, the PM or the Owner can see statement links.', 403);
      const { b, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare(`SELECT l.id, l.recipient_label, l.expires_at, l.view_count, l.last_viewed_at, l.revoked_at, l.created_at, ${state} AS state, d.title, u.name AS by_name
        FROM share_links l JOIN documents d ON d.id = l.document_id LEFT JOIN users u ON u.id = l.created_by WHERE l.entity = 'sal_bookings' AND l.entity_id = ? ORDER BY l.id DESC LIMIT 20`).bind(b.id).all()).results;
      return json({ ok: true, data: { links: rows } });
    } catch (e) { return serverError(e, 'stmt-links'); }
  }));

  router.post('/api/sales/bookings/:id/statement-link', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!may(req.user)) return bad('Only Accounts or the Owner can send a customer statement.', 403);
      const { b, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      const body = await req.json().catch(() => ({}));
      const doc = await env.DB.prepare("SELECT id, title, mime FROM documents WHERE id = ? AND deleted_at IS NULL AND category = 'statement' AND audience = 'customer' AND project_id = ?").bind(Number(body.document_id), b.project_id).first();
      if (!doc) return bad('Upload the saved statement (PDF) first. It must be marked as shareable with the customer.');
      if (doc.mime !== 'application/pdf') return bad('The statement must be a PDF. Use Print, then Save as PDF.');
      const days = Math.min(90, Math.max(1, Math.round(Number(body.days) || Number(await getSetting(env, 'share.default_expiry_days')) || 14)));
      const expires = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').substring(0, 19);
      const token = crypto.getRandomValues(new Uint8Array(32)); const hash = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', token)));
      const now = nowStr();
      const r = await env.DB.prepare('INSERT INTO share_links (token_hash, document_id, project_id, entity, entity_id, recipient_label, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(hash, doc.id, b.project_id, 'sal_bookings', b.id, `Statement for ${b.customer_name}`.slice(0, 120), req.user.user_id, expires, now).run();
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'share', 'share_links', ?, ?, ?)").bind(req.user.user_id, r.meta.last_row_id, `Sent a statement link for ${b.customer_name}, valid ${days} days`, now).run();
      return json({ ok: true, data: { id: r.meta.last_row_id, link: `/s/${b64url(token)}`, expires_at: expires, days } });
    } catch (e) { return serverError(e, 'stmt-link'); }
  }));

  router.post('/api/sales/statement-links/:id/revoke', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!may(req.user)) return bad('Only Accounts or the Owner can turn a statement link off.', 403);
      const l = await env.DB.prepare("SELECT l.id, b.project_id, b.customer_name FROM share_links l JOIN sal_bookings b ON b.id = l.entity_id WHERE l.id = ? AND l.entity = 'sal_bookings'").bind(Number(req.params.id)).first();
      if (!l) return bad('Link not found.', 404);
      if (!(await visibleProjectIds(env, req.user)).includes(l.project_id)) return bad('Not allowed.', 403);
      const r = await env.DB.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL').bind(nowStr(), req.user.user_id, l.id).run();
      if (!r.meta.changes) return bad('This link was already turned off.', 409);
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'revoke', 'share_links', ?, ?, ?)").bind(req.user.user_id, l.id, `Turned off the statement link for ${l.customer_name}`, nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'stmt-revoke'); }
  }));
}
