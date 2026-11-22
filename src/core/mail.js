// core/mail.js — mail provider switch: smtp | brevo_api with queue + retry (§7.8)

import { sendSmtp } from './smtp.js';
import { getSetting } from './settings.js';

const nowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function getEmailConfig(env) {
  const g = (k, d) => getSetting(env, k).then((v) => (v === null || v === undefined || v === '' ? d : v));
  return {
    provider: await g('email.provider', 'smtp'),
    host: await g('smtp.host', ''), port: Number(await g('smtp.port', 465)), security: await g('smtp.security', 'ssl'),
    username: await g('smtp.username', ''), password: await g('smtp.password', ''),
    fromName: await g('smtp.from_name', 'NirmaanCRM'), fromEmail: await g('smtp.from_email', ''),
    brevoKey: await g('brevo.api_key', ''),
  };
}

// Queue + send. Pass { logId } to retry an existing log row instead of creating a new one.
export async function sendMail(env, to, subject, html, opts = {}) {
  const cfg = opts.cfg || await getEmailConfig(env); // callers sending many mails read the settings once and pass them in
  let logId = opts.logId;
  if (!logId) {
    const r = await env.DB.prepare(`INSERT INTO email_log (to_email, subject, body_html, status, provider, template, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)`)
      .bind(to, subject, opts.template === 'otp' ? '(login code not stored)' : html, cfg.provider, opts.template || null, nowStr()).run();
    logId = r.meta.last_row_id;
  }
  try {
    // Test mode (MAIL_MOCK is set only in .dev.vars / CI, never in production): nothing is sent; an address containing "fail" is refused.
    if (env.MAIL_MOCK) { if (/fail/i.test(to)) throw new Error('Mock mail server refused this address.'); }
    else if (cfg.provider === 'brevo_api') await sendViaBrevo(cfg, to, subject, html);
    else await sendViaSmtp(cfg, to, subject, html, opts.attachments || []);
    await env.DB.prepare(`UPDATE email_log SET status = 'sent', error = NULL, sent_at = ?, attempts = attempts + 1 WHERE id = ?`).bind(nowStr(), logId).run();
    return { sent: true, error: null, logId };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 400);
    await env.DB.prepare(`UPDATE email_log SET status = 'failed', error = ?, attempts = attempts + ? WHERE id = ?`).bind(msg, opts.template === 'otp' ? 3 : 1, logId).run();
    return { sent: false, error: msg, logId };
  }
}

async function sendViaSmtp(cfg, to, subject, html, attachments) {
  if (!cfg.host || !cfg.username || !cfg.password || !cfg.fromEmail) throw new Error('Email is not set up yet. Go to More → Email settings.');
  return sendSmtp(cfg, { fromName: cfg.fromName, fromEmail: cfg.fromEmail, to, subject, html, attachments });
}

