// tests/procurement2.mjs — WP-4: indents, line quotes, GRN by line, part payments. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp4 ' + run, code: 'W4' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []);

// ---------- indents ----------
const uuid = 'ind-' + run;
const i1 = await site.call('POST', '/api/procurement/indents', { project_id: pid, client_uuid: uuid, items: [{ description: 'Cement', qty: 100, unit: 'bags' }, { description: 'Sand', qty: 5, unit: 'brass' }] });
ok('site raises an indent', i1.status === 200 && /^IND-W4/.test(i1.data.indent_no), JSON.stringify(i1));
const i1b = await site.call('POST', '/api/procurement/indents', { project_id: pid, client_uuid: uuid, items: [{ description: 'Cement', qty: 100, unit: 'bags' }] });
ok('same client_uuid never makes a second indent', i1b.data.duplicate && i1b.data.id === i1.data.id);
ok('indent needs an item with a quantity', (await site.call('POST', '/api/procurement/indents', { project_id: pid, items: [{ description: 'x', qty: 0 }] })).status === 400);
const i2 = await site.call('POST', '/api/procurement/indents', { project_id: pid, items: [{ description: 'Steel', qty: 2, unit: 't' }] });
ok('indent numbers are sequential', Number(i2.data.indent_no.slice(-4)) === Number(i1.data.indent_no.slice(-4)) + 1);
ok('site cannot approve', (await site.call('POST', `/api/procurement/indents/${i1.data.id}/approve`, {})).status === 403);
ok('PM approves', (await pm.call('POST', `/api/procurement/indents/${i1.data.id}/approve`, {})).status === 200);
ok('cannot decide twice', (await pm.call('POST', `/api/procurement/indents/${i1.data.id}/approve`, {})).status === 409);
ok('reject needs a reason', (await pm.call('POST', `/api/procurement/indents/${i2.data.id}/reject`, {})).status === 400);
ok('PM rejects with reason', (await pm.call('POST', `/api/procurement/indents/${i2.data.id}/reject`, { note: 'duplicate' })).status === 200);
ok('site cannot convert', (await site.call('POST', `/api/procurement/indents/${i1.data.id}/convert`, {})).status === 403);
const cv = await pur.call('POST', `/api/procurement/indents/${i1.data.id}/convert`, {});
ok('Purchase converts approved indent to RFQ', cv.status === 200 && cv.data.rfq_id, JSON.stringify(cv));
ok('second convert refused', (await pur.call('POST', `/api/procurement/indents/${i1.data.id}/convert`, {})).status === 409);
const rfqId = cv.data.rfq_id;
const ln = (await pur.call('GET', `/api/procurement/rfqs/${rfqId}/lines`)).data;
ok('RFQ carries the indent items', ln.items.length === 2 && ln.items[0].description === 'Cement');
ok('pending-indents report excludes converted/rejected', !(await o.call('GET', '/api/procurement/reports/pending-indents')).data.rows.some((r) => r.indent_no === i1.data.indent_no || r.indent_no === i2.data.indent_no));

// ---------- per-line quotes ----------
const mkVendor = async (n) => (await o.call('POST', '/api/procurement/vendors', { name: `zz ${n} ${run}` })).data.id;
const v1 = await mkVendor('A'), v2 = await mkVendor('B');
const [cement, sand] = ln.items;
const q1 = await pur.call('POST', `/api/procurement/rfqs/${rfqId}/line-quote`, { vendor_id: v1, rates: { [cement.id]: 40000, [sand.id]: 500000 } });
ok('quote total = sum(qty x rate), worked out by the server', q1.data.total_paise === 100 * 40000 + 5 * 500000, JSON.stringify(q1));
await pur.call('POST', `/api/procurement/rfqs/${rfqId}/line-quote`, { vendor_id: v2, rates: { [cement.id]: 38000, [sand.id]: 520000 } });
const cmp = (await pur.call('GET', `/api/procurement/rfqs/${rfqId}/lines`)).data;
ok('lowest total is flagged', cmp.quotes.length === 2 && cmp.quotes[0].lowest && !cmp.quotes[1].lowest && cmp.quotes[0].rates.length === 2);
ok('missing a rate is refused', (await pur.call('POST', `/api/procurement/rfqs/${rfqId}/line-quote`, { vendor_id: v1, rates: { [cement.id]: 1 } })).status === 400);
ok('items locked once quotes exist', (await pur.call('POST', `/api/procurement/rfqs/${rfqId}/items`, { items: [{ description: 'x', qty: 1 }] })).status === 409);

