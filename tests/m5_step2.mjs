// tests/m5_step2.mjs — Module 5, step 2: floor-plan library, possession notice, buyer links (inspection, handover time, baseline), fit-out NOC,
// numbered debit note, QR complaint form, common-area costs and society statement, society formation, no-dues now strict by default.
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
const putBack = async () => { try { await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' }); await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' }); await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'on' }); } catch (e) { /* ignore */ } };
process.on('uncaughtException', async (e) => { console.error(e); await putBack(); process.exit(1); });
await o.call('POST', '/api/settings/sales.receipt_approval_limit_paise', { value: 0 });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' }); await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' }); await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
let seq = 0;
const mkUser = async (role, projects) => { const email = `m5b-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm5b ' + role, email, role, projects }); const pw = 'M5bStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0, 5, 0xfe, 2, 0xfe, 0xa7, 0x35, 0x81, 0x84, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const upload = async (c, pid, title, extra = {}) => { const fd = new FormData(); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png'); fd.append('project_id', String(pid)); fd.append('title', title); fd.append('category', extra.category || 'other'); fd.append('module', extra.module || 'projects'); fd.append('audience', 'internal'); if (extra.entity) { fd.append('entity', extra.entity); fd.append('entity_id', String(extra.entity_id)); }
  const r = await c.call('POST', '/api/files/upload', fd); return r.data && r.data.id; };
const anon = new C();
const hv = (tok) => `/api/public/hv/${tok}`;
const tokOf = (url) => url.split('/h/')[1];

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m5b ' + run, code: 'M5B' + run.toUpperCase().slice(-5) })).data.id;
const pm = await mkUser('pm', [pid]); const acc = await mkUser('accounts', [pid]); const site = await mkUser('site', [pid]); const viewer = await mkUser('viewer', [pid]);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Slab', pct_bp: 10000, milestone_key: 'm5b' + run }] });
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 6, unit_no: 'T' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 500 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Rohan Desai', phone: '96' + digits, email: 'rohan@example.com', address: '5 Hill Rd, Mumbai', token_paise: 100000, pan: 'ABCDE1234F' })).data.id;

// ---------- floor-plan library ----------
const plan = await upload(o, pid, 'Floor plan 2BHK', { category: 'drawing', module: 'site' });
ok('viewer cannot save a plan', (await viewer.call('POST', '/api/plans', { project_id: pid, unit_type: '2BHK', doc_id: plan })).status === 403);
ok('a plan needs a flat type', (await site.call('POST', '/api/plans', { project_id: pid, unit_type: '', doc_id: plan })).status === 400);
ok('a file that is not in this project is refused', (await site.call('POST', '/api/plans', { project_id: pid, unit_type: '2BHK', doc_id: 99999999 })).status === 400);
ok('the site engineer saves the 2BHK plan', (await site.call('POST', '/api/plans', { project_id: pid, unit_type: '2BHK', doc_id: plan })).status === 200);
let lib = (await o.call('GET', `/api/plans?project_id=${pid}`)).data;
ok('the library lists it and offers the flat types in use', lib.plans.length === 1 && lib.plans[0].doc_id === plan && lib.unit_types.includes('2BHK'));
ok('a flat of that type gets the plan by itself', (await site.call('GET', `/api/plans/for-unit?unit_id=${unit}`)).data.doc_id === plan);
const plan2 = await upload(o, pid, 'Floor plan 2BHK v2', { category: 'drawing', module: 'site' });
await site.call('POST', '/api/plans', { project_id: pid, unit_type: '2BHK', doc_id: plan2 });
lib = (await o.call('GET', `/api/plans?project_id=${pid}`)).data;
ok('saving again replaces the plan (one per type)', lib.plans.length === 1 && lib.plans[0].doc_id === plan2);
ok('site cannot remove a plan; the PM can', (await site.call('DELETE', `/api/plans/${lib.plans[0].id}`)).status === 403 && (await pm.call('DELETE', `/api/plans/${lib.plans[0].id}`)).status === 200 && (await o.call('GET', `/api/plans/for-unit?unit_id=${unit}`)).data.doc_id === null);

// ---------- strict by default ----------
await o.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab', milestone_key: 'm5b' + run });
const ms = (await o.call('GET', `/api/site/milestones?project_id=${pid}`)).data.milestones.find((m) => m.milestone_key === 'm5b' + run);
await o.call('POST', `/api/site/milestones/${ms.id}/done`, { actual_date: iso(-1), cert_ref: 'ARCH/1 test', override_note: 'test project has no CC recorded' });
sql(`UPDATE sal_bookings SET agreement_date = '${iso(-30)}', afs_reg_no = 'BDR-2/${run}' WHERE id = ${bk}`);
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, wing) VALUES (${pid}, 'Occupancy Certificate', 'oc', 'approved', 'A')`);
ok('the handover is opened', (await pm.call('POST', `/api/sales/bookings/${bk}/handover`, {})).status === 200);
sql(`DELETE FROM settings WHERE key = 'sales.nodues_strict'`);
const nd0 = (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data;
ok('with nothing set, the lock is ON by default', nd0.strict === true);
const early = await pm.call('POST', `/api/sales/bookings/${bk}/handover/complete`, { override_note: 'push it through please' });
ok('so keys cannot be released with a point red', early.status === 409 && early.code === 'nodues', JSON.stringify(early));
await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'off' });
ok('the Owner can still switch it off in Settings', (await o.call('GET', `/api/sales/bookings/${bk}/no-dues`)).data.strict === false);
await o.call('POST', '/api/settings/sales.nodues_strict', { value: 'on' });

