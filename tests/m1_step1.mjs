// tests/m1_step1.mjs — Module 1 gaps, step 1: landowner bucket, FSI/TDR, locked certified area, vacate-anchored escalation, OC rent stop, 30/15/7 alerts.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // these suites bill stages without registering the Agreement for Sale; the 10% rule is tested in m4_step1
let seq = 0;
const mkUser = async (role, projects) => { const email = `zp-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zp ' + role, email, role, projects }); const pw = 'ZpStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; c.email = email; c.pw = pw; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);

const redev = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m1 ' + run, code: 'M1' + run.toUpperCase().slice(-6), type: 'redevelopment', budget_paise: 50000000 })).data.id;
await o.call('POST', '/api/approvals/load-template', { project_id: redev, redevelopment: true });
const pm = await mkUser('pm', []); const sales = await mkUser('sales', []);
const soc = (await pm.call('POST', '/api/redev/societies', { project_id: redev, name: 'M1 CHS ' + run, consent_threshold_pct: 51 })).data.id;

// ============ 1. landowner bucket ============
const lo = await o.call('POST', '/api/sales/inventory', { project_id: redev, wing: 'L', floor: 2, unit_no: 'LO' + run.slice(-3), type: '2BHK', carpet_sqft: 500, rera_carpet_sqft: 450, category: 'landowner' });
ok('a landowner-share flat can be added without a price', lo.status === 200, JSON.stringify(lo));
const stack = (await o.call('GET', `/api/reports/stacking?project_id=${redev}`)).data;
ok('the tower grid shows it as Landowner and leaves it out of the value', stack.units.find((u) => u.id === lo.data.id)?.state === 'landowner' && stack.total_list_value_paise === 0, JSON.stringify(stack.counts));
ok('a cost sheet cannot be made for a landowner flat', (await o.call('POST', '/api/sales/cost-sheets', { unit_id: lo.data.id, agreed_price_paise: 10000000 })).status === 400);
ok('a booking cannot be made for a landowner flat', (await o.call('POST', '/api/sales/bookings', { unit_id: lo.data.id, customer_name: 'X', phone: '9800000001', token_paise: 100000 })).status >= 400);
const sf = await o.call('POST', '/api/sales/inventory', { project_id: redev, wing: 'L', floor: 3, unit_no: 'SF' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 450 });
ok('the bucket is locked: a flat cannot move between buckets', (await o.call('PUT', `/api/sales/inventory/${sf.data.id}`, { category: 'landowner', reason: 'trying to move it' })).status === 400 && (await o.call('PUT', `/api/sales/inventory/${lo.data.id}`, { category: 'sale', reason: 'trying to move it' })).status === 400);

// ============ 2. FSI / TDR / DCPR on the project ============
const pr = await o.call('PUT', `/api/projects/${redev}/profile`, { dcpr_regulation: '33(7)', sanctioned_fsi: 3.5, fungible_fsi: 1.2, tdr_purchased: 0.8 });
const prj = (await o.call('GET', `/api/projects/${redev}/overview`)).data;
const pj = prj && (prj.project || prj);
ok('FSI, fungible FSI, TDR and the DCPR regulation are saved on the project', pr.status === 200 && pj && pj.dcpr_regulation === '33(7)' && pj.sanctioned_fsi === 3.5 && pj.fungible_fsi === 1.2 && pj.tdr_purchased === 0.8, JSON.stringify([pr.status, pr.err, pj && Object.keys(pj).slice(0, 5)]));
ok('a negative FSI figure is refused', (await o.call('PUT', `/api/projects/${redev}/profile`, { sanctioned_fsi: -1 })).status === 400);

// ============ 3. certified area is set once and locked ============
const d0 = new Date(Date.now() + 19800000);
const monthsAgo = (n, day) => new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - n, day)).toISOString().slice(0, 10);
const mk = async (n, area) => (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'M1 member ' + n, unit_label: 'U' + n, wing: 'A', carpet_sqft: area })).data.id;
const mC = await mk(1, 450), mD = await mk(2, 450), mE = await mk(3, 500);
ok('rent per sq ft is refused until the certified area is entered', (await o.call('PUT', `/api/redev/members/${mE}/terms`, { rent_basis: 'per_sqft', rent_y1_paise: 6000 })).status === 400);
ok('the certified area is saved once', (await o.call('PUT', `/api/redev/members/${mE}/terms`, { rent_basis: 'per_sqft', rent_y1_paise: 6000, certified_area_sqft: 480 })).status === 200 && (await o.call('GET', `/api/redev/members/${mE}/terms`)).data.terms.certified_area_sqft === 480);
const lock = await o.call('PUT', `/api/redev/members/${mE}/terms`, { rent_basis: 'per_sqft', rent_y1_paise: 6000, certified_area_sqft: 600 });
ok('changing the certified area is refused (locked)', lock.status === 409 && /locked/.test(lock.err), JSON.stringify(lock));
ok('sending the same certified area again is fine', (await o.call('PUT', `/api/redev/members/${mE}/terms`, { rent_basis: 'per_sqft', rent_y1_paise: 6000, certified_area_sqft: 480 })).status === 200);
const startE = monthsAgo(1, 1);
await o.call('PUT', `/api/redev/members/${mE}/vacate`, { paaa_reg_no: 'PAAA-E', paaa_reg_date: '2020-01-01', vacated_on: startE, override_note: 'test fixture, no photo' });
await o.call('POST', `/api/redev/members/${mE}/transit-term`, { monthly_rent_paise: 100, start_date: startE });
ok('per sq ft rent uses the certified area (60 x 480), not the flat-area figure (60 x 500)', (await o.call('GET', `/api/redev/members/${mE}/transit`)).data.months[0].due_paise === 2880000);

// ============ 4. escalation counts from the vacating month ============
const terms = { rent_basis: 'monthly', rent_y1_paise: 3000000, rent_y2_paise: 3300000 };
await o.call('PUT', `/api/redev/members/${mC}/terms`, terms); await o.call('PUT', `/api/redev/members/${mD}/terms`, terms);
const startX = monthsAgo(14, 1);
await o.call('PUT', `/api/redev/members/${mC}/vacate`, { paaa_reg_no: 'PAAA-C', paaa_reg_date: '2020-01-01', vacated_on: monthsAgo(14, 15), override_note: 'test fixture, no photo' });
await o.call('PUT', `/api/redev/members/${mD}/vacate`, { paaa_reg_no: 'PAAA-D', paaa_reg_date: '2020-01-01', vacated_on: startX, override_note: 'test fixture, no photo' });
await o.call('POST', `/api/redev/members/${mC}/transit-term`, { monthly_rent_paise: 2500000, start_date: startX });
await o.call('POST', `/api/redev/members/${mD}/transit-term`, { monthly_rent_paise: 2500000, start_date: startX });
const mc = (await o.call('GET', `/api/redev/members/${mC}/transit`)).data.months, md = (await o.call('GET', `/api/redev/members/${mD}/transit`)).data.months;
ok('vacated on the 1st: the rise starts exactly 12 months later', md[11].due_paise === 3000000 && md[12].due_paise === 3300000, JSON.stringify(md.slice(10, 14).map((x) => x.due_paise)));
ok('vacated mid-month: the rise starts one month later (never early)', mc[12].due_paise === 3000000 && mc[13].due_paise === 3300000, JSON.stringify(mc.slice(11, 15).map((x) => x.due_paise)));

// ============ 5. rent stops at OC date + grace days ============
const apr = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === redev);
const g = (k) => apr.find((a) => a.gate_key === k);
const ev = (id, body) => o.call('POST', `/api/approvals/${id}/event`, body);
const walk = async (k, extra = {}) => { const it = g(k); await ev(it.id, { event: 'applied' }); return ev(it.id, { event: 'approved', letter_no: 'T/' + k, letter_date: iso(-100), ...extra }); };
await walk('iod'); await walk('cc', { cc_upto_floor: 0 }); await walk('plinth_cc', { cc_upto_floor: 5 }); await walk('further_cc', { cc_upto_floor: 22 }); await walk('fire_final');
const before = (await o.call('GET', `/api/redev/members/${mD}/transit`)).data.months.length;
const ocR = await walk('oc', { letter_date: iso(0) });
ok('the OC is approved with its letter date', ocR.status === 200, JSON.stringify(ocR));
await o.call('POST', '/api/settings/red.oc_grace_days', { value: '30' });
await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
const after = (await o.call('GET', `/api/redev/members/${mD}/transit`)).data.months;
const stopMonth = new Date(Date.now() + 19800000 + 30 * 86400000).toISOString().slice(0, 7);
ok('after the sweep, no unpaid rent is left beyond the OC date + 30 days', after.length < before && after[after.length - 1].period <= stopMonth && after[after.length - 1].period >= new Date(Date.now() + 19800000).toISOString().slice(0, 7), `${before} -> ${after.length}, last ${after[after.length - 1].period}, stop month ${stopMonth}`);
const payOne = after.find((m) => m.period === after[0].period);
ok('months in the past are kept', after[0].period === startX.slice(0, 7));

// ============ 6. 30 / 15 / 7 day alerts ============
const proj2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-al ' + run, code: 'AL' + run.toUpperCase().slice(-6), type: 'new_build', budget_paise: 1000000 })).data.id;
const mkItem = async (name, days) => (await o.call('POST', '/api/approvals', { project_id: proj2, name, valid_till: iso(days), authority: 'MCGM' })).data.id;
const i12 = await mkItem('ALERT TWELVE ' + run, 12), i40 = await mkItem('ALERT FORTY ' + run, 40);
const inbox = async () => (await o.call('GET', '/api/notifications')).data;
const mine = async (re) => JSON.stringify(await inbox()).match(re) || [];
await o.call('POST', '/api/settings/apr.alert_days', { value: '30,15,7' });
await fetch(BASE + '/__scheduled?cron=30+2+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
ok('an approval 12 days from expiry gets the 15-day alert', (await mine(new RegExp('Expiring in 12 days: ALERT TWELVE'))).length >= 1);
ok('an approval 40 days from expiry gets no alert yet', (await mine(new RegExp('ALERT FORTY'))).length === 0);
const n1 = JSON.stringify(await inbox()).split('ALERT TWELVE').length;
await fetch(BASE + '/__scheduled?cron=30+2+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
ok('the same step is not sent twice', JSON.stringify(await inbox()).split('ALERT TWELVE').length === n1);

await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
