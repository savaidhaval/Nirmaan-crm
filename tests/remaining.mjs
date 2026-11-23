// tests/remaining.mjs — wing hold, baseline and date changes, PAAA and vacating, drawing links, debit notes, material check, BOQ, voice notes.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b instanceof FormData) body = b; else if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zr-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zr ' + role + seq, email, role, projects }); const pw = 'ZrStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const L = 100000;
await o.call('POST', '/api/settings/con.enabled', { value: 'on' }); await o.call('POST', '/api/settings/con.pm_approval_limit_paise', { value: 1e12 });

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-rm ' + run, code: 'RM' + run.toUpperCase().slice(-6), type: 'redevelopment' })).data.id;
const pm = await mkUser('pm', []); const pm2 = await mkUser('pm', []); const site = await mkUser('site', [pid]); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []);
await o.call('POST', '/api/approvals/load-template', { project_id: pid, redevelopment: true });
const items = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === pid); const g = (k) => items.find((a) => a.gate_key === k).id;
for (const [k, extra] of [['iod', {}], ['cc', { cc_upto_floor: 20 }], ['rera_reg', {}]]) { await o.call('POST', `/api/approvals/${g(k)}/event`, { event: 'applied' }); await o.call('POST', `/api/approvals/${g(k)}/event`, { event: 'approved', letter_no: k.toUpperCase() + '/1', letter_date: iso(-30), ...extra }); }

