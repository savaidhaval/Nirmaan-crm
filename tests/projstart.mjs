// tests/projstart.mjs — inside a project: only people on it get in (every route), and a project takes new work outside
// Land & Approvals only after it starts (society: appointment letter after the 79A process; land: sale deed). Runs with the
// production defaults switched on, and puts the older suites' settings back at the end.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b instanceof FormData) body = b; else if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
const set = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
await set('access.limit_roles_to_assigned_projects', ['pm', 'site', 'sales', 'accounts', 'purchase', 'hr', 'viewer']);
await set('projects.start_gate', 'on');
let seq = 0;
const mkUser = async (role, projects) => { const email = `ps-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'ps ' + role + seq, email, role, projects }); const pw = 'PsStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const pdf = (who, title, pid) => { const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 ' + title], { type: 'application/pdf' }), title + '.pdf'); fd.append('title', title); fd.append('category', 'agreement'); fd.append('module', 'projects'); if (pid) fd.append('project_id', String(pid)); return who.call('POST', '/api/files/upload', fd); };
const code = (p) => p + run.toUpperCase().slice(-6);

try {
  // ---------- a project opened directly waits for its start paper ----------
  const p1 = (await o.call('POST', '/api/projects', { name: 'zz-ps land ' + run, code: code('PL'), type: 'new_build' })).data.id;
  const p2 = (await o.call('POST', '/api/projects', { name: 'zz-ps redev ' + run, code: code('PR'), type: 'redevelopment' })).data.id;
  const g1 = (await o.call('GET', '/api/projects/' + p1)).data;
  ok('a project opened directly is waiting to start', g1.start_basis === 'pending', JSON.stringify(g1.start_basis));

  const pm = await mkUser('pm', [p1]); const sales = await mkUser('sales', [p1]); const site = await mkUser('site', [p1]); const loner = await mkUser('accounts', []);

  // ---------- only people on the project get in ----------
  const mine = (await pm.call('GET', '/api/projects')).data.projects.map((p) => p.id);
  ok('the PM sees only the project they are on', mine.includes(p1) && !mine.includes(p2), JSON.stringify(mine));
  const own = (await o.call('GET', '/api/projects')).data.projects.map((p) => p.id);
  ok('the Owner sees every project', own.includes(p1) && own.includes(p2));
  const peek = await pm.call('GET', '/api/approvals?project_id=' + p2);
  ok('a list for a project the PM is not on is refused', peek.status === 403 && peek.code === 'not_member', JSON.stringify(peek));
  const write = await pm.call('POST', '/api/approvals', { project_id: p2, name: 'zz sneak', authority: 'MCGM' });
  ok('a write naming a project the PM is not on is refused', write.status === 403 && write.code === 'not_member', JSON.stringify(write));
  ok('the same write on their own project works', (await pm.call('POST', '/api/approvals', { project_id: p1, name: 'zz ps fire NOC ' + run, authority: 'MCGM' })).status === 200);
  ok('someone on no project sees none', (await loner.call('GET', '/api/projects')).data.projects.length === 0);
  const un = await o.call('GET', '/api/access/unassigned');
  ok('the Owner is told who is on no project', un.status === 200 && un.data.people.some((p) => p.id === loner.id) && !un.data.people.some((p) => p.id === pm.id), JSON.stringify(un.data).slice(0, 300));
  ok('only the Owner sees that list', (await pm.call('GET', '/api/access/unassigned')).status === 403);

  // ---------- before the start: only Land & Approvals takes new work ----------
  const lead = await sales.call('POST', '/api/sales/leads', { name: 'zz ps lead', phone: '97' + String(Date.now()).slice(-8), project_id: p1 });
  ok('no lead can be added before the project starts', lead.status === 409 && lead.code === 'not_started', JSON.stringify(lead));
  const ind = await site.call('POST', '/api/procurement/indents', { project_id: p1, items: [{ description: 'Cement', qty: 10, unit: 'bag' }] });
  ok('no material request before the project starts', ind.status === 409 && ind.code === 'not_started', JSON.stringify(ind));
  ok('lists still open before the start', (await sales.call('GET', '/api/sales/leads?project_id=' + p1)).status === 200);

  // ---------- recording the start ----------
  const deed = (await pdf(pm, 'Sale deed ' + run, p1)).data.id;
  ok('site cannot start a project', (await site.call('POST', `/api/projects/${p1}/start`, { started_on: today, start_ref: 'BDR-1/2/2026', start_doc_id: deed })).status === 403);
  ok('the start needs the scanned paper', (await pm.call('POST', `/api/projects/${p1}/start`, { started_on: today, start_ref: 'BDR-1/2/2026' })).status === 400);
  ok('the start needs the registration number', (await pm.call('POST', `/api/projects/${p1}/start`, { started_on: today, start_doc_id: deed })).status === 400);
  ok('a date in the future is refused', (await pm.call('POST', `/api/projects/${p1}/start`, { started_on: '2999-01-01', start_ref: 'X', start_doc_id: deed })).status === 400);
  ok('the PM cannot start a project they are not on', (await pm.call('POST', `/api/projects/${p2}/start`, { started_on: today, start_ref: 'X', start_doc_id: deed })).status === 403);
  const st = await pm.call('POST', `/api/projects/${p1}/start`, { started_on: today, start_ref: 'BDR-1/2/2026', start_doc_id: deed });
  ok('a land project starts with the sale deed', st.status === 200 && st.data.start_basis === 'land_purchase', JSON.stringify(st));
  ok('starting twice is refused', (await pm.call('POST', `/api/projects/${p1}/start`, { started_on: today, start_ref: 'X', start_doc_id: deed })).status === 409);
  const lead2 = await sales.call('POST', '/api/sales/leads', { name: 'zz ps lead', phone: '96' + String(Date.now()).slice(-8), project_id: p1 });
  ok('after the start, sales can add a lead', lead2.status === 200, JSON.stringify(lead2));
  const letter = (await pdf(o, 'Appointment letter ' + run, p2)).data.id;
  const st2 = await o.call('POST', `/api/projects/${p2}/start`, { started_on: today, start_ref: 'CHS/LOI/1', start_doc_id: letter });
  ok('a redevelopment project starts with the appointment letter', st2.status === 200 && st2.data.start_basis === 'appointment_letter', JSON.stringify(st2));

  // ---------- from Business Development ----------
  const land = (await o.call('POST', '/api/bd/opportunities', { name: 'zz ps plot ' + run, kind: 'land' })).data.id;
  const noDeed = await o.call('POST', `/api/bd/opportunities/${land}/convert`, { code: code('BL') });
  ok('land cannot become a project before it is bought', noDeed.status === 409 && noDeed.code === 'start_paper', JSON.stringify(noDeed));
  const deed2 = (await pdf(o, 'Plot deed ' + run)).data.id;
  ok('the land purchase is recorded with the sale deed', (await o.call('POST', `/api/bd/opportunities/${land}/start-paper`, { on: today, ref: 'BDR-9/99/2026', doc_id: deed2 })).status === 200);
  const cv = await o.call('POST', `/api/bd/opportunities/${land}/convert`, { code: code('BL') });
  const bp = cv.data && (await o.call('GET', '/api/projects/' + cv.data.project_id)).data;
  ok('once bought, the land opens as a started project', cv.status === 200 && bp.start_basis === 'land_purchase' && bp.start_ref === 'BDR-9/99/2026' && bp.start_doc_id === deed2, JSON.stringify([cv, bp && bp.start_basis]));
  const lc = (await o.call('GET', `/api/projects/${cv.data.project_id}/lifecycle`)).data;
  ok('the DA step of that project can still be ticked by hand', lc.steps.find((x) => x.key === 'da_registered').manual === true);
  const soc = (await o.call('POST', '/api/bd/opportunities', { name: 'zz ps CHS ' + run, kind: 'society' })).data.id;
  const s79 = await o.call('POST', `/api/bd/opportunities/${soc}/convert`, { code: code('BS') });
  ok('a society cannot become a project before the 79A process is complete', s79.status === 409 && s79.code === '79a', JSON.stringify(s79));
  const jv = (await o.call('POST', '/api/bd/opportunities', { name: 'zz ps JV ' + run, kind: 'jv' })).data.id;
  ok('a JV has no start paper: it waits for its registered DA', (await o.call('POST', `/api/bd/opportunities/${jv}/start-paper`, { on: today, ref: 'X', doc_id: deed2 })).status === 400 && (await o.call('POST', `/api/bd/opportunities/${jv}/convert`, { code: code('BJ') })).code === 'da');

  // ---------- the Owner can switch the start rule off (e.g. to load an ongoing project) ----------
  await set('projects.start_gate', 'off');
  const p3 = (await o.call('POST', '/api/projects', { name: 'zz-ps old ' + run, code: code('PO'), type: 'new_build' })).data.id;
  ok('with the rule off a new project is open at once', (await o.call('GET', '/api/projects/' + p3)).data.start_basis === null);
} finally {
  // the older suites run with the old behaviour (see .github/workflows/ci.yml)
  await set('access.limit_roles_to_assigned_projects', ['site']);
  await set('projects.start_gate', 'off');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
