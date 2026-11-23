// tests/multibrand.mjs — several brands and several projects in one CRM. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !(b instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });

const brands0 = (await o.call('GET', '/api/brands')).data.brands;
const def = brands0.find((b) => b.is_default);
ok('a default brand exists', !!def);
const b2 = (await o.call('POST', '/api/brands', { name: 'zz Brand Two ' + run })).data.id;
ok('duplicate brand name refused', (await o.call('POST', '/api/brands', { name: 'ZZ brand two ' + run.toUpperCase() })).status === 400);

await o.call('POST', '/api/branding', { brand_id: def.id, legal_name: 'Default Legal ' + run, trade_name: 'Default Trade', letterhead_mode: 'generated' });
await o.call('POST', '/api/branding', { brand_id: b2, legal_name: 'Second Legal ' + run, trade_name: 'Second Trade', bank_name: 'Second Bank', letterhead_mode: 'bands' });
const g1 = (await o.call('GET', `/api/branding?brand_id=${def.id}`)).data.branding;
const g2 = (await o.call('GET', `/api/branding?brand_id=${b2}`)).data.branding;
ok('each brand keeps its own profile', g1.legal_name === 'Default Legal ' + run && g2.legal_name === 'Second Legal ' + run && g2.letterhead_mode === 'bands');

const p1 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-mb one ' + run, code: 'M1' + run.toUpperCase().slice(-5) })).data.id;
const p2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-mb two ' + run, code: 'M2' + run.toUpperCase().slice(-5), brand_id: b2 })).data.id;
const plist = (await o.call('GET', '/api/projects')).data.projects;
ok('new project defaults to the default brand', plist.find((p) => p.id === p1).brand_id === def.id);
ok('project can be created under another brand', plist.find((p) => p.id === p2).brand_id === b2);
ok('unknown brand refused', (await o.call('PUT', `/api/projects/${p1}`, { brand_id: 999999 })).status === 400);
ok('partial project update keeps other fields', (await o.call('PUT', `/api/projects/${p1}`, { city: 'Pune' })).status === 200 && (await o.call('GET', '/api/projects')).data.projects.find((p) => p.id === p1).name === 'zz-mb one ' + run);

// letters resolve per project
const mkBooking = async (pid, tag) => {
  const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, unit_no: tag + run.slice(-3), price_paise: 5000000 })).data.id;
  await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
  const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz cust ' + tag })).data.id;
  return (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0].id;
};
const d1 = await mkBooking(p1, 'A'); const d2 = await mkBooking(p2, 'B');
const pr1 = (await o.call('GET', `/api/print/demand/${d1}`)).data.brand;
const pr2 = (await o.call('GET', `/api/print/demand/${d2}`)).data.brand;
ok('project 1 letter uses the default brand', pr1.legal_name === 'Default Legal ' + run && pr1.brand_id === def.id);
ok('project 2 letter uses brand two', pr2.legal_name === 'Second Legal ' + run && pr2.bank_name === 'Second Bank' && pr2.brand_id === b2);
await o.call('POST', '/api/branding', { project_id: p2, tagline: 'Only for project two' });
const pr2b = (await o.call('GET', `/api/print/demand/${d2}`)).data.brand;
ok('project override wins field by field, rest from brand', pr2b.tagline === 'Only for project two' && pr2b.legal_name === 'Second Legal ' + run);
const pr1b = (await o.call('GET', `/api/print/demand/${d1}`)).data.brand;
ok('override does not leak to other projects', pr1b.tagline !== 'Only for project two');

// pictures per brand
const up = async (brand, kind) => { const f = new FormData(); f.append('file', png(), kind + '.png'); f.append('title', kind); f.append('series_key', `brand:${brand}:${kind}`); return o.call('POST', '/api/files/upload', f); };
ok('brand picture uploads', (await up(b2, 'stamp')).status === 200);
ok('picture for a missing brand refused', (await up(999999, 'stamp')).status === 400);
ok('bad picture kind refused', (await up(b2, 'evil')).status === 400);
const pr2c = (await o.call('GET', `/api/print/demand/${d2}`)).data.brand;
const pr1c = (await o.call('GET', `/api/print/demand/${d1}`)).data.brand;
ok('stamp belongs to brand two only', pr2c.pictures.includes('stamp') && !pr1c.pictures.includes('stamp'));
ok('stamp served for brand two', (await o.call('GET', `/api/print/asset/stamp?brand=${b2}`, null, true)).status === 200);
ok('stamp not served for default brand', (await o.call('GET', `/api/print/asset/stamp?brand=${def.id}`, null, true)).status === 404);

// project picker scope
await o.call('POST', '/api/approvals', { project_id: p1, name: 'zz appr one' });
await o.call('POST', '/api/approvals', { project_id: p2, name: 'zz appr two' });
const all = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === p1 || a.project_id === p2);
const only2 = (await o.call('GET', `/api/approvals?project_id=${p2}`)).data.items;
ok('without a pick, both projects show', all.length === 2);
ok('picking project 2 shows only its items', only2.length === 1 && only2[0].name.toLowerCase() === 'zz appr two');
await o.call('POST', '/api/sales/leads', { name: 'zz lead one', phone: '9' + run.replace(/\D/g, '').padEnd(9, '1').slice(0, 9), project_id: p1 });
await o.call('POST', '/api/sales/leads', { name: 'zz lead two', phone: '8' + run.replace(/\D/g, '').padEnd(9, '2').slice(0, 9), project_id: p2 });
const leads2 = (await o.call('GET', `/api/sales/leads?project_id=${p2}`)).data.leads.filter((l) => l.name.startsWith('zz lead'));
ok('leads follow the picked project', leads2.length === 1 && leads2[0].name === 'zz lead two');
ok('scoping a GET does not block writes to other projects', (await o.call('POST', '/api/approvals', { project_id: p1, name: 'zz again' })).status === 200);
const dash = await o.call('GET', `/api/dashboard?project_id=${p1}`);
ok('dashboard accepts a project', dash.status === 200);

// brand housekeeping
ok('brand with projects cannot be removed', (await o.call('DELETE', `/api/brands/${b2}`)).status === 400);
ok('default brand cannot be removed', (await o.call('DELETE', `/api/brands/${def.id}`)).status === 400);
await o.call('PUT', `/api/projects/${p2}`, { brand_id: def.id });
ok('moving the project frees the brand', (await o.call('DELETE', `/api/brands/${b2}`)).status === 200);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
