// tests/projectplus.mjs — project details, AutoDCR, approval steps and file movement, tasks with a person in charge, quick view,
// member terms, meeting attendees, PO charges, store receipts, Owner as super user, file viewer. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b instanceof FormData) body = b; else if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zq-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zq ' + role + seq, email, role, projects }); const pw = 'ZqStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-pp ' + run, code: 'PP' + run.toUpperCase().slice(-6), type: 'redevelopment' })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-pq ' + run, code: 'PQ' + run.toUpperCase().slice(-6), type: 'new_build' })).data.id;
const pm = await mkUser('pm', []); const site = await mkUser('site', [pid]); const pur = await mkUser('purchase', [pid, pid2]); const acc = await mkUser('accounts', []);

// ============ 2 + 4: project details and the Google Maps link ============
const ch = (await pm.call('GET', '/api/projects-meta/choices')).data;
ok('the form offers planning authorities, other authorities, BMC designations and people', ch.planning_authorities.includes('MCGM (BMC)') && ch.other_authorities.includes('SRA') && ch.other_authorities.includes('MHADA') && ch.other_authorities.includes('Estate Department (MCGM)') && ch.designations.some((d) => /Assistant Engineer/.test(d)) && ch.people.length > 0);
ok('a map link from another site is refused', (await pm.call('PUT', `/api/projects/${pid}/profile`, { maps_url: 'https://evil.example/maps/@19.1,72.8' })).status === 400);
const prof = await pm.call('PUT', `/api/projects/${pid}/profile`, { members_count: 48, plot_area_sqm: 1250.5, ward: 'K/West', planning_authority: 'MCGM (BMC)', other_authorities: ['SRA', 'Estate Department (MCGM)'], cts_no: 'CTS 123/A', village: 'Andheri',
  property_card_details: 'Holder: the society; area 1250 sq m', conveyance_details: 'Reg. no. BDR-1/1234/2001', maps_url: 'https://www.google.com/maps/place/Site/@19.1197,72.8468,17z', extra_info: 'Road widening on the east side' });
ok('the PM saves the details; the map link gives the site location', prof.status === 200 && prof.data.location_found === true, JSON.stringify(prof));
const pr = (await pm.call('GET', `/api/projects/${pid}`)).data;
ok('details are stored exactly', pr.members_count === 48 && pr.plot_area_sqm === 1250.5 && JSON.parse(pr.other_authorities).length === 2 && pr.ward === 'K/West' && Math.abs(pr.lat - 19.1197) < 1e-6 && Math.abs(pr.lng - 72.8468) < 1e-6);
ok('Site cannot change project details', (await site.call('PUT', `/api/projects/${pid}/profile`, { members_count: 1 })).status === 403);
ok('a wrong number of members is refused', (await pm.call('PUT', `/api/projects/${pid}/profile`, { members_count: -3 })).status === 400);

// ============ 5: AutoDCR ============
ok('only the Owner sets the AutoDCR link', (await pm.call('POST', `/api/projects/${pid}/autodcr`, { url: 'https://autodcr.mcgm.gov.in/x' })).status === 403);
ok('an empty link is refused', (await o.call('POST', `/api/projects/${pid}/autodcr`, { url: '' })).status === 400);
ok('the Owner sets it', (await o.call('POST', `/api/projects/${pid}/autodcr`, { url: 'https://autodcr.mcgm.gov.in/proposal/111' })).status === 200);
ok('correcting it needs a reason', (await o.call('POST', `/api/projects/${pid}/autodcr`, { url: 'https://autodcr.mcgm.gov.in/proposal/112' })).status === 400);
ok('it can be corrected with a reason', (await o.call('POST', `/api/projects/${pid}/autodcr`, { url: 'https://autodcr.mcgm.gov.in/proposal/112', reason: 'Wrong proposal number' })).status === 200);
const dcr = (await site.call('GET', `/api/projects/${pid}/autodcr`)).data;
ok('everyone on the project sees it; the history keeps both links', dcr.autodcr_url.endsWith('/112') && dcr.history.length === 2 && dcr.history[0].reason === 'Wrong proposal number');
ok('there is no way to remove it', (await o.call('POST', `/api/projects/${pid}/autodcr`, { url: 'not a link', reason: 'x' })).status === 400 && (await o.call('DELETE', `/api/projects/${pid}/autodcr`)).status >= 400);

