// tests/controls.mjs — hard stops and money controls: MahaRERA before sales, approval order and letters, CC-covered milestones that the PM certifies,
// variations, joint measurements, advance recovery, vendor bills matched to receipts, receipts within the PO, DPR dates, long transit-rent schedules.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zc-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zc ' + role + seq, email, role, projects }); const pw = 'ZcStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const L = 100000; // Rs 1,000 in paise

const pid = (await o.call('POST', '/api/projects', { name: 'zz-ctl ' + run, code: 'CT' + run.toUpperCase().slice(-6), type: 'new_build' })).data.id;
const pm = await mkUser('pm', []); const pm2 = await mkUser('pm', []); const site = await mkUser('site', [pid]); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []);
await o.call('POST', '/api/settings/sales.lock_above_cc', { value: 'off' });   // this suite books on floor 3 with a plinth-only CC; the CC-floor lock is tested in m2_step2
await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
await o.call('POST', '/api/settings/con.pm_approval_limit_paise', { value: 50000000 });  // Rs 5 lakh

// ============ settings carry Dhaval's rules ============
const st = (await o.call('GET', '/api/settings')).data.settings;
ok('defaults: variations above Rs 5 lakh need the Owner, 3% tolerance, retention held 60 months after OC', st['con.variation_owner_limit_paise'] === 50000000 && st['pro.tolerance_bp'] === 300 && st['con.dlp_months'] === 60);

// ============ A12: no sale before MahaRERA registration ============
const unitA = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: 'A3' + run.slice(-3), type: '2BHK', price_paise: 10000000 })).data.id;
const unitB = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'B', floor: 3, unit_no: 'B3' + run.slice(-3), type: '2BHK', price_paise: 10000000 })).data.id;
const book = (u, n) => o.call('POST', '/api/sales/bookings', { unit_id: u, customer_name: n + ' ' + run, phone: '98' + String(Date.now()).slice(-8), token_paise: 100000 });
const b0 = await book(unitA, 'Early');
ok('no booking without a MahaRERA number', b0.status === 409 && b0.code === 'rera' && /MahaRERA/.test(b0.err));
await o.call('PUT', `/api/projects/${pid}`, { rera_no: 'P51800012345' });
await o.call('POST', '/api/approvals/load-template', { project_id: pid });
const items = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === pid);
const byGate = (g) => items.find((a) => a.gate_key === g);
ok('the checklist knows its IOD, CC, plinth CC, MahaRERA registration and OC', ['iod', 'cc', 'plinth_cc', 'further_cc', 'rera_reg', 'oc'].every((g) => byGate(g)), JSON.stringify(items.map((a) => [a.name.slice(0, 20), a.gate_key])));
const b1 = await book(unitA, 'Early');
ok('with the number but registration not approved in Approvals: still no booking', b1.status === 409 && /registration/.test(b1.err));
ok('cost sheets are stopped too', (await o.call('POST', '/api/sales/cost-sheets', { unit_id: unitA, agreed_price_paise: 10000000 })).status === 409);

