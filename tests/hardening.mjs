// tests/hardening.mjs — WP-23: every route needs a sign-in, every write needs the header, no route crashes for any role, delete is Owner-only, no secret leaves in a response or export, query counts stay under the cap. Same env vars as security.mjs.
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
import fs from 'node:fs';
const src = ['src/index.js', ...fs.readdirSync('src/routes').map((f) => 'src/routes/' + f)].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const routes = [...new Set([...src.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'/g)].map((m) => m[1].toUpperCase() + ' ' + m[2]))].map((x) => { const [method, path] = x.split(' '); return { method, path, url: path.replace(/:[a-zA-Z_]+/g, '1') }; });
console.log(`INFO  ${routes.length} routes found`);
const PUBLIC = [/^\/api\/health/, /^\/api\/auth\//, /^\/api\/storage\/google\/callback/, /^\/api\/public\//, /^\/s\//, /^\/c\//, /^\/d\//, /^\/brand\//, /^\/api\/webhooks\//, /^\/api\/branding\/public/, /^\/api\/legal/, /^\/__/];
const isPublic = (p) => PUBLIC.some((re) => re.test(p));
const priv = routes.filter((r) => !isPublic(r.path));
// harness users
const roles = {}; for (const r of ['pm', 'site', 'sales', 'accounts', 'purchase', 'hr', 'viewer']) roles[r] = await mkUser(r, []); roles.owner = o;
const raw = (method, url, cookie, header = true, body) => fetch(BASE + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(header ? { 'X-NirmaanCRM': '1' } : {}), 'Content-Type': 'application/json' }, body: method === 'GET' || method === 'HEAD' ? undefined : (body || '{}'), redirect: 'manual' });

// ============ 1. no sign-in, no access ============
const open1 = []; for (const r of priv) { const res = await raw(r.method, r.url, null, true); if (res.status !== 401 && res.status !== 404 && !(res.status >= 300 && res.status < 400)) open1.push(`${r.method} ${r.path} -> ${res.status}`); }
ok(`all ${priv.length} private routes refuse a request with no sign-in (401)`, open1.length === 0, open1.slice(0, 12).join(' | '));
// ============ 2. every write needs the X-NirmaanCRM header, even when signed in ============
const writes = priv.filter((r) => r.method !== 'GET'); const open2 = [];
for (const r of writes) { const res = await raw(r.method, r.url, o.cookie, false); if (res.status !== 403 && res.status !== 404) open2.push(`${r.method} ${r.path} -> ${res.status}`); }
ok(`all ${writes.length} writes refuse a signed-in request without the header (403)`, open2.length === 0, open2.slice(0, 12).join(' | '));

// ============ 3. no route crashes, for any role ============
const gets = priv.filter((r) => r.method === 'GET' && !/export-all|\/file$|download|backup|print\/|ai\//.test(r.path));
const crashes = [], counts = [], secrets = [];
const KEYBAD = /^(password|password_hash|token_hash|totp_secret|api_key|app_key|secret|smtp_password|brevo_key)$/i;
const walk = (v, where, acc) => { if (Array.isArray(v)) v.forEach((x) => walk(x, where, acc)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (KEYBAD.test(k) && x) acc.push(`${where}: key ${k}`); if (/_enc$/.test(k) && x) acc.push(`${where}: ${k} has a value`); walk(x, where, acc); } else if (typeof v === 'string' && /^\d{12}$/.test(v)) acc.push(`${where}: a bare 12-digit number`); };
for (const [role, who] of Object.entries(roles)) {
  for (const r of gets) {
    const res = await raw('GET', r.url, who.cookie); const text = await res.text();
    if (res.status >= 500) crashes.push(`${role} GET ${r.path} -> ${res.status}`);
    const n = Number(res.headers.get('x-query-count')); if (n) counts.push([n, Number(res.headers.get('x-time-ms')), `${role} ${r.path}`]);
    if (role === 'owner' && res.status === 200 && /json/.test(res.headers.get('content-type') || '')) { try { walk(JSON.parse(text), r.path, secrets); } catch (e) { /* not json */ } }
  }
}
ok(`no private route returns a server error for any of the 8 roles (${gets.length} routes x 8 roles)`, crashes.length === 0, crashes.slice(0, 10).join(' | '));
ok('no response to the Owner carries a password, key, token hash, encrypted value or bare 12-digit (Aadhaar-like) number', secrets.length === 0, secrets.slice(0, 8).join(' | '));
counts.sort((a, b) => b[0] - a[0]);
console.log('INFO  busiest reads (database statements, ms): ' + counts.slice(0, 8).map((c) => `${c[2]} ${c[0]}/${c[1]}ms`).join('; '));
ok('no read uses more than 45 database statements (free-plan cap is about 50)', counts.every((c) => c[0] <= 45), counts.filter((c) => c[0] > 45).slice(0, 6).map((c) => `${c[2]} ${c[0]}`).join(' | '));

// ============ 4. only the Owner deletes ============
const dels = priv.filter((r) => r.method === 'DELETE' && !/^\/api\/me\//.test(r.path)); const delBad = [];
for (const [role, who] of Object.entries(roles)) { if (role === 'owner') continue; for (const r of dels) { const res = await raw('DELETE', r.url, who.cookie); if (res.status === 200 || res.status === 204) delBad.push(`${role} ${r.path} -> ${res.status}`); } }
ok(`${dels.length} delete routes: no other role can delete (only the Owner)`, delBad.length === 0, delBad.join(' | '));

// ============ 5. money and private screens are refused to roles that should not see them ============
const mustDeny = { site: ['/api/users', '/api/settings', '/api/audit?limit=5', '/api/export-all?part=1', '/api/tally/log', '/api/bank/rows', '/api/reports/pack', '/api/budget/overview?project_id=1', '/api/rera/summary?project_id=1', '/api/feasibility?project_id=1'],
  sales: ['/api/users', '/api/audit?limit=5', '/api/export-all?part=1', '/api/tally/log', '/api/bank/rows', '/api/reports/pack', '/api/procurement/bills', '/api/petty/funds'],
  purchase: ['/api/users', '/api/audit?limit=5', '/api/export-all?part=1', '/api/tally/log', '/api/bank/rows', '/api/sales/bookings', '/api/reports/pack'],
  hr: ['/api/audit?limit=5', '/api/export-all?part=1', '/api/tally/log', '/api/bank/rows', '/api/sales/bookings', '/api/procurement/bills', '/api/redev/societies'],
  viewer: ['/api/users', '/api/export-all?part=1', '/api/bank/rows'], pm: ['/api/users', '/api/export-all?part=1', '/api/bank/rows', '/api/tally/log'], accounts: ['/api/users', '/api/export-all?part=1'] };
const leaks = []; for (const [role, list] of Object.entries(mustDeny)) for (const u of list) { const res = await raw('GET', u, roles[role].cookie); if (res.status === 200) leaks.push(`${role} ${u}`); }
ok('roles are refused the screens that are not theirs (users, settings, audit, backups, bank, Tally, money)', leaks.length === 0, leaks.join(' | '));

// ============ 6. the Everything-backup holds no secret ============
let all = ''; for (const part of [1, 2, 3]) all += await (await raw('GET', `/api/export-all?part=${part}`, o.cookie)).text();
const parsed = []; for (const part of [1, 2, 3]) parsed.push(JSON.parse(await (await raw('GET', `/api/export-all?part=${part}`, o.cookie)).text()));
const exSecrets = []; for (const p of parsed) walk(p.tables, 'export', exSecrets);
ok('the three backup parts hold no password, key, token hash, encrypted value or 12-digit number', exSecrets.length === 0, exSecrets.slice(0, 6).join(' | '));
ok('the backup holds no user password hash and no email-login secret', !/password_hash|totp_secret|"recovery_code/i.test(all));
ok('the backup has every part and lists project assignments, branding and users', parsed.every((p) => p.of === 3) && parsed.some((p) => p.tables.project_members) && parsed.some((p) => p.tables.brand_profiles) && parsed.some((p) => p.tables.users));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
