// tests/quality.mjs — pour cards, cube tests, NCRs, the NCR stop on certifying a floor, and the structured daily report. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zqa-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zqa ' + role + seq, email, role, projects }); const pw = 'ZqaStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-qa ' + run, code: 'QA' + run.toUpperCase().slice(-6) })).data.id;
const pm = await mkUser('pm', []); const site = await mkUser('site', [pid]); const sales = await mkUser('sales', []);
const meta = (await site.call('GET', '/api/qa/meta')).data;
ok('the pour checklist, elements and daily-report activities come from settings (with built-in lists)', meta.checklist.length >= 6 && meta.elements.includes('slab') && meta.activities.includes('Slab') && meta.seven_day_pct === 65);

// ============ pour cards ============
const all = Object.fromEntries(meta.checklist.map((c) => [c, true]));
const some = Object.fromEntries(meta.checklist.map((c, i) => [c, i < 3]));
ok('a pour card needs a grade like M25 and a quantity', (await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', grade: 'strong', qty_cum: 10 })).status === 400 && (await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', grade: 'M25', qty_cum: 0 })).status === 400);
const uu = 'pour-' + run;
const p1 = await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', wing: 'A', floor: 3, grade: 'm 25', qty_cum: 42.5, planned_date: iso(1), drawing_ref: 'S-301 R2', checklist: some, client_uuid: uu });
ok('the site engineer asks for a pour; unticked checks are listed', p1.status === 200 && p1.data.unticked.length === meta.checklist.length - 3);
ok('a retry from the phone does not make a second card', (await site.call('POST', '/api/qa/pours', { project_id: pid, element: 'slab', grade: 'M25', qty_cum: 1, client_uuid: uu })).data.duplicate === true);
ok('the site engineer cannot approve', (await site.call('POST', `/api/qa/pours/${p1.data.id}/approve`, {})).status === 403);
ok('no pour before approval', (await site.call('POST', `/api/qa/pours/${p1.data.id}/poured`, {})).status === 409);
const notTicked = await pm.call('POST', `/api/qa/pours/${p1.data.id}/approve`, {});
ok('the PM cannot approve while checks are not ticked', notTicked.status === 409 && notTicked.code === 'checklist');
const noCc = await pm.call('POST', `/api/qa/pours/${p1.data.id}/approve`, { checklist: all });
ok('no pour above what the CC allows: no CC yet', noCc.status === 409 && noCc.code === 'cc');
await o.call('POST', '/api/approvals/load-template', { project_id: pid });
const items = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === pid);
const g = (k) => items.find((a) => a.gate_key === k).id;
await o.call('POST', `/api/approvals/${g('iod')}/event`, { event: 'applied' }); await o.call('POST', `/api/approvals/${g('iod')}/event`, { event: 'approved', letter_no: 'IOD/1', letter_date: iso(-60) });
await o.call('POST', `/api/approvals/${g('cc')}/event`, { event: 'applied' }); await o.call('POST', `/api/approvals/${g('cc')}/event`, { event: 'approved', letter_no: 'CC/1', letter_date: iso(-50), cc_upto_floor: 10 });
ok('with the CC up to floor 10 and every check ticked, the PM approves', (await pm.call('POST', `/api/qa/pours/${p1.data.id}/approve`, { checklist: all })).status === 200);
const p2 = (await pm.call('POST', '/api/qa/pours', { project_id: pid, element: 'column', wing: 'A', floor: 12, grade: 'M30', qty_cum: 8, checklist: all })).data.id;
ok('someone else must approve a card the PM asked for', (await pm.call('POST', `/api/qa/pours/${p2}/approve`, {})).status === 403);
ok('floor 12 is above the CC (floor 10): even the Owner needs a written reason', (await o.call('POST', `/api/qa/pours/${p2}/approve`, {})).code === 'cc'
  && (await o.call('POST', `/api/qa/pours/${p2}/approve`, { override_note: 'Further CC letter received, entry pending' })).status === 200);

// ============ poured → cube tests ============
const pourDay = iso(-30);
ok('the pour date cannot be in the future', (await site.call('POST', `/api/qa/pours/${p1.data.id}/poured`, { poured_on: iso(1) })).status === 400);
const pd = await site.call('POST', `/api/qa/pours/${p1.data.id}/poured`, { poured_on: pourDay, poured_qty_cum: 43, rmc_tickets: 'T1-T7' });
ok('pour recorded: 7-day cube must reach 65% of M25 (16.25), 28-day 25 N/mm²', pd.status === 200 && pd.data.cube_7_due === addDays(pourDay, 7) && pd.data.cube_28_due === addDays(pourDay, 28) && pd.data.required_7_mpa === 16.25 && pd.data.required_28_mpa === 25, JSON.stringify(pd));
ok('it cannot be recorded twice', (await site.call('POST', `/api/qa/pours/${p1.data.id}/poured`, {})).status === 409);
const cubes = (await site.call('GET', `/api/qa/pours?project_id=${pid}`)).data.pours.find((p) => p.id === p1.data.id).cubes;
const c7 = cubes.find((c) => c.age_days === 7), c28 = cubes.find((c) => c.age_days === 28);
ok('two cube tests exist', c7 && c28 && cubes.length === 2);
ok('a 7-day cube cannot be tested before its time', (await site.call('POST', `/api/qa/cubes/${c7.id}/result`, { result_mpa: 18, tested_on: addDays(pourDay, 3) })).status === 400);
ok('7-day result 17.1 passes', (await site.call('POST', `/api/qa/cubes/${c7.id}/result`, { result_mpa: 17.1, tested_on: addDays(pourDay, 7), lab: 'ABC Labs' })).data.status === 'pass');
ok('a result is entered once', (await site.call('POST', `/api/qa/cubes/${c7.id}/result`, { result_mpa: 1 })).status === 409);
const f28 = await site.call('POST', `/api/qa/cubes/${c28.id}/result`, { result_mpa: 22.4, tested_on: addDays(pourDay, 28) });
ok('28-day result 22.4 against 25 fails and opens an NCR by itself', f28.data.status === 'fail' && f28.data.ncr === true);
const ncrs = (await pm.call('GET', `/api/qa/ncrs?project_id=${pid}`)).data.ncrs;
const n28 = ncrs.find((n) => n.source === 'cube28');
ok('the NCR names the wing and floor', n28 && n28.wing === 'A' && n28.floor === 3 && /28-day cube failed/.test(n28.title));
ok('the PM is told', JSON.stringify((await pm.call('GET', '/api/notifications')).data).includes('Cube test FAILED'));

