// tests/bd.mjs — Business Development: follow-ups, feasibility, 79A steps, DA signed/registered, open as project; project life cycle.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b instanceof FormData) body = b; else if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zb-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zb ' + role + seq, email, role, projects }); const pw = 'ZbStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const pm = await mkUser('pm', []); const site = await mkUser('site', []); const acc = await mkUser('accounts', []);
const pdf = (who, title) => { const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 ' + title], { type: 'application/pdf' }), title + '.pdf'); fd.append('title', title); fd.append('category', 'business_development'); fd.append('module', 'bd'); return who.call('POST', '/api/files/upload', fd); };

ok('site cannot open Business Development', (await site.call('GET', '/api/bd/opportunities')).status === 403);
ok('accounts can view', (await acc.call('GET', '/api/bd/opportunities')).status === 200);
ok('accounts cannot add a deal', (await acc.call('POST', '/api/bd/opportunities', { name: 'x' })).status === 403);
const opp = await pm.call('POST', '/api/bd/opportunities', { name: 'zz Shanti CHS ' + run, kind: 'society', members_count: 24, plot_area_sqm: 1200, contact_phone: '98200 12345', next_followup: today });
ok('PM adds a society opportunity', opp.status === 200);
const id = opp.data.id;
ok('a bad phone number is refused', (await pm.call('POST', '/api/bd/opportunities', { name: 'y', contact_phone: '123' })).status === 400);
let g = (await pm.call('GET', '/api/bd/opportunities/' + id)).data;
ok('saved with +91 phone and the 79A checklist', g.opportunity.contact_phone === '+919820012345' && g.steps.length >= 5 && g.opportunity.stage === 'identified');

// follow-up reminder via the hourly sweep is tested through the list flag; record a follow-up
ok('a follow-up in the future is refused', (await pm.call('POST', `/api/bd/opportunities/${id}/followups`, { on_date: '2999-01-01', note: 'x' })).status === 400);
const fu = await pm.call('POST', `/api/bd/opportunities/${id}/followups`, { note: 'Met the committee', kind: 'meeting' });
g = (await pm.call('GET', '/api/bd/opportunities/' + id)).data;
ok('a follow-up moves the deal to Follow-ups', fu.status === 200 && g.opportunity.stage === 'follow_up' && g.followups.length === 1);

// DA signed needs a study first
const daDoc = (await pdf(pm, 'DA ' + run)).data.id;
const early = await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'signed', da_signed_on: today, da_doc_id: daDoc });
ok('the DA cannot be signed before a feasibility study', early.status === 409 && early.code === 'study');
ok('a study needs a report or a cost', (await pm.call('POST', `/api/bd/opportunities/${id}/studies`, { title: 'x' })).status === 400);
const rep = (await pdf(pm, 'Feasibility ' + run)).data.id;
const st1 = await pm.call('POST', `/api/bd/opportunities/${id}/studies`, { document_id: rep, est_cost_paise: 500000000000, est_revenue_paise: 750000000000, saleable_sqft: 45000, completion_months: 42 });
const st2 = await pm.call('POST', `/api/bd/opportunities/${id}/studies`, { est_cost_paise: 520000000000, est_revenue_paise: 760000000000 });
g = (await pm.call('GET', '/api/bd/opportunities/' + id)).data;
ok('studies are versioned v1, v2 and the deal moves to Feasibility', st1.status === 200 && st2.status === 200 && g.studies[0].version === 2 && g.opportunity.stage === 'feasibility');
ok('site cannot open the deal papers', (await site.call('GET', `/api/files/download/${rep}?meta=1`)).status === 403);

