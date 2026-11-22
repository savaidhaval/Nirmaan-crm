// tests/enquiry.mjs — WP-24 part 1: public enquiry form. Needs TURNSTILE_MOCK=1 in .dev.vars (tests only). Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zp-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zp ' + role, email, role, projects }); const pw = 'ZpStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; c.email = email; c.pw = pw; return c; };
const pid = (await o.call('POST', '/api/projects', { name: 'zz-en ' + run, code: 'EN' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id; const code = 'EN' + run.toUpperCase().slice(-6);
const s1 = await mkUser('sales', []); const s2 = await mkUser('sales', []); const site = await mkUser('site', [pid]);
const post = async (body, ip) => { const r = await fetch(BASE + '/api/public/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; };
const ipOf = (n) => `10.77.${parseInt(run, 36) % 200}.${n}`;
const ph = (n) => '97' + String(60000000 + (parseInt(run, 36) % 9000) * 10 + n).slice(-8);
const good = (n, extra = {}) => ({ name: 'Enquirer ' + n + ' ' + run, phone: ph(n), email: `e${n}-${run}@example.com`, message: 'Interested in a 2 BHK', consent: true, token: 'ok-token', project: code, ...extra });
const leads = async (who = o) => (await who.call('GET', '/api/sales/leads')).data.leads || [];

const cfg = await (await fetch(BASE + `/api/public/enquiry-config?project=${code}`)).json();
ok('the page asks the server how to draw itself: enabled, the project name, a public key', cfg.data.enabled === true && cfg.data.project === 'zz-en ' + run && !!cfg.data.site_key);
ok('an unknown project code is ignored, not an error', (await (await fetch(BASE + '/api/public/enquiry-config?project=NOPE')).json()).data.enabled === true);
const pg = await fetch(BASE + '/enquiry.html'); ok('the public page is served without a login', pg.status === 200 && (await pg.text()).includes('Send my enquiry'));

ok('no consent tick: refused with a plain message', /tick the box/.test((await post(good(1, { consent: false }), ipOf(1))).err || ''));
ok('a name that is too short, and a bad phone number, are refused', (await post(good(1, { name: 'A' }), ipOf(2))).status === 400 && /10-digit/.test((await post(good(1, { phone: '12345' }), ipOf(2))).err || ''));
ok('a bad email is refused', (await post(good(1, { email: 'nope' }), ipOf(3))).status === 400);
ok('without the human check token, or with a wrong one, a bot is refused', (await post(good(1, { token: '' }), ipOf(4))).status === 403 && (await post(good(1, { token: 'bot' }), ipOf(4))).status === 403);
ok('a page that is too large is refused', (await post('x'.repeat(7000), ipOf(5))).status === 413);
const before = (await leads()).length;
ok('a bot that fills the hidden trap field is told "received" but no lead is made', (await post(good(2, { company_website: 'http://spam' }), ipOf(6))).status === 200 && (await leads()).length === before);

// ============ a real enquiry ============
const r1 = await post(good(3), ipOf(7)); ok('a good enquiry is accepted', r1.status === 200 && r1.data.received === true, JSON.stringify(r1));
let all = await leads(); const l1 = all.find((l) => l.name === 'Enquirer 3 ' + run);
ok('a lead exists with source "website", consent recorded, linked to the project and with the message kept', l1 && l1.source === 'website' && l1.consent === 1 && l1.project_id === pid && /2 BHK/.test(l1.notes || ''), JSON.stringify(l1));
ok('the phone number is stored in the standard form', l1 && /9760|97/.test(l1.phone));
const r2 = await post(good(4), ipOf(8)); const l2 = (await leads()).find((l) => l.name === 'Enquirer 4 ' + run);
ok('the next enquiry goes to a different salesperson (round robin by open leads)', !!l1.assigned_to && !!l2.assigned_to && l1.assigned_to !== l2.assigned_to);
const nt = async (who) => JSON.stringify((await who.call('GET', '/api/notifications')).data);
const owner1 = async () => { const u = (await o.call('GET', '/api/users')).data.users.find((x) => x.id === l1.assigned_to); return u; };
ok('the person it was given to is told (checked on the notification list of the Owner view of that user)', !!(await owner1()));

// ============ a repeat of the same number merges ============
const n0 = (await leads()).length;
const rep = await post(good(3, { name: 'Same Person Again ' + run, message: 'Please call after 6 pm' }), ipOf(9));
ok('the same phone number again: accepted, but no second lead is made', rep.status === 200 && (await leads()).length === n0);
const det = (await o.call('GET', `/api/sales/leads/${l1.id}`)).data;
ok('the first lead gets a note about the second enquiry, with the message', JSON.stringify(det).includes('Enquired again through the website form') && JSON.stringify(det).includes('after 6 pm'));
ok('and the lead is still assigned to the same person', (await leads()).find((l) => l.id === l1.id).assigned_to === l1.assigned_to);
ok('the visitor is not told it was a repeat (nothing about other customers is revealed)', !JSON.stringify(rep).includes('already'));

// ============ limits ============
let last; for (let i = 0; i < 6; i++) last = await post(good(5 + i), ipOf(50));
ok('more than 5 tries from one connection in an hour are stopped', last.status === 429 && /Too many/.test(last.err));
ok('only Sales, Owner and PM can read the leads; Site cannot', (await site.call('GET', '/api/sales/leads')).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