// ============ an open 28-day NCR stops certifying that floor and above ============
await pm.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab 4 A ' + run, wing: 'A', floor: 4 });
await pm.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab 2 A ' + run, wing: 'A', floor: 2 });
const ms = (await pm.call('GET', '/api/site/milestones')).data.milestones;
const m4 = ms.find((m) => m.name === 'Slab 4 A ' + run), m2 = ms.find((m) => m.name === 'Slab 2 A ' + run);
const blk = await pm.call('POST', `/api/site/milestones/${m4.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/4' });
ok('floor 4 cannot be certified while floor 3 has a failed 28-day cube', blk.status === 409 && blk.code === 'ncr', JSON.stringify(blk));
ok('not even by the Owner', (await o.call('POST', `/api/site/milestones/${m4.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/4', override_note: 'x' })).code === 'ncr');
ok('floor 2 (below the failure) can still be certified', (await pm.call('POST', `/api/site/milestones/${m2.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/2' })).status === 200);
ok('closing an NCR needs the correction', (await pm.call('POST', `/api/qa/ncrs/${n28.id}/close`, {})).status === 400);
ok('the site engineer cannot close it', (await site.call('POST', `/api/qa/ncrs/${n28.id}/close`, { correction: 'x' })).status === 403);
ok('the PM closes it with the correction', (await pm.call('POST', `/api/qa/ncrs/${n28.id}/close`, { correction: 'Core test 27.8 N/mm² passed; consultant accepted' })).status === 200);
ok('then floor 4 can be certified', (await pm.call('POST', `/api/site/milestones/${m4.id}/certify`, { actual_date: iso(0), cert_ref: 'ARCH/4' })).status === 200);

// ============ NCR raised on site, in the task list ============
const n2 = await site.call('POST', '/api/qa/ncrs', { project_id: pid, title: 'Honeycombing at column C4 ' + run, wing: 'A', floor: 3, due_date: iso(3) });
ok('the site engineer raises an NCR', n2.status === 200);
ok('it shows in Tasks with "not set" until someone is put in charge', (await pm.call('GET', `/api/tasks?project_id=${pid}`)).data.tasks.some((t) => t.kind === 'ncr' && t.id === n2.data.id && t.in_charge === null));
ok('the PM sets the person in charge', (await pm.call('POST', '/api/tasks/assign', { kind: 'ncr', id: n2.data.id, assigned_to: site.id, due: iso(2) })).status === 200
  && (await site.call('GET', '/api/tasks?mine=1')).data.tasks.some((t) => t.kind === 'ncr' && t.id === n2.data.id));

// ============ structured daily report ============
const dpr = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work: [{ activity: 'Slab', wing: 'A', floor: 5, qty: 38, unit: 'cum' }, { activity: 'Blockwork', wing: 'B', floor: 2, qty: 120, unit: 'sqm' }], weather: 'Rain', hours_lost: 2.5, lost_reason: 'rain' });
ok('a report with activity lines needs no typed summary; one is written from the lines', dpr.status === 200 && (await o.call('GET', `/api/site/dprs?project_id=${pid}`)).data.dprs.some((d) => /Slab A fl 5 38 cum; Blockwork B fl 2 120 sqm/.test(d.work_summary) && d.hours_lost === 2.5 && d.lost_reason === 'rain'), JSON.stringify(dpr));
ok('hours lost above 24 are refused', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work: [{ activity: 'Slab' }], hours_lost: 30 })).status === 400);
ok('a report with nothing done is refused', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work: [] })).status === 400);

// ============ safety in the daily report ============
ok('the safety checklist comes with a built-in list', Array.isArray(meta.safety) && meta.safety.includes('Toolbox talk held'));
const safe = Object.fromEntries(meta.safety.map((c, i) => [c, i !== 2]));
ok('an incident needs a description', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work: [{ activity: 'Slab' }], safety: safe, incident_kind: 'injury' })).status === 400);
const inj = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work: [{ activity: 'Column', wing: 'A', floor: 6 }], safety: safe, incident_kind: 'injury', safety_incident: 'Helper cut hand on binding wire, first aid given ' + run });
const saved = (await o.call('GET', `/api/site/dprs?project_id=${pid}`)).data.dprs.find((d) => (d.safety_incident || '').includes(run));
ok('the checks and the incident are saved with the report', inj.status === 200 && saved && saved.incident_kind === 'injury' && JSON.parse(saved.safety_checks)[meta.safety[2]] === false && JSON.parse(saved.safety_checks)[meta.safety[0]] === true, JSON.stringify(saved || {}));
ok('the PM and Owner are told at once', JSON.stringify((await o.call('GET', '/api/notifications')).data).includes('SAFETY: Injury'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