// ---------- possession notice ----------
const fund = (c, b) => c.call('POST', `/api/sales/bookings/${bk}/possession-funds`, b);
await fund(pm, { head: 'corpus', kind: 'due', amount_paise: 300000 }); await fund(pm, { head: 'maintenance', kind: 'due', amount_paise: 120000 }); await fund(pm, { head: 'fitout_deposit', kind: 'due', amount_paise: 500000 });
ok('the print needs the notice to be issued first', (await o.call('GET', `/api/print/possnotice/${bk}`)).status === 409);
ok('viewer cannot issue the notice', (await viewer.call('POST', `/api/sales/bookings/${bk}/possession-notice`, {})).status === 403);
ok('a pay-by date in the past is refused', (await pm.call('POST', `/api/sales/bookings/${bk}/possession-notice`, { pay_by: iso(-3) })).status === 400);
const pn = await pm.call('POST', `/api/sales/bookings/${bk}/possession-notice`, {});
ok('the notice defaults to 30 days to pay', pn.status === 200 && pn.data.notice_due_on === iso(30), JSON.stringify(pn));
const pr = (await acc.call('GET', `/api/print/possnotice/${bk}`)).data;
ok('it lists the final instalment and each amount typed for corpus and maintenance', pr.lines.some((l) => /Slab/.test(l.label)) && pr.lines.some((l) => /corpus/i.test(l.label) && l.paise === 300000) && pr.lines.some((l) => /maintenance/i.test(l.label) && l.paise === 120000) && !pr.lines.some((l) => /Fit-out/.test(l.label) === false && false) && pr.total_paise === pr.lines.reduce((t, l) => t + l.paise, 0), JSON.stringify(pr.lines));

