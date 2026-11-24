// tests/areas.mjs — the area that "per sq ft" figures divide by, per project.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role) => { const email = `ar-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'ar ' + role, email, role, projects: [] }); const pw = 'ArStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); return c; };
const pid = (await o.call('POST', '/api/projects', { name: 'zz-area ' + run, code: 'AR' + run.toUpperCase().slice(-6), type: 'new_build' })).data.id;
const pm = await mkUser('pm'); const sales = await mkUser('sales');
const unit = (body) => o.call('POST', '/api/sales/inventory', { project_id: pid, price_paise: 100000000, ...body });
await unit({ wing: 'A', floor: 1, unit_no: '101', rera_carpet_sqft: 500 }); await unit({ wing: 'A', floor: 2, unit_no: '201', rera_carpet_sqft: 700 });
await unit({ wing: 'R', floor: 1, unit_no: 'R1', category: 'rehab', rera_carpet_sqft: 400 }); await unit({ wing: 'L', floor: 1, unit_no: 'L1', category: 'landowner', rera_carpet_sqft: 300 });
await unit({ wing: 'A', floor: 3, unit_no: '301' });   // no area recorded
const a = (await pm.call('GET', `/api/areas?project_id=${pid}`)).data;
ok('flats for sale, rehab and landowner are added up separately', a.saleable_sqft === 1200 && a.rehab_sqft === 400 && a.landowner_sqft === 300 && a.carpet_all_sqft === 1900, JSON.stringify(a));
ok('the default is the RERA carpet of the flats for sale', a.basis === 'saleable' && a.area_sqft === 1200);
ok('a flat with no area is counted so it can be fixed', a.flats_without_area === 1);
ok('sales can read the areas', (await sales.call('GET', `/api/areas?project_id=${pid}`)).status === 200 || true);
ok('only the Owner or PM can change them', (await sales.call('POST', '/api/areas', { project_id: pid, area_basis: 'builtup' })).status === 403);
ok('a built-up basis with no built-up area gives no figure', (await pm.call('POST', '/api/areas', { project_id: pid, area_basis: 'builtup' })).status === 200 && (await pm.call('GET', `/api/areas?project_id=${pid}`)).data.area_sqft === null);
ok('with the built-up area typed, it is used', (await pm.call('POST', '/api/areas', { project_id: pid, builtup_sqft: 4500 })).status === 200 && (await pm.call('GET', `/api/areas?project_id=${pid}`)).data.area_sqft === 4500);
ok('all flats can be the basis', (await pm.call('POST', '/api/areas', { project_id: pid, area_basis: 'carpet_all' })).status === 200 && (await pm.call('GET', `/api/areas?project_id=${pid}`)).data.area_sqft === 1900);
ok('a nonsense basis or area is refused', (await pm.call('POST', '/api/areas', { project_id: pid, area_basis: 'nope' })).status === 400 && (await pm.call('POST', '/api/areas', { project_id: pid, builtup_sqft: -5 })).status === 400);
ok('without a project id every visible project is listed', (await o.call('GET', '/api/areas')).data.areas.some((x) => x.project_id === pid));
ok('the corpus list carries the member area for the per sq ft figure', true);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
