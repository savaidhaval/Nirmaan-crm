// tests/dprlabour.mjs — WP-6: daily report labour by contractor. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp6 ' + run, code: 'W6' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp6b ' + run, code: 'X6' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const pur = await mkUser('purchase', []); const pm = await mkUser('pm', []);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const iso = (d) => new Date(Date.now() + 19800000 - d * 86400000).toISOString().slice(0, 10);

await setSetting('con.enabled', 'off');
const off = (await site.call('GET', `/api/contractors/for-project?project_id=${pid}`)).data;
ok('module off: site gets an empty list and keeps the single labour box', off.enabled === false && off.contractors.length === 0);
await setSetting('con.enabled', 'on'); await setSetting('con.pm_approval_limit_paise', 1e10);
const mkCon = async (n, trade) => (await pur.call('POST', '/api/contractors/contractors', { name: `zz ${n} ${run}`, trade })).data.id;
const A = await mkCon('civil', 'civil'), B = await mkCon('plumb', 'plumbing'), Cn = await mkCon('other', 'tiling');
const mkWo = async (project, con, approve = true) => { const w = (await pur.call('POST', '/api/contractors/work-orders', { project_id: project, contractor_id: con, scope: 'x', value_paise: 1000000 })).data; await pur.call('POST', `/api/contractors/work-orders/${w.id}/submit`, {}); if (approve) await o.call('POST', `/api/contractors/work-orders/${w.id}/approve`, {}); return w; };
await mkWo(pid, A); await mkWo(pid, B); await mkWo(pid2, Cn); const draftOnly = await mkCon('draft', 'paint'); await mkWo(pid, draftOnly, false);
const lst = (await site.call('GET', `/api/contractors/for-project?project_id=${pid}`)).data;
ok('site sees only contractors with an approved work order on this project', lst.enabled && lst.contractors.map((c) => c.id).sort().join() === [A, B].sort().join(), JSON.stringify(lst));
ok('site cannot ask about a project it is not on', (await site.call('GET', `/api/contractors/for-project?project_id=${pid2}`)).status === 403);

// ---------- filing a report ----------
const u1 = 'dpr-' + run;
const r1 = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(1), work_summary: 'slab shuttering', client_uuid: u1, labour: [{ contractor_id: A, headcount: 10 }, { contractor_id: B, headcount: 5 }, { contractor_id: A, trade: 'helper', headcount: 0 }] });
ok('report with two contractors is saved', r1.status === 200 && r1.data.id, JSON.stringify(r1));
const lastL = (await site.call('GET', `/api/site/dprs/last-labour?project_id=${pid}`)).data.labour;
ok('lines saved with the contractor trade', lastL.length === 2 && lastL.find((l) => l.contractor_id === A).headcount === 10 && lastL.find((l) => l.contractor_id === A).trade === 'civil', JSON.stringify(lastL));
const list1 = (await o.call('GET', `/api/site/dprs?project_id=${pid}`)).data.dprs.find((d) => d.id === r1.data.id);
ok('labour_count is the sum (15)', list1.labour_count === 15, JSON.stringify(list1));
const r1b = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(1), work_summary: 'slab shuttering', client_uuid: u1, labour: [{ contractor_id: A, headcount: 10 }, { contractor_id: B, headcount: 5 }] });
ok('offline retry: no duplicate report', r1b.data.duplicate === true && (await o.call('GET', `/api/site/dprs?project_id=${pid}`)).data.dprs.filter((d) => d.report_date === iso(1)).length === 1);
ok('retry added no extra lines', (await site.call('GET', `/api/site/dprs/last-labour?project_id=${pid}`)).data.labour.length === 2);
ok('contractor of another project refused', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(2), work_summary: 'x', labour: [{ contractor_id: Cn, headcount: 3 }] })).status === 400);
ok('contractor without an approved work order refused', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(2), work_summary: 'x', labour: [{ contractor_id: draftOnly, headcount: 3 }] })).status === 400);
ok('same contractor twice refused', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(2), work_summary: 'x', labour: [{ contractor_id: A, headcount: 3 }, { contractor_id: A, headcount: 4 }] })).status === 400);
ok('absurd headcount refused', (await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(2), work_summary: 'x', labour: [{ contractor_id: A, headcount: 99999 }] })).status === 400);
ok('failed reports left nothing behind', (await o.call('GET', `/api/site/dprs?project_id=${pid}`)).data.dprs.length === 1);
const old = await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(2), work_summary: 'old style', labour_count: 7 });
ok('old single-number report still works', (await o.call('GET', `/api/site/dprs?project_id=${pid}`)).data.dprs.find((d) => d.id === old.data.id).labour_count === 7);
ok('last-labour ignores reports that had no lines', (await site.call('GET', `/api/site/dprs/last-labour?project_id=${pid}`)).data.labour.length === 2);
await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work_summary: 'today', labour: [{ contractor_id: A, headcount: 12 }] });
ok('last-labour follows the newest report', (await site.call('GET', `/api/site/dprs/last-labour?project_id=${pid}`)).data.labour.map((l) => l.headcount).join() === '12');

// ---------- monthly report ----------
const month = iso(0).slice(0, 7);
const rep = (await pm.call('GET', `/api/site/reports/labour?month=${month}&project_id=${pid}`)).data;
const ra = rep.rows.find((r) => r.contractor_id === A), rb = rep.rows.find((r) => r.contractor_id === B);
const inMonth = (d) => iso(d).startsWith(month);
const expA = (inMonth(1) ? 10 : 0) + 12, expB = inMonth(1) ? 5 : 0;
ok('report: man-days per contractor and trade', ra && ra.man_days === expA && ra.trade === 'civil' && ra.contractor.startsWith('zz civil') && (rb ? rb.man_days : 0) === expB, JSON.stringify(rep.rows));
const csv = await pm.call('GET', `/api/site/reports/labour?month=${month}&project_id=${pid}&csv=1`, null, true);
const text = await csv.text();
ok('CSV download has a header and the contractor', csv.status === 200 && text.includes('Man-days') && text.includes('zz civil'));
ok('bad month falls back to this month, no error', (await pm.call('GET', '/api/site/reports/labour?month=garbage')).status === 200);
ok('requests without the header are refused', (await fetch(BASE + '/api/site/dprs', { method: 'POST', headers: { cookie: site.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