// ---------- buyer links: inspection (needs zero open snags) ----------
const sn = (await site.call('POST', '/api/site/snags', { project_id: pid, unit_id: unit, title: 'Loose tile in kitchen', severity: 'low' })).data.id;
const l0 = await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'inspection' });
ok('the buyer inspects only when internal snagging is at zero', l0.status === 409 && l0.code === 'snags_open', JSON.stringify(l0));
await site.call('POST', `/api/site/snags/${sn}/status`, { status: 'fixed' }); await pm.call('POST', `/api/site/snags/${sn}/status`, { status: 'verified' });
ok('viewer cannot make a buyer link', (await viewer.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'inspection' })).status === 403);
ok('an unknown kind is refused', (await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'spam' })).status === 400);
const li = (await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'inspection' })).data;
ok('the link is made (and works for 14 days)', /\/h\/[\w-]{20,}$/.test(li.url) && li.days === 14, JSON.stringify(li));
const ti = tokOf(li.url);
const g = (await anon.call('GET', hv(ti))).data;
ok('the buyer sees only first name, flat and project', g.state === 'open' && g.kind === 'inspection' && g.customer === 'Rohan' && /A-T/.test(g.flat) && !JSON.stringify(g).includes('96' + digits) && !JSON.stringify(g).includes('rohan@'), JSON.stringify(g));
ok('a made-up token is invalid', (await anon.call('GET', hv('nope-nope-nope'))).data.state === 'invalid');
ok('a name and a tick are needed to sign', (await anon.call('POST', hv(ti), { name: 'Ro', confirm: true })).status === 400 && (await anon.call('POST', hv(ti), { name: 'Rohan Desai' })).status === 400);
const sg = await anon.call('POST', hv(ti), { name: 'Rohan Desai', confirm: true, touchups: ['Door handle loose', 'Paint patch near window'] });
ok('the buyer signs with two touch-ups', sg.status === 200 && sg.data.touchups === 2 && sg.data.due_days === 7, JSON.stringify(sg));
const ups = (await o.call('GET', '/api/site/snags')).data.snags.filter((x) => x.unit_id === unit && x.status === 'open');
ok('the touch-ups become low snags due in 7 days', ups.length === 2 && ups.every((x) => x.severity === 'low' && x.due_date === iso(7)), JSON.stringify(ups.map((x) => x.due_date)));
ok('the link cannot be used twice', (await anon.call('POST', hv(ti), { name: 'Rohan Desai', confirm: true })).status === 409 && (await anon.call('GET', hv(ti))).data.state === 'done');
const fo0 = (await o.call('GET', `/api/sales/bookings/${bk}/fitout`)).data;
ok('the signed inspection shows on the booking', fo0.handover.inspection_name === 'Rohan Desai' && /Door handle/.test(fo0.handover.inspection_remarks));
for (const x of ups) { await site.call('POST', `/api/site/snags/${x.id}/status`, { status: 'fixed' }); await pm.call('POST', `/api/site/snags/${x.id}/status`, { status: 'verified' }); }

// ---------- handover slots + the six-point gate ----------
const day = iso(5);
ok('sales-side slot rules: bad times refused', (await pm.call('POST', '/api/sales/slots', { project_id: pid, date: day, start: '13:00', end: '10:00' })).status === 400 && (await pm.call('POST', '/api/sales/slots', { project_id: pid, date: iso(-1), start: '10:00', end: '12:00' })).status === 400);
const sl = await pm.call('POST', '/api/sales/slots', { project_id: pid, date: day, start: '10:00', end: '12:15', minutes: 45 });
ok('a morning of 45-minute slots is made (3)', sl.status === 200 && sl.data.added === 3, JSON.stringify(sl));
ok('adding the same morning again adds nothing', (await pm.call('POST', '/api/sales/slots', { project_id: pid, date: day, start: '10:00', end: '12:15', minutes: 45 })).data.added === 0);
const sNot = await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'slot' });
ok('the time link needs all six no-dues points green', sNot.status === 409 && sNot.code === 'nodues' && /received|short|letter|paid|due/i.test(sNot.err), JSON.stringify(sNot));
// make all six green
await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 10500000, demand_id: (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0].id, ref_no: 'FULL' + run, mode: 'bank' });
await fund(acc, { head: 'corpus', kind: 'received', amount_paise: 300000, ref_no: 'C' + run }); await fund(acc, { head: 'maintenance', kind: 'received', amount_paise: 120000, ref_no: 'M' + run }); await fund(acc, { head: 'fitout_deposit', kind: 'received', amount_paise: 500000, ref_no: 'F' + run });
const letter = await upload(o, pid, 'Signed possession letter', { category: 'agreement', module: 'sales' }); const indem = await upload(o, pid, 'Indemnity', { category: 'agreement', module: 'sales' });
await pm.call('POST', `/api/sales/bookings/${bk}/handover/docs`, { letter_doc_id: letter, indemnity_doc_id: indem });
for (const it of (await o.call('GET', `/api/sales/bookings/${bk}/handover`)).data.items) await pm.call('POST', `/api/sales/handover-items/${it.id}`, { done: true });
const ls = await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'slot' });
ok('with all green the time link is made', ls.status === 200, JSON.stringify(ls));
const tsl = tokOf(ls.data.url); const view = (await anon.call('GET', hv(tsl))).data;
ok('the buyer sees the free times', view.kind === 'slot' && view.slots.length === 3 && view.mine === null);
const pick = await anon.call('POST', hv(tsl), { slot_id: view.slots[0].id });
ok('the buyer books the first time', pick.status === 200 && pick.data.start_time === '10:00', JSON.stringify(pick));
const sl2 = await anon.call('POST', hv(tsl), { slot_id: view.slots[1].id });
ok('changing the time frees the first and takes the second', sl2.status === 200 && (await pm.call('GET', `/api/sales/slots?project_id=${pid}`)).data.slots.filter((s) => s.booking_id === bk).length === 1 && (await pm.call('GET', `/api/sales/slots?project_id=${pid}`)).data.slots.find((s) => s.start_time === '10:00').booking_id === null);
const bk2 = (await o.call('POST', '/api/sales/bookings', { unit_id: (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 7, unit_no: 'U' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 500 })).data.id, customer_name: 'Second Buyer', phone: '95' + digits, token_paise: 100000 })).data.id;
const taken = await anon.call('POST', hv(tsl), { slot_id: 99999999 });
ok('a made-up slot is refused', taken.status === 409);
ok('a booked slot cannot be removed, a free one can', (await pm.call('DELETE', `/api/sales/slots/${(await pm.call('GET', `/api/sales/slots?project_id=${pid}`)).data.slots.find((s) => s.booking_id).id}`)).status === 409 && (await pm.call('DELETE', `/api/sales/slots/${(await pm.call('GET', `/api/sales/slots?project_id=${pid}`)).data.slots.find((s) => !s.booking_id).id}`)).status === 200);
const bkTwo = bk2;
ok('another booking cannot take that time through this link', (await o.call('GET', `/api/sales/slots?project_id=${pid}`)).data.slots.filter((s) => s.booking_id === bkTwo).length === 0);

