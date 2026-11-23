// tests/budget.mjs — WP-7: budget heads, committed / billed / paid, over-budget warning. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp7 ' + run, code: 'W7' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp7b ' + run, code: 'Y7' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []); const site = await mkUser('site', [pid]); const sales = await mkUser('sales', []);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const L = 100000; // Rs 1,000
await setSetting('con.enabled', 'on'); await setSetting('con.pm_approval_limit_paise', 1e12); await setSetting('po.pm_approval_limit_paise', 1e12); await setSetting('budget.gst_basis', 'exclusive');

// ---------- heads ----------
ok('purchase cannot set heads', (await pur.call('POST', '/api/budget/heads', { project_id: pid, code: 'ST', name: 'Steel', budget_paise: 5000 * L })).status === 403);
ok('site and sales cannot even view', (await site.call('GET', `/api/budget/overview?project_id=${pid}`)).status === 403 && (await sales.call('GET', `/api/budget/overview?project_id=${pid}`)).status === 403);
ok('head needs code and name', (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: '', name: 'x' })).status === 400);
const st = (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: 'st', name: 'Steel', budget_paise: 5000 * L })).data.id;   // Rs 50,00,000
ok('PM sets the Steel head (code upper-cased)', st > 0);
ok('duplicate code refused', (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: 'ST', name: 'Other', budget_paise: 1 })).status === 409);
const cem = (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: 'CE', name: 'Cement', budget_paise: 1000 * L })).data.id;
const other = (await pm.call('POST', '/api/budget/heads', { project_id: pid2, code: 'ST', name: 'Steel B', budget_paise: 100 * L })).data.id;
ok('accounts and purchase can view the heads list', (await acc.call('GET', '/api/budget/heads')).data.heads.length >= 3 && (await pur.call('GET', '/api/budget/heads')).status === 200);

// ---------- POs tagged to heads ----------
const mkVendor = async () => (await o.call('POST', '/api/procurement/vendors', { name: 'zz v ' + run })).data.id;
const v1 = await mkVendor();
const mkPo = async (rate, head, qty = 1, gst = 1800) => { const p = (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, gst_bp: gst, budget_head_id: head, items: [{ description: 'Steel TMT', qty, unit: 't', rate_paise: rate }] })); return p; };
ok('a head from another project is refused on a PO', (await mkPo(100 * L, other)).status === 400);
const po1 = (await mkPo(2000 * L, st)).data;   // Rs 20,00,000
const po2 = (await mkPo(3200 * L, st)).data;   // Rs 32,00,000 -> total 52,00,000 > 50,00,000
let ov = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data;
let r = ov.rows.find((x) => x.id === st);
ok('draft POs do not count as committed', r.committed_paise === 0 && r.level === 'ok');
await pur.call('POST', `/api/procurement/pos/${po1.id}/submit`, {});
const a1 = await o.call('POST', `/api/procurement/pos/${po1.id}/approve`, {});
ok('first PO approved: no warning', a1.status === 200 && a1.data.warnings.length === 0);
r = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data.rows.find((x) => x.id === st);
ok('committed 20,00,000 of 50,00,000 = 40%, within budget', r.committed_paise === 2000 * L && r.pct_used_bp === 4000 && r.level === 'ok' && r.balance_paise === 3000 * L, JSON.stringify(r));
await pur.call('POST', `/api/procurement/pos/${po2.id}/submit`, {});
const a2 = await o.call('POST', `/api/procurement/pos/${po2.id}/approve`, {});
ok('second PO pushes Steel over: approval still goes through, with a warning', a2.status === 200 && a2.data.warnings.length === 1 && /over budget/i.test(a2.data.warnings[0]), JSON.stringify(a2.data));
r = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data.rows.find((x) => x.id === st);
ok('variance row: 52,00,000 committed, over by 2,00,000, level over', r.committed_paise === 5200 * L && r.balance_paise === -200 * L && r.level === 'over' && r.level_text === 'Over budget' && r.pct_used_bp === 10400, JSON.stringify(r));
const notes = (await o.call('GET', '/api/notifications')).data;
ok('Owner is told once about the head', JSON.stringify(notes).includes('Over budget: ST Steel'));
const nBefore = JSON.stringify((await pm.call('GET', '/api/notifications')).data).split('Over budget: ST Steel').length;
const po3 = (await mkPo(10 * L, st)).data; await pur.call('POST', `/api/procurement/pos/${po3.id}/submit`, {}); await o.call('POST', `/api/procurement/pos/${po3.id}/approve`, {});
ok('no second notification inside a week', JSON.stringify((await pm.call('GET', '/api/notifications')).data).split('Over budget: ST Steel').length === nBefore);

