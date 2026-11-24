// tests/m3_step2.mjs — Module 3 gaps, step 2: slab sign-offs, GST hold on RA bills, cost-to-complete, BOQ wing / floor.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, form) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !form) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36); const L = 100000;
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `m3b-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm3b ' + role, email, role, projects }); const pw = 'M3StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const pid = (await o.call('POST', '/api/projects', { name: 'zz-m3b ' + run, code: 'MB' + run.toUpperCase().slice(-6), type: 'new_build' })).data.id;
const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const site = await mkUser('site', [pid]); const acc = await mkUser('accounts', []);
await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, cc_upto_floor) VALUES (${pid}, 'Commencement Certificate', 'cc', 'approved', 20)`);
const photo = async (who, title) => { const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 's.png'); fd.append('title', title); fd.append('category', 'certificate'); fd.append('module', 'site'); fd.append('project_id', String(pid)); fd.append('audience', 'internal'); return (await who.call('POST', '/api/files/upload', fd, true)).data; };

// ---------- BOQ wing / floor ----------
const head = (await pm.call('POST', '/api/budget/heads', { project_id: pid, code: 'RC', name: 'RCC', budget_paise: 500 * L })).data.id;
await pm.call('POST', '/api/budget/boq', { project_id: pid, head_id: head, lines: [{ code: 'B1', description: 'Slab A3', unit: 'cum', qty: 10, rate_paise: 600000, wing: 'A', floor: 3 }, { code: 'B2', description: 'Slab B5', unit: 'cum', qty: 10, rate_paise: 600000, wing: 'B', floor: 5 }, { code: 'B3', description: 'Raft', unit: 'cum', qty: 50, rate_paise: 500000 }] });
const all = (await pm.call('GET', `/api/budget/boq?project_id=${pid}`)).data.items;
ok('BOQ lines keep wing and floor; a line without them is a standalone-building line', all.find((x) => x.code === 'B1').wing === 'A' && all.find((x) => x.code === 'B1').floor === 3 && all.find((x) => x.code === 'B3').wing === null);
ok('the list can be filtered by wing and by floor', (await pm.call('GET', `/api/budget/boq?project_id=${pid}&wing=B`)).data.items.length === 1 && (await pm.call('GET', `/api/budget/boq?project_id=${pid}&floor=3`)).data.items.length === 1);
const b3 = all.find((x) => x.code === 'B3');
ok('wing and floor can be set later without a reason (no money changes)', (await pm.call('PUT', `/api/budget/boq/${b3.id}`, { wing: 'Basement', floor: -1 })).status === 200 && (await pm.call('GET', `/api/budget/boq?project_id=${pid}&wing=Basement`)).data.items[0].floor === -1);
ok('a silly floor is refused', (await pm.call('PUT', `/api/budget/boq/${b3.id}`, { floor: 999 })).status === 400);
ok('the CSV has the new columns', /Wing \/ building,Floor/.test(await (await fetch(BASE + `/api/budget/boq?project_id=${pid}&csv=1`, { headers: { cookie: pm.cookie } })).text()));

