// tests/bank.mjs — WP-18: bank-statement import and matching. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { name: 'zz-bk ' + run, code: 'BK' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const acc = await mkUser('accounts', []); const pm = await mkUser('pm', []); const sales = await mkUser('sales', []); const site = await mkUser('site', [pid]);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'On booking', pct_bp: 10000 }] });
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });
const names = ['Rajesh Kulkarni', 'Sunita Deshpande', 'Anil Bhosale', 'Meera Joshi', 'Vikram Patwardhan'];
const bks = [];
const letters = run.split('').map((c) => ('0123456789'.includes(c) ? 'abcdefghij'[Number(c)] : c)).join('');
const off = (parseInt(run, 36) % 9000) * 1000; // makes every amount in this run different from other test runs
for (let n = 0; n < 5; n++) {
  const price = (n >= 3 ? 150000000 : 100000000 + n * 7000000) + off; // bookings 4 and 5 (index 3, 4) have the same price on purpose
  const u = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'K', floor: 1 + n, unit_no: 'BK' + n + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: price })).data.id;
  const b = await o.call('POST', '/api/sales/bookings', { unit_id: u, customer_name: names[n] + ' ' + letters, phone: '97' + String(30000000 + n), agreed_price_paise: price, token_paise: 0 }); if (b.status !== 200) throw new Error(JSON.stringify(b));
  const det = (await o.call('GET', `/api/sales/bookings/${b.data.id}`)).data; bks.push({ id: b.data.id, due: det.demands[0].amount_paise + (det.demands[0].gst_paise || 0) - (det.demands[0].settled_paise || 0), demand: det.demands[0].id, name: names[n] });
}
const row = (date, narr, credit, ref, seq) => ({ date, narration: narr, credit_paise: credit, reference: ref, seq });
const lines = [
  row('2026-11-02', `NEFT-HDFCN${run}-RAJESH KULKARNI ${letters.toUpperCase()}-FLAT BK0`, bks[0].due, 'N100' + run),            // amount + name
  row('2026-11-03', 'IMPS 123412341234 TRANSFER FROM 5678901234567 TO ESCROW', bks[1].due, 'N200' + run),  // amount only, long numbers to be masked
  row('2026-11-04', 'UPI SUNITA DESHPANDE ' + letters, 2500000 + (off % 7777), 'N300' + run),                                      // name only: partial
  row('2026-11-05', 'NEFT SOME OTHER PERSON', bks[3].due, 'N400' + run),                                  // two demands with this amount
];
for (let i = 0; i < 16; i++) lines.push(row('2026-11-' + String(6 + (i % 20)).padStart(2, '0'), 'MISC CREDIT ' + i, 111100 + i * 137 + (off % 53) * 1000, 'M' + i + run));