// ============ 6: approvals in capitals, steps, file movement ============
const iod = (await pm.call('POST', '/api/approvals', { project_id: pid, name: 'iod for wing a', authority: 'MCGM', owner_user_id: pm.id, target_date: iso(30) })).data.id;
const conc = (await pm.call('POST', '/api/approvals', { project_id: pid, name: 'Concession (premium FSI)', authority: 'MCGM' })).data.id;
const items = (await pm.call('GET', '/api/approvals')).data.items;
const iodRow = items.find((a) => a.id === iod);
ok('approvals are stored in capital letters', iodRow.name === 'IOD FOR WING A' && items.find((a) => a.id === conc).name === 'CONCESSION (PREMIUM FSI)');
ok('the approval has a person in charge and an expected date', iodRow.owner_name && iodRow.target_date === iso(30));
await o.call('POST', '/api/approvals/load-template', { project_id: pid2 });
ok('the Mumbai checklist also loads in capitals', (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === pid2).every((a) => a.name === a.name.toUpperCase()));
const t1 = await pm.call('POST', `/api/approvals/${iod}/steps`, { template: true });
const s1 = (await pm.call('GET', `/api/approvals/${iod}/steps`)).data;
ok('the usual IOD steps load; the IOD is put up by the Assistant Engineer', t1.status === 200 && s1.steps.length === 4 && s1.steps.some((s) => /IOD PREPARED/.test(s.title) && /^Assistant Engineer/.test(s.responsible_designation)));
await pm.call('POST', `/api/approvals/${conc}/steps`, { template: true });
const s2 = (await pm.call('GET', `/api/approvals/${conc}/steps`)).data.steps;
ok('the last concession step is the BMC Commissioner', /Municipal Commissioner/.test(s2[s2.length - 1].responsible_designation) && /FINAL APPROVAL/.test(s2[s2.length - 1].title));
ok('usual steps load only once', (await pm.call('POST', `/api/approvals/${iod}/steps`, { template: true })).status === 400);
const ns = await pm.call('POST', `/api/approvals/${iod}/steps`, { title: 'fire noc letter', responsible_designation: 'Chief Fire Officer', assigned_to: site.id, target_date: iso(10) });
ok('a step can be added by hand, in capitals, with our person and a date', ns.status === 200 && (await pm.call('GET', `/api/approvals/${iod}/steps`)).data.steps.find((s) => s.id === ns.data.id).title === 'FIRE NOC LETTER');
ok('a step with a person who does not exist is refused', (await pm.call('POST', `/api/approvals/${iod}/steps`, { title: 'x', assigned_to: 99999999 })).status === 400);
ok('a step can be marked done', (await pm.call('PUT', `/api/approval-steps/${s1.steps[0].id}`, { status: 'done' })).status === 200 && (await pm.call('GET', `/api/approvals/${iod}/steps`)).data.steps[0].done_on);
const mv = await pm.call('PUT', `/api/approvals/${iod}/file`, { holder_designation: 'Assistant Engineer (Building Proposal)', holder_name: 'Mr Rane', next_designation: 'Executive Engineer (Building Proposal)', target_date: iso(20) });
const det = (await pm.call('GET', `/api/approvals/${iod}`)).data;
ok('the file position is saved and logged on the timeline', mv.status === 200 && det.item.holder_designation.startsWith('Assistant Engineer') && det.item.next_designation.startsWith('Executive Engineer') && det.events.some((e) => e.event === 'file_moved'));

