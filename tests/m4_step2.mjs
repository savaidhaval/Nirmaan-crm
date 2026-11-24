// tests/m4_step2.mjs — Module 4, step 2: letter templates and data, sent marks by hand, cancellation refund waterfall, refund due date, waiver PIN.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, form) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !form) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' }); await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });
let seq = 0;
const mkUser = async (role) => { const email = `m4b-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm4b ' + role, email, role, projects: [] }); const pw = 'M4StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m4b ' + run, code: 'MF' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm'); const acc = await mkUser('accounts'); const sales = await mkUser('sales'); const site = await mkUser('site');
await o.call('POST', '/api/redev/approval-pin', { pin: '482913', password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'On booking', pct_bp: 1000 }, { stage_name: 'Plinth', pct_bp: 3000 }, { stage_name: 'Possession', pct_bp: 6000 }] });
const stages = (await o.call('GET', `/api/sales/letter-templates?project_id=${pid}`)).data.stages;
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 14, unit_no: '1401', rera_carpet_sqft: 500, price_paise: 3850000000 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Rakesh Mehta', phone: '9820012345', address: 'Dadar West, Mumbai', agreed_price_paise: 3850000000, token_paise: 385000000 })).data.id;
const dems = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands;

// ---------- letters ----------
const L0 = await acc.call('GET', `/api/sales/demands/${dems[0].id}/letter`);
ok('a demand letter has every customer field filled', L0.status === 200 && L0.data.fields.customer_name === 'Rakesh Mehta' && L0.data.fields.flat_no === 'A-1401' && /MF/.test(L0.data.fields.project === undefined ? '' : 'MF') && L0.data.fields.rera_no === 'P518000TEST', JSON.stringify(L0.data && L0.data.fields));
ok('the figures are formatted for India and written in words', /3,85,00,000/.test(L0.data.fields.agreement_value) && /Three Crore Eighty Five Lakh Rupees Only/.test(L0.data.fields.agreement_value_words), L0.data.fields.agreement_value_words);
ok('the demand gets its number', /^DL-/.test(L0.data.fields.demand_no), L0.data.fields.demand_no);
ok('the built-in wording is used until the project writes its own', L0.data.template.source === 'built-in' && /\{\{customer_name\}\}/.test(L0.data.template.body));
sql(`UPDATE sal_demands SET status = 'scheduled' WHERE id = ${dems[2].id}`);
ok('a demand that is not ready has no letter', (await acc.call('GET', `/api/sales/demands/${dems[2].id}/letter`)).status === 409);
ok('sales and site: site is refused', (await site.call('GET', `/api/sales/demands/${dems[0].id}/letter`)).status === 403);
ok('only the Owner, PM or Accounts can write templates', (await sales.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'demand', body: 'x' })).status === 403);
ok('a template needs text or a Word file', (await acc.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'demand', body: '' })).status === 400);
ok('the general demand letter can be replaced', (await acc.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'demand', body: 'GENERAL {{customer_name}} {{total_due}}' })).status === 200);
ok('a stage can have its own wording', (await acc.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'demand', stage_id: stages[1].id, body: 'PLINTH {{customer_name}}' })).status === 200);
const Lg = await acc.call('GET', `/api/sales/demands/${dems[0].id}/letter`);
ok('a stage with no wording of its own uses the general letter', Lg.data.template.body.startsWith('GENERAL') && Lg.data.template.source === 'project');
sql(`UPDATE sal_demands SET status = 'ready', due_date = date('now', '+7 days') WHERE id = ${dems[1].id}`);
const Lp = await acc.call('GET', `/api/sales/demands/${dems[1].id}/letter`);
ok('a stage with its own wording uses it', Lp.status === 200 && Lp.data.template.body.startsWith('PLINTH') && Lp.data.template.source === 'stage', JSON.stringify(Lp.data && Lp.data.template));
ok('the old wording can be brought back', (await acc.call('DELETE', `/api/sales/letter-templates/${(await acc.call('GET', `/api/sales/letter-templates?project_id=${pid}`)).data.templates.find((t) => t.stage_id === stages[1].id).id}`)).status === 200 && (await acc.call('GET', `/api/sales/demands/${dems[1].id}/letter`)).data.template.body.startsWith('GENERAL'));
const A = await acc.call('GET', `/api/sales/bookings/${bk}/allotment-letter`);
ok('the allotment letter carries the flat, value and payment schedule', A.status === 200 && A.data.fields.flat_no === 'A-1401' && /1\. On booking: 10%/.test(A.data.fields.payment_schedule) && A.data.template.source === 'built-in', JSON.stringify(A.data && A.data.fields.payment_schedule));

// ---------- sent marks ----------
ok('a demand letter is not marked sent until someone says so', L0.data.sent_at === null || L0.data.sent_at === undefined);
ok('Accounts mark it sent by hand', (await acc.call('POST', `/api/sales/demands/${dems[0].id}/mark-sent`, { via: 'whatsapp' })).status === 200 && (await acc.call('GET', `/api/sales/demands/${dems[0].id}/letter`)).data.sent_via === 'whatsapp');
ok('and can take the mark back', (await acc.call('POST', `/api/sales/demands/${dems[0].id}/mark-sent`, { sent: false })).status === 200 && !(await acc.call('GET', `/api/sales/demands/${dems[0].id}/letter`)).data.sent_at);
ok('the allotment letter has its own sent mark', (await acc.call('POST', `/api/sales/bookings/${bk}/allotment-sent`, { via: 'email' })).status === 200 && !!(await acc.call('GET', `/api/sales/bookings/${bk}/allotment-letter`)).data.sent_at);
ok('site cannot mark letters sent', (await site.call('POST', `/api/sales/demands/${dems[0].id}/mark-sent`, {})).status === 403);

// ---------- cancellation waterfall ----------
const rc = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 1000000000, mode: 'neft', ref_no: 'W' + run, demand_id: dems[1].id });
// brokerage paid on this booking
const part = (await o.call('POST', '/api/sales/partners', { firm: 'zz brk ' + run, brokerage_default_bp: 100 })).data.id;
sql(`UPDATE sal_bookings SET channel_partner_id = ${part} WHERE id = ${bk}`);
sql(`UPDATE sal_partners SET kyc_status = 'approved', rera_no = 'A1', rera_valid_till = '2099-01-01', pan_last4 = '1234' WHERE id = ${part}`);
await o.call('POST', `/api/sales/partners/${part}/payments`, { amount_paise: 1500000, booking_id: bk });
ok('a booking that is not cancelled still shows the waterfall (for planning)', (await acc.call('GET', `/api/sales/bookings/${bk}/cancel-waterfall`)).status === 200);
await o.call('POST', `/api/sales/bookings/${bk}/cancel`, { reason: 'buyer withdrew from the purchase' });
const W = (await acc.call('GET', `/api/sales/bookings/${bk}/cancel-waterfall`)).data;
ok('paid, the 10% limit, brokerage and balance add up', W.paid_paise === 1000000000 && W.max_keep_paise === 385000000 && W.brokerage_deducted_paise === 1500000 && W.forfeit_paise + W.brokerage_deducted_paise + W.admin_deducted_paise === 385000000 && W.refund_paise === 1000000000 - 385000000, JSON.stringify(W));
ok('the refund is due 45 days after the cancellation', W.refund_days === 45 && W.refund_due_on > new Date().toISOString().slice(0, 10), JSON.stringify(W.refund_due_on));
const W2 = (await acc.call('GET', `/api/sales/bookings/${bk}/cancel-waterfall?brokerage=0&admin_paise=500000`)).data;
ok('Accounts can leave out brokerage or add an admin charge and see the change', W2.brokerage_deducted_paise === 0 && W2.admin_deducted_paise === 500000 && W2.forfeit_paise + W2.admin_deducted_paise === 385000000, JSON.stringify(W2));
ok('sales cannot see the waterfall', (await sales.call('GET', `/api/sales/bookings/${bk}/cancel-waterfall`)).status === 403);
const rf = await pm.call('POST', `/api/sales/bookings/${bk}/refund`, { amount_paise: W.refund_paise, forfeited_paise: W.max_keep_paise, reason: 'cancellation per waterfall' });
ok('the refund request keeps its due date', rf.status === 200 && /\d{4}-\d{2}-\d{2}/.test(sql(`SELECT refund_due_on FROM sal_refunds WHERE id = ${rf.data.id}`)));
ok('keeping more than 10% is still refused', (await pm.call('POST', `/api/sales/bookings/${bk}/refund`, { amount_paise: 100, forfeited_paise: 385000001, reason: 'too much to keep' })).status === 400);

// ---------- waiver PIN ----------
const b2 = (await o.call('POST', '/api/sales/bookings', { unit_id: (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'B', floor: 2, unit_no: '201', rera_carpet_sqft: 400, price_paise: 100000000 })).data.id, customer_name: 'Late Payer', agreed_price_paise: 100000000, token_paise: 1000000 })).data.id;
const d2 = (await o.call('GET', `/api/sales/bookings/${b2}`)).data.demands[1];
sql(`UPDATE sal_demands SET status = 'ready', due_date = date('now', '-60 days') WHERE id = ${d2.id}`);
const w0 = await o.call('POST', `/api/sales/demands/${d2.id}/interest-waiver`, { reason: 'goodwill gesture here', amount_paise: 1000 });
ok('even the Owner needs the approval PIN to waive interest', w0.code === 'pin_required', JSON.stringify(w0));
ok('a wrong PIN is refused', (await o.call('POST', `/api/sales/demands/${d2.id}/interest-waiver`, { reason: 'goodwill gesture here', amount_paise: 1000, pin: '111222' })).status === 400);
ok('with the PIN the waiver goes through', (await o.call('POST', `/api/sales/demands/${d2.id}/interest-waiver`, { reason: 'goodwill gesture here', amount_paise: 1000, pin: '482913' })).status === 200);
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