// ============ B1 + C5: approval order, letters, allowed moves ============
const IOD = byGate('iod').id, CC = byGate('cc').id, PCC = byGate('plinth_cc').id, RERA = byGate('rera_reg').id, OC = byGate('oc').id;
const ev = (who, id, body) => who.call('POST', `/api/approvals/${id}/event`, body);
ok('cannot jump from not started to approved', (await ev(pm, IOD, { event: 'approved', letter_no: 'X', letter_date: iso(-1) })).status === 400);
const ccEarly = await ev(pm, CC, { event: 'applied' });
ok('CC cannot be applied for before the IOD is approved', ccEarly.status === 409 && ccEarly.code === 'depends' && /IOD/.test(ccEarly.err), JSON.stringify(ccEarly));
await ev(pm, IOD, { event: 'applied' });
ok('approving needs the letter number and date', (await ev(pm, IOD, { event: 'approved' })).status === 400);
ok('the letter date cannot be in the future', (await ev(pm, IOD, { event: 'approved', letter_no: 'CHE/1', letter_date: iso(3) })).status === 400);
ok('IOD approved with its letter', (await ev(pm, IOD, { event: 'approved', letter_no: 'CHE/WS/IOD/1', letter_date: iso(-30) })).status === 200);
await ev(pm, CC, { event: 'applied' });
ok('a CC must say up to which floor work is allowed', (await ev(pm, CC, { event: 'approved', letter_no: 'CHE/CC/1', letter_date: iso(-20) })).status === 400);
ok('CC approved up to plinth (floor 0)', (await ev(pm, CC, { event: 'approved', letter_no: 'CHE/CC/1', letter_date: iso(-20), cc_upto_floor: 0 })).status === 200);
ok('a PM cannot undo an approval', (await ev(pm, CC, { event: 'reopen', note: 'x' })).status === 403);
ok('the Owner can undo one only with a reason', (await ev(o, IOD, { event: 'reopen' })).status === 400);
const det = (await pm.call('GET', `/api/approvals/${CC}`)).data;
ok('the letter is kept on the approval and in its timeline', det.item.letter_no === 'CHE/CC/1' && det.item.cc_upto_floor === 0 && det.events.some((e) => /letter CHE\/CC\/1/.test(e.note)));
// registration needs the CC (already approved), then sales open
await ev(pm, RERA, { event: 'applied' }); await ev(pm, RERA, { event: 'approved', letter_no: 'P51800012345', letter_date: iso(-10) });
const bA = await book(unitA, 'Asha'), bB = await book(unitB, 'Bala');
ok('after registration, bookings open', bA.status === 200 && bB.status === 200, JSON.stringify(bA));
// a dependency loop is refused
ok('approvals cannot wait for each other in a circle', (await pm.call('PUT', `/api/approvals/${IOD}/gate`, { gate_key: 'iod', depends_on: [CC] })).status === 400);