// ============ 8 + 9: tasks and the quick view ============
const ms = (await pm.call('POST', '/api/site/milestones', { project_id: pid, name: 'Plinth ' + run, planned_date: iso(15), assigned_to: site.id })).data.id;
const sn = (await site.call('POST', '/api/site/snags', { project_id: pid, title: 'Crack ' + run, severity: 'high' })).data.id;
const tasks = (await pm.call('GET', `/api/tasks?project_id=${pid}`)).data.tasks;
ok('tasks list approvals, steps, milestones and snags with the person in charge', ['approval', 'step', 'milestone', 'snag'].every((k) => tasks.some((t) => t.kind === k)) && tasks.find((t) => t.kind === 'milestone' && t.id === ms).in_charge);
ok('a snag without a person shows as not set', tasks.find((t) => t.kind === 'snag' && t.id === sn).in_charge === null);
ok('setting the person needs a date and a real person', (await pm.call('POST', '/api/tasks/assign', { kind: 'snag', id: sn, assigned_to: site.id, due: '2026-13-40' })).status === 400 && (await pm.call('POST', '/api/tasks/assign', { kind: 'snag', id: sn })).status === 400);
ok('the PM sets who is in charge of the snag and by when', (await pm.call('POST', '/api/tasks/assign', { kind: 'snag', id: sn, assigned_to: site.id, due: iso(3) })).status === 200);
ok('"only mine" shows the site engineer their snag', (await site.call('GET', `/api/tasks?mine=1`)).data.tasks.some((t) => t.kind === 'snag' && t.id === sn && t.due === iso(3)));
ok('someone without the project cannot see its tasks', (await (await mkUser('site', [])).call('GET', `/api/tasks?project_id=${pid}`)).status === 403);
const ov = (await pm.call('GET', `/api/projects/${pid}/overview`)).data;
ok('the quick view gives details, approvals and open tasks with who is responsible', ov.project.members_count === 48 && ov.approvals.total === 2 && ov.tasks.length >= 4 && ov.tasks.every((t) => 'in_charge' in t && 'due' in t));