// 79A steps
const step0 = g.steps[0].step;
ok('a step cannot be dated in the future', (await pm.call('POST', `/api/bd/opportunities/${id}/steps`, { step: step0, done_on: '2999-01-01' })).status === 400);
ok('an unknown step is refused', (await pm.call('POST', `/api/bd/opportunities/${id}/steps`, { step: 'nope', done_on: today })).status === 400);
await pm.call('POST', `/api/bd/opportunities/${id}/steps`, { step: step0, done_on: today, note: 'Resolution 4/2026' });
g = (await pm.call('GET', '/api/bd/opportunities/' + id)).data;
ok('ticking a step moves the deal to the 79A process', g.opportunity.stage === 'process_79a' && g.steps[0].done_on === today);
const blocked = await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'signed', da_signed_on: today, da_doc_id: daDoc });
ok('the PM cannot sign the DA with 79A steps open', blocked.status === 409 && blocked.code === '79a');
ok('the Owner needs a reason to go past open steps', (await o.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'signed', da_signed_on: today, da_doc_id: daDoc })).status === 409);
for (const s of g.steps.slice(1)) await pm.call('POST', `/api/bd/opportunities/${id}/steps`, { step: s.step, done_on: today });
ok('the DA needs the signed copy', (await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'signed', da_signed_on: today })).status === 400);
ok('register before signing is refused', (await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'registered', da_reg_no: 'X', da_registered_on: today })).status === 409);
ok('with every step ticked the PM records the DA signed', (await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'signed', da_signed_on: today, da_doc_id: daDoc })).status === 200);
const noLetter = await pm.call('POST', `/api/bd/opportunities/${id}/convert`, { code: 'ZB' + run.toUpperCase().slice(-5) });
ok('convert before the appointment letter is recorded is refused', noLetter.status === 409 && noLetter.code === 'start_paper', JSON.stringify(noLetter));
ok('registration needs a number', (await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'registered', da_registered_on: today })).status === 400);
ok('DA registered', (await pm.call('POST', `/api/bd/opportunities/${id}/da`, { action: 'registered', da_reg_no: 'BDR-4/1234/2026', da_registered_on: today })).status === 200);

// the society's appointment letter is the paper that lets the project start
const letter = (await pdf(pm, 'Appointment letter ' + run)).data.id;
ok('the appointment letter needs the scan', (await pm.call('POST', `/api/bd/opportunities/${id}/start-paper`, { on: today, ref: 'CHS/LOI/7' })).status === 400);
ok('accounts cannot record it', (await acc.call('POST', `/api/bd/opportunities/${id}/start-paper`, { on: today, ref: 'CHS/LOI/7', doc_id: letter })).status === 403);
ok('the PM records the appointment letter', (await pm.call('POST', `/api/bd/opportunities/${id}/start-paper`, { on: today, ref: 'CHS/LOI/7', doc_id: letter })).status === 200);

// open as project
const code = 'ZB' + run.toUpperCase().slice(-5);
ok('accounts cannot open the project', (await acc.call('POST', `/api/bd/opportunities/${id}/convert`, { code })).status === 403);
const cv = await pm.call('POST', `/api/bd/opportunities/${id}/convert`, { code, has_basement: true });
ok('the PM opens the project with approvals and milestones', cv.status === 200 && cv.data.approvals > 10 && cv.data.milestones === 4, JSON.stringify(cv));
const pid = cv.data && cv.data.project_id;
ok('opening twice is refused', (await pm.call('POST', `/api/bd/opportunities/${id}/convert`, { code: code + 'X' })).status === 409);
g = (await pm.call('GET', '/api/bd/opportunities/' + id)).data;
ok('the deal is marked won with its project', g.opportunity.status === 'won' && g.opportunity.project_id === pid);
const names = (await pm.call('GET', '/api/approvals?project_id=' + pid)).data.items.filter((a) => a.project_id === pid).map((x) => x.name);
ok('the approvals list has the CFO NOC and concessions before the IOD', (() => { const i = (re) => names.findIndex((n) => re.test(n)); return i(/CFO/i) >= 0 && i(/CONCESSION/i) > i(/CFO/i) && i(/^IOD APPLICATION/i) > i(/CONCESSION/i); })(), names.slice(0, 6).join(' | '));
const fea = await pm.call('GET', `/api/feasibility?project_id=${pid}`);
ok('the latest feasibility study came across', fea.status === 200 && fea.data.versions.length === 1 && fea.data.versions[0].est_cost_paise === 520000000000, JSON.stringify(fea.data || fea.err).slice(0, 200));
const red = await pm.call('GET', '/api/redev/societies?project_id=' + pid);
ok('the society was created for the project', red.status === 200 && JSON.stringify(red.data).includes('Shanti CHS'), JSON.stringify(red.data || red.err).slice(0, 200));

