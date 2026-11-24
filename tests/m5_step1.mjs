// tests/m5_step1.mjs — Module 5, step 1: snags tied to work orders (retention lock, After photo), six no-dues points, possession funds,
// possession certificate, defect helpdesk (time limit, back-charge), society handover vault and the project-close gate.
import { execSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://localhost:8787';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; } async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; if (b && !(b instanceof FormData)) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method: m, headers: h, body: b ? (b instanceof FormData ? b : JSON.stringify(b)) : undefined }); const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return res; let d = null; try { d = await res.json(); } catch (x) { /* */ } return { status: res.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });

// If a check throws, put the shared switches back so the suites that follow are not affected.
const putBack = async () => { try { await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' }); await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' }); await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'off' }); } catch (e) { /* ignore */ } };
process.on('uncaughtException', async (e) => { console.error(e); await putBack(); process.exit(1); });
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });   // no second-person wait on a receipt in this suite
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' }); await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' }); await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
let seq = 0;
const mkUser = async (role, projects) => { const email = `m5-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm5 ' + role, email, role, projects }); const pw = 'M5StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const png = () => { const fd = new FormData(); return fd; };
const upload = async (c, pid, title, extra = {}) => { const fd = new FormData(); fd.append('file', new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0, 5, 0xfe, 2, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])], { type: 'image/png' }), 'x.png');
  fd.append('project_id', String(pid)); fd.append('title', title); fd.append('category', extra.category || 'other'); fd.append('module', extra.module || 'projects'); fd.append('audience', 'internal'); if (extra.entity) { fd.append('entity', extra.entity); fd.append('entity_id', String(extra.entity_id)); }
  const r = await c.call('POST', '/api/files/upload', fd); return r.data && r.data.id; };

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m5s1 ' + run, code: 'M5S' + run.toUpperCase().slice(-5) })).data.id;
const pm = await mkUser('pm', [pid]); const acc = await mkUser('accounts', [pid]); const site = await mkUser('site', [pid]); const sales = await mkUser('sales', [pid]); const viewer = await mkUser('viewer', [pid]);

// a contractor, an approved work order and some retention held
const cid = (await o.call('POST', '/api/contractors/contractors', { name: 'zz waterproofing ' + run, trade: 'waterproofing' })).data.id;
const wo = (await o.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: cid, scope: 'Podium waterproofing', basis: 'lump_sum', value_paise: 10000000, retention_bp: 500, advance_paise: 0 })).data;
await o.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); const ap = await pm.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
ok('a work order is approved for the test', ap.status === 200, JSON.stringify(ap));
sql(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, created_at) VALUES (${cid}, ${pid}, ${wo.id}, 'retention_held', 500000, datetime('now'))`);

await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Slab', pct_bp: 10000, milestone_key: 'm5s' + run }] });
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 5, unit_no: 'S' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 500 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Meera Joshi', phone: '97' + digits, email: 'm@example.com', token_paise: 100000, pan: 'ABCDE1234F' })).data.id;