// ---------- GRN by line ----------
const po = await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, gst_bp: 1800, items: [{ description: 'Cement', qty: 100, unit: 'bags', rate_paise: 40000 }, { description: 'Sand', qty: 5, unit: 'brass', rate_paise: 500000 }] });
const sub = await pur.call('POST', `/api/procurement/pos/${po.data.id}/submit`, {}); const apr = await o.call('POST', `/api/procurement/pos/${po.data.id}/approve`, {});
const pl = (await site.call('GET', `/api/procurement/pos/${po.data.id}/lines`)).data;
ok('site sees quantities but no rates', pl.items.length === 2 && pl.items.every((i) => !('rate_paise' in i) && !('amount_paise' in i)));
const [pc, ps] = pl.items;
const gu = 'grn-' + run;
const g1 = await site.call('POST', `/api/procurement/pos/${po.data.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), client_uuid: gu, lines: [{ po_item_id: pc.id, qty_received: 90 }] });
ok('90 of 100 bags received: PO part_received', g1.status === 200 && g1.data.po_status === 'part_received', JSON.stringify(g1));
const g1b = await site.call('POST', `/api/procurement/pos/${po.data.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), client_uuid: gu, lines: [{ po_item_id: pc.id, qty_received: 90 }] });
ok('offline retry does not duplicate', g1b.data.duplicate === true);
ok('received total stays 90 after retry', (await site.call('GET', `/api/procurement/pos/${po.data.id}/lines`)).data.items.find((i) => i.id === pc.id).received === 90);
ok('item from another PO refused', (await site.call('POST', `/api/procurement/pos/${po.data.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), lines: [{ po_item_id: 99999999, qty_received: 1 }] })).status === 400);
await site.call('POST', `/api/procurement/pos/${po.data.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), lines: [{ po_item_id: pc.id, qty_received: 10 }, { po_item_id: ps.id, qty_received: 5 }] });
ok('everything received: PO received', (await o.call('GET', '/api/procurement/pos')).data.pos.find((p) => p.id === po.data.id).status === 'received');
const rep = (await o.call('GET', '/api/procurement/reports/po-vs-received')).data.rows.filter((r) => r.po_no === po.data.po_no);
ok('PO vs received report is exact', rep.length === 2 && rep.every((r) => r.received === r.ordered));

// ---------- bill part payments ----------
const bill = await o.call('POST', '/api/procurement/bills', { po_id: po.data.id, vendor_id: v1, bill_no: 'B' + run, amount_paise: 1000000, gst_paise: 152542, tds_bp: 0 });
const bid = bill.data.id;
ok('site cannot record a payment', (await site.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 100 })).status === 403);
ok('PM cannot record a payment', (await pm.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 100 })).status === 403);
const p1 = await acc.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 400000, mode: 'neft', ref_no: 'N1' });
ok('first instalment: part_paid, balance exact', p1.data.status === 'part_paid' && p1.data.balance_paise === 600000, JSON.stringify(p1));
ok('cannot overpay', (await acc.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 600001 })).status === 400);
const p2 = await acc.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 600000, ref_no: 'N2' });
ok('second instalment settles: paid, balance 0', p2.data.status === 'paid' && p2.data.balance_paise === 0, JSON.stringify(p2));
ok('paid bill takes no more', (await acc.call('POST', `/api/procurement/bills/${bid}/payments`, { amount_paise: 1 })).status === 400);
ok('reverse needs a reason', (await acc.call('POST', `/api/procurement/payments/${p2.data.id}/reverse`, {})).status === 400);
ok('reversal reopens the balance', (await acc.call('POST', `/api/procurement/payments/${p2.data.id}/reverse`, { reason: 'bounced' })).status === 200
  && (await o.call('GET', '/api/procurement/bills')).data.bills.find((b) => b.id === bid).balance_paise === 600000);
ok('cannot reverse twice', (await acc.call('POST', `/api/procurement/payments/${p2.data.id}/reverse`, { reason: 'x' })).status === 409);
const st = (await acc.call('GET', `/api/procurement/vendors/${v1}/statement`)).data;
const sb = st.bills.find((b) => b.id === bid);
ok('vendor ledger shows exact balance payable', sb.paid_paise === 400000 && sb.balance_paise === 600000 && st.payable_paise === 600000 && st.payments.length === 1, JSON.stringify(st));
ok('site cannot read the vendor ledger', (await site.call('GET', `/api/procurement/vendors/${v1}/statement`)).status === 403);
const pay = await acc.call('POST', `/api/procurement/bills/${bid}/pay`, { payment_ref: 'FULL' });
ok('legacy one-tap pay settles the balance as a payment row', pay.status === 200 && (await o.call('GET', '/api/procurement/bills')).data.bills.find((b) => b.id === bid).status === 'paid');
const fin = (await o.call('GET', `/api/reports/project-financials?project_id=${pid}`)).data;
ok('project financials count payments', JSON.stringify(fin).includes('1000000'), JSON.stringify(fin).slice(0, 300));
ok('requests without the header are refused', (await fetch(BASE + '/api/procurement/indents', { method: 'POST', headers: { cookie: o.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