// ============ 3, 11, 12, 13, 14: society, members, meetings ============
const soc = (await pm.call('POST', '/api/redev/societies', { project_id: pid, name: 'Om CHS ' + run })).data.id;
ok('a project has only one society', (await pm.call('POST', '/api/redev/societies', { project_id: pid, name: 'Second CHS' })).status === 409);
const mA = (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Asha', unit_label: '101', member_type: 'residential', carpet_sqft: 400 })).data.id;
const mB = (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Bala', unit_label: '102', member_type: 'owner', carpet_sqft: 500 })).data.id;
const mC = (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Chitra', unit_label: '103', carpet_sqft: 450 })).data.id;
ok('member type "residential" is kept', (await pm.call('GET', `/api/redev/societies/${soc}/members`)).data.members.find((m) => m.id === mA).member_type === 'residential');
const mD = (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Dev', unit_label: '104' })).data.id;
ok('rent per sq ft needs the flat area; rent needs a basis', (await o.call('PUT', `/api/redev/members/${mD}/terms`, { rent_y1_paise: 5000, rent_basis: 'per_sqft' })).status === 400
  && (await o.call('PUT', `/api/redev/members/${mA}/terms`, { rent_y1_paise: 5000 })).status === 400);
const tr = await o.call('PUT', `/api/redev/members/${mA}/terms`, { carpet_sqft: 400, extra_area_pct: 35, rent_basis: 'monthly', rent_y1_paise: 3000000, rent_y2_paise: 3300000, rent_y3_paise: 3600000, rent_y4_paise: '', rent_y5_paise: '', corpus_paise: 50000000, car_parks: 1, shifting_paise: 10000000, buys_extra: true, buys_extra_sqft: 50 });
ok('new RERA carpet is worked out: 400 sq ft + 35% = 540 sq ft', tr.status === 200 && tr.data.new_rera_sqft === 540, JSON.stringify(tr));
const tm = (await acc.call('GET', `/api/redev/members/${mA}/terms`)).data.terms;
ok('terms are stored: 3 years of rent, corpus, parking, shifting, buying extra', tm.rent_y2_paise === 3300000 && tm.rent_y4_paise === null && tm.corpus_paise === 50000000 && tm.car_parks === 1 && tm.shifting_paise === 10000000 && tm.buys_extra === 1 && tm.buys_extra_sqft === 50);
ok('the PM cannot change money terms', (await pm.call('PUT', `/api/redev/members/${mA}/terms`, { corpus_paise: 1 })).status === 403);
const d0 = new Date(Date.now() + 19800000); const start = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 13, 1)).toISOString().slice(0, 10);
await o.call('PUT', `/api/redev/members/${mA}/vacate`, { paaa_reg_no: 'PAAA-T', paaa_reg_date: '2020-01-01', vacated_on: start });
await o.call('POST', `/api/redev/members/${mA}/transit-term`, { monthly_rent_paise: 2500000, start_date: start });
const months = (await o.call('GET', `/api/redev/members/${mA}/transit`)).data.months;
ok('transit rent follows the year-wise rent: year 1 = Rs 30,000, year 2 = Rs 33,000', months[0].due_paise === 3000000 && months[11].due_paise === 3000000 && months[12].due_paise === 3300000, JSON.stringify(months.slice(10, 14).map((x) => x.due_paise)));
await o.call('PUT', `/api/redev/members/${mB}/terms`, { rent_basis: 'per_sqft', rent_y1_paise: 6000, certified_area_sqft: 500 });
await o.call('PUT', `/api/redev/members/${mB}/vacate`, { paaa_reg_no: 'PAAA-T', paaa_reg_date: '2020-01-01', vacated_on: start });
await o.call('POST', `/api/redev/members/${mB}/transit-term`, { monthly_rent_paise: 100, start_date: start });
ok('per sq ft rent: Rs 60 x 500 sq ft = Rs 30,000 a month', (await o.call('GET', `/api/redev/members/${mB}/transit`)).data.months[0].due_paise === 3000000);
const names = (await pm.call('GET', `/api/redev/societies/${soc}/member-names`)).data.members;
ok('the meeting form gets member names (no phone numbers)', names.length === 4 && !('phone' in names[0]));
const mt = await pm.call('POST', `/api/redev/societies/${soc}/meetings`, { held_on: iso(0), agenda: 'Developer selection', attendee_ids: [mA, mC, 99999999], next_action: 'Send draft DA', next_action_owner: pm.id, next_action_due: iso(7) });
const mts = (await pm.call('GET', `/api/redev/societies/${soc}/meetings`)).data.meetings;
const m0 = mts.find((x) => x.id === mt.data.id);
ok('attendees are ticked from the member list; the count is worked out; unknown ids are ignored', m0.attendees_count === 2 && m0.attendee_ids.sort().join() === [mA, mC].sort().join(), JSON.stringify(m0));
ok('the next action has a person in charge', m0.next_action_owner_name && (await pm.call('GET', `/api/tasks?project_id=${pid}`)).data.tasks.some((t) => t.kind === 'meeting' && t.id === m0.id));
await pm.call('PUT', `/api/redev/meetings/${m0.id}`, { attendee_ids: [mB] });
ok('editing the attendees replaces the list', (await pm.call('GET', `/api/redev/societies/${soc}/meetings`)).data.meetings.find((x) => x.id === m0.id).attendees_count === 1);

// ============ 15: PO charges and terms ============
const vend = (await pur.call('POST', '/api/procurement/vendors', { name: 'zq vendor ' + run })).data.id;
const po = await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: vend, gst_bp: 1800, material_category: 'steel', transport_paise: 500000, delivery_date: iso(5), payment_terms: '30 days', items: [{ description: 'TMT 12 mm', hsn: '7214', qty: 10, unit: 'MT', rate_paise: 5500000 }] });
const pp = (await pur.call('GET', `/api/print/po/${po.data.id}`)).data;
ok('PO total includes transport: (5,50,000 + 5,000) + 18% GST', pp.po.amount_paise === 55500000 && pp.po.gst_paise === 9990000 && pp.po.total_paise === 65490000 && pp.items[0].hsn === '7214' && pp.po.material_category === 'steel', JSON.stringify(pp.po));
const tu = await pur.call('PUT', `/api/procurement/pos/${po.data.id}/terms`, { loading_paise: 200000, insurance_paise: 50000, charges_gst_bp: 500, warranty: 'As per IS 1786', penalty_clause: '0.5% a day', category_details: { Grade: 'Fe 500D', 'Mill test certificate': 'Required' } });
const pp2 = (await pur.call('GET', `/api/print/po/${po.data.id}`)).data.po;
ok('charges and terms update the total (charges at 5% GST)', tu.status === 200 && pp2.amount_paise === 55750000 && pp2.gst_paise === 9900000 + Math.round(750000 * 0.05) && JSON.parse(pp2.category_details).Grade === 'Fe 500D' && pp2.transport_paise === 500000, JSON.stringify(pp2));
await pur.call('POST', `/api/procurement/pos/${po.data.id}/submit`);
ok('an approved or waiting PO cannot be changed', (await pur.call('PUT', `/api/procurement/pos/${po.data.id}/terms`, { transport_paise: 1 })).status === 400);
ok('negative charges are refused', (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: vend, transport_paise: -5, items: [{ description: 'x', qty: 1, rate_paise: 100 }] })).status === 400);

