// tests/rera_visits.mjs — WP-15 RERA designated-account tracker and WP-19 visit feedback and check-in. Same env vars as security.mjs.
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
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const code = 'R5' + run.toUpperCase().slice(-6);
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-r5 ' + run, code, budget_paise: 50000000 })).data.id;
const acc = await mkUser('accounts', []); const pm = await mkUser('pm', []); const viewer = await mkUser('viewer', []); const sales = await mkUser('sales', []); const sales2 = await mkUser('sales', []); const site = await mkUser('site', [pid]);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const clean = () => sql("DELETE FROM settings WHERE key IN ('rera.designated_pct_bp', 'sales.visit_radius_m', 'sales.visit_objections')");
clean();

// ============================ WP-15 ============================
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 2, unit_no: 'R' + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 200000000 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Cust ' + run, phone: '9811122233', agreed_price_paise: 200000000, token_paise: 1000000 })).data.id;
const dem = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0].id;
await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100000000, demand_id: dem, mode: 'neft', ref_no: 'R1' + run });   // Rs 10,00,000 realised
const sum = async (who = acc) => (await who.call('GET', `/api/rera/summary?project_id=${pid}`)).data;
let s0 = await sum();
ok('required deposit is 70% of what has been realised (setting default), nothing deposited yet', s0.pct_bp === 7000 && s0.realised_paise === 100000000 && s0.required_paise === 70000000 && s0.deposited_paise === 0 && s0.gap_paise === 70000000, JSON.stringify(s0));
ok('PM and viewer can read, sales and site cannot', (await pm.call('GET', `/api/rera/summary?project_id=${pid}`)).status === 200 && (await viewer.call('GET', `/api/rera/summary?project_id=${pid}`)).status === 200 && (await sales.call('GET', `/api/rera/summary?project_id=${pid}`)).status === 403 && (await site.call('GET', `/api/rera/summary?project_id=${pid}`)).status === 403);
ok('only Accounts and the Owner can record entries', (await pm.call('POST', '/api/rera/entries', { project_id: pid, kind: 'deposit', amount_paise: 100 })).status === 403 && (await viewer.call('POST', '/api/rera/entries', { project_id: pid, kind: 'deposit', amount_paise: 100 })).status === 403);
ok('amount is required', (await acc.call('POST', '/api/rera/entries', { project_id: pid, kind: 'deposit', amount_paise: 0 })).status === 400);
const dep = await acc.call('POST', '/api/rera/entries', { project_id: pid, kind: 'deposit', amount_paise: 50000000, ref_no: 'UTR1' + run, client_uuid: 'rd-' + run });
ok('Accounts records a Rs 5,00,000 deposit', dep.status === 200);
ok('retry does not record it twice', (await acc.call('POST', '/api/rera/entries', { project_id: pid, kind: 'deposit', amount_paise: 50000000, client_uuid: 'rd-' + run })).data.duplicate === true && (await sum()).deposited_paise === 50000000);
let s1 = await sum();
ok('the gap shrinks: still Rs 2,00,000 to deposit', s1.gap_paise === 20000000 && s1.balance_paise === 50000000 && s1.excess_paise === 0, JSON.stringify(s1));
await setSetting('rera.designated_pct_bp', 6000);
ok('the percentage is a setting: at 60% the requirement is Rs 6,00,000', (await sum()).required_paise === 60000000);
const cf = (await o.call('GET', `/api/reports/cashflow?project_id=${pid}`)).data.escrow;
ok('the existing escrow report follows the same setting (no hard-coded 70%)', cf.required_pct === 60 && cf.required_designated_paise === 60000000, JSON.stringify(cf));
await setSetting('rera.designated_pct_bp', 7000);
// withdrawals: need the architect's, engineer's and CA's certificates
const upload = async (title) => { const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), title + '.pdf'); fd.append('title', title); fd.append('project_id', String(pid)); fd.append('category', 'certificate'); fd.append('module', 'rera');
  const r = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: acc.cookie }, body: fd }); return (await r.json()).data.id; };