// ============ wing hold ============
const unitB = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'B', floor: 4, unit_no: 'B4' + run.slice(-3), type: '2BHK', price_paise: 10000000 })).data.id;
ok('only the PM or Owner can put a wing on hold', (await site.call('POST', `/api/projects/${pid}/holds`, { wing: 'B', reason: 'x' })).status === 403);
ok('a hold needs a reason', (await pm.call('POST', `/api/projects/${pid}/holds`, { wing: 'B' })).status === 400);
const hold = await pm.call('POST', `/api/projects/${pid}/holds`, { wing: 'B', reason: 'Redesign of floors 4-8' });
ok('the PM puts wing B on hold', hold.status === 200);
ok('it cannot be put on hold twice', (await pm.call('POST', `/api/projects/${pid}/holds`, { wing: 'B', reason: 'again' })).status === 409);
const bk = await o.call('POST', '/api/sales/bookings', { unit_id: unitB, customer_name: 'Hold test ' + run, phone: '98' + String(Date.now()).slice(-8), token_paise: 100000 });
ok('a flat in the held wing cannot be booked', bk.status === 409 && bk.code === 'hold' && /Redesign/.test(bk.err));
await pm.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab 4 B ' + run, wing: 'B', floor: 4, planned_date: iso(10) });
const msB = (await pm.call('GET', '/api/site/milestones')).data.milestones.find((m) => m.name === 'Slab 4 B ' + run);
ok('a milestone in the held wing cannot be certified', (await pm.call('POST', `/api/site/milestones/${msB.id}/certify`, { actual_date: iso(0), cert_ref: 'A/1' })).code === 'hold');
const meta = (await site.call('GET', '/api/qa/meta')).data; const all = Object.fromEntries(meta.checklist.map((c) => [c, true]));
const pB = (await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', wing: 'B', floor: 4, grade: 'M25', qty_cum: 10, checklist: all })).data.id;
ok('a pour in the held wing cannot be approved', (await pm.call('POST', `/api/qa/pours/${pB}/approve`, {})).code === 'hold');
ok('the hold shows on the project', (await pm.call('GET', `/api/projects/${pid}/overview`)).data.holds.length === 1);
ok('release needs a reason', (await pm.call('POST', `/api/holds/${hold.data.id}/release`, {})).status === 400);
ok('after release the flat can be booked', (await pm.call('POST', `/api/holds/${hold.data.id}/release`, { note: 'Revised drawings issued' })).status === 200
  && (await o.call('POST', '/api/sales/bookings', { unit_id: unitB, customer_name: 'Hold test ' + run, phone: '98' + String(Date.now()).slice(-8), token_paise: 100000 })).status === 200);

// ============ baseline and date changes ============
const fixed = await pm.call('POST', `/api/projects/${pid}/baseline`);
ok('the PM fixes the expected dates as the baseline', fixed.status === 200 && fixed.data.fixed >= 1);
ok('a date change needs a reason from the list', (await pm.call('POST', `/api/site/milestones/${msB.id}/reschedule`, { planned_date: iso(40) })).status === 400);
ok('site cannot change dates', (await site.call('POST', `/api/site/milestones/${msB.id}/reschedule`, { planned_date: iso(40), reason: 'monsoon' })).status === 403);
ok('the PM moves it 30 days for the monsoon', (await pm.call('POST', `/api/site/milestones/${msB.id}/reschedule`, { planned_date: iso(40), reason: 'monsoon', note: 'Heavy rain July' })).status === 200);
const ms2 = (await pm.call('GET', '/api/site/milestones')).data.milestones.find((m) => m.id === msB.id);
ok('the baseline stays; the expected date moves', ms2.baseline_date === iso(10) && ms2.planned_date === iso(40));
const hist = (await pm.call('GET', `/api/site/milestones/${msB.id}/changes`)).data.changes;
ok('the change is kept with its reason', hist.length === 1 && hist[0].reason === 'monsoon' && hist[0].old_date === iso(10));

// ============ PAAA and vacating ============
const soc = (await o.call('POST', '/api/redev/societies', { project_id: pid, name: 'CHS ' + run })).data.id;
const m1 = (await o.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Asha', unit_label: '1' })).data.id;
const m2 = (await o.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Bala', unit_label: '2' })).data.id;
ok('vacating needs the registered PAAA first', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { vacated_on: iso(-20) })).status === 400);
ok('transit rent cannot start before vacating', (await o.call('POST', `/api/redev/members/${m1}/transit-term`, { monthly_rent_paise: 2500000, start_date: iso(-20).slice(0, 8) + '01' })).status === 409);
ok('PAAA registered and flat vacated', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { paaa_reg_no: 'BDR-1/2026/55', paaa_reg_date: iso(-30), vacated_on: iso(-20), keys_received: true, utilities_disconnected: true })).status === 200);
const before = new Date(Date.parse(iso(-20)) - 40 * 86400000).toISOString().slice(0, 8) + '01';
ok('rent cannot start before the month of vacating', (await o.call('POST', `/api/redev/members/${m1}/transit-term`, { monthly_rent_paise: 2500000, start_date: before })).status === 400);
ok('rent starts from the month of vacating', (await o.call('POST', `/api/redev/members/${m1}/transit-term`, { monthly_rent_paise: 2500000, start_date: iso(-20).slice(0, 8) + '01' })).status === 200);
const vac = (await pm.call('GET', `/api/redev/societies/${soc}/vacating`)).data;
ok('the society shows 1 of 2 vacated, not ready for demolition', vac.total === 2 && vac.vacated === 1 && vac.paaa === 1 && vac.ready_for_demolition === false);
await pm.call('POST', '/api/site/milestones', { project_id: pid, name: 'Demolition of old building ' + run, planned_date: iso(5) });
const demo = (await pm.call('GET', '/api/site/milestones')).data.milestones.find((m) => m.name === 'Demolition of old building ' + run);
ok('demolition cannot be certified while a member has not vacated', (await pm.call('POST', `/api/site/milestones/${demo.id}/certify`, { actual_date: iso(0), cert_ref: 'D/1' })).code === 'vacate');
await pm.call('PUT', `/api/redev/members/${m2}/vacate`, { paaa_reg_no: 'BDR-1/2026/56', paaa_reg_date: iso(-30), vacated_on: iso(-10), keys_received: true, utilities_disconnected: true });
ok('when all have vacated, demolition is certified', (await pm.call('POST', `/api/site/milestones/${demo.id}/certify`, { actual_date: iso(0), cert_ref: 'D/1' })).status === 200 && (await pm.call('GET', `/api/redev/societies/${soc}/vacating`)).data.ready_for_demolition === true);