// ============ 16: the Owner approves their own work ============
const opo = (await o.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: vend, items: [{ description: 'Cement', qty: 100, unit: 'bags', rate_paise: 40000 }] })).data.id;
await o.call('POST', `/api/procurement/pos/${opo}/submit`);
ok('the Owner approves a PO they made', (await o.call('POST', `/api/procurement/pos/${opo}/approve`)).status === 200);
const au = (await o.call('GET', `/api/audit?entity=pro_pos&entity_id=${opo}`)).data.audit;
ok('the audit says "approved by Owner as maker"', au.some((a) => /approved by Owner as maker/.test(a.summary)));
const fund = (await acc.call('POST', '/api/petty/funds', { project_id: pid, custodian_user_id: (await o.call('GET', '/api/auth/me')).data.user.id, opening_paise: 100000 })).data.id;
const pe = (await o.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea', amount_paise: 2000, narration: 'own ' + run })).data.id;
ok('the Owner approves their own petty cash entry', (await o.call('POST', `/api/petty/entries/${pe}/approve`, {})).status === 200);
const ppe = (await pm.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea', amount_paise: 1000, narration: 'pm ' + run })).data.id;
ok('a PM still cannot approve their own', (await pm.call('POST', `/api/petty/entries/${ppe}/approve`, {})).status === 403);

// ============ 10: store quantities ============
const item = (await pur.call('POST', '/api/stores/items', { name: 'Sand ' + run, unit: 'brass' })).data.id;
ok('Purchase adds opening stock straight away', (await pur.call('POST', '/api/stores/receive', { project_id: pid, item_id: item, qty: 12.5, note: 'Opening stock' })).data.on_hand === 12.5);
ok('a receipt needs a reason and a quantity', (await pur.call('POST', '/api/stores/receive', { project_id: pid, item_id: item, qty: 5 })).status === 400 && (await pur.call('POST', '/api/stores/receive', { project_id: pid, item_id: item, qty: 0, note: 'x' })).status === 400);
const sr = (await site.call('POST', '/api/stores/receive', { project_id: pid, item_id: item, qty: 2, note: 'Returned from work' })).data;
ok('a site engineer\'s receipt waits for approval and does not change the count yet', sr.pending === true && sr.on_hand === 12.5);
ok('the PM approves it and the count goes up by exactly 2', (await pm.call('POST', `/api/stores/moves/${sr.id}/approve`, {})).status === 200 && (await pm.call('GET', `/api/stores/stock?project_id=${pid}`)).data.stock.find((s) => s.item_id === item).qty === 14.5);
const iss = await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: item, qty: 4.5, where_used: 'Slab 1' });
ok('issuing takes exactly that much out', iss.data.on_hand === 10);
const adj = (await o.call('POST', '/api/stores/adjust', { project_id: pid, item_id: item, qty: -1, reason: 'Count' })).data.id;
ok('the Owner approves their own count correction', (await o.call('POST', `/api/stores/moves/${adj}/approve`, {})).status === 200 && (await o.call('GET', `/api/stores/stock?project_id=${pid}`)).data.stock.find((s) => s.item_id === item).qty === 9);
// PO line not tied to a store item: tie it when the material arrives
const cem = (await pur.call('POST', '/api/stores/items', { name: 'Cement ' + run, unit: 'bags' })).data.id;
const lines = (await pur.call('GET', `/api/procurement/pos/${opo}/lines`)).data.items;
ok('the receipt form knows the line is not tied to a store item', lines[0].stock_item_id === null);
await site.call('POST', `/api/procurement/pos/${opo}/grn-lines`, { lines: [{ po_item_id: lines[0].id, qty_received: 60, stock_item_id: cem }] });
ok('material received is added to the store once tied', (await pm.call('GET', `/api/stores/stock?project_id=${pid}`)).data.stock.find((s) => s.item_id === cem).qty === 60);
await site.call('POST', `/api/procurement/pos/${opo}/grn-lines`, { lines: [{ po_item_id: lines[0].id, qty_received: 40 }] });
ok('the next delivery goes in by itself (60 + 40 = 100)', (await pm.call('GET', `/api/stores/stock?project_id=${pid}`)).data.stock.find((s) => s.item_id === cem).qty === 100);

