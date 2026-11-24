// tests/m4_step1.mjs — Module 4 gaps, step 1: the 10% AFS gate, buyer TDS (s.194-IA) held until verified, receipt back-dating limit, bank RM, collections ladder, forecast, bank follow-ups.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, form) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !form) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });   // this suite tests the 10% rule: start with it on, whatever an earlier suite left
let seq = 0;
const mkUser = async (role) => { const email = `m4a-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm4a ' + role, email, role, projects: [] }); const pw = 'M4StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const n1 = (out, k) => Number((out.match(new RegExp('"' + k + '":\\s*(\\d+)')) || [])[1]);
const str1 = (out, k) => (out.match(new RegExp('"' + k + '":\\s*"([^"]*)"')) || [])[1];
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m4a ' + run, code: 'M4' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm'); const acc = await mkUser('accounts'); const sales = await mkUser('sales');
await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' });
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });   // other suites may leave a second-person limit behind
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, cc_upto_floor) VALUES (${pid}, 'Commencement Certificate', 'cc', 'approved', 30)`);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'On booking', pct_bp: 1000 }, { stage_name: 'On agreement', pct_bp: 2000 }, { stage_name: 'Slab 5', pct_bp: 5000, milestone_key: 'k' + run }, { stage_name: 'Possession', pct_bp: 2000, milestone_key: 'p' + run }] });
let n = 0;
const mkUnit = async (price = 600000000, extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: 'F' + (++n) + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: price, ...extra })).data.id;
const book = async (unit, price = 600000000) => (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz buyer ' + (++n), phone: '9' + String(Date.now() + n).slice(-9), agreed_price_paise: price, token_paise: Math.floor(price / 10) })).data;
const demandsOf = async (bk) => (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands;

// ---------- the 10% gate ----------
const u1 = await mkUnit(); const b1 = await book(u1);
let d1 = await demandsOf(b1.id);
ok('the first 10% is billable; the next stage is held until the Agreement for Sale is registered', d1[0].status === 'ready' && d1[1].status === 'scheduled', JSON.stringify(d1.map((x) => x.status)));
ok('the held demand says why', /AFS registration pending/.test(sql(`SELECT hold_reason FROM sal_demands WHERE id = ${d1[1].id}`)));
const ms = async (name, key, wing) => { await pm.call('POST', '/api/site/milestones', { project_id: pid, name, milestone_key: key, wing, floor: 5 }); return (await pm.call('GET', '/api/site/milestones')).data.milestones.find((m) => m.name === name); };
const slab = await ms('Slab 5 ' + run, 'k' + run, 'A');
const cert = await pm.call('POST', `/api/site/milestones/${slab.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/' + run });
ok('a certified slab does not release the demand of a buyer who has not registered', cert.status === 200 && cert.data.demands_held_afs >= 1, JSON.stringify(cert));
d1 = await demandsOf(b1.id);
ok('their slab demand is still not billable', d1[2].status === 'scheduled' && /AFS registration pending/.test(sql(`SELECT hold_reason FROM sal_demands WHERE id = ${d1[2].id}`)));
ok('Accounts are told whom to remind', /AFS registration needed/.test(sql("SELECT title FROM notifications WHERE title LIKE 'AFS registration needed%' ORDER BY id DESC LIMIT 1")));
const reg0 = await o.call('POST', `/api/sales/bookings/${b1.id}/registration`, { agreement_date: iso(-1), registration_date: iso(0) });
ok('registration needs the number and the Index-II scan', reg0.status === 400 && reg0.code === 'afs', JSON.stringify(reg0));
const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'i2.png'); fd.append('title', 'Index-II'); fd.append('category', 'agreement'); fd.append('module', 'sales'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
const up = (await o.call('POST', '/api/files/upload', fd, true)).data;
const reg1 = await o.call('POST', `/api/sales/bookings/${b1.id}/registration`, { agreement_date: iso(-1), registration_date: iso(0), afs_reg_no: 'BDR-1/' + run, afs_doc_id: up.id });
d1 = await demandsOf(b1.id);
ok('once registered, the held demands open: the agreement stage and the already certified slab', reg1.status === 200 && d1[1].status === 'ready' && d1[2].status === 'ready' && d1[3].status === 'scheduled', JSON.stringify(d1.map((x) => x.status)));
const b2 = await book(await mkUnit());
ok('a buyer who registered after booking another flat is held again at 10%, per booking', (await demandsOf(b2.id))[1].status === 'scheduled');
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });
await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'off' });   // these suites test the earlier possession rules (written reasons); the strict six-point lock is tested in m5_step1 and m5_step2
const b3 = await book(await mkUnit(100000000), 100000000);
ok('the rule can be switched off in Settings', (await demandsOf(b3.id))[1].status === 'ready');
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });

// ---------- buyer TDS (s.194-IA) ----------
ok('a flat of Rs 60 lakh is marked for buyer TDS; a flat of Rs 10 lakh is not', n1(sql(`SELECT tds194ia AS t FROM sal_bookings WHERE id = ${b1.id}`), 't') === 1 && n1(sql(`SELECT tds194ia AS t FROM sal_bookings WHERE id = ${b3.id}`), 't') === 0);
const dem = d1[1];   // 20% = 12,00,00,000 paise; GST on it
const total = dem.amount_paise + (dem.gst_paise || 0);
const tds = Math.round(dem.amount_paise / 100);   // 1% of the consideration
const rc = await acc.call('POST', `/api/sales/bookings/${b1.id}/receipts`, { amount_paise: total - tds, tds_paise: tds, mode: 'neft', ref_no: 'T' + run, demand_id: dem.id, received_on: iso(0) });
ok('a payment with buyer TDS is accepted', rc.status === 200, JSON.stringify(rc));
const after = (await demandsOf(b1.id))[1];
ok('the TDS part is not counted as received yet: the demand stays part-paid', after.settled_paise === total - tds && after.status === 'partial', JSON.stringify(after));
const cred = (await acc.call('GET', '/api/sales/tds-credits')).data.credits.find((c) => c.booking_id === b1.id);
ok('it waits on the buyer TDS list', cred && cred.amount_paise === tds, JSON.stringify(cred));
ok('the PM cannot verify it', (await pm.call('POST', `/api/sales/tds-credits/${cred.id}/verify`, { challan_no: 'ACK123456', paid_on: iso(0) })).status === 403);
ok('the acknowledgement number and date are needed', (await acc.call('POST', `/api/sales/tds-credits/${cred.id}/verify`, { challan_no: '12', paid_on: iso(0) })).status === 400 && (await acc.call('POST', `/api/sales/tds-credits/${cred.id}/verify`, { challan_no: 'ACK123456', paid_on: iso(5) })).status === 400);
// possession is blocked while the TDS is open
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, wing) VALUES (${pid}, 'Occupancy Certificate', 'oc', 'approved', 'A')`);
await o.call('POST', `/api/sales/bookings/${b1.id}/handover`, {});
const ho = await o.call('POST', `/api/sales/bookings/${b1.id}/handover/complete`, { override_note: 'let us go ahead anyway please' });
ok('possession cannot be given while the buyer\'s TDS is unverified, even with a reason', ho.status === 409 && ho.code === 'tds_pending', JSON.stringify(ho));
ok('Accounts verify the challan', (await acc.call('POST', `/api/sales/tds-credits/${cred.id}/verify`, { challan_no: 'ACK123456', paid_on: iso(0) })).status === 200 && (await acc.call('POST', `/api/sales/tds-credits/${cred.id}/verify`, { challan_no: 'ACK123456', paid_on: iso(0) })).status === 409);
const done = (await demandsOf(b1.id))[1];
ok('now the TDS counts: the demand is fully paid and the receipt shows it', done.settled_paise === total && done.status === 'paid' && n1(sql(`SELECT tds_paise AS t FROM sal_receipts WHERE id = (SELECT receipt_id FROM sal_tds_credits WHERE id = ${cred.id})`), 't') === tds);
// reversal cancels a pending credit
const dem3 = d1[0];
const rc2 = await acc.call('POST', `/api/sales/bookings/${b1.id}/receipts`, { amount_paise: dem3.amount_paise - 1000, tds_paise: 1000, mode: 'neft', ref_no: 'U' + run, demand_id: dem3.id });
const rid = n1(sql(`SELECT id FROM sal_receipts WHERE booking_id = ${b1.id} AND ref_no = 'U${run}'`), 'id');
ok('reversing a receipt cancels its waiting TDS', (await pm.call('POST', `/api/sales/receipts/${rid}/reverse`, { reason: 'cheque bounced' })).status === 200 && /"status": "cancelled"/.test(sql(`SELECT status FROM sal_tds_credits WHERE receipt_id = ${rid}`)), JSON.stringify(rc2));

// ---------- back-dating ----------
const ub = await mkUnit(100000000); const bb = await book(ub, 100000000); const db = (await demandsOf(bb.id))[0];
const rcpt = (who, extra) => who.call('POST', `/api/sales/bookings/${bb.id}/receipts`, { amount_paise: 100000, mode: 'neft', ref_no: 'B' + Math.random().toString(36).slice(2, 8), demand_id: db.id, ...extra });
ok('a receipt cannot be dated in the future', (await rcpt(acc, { received_on: iso(3) })).status === 400);
ok('a receipt dated 30 days back is refused for Accounts', (await rcpt(acc, { received_on: iso(-30) })).code === 'backdate');
ok('the Owner needs a written reason', (await rcpt(o, { received_on: iso(-30) })).code === 'backdate_reason');
ok('the Owner can accept it with the reason, and it is recorded', (await rcpt(o, { received_on: iso(-30), backdate_reason: 'Cheque cleared on the 30th, found late' })).status === 200 && /Cheque cleared/.test(sql(`SELECT backdate_note FROM sal_receipts WHERE booking_id = ${bb.id} AND backdate_note IS NOT NULL LIMIT 1`)));
ok('a receipt from this week is fine', (await rcpt(acc, { received_on: iso(-3) })).status === 200);

// ---------- ladder, forecast, bank follow-ups ----------
const uL = await mkUnit(100000000); const bl = await book(uL, 100000000); const dl = await demandsOf(bl.id);
sql(`UPDATE sal_demands SET status = 'ready', due_date = '${iso(2)}' WHERE id = ${dl[1].id}`);
sql(`UPDATE sal_demands SET status = 'ready', due_date = '${iso(-4)}' WHERE id = ${dl[2].id}`);
sql(`UPDATE sal_demands SET status = 'ready', due_date = '${iso(-20)}' WHERE id = ${dl[3].id}`);
const lad = (await acc.call('GET', `/api/sales/collections-ladder?project_id=${pid}`)).data;
ok('the ladder puts a demand due in 2 days under "due soon"', lad.soon.some((r) => r.id === dl[1].id));
ok('one 4 days late under "overdue"', lad.late.some((r) => r.id === dl[2].id && r.days_late === 4));
ok('and one 20 days late under 15+ with its interest', lad.late15.some((r) => r.id === dl[3].id && r.interest_paise > 0), JSON.stringify(lad.late15.map((r) => [r.id, r.interest_paise])));
ok('a salesperson sees only their own buyers on the ladder', (await sales.call('GET', `/api/sales/collections-ladder?project_id=${pid}`)).data.late15.every((r) => r.booking_id !== bl.id));
const fc = (await acc.call('GET', `/api/reports/collections-forecast?project_id=${pid}`)).data;
ok('the forecast has already-due money and money due in the next 30 days', fc.windows[0].paise > 0 && fc.windows[1].paise > 0 && fc.windows.length === 4, JSON.stringify(fc));
ok('sales cannot see the forecast', (await sales.call('GET', `/api/reports/collections-forecast?project_id=${pid}`)).status === 403);
ok('a bad bank email is refused', (await acc.call('POST', `/api/sales/bookings/${bl.id}/loans`, { bank: 'HDFC', sanction_paise: 50000000, rm_email: 'nope' })).status === 400);
const loan = await acc.call('POST', `/api/sales/bookings/${bl.id}/loans`, { bank: 'HDFC', sanction_paise: 50000000, rm_name: 'Mr Shah', rm_email: 'shah@hdfc.test', coordinator_email: 'coord@hdfc.test' });
ok('the bank relationship manager is saved with the loan', loan.status === 200);
const bf = (await acc.call('GET', '/api/sales/bank-followups')).data.followups;
ok('a demand 20 days late on a flat with an undisbursed loan is on the bank follow-up list', bf.some((r) => r.demand_id === dl[3].id && r.rm_email === 'shah@hdfc.test' && r.coordinator_email === 'coord@hdfc.test'), JSON.stringify(bf.map((r) => r.demand_id)));
ok('one only 4 days late is not (10-day wait)', !bf.some((r) => r.demand_id === dl[2].id));
await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