// ---------- GST basis ----------
await setSetting('budget.gst_basis', 'inclusive');
r = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data.rows.find((x) => x.id === st);
ok('inclusive basis adds the 18% GST: (52,00,000 + 10,000) x 1.18', r.committed_paise === Math.round(5210 * L * 1.18), String(r.committed_paise));
await setSetting('budget.gst_basis', 'exclusive');

// ---------- bills and payments shared by head ----------
const bill = (await o.call('POST', '/api/procurement/bills', { po_id: po1.id, vendor_id: v1, bill_no: 'B' + run, amount_paise: 2360 * L, gst_paise: 360 * L })).data.id;   // Rs 23,60,000 incl 3,60,000 GST
await o.call('POST', `/api/procurement/bills/${bill}/release`, { note: 'Nothing received yet in this test; advance bill agreed' });
await acc.call('POST', `/api/procurement/bills/${bill}/payments`, { amount_paise: 1000 * L });
r = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data.rows.find((x) => x.id === st);
ok('billed excludes GST (20,00,000) and paid shows 10,00,000', r.billed_paise === 2000 * L && r.paid_paise === 1000 * L, JSON.stringify(r));

// ---------- work orders ----------
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz con ' + run })).data.id;
ok('a head from another project is refused on a work order', (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'x', value_paise: 100 * L, budget_head_id: other })).status === 400);
const lab = (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: 'LB', name: 'Labour contracts', budget_paise: 500 * L })).data.id;
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', value_paise: 600 * L, retention_bp: 500, budget_head_id: lab })).data;
await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {});
const wa = await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
ok('work order over its head: approval warns too', wa.status === 200 && wa.data.warnings.length === 1, JSON.stringify(wa.data));
const ra = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 200 * L })).data;
await pm.call('POST', `/api/contractors/ra-bills/${ra.id}/check`, {}); await o.call('POST', `/api/contractors/ra-bills/${ra.id}/approve`, {});
await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/payments`, { amount_paise: 100 * L });
const lr = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data.rows.find((x) => x.id === lab);
ok('labour head: committed 6,00,000 billed 2,00,000 paid 1,00,000 level over', lr.committed_paise === 600 * L && lr.billed_paise === 200 * L && lr.paid_paise === 100 * L && lr.level === 'over', JSON.stringify(lr));

// ---------- untagged, detail, totals, csv ----------
const po4 = (await mkPo(40 * L, null)).data; await pur.call('POST', `/api/procurement/pos/${po4.id}/submit`, {}); await o.call('POST', `/api/procurement/pos/${po4.id}/approve`, {});
ov = (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data;
ok('untagged PO shows under "not tagged"', ov.untagged.committed_paise === 40 * L, JSON.stringify(ov.untagged));
ok('cement head with nothing: within budget, 0%', ov.rows.find((x) => x.id === cem).committed_paise === 0 && ov.rows.find((x) => x.id === cem).level === 'ok');
const det = (await acc.call('GET', `/api/budget/heads/${st}/detail`)).data;
ok('head detail lists the POs behind it', det.pos.length === 3 && det.pos.every((p) => p.po_no.startsWith('PO-')) && det.work_orders.length === 0, JSON.stringify(det.pos.length));
ok('labour head detail lists the work order', (await acc.call('GET', `/api/budget/heads/${lab}/detail`)).data.work_orders[0].wo_no === wo.wo_no);
const csv = await acc.call('GET', `/api/budget/overview?project_id=${pid}&csv=1`, null, true);
const txt = await csv.text(); ok('CSV has a header and the Steel row', csv.status === 200 && txt.includes('Committed') && txt.includes('Steel'));
ok('only the Owner can delete a head: the PM is refused', (await pm.call('DELETE', `/api/budget/heads/${cem}`)).status === 403);
ok('head with tagged orders cannot be removed', (await o.call('DELETE', `/api/budget/heads/${st}`)).status === 409);
ok('empty head can be removed by the Owner', (await o.call('DELETE', `/api/budget/heads/${cem}`)).status === 200);
ok('budget can be changed and is audited', (await pm.call('PUT', `/api/budget/heads/${st}`, { budget_paise: 6000 * L })).status === 200 && (await pm.call('GET', `/api/budget/overview?project_id=${pid}`)).data.rows.find((x) => x.id === st).level === 'ok');
ok('accounts cannot change a budget', (await acc.call('PUT', `/api/budget/heads/${st}`, { budget_paise: 1 })).status === 403);
ok('another project is not visible when picking its overview as site-only user', (await site.call('GET', `/api/budget/overview?project_id=${pid2}`)).status === 403);
ok('requests without the header are refused', (await fetch(BASE + '/api/budget/heads', { method: 'POST', headers: { cookie: pm.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
