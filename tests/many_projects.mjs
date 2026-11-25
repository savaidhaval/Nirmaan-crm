// tests/many_projects.mjs — lists keep working with more than 100 projects.
// D1 accepts at most 100 values per statement; lists filtered by "every project you can see" used one value per project
// and failed with "too many SQL variables" once a user could see 101 or more. Creates projects until there are 105+, checks
// the lists that used to fail, then removes the projects it made.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
const list = async () => { const d = (await o.call('GET', '/api/projects')).data; return Array.isArray(d) ? d : (d && d.projects) || []; };
const made = [];
for (let i = (await list()).length; i < 105; i++) {
  const r = await o.call('POST', '/api/projects', { name: `zz-many ${i} ${run}`, code: ('MP' + i + run).toUpperCase().slice(0, 12), type: 'new_build' });
  if (!r.data || !r.data.id) { ok('a test project can be created', false, `${r.status} ${r.err}`); break; }
  made.push(r.data.id);
}
const all = await list();
ok('the Owner sees more than 100 projects', all.length > 100, String(all.length));
const last = made.length ? made[made.length - 1] : all[all.length - 1].id;
ok('the newest project is in the list', all.some((p) => p.id === last));
await o.call('POST', '/api/site/milestones', { project_id: last, name: 'Many-projects slab ' + run });
const ms = (await o.call('GET', '/api/site/milestones')).data;
ok('a stage in the 101st+ project shows in the stages list', String(JSON.stringify(ms)).includes('Many-projects slab ' + run));
const routes = ['/api/approvals', '/api/brochures', '/api/budget/heads', '/api/dashboard', '/api/dlp/tickets', '/api/documents', '/api/drawings',
  '/api/petty/funds', '/api/petty/pending', '/api/procurement/bills', '/api/procurement/grns', '/api/procurement/grns-without-photo',
  '/api/procurement/indents', '/api/procurement/pos', '/api/procurement/pos-to-receive', '/api/procurement/reports/pending-indents',
  '/api/procurement/reports/po-vs-received', '/api/procurement/rfqs', '/api/redev/rent-changes', '/api/reports/aging', '/api/reports/cashflow',
  '/api/reports/interest', '/api/reports/marketing', '/api/reports/purchase-register', '/api/reports/receivables', '/api/reports/tds',
  '/api/reports/velocity', '/api/sales/bank-followups', '/api/sales/bookings', '/api/sales/checkins', '/api/sales/tds-credits',
  '/api/sales/token-holds', '/api/site/dprs', '/api/site/milestones', '/api/site/reports/labour', '/api/site/snags'];
const broken = [];
for (const p of routes) { const r = await o.call('GET', p); if (r.status !== 200) broken.push(`${p} ${r.status}`); }
ok(`all ${routes.length} lists that used to fail above 100 projects open`, broken.length === 0, broken.join(', '));
// tidy up: remove the projects this suite made, so later runs start from the same place
let removed = 0; for (const id of made) if ((await o.call('DELETE', `/api/projects/${id}`)).status === 200) removed++;
ok('the test projects are removed again', removed === made.length, `${removed} of ${made.length}`);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