// ============ drawing links ============
const dr = (await pm.call('POST', '/api/drawings', { project_id: pid, code: 'S-' + run.slice(-4), title: 'Slab 5 reinforcement', discipline: 'structural' })).data.id;
const draftPour = await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', wing: 'A', floor: 5, grade: 'M25', qty_cum: 40, drawing_id: dr, checklist: all });
ok('no pour card from a drawing with no issued-for-construction revision', draftPour.status === 409 && draftPour.code === 'drawing');
await pm.call('POST', `/api/drawings/${dr}/revisions`, { status: 'ifc' });
const pc = (await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', wing: 'A', floor: 5, grade: 'M25', qty_cum: 40, drawing_id: dr, checklist: all })).data.id;
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zr civil ' + run, trade: 'civil' })).data.id;
const stk = (await pur.call('POST', '/api/stores/items', { name: 'Cement ' + run, unit: 'bags' })).data.id;
const head = (await o.call('POST', '/api/budget/heads', { project_id: pid, code: 'RCC' + run.slice(-3), name: 'RCC frame', budget_paise: 500000000 })).data.id;
const boqAdd = await pm.call('POST', '/api/budget/boq', { project_id: pid, head_id: head, lines: [{ code: 'C-01', description: 'RCC M25 slabs', unit: 'cum', qty: 100, rate_paise: 7200 * 100 }, { code: 'C-02', description: 'Cement for slabs', unit: 'bags', qty: 700, rate_paise: 400 * 100 }] });
ok('BOQ lines are added in one go', boqAdd.status === 200 && boqAdd.data.added === 2);
const boq = (await pm.call('GET', `/api/budget/boq?project_id=${pid}`)).data.items; const bRcc = boq.find((b) => b.code === 'C-01'), bCem = boq.find((b) => b.code === 'C-02');
ok('a BOQ line needs a quantity and a rate', (await pm.call('POST', '/api/budget/boq', { project_id: pid, head_id: head, description: 'x' })).status === 400);
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'item_rate', retention_bp: 0, items: [{ description: 'RCC M25 slab', qty: 60, unit: 'cum', rate_paise: 5000 * 100, boq_item_id: bRcc.id, drawing_id: dr, stock_item_id: stk, consumption_per_unit: 6.5, wastage_bp: 200 }] })).data;
ok('a work-order item stores its BOQ item, drawing and material use', wo && wo.id);
await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); await pm.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
await pm.call('POST', `/api/drawings/${dr}/revisions`, { status: 'ifc' });
ok('a new revision tells Purchase which work orders to check', JSON.stringify((await pur.call('GET', '/api/notifications')).data).includes(wo.wo_no));
const old = await pm.call('POST', `/api/qa/pours/${pc}/approve`, {});
ok('a pour card made on the old revision cannot be approved', old.status === 409 && old.code === 'drawing' && /revised/.test(old.err), JSON.stringify(old));

// ============ material check and debit notes ============
const item = (await o.call('GET', `/api/contractors/work-orders/${wo.id}`)).data.items[0];
const me = (await site.call('POST', `/api/contractors/work-orders/${wo.id}/measurements`, { wo_item_id: item.id, location: 'A slab 5', qty: 10, contractor_rep: 'Supervisor' })).data.id;
await pm.call('POST', `/api/contractors/measurements/${me}/approve`, {});
await pur.call('POST', '/api/stores/receive', { project_id: pid, item_id: stk, qty: 500, note: 'Opening stock' });
ok('store issue to a work order of another project is refused', (await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: stk, qty: 1, wo_id: 99999999 })).status === 400);
await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: stk, qty: 70, wo_id: wo.id, where_used: 'Slab 5' });
const rec = (await pm.call('GET', `/api/contractors/work-orders/${wo.id}/reconciliation`)).data.rows.find((r) => r.stock_item_id === stk);
ok('material check: 10 cum x 6.5 = 65 bags should be used, 66.3 allowed with 2%, 70 issued → 3.7 excess', rec && rec.issued === 70 && rec.theoretical === 65 && rec.allowed === 66.3 && rec.excess === 3.7, JSON.stringify(rec));
ok('a debit note needs a reason from the list', (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/debit-notes`, { description: 'x', amount_paise: 100 })).status === 400);
const dn = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/debit-notes`, { reason: 'excess_material', description: 'Excess cement beyond 2% wastage', qty: 3.7, unit: 'bags', rate_paise: 40000 });
ok('the debit note is priced: 3.7 x Rs 400 = Rs 1,480', dn.status === 200 && dn.data.amount_paise === 148000);
ok('the maker cannot approve it', (await pur.call('POST', `/api/contractors/debit-notes/${dn.data.id}/approve`, {})).status === 403);
await pm.call('POST', `/api/contractors/debit-notes/${dn.data.id}/approve`, {});
const ra = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 10 }] });
ok('the next RA bill deducts the approved debit note by itself', ra.status === 200 && ra.data.debit_notes_paise === 148000 && ra.data.net_paise === 10 * 500000 - 148000, JSON.stringify(ra));
ok('the debit note shows as recovered on that bill', (await pm.call('GET', `/api/contractors/work-orders/${wo.id}/debit-notes`)).data.debit_notes[0].status === 'recovered');
await pm.call('POST', `/api/contractors/ra-bills/${ra.data.id}/cancel`, { reason: 'redo' });
ok('cancelling the bill puts the debit note back for the next one', (await pm.call('GET', `/api/contractors/work-orders/${wo.id}/debit-notes`)).data.debit_notes[0].status === 'approved');