// ============ access ============
ok('only Accounts and the Owner can use bank import', (await sales.call('GET', '/api/bank/rows')).status === 403 && (await pm.call('GET', '/api/bank/rows')).status === 403 && (await site.call('GET', '/api/bank/rows')).status === 403 && (await acc.call('GET', '/api/bank/rows')).status === 200 && (await o.call('GET', '/api/bank/rows')).status === 200);
ok('headers are required', (await fetch(BASE + '/api/bank/imports', { method: 'POST', headers: { cookie: acc.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
ok('a bank format (column choice) can be saved and found again', (await acc.call('POST', '/api/bank/profiles', { name: 'HDFC ' + run, mapping: { date: 0, narration: 1, credit: 4, reference: 2, format: 'dd/mm/yyyy', skip: 1 } })).status === 200 && (await acc.call('GET', '/api/bank/profiles')).data.profiles.some((p) => p.name === 'HDFC ' + run && p.mapping.credit === 4));
ok('a format without the main columns is refused', (await acc.call('POST', '/api/bank/profiles', { name: 'x', mapping: { date: 0 } })).status === 400);

// ============ import ============
ok('a bad date and a zero credit are refused with the line number', /Line 1/.test((await acc.call('POST', '/api/bank/imports', { rows: [row('02/11/2026', 'x', 100, '')] })).err || '') && /Line 1/.test((await acc.call('POST', '/api/bank/imports', { rows: [row('2026-11-02', 'x', 0, '')] })).err || ''));
ok('more than 100 lines in one call is refused', /at most 100/.test((await acc.call('POST', '/api/bank/imports', { rows: Array.from({ length: 101 }, (_, i) => row('2026-11-02', 'x' + i, 100 + i, '')) })).err || ''));
const imp = await acc.call('POST', '/api/bank/imports', { filename: 'hdfc-nov.csv', rows: lines });
ok('20 lines are imported and 3 get a suggestion', imp.status === 200 && imp.data.added === 20 && imp.data.suggested === 3, JSON.stringify(imp.data));
const batch = imp.data.batch_id;
const all = (await acc.call('GET', `/api/bank/rows?batch_id=${batch}`)).data;
ok('counts: 3 suggested, 17 unmatched', all.counts.suggested === 3 && all.counts.unmatched === 17, JSON.stringify(all.counts));
const byRef = (ref) => all.rows.find((r) => r.reference === ref + run) || {};
ok('amount and name match is suggested with the right demand', byRef('N100').matched_demand_id === bks[0].demand && /Amount and name/.test(byRef('N100').suggestion_note) && /Kulkarni/.test(byRef('N100').customer_name));
ok('amount-only match says "check the name"', byRef('N200').matched_demand_id === bks[1].demand && /Check the name/.test(byRef('N200').suggestion_note));
ok('long numbers in the narration are masked (no account numbers stored)', byRef('N200').narration.includes('X1234') && byRef('N200').narration.includes('X4567') && !/\d{9,}/.test(byRef('N200').narration), byRef('N200').narration);
ok('name-only match is offered as a part payment', byRef('N300').matched_demand_id === bks[2].demand + 0 || byRef('N300').matched_demand_id === bks[1].demand);
ok('two demands with the same amount: no guess, a note says so', byRef('N400').matched_demand_id == null && /2 open demands/.test(byRef('N400').suggestion_note) && byRef('N400').status === 'unmatched', JSON.stringify(byRef('N400')));
// importing the same statement again adds nothing
const again = await acc.call('POST', '/api/bank/imports', { filename: 'hdfc-nov.csv', rows: lines });
ok('importing the same file twice adds nothing', again.data.added === 0 && again.data.duplicates === 20);
ok('two genuinely identical lines in one file are both kept', (await acc.call('POST', '/api/bank/imports', { rows: [row('2026-12-01', 'SAME', 555500 + (off % 997), 'S1' + run), row('2026-12-01', 'SAME', 555500 + (off % 997), 'S1' + run)] })).data.added === 2);
// 500 cap per import
let capBatch = null; for (let i = 0; i < 5; i++) { const r = await acc.call('POST', '/api/bank/imports', { batch_id: capBatch, rows: Array.from({ length: 100 }, (_, k) => row('2026-10-01', 'cap ' + i + '-' + k, 700000 + i * 1000 + k, '')) }); capBatch = r.data.batch_id; }
ok('an import holds at most 500 lines', /at most 500/.test((await acc.call('POST', '/api/bank/imports', { batch_id: capBatch, rows: [row('2026-10-02', 'one more', 123456, '')] })).err || ''));
ok('someone else cannot add to my import', (await o.call('POST', '/api/bank/imports', { batch_id: batch, rows: [row('2026-10-02', 'x', 99999, '')] })).status === 404);

// ============ confirm: the receipt comes from the normal receipt route ============
const rcpt = (b, amount, ref) => acc.call('POST', `/api/sales/bookings/${b.id}/receipts`, { amount_paise: amount, mode: 'bank', ref_no: ref, demand_id: b.demand, received_on: '2026-11-02' });
ok('confirming without a receipt is refused', (await acc.call('POST', `/api/bank/rows/${byRef('N100').id}/confirm`, { booking_id: bks[0].id, ref_no: 'N100' + run })).status === 409);
const r1 = await rcpt(bks[0], bks[0].due, 'N100' + run); ok('Accounts records the normal receipt', r1.status === 200 && r1.data.receipt_no);
const c1 = await acc.call('POST', `/api/bank/rows/${byRef('N100').id}/confirm`, { booking_id: bks[0].id, ref_no: 'N100' + run });
ok('the line is linked to the receipt', c1.status === 200 && c1.data.receipt_id > 0);
ok('confirming again is refused', (await acc.call('POST', `/api/bank/rows/${byRef('N100').id}/confirm`, { booking_id: bks[0].id, ref_no: 'N100' + run })).status === 409);
ok('the same receipt cannot settle a second bank line', (await acc.call('POST', '/api/bank/imports', { rows: [row('2026-11-09', 'dup of first', bks[0].due, 'N100' + run)] })).data.added === 1 && (await (async () => { const rr = (await acc.call('GET', '/api/bank/rows?status=unmatched')).data.rows.find((x) => x.narration === 'dup of first'); return (await acc.call('POST', `/api/bank/rows/${rr.id}/confirm`, { booking_id: bks[0].id, ref_no: 'N100' + run })).status; })()) === 409);
ok('recording the same reference twice is refused by the receipt route (no duplicate receipts)', (await rcpt(bks[0], bks[0].due, 'N100' + run)).status === 409);
const r2 = await rcpt(bks[1], bks[1].due, 'N200' + run); const c2 = await acc.call('POST', `/api/bank/rows/${byRef('N200').id}/confirm`, { booking_id: bks[1].id, ref_no: 'N200' + run });
ok('a second match is confirmed', r2.status === 200 && c2.status === 200);
// large receipt waiting for a second person: the line links to the waiting request
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 1000000 });
const r3 = await rcpt(bks[2], 2500000 + (off % 7777), 'N300' + run); ok('a large receipt waits for approval', r3.status === 200 && r3.data.pending === true);
const c3 = await acc.call('POST', `/api/bank/rows/${byRef('N300').id}/confirm`, { booking_id: bks[2].id, ref_no: 'N300' + run });
ok('the line is linked to the waiting approval', c3.status === 200 && c3.data.request_id > 0 && c3.data.receipt_id === null);
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });
const m = (await acc.call('GET', `/api/bank/demands?q=Vikram Patwardhan ${letters}`)).data.demands; ok('open demands can be searched by customer or flat for lines without a suggestion', m.length === 1 && m[0].customer_name.startsWith('Vikram') && (await acc.call('GET', '/api/bank/demands?q=V')).data.demands.length === 0);
// ============ ignore the rest ============
const rest = (await acc.call('GET', `/api/bank/rows?batch_id=${batch}&status=unmatched`)).data.rows;
let okIgn = 0; for (const r of rest) if ((await acc.call('POST', `/api/bank/rows/${r.id}/ignore`)).status === 200) okIgn++;
ok('the other 17 are ignored', okIgn === 17 && (await acc.call('GET', `/api/bank/rows?batch_id=${batch}`)).data.counts.confirmed === 3);
ok('an ignored or confirmed line cannot be ignored again', (await acc.call('POST', `/api/bank/rows/${rest[0].id}/ignore`)).status === 409 && (await acc.call('POST', `/api/bank/rows/${byRef('N100').id}/ignore`)).status === 409);
ok('re-importing after confirming still adds nothing and creates no receipts', (await acc.call('POST', '/api/bank/imports', { rows: lines })).data.added === 0);
const csv = await acc.call('GET', '/api/bank/report', null, true); const txt = await csv.text(); ok('unmatched credits report (CSV)', csv.status === 200 && txt.includes('Narration') && !txt.includes('MISC CREDIT'));
ok('every import is in the audit log', JSON.stringify((await o.call('GET', '/api/audit?limit=60')).data).includes('Bank statement lines'));

// ============ retention (needs the local database path) ============
if (process.env.D1_PERSIST_TO) {
  try {
    execSync(`npx wrangler d1 execute nirmaan-db --local --persist-to ${process.env.D1_PERSIST_TO} --command "UPDATE bank_import_rows SET created_at = datetime('now', '-200 days') WHERE batch_id = ${batch}"`, { stdio: 'ignore' });
    await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
    const left = (await acc.call('GET', `/api/bank/rows?batch_id=${batch}`)).data;
    ok('old ignored lines are removed; confirmed ones stay linked but lose their narration text', left.rows.length === 3 && left.rows.every((r) => r.status === 'confirmed' && r.narration === ''), JSON.stringify(left.counts));
  } catch (e) { console.log('SKIP  retention test:', String(e.message).slice(0, 80)); }
} else console.log('SKIP  retention test (D1_PERSIST_TO not set)');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
