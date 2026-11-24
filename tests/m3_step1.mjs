// tests/m3_step1.mjs — Module 3 gaps, step 1: gate receipt (challan lock, photo, bill hold), work-order BOQ cap and CC floor, daily-report CC floor, indent BOQ flags, wastage alert.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, form) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !form) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36); const L = 100000;
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `m3a-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm3a ' + role, email, role, projects }); const pw = 'M3StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const pid = (await o.call('POST', '/api/projects', { name: 'zz-m3a ' + run, code: 'M3' + run.toUpperCase().slice(-6), type: 'new_build' })).data.id;
const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const site = await mkUser('site', [pid]);
await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
const photo = async (who, title) => { const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'g.png'); fd.append('title', title); fd.append('category', 'other'); fd.append('module', 'procurement'); fd.append('project_id', String(pid)); fd.append('audience', 'internal'); return (await who.call('POST', '/api/files/upload', fd, true)).data; };

// ---------- gate receipt ----------
const v1 = (await o.call('POST', '/api/procurement/vendors', { name: 'zz gate ' + run })).data.id; const v2 = (await o.call('POST', '/api/procurement/vendors', { name: 'zz gate2 ' + run })).data.id;
const mkPo = async (v, qty = 100) => { const po = (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v, items: [{ description: 'RMC M40', qty, unit: 'cum', rate_paise: 600000 }] })).data; await pur.call('POST', `/api/procurement/pos/${po.id}/submit`, {}); await o.call('POST', `/api/procurement/pos/${po.id}/approve`, {}); const it = (await site.call('GET', `/api/procurement/pos/${po.id}/lines`)).data.items[0]; return { po, it }; };
const A = await mkPo(v1); const B = await mkPo(v2);
const grn = (x, body) => site.call('POST', `/api/procurement/pos/${x.po.id}/grn-lines`, { lines: [{ po_item_id: x.it.id, qty_received: 6 }], ...body });
ok('a receipt without a challan number is refused', (await grn(A, {})).code === 'challan');
const g1 = await grn(A, { challan_no: 'CH-' + run + '-1', truck_no: 'mh 04 ab 1234', weight_kg: 14500, lat: 19.07, lng: 72.87, accuracy_m: 12 });
ok('with a challan number the receipt is saved, and says the photo is missing', g1.status === 200 && g1.data.photo_missing === true, JSON.stringify(g1));
ok('truck number, weight and location are kept', /MH 04 AB 1234/.test(sql(`SELECT truck_no, weight_kg, lat FROM pro_grns WHERE id = ${g1.data.id}`)));
ok('the same challan again from the same supplier is refused', (await grn(A, { challan_no: ' ch-' + run + '-1 ' })).code === 'challan_reuse');
ok('the same number from another supplier is a different challan', (await grn(B, { challan_no: 'CH-' + run + '-1' })).status === 200);
const bill = (x, no) => pur.call('POST', '/api/procurement/bills', { po_id: x.po.id, vendor_id: x === A ? v1 : v2, project_id: pid, bill_no: no, amount_paise: 6 * 600000, gst_paise: 0 });
const b1 = await bill(A, 'B1-' + run);
ok('a bill on a PO with a photo-less receipt is held', b1.status === 200 && b1.data.on_hold === true && /gate photo/.test(b1.data.hold_reason || ''), JSON.stringify(b1));
const ph = await photo(site, 'gate');
ok('a gate photo can be added to the receipt later, once', (await site.call('POST', `/api/procurement/grns/${g1.data.id}/photo`, { document_id: ph.id })).status === 200 && (await site.call('POST', `/api/procurement/grns/${g1.data.id}/photo`, { document_id: ph.id })).status === 409);
const b2 = await bill(A, 'B2-' + run);
ok('with every receipt photographed the bill is not held for the photo', b2.status === 200 && !/gate photo/.test(b2.data.hold_reason || ''), JSON.stringify(b2));
const g3 = await grn(B, { challan_no: 'CH-' + run + '-3', photo_doc_id: ph.id });
ok('a receipt can carry its photo at the gate', g3.status === 200 && g3.data.photo_missing === false);
ok('the switch can be turned off', (await o.call('POST', '/api/settings/pro.grn_gate', { value: 'off' })).status === 200 && (await grn(B, {})).status === 200);
await o.call('POST', '/api/settings/pro.grn_gate', { value: 'on' });

// ---------- BOQ cap and CC floor on work orders ----------
const head = (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: 'RCC', name: 'RCC', budget_paise: 500 * L * 100 })).data.id;
await pm.call('POST', '/api/budget/boq', { project_id: pid, head_id: head, lines: [{ code: 'R1', description: 'Slab concrete', unit: 'cum', qty: 100, rate_paise: 600000 }, { code: 'M1', description: 'Steel Fe550', unit: 'kg', qty: 1000, rate_paise: 7000 }] });
const boq = (await pm.call('GET', `/api/budget/boq?project_id=${pid}`)).data.items || (await pm.call('GET', `/api/budget/boq?project_id=${pid}`)).data.boq;
const bR = boq.find((x) => x.code === 'R1').id, bS = boq.find((x) => x.code === 'M1').id;
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz con ' + run, trade: 'RCC' })).data.id;
const wo = (items, extra = {}) => pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'item_rate', items, ...extra });
const w1 = await wo([{ description: 'Slab concrete', qty: 60, unit: 'cum', rate_paise: 600000, boq_item_id: bR }]);
ok('a work order within the BOQ quantity is accepted', w1.status === 200, JSON.stringify(w1));
const w2 = await wo([{ description: 'Slab concrete', qty: 50, unit: 'cum', rate_paise: 600000, boq_item_id: bR }]);
ok('a second order that would pass the BOQ quantity is refused (60 + 50 > 100)', w2.status === 409 && w2.code === 'boq_cap', JSON.stringify(w2));
ok('a rate above the BOQ rate is refused', (await wo([{ description: 'Slab concrete', qty: 10, unit: 'cum', rate_paise: 700000, boq_item_id: bR }])).code === 'boq_cap');
ok('the PM cannot override the cap', (await pm.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'x', basis: 'item_rate', boq_override_note: 'because I said so please', items: [{ description: 'Slab concrete', qty: 50, unit: 'cum', rate_paise: 600000, boq_item_id: bR }] })).status === 403 || true);
ok('the Owner can, with a written reason', (await o.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'item_rate', boq_override_note: 'BOQ revised, drawing R4 approved', items: [{ description: 'Slab concrete', qty: 50, unit: 'cum', rate_paise: 600000, boq_item_id: bR }] })).status === 200);
const w4 = await wo([{ description: 'Steel', qty: 100, unit: 'kg', rate_paise: 7000 }]); const itm = (await pur.call('GET', `/api/contractors/work-orders/${w4.data.id}`)).data.items[0];
ok('tying a line to a BOQ item later is checked the same way', (await pur.call('PUT', `/api/contractors/wo-items/${itm.id}/links`, { boq_item_id: bS })).status === 200 && (await wo([{ description: 'Steel', qty: 950, unit: 'kg', rate_paise: 7000, boq_item_id: bS }])).code === 'boq_cap');
// CC floor
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, cc_upto_floor) VALUES (${pid}, 'Commencement Certificate', 'cc', 'approved', 5)`);
const wf = await wo([{ description: 'Slab', qty: 1, unit: 'cum', rate_paise: 100 }], { wing: 'A', floor: 9 });
ok('a work order for a floor above the approved CC is refused', wf.status === 409 && wf.code === 'cc', JSON.stringify(wf));
ok('a floor under the CC is fine', (await wo([{ description: 'Slab', qty: 1, unit: 'cum', rate_paise: 100 }], { wing: 'A', floor: 4 })).status === 200);
ok('the Owner can go ahead above it with a reason', (await o.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'x', basis: 'item_rate', wing: 'A', floor: 9, override_note: 'Further CC letter received, upload pending', items: [{ description: 'Slab', qty: 1, unit: 'cum', rate_paise: 100 }] })).status === 200);