// ============ BOQ report ============
const v1 = (await pur.call('POST', '/api/procurement/vendors', { name: 'zr cement ' + run })).data.id;
const po = (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, items: [{ description: 'Cement OPC 53', qty: 300, unit: 'bags', rate_paise: 40000, boq_item_id: bCem.id }] })).data.id;
await pur.call('POST', `/api/procurement/pos/${po}/submit`); await o.call('POST', `/api/procurement/pos/${po}/approve`);
ok('a PO line with a BOQ item of another project is refused', (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, items: [{ description: 'x', qty: 1, rate_paise: 1, boq_item_id: 99999999 }] })).status === 400);
const rep = (await pm.call('GET', `/api/budget/boq?project_id=${pid}`)).data.items;
const rRcc = rep.find((b) => b.code === 'C-01'), rCem = rep.find((b) => b.code === 'C-02');
ok('BOQ report: RCC 60 of 100 committed, 10 measured; cement 300 of 700 ordered', rRcc.committed_qty === 60 && rRcc.measured_qty === 10 && rCem.committed_qty === 300 && !rRcc.over_qty, JSON.stringify([rRcc, rCem]));
ok('changing a BOQ quantity needs a reason', (await pm.call('PUT', `/api/budget/boq/${bRcc.id}`, { qty: 50 })).status === 400);
await pm.call('PUT', `/api/budget/boq/${bRcc.id}`, { qty: 50, reason: 'Slab area reduced in R2' });
ok('when the BOQ drops below what is committed it shows as over', (await pm.call('GET', `/api/budget/boq?project_id=${pid}`)).data.items.find((b) => b.code === 'C-01').over_qty === true);
ok('a BOQ item in use cannot be deleted', (await o.call('DELETE', `/api/budget/boq/${bRcc.id}`)).status === 409);
const csv = await pm.call('GET', `/api/budget/boq?project_id=${pid}&csv=1`, null, true);
ok('the BOQ downloads for Excel', csv.status === 200 && (await csv.text()).includes('RCC M25 slabs'));

// ============ voice notes ============
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0, 0, 0, 0, 0, 0, 0]);
const fd = new FormData(); fd.append('file', new Blob([webm], { type: 'audio/webm' }), 'voice.webm'); fd.append('title', 'Voice ' + run); fd.append('project_id', String(pid)); fd.append('module', 'site'); fd.append('category', 'photo');
const up = await site.call('POST', '/api/files/upload', fd);
ok('a voice note (audio/webm) uploads from the site phone', up.status === 200, JSON.stringify(up));
const meta2 = (await site.call('GET', `/api/files/download/${up.data.id}?meta=1`)).data;
ok('it plays inside the app', meta2.viewable === true && meta2.kind === 'audio');
const fake = new FormData(); fake.append('file', new Blob(['<script>x</script>'], { type: 'audio/webm' }), 'x.webm'); fake.append('title', 'x'); fake.append('project_id', String(pid)); fake.append('module', 'site');
ok('a file that only pretends to be audio is refused', (await site.call('POST', '/api/files/upload', fake)).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