// ============ A2 + A3 + B1: milestones ============
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Booking', pct_bp: 1000 }, { stage_name: 'Plinth', pct_bp: 2000, milestone_key: 'plinth' + run }, { stage_name: '3rd slab', pct_bp: 7000, milestone_key: 's3' + run }] });
const b2 = await book((await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 5, unit_no: 'A5' + run.slice(-3), type: '2BHK', price_paise: 10000000 })).data.id, 'Chitra');
const b3 = await book((await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'B', floor: 5, unit_no: 'B5' + run.slice(-3), type: '2BHK', price_paise: 10000000 })).data.id, 'Dev');
const demands = async (bk) => (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands;
const mk = async (body) => { await pm.call('POST', '/api/site/milestones', { project_id: pid, ...body }); return (await pm.call('GET', '/api/site/milestones')).data.milestones.find((m) => m.name === body.name); };
const msNoWing = await mk({ name: 'Plinth all ' + run, milestone_key: 'plinth' + run, floor: 0 });
const readyR = await site.call('POST', `/api/site/milestones/${msNoWing.id}/done`, { actual_date: iso(0) });
ok("a site engineer's \"done\" only says ready: no buyer is asked to pay", readyR.status === 200 && readyR.data.status === 'ready' && (await demands(b2.data.id)).find((d) => d.label === 'Plinth').status === 'scheduled');
ok('the date cannot be in the future', (await site.call('POST', `/api/site/milestones/${msNoWing.id}/ready`, { actual_date: iso(2) })).status === 400);
ok("the PM must enter the architect's certificate", (await pm.call('POST', `/api/site/milestones/${msNoWing.id}/certify`, { actual_date: iso(0) })).status === 400);
const wingErr = await pm.call('POST', `/api/site/milestones/${msNoWing.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/P/1' });
ok('with two wings, a payment milestone must name its wing', wingErr.status === 400 && wingErr.code === 'wing');
ok('site cannot certify', (await site.call('POST', `/api/site/milestones/${msNoWing.id}/certify`, { actual_date: iso(0), cert_ref: 'x' })).status === 403);
const msA = await mk({ name: 'Plinth A ' + run, wing: 'A', milestone_key: 'plinth' + run, floor: 0 });
const cA = await pm.call('POST', `/api/site/milestones/${msA.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/P/A/1' });
ok('Wing A plinth certified: only wing A buyers get the plinth demand', cA.status === 200 && cA.data.demands_ready === 1 && (await demands(b2.data.id)).find((d) => d.label === 'Plinth').status === 'ready' && (await demands(b3.data.id)).find((d) => d.label === 'Plinth').status === 'scheduled', JSON.stringify(cA));
ok('certifying twice is refused', (await pm.call('POST', `/api/site/milestones/${msA.id}/certify`, { actual_date: iso(0), cert_ref: 'x' })).status === 409);
const msA3 = await mk({ name: 'Slab 3 A ' + run, wing: 'A', milestone_key: 's3' + run, floor: 3 });
const ccBlock = await pm.call('POST', `/api/site/milestones/${msA3.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/S3/1' });
ok('3rd slab is above the CC (up to plinth): the PM is stopped', ccBlock.status === 409 && ccBlock.code === 'cc' && /floor 0/.test(ccBlock.err), JSON.stringify(ccBlock));
ok('the Owner too, without a written reason', (await o.call('POST', `/api/site/milestones/${msA3.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/S3/1' })).status === 409);
await ev(pm, PCC, { event: 'applied' }); await ev(pm, PCC, { event: 'approved', letter_no: 'CHE/PCC/1', letter_date: iso(-2), cc_upto_floor: 7 });
const c3 = await pm.call('POST', `/api/site/milestones/${msA3.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/S3/1' });
ok('after the further CC up to floor 7, the 3rd slab is certified', c3.status === 200 && c3.data.demands_ready === 1, JSON.stringify(c3));
const und = await pm.call('POST', `/api/site/milestones/${msA3.id}/undo`, { reason: 'Shuttering only; slab not cast' });
ok('undo puts the unsent demands back to waiting', und.status === 200 && und.data.demands_back_to_waiting === 1 && (await demands(b2.data.id)).find((d) => d.label === '3rd slab').status === 'scheduled', JSON.stringify(und));
ok('undo needs a reason', (await pm.call('POST', `/api/site/milestones/${msA.id}/undo`, {})).status === 400);

// ============ A1: possession ============
const ho = async (who, bk, body) => who.call('POST', `/api/sales/bookings/${bk}/handover/complete`, body || {});
await o.call('POST', `/api/sales/bookings/${bA.data.id}/registration`, { agreement_date: iso(-5) });
await o.call('POST', `/api/sales/bookings/${bA.data.id}/handover`, {});
ok('no possession before the OC', (await ho(o, bA.data.id, { override_note: 'x' })).code === 'oc');

// ============ A4 + A5 + A6 + A7 + A8: contractors ============
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zc civil ' + run, trade: 'civil' })).data.id;
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'item_rate', retention_bp: 500, advance_paise: 100 * L, items: [{ description: 'RCC M25', qty: 100, unit: 'cum', rate_paise: 10 * L }] })).data;
ok('the work order stores its advance recovery rule (10% by default)', (await o.call('GET', `/api/contractors/work-orders/${wo.id}`)).data.work_order.advance_recovery_bp === 1000);
await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
await acc.call('POST', `/api/contractors/work-orders/${wo.id}/advance`, { amount_paise: 100 * L });
const item = (await o.call('GET', `/api/contractors/work-orders/${wo.id}`)).data.items[0];
const me = await site.call('POST', `/api/contractors/work-orders/${wo.id}/measurements`, { wo_item_id: item.id, location: 'A wing plinth', qty: 120, contractor_rep: 'Supervisor' });
await pm.call('POST', `/api/contractors/measurements/${me.data.id}/approve`, {});
const over = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 110 }] });
ok('measured 120 but the order says 100: billing 110 is refused until a variation', over.status === 409 && /variation/.test(over.err));
const bigVar = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/variations`, { wo_item_id: item.id, qty: 60, reason: 'Raft thickened per R2' });
ok('variation of 60 cum = Rs 6,00,000 goes to the Owner', bigVar.status === 200 && bigVar.data.amount_paise === 600 * L && bigVar.data.needs_owner === true);
ok('the PM cannot approve a variation above Rs 5 lakh', (await pm.call('POST', `/api/contractors/variations/${bigVar.data.id}/approve`, {})).status === 403);
ok('the Owner approves it', (await o.call('POST', `/api/contractors/variations/${bigVar.data.id}/approve`, {})).status === 200);
const ra = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 110 }] });
ok('now 110 cum bills; 10% advance recovery (Rs 1,10,000 capped at the Rs 1,00,000 outstanding) is taken by itself', ra.status === 200 && ra.data.gross_paise === 1100 * L && ra.data.advance_recovery_paise === 100 * L, JSON.stringify(ra));
ok('billing beyond what is measured is refused', (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 20 }] })).status === 409);
await pur.call('POST', `/api/contractors/ra-bills/${ra.data.id}/cancel`, { reason: 'redo' }).catch(() => {});
await o.call('POST', `/api/contractors/ra-bills/${ra.data.id}/cancel`, { reason: 'redo with less recovery' });
const lessRec = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 10 }], advance_recovery_paise: 0 });
ok('recovering less advance than the rule needs a reason', lessRec.status === 400 && lessRec.code === 'recovery');
const ra2 = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 10 }], advance_recovery_paise: 0, advance_recovery_reason: 'Contractor cash-flow, agreed by PM' });
ok('with a reason it is saved and the reason is on the bill', ra2.status === 200 && ra2.data.advance_recovery_paise === 0 && ra2.data.ra_no === 2);
await pm.call('POST', `/api/contractors/ra-bills/${ra2.data.id}/check`, {});
ok('the checker cannot approve', (await pm.call('POST', `/api/contractors/ra-bills/${ra2.data.id}/approve`, {})).status === 403);
ok('another PM approves', (await pm2.call('POST', `/api/contractors/ra-bills/${ra2.data.id}/approve`, {})).status === 200);
const bigRa = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 100 }], other_deductions_paise: 600 * L });
await pm.call('POST', `/api/contractors/ra-bills/${bigRa.data.id}/check`, {});
ok('approval limit is on work done (Rs 10 lakh gross), not the net after deductions', bigRa.data.net_paise < 500 * L && (await pm2.call('POST', `/api/contractors/ra-bills/${bigRa.data.id}/approve`, {})).status === 403, JSON.stringify(bigRa.data));
await o.call('POST', `/api/contractors/ra-bills/${bigRa.data.id}/cancel`, { reason: 'test' });
await acc.call('POST', `/api/contractors/ra-bills/${ra2.data.id}/payments`, { amount_paise: (await o.call('GET', `/api/contractors/work-orders/${wo.id}`)).data.ra_bills.find((r) => r.id === ra2.data.id).net_paise });
const cl = await o.call('POST', `/api/contractors/work-orders/${wo.id}/close`, {});
ok('a work order cannot be closed with advance or retention still open', cl.status === 409);
ok('retention release before the OC needs the Owner with a reason', (await acc.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 1 })).code === 'dlp');
const audits = (await o.call('GET', `/api/audit?entity=con_variations`)).data.audit;
ok('variations are in the audit log', audits.some((a) => /Raft thickened/.test(a.summary)));

