// routes/privacy.js — DPDP Act helpers: export a person's data, erase personal fields where the law allows.
// Financial records (amounts, receipts, demands) are kept for statutory retention; only identifying fields are erased.

export function registerPrivacy(router, h) {
  const { withAuth, json, serverError, nowStr, decryptSetting } = h;
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

  // Find everything we hold about a mobile number
  router.get('/api/privacy/find', async (req, env) => withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const d = digits(new URL(req.url).searchParams.get('phone'));
      if (d.length !== 10) return json({ ok: false, error: 'Enter a 10-digit mobile number.' }, 400);
      const leads = (await env.DB.prepare('SELECT id, name, status, created_at, erased_at FROM sal_leads WHERE phone_norm = ? AND deleted_at IS NULL').bind(d).all()).results;
      const bookings = (await env.DB.prepare("SELECT b.id, b.customer_name, b.status, b.created_at, b.erased_at, i.wing, i.unit_no FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE substr(replace(replace(replace(b.phone, '+', ''), ' ', ''), '-', ''), -10) = ? AND b.deleted_at IS NULL").bind(d).all()).results;
      return json({ ok: true, data: { leads, bookings } });
    } catch (e) { return serverError(e, 'privacy-find'); }
  }));

  router.get('/api/privacy/export', async (req, env) => withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const u = new URL(req.url);
      const leadId = Number(u.searchParams.get('lead_id')) || null; const bookingId = Number(u.searchParams.get('booking_id')) || null;
      const out = { exported_at: new Date().toISOString() };
      if (leadId) {
        out.lead = await env.DB.prepare('SELECT id, name, phone, email, source, config_pref, budget_paise, status, consent, consent_at, notes, created_at FROM sal_leads WHERE id = ?').bind(leadId).first();
        out.activities = (await env.DB.prepare('SELECT type, outcome, note, created_at FROM sal_activities WHERE lead_id = ? ORDER BY id').bind(leadId).all()).results;
        out.visits = (await env.DB.prepare('SELECT visit_at, status, feedback FROM sal_visits WHERE lead_id = ?').bind(leadId).all()).results;
      }
      if (bookingId) {
        out.booking = await env.DB.prepare('SELECT id, customer_name, phone, email, address, token_paise, agreed_price_paise, status, booking_date, created_at FROM sal_bookings WHERE id = ?').bind(bookingId).first();
        out.demands = (await env.DB.prepare('SELECT label, amount_paise, gst_paise, due_date, status FROM sal_demands WHERE booking_id = ?').bind(bookingId).all()).results;
        out.receipts = (await env.DB.prepare('SELECT receipt_no, amount_paise, tds_paise, mode, received_on, kind FROM sal_receipts WHERE booking_id = ? AND reversed_at IS NULL').bind(bookingId).all()).results;
        out.note = 'PAN is held encrypted and is not included.';
      }
      if (!out.lead && !out.booking) return json({ ok: false, error: 'Nothing found.' }, 404);
      await audit(env, req.user, 'privacy_export', leadId ? 'sal_leads' : 'sal_bookings', leadId || bookingId, 'Personal data exported on request');
      return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="personal-data.json"', 'Cache-Control': 'no-store' } });
    } catch (e) { return serverError(e, 'privacy-export'); }
  }));

  router.post('/api/privacy/erase', async (req, env) => withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can erase personal data.' }, 403);
      const b = await req.json();
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Record the reason (for example "customer request, ticket 123").' }, 400);
      const now = nowStr();
      if (b.lead_id) {
        const l = await env.DB.prepare('SELECT * FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(Number(b.lead_id)).first();
        if (!l) return json({ ok: false, error: 'Lead not found.' }, 404);
        if (l.status === 'booked') return json({ ok: false, error: 'This lead has a booking. Erase it from the booking after it is cancelled.' }, 400);
        await env.DB.batch([
          env.DB.prepare("UPDATE sal_leads SET name = 'Erased #' || id, phone = '', phone_norm = NULL, email = '', notes = '', source_detail = '', erased_at = ?, next_followup_at = NULL, status = CASE WHEN status IN ('booked') THEN status ELSE 'lost' END WHERE id = ?").bind(now, l.id),
          env.DB.prepare("UPDATE sal_activities SET note = '' WHERE lead_id = ?").bind(l.id),
          env.DB.prepare("UPDATE sal_visits SET feedback = '' WHERE lead_id = ?").bind(l.id),
          env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'privacy_erase', 'sal_leads', l.id, `Personal data of lead #${l.id} erased. Reason: ${b.reason}`, now),
        ]);
        return json({ ok: true });
      }
      if (b.booking_id) {
        const k = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(Number(b.booking_id)).first();
        if (!k) return json({ ok: false, error: 'Booking not found.' }, 404);
        if (k.status !== 'cancelled') return json({ ok: false, error: 'An active booking must be kept in full (statutory retention). Erase only after it is cancelled.' }, 400);
        const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM sal_refunds WHERE booking_id = ? AND status IN ('requested','approved')").bind(k.id).first();
        if (Number(open.n) > 0) return json({ ok: false, error: 'Finish the pending refund first.' }, 400);
        await env.DB.batch([
          env.DB.prepare("UPDATE sal_bookings SET customer_name = 'Erased #' || id, phone = '', email = '', address = '', pan = '', erased_at = ? WHERE id = ?").bind(now, k.id),
          env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'privacy_erase', 'sal_bookings', k.id, `Personal data of booking #${k.id} erased; amounts and receipts kept for retention. Reason: ${b.reason}`, now),
        ]);
        return json({ ok: true });
      }
      return json({ ok: false, error: 'Say which lead or booking.' }, 400);
    } catch (e) { return serverError(e, 'privacy-erase'); }
  }));
}