// ============ 1: see files without downloading ============
const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: 'image/png' }), 'plan.png'); fd.append('title', 'Plan ' + run); fd.append('project_id', String(pid)); fd.append('category', 'drawing');
const up = await o.call('POST', '/api/files/upload', fd);
const meta = (await o.call('GET', `/api/files/download/${up.data.id}?meta=1`)).data;
ok('a picture is viewable in the app', meta.viewable === true && meta.kind === 'image');
const inl = await o.call('GET', `/api/files/download/${up.data.id}?inline=1`, null, true);
ok('it is sent to be shown, not downloaded, and locked down', /^inline/.test(inl.headers.get('content-disposition')) && /sandbox/.test(inl.headers.get('content-security-policy') || '') && inl.headers.get('x-content-type-options') === 'nosniff');
const fd2 = new FormData(); fd2.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' }), 'x.html'); fd2.append('title', 'Page ' + run); fd2.append('project_id', String(pid)); fd2.append('category', 'other');
const up2 = await o.call('POST', '/api/files/upload', fd2);
if (up2.status === 200) {
  const r2 = await o.call('GET', `/api/files/download/${up2.data.id}?inline=1`, null, true);
  ok('a web page file is never shown inline (download only)', /^attachment/.test(r2.headers.get('content-disposition')));
} else ok('a web page file is refused at upload', up2.status === 400);
{ const hr = await mkUser('hr', []); const a1 = (await hr.call('GET', `/api/files/download/${up.data.id}?meta=1`)).status, a2 = (await hr.call('GET', `/api/files/download/${up.data.id}?inline=1`, null, true)).status, a3 = (await hr.call('GET', `/api/files/download/${up.data.id}`, null, true)).status;
  ok('the viewer keeps the same access rules as downloading', a1 === a3 && a2 === a3, `${a1} ${a2} ${a3}`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
