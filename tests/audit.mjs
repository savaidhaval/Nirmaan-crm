// tests/audit.mjs — the money/inventory/fraud rules from the architecture audit. Same env vars as security.mjs.
import { createHmac } from 'node:crypto';
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw, hdr = {}) { const h = { 'X-NirmaanCRM': '1', ...hdr }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !(b instanceof FormData) && typeof b !== 'string') { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // these suites bill stages without registering the Agreement for Sale; the 10% rule is tested in m4_step1
let seq = 0;
const mk = async (role, projects) => { const email = `za-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'za ' + role + seq, email, role, projects }); const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: 'ZaStrongPass-' + run }); c.id = r.data.id; return c; };
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-a ' + run, code: 'A' + run.toUpperCase().slice(-6) })).data.id;
const s1 = await mk('sales', [pid]); const s2 = await mk('sales', [pid]); const pm = await mk('pm', []); const acc = await mk('accounts', []); const site = await mk('site', [pid]);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Booking', pct_bp: 1000 }, { stage_name: 'Rest', pct_bp: 9000 }] });
const mkUnit = async (n, extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: n + run.slice(-3), price_paise: 10000000, rera_carpet_sqft: 500, ...extra })).data.id;

// --- lead protection
const p = (x) => x + digits;                       // 10 digits
const l1 = await s1.call('POST', '/api/sales/leads', { name: 'zz a1', phone: '98' + digits, project_id: pid });
ok('lead registered', l1.status === 200);
for (const variant of ['+91 98' + digits.slice(0, 4) + ' ' + digits.slice(4), '0098' + digits, '91-98' + digits]) {
  const dup = await s2.call('POST', '/api/sales/leads', { name: 'zz poach', phone: variant, project_id: pid });
  ok(`same number in another format is refused (${variant})`, dup.status === 409, String(dup.status));
}
const lead = (await s1.call('GET', `/api/sales/leads/${l1.data.id}`)).data.lead;
ok('phone_norm stored', lead.phone_norm === '98' + digits);
ok('rep cannot change a lead phone', (await s1.call('PUT', `/api/sales/leads/${l1.data.id}`, { phone: '99' + digits, reason: 'customer asked' })).status === 403);
ok('owner needs a reason to change phone', (await o.call('PUT', `/api/sales/leads/${l1.data.id}`, { phone: '99' + digits })).status === 400);
ok('owner can change phone with a reason (audited)', (await o.call('PUT', `/api/sales/leads/${l1.data.id}`, { phone: '99' + digits, reason: 'customer gave new number' })).status === 200);
const auditRows = (await o.call('GET', '/api/audit')).data.audit;
ok('phone change is in the audit log', auditRows.some((a) => a.action === 'phone_change' && a.entity_id === l1.data.id));
const rr = (await o.call('POST', '/api/sales/leads', { name: 'zz round', phone: '96' + digits, project_id: pid })).data.id;
const rrLead = (await o.call('GET', `/api/sales/leads/${rr}`)).data.lead;
ok('owner-created lead is auto-assigned to a sales user', !!rrLead.assigned_to && rrLead.assigned_to !== 0);
ok('reassign needs a reason', (await o.call('POST', `/api/sales/leads/${l1.data.id}/reassign`, { assigned_to: s2.id })).status === 400);
ok('reassign with reason works', (await o.call('POST', `/api/sales/leads/${l1.data.id}/reassign`, { assigned_to: s2.id, reason: 'rep on leave' })).status === 200);
ok('sales cannot reassign', (await s1.call('POST', `/api/sales/leads/${l1.data.id}/reassign`, { assigned_to: s1.id, reason: 'taking it back' })).status === 403);

// --- lead state machine
const sl = (await s1.call('POST', '/api/sales/leads', { name: 'zz sm', phone: '95' + digits, project_id: pid })).data.id;
const act = (st) => s1.call('POST', `/api/sales/leads/${sl}/activity`, { type: 'note', status: st, note: 'x' });
ok('new cannot jump to negotiating', (await act('negotiating')).status === 400);
ok('cannot mark booked by hand', (await act('booked')).status === 400);
ok('new -> interested allowed', (await act('interested')).status === 200);
ok('-> lost allowed', (await act('lost')).status === 200);
ok('sales cannot reopen a lost lead', (await act('interested')).status === 403);
ok('manager can reopen', (await o.call('POST', `/api/sales/leads/${sl}/activity`, { type: 'note', status: 'interested', note: 'reopened' })).status === 200);

// --- holds + atomic booking
const u1 = await mkUnit('H');
const hl = (await s1.call('POST', '/api/sales/leads', { name: 'zz hold', phone: '94' + digits, project_id: pid })).data.id;
ok('hold needs a lead', (await s1.call('POST', `/api/sales/inventory/${u1}/hold`, {})).status === 400);
ok('cannot hold for someone else\'s lead', (await s2.call('POST', `/api/sales/inventory/${u1}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: hl })).status === 403);
const holds = await Promise.all([s1.call('POST', `/api/sales/inventory/${u1}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: hl }), o.call('POST', `/api/sales/inventory/${u1}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: hl }), pm.call('POST', `/api/sales/inventory/${u1}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: hl })]);
ok('simultaneous holds: exactly one winner', holds.filter((h) => h.status === 200).length === 1 && holds.filter((h) => h.status === 409).length === 2, JSON.stringify(holds.map((h) => h.status)));
const winner = holds.findIndex((h) => h.status === 200);
ok('other rep cannot book a held flat', (await s2.call('POST', '/api/sales/bookings', { unit_id: u1, customer_name: 'zz thief', token_paise: 100000 })).status === 409);
ok('hold converts only with a token', (await (winner === 0 ? s1 : o).call('POST', '/api/sales/bookings', { unit_id: u1, customer_name: 'zz holder' })).status === 400);
ok('sales cannot extend a hold', (await s1.call('POST', `/api/sales/inventory/${u1}/extend`, { reason: 'please' })).status === 403);
ok('manager can extend with a reason', (await o.call('POST', `/api/sales/inventory/${u1}/extend`, { reason: 'customer travelling' })).status === 200);
ok('release by non-holder refused', (await s2.call('POST', `/api/sales/inventory/${u1}/release`)).status === 403);
ok('manager can release', (await o.call('POST', `/api/sales/inventory/${u1}/release`)).status === 200);
const u2 = await mkUnit('R');
const books = await Promise.all([1, 2, 3, 4].map((i) => o.call('POST', '/api/sales/bookings', { unit_id: u2, customer_name: 'zz race ' + i, token_paise: 100000 })));
ok('simultaneous bookings: exactly one succeeds', books.filter((b) => b.status === 200).length === 1 && books.every((b) => [200, 409].includes(b.status)), JSON.stringify(books.map((b) => b.status)));
const urehab = await mkUnit('X', { category: 'rehab', price_paise: 0 });
ok('rehab flat cannot be sold', (await o.call('POST', '/api/sales/bookings', { unit_id: urehab, customer_name: 'zz rehab', token_paise: 1 })).status === 400);
ok('sales cannot add inventory', (await s1.call('POST', '/api/sales/inventory', { project_id: pid, unit_no: 'Z9', price_paise: 100 })).status === 403);

// --- discounts + price changes
const u3 = await mkUnit('D');
ok('discount needs a reason', (await o.call('POST', '/api/sales/bookings', { unit_id: u3, customer_name: 'zz d', agreed_price_paise: 9900000, token_paise: 100000 })).status === 400);
ok('sales cannot give >1% discount', (await s1.call('POST', '/api/sales/bookings', { unit_id: u3, customer_name: 'zz d', agreed_price_paise: 9500000, discount_reason: 'friend of owner', token_paise: 100000 })).status === 403);
ok('PM cannot give >3% discount', (await pm.call('POST', '/api/sales/bookings', { unit_id: u3, customer_name: 'zz d', agreed_price_paise: 9000000, discount_reason: 'bulk deal', token_paise: 100000 })).status === 403);
const dOk = await o.call('POST', '/api/sales/bookings', { unit_id: u3, customer_name: 'zz d', agreed_price_paise: 9500000, discount_reason: 'festival offer approved', token_paise: 100000 });
ok('owner may discount with a reason', dOk.status === 200 && dOk.data.discount_bp === 500, JSON.stringify(dOk));
const bd = (await o.call('GET', `/api/sales/bookings/${dOk.data.id}`)).data.booking;
ok('booking keeps rate-card price and reason', bd.list_price_paise === 10000000 && bd.discount_reason === 'festival offer approved' && bd.approved_by);
ok('discount is in the audit log', (await o.call('GET', '/api/audit')).data.audit.some((a) => a.entity === 'sal_bookings' && a.entity_id === dOk.data.id && /discount 5\.00%/.test(a.summary)));
const u4 = await mkUnit('P');
ok('price change needs a reason', (await o.call('PUT', `/api/sales/inventory/${u4}`, { price_paise: 11000000 })).status === 400);
ok('price change audited', (await o.call('PUT', `/api/sales/inventory/${u4}`, { price_paise: 11000000, reason: 'rate card revision' })).status === 200 && (await o.call('GET', '/api/audit')).data.audit.some((a) => a.action === 'price_change' && a.entity_id === u4));
ok('booked flat price cannot change', (await o.call('PUT', `/api/sales/inventory/${u3}`, { price_paise: 1, reason: 'sneaky change' })).status === 400);
ok('RERA 10% advance cap for non-owner', (await pm.call('POST', '/api/sales/bookings', { unit_id: u4, customer_name: 'zz big token', token_paise: 5000000 })).status === 400);

// --- payment plan changes
ok('PM cannot change plan once bookings exist', (await pm.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] })).status === 403);
ok('Owner plan change is audited with before/after', (await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Booking', pct_bp: 1000 }, { stage_name: 'Rest', pct_bp: 9000 }] })).status === 200 && (await o.call('GET', '/api/audit?action=plan_change')).data.audit.some((a) => /Before/.test(a.summary)));

// --- receipts
const bk = dOk.data.id; const dem = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0];
ok('sales cannot record receipts', (await s1.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100, demand_id: dem.id, ref_no: 'X1' })).status === 403);
ok('cash of Rs 2 lakh or more refused', (await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 20000000, mode: 'cash', demand_id: dem.id })).status === 400);
ok('bank receipt needs a reference', (await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100000, mode: 'bank', demand_id: dem.id })).status === 400);
const r1 = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 500000, demand_id: dem.id, ref_no: 'UTR' + run });
ok('accounts records a numbered receipt', r1.status === 200 && /^RC-.*-\d{5}$/.test(r1.data.receipt_no), JSON.stringify(r1));
ok('duplicate reference refused', (await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 500000, demand_id: dem.id, ref_no: 'UTR' + run })).status === 409);
ok('only owner/accounts may route outside RERA account', (await pm.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100, ref_no: 'Q' + run, account: 'project_other' })).status === 403);
const r2 = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100000, demand_id: dem.id, ref_no: 'UTR2' + run });
ok('receipt numbers increase', r2.data.receipt_no > r1.data.receipt_no);
const rid = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.receipts[0].id;
ok('reversal needs a reason', (await o.call('POST', `/api/sales/receipts/${rid}/reverse`, {})).status === 400);
ok('accounts cannot reverse', (await acc.call('POST', `/api/sales/receipts/${rid}/reverse`, { reason: 'cheque bounced' })).status === 403);
ok('owner reverses with a reason', (await o.call('POST', `/api/sales/receipts/${rid}/reverse`, { reason: 'cheque bounced' })).status === 200);
ok('reversal is audited and demand re-opened', (await o.call('GET', '/api/audit')).data.audit.some((a) => a.action === 'reverse') && ['partial', 'ready', 'paid'].includes((await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0].status));
ok('cannot reverse twice', (await o.call('POST', `/api/sales/receipts/${rid}/reverse`, { reason: 'again again' })).status === 400);

// --- cancellation + refunds
ok('refund refused before cancellation', (await pm.call('POST', `/api/sales/bookings/${bk}/refund`, { amount_paise: 100, reason: 'customer request' })).status === 400);
ok('cancel needs a reason', (await o.call('POST', `/api/sales/bookings/${bk}/cancel`, {})).status === 400);
ok('cancel works', (await pm.call('POST', `/api/sales/bookings/${bk}/cancel`, { reason: 'buyer loan rejected' })).status === 200);
ok('refund above amount paid refused', (await pm.call('POST', `/api/sales/bookings/${bk}/refund`, { amount_paise: 99999999, reason: 'oops oops' })).status === 400);
ok('forfeiture above 10% refused', (await pm.call('POST', `/api/sales/bookings/${bk}/refund`, { amount_paise: 1, forfeited_paise: 5000000, reason: 'too greedy' })).status === 400);
const rf = await pm.call('POST', `/api/sales/bookings/${bk}/refund`, { amount_paise: 90000, forfeited_paise: 10000, reason: 'buyer loan rejected' });
ok('PM requests a refund', rf.status === 200, JSON.stringify(rf));
ok('PM cannot approve own request', (await pm.call('POST', `/api/sales/refunds/${rf.data.id}/approve`)).status === 403);
ok('payment before approval refused', (await acc.call('POST', `/api/sales/refunds/${rf.data.id}/pay`, { ref_no: 'RF1' })).status === 400);
ok('owner approves', (await o.call('POST', `/api/sales/refunds/${rf.data.id}/approve`)).status === 200);
ok('accounts pays with a reference', (await acc.call('POST', `/api/sales/refunds/${rf.data.id}/pay`, { ref_no: 'RF1' + run })).status === 200);
ok('cancelled flat is available again', (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory.find((u) => u.id === u3).status === 'available');

// --- cost sheet (Rs 1 crore)
const cs = (await o.call('POST', '/api/sales/cost-sheet', { agreed_price_paise: 1000000000, rera_carpet_sqft: 500 })).data;
ok('stamp duty 5% and metro cess 1%', cs.stamp_duty_paise === 50000000 && cs.metro_cess_paise === 10000000, JSON.stringify(cs));
ok('registration capped at Rs 30,000', cs.registration_paise === 3000000);
ok('GST 5% and total', cs.gst_paise === 50000000 && cs.total_buyer_outflow_paise === 1000000000 + 50000000 + 10000000 + 3000000 + 50000000);
ok('rate per sq ft on RERA carpet', cs.rate_per_sqft_rera_paise === 2000000);
const small = (await o.call('POST', '/api/sales/cost-sheet', { agreed_price_paise: 200000000 })).data;
ok('registration 1% below the cap', small.registration_paise === 2000000);

// --- webhook
const body = JSON.stringify({ id: 'ev-' + run, name: 'zz Portal Lead', phone: '93' + digits, project_code: 'NOPE', campaign: 'diwali' });
const ts = Math.floor(Date.now() / 1000);
const sign = (t, b) => createHmac('sha256', 'testwebhooksecret').update(`${t}.${b}`).digest('hex');
const anon = new C();
ok('unsigned webhook refused', (await anon.call('POST', '/api/webhooks/leads/magicbricks', body, false, { 'X-Timestamp': String(ts) })).status === 401);
ok('stale webhook refused', (await anon.call('POST', '/api/webhooks/leads/magicbricks', body, false, { 'X-Timestamp': String(ts - 4000), 'X-Signature': sign(ts - 4000, body) })).status === 401);
const wh = await anon.call('POST', '/api/webhooks/leads/magicbricks', body, false, { 'X-Timestamp': String(ts), 'X-Signature': sign(ts, body) });
ok('signed webhook creates an assigned lead', wh.status === 200 && wh.data.id, JSON.stringify(wh));
ok('replayed webhook is ignored', (await anon.call('POST', '/api/webhooks/leads/magicbricks', body, false, { 'X-Timestamp': String(ts), 'X-Signature': sign(ts, body) })).data.duplicate === true);

// --- KYC documents
const kyc = new FormData(); kyc.append('file', new Blob(['PAN card scan'], { type: 'text/plain' }), 'pan.txt'); kyc.append('title', 'kyc-' + run); kyc.append('category', 'kyc'); kyc.append('project_id', String(pid));
const kid = (await o.call('POST', '/api/files/upload', kyc)).data.id;
ok('site cannot download KYC', (await site.call('GET', `/api/files/download/${kid}`, null, true)).status === 403);
ok('site list hides KYC', !(await site.call('GET', `/api/documents?project_id=${pid}`)).data.documents.some((d) => d.id === kid));
ok('sales can download KYC', (await s1.call('GET', `/api/files/download/${kid}`, null, true)).status === 200);

await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