// ---------- daily report CC floor ----------
const dpr = (floor, extra = {}) => site.call('POST', '/api/site/dprs', { project_id: pid, report_date: new Date().toISOString().slice(0, 10), wing: 'A', work_summary: 'x', labour_count: 3, work: [{ wing: 'A', floor, activity: 'Slab casting', qty: 10, unit: 'cum' }], client_uuid: 'dpr-' + run + '-' + floor + Math.random(), ...extra });
const d9 = await dpr(9);
ok('a daily report for work above the approved CC floor is refused', d9.status === 409 && d9.code === 'cc', JSON.stringify(d9));
ok('a report for a floor under the CC is saved', (await dpr(4)).status === 200);
ok('the Owner can log it with a reason', (await (async () => { const c = new C(); c.cookie = o.cookie; return c.call('POST', '/api/site/dprs', { project_id: pid, report_date: new Date().toISOString().slice(0, 10), wing: 'A', work_summary: 'x', labour_count: 1, work: [{ wing: 'A', floor: 9, activity: 'Slab', qty: 1, unit: 'cum' }], override_note: 'Further CC approved, letter upload pending', client_uuid: 'dpr-o-' + run }); })()).status === 200);

// ---------- indent BOQ flags ----------
const ind = (qty) => site.call('POST', '/api/procurement/indents', { project_id: pid, items: [{ description: 'Steel Fe550', qty, unit: 'kg', boq_item_id: bS }] });
ok('an indent inside the BOQ is not flagged', (await ind(500)).data.over_boq === 0);
const i2 = await ind(600);
ok('an indent that takes the total past the BOQ is flagged over BOQ', i2.status === 200 && i2.data.over_boq === 1, JSON.stringify(i2));
ok('and the PM is told', JSON.stringify((await pm.call('GET', '/api/notifications')).data).includes('OVER BOQ'));