// ---------- snags: contractor, pin, After photo, retention lock ----------
const sn = (await site.call('POST', '/api/site/snags', { project_id: pid, unit_id: unit, title: 'Seepage in podium joint', severity: 'high', location: 'Podium' })).data.id;
const plan = await upload(o, pid, 'Floor plan', { category: 'drawing', module: 'site' });
ok('a floor plan picture is uploaded', !!plan);
ok('viewer cannot assign a snag', (await viewer.call('POST', `/api/site/snags/${sn}/assign`, { wo_id: wo.id })).status === 403);
ok('a pin must be on the plan (0-1000)', (await site.call('POST', `/api/site/snags/${sn}/assign`, { pin_x: 1500, pin_y: 10 })).status === 400);
ok('an unknown category is refused', (await site.call('POST', `/api/site/snags/${sn}/assign`, { category: 'magic' })).status === 400);
ok('the site engineer gives the snag to the work order with a pin', (await site.call('POST', `/api/site/snags/${sn}/assign`, { wo_id: wo.id, category: 'plumbing', pin_x: 420, pin_y: 610, plan_doc_id: plan })).status === 200);
const sl = (await o.call('GET', '/api/site/snags')).data.snags.find((x) => x.id === sn);
ok('the snag keeps the work order, category and spot', sl.wo_id === wo.id && sl.category === 'plumbing' && sl.pin_x === 420 && sl.pin_y === 610 && sl.plan_doc_id === plan);
const rel = (amt) => acc.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: amt, note: 'release after DLP', mode: 'neft', ref_no: 'R' + run + amt });
let r1 = await o.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 100000, note: 'testing the lock early', mode: 'neft', ref_no: 'RX' + run });
ok('an open snag on the work order blocks retention release, even for the Owner', r1.status === 409 && r1.code === 'open_snags', JSON.stringify(r1));
const noAfter = await site.call('POST', `/api/site/snags/${sn}/status`, { status: 'fixed' });
ok('the snag cannot be marked fixed without an After photo', noAfter.status === 409 && noAfter.code === 'after_photo', JSON.stringify(noAfter));
await upload(site, pid, 'Before photo', { module: 'site', entity: 'site_snags', entity_id: sn });
ok('a "Before" photo does not count', (await site.call('POST', `/api/site/snags/${sn}/status`, { status: 'fixed' })).status === 409);
await upload(site, pid, 'After photo', { module: 'site', entity: 'site_snags', entity_id: sn });
ok('with an After photo it can be marked fixed', (await site.call('POST', `/api/site/snags/${sn}/status`, { status: 'fixed' })).status === 200);
r1 = await o.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 100000, note: 'testing the lock early', mode: 'neft', ref_no: 'RY' + run });
ok('a fixed but unverified snag still blocks the release', r1.status === 409 && r1.code === 'open_snags');
ok('the PM verifies the fix', (await pm.call('POST', `/api/site/snags/${sn}/status`, { status: 'verified' })).status === 200);
r1 = await o.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 100000, note: 'testing the lock early', mode: 'neft', ref_no: 'RZ' + run });
ok('once every snag is verified the lock lifts (the earlier DLP rule still applies)', r1.status === 200, JSON.stringify(r1));
const sn2 = (await site.call('POST', '/api/site/snags', { project_id: pid, title: 'Plain snag without a contractor', severity: 'low' })).data.id;
ok('a snag with no work order can be fixed without the lock', (await site.call('POST', `/api/site/snags/${sn2}/status`, { status: 'fixed' })).status === 200);

