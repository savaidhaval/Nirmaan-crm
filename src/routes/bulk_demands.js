// routes/bulk_demands.js — send many demand letters at once (WP-16).
// Each letter goes by email as HTML in the body plus an expiring, revocable link to a read-only copy (/d/<token>).
// Free-plan caps: a request may run about 50 database statements, so one request sends only a few letters
// (setting sales.bulk_chunk, default 3, at most 4). The screen calls "process" again and again until the run is finished.

import { sendMail, getEmailConfig, esc } from '../core/mail.js';
import { checkRateLimit } from '../core/auth.js';
import { ensureDemandNumber } from './sales3.js';

const MAX_PER_RUN = 90;      // one run holds at most this many demands (keeps every statement under D1's 100-variable limit)
const MAX_PRINT = 10;        // letters on one print sheet (each may need a number assigned first)
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const inr = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const ist = () => new Date(Date.now() + 19800000);

async function hashToken(tokenB64url) {
  const std = tokenB64url.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(std + '='.repeat((4 - std.length % 4) % 4)), (c) => c.charCodeAt(0));
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

// The letter as HTML (used in the single email, the bulk email and the read-only page). Never contains the bank account number.
export function demandLetterHtml(brand, d, link) {
  const total = d.amount_paise + (d.gst_paise || 0) - (d.settled_paise || 0);
  const flat = (d.wing ? d.wing + '-' : '') + d.unit_no;
  return `<div style="font-family:Georgia,serif;max-width:620px;margin:auto"><h2 style="margin:0">${esc(brand.trade_name || brand.legal_name || '')}</h2><p style="color:#555;margin:2px 0 16px">${esc(brand.address || '')}</p>
      <h3>Payment demand — ${esc(d.project_name)}, ${esc(flat)}</h3>${d.demand_no ? `<p style="margin:0;color:#555">Demand No: ${esc(d.demand_no)}</p>` : ''}<p>Dear ${esc(d.customer_name)},</p>
      <p>As per the agreed payment plan, the stage <b>${esc(d.label)}</b> has been reached.${d.due_date ? ' Please pay on or before <b>' + esc(d.due_date) + '</b>.' : ''}</p>
      <table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #999;padding:6px">${esc(d.label)}</td><td style="border:1px solid #999;padding:6px;text-align:right">${inr(d.amount_paise)}</td></tr>
      <tr><td style="border:1px solid #999;padding:6px">GST</td><td style="border:1px solid #999;padding:6px;text-align:right">${inr(d.gst_paise || 0)}</td></tr>
      ${d.settled_paise ? `<tr><td style="border:1px solid #999;padding:6px">Already received</td><td style="border:1px solid #999;padding:6px;text-align:right">− ${inr(d.settled_paise)}</td></tr>` : ''}
      <tr><td style="border:1px solid #999;padding:6px"><b>Amount due</b></td><td style="border:1px solid #999;padding:6px;text-align:right"><b>${inr(total)}</b></td></tr></table>
      ${brand.bank_name ? `<p>Pay to: ${esc(brand.bank_account_name)}, ${esc(brand.bank_name)}, IFSC ${esc(brand.bank_ifsc)}. Please contact our office for the account number.</p>` : ''}
      ${link ? `<p>You can view or save a printable copy of this letter here (the link stops working after a few weeks): <a href="${esc(link)}">${esc(link)}</a></p>` : ''}
      <p>Regards,<br>${esc(brand.signatory_name || brand.legal_name || '')}</p></div>`;
}

const DETAIL_SQL = `SELECT d.id, d.booking_id, d.label, d.amount_paise, d.gst_paise, d.settled_paise, d.due_date, d.status, d.demand_no, d.sent_at, b.customer_name, b.email AS customer_email, b.project_id, i.unit_no, i.wing, pr.name AS project_name
  FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id`;