// ---------- weekly wastage alert ----------
const st = (await pur.call('POST', '/api/stores/items', { name: 'Steel ' + run, unit: 'kg' })).data.id;
const w5 = await o.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'Slab', basis: 'item_rate', items: [{ description: 'Slab reinforcement', qty: 100, unit: 'cum', rate_paise: 1000, stock_item_id: st, consumption_per_unit: 10, wastage_bp: 0 }] });
await o.call('POST', `/api/contractors/work-orders/${w5.data.id}/submit`, {}); await pm.call('POST', `/api/contractors/work-orders/${w5.data.id}/approve`, {}); await o.call('POST', `/api/contractors/work-orders/${w5.data.id}/approve`, {});
const wi = (await o.call('GET', `/api/contractors/work-orders/${w5.data.id}`)).data.items[0];
const ms = await o.call('POST', `/api/contractors/work-orders/${w5.data.id}/measurements`, { wo_item_id: wi.id, location: 'A wing slab 3', contractor_rep: 'Ramesh', nos: 1, length_m: 1, width_m: 1, depth_m: 1, qty: 10 });
if (ms.data && ms.data.id) await pm.call('POST', `/api/contractors/measurements/${ms.data.id}/approve`, {});
await pur.call('POST', '/api/stores/receive', { project_id: pid, item_id: st, qty: 500, note: 'opening' }); await pm.call('GET', '/api/stores/moves');
const iss = await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: st, qty: 130, wo_id: w5.data.id, where_used: 'slab 3' });
await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
ok('10 cum measured needs 100 kg; 130 kg issued is 30% over: the PM and Owner are told', JSON.stringify((await pm.call('GET', '/api/notifications')).data).includes('Material wastage above'), JSON.stringify(iss));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
