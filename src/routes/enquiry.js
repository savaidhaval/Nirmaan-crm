// routes/enquiry.js — WP-24 part 1: a public enquiry form (website, QR code, other sites through an iframe).
// Protection: Cloudflare Turnstile (secret kept as a Worker secret), a hidden trap field, per-address and daily limits, a consent tick that is stored.
// Only the form fields are kept. A repeat of a known phone number never creates a second lead: it adds a note to the first one and tells its owner.
// Without TURNSTILE_SECRET the form is simply switched off (503). TURNSTILE_MOCK exists only for tests (.dev.vars / CI), never in production.

import { shared, phone10 } from './sales_ops.js';

export function registerEnquiry(router, h) {
  const { json, serverError, nowStr, getSetting, clientIp, checkRateLimit, printBrand } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const live = (env) => !!(env.TURNSTILE_MOCK || (env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY));
  const projectByCode = (env, code) => (code ? env.DB.prepare("SELECT id, name FROM projects WHERE code = ? AND deleted_at IS NULL AND COALESCE(status, '') NOT IN ('archived', 'completed')").bind(String(code).slice(0, 30)).first() : null);

  // What the page needs to draw itself (public: the site key is meant to be public)
  router.get('/api/public/enquiry-config', async (req, env) => {
    try {
      if (!live(env)) return json({ ok: true, data: { enabled: false } });
      const proj = await projectByCode(env, new URL(req.url).searchParams.get('project'));
      const brand = await printBrand(env, proj ? proj.id : null);
      return json({ ok: true, data: { enabled: true, site_key: env.TURNSTILE_MOCK ? 'mock' : env.TURNSTILE_SITE_KEY, project: proj ? proj.name : '', company: brand.trade_name || brand.legal_name || '' } });
    } catch (e) { return serverError(e, 'enquiry-config'); }
  });

  router.post('/api/public/enquiry', async (req, env) => {
    try {
      if (!live(env)) return bad('This form is not switched on yet.', 503);
      const raw = await req.text(); if (raw.length > 6000) return bad('That is too long.', 413);
      let b; try { b = JSON.parse(raw); } catch (e) { return bad('Something went wrong. Please try again.'); }
      const ip = clientIp(req);
      const rl = await checkRateLimit(env, `enq-ip:${ip}`, 5, 60); if (!rl.allowed) return bad('Too many enquiries from this connection. Please try again in an hour, or call us.', 429);
      const day = await checkRateLimit(env, 'enq-day', 300, 1440); if (!day.allowed) return bad('We are receiving a lot of enquiries. Please call us.', 429);
      if (String(b.company_website || '').trim()) return json({ ok: true, data: { received: true } });   // trap field: bots fill it, people never see it
      if (b.consent !== true) return bad('Please tick the box to say we may contact you.');
      const name = String(b.name || '').trim().slice(0, 120); const norm = phone10(b.phone);
      if (name.length < 2) return bad('Please enter your name.'); if (norm.length !== 10) return bad('Please enter a 10-digit mobile number.');
      const email = String(b.email || '').trim().slice(0, 120); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('That email address does not look right.');
      // Turnstile
      const token = String(b.token || '');
      let human = false;
      if (env.TURNSTILE_MOCK) human = token === 'ok-token';
      else if (token) {
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }) });
        human = !!((await r.json().catch(() => ({}))).success);
      }
      if (!human) return bad('We could not confirm you are a person. Please tick the check box and try again.', 403);
      const proj = await projectByCode(env, b.project);
      const message = String(b.message || '').trim().slice(0, 500);
      const r = await shared.createLead(env, null, { name, phone: String(b.phone).trim(), email, project_id: proj ? proj.id : null, notes: message, consent: true, source_detail: 'enquiry form' }, { systemSource: 'website' });
      if (r.status === 409 && r.duplicate) {
        // a repeat enquiry: no second lead; the first lead gets a note and its owner a nudge
        const lead = await env.DB.prepare('SELECT id, name, assigned_to FROM sal_leads WHERE id = ?').bind(r.duplicate).first();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO sal_activities (lead_id, type, note, by_user, created_at) VALUES (?, 'note', ?, NULL, ?)").bind(lead.id, `Enquired again through the website form${proj ? ' about ' + proj.name : ''}.${message ? ' Message: ' + message : ''}`, nowStr()),
          ...(lead.assigned_to ? [env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(lead.assigned_to, `${lead.name} enquired again`, 'They filled in the website form again. Call them today.', 'sales', nowStr())] : []),
        ]);
        return json({ ok: true, data: { received: true } });
      }
      if (r.status !== 200) return bad(r.error || 'Something went wrong. Please try again.', r.status === 400 ? 400 : 500);
      if (r.assignee) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(r.assignee, `New website enquiry: ${name.slice(0, 60)}`, 'Call within the hour.', 'sales', nowStr()).run();
      return json({ ok: true, data: { received: true } });
    } catch (e) { return serverError(e, 'enquiry'); }
  });
}