export function registerBulkDemands(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, printBrand, csvBom } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 300), nowStr());
  const num = async (env, key, def, min, max) => Math.min(max, Math.max(min, Math.round(Number(await getSetting(env, key)) || def)));
  const todayStartUtc = () => { const d = ist(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 19800000).toISOString().replace('T', ' ').substring(0, 19); };
  const sentToday = async (env) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM email_log WHERE template = 'demand' AND status = 'sent' AND sent_at >= ?").bind(todayStartUtc()).first()).n;

  async function loadRun(env, req, id) {
    const run = await env.DB.prepare('SELECT * FROM sal_bulk_runs WHERE id = ?').bind(id).first();
    if (!run) return { err: json({ ok: false, error: 'Bulk send not found.' }, 404) };
    if (run.created_by !== req.user.user_id && !['owner', 'pm', 'accounts'].includes(req.user.role)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { run };
  }
  const counts = async (env, runId) => {
    const r = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM sal_bulk_items WHERE run_id = ? GROUP BY status').bind(runId).all();
    const c = { queued: 0, sent: 0, failed: 0, skipped: 0 }; for (const x of r.results) c[x.status] = x.n; return c;
  };

  // ----- the "Ready demands" list -----
  router.get('/api/sales/ready-demands', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { demands: [], sent_today: 0, daily_limit: 0 } });
      const pid = Number(new URL(req.url).searchParams.get('project_id')) || 0;
      if (pid && !ids.includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const scope = pid ? [pid] : ids.slice(0, 90);
      const rows = (await env.DB.prepare(`${DETAIL_SQL} WHERE d.status IN ('ready', 'partial') AND b.status != 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${scope.map(() => '?').join(',')})
        ORDER BY pr.name, d.due_date, d.id LIMIT 300`).bind(...scope).all()).results;
      for (const r of rows) { r.due_paise = r.amount_paise + (r.gst_paise || 0) - (r.settled_paise || 0); r.has_email = EMAIL_RE.test(String(r.customer_email || '').trim()); delete r.customer_email; }
      return json({ ok: true, data: { demands: rows, sent_today: await sentToday(env), daily_limit: await num(env, 'sales.bulk_daily_limit', 100, 1, 5000), max_per_run: MAX_PER_RUN, max_print: MAX_PRINT } });
    } catch (e) { return serverError(e, 'ready-demands'); }
  }));

  // ----- start a bulk send: just queues the demands, sends nothing yet -----
  router.post('/api/sales/bulk-demands', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({}));
      const want = [...new Set((Array.isArray(b.demand_ids) ? b.demand_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!want.length) return json({ ok: false, error: 'Tick at least one demand.' }, 400);
      if (want.length > MAX_PER_RUN) return json({ ok: false, error: `Send at most ${MAX_PER_RUN} at a time. Untick some and send the rest afterwards.` }, 400);
      const vis = new Set(await visibleProjectIds(env, req.user));
      const found = (await env.DB.prepare(`SELECT d.id, d.status, b.project_id, EXISTS (SELECT 1 FROM sal_bulk_items q WHERE q.demand_id = d.id AND q.status = 'queued') AS queued
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE d.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(want)).all()).results;
      const ok = [], skipped = [];
      for (const id of want) {
        const r = found.find((x) => x.id === id);
        if (!r || !vis.has(r.project_id)) skipped.push({ id, reason: 'Not found or not allowed.' });
        else if (!['ready', 'partial'].includes(r.status)) skipped.push({ id, reason: 'Not ready for a demand letter (already paid, cancelled or not yet due).' });
        else if (r.queued) skipped.push({ id, reason: 'Already waiting in another bulk send.' });
        else ok.push(id);
      }
      if (!ok.length) return json({ ok: false, error: skipped[0].reason }, 400);
      const run = await env.DB.prepare('INSERT INTO sal_bulk_runs (created_by, created_at, total) VALUES (?, ?, ?)').bind(req.user.user_id, nowStr(), ok.length).run();
      const runId = run.meta.last_row_id;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO sal_bulk_items (run_id, demand_id) SELECT ?1, value FROM json_each(?2)").bind(runId, JSON.stringify(ok)),
        audit(env, req.user, 'create', 'sal_bulk_runs', runId, `Started a bulk send of ${ok.length} demand letters`),
      ]);
      return json({ ok: true, data: { run_id: runId, queued: ok.length, skipped } });
    } catch (e) { return serverError(e, 'bulk-create'); }
  }));

  // ----- send the next few letters of a run -----
  router.post('/api/sales/bulk-demands/:id/process', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { run, err } = await loadRun(env, req, Number(req.params.id)); if (err) return err;
      const limit = await num(env, 'sales.bulk_daily_limit', 100, 1, 5000);
      const left = limit - (await sentToday(env));
      const chunk = Math.min(await num(env, 'sales.bulk_chunk', 3, 1, 4), Math.max(left, 0));
      if (chunk <= 0) return json({ ok: true, data: { done: false, paused: 'daily_limit', daily_limit: limit, counts: await counts(env, run.id) } });
      const items = (await env.DB.prepare(`SELECT it.id AS item_id, it.attempts, x.* FROM sal_bulk_items it JOIN (${DETAIL_SQL}) x ON x.id = it.demand_id WHERE it.run_id = ? AND it.status = 'queued' ORDER BY it.id LIMIT ?`).bind(run.id, chunk).all()).results;
      if (!items.length) return json({ ok: true, data: { done: true, counts: await counts(env, run.id) } });
      const vis = new Set(await visibleProjectIds(env, req.user));
      const days = await num(env, 'sales.demand_link_days', 30, 1, 365);
      const base = env.EXTERNAL_URL ? new URL(env.EXTERNAL_URL).origin : new URL(req.url).origin;
      const brands = {}; let sent = 0, failed = 0, skipped = 0;
      // Free plan: about 50 database statements per request. So settings are read once, links are saved in one statement,
      // and the results of the whole chunk are written back in one statement.
      const cfg = await getEmailConfig(env);
      const todo = [], results = [];
      for (const d of items) {
        const to = String(d.customer_email || '').trim();
        if (!vis.has(d.project_id)) results.push({ i: d.item_id, s: 'skipped', e: 'Not allowed.' });
        else if (!['ready', 'partial'].includes(d.status)) results.push({ i: d.item_id, s: 'skipped', e: 'Not ready any more (paid or cancelled).' });
        else if (!EMAIL_RE.test(to)) results.push({ i: d.item_id, s: 'skipped', e: 'This customer has no email address. Add one with "Add email".' });
        else todo.push({ d, to });
      }
      const expires = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').substring(0, 19);
      for (const t of todo) {
        if (!t.d.demand_no) t.d.demand_no = await ensureDemandNumber(env, t.d.id);
        t.token = crypto.getRandomValues(new Uint8Array(32));
        t.h = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', t.token)));
      }
      if (todo.length) await env.DB.prepare("INSERT INTO sal_demand_links (token_hash, demand_id, expires_at, created_by, created_at) SELECT json_extract(value, '$.h'), json_extract(value, '$.d'), ?2, ?3, ?4 FROM json_each(?1)")
        .bind(JSON.stringify(todo.map((t) => ({ h: t.h, d: t.d.id }))), expires, req.user.user_id, nowStr()).run();
      for (const { d, to, token } of todo) {
        const brand = brands[d.project_id] || (brands[d.project_id] = await printBrand(env, d.project_id));
        const html = demandLetterHtml(brand, d, base ? `${base}/d/${b64url(token)}` : '');
        const r = await sendMail(env, to, `Payment demand — ${d.project_name} ${d.wing ? d.wing + '-' : ''}${d.unit_no}${d.demand_no ? ' (' + d.demand_no + ')' : ''}`, html, { template: 'demand', cfg });
        if (r.sent) { results.push({ i: d.item_id, s: 'sent', l: r.logId }); sent++; }
        else { results.push({ i: d.item_id, s: 'failed', l: r.logId, e: String(r.error || 'Could not send.').slice(0, 300) }); failed++; }
      }
      skipped = results.filter((x) => x.s === 'skipped').length;
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare("UPDATE sal_bulk_items SET status = j.s, error = j.e, email_log_id = j.l, attempts = attempts + 1, sent_at = CASE WHEN j.s = 'sent' THEN ?2 END FROM (SELECT json_extract(value, '$.i') AS i, json_extract(value, '$.s') AS s, json_extract(value, '$.e') AS e, json_extract(value, '$.l') AS l FROM json_each(?1)) j WHERE sal_bulk_items.id = j.i")
          .bind(JSON.stringify(results), now),
        env.DB.prepare("UPDATE sal_demands SET sent_at = ?2 WHERE id IN (SELECT demand_id FROM sal_bulk_items WHERE run_id = ?1 AND status = 'sent' AND sent_at = ?2)").bind(run.id, now),
        // keep the hourly auto-retry away from failed ones: the Retry button on the bulk screen is the only retry, so nobody is emailed twice
        env.DB.prepare("UPDATE email_log SET attempts = 3 WHERE id IN (SELECT email_log_id FROM sal_bulk_items WHERE run_id = ?1 AND status = 'failed' AND email_log_id IS NOT NULL) AND status = 'failed' AND attempts < 3").bind(run.id),
      ]);
      await audit(env, req.user, 'email', 'sal_bulk_runs', run.id, `Bulk demand letters: ${sent} sent, ${failed} failed, ${skipped} skipped`).run();
      const c = await counts(env, run.id);
      return json({ ok: true, data: { done: c.queued === 0, sent, failed, skipped, counts: c } });
    } catch (e) { return serverError(e, 'bulk-process'); }
  }));

  // ----- retry the failed ones -----
  router.post('/api/sales/bulk-demands/:id/retry', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { run, err } = await loadRun(env, req, Number(req.params.id)); if (err) return err;
      const r = await env.DB.prepare("UPDATE sal_bulk_items SET status = 'queued', error = NULL WHERE run_id = ? AND status = 'failed' AND attempts < 5").bind(run.id).run();
      return json({ ok: true, data: { requeued: r.meta.changes, counts: await counts(env, run.id) } });
    } catch (e) { return serverError(e, 'bulk-retry'); }
  }));

  // ----- one run: counts and the sent / failed list (JSON or CSV) -----
  router.get('/api/sales/bulk-demands/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const { run, err } = await loadRun(env, req, Number(req.params.id)); if (err) return err;
      const items = (await env.DB.prepare(`SELECT it.id, it.demand_id, it.status, it.error, it.attempts, it.sent_at, x.customer_name, x.customer_email, x.label, x.demand_no, x.project_name, x.unit_no, x.wing, x.amount_paise, x.gst_paise, x.settled_paise
        FROM sal_bulk_items it JOIN (${DETAIL_SQL}) x ON x.id = it.demand_id WHERE it.run_id = ? ORDER BY it.id LIMIT 200`).bind(run.id).all()).results;
      if (new URL(req.url).searchParams.get('csv')) {
        const rows = [['Demand no', 'Project', 'Flat', 'Customer', 'Stage', 'Amount due (Rs)', 'Result', 'Sent at', 'Note'], ...items.map((i) => [i.demand_no || '', i.project_name, (i.wing ? i.wing + '-' : '') + i.unit_no, i.customer_name, i.label, ((i.amount_paise + (i.gst_paise || 0) - (i.settled_paise || 0)) / 100).toFixed(2), i.status, i.sent_at || '', i.error || ''])];
        return new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="demand-letters-run-${run.id}.csv"`, 'Cache-Control': 'no-store' } });
      }
      for (const i of items) { i.due_paise = i.amount_paise + (i.gst_paise || 0) - (i.settled_paise || 0); i.has_email = EMAIL_RE.test(String(i.customer_email || '').trim()); delete i.customer_email; }
      return json({ ok: true, data: { run, counts: await counts(env, run.id), items, sent_today: await sentToday(env), daily_limit: await num(env, 'sales.bulk_daily_limit', 100, 1, 5000) } });
    } catch (e) { return serverError(e, 'bulk-get'); }
  }));

  // ----- print sheet: several letters, one per page (option A) -----
  router.get('/api/print/demands', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const ids = [...new Set(String(new URL(req.url).searchParams.get('ids') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!ids.length) return json({ ok: false, error: 'Pick the letters to print.' }, 400);
      if (ids.length > MAX_PRINT) return json({ ok: false, error: `Print at most ${MAX_PRINT} letters on one sheet. Print the rest as a second sheet.` }, 400);
      const vis = new Set(await visibleProjectIds(env, req.user));
      const rows = (await env.DB.prepare(`SELECT x.*, b.address AS customer_address, b.gst_bp, pr.rera_no FROM (${DETAIL_SQL}) x JOIN sal_demands d2 ON d2.id = x.id JOIN sal_bookings b ON b.id = d2.booking_id JOIN projects pr ON pr.id = x.project_id WHERE x.id IN (SELECT value FROM json_each(?)) ORDER BY x.project_name, x.id`).bind(JSON.stringify(ids)).all()).results;
      const demands = []; const brands = {};
      for (const r of rows) {
        if (!vis.has(r.project_id) || r.status === 'scheduled') continue;
        if (!r.demand_no) r.demand_no = await ensureDemandNumber(env, r.id);
        brands[r.project_id] = brands[r.project_id] || await printBrand(env, r.project_id);
        delete r.customer_email; demands.push({ demand: r, brand: brands[r.project_id], draft: false });
      }
      if (!demands.length) return json({ ok: false, error: 'None of these letters can be printed.' }, 400);
      return json({ ok: true, data: { kind: 'demandbatch', letters: demands } });
    } catch (e) { return serverError(e, 'print-demands'); }
  }));

  // ----- add or fix the customer's email address on a booking (so a skipped or failed letter can be sent) -----
  router.post('/api/sales/bookings/:id/email', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const b = await env.DB.prepare('SELECT id, project_id, customer_name FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!b) return json({ ok: false, error: 'Booking not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(b.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const email = String((await req.json().catch(() => ({}))).email || '').trim().slice(0, 120);
      if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'That does not look like an email address.' }, 400);
      await env.DB.batch([env.DB.prepare('UPDATE sal_bookings SET email = ? WHERE id = ?').bind(email, b.id), audit(env, req.user, 'update', 'sal_bookings', b.id, `Set the customer email for ${b.customer_name}`)]);
      return json({ ok: true, data: { email } });
    } catch (e) { return serverError(e, 'booking-email'); }
  }));

  // ----- turn off every link of one demand -----
  router.post('/api/sales/demands/:id/revoke-links', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const d = await env.DB.prepare('SELECT d.id, b.project_id FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE d.id = ?').bind(Number(req.params.id)).first();
      if (!d) return json({ ok: false, error: 'Demand not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(d.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const r = await env.DB.prepare("UPDATE sal_demand_links SET revoked_at = ? WHERE demand_id = ? AND revoked_at IS NULL").bind(nowStr(), d.id).run();
      await audit(env, req.user, 'revoke', 'sal_demands', d.id, `Turned off ${r.meta.changes} demand letter link(s)`).run();
      return json({ ok: true, data: { revoked: r.meta.changes } });
    } catch (e) { return serverError(e, 'dlink-revoke'); }
  }));

  // ----- public read-only copy of one letter (no login; limited by the link's expiry) -----
  router.get('/d/:token', async (req, env) => {
    const page = (msg, status) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><p>${esc(msg)}</p>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    try {
      const rl = await checkRateLimit(env, `dlink-ip:${req.headers.get('cf-connecting-ip') || 'x'}`, 60, 10);
      if (!rl.allowed) return page('Too many requests. Try again in a few minutes.', 429);
      let hash; try { hash = await hashToken(req.params.token); } catch (e) { return page('This link is not valid.', 410); }
      const link = await env.DB.prepare("SELECT * FROM sal_demand_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')").bind(hash).first();
      if (!link) return page('This link has expired or been turned off. Please contact our office for a fresh copy.', 410);
      const d = await env.DB.prepare(`${DETAIL_SQL} WHERE d.id = ?`).bind(link.demand_id).first();
      if (!d) return page('This letter is not available.', 410);
      await env.DB.prepare("UPDATE sal_demand_links SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id = ?").bind(link.id).run();
      const brand = await printBrand(env, d.project_id);
      return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Payment demand</title></head><body style="margin:0;padding:16px;background:#f4f6f9">
        <div style="background:#fff;padding:20px;max-width:680px;margin:auto">${demandLetterHtml(brand, d, '')}</div><p style="text-align:center"><button onclick="print()" style="font-size:18px;padding:12px 20px">Print or save as PDF</button></p></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" } });
    } catch (e) { console.error('dlink', e.message); return page('Something went wrong. Please try again later.', 500); }
  });
}
