// tests/inputs.mjs — the one input check every JSON request goes through (src/core/inputs.js), and the project and user field rules.
// Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, rawBody) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = rawBody !== undefined ? rawBody : b; if (b || rawBody !== undefined) { h['Content-Type'] = 'application/json'; if (rawBody === undefined) body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ }
    return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
const pid = (await o.call('POST', '/api/projects', { name: 'zz-in ' + run, code: 'IN' + run.toUpperCase().slice(-6), budget_paise: 50000000, created_at: '2000-01-01 00:00:00', created_by: 999999 })).data.id;
ok('a project with good values is created', pid > 0);
const proj = (await o.call('GET', `/api/projects/${pid}`)).data;
ok('created_at sent by the browser is ignored (the server sets it)', proj && !String(proj.created_at).startsWith('2000'), proj && proj.created_at);

// ---------- shape ----------
ok('a list instead of a form is refused', (await o.call('POST', '/api/budget/heads', null, '[1,2]')).status === 400);
ok('a "__proto__" field is refused', (await o.call('POST', '/api/budget/heads', null, '{"__proto__":{"x":1},"project_id":' + pid + '}')).status === 400);
ok('every refusal is plain words with code bad_input', (await o.call('POST', '/api/budget/heads', null, '[1]')).code === 'bad_input');

// ---------- money ----------
const head = (b) => o.call('POST', '/api/budget/heads', { project_id: pid, code: 'H' + Math.random().toString(36).slice(2, 6), name: 'Head', ...b });
let r = await head({ budget_paise: -500 });
ok('a negative amount is refused', r.status === 400 && /cannot be negative/.test(r.err), r.err);
r = await head({ budget_paise: 'abc' });
ok('words in an amount are refused', r.status === 400 && /amount in rupees/.test(r.err), r.err);
ok('an absurd amount is refused', (await head({ budget_paise: 1e16 })).status === 400);
ok('a good amount is accepted', (await head({ budget_paise: 1250050 })).status === 200);

// ---------- dates ----------
r = await o.call('PUT', `/api/projects/${pid}`, { target_date: '2026-02-30' });
ok('a date that does not exist (30 Feb) is refused', r.status === 400 && /proper date/.test(r.err), r.err);
ok('a date in another format is refused', (await o.call('PUT', `/api/projects/${pid}`, { start_date: '25/11/2026' })).status === 400);
ok('a proper date is accepted', (await o.call('PUT', `/api/projects/${pid}`, { target_date: '2028-03-31' })).status === 200);

// ---------- project fixed values ----------
ok('an unknown project status is refused', (await o.call('PUT', `/api/projects/${pid}`, { status: 'finished-ish' })).status === 400);
ok('an unknown project type is refused', (await o.call('POST', '/api/projects', { name: 'zz-in2 ' + run, code: 'IX' + run.toUpperCase().slice(-6), type: 'castle' })).status === 400);
ok('a known status is accepted', (await o.call('PUT', `/api/projects/${pid}`, { status: 'active' })).status === 200);

// ---------- phone, email, percentages ----------
r = await o.call('POST', '/api/people/staff', { name: 'zz staff ' + run, phone: '12345' });
ok('a short phone number is refused', r.status === 400 && /10-digit/.test(r.err), r.err);
ok('a phone with +91 and spaces is accepted', (await o.call('POST', '/api/people/staff', { name: 'zz staff ' + run, phone: '+91 98200 12345' })).status === 200);
ok('a bad email is refused', (await o.call('POST', '/api/people/staff', { name: 'zz staff2 ' + run, email: 'not-an-email' })).status === 400);
ok('a percentage over 100 is refused', (await o.call('POST', '/api/settings/tax.gst_bp', { value: 20000 })).status === 400);
ok('a negative day count in Settings is refused', (await o.call('POST', '/api/settings/interest.grace_days', { value: -5 })).status === 400);
ok('words in a Settings amount are refused', (await o.call('POST', '/api/settings/petty.low_balance_paise', { value: 'lots' })).status === 400);

