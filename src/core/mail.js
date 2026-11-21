// core/mail.js — mail provider switch: smtp | brevo_api with queue + retry (§7.8)

import { sendSmtp } from './smtp.js';

export async function sendMail(env, to, subject, html, attachments = []) {
  const settings = await getAllSettings(env);
  const provider = settings['email.provider'] || 'smtp';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // Queue the email
  await env.DB.prepare(
    `INSERT INTO email_log (to_email, subject, body_html, status, created_at)
     VALUES (?, ?, ?, 'queued', ?)`
  ).bind(to, subject, html, now).run();

  let sent = false;
  let lastError = null;

  try {
    if (provider === 'brevo_api') {
      await sendViaBrevo(env, to, subject, html, attachments);
    } else {
      await sendViaSmtp(env, to, subject, html, attachments);
    }
    await env.DB.prepare(
      `UPDATE email_log SET status = 'sent', sent_at = ? WHERE to_email = ? AND status = 'queued' ORDER BY created_at DESC LIMIT 1`
    ).bind(now, to).run();
    sent = true;
  } catch (e) {
    lastError = e.message;
    await env.DB.prepare(
      `UPDATE email_log SET status = 'failed', error = ?, attempts = attempts + 1 WHERE to_email = ? AND status = 'queued' ORDER BY created_at DESC LIMIT 1`
    ).bind(lastError, to).run();
  }

  return { sent, error: lastError };
}

async function sendViaSmtp(env, to, subject, html, attachments) {
  const settings = await getAllSettings(env);
  const host = settings['smtp.host'];
  const port = Number(settings['smtp.port'] || 465);
  const username = settings['smtp.username'] || '';
  const password = settings['smtp.password'] ? await decryptSetting(env, settings['smtp.password']) : '';
  const fromName = settings['smtp.from_name'] || 'NirmaanCRM';
  const fromEmail = settings['smtp.from_email'] || 'noreply@yourcompany.in';

  if (!host || !username || !password) {
    throw new Error('SMTP not configured. Go to Settings → Email.');
  }

  return sendSmtp(env, to, subject, html, fromName, fromEmail, host, port, username, password);
}

async function sendViaBrevo(env, to, subject, html, attachments) {
  const settings = await getAllSettings(env);
  const apiKey = settings['brevo.api_key'];
  if (!apiKey) throw new Error('Brevo API key not configured');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: 'NirmaanCRM', email: settings['smtp.from_email'] || 'noreply@yourcompany.in' },
      to: [{ email: to }],
      subject: subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Brevo API error (${res.status}): ${txt}`);
  }
}

export async function retryFailedEmails(env) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const rows = await env.DB.prepare(
    `SELECT * FROM email_log WHERE status = 'failed' AND attempts < 3 ORDER BY created_at ASC LIMIT 40`
  ).all();

  for (const row of rows.results) {
    try {
      await sendMail(env, row.to_email, row.subject, row.body_html || '');
    } catch (e) {
      // Will retry next hour
    }
  }
}

export async function sendDigest(env, recipientEmail) {
  // Compose digest from aggregate queries (§7.8 + Appendix C)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const dateStr = istDate.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Get projects
  const projects = await env.DB.prepare('SELECT * FROM projects WHERE deleted_at IS NULL').all();

  let html = `<h1>🏗️ NirmaanCRM — Morning Report, ${dateStr}</h1>`;

  for (const p of projects.results) {
    html += `<h2>${p.name}</h2>`;

    // Yesterday's DPR
    const yesterday = new Date(istDate);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yStr = yesterday.toISOString().substring(0, 10);
    const dpr = await env.DB.prepare(
      'SELECT * FROM site_dprs WHERE project_id = ? AND report_date = ? LIMIT 1'
    ).bind(p.id, yStr).first();

    if (dpr) {
      html += `<p>• Yesterday: ${dpr.work_summary}. Labour: ${dpr.labour_count || '—'}.</p>`;
    } else {
      html += `<p style="color:#dc2626;">• ⚠ NO REPORT FILED yesterday.</p>`;
    }

    // Milestones done
    const milestones = await env.DB.prepare(
      'SELECT * FROM site_milestones WHERE project_id = ? AND status = ? AND actual_date IS NOT NULL ORDER BY actual_date DESC LIMIT 5'
    ).bind(p.id, 'done').all();

    if (milestones.results.length > 0) {
      html += `<p>• Milestones done: ${milestones.results.map((m) => m.name).join(', ')}.</p>`;
    }

    // Approvals expiring
    const approvals = await env.DB.prepare(
      'SELECT * FROM apr_items WHERE project_id = ? AND deleted_at IS NULL AND valid_till IS NOT NULL AND date(valid_till) <= date(\'now\', \'+30 days\') AND status != \'approved\''
    ).bind(p.id).all();

    if (approvals.results.length > 0) {
      html += `<p>• Approvals expiring ≤30 days: ${approvals.results.length}.</p>`;
    }
  }

  html += `<p><a href="${env.EXTERNAL_URL || 'https://nirmaan-crm.savai-dhaval.workers.dev'}">Open dashboard</a></p>`;

  return sendMail(env, recipientEmail, `🏗️ NirmaanCRM — Morning Report, ${dateStr}`, html);
}

async function getAllSettings(env) {
  const rows = await env.DB.prepare('SELECT key, value_json FROM settings').all();
  const s = {};
  for (const r of rows.results) {
    try { s[r.key] = JSON.parse(r.value_json); } catch (e) { s[r.key] = r.value_json; }
  }
  return s;
}

async function decryptSetting(env, encryptedB64) {
  // Placeholder — Phase 13 will wire AES-GCM decryption with APP_KEY
  return encryptedB64;
}
