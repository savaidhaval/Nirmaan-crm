// tests/security.mjs — negative / safeguard tests against a running instance.
//   BASE=http://localhost:8787 OWNER_EMAIL=... OWNER_PASSWORD=... node tests/security.mjs
// Creates throw-away users/projects (names start with "zz-test"). Run on staging or local, not production.
const BASE = process.env.BASE || 'http://localhost:8787';
const OWNER = { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD };
if (!OWNER.email || !OWNER.password) { console.error('Set OWNER_EMAIL and OWNER_PASSWORD'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

class Client {
  constructor() { this.cookie = ''; }
  async call(method, path, body, { csrf = true, raw = false } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (csrf) headers['X-NirmaanCRM'] = '1';
    let payload = body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    if (raw) return res;
    let data = null; try { data = await res.json(); } catch (e) { /* not json */ }
    return { status: res.status, data };
  }
  login(email, password) { return this.call('POST', '/api/auth/login', { email, password }); }
}

const run = Date.now().toString(36);
const owner = new Client();
const l = await owner.login(OWNER.email, OWNER.password);
if (l.status !== 200) { console.error('Owner login failed', l.status, l.data); process.exit(2); }
if (l.data.data.must_change_password) { console.error('Owner must change password first (log in once in the browser).'); process.exit(2); }

// --- unauthenticated + CSRF
{
  const anon = new Client();
  ok('anon /api/projects -> 401', (await anon.call('GET', '/api/projects')).status === 401);
  ok('anon /api/sales/leads -> 401', (await anon.call('GET', '/api/sales/leads')).status === 401);
  ok('anon /api/print/asset/signature -> 401', (await anon.call('GET', '/api/print/asset/signature')).status === 401);
  ok('anon /brand/signature.png not served', (await anon.call('GET', '/brand/signature.png', null, { raw: true })).status === 404);
  ok('POST without X-NirmaanCRM -> 403', (await owner.call('POST', '/api/projects', { name: 'x', code: 'x' }, { csrf: false })).status === 403);
  const bad = await anon.login(OWNER.email, 'definitely-wrong');
  ok('wrong password -> 401 (not 500)', bad.status === 401 || bad.status === 429, String(bad.status));
}

// --- fixtures
const pr = await owner.call('POST', '/api/projects', { name: 'zz-test ' + run, code: 'ZZ' + run.toUpperCase().slice(-5) });
const pid = pr.data.data.id;
const other = await owner.call('POST', '/api/projects', { name: 'zz-test other ' + run, code: 'ZO' + run.toUpperCase().slice(-5) });
const otherPid = other.data.data.id;
const mk = async (role, projects) => {
  const email = `zz-${role}-${run}@test.local`;
  const r = await owner.call('POST', '/api/users', { name: 'zz ' + role, email, role, projects });
  const c = new Client();
  const lg = await c.login(email, r.data.data.temporaryPassword);
  return { c, id: r.data.data.id, email, temp: r.data.data.temporaryPassword, must: lg.data && lg.data.data && lg.data.data.must_change_password };
};
const site = await mk('site', [pid]);
const sales = await mk('sales', [pid]);

// --- forced password change
ok('new user must change password', site.must === true);
ok('blocked from API until password changed', (await site.c.call('GET', '/api/projects')).status === 403);
for (const u of [site, sales]) {
  const ch = await u.c.call('POST', '/api/auth/change-password', { currentPassword: u.temp, newPassword: 'ZzStrongPass-' + run });
  ok('change password works', ch.status === 200, JSON.stringify(ch.data));
}
ok('short new password refused', (await (async () => { const t = await mk('viewer', []); return t.c.call('POST', '/api/auth/change-password', { currentPassword: t.temp, newPassword: 'short' }); })()).status === 400);

// --- site role
ok('site cannot read leads', (await site.c.call('GET', '/api/sales/leads')).status === 403);
ok('site cannot read users', (await site.c.call('GET', '/api/users')).status === 403);
ok('site cannot read settings', (await site.c.call('GET', '/api/settings')).status === 403);
ok('site cannot read audit', (await site.c.call('GET', '/api/audit')).status === 403);
ok('site cannot see dashboard money', (await site.c.call('GET', '/api/dashboard')).status === 403);
ok('site cannot read bills', (await site.c.call('GET', '/api/procurement/bills')).status === 403);
ok('site cannot read email settings', (await site.c.call('GET', '/api/email/settings')).status === 403);
ok('site cannot export-all', (await site.c.call('GET', '/api/export-all')).status === 403);
ok('site cannot see other project docs', (await site.c.call('GET', `/api/documents?project_id=${otherPid}`)).status === 403);

// --- drawings: site sees only the current IFC
const dw = await owner.call('POST', '/api/drawings', { project_id: pid, code: 'T-' + run, title: 'Test' });
const did = dw.data.data.id;
await owner.call('POST', `/api/drawings/${did}/revisions`, { status: 'ifc' });
await owner.call('POST', `/api/drawings/${did}/revisions`, { status: 'ifc' });
const revsOwner = (await owner.call('GET', `/api/drawings/${did}/revisions`)).data.data.revisions;
const revsSite = (await site.c.call('GET', `/api/drawings/${did}/revisions`)).data.data.revisions;
ok('owner sees full revision history', revsOwner.length === 2 && revsOwner.some((r) => r.status === 'superseded'));
ok('site sees only the live IFC', revsSite.length === 1 && revsSite[0].status === 'ifc' && revsSite[0].rev_no === 'R1', JSON.stringify(revsSite));
ok('site cannot issue revisions', (await site.c.call('POST', `/api/drawings/${did}/revisions`, { status: 'ifc' })).status === 403);

// --- uploads
const fdSvg = new FormData(); fdSvg.append('file', new Blob(['<svg onload=alert(1)/>'], { type: 'image/svg+xml' }), 'x.svg'); fdSvg.append('title', 'svg');
ok('SVG upload refused', (await owner.call('POST', '/api/files/upload', fdSvg)).status === 400);
const fdHtml = new FormData(); fdHtml.append('file', new Blob(['<script>1</script>'], { type: 'text/html' }), 'x.html'); fdHtml.append('title', 'html');
ok('HTML upload refused', (await owner.call('POST', '/api/files/upload', fdHtml)).status === 400);
const fdBig = new FormData(); fdBig.append('file', new Blob([new Uint8Array(1700000)], { type: 'application/pdf' }), 'big.pdf'); fdBig.append('title', 'big');
const big = await owner.call('POST', '/api/files/upload', fdBig);
ok('over-size file refused or sent to Drive', big.status === 413 || big.status === 200 || big.status === 503, String(big.status));
const fdSig = new FormData(); fdSig.append('file', new Blob([new Uint8Array(70)], { type: 'image/png' }), 's.png'); fdSig.append('title', 'sig'); fdSig.append('series_key', 'brand:signature');
ok('site cannot upload brand pictures', (await site.c.call('POST', '/api/files/upload', fdSig)).status === 403);

// --- documents: can't point at someone else's blob
const evil = await owner.call('POST', '/api/documents', { title: 'evil', blob_id: 1, store: 'd1', external_url: 'javascript:alert(1)' });
ok('link documents must be https', evil.status === 400);

// --- share links
const intern = new FormData(); intern.append('file', new Blob(['internal'], { type: 'text/plain' }), 'i.txt'); intern.append('title', 'internal-' + run); intern.append('project_id', String(pid)); intern.append('audience', 'internal');
const iDoc = (await owner.call('POST', '/api/files/upload', intern)).data;
if (iDoc && iDoc.data) ok('API refuses a link for an internal file', (await owner.call('POST', '/api/share-links', { document_id: iDoc.data.id, recipient_label: 'x' })).status === 400);
const pub = new FormData(); pub.append('file', new Blob(['customer file'], { type: 'text/plain' }), 'c.txt'); pub.append('title', 'customer-' + run); pub.append('project_id', String(pid)); pub.append('audience', 'customer');
const cDoc = (await owner.call('POST', '/api/files/upload', pub)).data.data;
const anon = new Client();
const lk = (await owner.call('POST', '/api/share-links', { document_id: cDoc.id, recipient_label: 'tester', max_views: 2 })).data.data;
ok('valid link opens file', (await anon.call('GET', lk.link + '/file', null, { raw: true })).status === 200);
ok('wrong token -> 410', (await anon.call('GET', '/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/file', null, { raw: true })).status === 410);
await anon.call('GET', lk.link + '/file', null, { raw: true });
ok('view limit enforced', (await anon.call('GET', lk.link + '/file', null, { raw: true })).status === 410);
const lk2 = (await owner.call('POST', '/api/share-links', { document_id: cDoc.id, recipient_label: 'revoke-me' })).data.data;
const list = (await owner.call('GET', '/api/share-links')).data.data.links;
const mine = list.find((x) => x.recipient_label === 'revoke-me');
await owner.call('POST', `/api/share-links/${mine.id}/revoke`);
ok('revoked link -> 410', (await anon.call('GET', lk2.link + '/file', null, { raw: true })).status === 410);
ok('share link list never exposes token hashes', !JSON.stringify(list).includes('token_hash'));
ok('sales cannot list share links', (await sales.c.call('GET', '/api/share-links')).status === 403);

// --- settings & secrets
ok('unknown setting key refused', (await owner.call('POST', '/api/settings/smtp.password', { value: 'x' })).status === 400);
const st = (await owner.call('GET', '/api/settings')).data.data.settings;
ok('secrets masked in settings API', Object.entries(st).every(([k, v]) => !/password|token|secret|api_key/i.test(k) || v === '[hidden]'));
const br = (await owner.call('GET', '/api/branding')).data.data.branding;
ok('branding API never returns ciphertext', !br || (!('pan_enc' in br) && !('bank_account_enc' in br)));
const brSales = (await sales.c.call('GET', '/api/branding'));
ok('sales cannot read bank/PAN', brSales.status === 403 || !brSales.data.data.branding || (!brSales.data.data.branding.pan_masked && !brSales.data.data.branding.bank_account_masked));

// --- owner safeguards
const me = (await owner.call('GET', '/api/auth/me')).data.data.user;
ok('owner cannot deactivate self', (await owner.call('POST', `/api/users/${me.id}/deactivate`)).status === 400);
ok('cannot make a second Owner while switched off', (await owner.call('PUT', `/api/users/${sales.id}`, { role: 'owner' })).status === 403);
ok('non-owner cannot manage users', (await sales.c.call('POST', `/api/users/${site.id}/deactivate`)).status === 403);
const dea = await owner.call('POST', `/api/users/${site.id}/deactivate`);
ok('deactivate works', dea.status === 200);
ok('deactivated user is logged out immediately', (await site.c.call('GET', '/api/projects')).status === 401);

// --- sales rules
const unit = (await owner.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 1, unit_no: 'T' + run.slice(-3), price_paise: 10000000 })).data.data.id;
await owner.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Booking', pct_bp: 1000 }, { stage_name: 'Rest', pct_bp: 9000 }] });
const b1 = await owner.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz one', token_paise: 100000 });
const b2 = await owner.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz two' });
ok('flat cannot be booked twice', b1.status === 200 && b2.status === 409, `${b1.status}/${b2.status}`);
const bk = (await owner.call('GET', `/api/sales/bookings/${b1.data.data.id}`)).data.data;
ok('demands add up to the price to the paisa', bk.demands.reduce((t, d) => t + d.amount_paise, 0) === bk.booking.agreed_price_paise);
ok('bad payment plan refused', (await owner.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'x', pct_bp: 9000 }] })).status === 400);

// --- PO maker-checker
const vend = (await owner.call('POST', '/api/procurement/vendors', { name: 'zz vendor ' + run })).data.data.id;
const po = (await owner.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: vend, items: [{ description: 'x', qty: 1, rate_paise: 100000 }] })).data.data.id;
await owner.call('POST', `/api/procurement/pos/${po}/submit`);
ok('creator cannot approve own PO', (await owner.call('POST', `/api/procurement/pos/${po}/approve`)).status === 403);

// --- archive
await owner.call('POST', `/api/projects/${otherPid}/archive`);
const visible = (await owner.call('GET', '/api/projects')).data.data.projects.map((p) => p.id);
ok('archived project hidden from lists', !visible.includes(otherPid));
ok('archived project can be restored', (await owner.call('POST', `/api/projects/${otherPid}/restore`)).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