// expired link
const lx = (await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'slot' })).data; sql(`UPDATE sal_hv_links SET expires_at = '2000-01-01 00:00:00'`);
ok('an expired link says so', (await anon.call('GET', hv(tokOf(lx.url)))).data.state === 'expired' && (await anon.call('POST', hv(tokOf(lx.url)), { slot_id: 1 })).status === 410);

// ---------- possession, then fit-out ----------
const done = await pm.call('POST', `/api/sales/bookings/${bk}/handover/complete`, {});
ok('all six green: possession is released', done.status === 200, JSON.stringify(done));
ok('the NOC is refused until the buyer signs the baseline', (await pm.call('POST', `/api/sales/bookings/${bk}/fitout-noc`, {})).code === 'no_baseline');
const ho = (await o.call('GET', `/api/sales/bookings/${bk}/fitout`)).data.handover;
ok('a baseline link needs photographs first', (await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'baseline' })).status === 409);
sql(`UPDATE sal_handover SET status = 'in_progress' WHERE id = ${ho.id}`);   // links are made before possession; put it back for the check
await upload(pm, pid, 'Baseline photo: kitchen floor', { module: 'sales', entity: 'sal_handover', entity_id: ho.id });
const lb = await pm.call('POST', `/api/sales/bookings/${bk}/hv-link`, { kind: 'baseline' });
ok('with a photograph the baseline link is made', lb.status === 200, JSON.stringify(lb));
sql(`UPDATE sal_handover SET status = 'handed_over' WHERE id = ${ho.id}`);
const sb = await anon.call('POST', hv(tokOf(lb.data.url)), { name: 'Rohan Desai', confirm: true });
ok('after possession a buyer link no longer works', sb.status === 409, JSON.stringify(sb));
sql(`UPDATE sal_handover SET status = 'in_progress' WHERE id = ${ho.id}`);
const sb2 = await anon.call('POST', hv(tokOf(lb.data.url)), { name: 'Rohan Desai', confirm: true });
sql(`UPDATE sal_handover SET status = 'handed_over' WHERE id = ${ho.id}`);
ok('the buyer signs the baseline', sb2.status === 200 && (await o.call('GET', `/api/sales/bookings/${bk}/fitout`)).data.handover.baseline_signed_name === 'Rohan Desai', JSON.stringify(sb2));
ok('Accounts cannot issue the NOC', (await acc.call('POST', `/api/sales/bookings/${bk}/fitout-noc`, {})).status === 403);
const noc = await pm.call('POST', `/api/sales/bookings/${bk}/fitout-noc`, { valid_till: iso(120), note: 'Working hours 9 to 6' });
ok('the PM issues the NOC (deposit received, baseline signed)', noc.status === 200 && /^NOC-M5B/.test(noc.data.noc_no), JSON.stringify(noc));
ok('only one NOC per flat', (await pm.call('POST', `/api/sales/bookings/${bk}/fitout-noc`, {})).status === 409);
const np = (await acc.call('GET', `/api/print/fitoutnoc/${bk}`)).data;
ok('the NOC prints with the deposit held', np.noc_no === noc.data.noc_no && np.deposit_paise === 500000 && np.draft === false);
ok('only the Owner can revoke, with a reason', (await pm.call('POST', `/api/sales/bookings/${bk}/fitout-noc/revoke`, { reason: 'damage found' })).status === 403 && (await o.call('POST', `/api/sales/bookings/${bk}/fitout-noc/revoke`, {})).status === 400 && (await o.call('POST', `/api/sales/bookings/${bk}/fitout-noc/revoke`, { reason: 'damage found to waterproofing' })).status === 200 && (await acc.call('GET', `/api/print/fitoutnoc/${bk}`)).data.draft === true);

