// tests/features.mjs — happy-path checks for the newer modules. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !(b instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // these suites bill stages without registering the Agreement for Sale; the 10% rule is tested in m4_step1
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-feat ' + run, code: 'ZF' + run.toUpperCase().slice(-5) })).data.id;
const mk = async (role, projects) => { const email = `zf-${role}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zf ' + role, email, role, projects }); const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: 'ZfStrongPass-' + run }); return c; };
const site = await mk('site', [pid]); const sales = await mk('sales', [pid]); const hr = await mk('hr', []);
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' });

// brochures + versions
const up = async (title, audience, body) => { const f = new FormData(); f.append('file', new Blob(['%PDF-1.4 ' + body], { type: 'application/pdf' }), 'b.pdf'); f.append('title', title); f.append('category', 'brochure'); f.append('module', 'brochure'); f.append('project_id', String(pid)); f.append('audience', audience); f.append('series_key', 'brochure:' + title.toLowerCase()); return o.call('POST', '/api/files/upload', f); };
ok('brochure v1 uploads', (await up('Main ' + run, 'customer', 'v1')).status === 200);
ok('brochure v2 uploads (same series)', (await up('Main ' + run, 'customer', 'v2')).status === 200);
await up('Prices ' + run, 'internal', 'secret');
const ownerList = (await o.call('GET', '/api/brochures?project_id=' + pid)).data.items;
const main = ownerList.find((x) => x.title === 'Main ' + run);
ok('owner sees latest version only, with count', main && main.version === 2 && main.versions === 2, JSON.stringify(main));
ok('owner sees internal price list', ownerList.some((x) => x.title === 'Prices ' + run));
const salesList = (await sales.call('GET', '/api/brochures?project_id=' + pid)).data.items;
ok('sales sees only customer-ready v2', salesList.length === 1 && salesList[0].version === 2, JSON.stringify(salesList));
ok('older versions listed', (await o.call('GET', `/api/brochures/versions?project_id=${pid}&series_key=${encodeURIComponent('brochure:main ' + run)}`)).data.versions.length === 2);
ok('sales cannot upload brochures', (await (async () => { const f = new FormData(); f.append('file', png(), 'x.png'); f.append('title', 't'); f.append('module', 'brochure'); return sales.call('POST', '/api/files/upload', f); })()).status === 403);

// branding encryption + pictures
await o.call('POST', '/api/branding', { legal_name: 'Zz Co', trade_name: 'Zz', pan: 'ABCDE1234F', bank_account: '123456789012', bank_name: 'Test Bank', letterhead_mode: 'bands' });
const br = (await o.call('GET', '/api/branding')).data.branding;
ok('owner sees masked PAN and account only', br.pan_masked === '••••234F' && br.bank_account_masked === '••••9012' && !br.pan_enc, JSON.stringify([br.pan_masked, br.bank_account_masked]));
ok('hr cannot read branding', (await hr.call('GET', '/api/branding')).status === 403);
const defBrand = (await o.call('GET', '/api/brands')).data.brands.find((b) => b.is_default).id;
const pic = async (k) => { const f = new FormData(); f.append('file', png(), k + '.png'); f.append('title', k); f.append('series_key', `brand:${defBrand}:${k}`); return o.call('POST', '/api/files/upload', f); };
ok('signature uploads', (await pic('signature')).status === 200);
ok('signature replaceable (new version)', (await pic('signature')).status === 200);
ok('signature served to signed-in staff', (await o.call('GET', '/api/print/asset/signature', null, true)).status === 200);
ok('sales may fetch it for printing, anon may not', (await new C().call('GET', '/api/print/asset/signature', null, true)).status === 401);
ok('bad letter style refused', (await o.call('POST', '/api/branding', { letterhead_mode: 'weird' })).status === 400);

// people
const pos = (await hr.call('POST', '/api/people/hiring', { position: 'Site engineer' })).data.id;
const cand = (await hr.call('POST', `/api/people/hiring/${pos}/candidates`, { name: 'Zz Candidate', phone: '999' })).data.id;
ok('hr moves candidate to interview', (await hr.call('POST', `/api/people/candidates/${cand}/status`, { status: 'interview', interview_on: '2099-01-01T10:00' })).status === 200);
ok('interview-day list shows them', (await hr.call('GET', '/api/people/interviews')).data.interviews.some((i) => i.name === 'Zz Candidate'));
const hired = await hr.call('POST', `/api/people/candidates/${cand}/status`, { status: 'hired' });
ok('hired converts to staff', hired.data.converted === true && (await hr.call('GET', '/api/people/staff')).data.staff.some((s) => s.name === 'Zz Candidate'));
ok('sales cannot see staff', (await sales.call('GET', '/api/people/staff')).status === 403);
ok('hr cannot read sales', (await hr.call('GET', '/api/sales/leads')).status === 403);

// site: idempotent report + photo + snag flow
const uuid = crypto.randomUUID();
const yesterday = new Date(Date.now() + 19800000 - 86400000).toISOString().slice(0, 10);   // not a fixed date: the site role may not file reports older than 2 days
const d1 = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: yesterday, work_summary: 'Slab', client_uuid: uuid });
const d2 = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: yesterday, work_summary: 'Slab', client_uuid: uuid });
ok('DPR retry returns same record', d1.status === 200 && d2.status === 200 && d1.data.id === d2.data.id && d2.data.duplicate === true);
const ph = new FormData(); ph.append('file', png(), 'p.png'); ph.append('title', 'Site photo'); ph.append('module', 'site'); ph.append('entity', 'site_dprs'); ph.append('entity_id', String(d1.data.id)); ph.append('project_id', String(pid)); ph.append('category', 'photo');
ok('site engineer can attach a photo', (await site.call('POST', '/api/files/upload', ph)).status === 200);
ok('photo listed on the report', (await site.call('GET', `/api/attachments?entity=site_dprs&entity_id=${d1.data.id}`)).data.files.length === 1);
const sn = (await site.call('POST', '/api/site/snags', { project_id: pid, title: 'Crack', severity: 'high' })).data.id;
ok('site marks snag fixed', (await site.call('POST', `/api/site/snags/${sn}/status`, { status: 'fixed' })).status === 200);
ok('site cannot verify own fix', (await site.call('POST', `/api/site/snags/${sn}/status`, { status: 'verified' })).status === 403);
ok('owner verifies', (await o.call('POST', `/api/site/snags/${sn}/status`, { status: 'verified' })).status === 200);
const phSeries = new FormData(); phSeries.append('file', png(), 'p.png'); phSeries.append('title', 'x'); phSeries.append('module', 'site'); phSeries.append('series_key', 'brand:1:logo');
ok('site cannot hijack a brand picture', (await site.call('POST', '/api/files/upload', phSeries)).status === 403);

// demand email
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, unit_no: 'F' + run.slice(-3), price_paise: 5000000 })).data.id;
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Now', pct_bp: 10000 }] });
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz cust', email: 'cust@example.com' })).data.id;
const dm = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0];
const em = await o.call('POST', `/api/sales/demands/${dm.id}/email`, {});
ok('demand email endpoint responds (sent or reports SMTP error)', em.status === 200 && 'sent' in em.data, JSON.stringify(em));
ok('print data for demand', (await o.call('GET', `/api/print/demand/${dm.id}`)).data.demand.label === 'Now');

await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
