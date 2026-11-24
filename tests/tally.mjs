// tests/tally.mjs — WP-17: Tally voucher data (export only). Same env vars as security.mjs.
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
const L = 100000, iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const from = iso(-3), to = iso(1);
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-ty ' + run, code: 'TY' + run.toUpperCase().slice(-6), budget_paise: 500000000 })).data.id;
const acc = await mkUser('accounts', []); const viewer = await mkUser('viewer', []); const pm = await mkUser('pm', []); const sales = await mkUser('sales', []); const site = await mkUser('site', [pid]); const hr = await mkUser('hr', []); const pur = await mkUser('purchase', []);
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });
await o.call('POST', '/api/settings/con.enabled', { value: 'on' }); await o.call('POST', '/api/settings/con.pm_approval_limit_paise', { value: 50000000 });
const vouchers = async (who, kind, f = from, t = to) => who.call('GET', `/api/tally/vouchers?kind=${kind}&from=${f}&to=${t}`);
const mine = (r, pred) => (r.data.vouchers || []).filter(pred);

// ============ access ============
ok('PM, Sales, Site, HR and Purchase cannot open Tally export', (await vouchers(pm, 'receipts')).status === 403 && (await vouchers(sales, 'receipts')).status === 403 && (await vouchers(site, 'receipts')).status === 403 && (await vouchers(hr, 'receipts')).status === 403 && (await vouchers(pur, 'receipts')).status === 403);
ok('Accounts, the CA and the Owner can', (await vouchers(acc, 'receipts')).status === 200 && (await vouchers(viewer, 'receipts')).status === 200 && (await vouchers(o, 'receipts')).status === 200);
ok('the CA cannot change the ledger names; Accounts can', (await viewer.call('POST', '/api/tally/map', { bank: 'X' })).status === 403);
ok('a wrong kind or dates are refused', (await vouchers(acc, 'nonsense')).status === 400 && (await vouchers(acc, 'receipts', to, from)).status === 400 && (await vouchers(acc, 'receipts', 'x', to)).status === 400);