// ---------- Slab sign-offs ----------
const mk = async (body) => { await pm.call('POST', '/api/site/milestones', { project_id: pid, ...body }); return (await pm.call('GET', '/api/site/milestones')).data.milestones.find((m) => m.name === body.name); };
const slab = await mk({ name: 'Slab 5 ' + run, milestone_key: 'k' + run, wing: 'A', floor: 5 });
const plain = await mk({ name: 'Brickwork ' + run, wing: 'A', floor: 5 });
const cert = (m) => pm.call('POST', `/api/site/milestones/${m.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/' + run });
const c0 = await cert(slab);
ok('a payment-linked stage cannot be certified with no sign-offs', c0.status === 409 && c0.code === 'signoff', JSON.stringify(c0));
ok('a stage that triggers no demands is not held up by sign-offs', (await cert(plain)).status === 200);
const p1 = await photo(site, 'eng'), p2 = await photo(site, 'rcc');
ok('the Site Engineer uploads their sign-off', (await site.call('POST', `/api/site/milestones/${slab.id}/signoffs`, { kind: 'site_engineer', document_id: p1.id })).status === 200);
ok('still blocked: the consultant report is missing', /RCC consultant/.test((await cert(slab)).err || ''));
ok('the site team can upload the consultant report too', (await site.call('POST', `/api/site/milestones/${slab.id}/signoffs`, { kind: 'rcc_consultant', document_id: p2.id, note: 'signed by Mr Rao' })).status === 200);
const c1 = await cert(slab);
ok('still blocked until the Owner confirms the report', c1.code === 'signoff' && /Owner/.test(c1.err), JSON.stringify(c1));
const so = (await pm.call('GET', `/api/site/milestones/${slab.id}/signoffs`)).data.signoffs.find((s) => s.kind === 'rcc_consultant');
ok('the PM and the site team cannot confirm it', (await pm.call('POST', `/api/site/signoffs/${so.id}/confirm`, {})).status === 403 && (await site.call('POST', `/api/site/signoffs/${so.id}/confirm`, {})).status === 403);
ok('the Owner was told to confirm', /Confirm the RCC report/.test(sql("SELECT title FROM notifications WHERE title LIKE 'Confirm the RCC report%' ORDER BY id DESC LIMIT 1")));
ok('the Owner confirms', (await o.call('POST', `/api/site/signoffs/${so.id}/confirm`, {})).status === 200 && (await o.call('POST', `/api/site/signoffs/${so.id}/confirm`, {})).status === 409);
ok('now the stage is certified', (await cert(slab)).status === 200);
const slab2 = await mk({ name: 'Slab 6 ' + run, milestone_key: 'j' + run, wing: 'A', floor: 6 });
await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' });
const c2 = await cert(slab2); ok('the switch can be turned off in Settings', c2.status === 200, JSON.stringify(c2));
await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' });
// a replaced upload needs fresh confirmation
const slab3 = await mk({ name: 'Slab 7 ' + run, milestone_key: 'h' + run, wing: 'A', floor: 7 });
await site.call('POST', `/api/site/milestones/${slab3.id}/signoffs`, { kind: 'site_engineer', document_id: p1.id }); await site.call('POST', `/api/site/milestones/${slab3.id}/signoffs`, { kind: 'rcc_consultant', document_id: p2.id });
const s3 = (await pm.call('GET', `/api/site/milestones/${slab3.id}/signoffs`)).data.signoffs.find((s) => s.kind === 'rcc_consultant'); await o.call('POST', `/api/site/signoffs/${s3.id}/confirm`, {});
await site.call('POST', `/api/site/milestones/${slab3.id}/signoffs`, { kind: 'rcc_consultant', document_id: p2.id, note: 'corrected report' });
ok('a new consultant upload replaces the old one and needs confirming again', (await cert(slab3)).code === 'signoff');

// ---------- GST hold on an RA bill ----------
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz con ' + run, trade: 'civil' })).data.id;
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'lump_sum', value_paise: 500 * L, retention_bp: 500 })).data;
await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {}); await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {});
const ra = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 100 * L, gst_bp: 1800, tds_bp: 100 })).data;
await pm.call('POST', `/api/contractors/ra-bills/${ra.id}/check`, {}); await o.call('POST', `/api/contractors/ra-bills/${ra.id}/approve`, {});
const net = ra.net_paise, gst = ra.gst_paise;
const full = await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/payments`, { amount_paise: net, mode: 'neft', ref_no: 'N' + run });
ok('the full amount cannot be paid while the GST is held', full.status === 400 && full.code === 'gst_hold' && /GSTR/.test(full.err), JSON.stringify(full));
ok('everything except the GST can be paid', (await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/payments`, { amount_paise: net - gst, mode: 'neft', ref_no: 'M' + run })).status === 200);
ok('the bill is not "paid" while the GST is still held', (await o.call('GET', `/api/contractors/work-orders/${wo.id}`)).data.ra_bills.find((r) => r.id === ra.id).status === 'part_paid');
ok('the PM cannot release the GST', (await pm.call('POST', `/api/contractors/ra-bills/${ra.id}/gst-confirm`, { note: 'GSTR-1 and 3B filed' })).status === 403);
ok('Accounts must say what they checked', (await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/gst-confirm`, { note: '' })).status === 400);
ok('Accounts release the GST', (await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/gst-confirm`, { note: 'GSTR-1 and 3B filed for the month, checked on portal' })).status === 200 && (await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/gst-confirm`, { note: 'again please' })).status === 409);
ok('the GST part can now be paid and the bill is paid', (await acc.call('POST', `/api/contractors/ra-bills/${ra.id}/payments`, { amount_paise: gst, mode: 'neft', ref_no: 'G' + run })).data.status === 'paid');
await o.call('POST', '/api/settings/con.gst_hold', { value: 'off' });
const ra2 = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 50 * L, gst_bp: 1800 })).data;
await pm.call('POST', `/api/contractors/ra-bills/${ra2.id}/check`, {}); await o.call('POST', `/api/contractors/ra-bills/${ra2.id}/approve`, {});
ok('with the switch off a new bill has no GST hold', (await acc.call('POST', `/api/contractors/ra-bills/${ra2.id}/payments`, { amount_paise: ra2.net_paise, mode: 'neft', ref_no: 'Z' + run })).status === 200);
await o.call('POST', '/api/settings/con.gst_hold', { value: 'on' });

// ---------- Cost to complete ----------
const cm0 = (await pm.call('GET', `/api/budget/cost-to-complete?project_id=${pid}`)).data;
ok('spent counts the contractor RA bills (gross)', cm0.spent_paise >= 150 * L && cm0.budget_paise === 500 * L, JSON.stringify(cm0));
const wA = cm0.wings.find((w) => w.wing === 'A');
ok('wing A shows the certified-stage percentage', wA && wA.milestone_pct_bp > 0 && wA.pm_pct_bp === null && wA.used_pct_bp === wA.milestone_pct_bp, JSON.stringify(wA));
ok('only the PM or Owner can enter completion', (await acc.call('POST', '/api/site/wing-progress', { project_id: pid, wing: 'A', pct: 40 })).status === 403 && (await pm.call('POST', '/api/site/wing-progress', { project_id: pid, wing: 'A', pct: 120 })).status === 400);
await pm.call('POST', '/api/site/wing-progress', { project_id: pid, wing: 'A', pct: 20 });
const cm1 = (await pm.call('GET', `/api/budget/cost-to-complete?project_id=${pid}`)).data; const w1 = cm1.wings.find((w) => w.wing === 'A');
ok('when both exist the lower one is used', w1.pm_pct_bp === 2000 && w1.used_pct_bp === Math.min(2000, w1.milestone_pct_bp), JSON.stringify(w1));
ok('a projection is given once there is some progress', cm1.projected_total_paise > 0 && cm1.all_complete === false);
await pm.call('POST', '/api/site/wing-progress', { project_id: pid, wing: 'A', pct: 100 });
ok('a wing is "complete" only when the stages and the PM both say 100%', (await pm.call('GET', `/api/budget/cost-to-complete?project_id=${pid}`)).data.wings.find((w) => w.wing === 'A').complete === false);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