const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10), daysAgo = (n) => new Date(Date.now() + 19800000 - n * 86400000).toISOString().slice(0, 10);
const noCert = await acc.call('POST', '/api/rera/entries', { project_id: pid, kind: 'withdrawal', amount_paise: 1000000 });
ok('a withdrawal without the three certificates is refused', noCert.status === 400 && /three certificates/.test(noCert.err), noCert.err);
const cert = async (body) => acc.call('POST', '/api/rera/certificates', { project_id: pid, cert_date: today, ...body });
ok('a certificate needs its file', (await cert({ kind: 'architect', cert_no: 'A0', pct_complete: 60 })).status === 400);
ok('a certificate cannot be dated in the future', (await cert({ kind: 'architect', cert_no: 'A0', pct_complete: 60, cert_date: daysAgo(-2), document_id: await upload('a0') })).status === 400);
const A1 = (await cert({ kind: 'architect', cert_no: 'ARCH/1', pct_complete: 60, issued_by: 'Ar. Mehta', document_id: await upload('arch1') })).data.id;
const E1 = (await cert({ kind: 'engineer', cert_no: 'ENG/1', pct_complete: 50, document_id: await upload('eng1') })).data.id;
const EOLD = (await cert({ kind: 'engineer', cert_no: 'ENG/OLD', pct_complete: 50, cert_date: daysAgo(100), document_id: await upload('engold') })).data.id;
const CA1 = (await cert({ kind: 'ca', cert_no: 'CA/1', amount_paise: 20000000, document_id: await upload('ca1') })).data.id;
ok('the same certificate number cannot be entered twice', (await cert({ kind: 'ca', cert_no: 'ca/1', amount_paise: 1, document_id: await upload('dup') })).status === 409);
ok("the architect's certificate becomes the project's certified completion (60%)", (await sum()).percent_complete === 60);
const W = (amount, extra) => acc.call('POST', '/api/rera/entries', { project_id: pid, kind: 'withdrawal', amount_paise: amount, architect_cert_id: A1, engineer_cert_id: E1, ca_cert_id: CA1, ...extra });
ok('an engineer certificate older than 90 days is refused', /older than 90 days/.test((await W(1000000, { engineer_cert_id: EOLD })).err || ''));
ok('two architect certificates (wrong kind) are refused', (await W(1000000, { engineer_cert_id: A1 })).status === 400);
const big = await W(20000001);
ok('a withdrawal cannot go beyond what the CA certified (Rs 2,00,000)', big.status === 400 && /CA's certificate CA\/1 allows/.test(big.err), big.err);
const w1 = await W(10000000, { ref_no: 'W1' + run });
ok('with the three certificates, Rs 1,00,000 is withdrawn; the certificates are written on the entry', w1.status === 200 && (await acc.call('GET', `/api/rera/entries?project_id=${pid}`)).data.entries.find((e) => e.ref_no === 'W1' + run).cert_ref.includes('CA CA/1'), JSON.stringify(w1));
const w2 = await W(5000000);
const s2 = await sum(); ok('withdrawn and balance are exact; certified work done is the lower of architect and engineer (50%)', s2.withdrawn_paise === 15000000 && s2.balance_paise === 35000000 && s2.certified_pct_bp === 5000 && s2.can_withdraw_paise === 10000000, JSON.stringify(s2));
const CA2 = (await cert({ kind: 'ca', cert_no: 'CA/2', amount_paise: 30000000, document_id: await upload('ca2') })).data.id;
const over = await W(15000000, { ca_cert_id: CA2 });
ok('total withdrawn cannot pass deposits x certified work done (50% of Rs 5,00,000)', over.status === 400 && /certified work done/.test(over.err), over.err);
const [wa, wb] = await Promise.all([1, 2].map((i) => W(10000000, { ca_cert_id: CA2, ref_no: `C${i}${run}` })));
ok('two withdrawals at once with Rs 1,00,000 room: only one passes', [wa.status, wb.status].sort().join() === '200,400' && (await sum()).balance_paise === 25000000, `${wa.status},${wb.status}`);
ok('only the Owner can cancel a certificate, and not one a withdrawal relies on', (await acc.call('POST', `/api/rera/certificates/${CA1}/cancel`, { reason: 'x' })).status === 403 && (await o.call('POST', `/api/rera/certificates/${CA1}/cancel`, { reason: 'x' })).status === 409
  && (await o.call('POST', `/api/rera/certificates/${EOLD}/cancel`, { reason: 'superseded' })).status === 200);
// reversal
const depId = (await acc.call('GET', `/api/rera/entries?project_id=${pid}`)).data.entries.find((e) => e.kind === 'deposit').id;
ok('reversal needs a reason', (await acc.call('POST', `/api/rera/entries/${depId}/reverse`, {})).status === 400);
ok('a deposit cannot be reversed while withdrawals depend on it', (await acc.call('POST', `/api/rera/entries/${depId}/reverse`, { reason: 'wrong account' })).status === 409);
const w1Id = (await acc.call('GET', `/api/rera/entries?project_id=${pid}`)).data.entries.find((e) => e.kind === 'withdrawal' && e.ref_no === 'W1' + run).id;
ok('a withdrawal can be reversed with a reason: balance comes back', (await acc.call('POST', `/api/rera/entries/${w1Id}/reverse`, { reason: 'entered twice' })).status === 200 && (await sum()).balance_paise === 35000000);
ok('cannot reverse twice; PM cannot reverse', (await acc.call('POST', `/api/rera/entries/${w1Id}/reverse`, { reason: 'x' })).status === 409 && (await pm.call('POST', `/api/rera/entries/${w1Id}/reverse`, { reason: 'x' })).status === 403);
const csv = await viewer.call('GET', `/api/rera/entries?project_id=${pid}&csv=1`, null, true); const txt = await csv.text();
ok('statement CSV for the CA, with the requirement and balance', csv.status === 200 && txt.includes('Required deposit') && txt.includes('Balance in account') && txt.includes('UTR1' + run) && txt.includes('Reversed: entered twice'));
ok('PM cannot export the statement', (await pm.call('GET', `/api/rera/entries?project_id=${pid}&csv=1`, null, true)).status === 403);
ok('requests without the header are refused', (await fetch(BASE + '/api/rera/entries', { method: 'POST', headers: { cookie: acc.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);

// ============================ WP-19 ============================
const lead = async (who, nm) => (await who.call('POST', '/api/sales/leads', { name: nm + ' ' + run, phone: '9' + String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9), project_id: pid, source: 'online', consent: true })).data.id;
const opts = (await sales.call('GET', '/api/sales/visit-options')).data;
ok('visit options: a starter objection list and a 200 m radius, both settings', opts.objections.includes('Price is high') && opts.radius_m === 200 && opts.interest.join() === 'hot,warm,cold');
await setSetting('sales.visit_objections', 'Too far; No parking; Wants ready flat'); ok('the objection list is editable', (await sales.call('GET', '/api/sales/visit-options')).data.objections.join('|') === 'Too far|No parking|Wants ready flat');
const l1 = await lead(sales, 'Visitor One'); const l2 = await lead(sales, 'Visitor Two');
const v1 = (await sales.call('POST', `/api/sales/leads/${l1}/visit`, { visit_at: new Date().toISOString().slice(0, 16) })).data.id;
const v2 = (await sales.call('POST', `/api/sales/leads/${l2}/visit`, { visit_at: new Date().toISOString().slice(0, 16) })).data.id;
ok('feedback cannot be added before the visit is done', (await sales.call('POST', `/api/sales/visits/${v1}/feedback`, { interest: 'hot' })).status === 409);
ok('visit marked done with structured feedback', (await sales.call('POST', `/api/sales/visits/${v1}/status`, { status: 'done', feedback: 'liked the view', interest: 'hot', objection: 'Too far', next_step: 'send_cost_sheet' })).status === 200);
const row = (await sales.call('GET', `/api/sales/leads/${l1}`)).data.visits.find((v) => v.id === v1);
ok('interest, objection and next step are saved on the visit', row.interest === 'hot' && row.objection === 'Too far' && row.next_step === 'send_cost_sheet', JSON.stringify(row));
await sales.call('POST', `/api/sales/visits/${v2}/status`, { status: 'done', interest: 'banana', next_step: 'dance' });
const row2 = (await sales.call('GET', `/api/sales/leads/${l2}`)).data.visits.find((v) => v.id === v2);
ok('unknown interest or next step values are ignored, not saved', row2.interest === null && row2.next_step === null);
ok('feedback can be corrected afterwards', (await sales.call('POST', `/api/sales/visits/${v2}/feedback`, { interest: 'warm' })).status === 200 && (await sales.call('GET', `/api/sales/leads/${l2}`)).data.visits.find((v) => v.id === v2).interest === 'warm');
// check-in
const ci0 = await sales.call('POST', `/api/sales/visits/${v1}/checkin`, { lat: 19.076, lng: 72.8777, accuracy_m: 20 });
ok('check-in works even when the project has no location yet (saved, no warning)', ci0.status === 200 && ci0.data.project_has_location === false && ci0.data.far === false);
ok('only PM or Owner can set the project location', (await sales.call('POST', `/api/projects/${pid}/location`, { lat: 19.076, lng: 72.8777 })).status === 403 && (await pm.call('POST', `/api/projects/${pid}/location`, { lat: 19.076, lng: 72.8777 })).status === 200);
ok('a location outside the map is refused', (await pm.call('POST', `/api/projects/${pid}/location`, { lat: 200, lng: 10 })).status === 400 && (await sales.call('POST', `/api/sales/visits/${v1}/checkin`, { lat: 'x', lng: 1 })).status === 400);
const near = await sales.call('POST', `/api/sales/visits/${v1}/checkin`, { lat: 19.0763, lng: 72.8777, accuracy_m: 10 });
ok('near the project (about 33 m): no warning', near.status === 200 && near.data.distance_m < 60 && near.data.far === false && near.data.warning === null, JSON.stringify(near.data));
const far = await sales.call('POST', `/api/sales/visits/${v1}/checkin`, { lat: 19.12, lng: 72.8777, accuracy_m: 10 });
ok('about 4.9 km away: a soft warning, and still saved', far.status === 200 && far.data.far === true && /saved anyway/.test(far.data.warning) && far.data.distance_m > 4000, JSON.stringify(far.data));
const saved = (await sales.call('GET', `/api/sales/leads/${l1}`)).data.visits.find((v) => v.id === v1);
ok('the last check-in is on the visit with its distance', saved.checked_in_at && saved.distance_m > 4000 && Math.abs(saved.lat - 19.12) < 1e-6);
await setSetting('sales.visit_radius_m', 5000);
ok('the radius is a setting: within 5 km is no longer "far"', (await sales.call('POST', `/api/sales/visits/${v1}/checkin`, { lat: 19.12, lng: 72.8777, accuracy_m: 10 })).data.far === false);
const v3 = (await sales.call('POST', `/api/sales/leads/${l1}/visit`, { visit_at: new Date().toISOString().slice(0, 16) })).data.id; await sales.call('POST', `/api/sales/visits/${v3}/status`, { status: 'cancelled' });
ok('a cancelled visit cannot be checked in to', (await sales.call('POST', `/api/sales/visits/${v3}/checkin`, { lat: 19.07, lng: 72.87 })).status === 409);
ok('another salesperson cannot check in to this lead\'s visit', (await sales2.call('POST', `/api/sales/visits/${v1}/checkin`, { lat: 19.07, lng: 72.87 })).status === 403);
// conversion
const unit2 = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: 'Q' + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 200000000 })).data.id;
ok('lead one books a flat', (await o.call('POST', '/api/sales/bookings', { unit_id: unit2, lead_id: l1, customer_name: 'Visitor One ' + run, phone: '9811122234', agreed_price_paise: 200000000, token_paise: 1000000 })).status === 200);
const conv = (await o.call('GET', '/api/sales/reports/visit-conversion')).data;
const gp = conv.by_project.find((g) => g.label === 'zz-r5 ' + run), gs = conv.by_source.find((g) => g.label === 'online'), gper = conv.by_person.some((g) => g.visited >= 2 && g.booked >= 1);
ok('visit-to-booking by project: 2 leads visited, 1 booked = 50%', gp && gp.visited === 2 && gp.booked === 1 && gp.conversion_pct === 50, JSON.stringify(gp));
ok('and by source and by salesperson', gs && gs.visited >= 2 && gper, JSON.stringify([conv.by_source, conv.by_person]));
ok('interest mix and check-in count are reported', conv.interest.some((i) => i.label === 'hot') && conv.visits_checked_in >= 1, JSON.stringify([conv.interest, conv.visits_done, conv.visits_checked_in]));
const fun = (await o.call('GET', '/api/reports/funnel')).data; ok('the funnel report carries visit-to-booking too', fun.visit_to_booking.visited >= 2 && fun.visit_to_booking.booked >= 1 && fun.visit_to_booking.pct > 0);
const vcsv = await o.call('GET', '/api/sales/reports/visit-conversion?csv=1', null, true); ok('conversion CSV', vcsv.status === 200 && (await vcsv.text()).includes('Conversion %'));
ok('a salesperson sees only their own leads in the report', (await sales2.call('GET', '/api/sales/reports/visit-conversion')).data.by_project.every((g) => g.label !== 'zz-r5 ' + run));
clean();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