// ---------- users ----------
r = await o.call('POST', '/api/users', { name: 'zz role ' + run, email: `zz-role-${run}@test.local`, role: 'superadmin' });
ok('an unknown role is refused', r.status === 400 && /role/.test(r.err), r.err);
r = await o.call('POST', '/api/users', { name: 'zz proj ' + run, email: `zz-proj-${run}@test.local`, role: 'site', projects: [pid, 99999999], extra_roles: ['owner', 'sales', 'wizard'], is_primary_owner: 1 });
ok('a person is added with good values', r.status === 200, r.err);
const uid = r.data && r.data.id;
const mine = (await o.call('GET', `/api/users/${uid}/projects`)).data.projects;
ok('a made-up project number is not stored as a membership', mine.length === 1 && mine[0] === pid, JSON.stringify(mine));
const u = ((await o.call('GET', '/api/users')).data.users || []).find((x) => x.id === uid);
ok('is_primary_owner sent by the browser is ignored', u && !u.is_primary_owner);
ok('changing a role to an unknown one is refused', (await o.call('PUT', `/api/users/${uid}`, { role: 'god' })).status === 400);
ok('projects must be project numbers', (await o.call('PUT', `/api/users/${uid}`, { projects: ['all'] })).status === 400);

// ---------- share links: a PM sees and switches off only links on their own projects ----------
const pidB = (await o.call('POST', '/api/projects', { name: 'zz-inB ' + run, code: 'IB' + run.toUpperCase().slice(-6) })).data.id;
const up = async (p) => { const fd = new FormData(); fd.append('file', new Blob(['customer file'], { type: 'text/plain' }), 'c.txt'); fd.append('title', 'cust-' + run); fd.append('project_id', String(p)); fd.append('audience', 'customer');
  const r = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: o.cookie }, body: fd }); return (await r.json()).data.id; };
const docB = await up(pidB);
ok('a link that never expires (year 2999) is refused', (await o.call('POST', '/api/share-links', { document_id: docB, recipient_label: 'far', expires_at: '2999-01-01' })).status === 400);
ok('zero allowed views is refused', (await o.call('POST', '/api/share-links', { document_id: docB, recipient_label: 'zero', max_views: 0 })).status === 400);
ok('the Owner makes a link on project B', (await o.call('POST', '/api/share-links', { document_id: docB, recipient_label: 'only-B-' + run })).status === 200);
const linkB = ((await o.call('GET', '/api/share-links')).data.links || []).find((x) => x.recipient_label === 'only-B-' + run);
const pmR = await o.call('POST', '/api/users', { name: 'zz pm ' + run, email: `zz-pm-${run}@test.local`, role: 'pm', projects: [pid] });
const pmC = new C(); await pmC.call('POST', '/api/auth/login', { email: `zz-pm-${run}@test.local`, password: pmR.data.temporaryPassword });
await pmC.call('POST', '/api/auth/change-password', { currentPassword: pmR.data.temporaryPassword, newPassword: 'ZzStrongPass-' + run });
// CI runs with only Site limited to its projects; switch PMs on too for these checks, then put it back
const limitWas = (await o.call('GET', '/api/settings')).data;
const limitBefore = limitWas && limitWas.settings ? limitWas.settings['access.limit_roles_to_assigned_projects'] : undefined;
await o.call('POST', '/api/settings/access.limit_roles_to_assigned_projects', { value: ['site', 'pm'] });
const pmList = (await pmC.call('GET', '/api/share-links')).data;
ok('a PM not on project B does not see its link', pmList && !pmList.links.some((x) => x.recipient_label === 'only-B-' + run), JSON.stringify(pmList));
ok('a PM not on project B cannot switch its link off', linkB && (await pmC.call('POST', `/api/share-links/${linkB.id}/revoke`)).status === 404);
ok('the Owner still can', linkB && (await o.call('POST', `/api/share-links/${linkB.id}/revoke`)).status === 200);
await o.call('POST', '/api/settings/access.limit_roles_to_assigned_projects', { value: Array.isArray(limitBefore) ? limitBefore : ['site'] });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