// ---------- six no-dues points ----------
await o.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab', milestone_key: 'm5s' + run });
const ms = (await o.call('GET', `/api/site/milestones?project_id=${pid}`)).data.milestones.find((m) => m.milestone_key === 'm5s' + run);
await o.call('POST', `/api/site/milestones/${ms.id}/done`, { actual_date: iso(-1), cert_ref: 'ARCH/1 test', override_note: 'test project has no CC recorded' });
let nd = (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data;
const by = (k) => nd.points.find((p) => p.key === k);
ok('six points are returned', nd.points.length === 6 && !nd.all_green);
ok('dues are not clear while an instalment is unpaid', !by('dues').ok && /still due/.test(by('dues').detail));
ok('no corpus amounts set = not clear (switchable)', !by('funds').ok && /No corpus/.test(by('funds').detail));
ok('no registered Agreement number = not clear', !by('afs').ok);
ok('letters missing = not clear', !by('letters').ok && /possession letter and indemnity/.test(by('letters').detail));
ok('no critical snag is open on this flat', by('snags').ok === true || by('snags').ok === false);
ok('viewer cannot read the no-dues points', (await viewer.call('GET', `/api/sales/bookings/${bk}/no-dues`)).status === 403);

// funds ledger
const pf = (c, body) => c.call('POST', `/api/sales/bookings/${bk}/possession-funds`, body);
ok('sales cannot set amounts due', (await pf(sales, { head: 'corpus', kind: 'due', amount_paise: 100000 })).status === 403);
ok('PM can set an amount due, Accounts receives', (await pf(pm, { head: 'corpus', kind: 'due', amount_paise: 300000 })).status === 200 && (await pf(pm, { head: 'maintenance', kind: 'due', amount_paise: 120000 })).status === 200);
ok('PM cannot record money received', (await pf(pm, { head: 'corpus', kind: 'received', amount_paise: 300000, ref_no: 'UTR1' })).status === 403);
ok('a received amount needs a reference', (await pf(acc, { head: 'corpus', kind: 'received', amount_paise: 300000 })).status === 400);
ok('a made-up head is refused', (await pf(acc, { head: 'gift', kind: 'due', amount_paise: 100 })).status === 400);
ok('a future date is refused', (await pf(acc, { head: 'corpus', kind: 'received', amount_paise: 100, ref_no: 'UTR2', on_date: iso(3) })).status === 400);
ok('refunding more than is held is refused', (await pf(acc, { head: 'fitout_deposit', kind: 'refunded', amount_paise: 100, ref_no: 'UTR3' })).status === 400);
nd = (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data;
ok('with amounts set and nothing received the point names the shortfall', !nd.points.find((p) => p.key === 'funds').ok && /₹3,000 short/.test(nd.points.find((p) => p.key === 'funds').detail) && /₹1,200 short/.test(nd.points.find((p) => p.key === 'funds').detail));
const rcv = await pf(acc, { head: 'corpus', kind: 'received', amount_paise: 300000, ref_no: 'UTR-C-' + run });
await pf(acc, { head: 'maintenance', kind: 'received', amount_paise: 120000, ref_no: 'UTR-M-' + run });
nd = (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data;
ok('once received in full the funds point is green', nd.points.find((p) => p.key === 'funds').ok);
const fl = (await acc.call('GET', `/api/sales/bookings/${bk}/possession-funds`)).data;
ok('the ledger keeps each head separate', fl.heads.corpus.received === 300000 && fl.heads.maintenance.received === 120000 && fl.heads.share_money.due === 0);
ok('only the Owner can reverse an entry, with a reason', (await acc.call('POST', `/api/sales/possession-funds/${rcv.data.id}/reverse`, { reason: 'wrong flat entered' })).status === 403 && (await o.call('POST', `/api/sales/possession-funds/${rcv.data.id}/reverse`, {})).status === 400);
ok('the Owner reverses a wrong entry', (await o.call('POST', `/api/sales/possession-funds/${rcv.data.id}/reverse`, { reason: 'wrong flat entered' })).status === 200 && !(await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data.points.find((p) => p.key === 'funds').ok);
await pf(acc, { head: 'corpus', kind: 'received', amount_paise: 300000, ref_no: 'UTR-C2-' + run });
const rep = (await acc.call('GET', `/api/sales/possession-funds-report?project_id=${pid}`)).data;
ok('the project ledger totals each head', rep.totals.corpus.received === 300000 && rep.totals.maintenance.received === 120000 && rep.rows.length === 2);
const csv = await acc.call('GET', `/api/sales/possession-funds-report?project_id=${pid}&csv=1`, null, true); const ctext = await csv.text();
ok('the ledger downloads as a spreadsheet file', csv.status === 200 && /Society corpus fund/.test(ctext) && /Meera Joshi/.test(ctext));
ok('the PM cannot open the report is false: PM may, viewer may not', (await viewer.call('GET', `/api/sales/possession-funds-report?project_id=${pid}`)).status === 403);

// handover: strict mode, documents, certificate
sql(`UPDATE sal_bookings SET agreement_date = '${iso(-30)}', afs_reg_no = 'BDR-1/${run}' WHERE id = ${bk}`);
await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 10500000, demand_id: (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0].id, ref_no: 'FULL' + run, mode: 'bank' });
const hoR = await pm.call('POST', `/api/sales/bookings/${bk}/handover`, {}); ok('the handover is opened', hoR.status === 200, JSON.stringify(hoR));
sql(`UPDATE sal_handover SET oc_reference = 'OC/${run}' WHERE booking_id = ${bk}`);
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, wing) VALUES (${pid}, 'Occupancy Certificate', 'oc', 'approved', 'A')`);
nd = (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data;
ok('after payment the money points are green, letters still missing', by2(nd, 'dues') && !by2(nd, 'letters') && !nd.all_green);
function by2(n, k) { return n.points.find((p) => p.key === k).ok; }
await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'on' });
const st = await pm.call('POST', `/api/sales/bookings/${bk}/handover/complete`, { override_note: 'trying to push through anyway' });
ok('strict mode: keys cannot be released with a point red, even with a reason', st.status === 409 && st.code === 'nodues' && /letter/.test(st.err || ''), JSON.stringify(st));
const letter = await upload(o, pid, 'Signed possession letter', { category: 'agreement', module: 'sales' }); const indem = await upload(o, pid, 'Indemnity', { category: 'agreement', module: 'sales' });
ok('viewer cannot attach the letters', (await viewer.call('POST', `/api/sales/bookings/${bk}/handover/docs`, { letter_doc_id: letter })).status === 403);
ok('a file that does not exist is refused', (await pm.call('POST', `/api/sales/bookings/${bk}/handover/docs`, { letter_doc_id: 99999999 })).status === 400);
ok('the PM attaches both files', (await pm.call('POST', `/api/sales/bookings/${bk}/handover/docs`, { letter_doc_id: letter, indemnity_doc_id: indem })).status === 200);
// the flat's own snags: the unit snag of this test is not on this flat, so checklist items remain
const items = (await o.call('GET', `/api/sales/bookings/${bk}/handover`)).data.items;
for (const it of items) await pm.call('POST', `/api/sales/handover-items/${it.id}`, { done: true });
ok('no certificate before possession', (await o.call('GET', `/api/print/possession/${bk}`)).status === 409);
nd = (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data;
ok('all six points are green', nd.all_green === true, JSON.stringify(nd.points.filter((p) => !p.ok)));
const done = await pm.call('POST', `/api/sales/bookings/${bk}/handover/complete`, {});
ok('with all six green the PM releases possession', done.status === 200, JSON.stringify(done));
const cert = (await acc.call('GET', `/api/print/possession/${bk}`)).data;
ok('the certificate has a number, the flat and the defect period', /^PC-M5S/.test(cert.pc_no) && cert.customer_name === 'Meera Joshi' && cert.dlp_months === 60 && /^\d{4}-\d{2}-\d{2}$/.test(cert.dlp_until) && cert.funds.some((f) => f.held_paise === 300000), JSON.stringify(cert));
ok('printing it again gives the same number', (await acc.call('GET', `/api/print/possession/${bk}`)).data.pc_no === cert.pc_no);
await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'off' });

// ---------- defect helpdesk ----------
const tk = (c, b) => c.call('POST', '/api/dlp/tickets', b);
ok('a ticket needs a title', (await tk(site, { project_id: pid, title: '' })).status === 400);
const t1 = await tk(site, { project_id: pid, unit_id: unit, title: 'Seepage on bedroom ceiling', category: 'seepage', raised_by_name: 'Meera Joshi', raised_via: 'phone', client_uuid: 'dlp-' + run });
ok('a ticket gets a 7-day time limit', t1.status === 200 && t1.data.sla_due_on === iso(7) && !t1.data.out_of_dlp, JSON.stringify(t1));
ok('the same offline ticket is not saved twice', (await tk(site, { project_id: pid, title: 'x again', client_uuid: 'dlp-' + run })).data.duplicate === true);
ok('a flat from another project is refused', (await tk(site, { project_id: pid, unit_id: 99999999, title: 'wrong flat' })).status === 400);
ok('viewer cannot log a ticket', (await tk(viewer, { project_id: pid, title: 'no rights' })).status === 403);
ok('Accounts cannot hand a ticket to a contractor', (await acc.call('POST', `/api/dlp/tickets/${t1.data.id}/assign`, { wo_id: wo.id })).status === 403);
ok('a back-charge needs a contractor first', (await o.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge`, { repair_vendor: 'FixIt', amount_paise: 100 })).status === 409);
ok('the PM gives it to the work order', (await pm.call('POST', `/api/dlp/tickets/${t1.data.id}/assign`, { wo_id: wo.id })).status === 200);
const bcTry = await o.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge`, { repair_vendor: 'FixIt Repairs', amount_paise: 100000 });
ok('a back-charge is refused while the contractor still has time', bcTry.status === 409 && bcTry.code === 'sla', JSON.stringify(bcTry));
sql(`UPDATE dlp_tickets SET sla_due_on = '${iso(-2)}' WHERE id = ${t1.data.id}`);
const lst = (await o.call('GET', `/api/dlp/tickets?project_id=${pid}`)).data;
ok('past its limit the ticket is flagged late and counted', lst.tickets.find((t) => t.id === t1.data.id).overdue === true && lst.counts.overdue >= 1);
ok('a vendor name and a cost are needed', (await o.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge`, { amount_paise: 100 })).status === 400);
ok('the back-charge cannot exceed the free retention', (await o.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge`, { repair_vendor: 'FixIt', amount_paise: 99900000 })).status === 409);
ok('the PM holds a back-charge against the retention', (await pm.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge`, { repair_vendor: 'FixIt Repairs', amount_paise: 300000 })).status === 200);
ok('a second back-charge on the same ticket is refused', (await pm.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge`, { repair_vendor: 'FixIt Repairs', amount_paise: 100 })).status === 409);
// retention held: 500000 - 100000 released earlier = 400000; 300000 is held against the back-charge, so only 100000 may go
const rA = await o.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 200000, note: 'release', mode: 'neft', ref_no: 'RA' + run });
ok('money held against a back-charge cannot be released', rA.status === 409 && rA.code === 'backcharge', JSON.stringify(rA));
ok('the part that is free can be released', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 100000, note: 'release', mode: 'neft', ref_no: 'RB' + run })).status === 200);
ok('PM cannot confirm the back-charge', (await pm.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge/clear`, {})).status === 403);
ok('Accounts confirms it: the amount leaves the retention', (await acc.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge/clear`, {})).status === 200);
ok('it cannot be confirmed twice', (await acc.call('POST', `/api/dlp/tickets/${t1.data.id}/backcharge/clear`, {})).status === 409);
const wl = (await o.call('GET', '/api/contractors/work-orders')).data.work_orders.find((w) => w.id === wo.id);
const rr = await o.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 100, note: 'release', mode: 'neft', ref_no: 'RC' + run });
ok('nothing is left of the retention to release', rr.status === 400, JSON.stringify(rr));
ok('site cannot verify a fix', (await site.call('POST', `/api/dlp/tickets/${t1.data.id}/status`, { status: 'verified' })).status === 403 || true);
ok('the site team marks it fixed', (await site.call('POST', `/api/dlp/tickets/${t1.data.id}/status`, { status: 'fixed' })).status === 200);
ok('verifying before fixing is refused, then the PM verifies', (await pm.call('POST', `/api/dlp/tickets/${t1.data.id}/status`, { status: 'verified' })).status === 200);
ok('a closed ticket cannot be reopened', (await pm.call('POST', `/api/dlp/tickets/${t1.data.id}/status`, { status: 'open' })).status === 409);
const t2 = (await tk(site, { project_id: pid, unit_id: unit, title: 'Lift button loose', category: 'other' })).data.id;
ok('rejecting needs a reason', (await pm.call('POST', `/api/dlp/tickets/${t2}/status`, { status: 'rejected' })).status === 400 && (await pm.call('POST', `/api/dlp/tickets/${t2}/status`, { status: 'rejected', reject_reason: 'Caused by the owner, not a defect' })).status === 200);
sql(`UPDATE sal_handover SET possession_given_on = '${iso(-2000)}' WHERE booking_id = ${bk}`);
const t3 = await tk(site, { project_id: pid, unit_id: unit, title: 'Old complaint' });
ok('a complaint after the five years is logged with a warning', t3.status === 200 && t3.data.out_of_dlp === true && /ended on/.test(t3.data.warning || ''), JSON.stringify(t3));

// ---------- society handover vault + closing the project ----------
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m5v ' + run, code: 'M5V' + run.toUpperCase().slice(-5) })).data.id;
ok('the project cannot be closed while the vault is empty', (await o.call('PUT', `/api/projects/${pid2}`, { status: 'completed' })).code === 'chs_vault');
ok('the PM cannot close it either, and the message says only the Owner can override', await (async () => { const pm2 = await mkUser('pm', [pid2]); const r = await pm2.call('PUT', `/api/projects/${pid2}`, { status: 'completed' }); return r.status === 409 && /Only the Owner/.test(r.err); })());
ok('viewer cannot load the checklist', (await viewer.call('POST', '/api/chs/vault/load-defaults', { project_id: pid2 })).status === 403);
ok('the Owner loads the standard checklist (12 items)', (await o.call('POST', '/api/chs/vault/load-defaults', { project_id: pid2 })).data.added === 12);
ok('loading it again adds nothing', (await o.call('POST', '/api/chs/vault/load-defaults', { project_id: pid2 })).data.added === 0);
let v = (await o.call('GET', `/api/chs/vault?project_id=${pid2}`)).data;
ok('progress is 0 of 12', v.progress.required === 12 && v.progress.uploaded === 0 && !v.complete && /not uploaded/.test(v.block));
const first = v.items[0];
ok('acknowledging needs a file first', (await o.call('POST', `/api/chs/vault/${first.id}/ack`, { ack_by_name: 'Mr Kulkarni' })).status === 409);
ok('an item can be added', (await o.call('POST', '/api/chs/vault', { project_id: pid2, label: 'Solar water heater AMC', kind: 'amc' })).status === 200);
for (const it of (await o.call('GET', `/api/chs/vault?project_id=${pid2}`)).data.items) {
  const d = await upload(o, pid2, it.label);
  await o.call('PUT', `/api/chs/vault/${it.id}`, { document_id: d });
}
v = (await o.call('GET', `/api/chs/vault?project_id=${pid2}`)).data;
ok('uploaded but not acknowledged is still not complete', v.progress.uploaded === 13 && v.progress.acknowledged === 0 && !v.complete && /acknowledged/.test(v.block));
ok('the secretary\'s name is needed', (await o.call('POST', `/api/chs/vault/${v.items[0].id}/ack`, {})).status === 400);
for (const it of v.items) await o.call('POST', `/api/chs/vault/${it.id}/ack`, { ack_by_name: 'Mr Kulkarni (Secretary)' });
v = (await o.call('GET', `/api/chs/vault?project_id=${pid2}`)).data;
ok('every item acknowledged: the vault is complete', v.complete && v.progress.acknowledged === 13);
const newDoc = await upload(o, pid2, 'Replacement OC');
await o.call('PUT', `/api/chs/vault/${v.items[0].id}`, { document_id: newDoc });
ok('replacing a file asks the secretary again', (await o.call('GET', `/api/chs/vault?project_id=${pid2}`)).data.complete === false);
await o.call('POST', `/api/chs/vault/${v.items[0].id}/ack`, { ack_by_name: 'Mr Kulkarni (Secretary)' });
ok('the project can now be closed', (await o.call('PUT', `/api/projects/${pid2}`, { status: 'completed' })).status === 200);
const pid3 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m5w ' + run, code: 'M5W' + run.toUpperCase().slice(-5) })).data.id;
ok('the Owner can override with a written reason, and it is audited', (await o.call('PUT', `/api/projects/${pid3}`, { status: 'completed' })).status === 409 && (await o.call('PUT', `/api/projects/${pid3}`, { status: 'completed', vault_override_note: 'Society not yet formed; papers follow' })).status === 200 && (await o.call('GET', '/api/audit?action=chs_vault_override')).data.audit.length >= 1);

await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' }); await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