// ============ A10 + A11: vendor bills and receipts ============
const v1 = (await pur.call('POST', '/api/procurement/vendors', { name: 'zc steel ' + run })).data.id;
const v2 = (await pur.call('POST', '/api/procurement/vendors', { name: 'zc other ' + run })).data.id;
const po = (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, gst_bp: 1800, items: [{ description: 'TMT', qty: 10, unit: 'MT', rate_paise: 500 * L }] })).data;
await pur.call('POST', `/api/procurement/pos/${po.id}/submit`); await o.call('POST', `/api/procurement/pos/${po.id}/approve`);
const lines = (await pur.call('GET', `/api/procurement/pos/${po.id}/lines`)).data.items;
ok('the note-only receipt is refused for a PO with items', (await site.call('POST', `/api/procurement/pos/${po.id}/grn`, { qty_note: 'came', full: true })).code === 'use_lines');
const ex = await site.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), lines: [{ po_item_id: lines[0].id, qty_received: 10.5 }] });
ok('receiving 10.5 MT against 10 (over 3%) is refused for site', ex.status === 409 && ex.code === 'excess');
ok('9 MT (within the order) is accepted', (await site.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), lines: [{ po_item_id: lines[0].id, qty_received: 9 }] })).status === 200);
ok('the PM accepts extra only with a reason', (await pm.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), lines: [{ po_item_id: lines[0].id, qty_received: 1.5 }] })).code === 'excess'
  && (await pm.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), lines: [{ po_item_id: lines[0].id, qty_received: 1.5 }], excess_note: 'Cut lengths, agreed' })).status === 200);
