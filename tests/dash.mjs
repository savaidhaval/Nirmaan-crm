// tests/dash.mjs — WP-20: dashboard drill-down lines and the CSV reports pack. Same env vars as security.mjs.
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
const L = 10000000, iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-dx ' + run, code: 'DX' + run.toUpperCase().slice(-6), type: 'redevelopment', budget_paise: 500000000 })).data.id;
const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []); const site = await mkUser('site', [pid]); const pur = await mkUser('purchase', []); const viewer = await mkUser('viewer', []);
await o.call('POST', '/api/settings/con.enabled', { value: 'on' }); await o.call('POST', '/api/settings/con.pm_approval_limit_paise', { value: 50000000 });
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });
const extras = async (who) => (await who.call('GET', '/api/dashboard/extras'));
const lines = (r) => (r.data.groups || []).flatMap((g) => g.lines.map((l) => ({ tile: g.tile, ...l })));
const find = (r, text) => lines(r).find((l) => l.label.includes(text));

// ============ a society below its threshold, a bank guarantee, overdue rent ============
const soc = (await pm.call('POST', '/api/redev/societies', { project_id: pid, name: 'Dash Society ' + run, consent_threshold_pct: 51 })).data.id;
await pm.call('POST', `/api/redev/societies/${soc}/members/import`, { rows: [1, 2, 3, 4].map((i) => ({ wing: 'A', unit_label: String(i), member_name: 'M' + i, carpet_sqft: 400 })) });
const mem = (await pm.call('GET', `/api/redev/societies/${soc}/members`)).data.members; await pm.call('POST', `/api/redev/members/${mem[0].id}/consent`, { status: 'consented' });
await acc.call('POST', `/api/redev/members/${mem[1].id}/transit-term`, { monthly_rent_paise: 2500000, start_date: new Date(Date.now() + 19800000 - 100 * 86400000).toISOString().slice(0, 7) + '-01', bg_ref: 'BG1', bg_amount_paise: 100000, bg_expiry: iso(10) });
// ============ a receipt waiting for approval and a RERA gap ============
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
const unit = async (n, price) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'D', floor: n, unit_no: 'DX' + n + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: price })).data.id;
const bk1 = (await o.call('POST', '/api/sales/bookings', { unit_id: await unit(1, 100000000), customer_name: 'Dash Buyer ' + run, phone: '9788000111', agreed_price_paise: 100000000, token_paise: 0 })).data.id;
const dem = (await o.call('GET', `/api/sales/bookings/${bk1}`)).data.demands[0].id;
await acc.call('POST', `/api/sales/bookings/${bk1}/receipts`, { amount_paise: 20000000, mode: 'neft', ref_no: 'DX1' + run, demand_id: dem, received_on: iso(0) });
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 1000000 });
await acc.call('POST', `/api/sales/bookings/${bk1}/receipts`, { amount_paise: 3000000, mode: 'neft', ref_no: 'DX2' + run, demand_id: dem, received_on: iso(0) });
// a discounted booking (Owner may give any discount with a reason)
const bk2 = await o.call('POST', '/api/sales/bookings', { unit_id: await unit(2, 100000000), customer_name: 'Discount Buyer ' + run, phone: '9788000222', agreed_price_paise: 94000000, discount_reason: 'Early payment offer', token_paise: 0 });
// ============ a contractor: a bill waiting for approval, then one approved ============
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'Dash Civil ' + run, trade: 'civil', pan: 'ABCDE1234F' })).data.id;
const head = (await o.call('POST', '/api/budget/heads', { project_id: pid, code: 'RC', name: 'RCC work', budget_paise: 1 * L })).data.id;
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'lump_sum', value_paise: 10 * L, retention_bp: 500, advance_paise: 0, budget_head_id: head })).data;
await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
const ra1 = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 2 * L })).data;
const ra2 = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 3 * L })).data;
await pm.call('POST', `/api/contractors/ra-bills/${ra1.id}/check`, {}); await o.call('POST', `/api/contractors/ra-bills/${ra1.id}/approve`, {});
await acc.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: 1 * L, mode: 'neft', ref_no: 'DXP' + run, paid_on: iso(0) });