async function sendViaBrevo(cfg, to, subject, html) {
  if (!cfg.brevoKey || !cfg.fromEmail) throw new Error('Brevo API key and sender address are not set. Go to More → Email settings.');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-key': cfg.brevoKey },
    body: JSON.stringify({ sender: { name: cfg.fromName || 'NirmaanCRM', email: cfg.fromEmail }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!res.ok) throw new Error(`Brevo rejected the message (${res.status}).`);
}

// Hourly: retry failed emails (max 3 attempts).
export async function retryFailedEmails(env) {
  const rows = await env.DB.prepare(`SELECT id, to_email, subject, body_html FROM email_log WHERE status = 'failed' AND attempts < 3 ORDER BY created_at ASC LIMIT 20`).all();
  for (const row of rows.results) {
    await sendMail(env, row.to_email, row.subject, row.body_html || '', { logId: row.id });
  }
}

export async function sendDigest(env, recipientEmail) {
  const ist = new Date(Date.now() + 19800000);
  const dateStr = `${String(ist.getUTCDate()).padStart(2, '0')}/${String(ist.getUTCMonth() + 1).padStart(2, '0')}/${ist.getUTCFullYear()}`;
  const yStr = new Date(ist.getTime() - 86400000).toISOString().substring(0, 10);
  const projects = await env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NULL AND status != \'completed\' ORDER BY name').all();
  let html = `<h1 style="font-size:20px">NirmaanCRM — Morning report, ${dateStr}</h1>`;
  if (!projects.results.length) html += '<p>No active projects yet.</p>';
  for (const p of projects.results) {
    html += `<h2 style="font-size:17px;margin-top:18px">${esc(p.name)}</h2><ul>`;
    const dpr = await env.DB.prepare('SELECT work_summary, labour_count FROM site_dprs WHERE project_id = ? AND report_date = ? AND deleted_at IS NULL LIMIT 1').bind(p.id, yStr).first();
    html += dpr ? `<li>Yesterday: ${esc(dpr.work_summary)} (labour: ${esc(dpr.labour_count ?? '—')})</li>` : '<li style="color:#b91c1c"><b>No site report was filed yesterday.</b></li>';
    const ms = await env.DB.prepare("SELECT name FROM site_milestones WHERE project_id = ? AND status = 'done' AND date(actual_date) >= date('now', '-7 days') AND deleted_at IS NULL").bind(p.id).all();
    if (ms.results.length) html += `<li>Milestones done this week: ${ms.results.map((m) => esc(m.name)).join(', ')}</li>`;
    const apr = await env.DB.prepare("SELECT COUNT(*) AS n FROM apr_items WHERE project_id = ? AND deleted_at IS NULL AND valid_till IS NOT NULL AND date(valid_till) <= date('now', '+30 days')").bind(p.id).first();
    if (Number(apr.n)) html += `<li>Approvals expiring within 30 days: <b>${apr.n}</b></li>`;
    const snag = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_snags WHERE project_id = ? AND deleted_at IS NULL AND severity = 'high' AND status != 'verified'").bind(p.id).first();
    if (Number(snag.n)) html += `<li>Open high-severity snags: <b>${snag.n}</b></li>`;
    const po = await env.DB.prepare("SELECT COUNT(*) AS n FROM pro_pos WHERE project_id = ? AND deleted_at IS NULL AND status = 'pending_approval'").bind(p.id).first();
    if (Number(po.n)) html += `<li>Purchase orders waiting for approval: <b>${po.n}</b></li>`;
    html += '</ul>';
  }
  const od = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise + COALESCE(gst_paise,0) - settled_paise), 0) AS t FROM sal_demands WHERE status NOT IN ('paid','cancelled','scheduled') AND due_date < date('now')").first();
  if (Number(od.n)) html += `<p><b>Overdue customer payments:</b> ${od.n} demand(s), ₹${(Number(od.t) / 100).toLocaleString('en-IN')}</p>`;
  const base = env.EXTERNAL_URL || '';
  if (base) html += `<p><a href="${esc(base)}">Open NirmaanCRM</a></p>`;
  return sendMail(env, recipientEmail, `NirmaanCRM — Morning report, ${dateStr}`, html, { template: 'digest' });
}

// 19:00 IST: tell PMs/Owners which active projects have no report today.
export async function notifyMissingDprs(env) {
  const today = new Date(Date.now() + 19800000).toISOString().substring(0, 10);
  const missing = await env.DB.prepare(`SELECT p.id, p.name FROM projects p WHERE p.deleted_at IS NULL AND p.status NOT IN ('completed', 'on_hold')
    AND NOT EXISTS (SELECT 1 FROM site_dprs d WHERE d.project_id = p.id AND d.report_date = ? AND d.deleted_at IS NULL)`).bind(today).all();
  if (!missing.results.length) return 0;
  const users = await env.DB.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm')").all();
  for (const m of missing.results) for (const u of users.results) {
    await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, `No site report yet: ${m.name}`, 'Nobody has filed today\'s work report.', 'site', nowStr()).run();
  }
  return missing.results.length;
}