ok('a bill from a different vendor than the PO is refused', (await acc.call('POST', '/api/procurement/bills', { po_id: po.id, vendor_id: v2, bill_no: 'X1', amount_paise: 100 * L })).status === 400);
const good = await acc.call('POST', '/api/procurement/bills', { po_id: po.id, vendor_id: v1, bill_no: 'SB-' + run, amount_paise: 3540 * L, gst_paise: 540 * L });
ok('a bill within what was received (6 MT of 10.5) is not held', good.status === 200 && good.data.on_hold === false, JSON.stringify(good));
ok('the same bill number from the same vendor is refused', (await acc.call('POST', '/api/procurement/bills', { po_id: po.id, vendor_id: v1, bill_no: 'sb-' + run, amount_paise: 100 * L })).code === 'duplicate');
const big = await acc.call('POST', '/api/procurement/bills', { po_id: po.id, vendor_id: v1, bill_no: 'SB2-' + run, amount_paise: 4720 * L, gst_paise: 720 * L });
ok('a bill beyond what was received goes on hold', big.status === 200 && big.data.on_hold === true && /received/.test(big.data.hold_reason), JSON.stringify(big));
ok('a held bill cannot be paid', (await acc.call('POST', `/api/procurement/bills/${big.data.id}/payments`, { amount_paise: 100 * L })).code === 'held');
ok('release needs a reason', (await pm.call('POST', `/api/procurement/bills/${big.data.id}/release`, {})).status === 400);
ok('the PM releases it; then it can be paid', (await pm.call('POST', `/api/procurement/bills/${big.data.id}/release`, { note: 'Rate difference agreed in writing' })).status === 200
  && (await acc.call('POST', `/api/procurement/bills/${big.data.id}/payments`, { amount_paise: 100 * L })).status === 200);

// ============ C4: report dates ============
ok('a daily report cannot be dated in the future', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(1), work_summary: 'x' })).status === 400);
ok('site cannot back-date a report by more than 2 days; the PM can', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(-5), work_summary: 'x' })).status === 400
  && (await pm.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(-5), work_summary: 'late entry' })).status === 200);

// ============ B8: transit rent runs past 48 months ============
const rd = (await o.call('POST', '/api/projects', { name: 'zz-ctl-rd ' + run, code: 'CR' + run.toUpperCase().slice(-6), type: 'redevelopment' })).data.id;
const soc = (await o.call('POST', '/api/redev/societies', { project_id: rd, name: 'CHS ' + run })).data.id;
const mem = (await o.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'M1', unit_label: '1' })).data.id;
const d0 = new Date(Date.now() + 19800000); const start = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 50, 1)).toISOString().slice(0, 10);
await o.call('PUT', `/api/redev/members/${mem}/vacate`, { paaa_reg_no: 'PAAA-T', paaa_reg_date: '2020-01-01', vacated_on: '2020-01-01', override_note: 'test fixture, no photo' });
await o.call('POST', `/api/redev/members/${mem}/transit-term`, { monthly_rent_paise: 3000000, start_date: start });
const months = (await o.call('GET', `/api/redev/members/${mem}/transit`)).data.months;
ok('a rent term that started 50 months ago is scheduled past month 48', months.length > 50, String(months.length));

await o.call('POST', '/api/settings/sales.lock_above_cc', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
