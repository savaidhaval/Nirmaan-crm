// tests/manyprojects.mjs — more than 100 projects must not break any list screen (D1 allows 100 bound variables).
// Same env vars as security.mjs. Creates ~110 throw-away projects named "zz-many ...".
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, d, data: d && d.data }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });

const N = 110; const pids = [];
for (let i = 0; i < N; i++) { const r = await o.call('POST', '/api/projects', { name: `zz-many ${run} ${i}`, code: `ZM${run.toUpperCase().slice(-4)}${i}` }); if (r.data && r.data.id) pids.push(r.data.id); }
ok(`created ${N} projects`, pids.length === N, String(pids.length));
const all = (await o.call('GET', '/api/projects')).data;
ok('owner project list shows all of them', all && all.projects.length >= N, all && String(all.projects.length));

// one DPR in the LAST project, to prove rows from beyond the first 100 are still returned
const last = pids[pids.length - 1];
const dpr = await o.call('POST', '/api/site/dprs', { project_id: last, report_date: '2026-01-15', work_summary: 'many-projects test', client_uuid: 'many-' + run });
ok('DPR saved in project #110', dpr.status === 200 || dpr.status === 201, JSON.stringify(dpr.d));

const screens = ['/api/projects', '/api/documents', '/api/approvals', '/api/drawings', '/api/site/milestones', '/api/site/dprs', '/api/site/snags',
  '/api/site/reports/labour?month=2026-01', '/api/procurement/vendors', '/api/procurement/rfqs', '/api/procurement/pos', '/api/procurement/grns', '/api/procurement/bills',
  '/api/procurement/indents', '/api/procurement/pos-to-receive', '/api/procurement/reports/pending-indents', '/api/procurement/reports/po-vs-received',
  '/api/sales/leads', '/api/sales/bookings', '/api/sales/followups', '/api/sales/partners',
  '/api/dashboard', '/api/search?q=zz', '/api/reports/receivables', '/api/reports/purchase-register', '/api/reports/funnel', '/api/reports/cashflow',
  '/api/reports/aging', '/api/reports/marketing', '/api/reports/velocity', '/api/reports/tds', '/api/reports/interest',
  '/api/contractors/work-orders', '/api/contractors/reports/summary'];
for (const s of screens) {
  const r = await o.call('GET', s);
  ok('owner ' + s + ' loads', r.status === 200 || r.status === 403 && /switched off/i.test(String(r.d && r.d.error)), `${r.status} ${JSON.stringify(r.d).slice(0, 160)}`);
}
const dl = (await o.call('GET', '/api/site/dprs')).data;
const rows = Array.isArray(dl) ? dl : (dl && (dl.dprs || dl.items)) || [];
ok('DPR from project #110 is listed', rows.some((x) => x.project_id === last), JSON.stringify(dl).slice(0, 120));

// a Site Engineer assigned to all 110 projects (limited role) must also load the screens
const email = `zm-site-${run}@test.local`;
const u = await o.call('POST', '/api/users', { name: 'zm site', email, role: 'site', projects: pids });
ok('site user with 110 projects created', u.status === 200 || u.status === 201, JSON.stringify(u.d));
const s = new C();
if (u.data && u.data.temporaryPassword) { await s.call('POST', '/api/auth/login', { email, password: u.data.temporaryPassword }); await s.call('POST', '/api/auth/change-password', { currentPassword: u.data.temporaryPassword, newPassword: 'ZmStrongPass-' + run }); }
for (const sc of ['/api/projects', '/api/site/dprs', '/api/site/snags', '/api/site/milestones', '/api/drawings', '/api/approvals', '/api/documents', '/api/search?q=zz']) {
  const r = await s.call('GET', sc); ok('site ' + sc + ' loads', r.status === 200, `${r.status} ${JSON.stringify(r.d).slice(0, 120)}`);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