// ============ build the data: a booking with a receipt (and one with TDS), a vendor bill + payment, an RA bill, a petty expense, a credit note ============
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'On booking', pct_bp: 3000 }, { stage_name: 'Possession', pct_bp: 7000 }] });
const cust = 'Rajesh Kulkarni ' + run;
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'T', floor: 1, unit_no: 'TY' + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: cust, phone: '9733000111', agreed_price_paise: 100000000, token_paise: 0 })).data.id;
const dems = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands;
const r1 = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 12345678, mode: 'neft', ref_no: 'RN1' + run, demand_id: dems[0].id, received_on: iso(0) });
const r2 = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 5000000, tds_paise: 50000, mode: 'cheque', ref_no: 'RC2' + run, demand_id: dems[1].id, received_on: iso(0) });
const r3 = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100000, mode: 'neft', ref_no: 'RN3' + run, received_on: iso(0) });
ok('three receipts are made', [r1, r2, r3].every((r) => r.status === 200));
const rid3 = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.receipts.find((r) => r.ref_no === 'RN3' + run).id;
await o.call('POST', `/api/sales/receipts/${rid3}/reverse`, { reason: 'Cheque bounced test' });
const vend = (await o.call('POST', '/api/procurement/vendors', { name: 'Shree Steel ' + run })).data.id;
const bill = await o.call('POST', '/api/procurement/bills', { vendor_id: vend, bill_no: 'SB' + run, amount_paise: 1000000, gst_paise: 152542, tds_bp: 0, project_id: pid });
ok('a vendor bill is recorded', bill.status === 200, JSON.stringify(bill));
const bid = bill.data.id; const vp = await acc.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 400000, mode: 'neft', ref_no: 'VP1' + run, paid_on: iso(0) });
ok('and part paid', vp.status === 200, JSON.stringify(vp));
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'Om Civil Works ' + run, trade: 'civil', pan: 'ABCDE1234F' })).data.id;
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'lump_sum', value_paise: 10 * 100 * L, retention_bp: 500, advance_paise: 0 })).data;
await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
const ra = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 200 * L })).data;
await pm.call('POST', `/api/contractors/ra-bills/${ra.id}/check`, {}); const ap = await o.call('POST', `/api/contractors/ra-bills/${ra.id}/approve`, {}); ok('an RA bill is approved', ap.status === 200, JSON.stringify(ap));
const cp = await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/payments`, { amount_paise: 50 * L, mode: 'neft', ref_no: 'CP1' + run, paid_on: iso(0) }); ok('and part paid', cp.status === 200, JSON.stringify(cp));
const fund = (await acc.call('POST', '/api/petty/funds', { project_id: pid, custodian_user_id: site.id, opening_paise: 5000 * 100 })).data.id;
const pe = await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea and snacks', amount_paise: 45000, narration: 'site visit' }); await pm.call('POST', `/api/petty/entries/${pe.data.id}/approve`, {});
const cn = await acc.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dems[1].id, kind: 'credit_note', amount_paise: 1000000, gst_paise: 50000, reason: 'Goodwill credit for delay' }); await pm.call('POST', `/api/sales/adjustments/${cn.data.id}/approve`, {});

// ============ before the ledger names are set ============
await acc.call('POST', '/api/tally/map', { auto_party: true });
let rc = await vouchers(acc, 'receipts'); const v1 = mine(rc, (v) => v.narration.includes(cust) && v.number);
ok('vouchers are listed, but each says which ledger name is missing', v1.length === 2 && v1.every((v) => v.issues.some((i) => /Bank ledger is not set|TDS receivable/.test(i))), JSON.stringify(v1.map((v) => v.issues)));
ok('the customer ledger defaults to the customer name', v1[0].entries.some((e) => e.ledger === cust));
// ============ set the ledger names ============
const map = { bank: 'HDFC Bank A/c', cash: 'Cash', interest_income: 'Interest Received', sales_income: 'Flat Sales', gst_output: 'Output GST', gst_input: 'Input GST', tds_receivable: 'TDS Receivable', tds_payable: 'TDS Payable', retention_payable: 'Retention Payable', advance_recovery: 'Contractor Advances', other_deductions: 'Other Deductions', purchases: 'Material Purchases', contract_expense: 'Contract Works', petty_cash: 'Petty Cash', petty_expense: 'Site Expenses', parties: { ['Shree Steel ' + run]: 'Shree Steel (Creditor)' }, auto_party: true };
ok('Accounts saves the ledger names', (await acc.call('POST', '/api/tally/map', map)).status === 200 && (await viewer.call('GET', '/api/tally/map')).data.map.bank === 'HDFC Bank A/c');
rc = await vouchers(acc, 'receipts'); const rv = mine(rc, (v) => v.narration.includes(cust));
const sum = (v, dr) => v.entries.filter((e) => e.dr === dr).reduce((s, e) => s + e.paise, 0);
ok('receipt vouchers are clean and balanced to the paisa', rv.length === 2 && rv.every((v) => v.issues.length === 0 && sum(v, true) === sum(v, false) && v.entries.every((e) => Number.isInteger(e.paise))), JSON.stringify(rv.map((v) => v.issues)));
const a = rv.find((v) => v.number === r1.data.receipt_no), b = rv.find((v) => v.number === r2.data.receipt_no);
ok('plain receipt: Dr bank 1,23,456.78, Cr the customer', a.vtype === 'Receipt' && a.entries.length === 2 && a.entries[0].ledger === 'HDFC Bank A/c' && a.entries[0].dr && a.entries[0].paise === 12345678 && a.entries[1].ledger === cust && !a.entries[1].dr);
ok('receipt with TDS: Dr bank, Dr TDS receivable, Cr customer for the total', b.entries.length === 3 && b.entries.find((e) => e.ledger === 'TDS Receivable').paise === 50000 && b.entries.find((e) => e.ledger === cust).paise === 5050000 && b.date === iso(0));
ok('the reversed receipt is not exported', !rv.some((v) => v.narration.includes('RN3')));
ok('the date range filters vouchers', mine(await vouchers(acc, 'receipts', iso(-30), iso(-10)), (v) => v.narration.includes(cust)).length === 0);
ok('totals match the receipts: 1,23,456.78 + 50,500.00 = 1,73,956.78', rv.reduce((s, v) => s + v.total_paise, 0) === 12345678 + 5050000);
// vendor bill + payment
const bv = mine(await vouchers(acc, 'purchase_bills'), (v) => v.number === 'SB' + run)[0];
ok('purchase bill: Dr purchases (taxable) + Dr input GST, Cr the vendor ledger from the party map', bv && bv.vtype === 'Purchase' && bv.issues.length === 0 && bv.entries.find((e) => e.ledger === 'Input GST').paise === 152542 && bv.entries.find((e) => e.ledger === 'Material Purchases').paise === 847458 && bv.entries.find((e) => !e.dr).ledger === 'Shree Steel (Creditor)' && bv.entries.find((e) => !e.dr).paise === 1000000, JSON.stringify(bv));
const pv = mine(await vouchers(acc, 'vendor_payments'), (v) => v.narration.includes('Shree Steel ' + run))[0];
ok('vendor payment: Dr the vendor, Cr the bank', pv && pv.vtype === 'Payment' && pv.issues.length === 0 && pv.entries[0].ledger === 'Shree Steel (Creditor)' && pv.entries[0].dr && pv.entries[1].ledger === 'HDFC Bank A/c' && pv.total_paise === 400000);
// RA bill + contractor payment
const rv2 = mine(await vouchers(acc, 'ra_bills'), (v) => v.narration.includes('Om Civil Works ' + run))[0];
ok('RA bill: Dr contract works 2,00,000, Cr the contractor net and Cr retention 10,000; balanced', rv2 && rv2.issues.length === 0 && rv2.entries.find((e) => e.ledger === 'Contract Works').paise === 200 * L && rv2.entries.find((e) => e.ledger === 'Retention Payable').paise === 10 * L && sum(rv2, true) === sum(rv2, false), JSON.stringify(rv2));
const cpv = mine(await vouchers(acc, 'contractor_payments'), (v) => v.narration.includes('Om Civil Works ' + run))[0];
ok('contractor payment: Dr the contractor, Cr the bank, 50,000', cpv && cpv.total_paise === 50 * L && cpv.entries[1].ledger === 'HDFC Bank A/c');
const pt = mine(await vouchers(acc, 'petty'), (v) => v.narration.includes('Tea and snacks'))[0];
ok('petty cash expense: Dr site expenses, Cr petty cash, 450', pt && pt.entries[0].ledger === 'Site Expenses' && pt.entries[1].ledger === 'Petty Cash' && pt.total_paise === 45000);
const cv = mine(await vouchers(acc, 'credit_notes'), (v) => v.narration.includes(cust))[0];
ok('credit note: Dr flat sales + Dr output GST, Cr the customer 10,500', cv && cv.vtype === 'Credit Note' && cv.entries.find((e) => e.ledger === 'Flat Sales').paise === 1000000 && cv.entries.find((e) => e.ledger === 'Output GST').paise === 50000 && cv.entries.find((e) => !e.dr).paise === 1050000 && cv.number.startsWith('CN-'));
ok('the party ledger is named on each voucher (Tally needs it); petty cash has none', a.party === cust && bv.party === 'Shree Steel (Creditor)' && pv.party === 'Shree Steel (Creditor)' && pt.party === '');
// a missing ledger blocks the voucher
await acc.call('POST', '/api/tally/map', { ...map, retention_payable: '' });
const rv3 = mine(await vouchers(acc, 'ra_bills'), (v) => v.narration.includes('Om Civil Works ' + run))[0];
ok('when a ledger name is removed, the voucher that needs it is flagged (it will not be exported)', rv3.issues.some((i) => /Retention payable ledger is not set/.test(i)));
await acc.call('POST', '/api/tally/map', map);
ok('requests without the header are refused', (await fetch(BASE + '/api/tally/map', { method: 'POST', headers: { cookie: acc.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
// export log
ok('the CA can log an export; it shows in the list and the audit log', (await viewer.call('POST', '/api/tally/log', { kind: 'receipts', from, to, count: 2, skipped: 0, total_paise: 17395678 })).status === 200 && (await acc.call('GET', '/api/tally/log')).data.log.some((l) => l.kind === 'receipts' && l.voucher_count === 2 && l.total_paise === 17395678) && JSON.stringify((await o.call('GET', '/api/audit?limit=60')).data).includes('Tally export'));
ok('a log for an unknown kind is refused', (await acc.call('POST', '/api/tally/log', { kind: 'x', from, to })).status === 400);
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
