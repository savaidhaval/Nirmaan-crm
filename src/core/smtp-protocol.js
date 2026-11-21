// core/smtp-protocol.js — SMTP conversation over any reader/writer pair (§7.8 notes 1-4).
// Transport-agnostic so it can be unit-tested outside Workers. Used by core/smtp.js.

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const TIMEOUT_MS = 10000;

export class SmtpError extends Error {
  constructor(message, code) { super(message); this.name = 'SmtpError'; this.code = code; }
}

function withTimeout(promise, what) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new SmtpError(`Timed out waiting for the mail server (${what}).`)), TIMEOUT_MS); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// Reads complete SMTP replies (handles multi-line "250-..." continuation).
export class SmtpLink {
  constructor(reader, writer) { this.reader = reader; this.writer = writer; this.buf = ''; }
  async fill() {
    const { value, done } = await withTimeout(this.reader.read(), 'reply');
    if (done) throw new SmtpError('The mail server closed the connection unexpectedly.');
    this.buf += DEC.decode(value, { stream: true });
  }
  async readLine() {
    for (;;) {
      const i = this.buf.indexOf('\n');
      if (i >= 0) { const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1); return line; }
      await this.fill();
    }
  }
  async readReply() {
    const lines = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) return { code: Number(line.slice(0, 3)), lines, text: lines.join('\n') };
      if (!/^\d{3}-/.test(line)) throw new SmtpError('Unexpected reply from the mail server: ' + line.slice(0, 80));
    }
  }
  async send(line) { await withTimeout(this.writer.write(ENC.encode(line + '\r\n')), 'send'); }
  async sendRaw(str) { await withTimeout(this.writer.write(ENC.encode(str)), 'send'); }
  async cmd(line, okCodes, hint) {
    await this.send(line);
    const r = await this.readReply();
    if (!okCodes.includes(r.code)) throw new SmtpError(explain(r, hint), r.code);
    return r;
  }
}

export function explain(r, hint) {
  const detail = (r.lines[r.lines.length - 1] || '').replace(/^\d{3}[ -]/, '').slice(0, 160);
  if (r.code === 535 || r.code === 534) return `The mail server refused the username or password (${r.code}). Gmail and Zoho need an app password, not your normal one.`;
  if (r.code === 550 || r.code === 553 || r.code === 554) return `The mail server rejected the message (${r.code}): ${detail}`;
  return `${hint ? hint + ': ' : ''}the mail server replied ${r.code} ${detail}`;
}

const clean = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
const b64 = (str) => { const bytes = ENC.encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const b64Bytes = (bytes) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
const mimeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOnly = (a) => clean(a).replace(/[<>\s,;]/g, '');

function stripTags(html) {
  return String(html).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|h\d|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}

// attachments: [{ filename, contentType, data: Uint8Array }]
export function buildMime({ fromName, fromEmail, to, subject, html, attachments = [], messageId, date = new Date() }) {
  const nl = '\r\n';
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const bAlt = 'alt_' + rand(); const bMix = 'mix_' + rand();
  const from = fromName ? `${mimeWord(clean(fromName))} <${addrOnly(fromEmail)}>` : addrOnly(fromEmail);
  const head = [
    `From: ${from}`, `To: <${addrOnly(to)}>`, `Subject: ${mimeWord(clean(subject))}`, `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId || rand()}@${(addrOnly(fromEmail).split('@')[1]) || 'nirmaancrm'}>`, 'MIME-Version: 1.0',
  ];
  const alt = [`--${bAlt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(stripTags(html))),
    `--${bAlt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html)), `--${bAlt}--`];
  let body;
  if (!attachments.length) {
    head.push(`Content-Type: multipart/alternative; boundary="${bAlt}"`);
    body = alt.join(nl);
  } else {
    head.push(`Content-Type: multipart/mixed; boundary="${bMix}"`);
    const parts = [`--${bMix}`, `Content-Type: multipart/alternative; boundary="${bAlt}"`, '', ...alt];
    for (const a of attachments) {
      const fn = clean(a.filename).replace(/"/g, '');
      parts.push(`--${bMix}`, `Content-Type: ${clean(a.contentType) || 'application/octet-stream'}; name="${fn}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${fn}"`, '', wrap76(b64Bytes(a.data)));
    }
    parts.push(`--${bMix}--`);
    body = parts.join(nl);
  }
  return head.join(nl) + nl + nl + body;
}

// Dot-stuff and terminate a DATA payload.
export function dataPayload(mime) {
  return mime.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n';
}

// Runs EHLO → (optional STARTTLS via upgrade()) → AUTH → MAIL/RCPT/DATA → QUIT.
// io: { link }, upgrade: async () => new SmtpLink over TLS (STARTTLS mode only)
export async function runSession({ link, upgrade, cfg, message }) {
  const greet = await link.readReply();
  if (greet.code !== 220) throw new SmtpError(explain(greet, 'Greeting'), greet.code);
  let ehlo = await link.cmd('EHLO nirmaancrm.app', [250], 'EHLO');
  if (upgrade) {
    if (!/STARTTLS/i.test(ehlo.text)) throw new SmtpError('This server does not offer STARTTLS on this port. Try port 465 with SSL/TLS.');
    await link.cmd('STARTTLS', [220], 'STARTTLS');
    link = await upgrade();
    ehlo = await link.cmd('EHLO nirmaancrm.app', [250], 'EHLO');
  }
  const advertised = (ehlo.text.match(/AUTH[ =](.*)/i) || [, ''])[1].toUpperCase();
  if (advertised.includes('PLAIN') || !advertised.includes('LOGIN')) {
    await link.cmd('AUTH PLAIN ' + b64(`\0${cfg.username}\0${cfg.password}`), [235], 'Login');
  } else {
    await link.cmd('AUTH LOGIN', [334], 'Login');
    await link.cmd(b64(cfg.username), [334], 'Login');
    await link.cmd(b64(cfg.password), [235], 'Login');
  }
  await link.cmd(`MAIL FROM:<${addrOnly(message.fromEmail)}>`, [250], 'Sender');
  await link.cmd(`RCPT TO:<${addrOnly(message.to)}>`, [250, 251], 'Recipient');
  await link.cmd('DATA', [354], 'DATA');
  await link.sendRaw(dataPayload(buildMime(message)));
  const done = await link.readReply();
  if (done.code !== 250) throw new SmtpError(explain(done, 'Send'), done.code);
  try { await link.send('QUIT'); } catch (e) { /* already delivered */ }
  return { ok: true, serverReply: done.lines[done.lines.length - 1] };
}
