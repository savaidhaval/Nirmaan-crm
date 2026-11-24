// tests/email.mjs — the mail path end to end without a real mail server: the SMTP conversation (scripted fake server), message building,
// and the app's mail features in test mode (MAIL_MOCK: an address containing "fail" is refused). Needs BASE/OWNER_EMAIL/OWNER_PASSWORD like the other suites.
import { buildMime, dataPayload, runSession, SmtpLink, SmtpError } from '../src/core/smtp-protocol.js';
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

// ---------- a scripted SMTP server ----------
function fakeServer({ ehlo = ['250-mail.test', '250-AUTH PLAIN LOGIN', '250 SIZE 1000'], authOk = true, rcptCode = 250, noStarttls = false } = {}) {
  const enc = new TextEncoder(), dec = new TextDecoder(); const q = []; let wake = null; const seen = []; let inData = false, data = '';
  const push = (s) => { q.push(enc.encode(s + '\r\n')); if (wake) { wake(); wake = null; } };
  const reader = { async read() { while (!q.length) await new Promise((r) => { wake = r; }); return { value: q.shift(), done: false }; } };
  const writer = { async write(bytes) {
    const text = dec.decode(bytes);
    if (inData) { data += text; if (data.endsWith('\r\n.\r\n')) { inData = false; seen.push('<DATA>'); push('250 2.0.0 queued'); } return; }
    for (const line of text.split('\r\n').filter(Boolean)) {
      seen.push(line);
      if (/^EHLO/.test(line)) { for (const l of ehlo) push(l); }
      else if (/^STARTTLS/.test(line)) push('220 go ahead');
      else if (/^AUTH PLAIN/.test(line)) push(authOk ? '235 ok' : '535 5.7.8 bad credentials');
      else if (/^AUTH LOGIN/.test(line)) push('334 VXNlcm5hbWU6');
      else if (/^MAIL FROM/.test(line)) push('250 ok');
      else if (/^RCPT TO/.test(line)) push(rcptCode === 250 ? '250 ok' : `${rcptCode} 5.1.1 no such user`);
      else if (/^DATA/.test(line)) { push('354 end with dot'); inData = true; data = ''; }
      else if (/^QUIT/.test(line)) push('221 bye');
      else if (seen.filter((x) => /^AUTH LOGIN/.test(x)).length && !/^AUTH/.test(line)) push(authOk ? (seen.filter((x) => /^[A-Za-z0-9+/=]+$/.test(x)).length >= 2 ? '235 ok' : '334 UGFzc3dvcmQ6') : '535 bad');
    }
  } };
  push('220 mail.test ESMTP');
  return { link: new SmtpLink(reader, writer), seen, get data() { return data; } };
}
const cfg = { username: 'crm@x.in', password: 'pw' };
const message = { fromName: 'Nirmaan ₹ Homes', fromEmail: 'crm@x.in', to: 'buyer@example.com', subject: 'Payment demand — Sai Heights ₹ 12,50,000', html: '<p>Hello</p>\n.\n<p>dot line above</p>' };

let s = fakeServer(); let r = await runSession({ link: s.link, upgrade: null, cfg, message });
ok('a normal send runs EHLO, AUTH, MAIL, RCPT, DATA, QUIT in order', r.ok && ['EHLO', 'AUTH PLAIN', 'MAIL FROM:<crm@x.in>', 'RCPT TO:<buyer@example.com>', 'DATA', '<DATA>', 'QUIT'].every((k, i) => (s.seen[i] || '').startsWith(k)), JSON.stringify(s.seen));
s = fakeServer({ ehlo: ['250-mail.test', '250 AUTH LOGIN'] }); r = await runSession({ link: s.link, upgrade: null, cfg, message });
ok('a server that only offers AUTH LOGIN is handled', r.ok && s.seen.some((l) => l === 'AUTH LOGIN'), JSON.stringify(s.seen));
s = fakeServer({ authOk: false }); let e = await runSession({ link: s.link, upgrade: null, cfg, message }).catch((x) => x);
ok('a wrong password gives the plain "app password" message', e instanceof SmtpError && e.code === 535 && /app password/.test(e.message), String(e.message));
s = fakeServer({ rcptCode: 550 }); e = await runSession({ link: s.link, upgrade: null, cfg, message }).catch((x) => x);
ok('a refused recipient is reported, not swallowed', e instanceof SmtpError && /rejected the message \(550\)/.test(e.message), String(e.message));
s = fakeServer({ ehlo: ['250-mail.test', '250 AUTH PLAIN'] }); e = await runSession({ link: s.link, upgrade: async () => s.link, cfg, message }).catch((x) => x);
ok('STARTTLS on a server that does not offer it says so', e instanceof SmtpError && /does not offer STARTTLS/.test(e.message), String(e.message));
s = fakeServer({ ehlo: ['250-mail.test', '250-STARTTLS', '250 AUTH PLAIN'] }); r = await runSession({ link: s.link, upgrade: async () => s.link, cfg, message });
ok('STARTTLS upgrade happens before login', r.ok && s.seen.indexOf('STARTTLS') > -1 && s.seen.indexOf('STARTTLS') < s.seen.findIndex((l) => l.startsWith('AUTH')), JSON.stringify(s.seen));