// life cycle
let lc = (await pm.call('GET', `/api/projects/${pid}/lifecycle`)).data;
const k = (key) => lc.steps.find((x) => x.key === key);
ok('life cycle starts with the registered DA done and shows the society steps', k('da_registered').done && k('paaa') && k('vacating_notice') && k('basement') && lc.next === 'designs', JSON.stringify(lc.steps.map((x) => x.key)));
ok('the order is DA, designs, CFO, concessions, IOD, PAAA, notice, vacating, demolition, NOCs, plinth CC', lc.steps.map((x) => x.key).slice(0, 11).join() === 'da_registered,designs,cfo,concessions,iod,paaa,vacating_notice,vacating,demolition,nocs,plinth_cc', lc.steps.map((x) => x.key).join());
ok('site may view the life cycle only for its projects', (await site.call('GET', `/api/projects/${pid}/lifecycle`)).status === 403);
ok('the DA step is not ticked by hand when it came from Business Development', (await pm.call('POST', `/api/projects/${pid}/lifecycle/da_registered`, { done_on: today })).status === 400);
ok('designs finalised in the future is refused', (await pm.call('POST', `/api/projects/${pid}/lifecycle/designs`, { done_on: '2999-01-01' })).status === 400);
ok('the PM ticks designs finalised', (await pm.call('POST', `/api/projects/${pid}/lifecycle/designs`, { done_on: today, note: 'Scheme v4' })).status === 200);
const dm = await pm.call('POST', `/api/projects/${pid}/lifecycle/demolition`, { done_on: today });
ok('demolition waits until everyone has vacated', dm.status === 409 && dm.code === 'vacating');
ok('the Owner goes ahead with a reason', (await o.call('POST', `/api/projects/${pid}/lifecycle/demolition`, { done_on: today, override_note: 'Test: building already empty' })).status === 200);
// plinth CC and OC targets: IOD first, then the CC (up to plinth)
const all = (await pm.call('GET', '/api/approvals?project_id=' + pid)).data.items.filter((a) => a.project_id === pid);
const gid = (g) => (all.find((a) => a.gate_key === g) || {}).id;
const ev = (id, body) => pm.call('POST', `/api/approvals/${id}/event`, body);
await ev(gid('iod'), { event: 'applied' }); await ev(gid('iod'), { event: 'approved', letter_no: 'IOD/1', letter_date: '2025-12-01' });
await ev(gid('cc'), { event: 'applied' }); const up = await ev(gid('cc'), { event: 'approved', letter_no: 'CC/1', letter_date: '2026-01-15', cc_upto_floor: 0 });
lc = (await pm.call('GET', `/api/projects/${pid}/lifecycle`)).data;
ok('with the CC up to plinth approved, the OC target is 36 months later', up.status === 200 && k('plinth_cc').done && k('iod').done && k('oc').target === '2029-01-15', JSON.stringify([up.status, up.err, k('plinth_cc'), k('oc')]));
await o.call('POST', '/api/settings/bd.completion_months', { value: 30 });
lc = (await pm.call('GET', `/api/projects/${pid}/lifecycle`)).data;
ok('the completion months are a setting', k('oc').target === '2028-07-15', k('oc').target);
await o.call('POST', '/api/settings/bd.completion_months', { value: 36 });

// close a second deal
const o2 = (await pm.call('POST', '/api/bd/opportunities', { name: 'zz Plot ' + run, kind: 'land' })).data.id;
ok('closing needs a reason', (await pm.call('POST', `/api/bd/opportunities/${o2}/close`, { status: 'lost' })).status === 400);
ok('a deal is marked lost with the reason', (await pm.call('POST', `/api/bd/opportunities/${o2}/close`, { status: 'lost', reason: 'Society chose another developer' })).status === 200);
ok('a closed deal takes no follow-ups', (await pm.call('POST', `/api/bd/opportunities/${o2}/followups`, { note: 'x' })).status === 409);
const lost = (await pm.call('GET', '/api/bd/opportunities?status=lost')).data.opportunities;
ok('it is listed under Lost', lost.some((x) => x.id === o2));
const g2 = (await pm.call('GET', '/api/bd/opportunities/' + o2)).data;
ok('a land deal has no 79A checklist', g2.steps.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
