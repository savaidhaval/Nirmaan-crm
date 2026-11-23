// tests/drawing_files.mjs — drawing sheets uploaded with each revision; site only opens the current issued sheet.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b instanceof FormData) body = b; else if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zd-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zd ' + role + seq, email, role, projects }); const pw = 'ZdStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };

const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-dw ' + run, code: 'DW' + run.toUpperCase().slice(-6) })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-dw2 ' + run, code: 'DX' + run.toUpperCase().slice(-6) })).data.id;
const pm = await mkUser('pm', []); const site = await mkUser('site', [pid]); const pur = await mkUser('purchase', []);
const pdf = (who, project, title) => { const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 drawing ' + title], { type: 'application/pdf' }), title + '.pdf'); fd.append('title', title); fd.append('project_id', String(project)); fd.append('category', 'drawing'); fd.append('module', 'drawings'); return who.call('POST', '/api/files/upload', fd); };

const f0 = await pdf(pm, pid, 'STR-501 R0');
ok('the PM uploads a drawing file', f0.status === 200);
ok('Purchase (view-only on drawings) cannot upload a drawing file', (await pdf(pur, pid, 'x')).status === 403);
const dr = (await pm.call('POST', '/api/drawings', { project_id: pid, code: 'STR-501-' + run.slice(-3), title: 'Slab 5', discipline: 'struct' })).data.id;
const other = (await pdf(o, pid2, 'other project')).data.id;
ok('a file from another project cannot be used', (await pm.call('POST', `/api/drawings/${dr}/revisions`, { status: 'ifc', document_id: other })).status === 400);
const r0 = await pm.call('POST', `/api/drawings/${dr}/revisions`, { status: 'ifc', document_id: f0.data.id, received_from: 'Structural consultant' });
ok('R0 is issued for construction with its file', r0.status === 200 && r0.data.rev_no === 'R0');
const list = (await site.call('GET', '/api/drawings')).data.drawings.find((x) => x.id === dr);
ok('the list knows the current issued sheet has its file', list.current_ifc_rev === 'R0' && list.current_ifc_doc === f0.data.id);
ok('site opens the current sheet', (await site.call('GET', `/api/files/download/${f0.data.id}?meta=1`)).status === 200);
const r1d = await pm.call('POST', `/api/drawings/${dr}/revisions`, { status: 'draft', note: 'Consultant comments' });
const revs = (await pm.call('GET', `/api/drawings/${dr}/revisions`)).data.revisions;
const draft = revs.find((x) => x.rev_no === 'R1');
ok('a revision saved without a file can have its file attached once', r1d.status === 200 && !draft.document_id);
const f1 = await pdf(pm, pid, 'STR-501 R1');
ok('attach the file to R1', (await pm.call('POST', `/api/drawings/revisions/${draft.id}/file`, { document_id: f1.data.id })).status === 200);
ok('the file cannot be swapped afterwards (issue a new revision instead)', (await pm.call('POST', `/api/drawings/revisions/${draft.id}/file`, { document_id: f0.data.id })).status === 409);
ok('site cannot open the draft sheet', (await site.call('GET', `/api/files/download/${f1.data.id}?meta=1`)).status === 403);
const f2 = await pdf(pm, pid, 'STR-501 R2');
await pm.call('POST', `/api/drawings/${dr}/revisions`, { status: 'ifc', document_id: f2.data.id, note: 'Extra bars at column C4' });
ok('after R2 is issued, site cannot open the superseded R0 sheet', (await site.call('GET', `/api/files/download/${f0.data.id}?meta=1`)).status === 403);
ok('site opens R2', (await site.call('GET', `/api/files/download/${f2.data.id}?meta=1`)).status === 200);
ok('the office still opens every revision', (await pm.call('GET', `/api/files/download/${f0.data.id}?meta=1`)).status === 200);
const all = (await pm.call('GET', `/api/drawings/${dr}/revisions`)).data.revisions;
ok('three revisions are kept, each with its file', all.length === 3 && all.every((x) => x.document_id));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