// ---------- the message itself ----------
const mime = buildMime({ ...message, messageId: 'abc' });
const head = mime.split('\r\n\r\n')[0];
ok('headers are plain ASCII (rupee sign and long subject are encoded)', /^[\x20-\x7e\r\n]*$/.test(head), head);
const subj = head.split('\r\n').filter((l, i, a) => l.startsWith('Subject:') || (a[i - 1] && /^ =\?UTF-8/.test(l)));
ok('every encoded word is at most 75 characters (RFC 2047)', head.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g).every((w) => w.length <= 75), head);
const decodeWords = (h) => (h.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g) || []).map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
ok('the subject decodes back to the original text', decodeWords(head.split('Subject:')[1].split('Date:')[0]) === message.subject, decodeWords(head.split('Subject:')[1]));
const inj = buildMime({ ...message, subject: 'Hi\r\nBcc: evil@x.com', to: 'a@b.com\r\nBcc: evil@x.com' });
ok('a line break in the subject or address cannot add a header', !/\r\nBcc:/i.test(inj.split('\r\n\r\n')[0]), inj.split('\r\n\r\n')[0]);
ok('a lone "." line in the body is dot-stuffed and the payload ends correctly', dataPayload('a\n.\nb').includes('\r\n..\r\n') && dataPayload('a').endsWith('\r\n.\r\n'));
const att = buildMime({ ...message, attachments: [{ filename: 'demand "1".pdf', contentType: 'application/pdf', data: new Uint8Array([1, 2, 3]) }] });
ok('an attachment makes a multipart/mixed message with a clean file name', /multipart\/mixed/.test(att) && /filename="demand 1.pdf"/.test(att));
ok('the body carries both a plain-text and an HTML part', /text\/plain/.test(mime) && /text\/html/.test(mime));

// ---------- the app, in test mode ----------
class C { constructor() { this.cookie = ''; } async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; if (b) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await res.json(); } catch (x) { /* */ } return { status: res.status, data: d && d.data, err: d && d.error }; } }
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });

// If a check throws, put the shared switches back so the suites that follow are not affected.
const putBack = async () => { try { await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' }); await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' }); } catch (e) { /* ignore */ } };
process.on('uncaughtException', async (e) => { console.error(e); await putBack(); process.exit(1); });
const run = Date.now().toString(36); let seq = 0;
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // the 10% before-registration rule is tested in m4_step1
await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' });   // this suite certifies a payment-linked stage without sign-offs (that rule is tested in m3_step2)
const mkUser = async (role) => { const email = `em-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'em ' + role, email, role, projects: [] }); const pw = 'EmStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.email = email; c.id = r.data.id; return c; };
const pm = await mkUser('pm'); const sales = await mkUser('sales');

const st = (await o.call('GET', '/api/email/settings')).data;
ok('email settings never return the password or the API key', !('password' in st) && !('brevo_key' in st) && JSON.stringify(st).indexOf('enc:') === -1);
ok('only the Owner can change email settings', (await pm.call('POST', '/api/email/settings', { provider: 'smtp', host: 'h', username: 'u', from_email: 'a@b.in' })).status === 403);
ok('an unknown provider is refused', (await o.call('POST', '/api/email/settings', { provider: 'sendgrid' })).status === 400);
ok('saving settings switches email-code login off until a fresh test passes', (await o.call('POST', '/api/email/settings', { provider: 'smtp', host: 'smtp.example.com', port: 465, security: 'ssl', username: 'crm@example.com', from_name: 'Nirmaan', from_email: 'crm@example.com', password: 'secret-pass' })).status === 200 && (await o.call('GET', '/api/email/settings')).data.otp_enabled === false);
ok('the saved password is reported only as "set"', (await o.call('GET', '/api/email/settings')).data.password_set === true);
const t = (await o.call('POST', '/api/email/test')).data;
ok('the test email goes to the Owner only and switches email-code login on', t.sent === true && t.to === process.env.OWNER_EMAIL && (await o.call('GET', '/api/email/settings')).data.otp_enabled === true);
ok('PM cannot send the test email', (await pm.call('POST', '/api/email/test')).status === 403);
ok('the morning report can be sent on demand', (await o.call('POST', '/api/email/digest-now')).data.sent === true);

// login by emailed code
ok('the login screen is told that email codes are on', (await new C().call('GET', '/api/auth/methods')).data.otp === true);
const anon = new C();
const same = await anon.call('POST', '/api/auth/otp/send', { email: 'nobody-' + run + '@test.local' });
const real = await anon.call('POST', '/api/auth/otp/send', { email: pm.email });
ok('asking for a code gives the same answer for a real and a made-up address', same.status === 200 && real.status === 200 && same.data.message === real.data.message);
ok('a wrong code is refused', (await anon.call('POST', '/api/auth/otp/verify', { email: pm.email, code: '000000' })).status === 400);
const log = (await o.call('GET', '/api/email/log')).data.emails;
const otpRow = log.find((x) => x.to_email === pm.email && /login code/i.test(x.subject));
ok('the login code email is logged but the code itself is not stored', otpRow && otpRow.status === 'sent' && /not stored/.test(otpRow.body_html || ''), JSON.stringify(otpRow));
let n = 0; let last; for (let i = 0; i < 12; i++) { last = await anon.call('POST', '/api/auth/otp/verify', { email: pm.email, code: '1111' + String(i).padStart(2, '0') }); if (last.status === 429) n++; }
ok('guessing codes is throttled', n > 0);

// demand email + failed mail + retry
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-email ' + run, code: 'EM' + run.toUpperCase().slice(-6) })).data.id;
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Slab', pct_bp: 10000, milestone_key: 'em' + run }] });
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 2, unit_no: 'E' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 500 })).data.id;
const bkr = await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz mail buyer', phone: '97' + String(Date.now()).slice(-8), email: 'buyer@example.com', token_paise: 100000 }); if (!bkr.data) console.log('BOOKING FAILED', JSON.stringify(bkr), pid, unit);
const bk = bkr.data.id;
await o.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab', milestone_key: 'em' + run });
const ms = (await o.call('GET', `/api/site/milestones?project_id=${pid}`)).data.milestones.find((m) => m.milestone_key === 'em' + run);
const mdone = await o.call('POST', `/api/site/milestones/${ms.id}/done`, { actual_date: new Date().toISOString().slice(0, 10), cert_ref: 'ARCH/1 test', override_note: 'test project has no CC recorded' });
const dem = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0];
const de = await o.call('POST', `/api/sales/demands/${dem.id}/email`, {});
ok('a demand letter can be emailed to the customer', de.data && de.data.sent === true, JSON.stringify(de) + JSON.stringify(dem));
ok('a bad address is refused before anything is queued', (await o.call('POST', `/api/sales/demands/${dem.id}/email`, { to: 'not-an-address' })).status === 400);
const f = await o.call('POST', `/api/sales/demands/${dem.id}/email`, { to: 'will-fail@example.com' });
ok('a refused send is reported to the user', f.status === 200 && f.data.sent === false && /refused/.test(f.data.error || ''), JSON.stringify(f));
ok('sales cannot use the email log', (await sales.call('GET', '/api/email/log')).status === 403);
for (let i = 0; i < 4; i++) await o.call('POST', '/api/email/retry');
const failed = (await o.call('GET', '/api/email/log')).data.emails.find((x) => x.to_email === 'will-fail@example.com');
ok('a failed mail is retried and given up on after 3 attempts', failed && failed.status === 'failed' && failed.attempts === 3, JSON.stringify(failed));
const good = (await o.call('GET', '/api/email/log')).data.emails.find((x) => x.to_email === 'buyer@example.com' && x.template === 'demand');
ok('a sent demand is logged once with a sent time', good && good.status === 'sent' && good.attempts === 1 && !!good.sent_at, JSON.stringify(good));

await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
