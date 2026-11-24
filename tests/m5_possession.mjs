// tests/m5_possession.mjs — Module 5: the Possession & handover list (one statement; open checklist items and open snags per flat).
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // these suites bill stages without registering the Agreement for Sale; the 10% rule is tested in m4_step1
let seq = 0;
const mkUser = async (role, projects) => { const email = `zp-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zp ' + role, email, role, projects }); const pw = 'ZpStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; c.email = email; c.pw = pw; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m5 ' + run, code: 'M5' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm', []); const viewer = await mkUser('viewer', []); const site = await mkUser('site', [pid]); const sales = await mkUser('sales', []);
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'P', floor: 3, unit_no: 'M5' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 500 })).data.id;
const bk = await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Possession Buyer ' + run, phone: '98' + String(Date.now()).slice(-8), token_paise: 100000 });
ok('a booking is made for the test', bk.status === 200, JSON.stringify(bk));
const list = async (who) => (await who.call('GET', '/api/possession')).data;
const mine = (d) => d.flats.find((f) => f.booking_id === bk.data.id);
let d = await list(o); let f = mine(d);
ok('the booked flat is on the list, not started, no snags', f && f.stage === 'not_started' && f.open_snags === 0 && f.open_items === 0 && f.project === 'zz-m5 ' + run, JSON.stringify(f));
ok('the counts add up', d.counts.not_started >= 1 && d.counts.in_progress + d.counts.not_started + d.counts.handed_over === d.flats.length);
const sn = await o.call('POST', '/api/site/snags', { project_id: pid, unit_id: unit, title: 'Hairline crack in bedroom wall', severity: 'medium', location: 'Bedroom 2' });
d = await list(pm); f = mine(d);
ok('a snag raised inside the flat shows against that flat', sn.status === 200 && f.open_snags === 1, JSON.stringify(f));
await o.call('POST', `/api/site/snags/${sn.data.id}/status`, { status: 'fixed' });
ok('a fixed but unverified snag still counts as open', mine(await list(pm)).open_snags === 1);
await o.call('POST', `/api/site/snags/${sn.data.id}/status`, { status: 'verified' });
ok('once verified it no longer counts', mine(await list(pm)).open_snags === 0);
ok('the customer name is shown to Owner, PM and Sales', f.customer_name.startsWith('Possession Buyer') && (mine(await list(sales)) || {}).customer_name !== undefined);
const vf = mine(await list(viewer));
ok('a viewer sees the flat but not the customer name', vf && vf.customer_name === '' && vf.unit_no === f.unit_no, JSON.stringify(vf));
ok('a site engineer cannot open the possession list', (await site.call('GET', '/api/possession')).status === 403);
await o.call('POST', `/api/sales/bookings/${bk.data.id}/cancel`, { reason: 'test cleanup' });
ok('a cancelled booking drops off the list', !mine(await list(o)));
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