// ============ access ============
const rOwner = await extras(o), rPm = await extras(pm);
ok('Owner and PM can read the dashboard lines; HR/Sales/Site get an empty list, not an error', rOwner.status === 200 && rPm.status === 200 && (await extras(site)).status === 200 && lines(await extras(sales)).length === 0 && lines(await extras(site)).length === 0);
// ============ the lines ============
let l = find(rOwner, 'below the consent threshold'); ok('Approvals: societies below their threshold are counted and the lowest is named with its percentage', l && l.tile === 'Approvals' && /societies are below the consent threshold \(lowest: .+, [0-9.]+%\)/.test(l.label), JSON.stringify(l));
l = find(rOwner, 'Bank guarantees expiring'); ok('Approvals: bank guarantees expiring within 30 days', l && Number(l.value) >= 1);
l = find(rOwner, 'Transit rent overdue'); ok('Money in: overdue transit rent with the rupee amount', l && l.tile === 'Money in' && /₹/.test(l.value) && l.route === 'redevelopment', JSON.stringify(l));
l = find(rOwner, 'waiting for a second person'); ok('Money in: receipts waiting for approval, count and amount', l && Number(l.value.split(' ')[0]) >= 1 && /₹/.test(l.value), JSON.stringify(l));
l = find(rOwner, 'Still to deposit in the RERA'); ok('Money in: the RERA deposit gap', l && /₹/.test(l.value), JSON.stringify(l));
l = find(rOwner, 'Contractor bills waiting'); ok('Money out: contractor bills waiting for approval (1 of mine, ₹3,00,000 net less retention)', l && l.tile === 'Money out' && Number(l.value.split(' ')[0]) >= 1, JSON.stringify(l));
l = find(rOwner, 'Retention being held'); ok('Money out: retention held (5% of the approved bill, ₹10,000)', l && /₹/.test(l.value), JSON.stringify(l));
ok('the lines link to the screen that lists them', lines(rOwner).every((x) => !!x.route));
const rAcc = await extras(acc); ok('Accounts sees the money lines but not the society consent line', !!find(rAcc, 'Transit rent overdue') && !find(rAcc, 'below the consent threshold'));
ok('the PM sees the same society line', !!find(rPm, 'below the consent threshold'));
ok('the CA (viewer) sees the compliance line only, no money lines', !!find(await extras(viewer), 'below the consent threshold') && !find(await extras(viewer), 'Transit rent overdue'));

// ============ budget over: filled in by the hourly sweep, one project per tick ============
let got = null;
if (process.env.D1_PERSIST_TO) {
  for (let i = 0; i < 14 && !got; i++) { await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1500)); got = find(await extras(o), 'Budget heads over their budget'); if (got && !got.label.includes('RCC work')) got = null; }
  ok('Money out: the budget line names the head that is over (read from the sweep snapshot)', !!got && got.tone === 'bad', JSON.stringify(got));
} else console.log('SKIP  budget snapshot test');

// ============ reports pack (CSV) ============
const csv = async (who, kind) => { const r = await who.call('GET', `/api/reports/pack/${kind}`, null, true); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') }; };
ok('Sales, Site and Purchase cannot download the pack', (await csv(sales, 'collections_by_month')).status === 403 && (await csv(site, 'stock_on_hand')).status === 403 && (await csv(pur, 'stock_on_hand')).status === 403);
ok('an unknown report is refused', (await csv(o, 'nope')).status === 404);
const led = await csv(acc, 'contractor_ledger'); ok('contractor ledger: the bill and the payment of this contractor, amounts to the paisa', led.status === 200 && /csv/.test(led.type) && led.text.includes('Dash Civil ' + run) && led.text.includes('Running bill 1') && led.text.includes('190000.00') && led.text.includes('100000.00'), led.text.slice(0, 300));
const wos = await csv(o, 'wo_summary'); ok('work orders: value 10,00,000, billed 2,00,000 (approved), retention 10,000, paid 1,00,000', wos.text.includes(wo.wo_no) && wos.text.includes('1000000.00') && wos.text.includes('200000.00') && wos.text.includes('10000.00'), wos.text.split('\n').find((x) => x.includes(wo.wo_no)));
const col = await csv(pm, 'collections_by_month'); ok('collections by month: this month, this project, ₹2,00,000 received', col.text.includes(iso(0).slice(0, 7)) && col.text.includes('zz-dx ' + run) && col.text.includes('200000.00'), col.text.slice(0, 250));
const dis = await csv(o, 'discount_register'); ok('discount register: the discounted booking with list, agreed, difference and reason', bk2.status === 200 ? (dis.text.includes('Discount Buyer ' + run) && dis.text.includes('1000000.00') && dis.text.includes('940000.00') && dis.text.includes('60000.00') && dis.text.includes('Early payment offer')) : true, dis.text.slice(0, 300));
const stk = await csv(acc, 'stock_on_hand'); ok('stock on hand downloads (header at least)', stk.status === 200 && stk.text.includes('Reorder level'));
ok('the list of reports is available to the screen', (await acc.call('GET', '/api/reports/pack')).data.reports.length === 5 && (await sales.call('GET', '/api/reports/pack')).status === 403);
ok('the contractor reports say so when the Contractors module is off', await (async () => { await o.call('POST', '/api/settings/con.enabled', { value: 'off' }); const r = await csv(o, 'wo_summary'); const e = await extras(o); await o.call('POST', '/api/settings/con.enabled', { value: 'on' }); return r.status === 409 && !find(e, 'Contractor bills waiting') && e.status === 200; })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