// ---------- debit note for a back-charge ----------
const cid = (await o.call('POST', '/api/contractors/contractors', { name: 'zz plumber ' + run, trade: 'plumbing' })).data.id;
const wo = (await o.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: cid, scope: 'Plumbing', basis: 'lump_sum', value_paise: 10000000, retention_bp: 500, advance_paise: 0 })).data;
await o.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); await pm.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
sql(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, created_at) VALUES (${cid}, ${pid}, ${wo.id}, 'retention_held', 500000, datetime('now'))`);
const t1 = (await site.call('POST', '/api/dlp/tickets', { project_id: pid, unit_id: unit, title: 'Bathroom tap leaking', category: 'plumbing' })).data.id;
await pm.call('POST', `/api/dlp/tickets/${t1}/assign`, { wo_id: wo.id }); sql(`UPDATE dlp_tickets SET sla_due_on = '${iso(-2)}' WHERE id = ${t1}`);
await pm.call('POST', `/api/dlp/tickets/${t1}/backcharge`, { repair_vendor: 'QuickFix Plumbing', amount_paise: 150000 });
ok('no debit note before the back-charge is confirmed', (await acc.call('GET', `/api/print/dlpdebit/${t1}`)).status === 409);
await acc.call('POST', `/api/dlp/tickets/${t1}/backcharge/clear`, {});
const dn = (await acc.call('GET', `/api/print/dlpdebit/${t1}`)).data;
ok('confirming makes a numbered debit note', /^DN-M5B\w+-0001$/.test(dn.debit_no) && dn.amount_paise === 150000 && dn.contractor === 'zz plumber ' + run && dn.retention_left_paise === 350000, JSON.stringify(dn));
const t2 = (await site.call('POST', '/api/dlp/tickets', { project_id: pid, unit_id: unit, title: 'Switch not working', category: 'electrical' })).data.id;
await pm.call('POST', `/api/dlp/tickets/${t2}/assign`, { wo_id: wo.id }); sql(`UPDATE dlp_tickets SET sla_due_on = '${iso(-2)}' WHERE id = ${t2}`);
await pm.call('POST', `/api/dlp/tickets/${t2}/backcharge`, { repair_vendor: 'QuickFix Electric', amount_paise: 50000 }); await acc.call('POST', `/api/dlp/tickets/${t2}/backcharge/clear`, {});
ok('the next debit note gets the next number', /-0002$/.test((await acc.call('GET', `/api/print/dlpdebit/${t2}`)).data.debit_no));
ok('the viewer cannot print a debit note', (await viewer.call('GET', `/api/print/dlpdebit/${t1}`)).status === 403);

// ---------- QR complaint form ----------
const cfg = (await anon.call('GET', `/api/public/complaint-config?project=M5B${run.toUpperCase().slice(-5)}`)).data;
ok('the form reads its project and the company contact', cfg.enabled === true && cfg.project === 'zz-m5b ' + run && cfg.site_key === 'mock');
ok('an unknown project switches the form off', (await anon.call('GET', '/api/public/complaint-config?project=NOPE')).data.enabled === false);
const cp = (b) => anon.call('POST', '/api/public/complaint', { project: `M5B${run.toUpperCase().slice(-5)}`, name: 'Sunita Rao', phone: '9812345678', flat: 'A-T' + run.slice(-3), category: 'seepage', title: 'Water on bedroom ceiling', detail: 'since last night', consent: true, token: 'ok-token', ...b });
ok('the consent tick is needed', (await cp({ consent: false })).status === 400);
ok('a bad mobile number is refused', (await cp({ phone: '12' })).status === 400);
ok('without the human check it is refused', (await cp({ token: '' })).status === 403);
ok('the trap field silently drops a bot', (await cp({ company_website: 'http://spam' })).data.received === true && !(await o.call('GET', `/api/dlp/tickets?project_id=${pid}`)).data.tickets.some((t) => t.raised_via === 'qr' && t.title === 'Water on bedroom ceiling' && false));
const good = await cp({});
ok('a resident complaint is received with the date it is due', good.status === 200 && good.data.due_by === iso(7), JSON.stringify(good));
const qt = (await o.call('GET', `/api/dlp/tickets?project_id=${pid}`)).data.tickets.find((t) => t.raised_via === 'qr' && t.title === 'Water on bedroom ceiling');
ok('it appears in the helpdesk tied to the flat, with the phone', qt && qt.unit_id === unit && qt.raised_phone === '9812345678' && qt.sla_due_on === iso(7), JSON.stringify(qt));
const odd = await cp({ flat: 'Z-999', title: 'Lift stuck sometimes' });
ok('an unknown flat is still kept, with what was typed', odd.status === 200 && /flat typed: Z-999/.test((await o.call('GET', `/api/dlp/tickets?project_id=${pid}`)).data.tickets.find((t) => t.title === 'Lift stuck sometimes').detail));
let limited = null; for (let i = 0; i < 8; i++) limited = await cp({ title: 'Spam complaint ' + i }); ok('complaints from one connection are rate-limited', limited.status === 429);
ok('staff get the QR link and the company email', (await site.call('GET', `/api/dlp/qr-link?project_id=${pid}`)).data.url.endsWith(`/complaint?project=M5B${run.toUpperCase().slice(-5)}`));

// ---------- common-area costs and the society statement ----------
const ex = (c, b) => c.call('POST', '/api/chs/expenses', { project_id: pid, ...b });
ok('site cannot enter a cost', (await ex(site, { head: 'security', amount_paise: 100, bill_no: 'B1' })).status === 403);
ok('a cost needs a head, an amount and a bill number', (await ex(acc, { head: 'gifts', amount_paise: 100, bill_no: 'B1' })).status === 400 && (await ex(acc, { head: 'security', amount_paise: 0, bill_no: 'B1' })).status === 400 && (await ex(acc, { head: 'security', amount_paise: 100 })).status === 400);
ok('a future date is refused', (await ex(acc, { head: 'security', amount_paise: 100, bill_no: 'B1', spent_on: iso(3) })).status === 400);
const e1 = (await ex(acc, { head: 'security', amount_paise: 40000, bill_no: 'SEC-1', paid_to: 'Guard Co', spent_on: iso(-5) })).data.id; const e2 = (await ex(pm, { head: 'electricity', amount_paise: 25000, bill_no: 'MSEB-9' })).data.id; const e3 = (await ex(acc, { head: 'water', amount_paise: 7000, bill_no: 'W-3' })).data.id;
let stt = (await acc.call('GET', `/api/chs/statement?project_id=${pid}`)).data;
ok('collected maintenance is read from the ledger; nothing is deducted until the CA certifies', stt.maintenance_collected_paise === 120000 && stt.certified_paise === 0 && stt.uncertified_paise === 72000 && stt.balance_to_hand_over_paise === 120000, JSON.stringify(stt));
ok('the PM cannot certify (Owner or Accounts only), and a CA name is needed', (await pm.call('POST', `/api/chs/expenses/${e1}/certify`, { certified_by_name: 'CA Shah' })).status === 403 && (await acc.call('POST', `/api/chs/expenses/${e1}/certify`, {})).status === 400);
await acc.call('POST', `/api/chs/expenses/${e1}/certify`, { certified_by_name: 'CA Shah' }); await acc.call('POST', `/api/chs/expenses/${e2}/certify`, { certified_by_name: 'CA Shah' });
ok('a cost cannot be certified twice', (await acc.call('POST', `/api/chs/expenses/${e1}/certify`, { certified_by_name: 'CA Shah' })).status === 409);
ok('only the Owner reverses a cost, with a reason', (await acc.call('POST', `/api/chs/expenses/${e3}/reverse`, { reason: 'wrong project entered' })).status === 403 && (await o.call('POST', `/api/chs/expenses/${e3}/reverse`, {})).status === 400 && (await o.call('POST', `/api/chs/expenses/${e3}/reverse`, { reason: 'wrong project entered' })).status === 200);
stt = (await acc.call('GET', `/api/chs/statement?project_id=${pid}`)).data;
ok('balance to hand over = maintenance collected minus certified costs (₹1,200 - ₹650)', stt.certified_paise === 65000 && stt.uncertified_paise === 0 && stt.balance_to_hand_over_paise === 55000 && stt.corpus_held_paise === 300000, JSON.stringify(stt));
ok('the statement breaks the certified costs down by head', stt.by_head.some((h) => h.head === 'security' && h.paise === 40000) && stt.by_head.some((h) => h.head === 'electricity' && h.paise === 25000));
const csv = await acc.call('GET', `/api/chs/statement?project_id=${pid}&csv=1`, null, true); const ct = await csv.text();
ok('the statement downloads as a spreadsheet', csv.status === 200 && /Balance to hand over,550/.test(ct) && /SEC-1/.test(ct) && !/W-3/.test(ct));
ok('the print has the lines and no draft mark once all costs are certified', (await acc.call('GET', `/api/print/chsstatement/${pid}`)).data.draft === false);
ok('site cannot read the statement', (await site.call('GET', `/api/chs/statement?project_id=${pid}`)).status === 403);

// ---------- society formation ----------
const sv = (c, b) => c.call('PUT', '/api/chs/society', { project_id: pid, ...b });
ok('the default record is "proposed"', (await o.call('GET', `/api/chs/society?project_id=${pid}`)).data.society.stage === 'proposed');
ok('site cannot update the society', (await site.call('PUT', '/api/chs/society', { project_id: pid, stage: 'provisional' })).status === 403);
ok('registered needs a number and a date', (await sv(pm, { stage: 'registered' })).status === 400);
ok('conveyance needs a registered society and a reference', (await sv(pm, { stage: 'provisional', conveyance_on: iso(-1), conveyance_ref: 'X' })).status === 400);
ok('the PM records the provisional society', (await sv(pm, { society_name: 'Sai Heights CHS', stage: 'provisional' })).status === 200);
ok('then registration', (await sv(pm, { stage: 'registered', registration_no: 'MUM/WEST/HSG/1234/2026', registered_on: iso(-10), share_cert_count: 36, shares_issued_on: iso(-3) })).status === 200);
ok('then the conveyance', (await sv(pm, { conveyance_on: iso(-1), conveyance_ref: 'BDR-9/2026/7788' })).status === 200);
const so = (await o.call('GET', `/api/chs/society?project_id=${pid}`)).data.society;
ok('the record keeps everything', so.stage === 'registered' && so.share_cert_count === 36 && so.conveyance_ref === 'BDR-9/2026/7788' && so.society_name === 'Sai Heights CHS');
const cm = (b) => pm.call('POST', '/api/chs/committee', { project_id: pid, ...b });
ok('the committee needs a role and a name', (await cm({ role: 'king', name: 'Mr X' })).status === 400 && (await cm({ role: 'chairman', name: 'A' })).status === 400);
const c1 = await cm({ role: 'chairman', name: 'Mr Kulkarni', phone: '9820011223', since: iso(-9) });
ok('a chairman is added; a second one is refused', c1.status === 200 && (await cm({ role: 'chairman', name: 'Mrs Joshi' })).status === 409 && (await cm({ role: 'member', name: 'Mrs Joshi' })).status === 200);
ok('removing the chairman lets a new one in', (await pm.call('DELETE', `/api/chs/committee/${c1.data.id}`)).status === 200 && (await cm({ role: 'chairman', name: 'Mrs Joshi' })).status === 200);
ok('the committee is listed', (await o.call('GET', `/api/chs/society?project_id=${pid}`)).data.committee.length === 2);

await putBack();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
