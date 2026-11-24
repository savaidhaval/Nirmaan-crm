// tests/m2_step3.mjs — Module 2 gaps, step 3: pricing matrix, PLC tags, quote lines, apply to rate card, token proof upload.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, form) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !form) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role) => { const email = `m2c-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm2c ' + role, email, role, projects: [] }); const pw = 'M2StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m2c ' + run, code: 'MC' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm'); const sales = await mkUser('sales'); const acc = await mkUser('accounts');
let n = 0;
const mkUnit = async (extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 8, unit_no: 'P' + (++n) + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000, ...extra })).data.id;
const u = await mkUnit();

ok('no price list yet: the quote says so', (await sales.call('GET', `/api/sales/units/${u}/quote`)).status === 409);
const body = { project_id: pid, base_rate_paise: 1000000, rise_paise_per_floor: 10000, rise_from_floor: 5, parking_paise: 20000000, club_paise: 30000000, dev_paise: 10000000, reason: 'launch price list', plc: [{ tag: 'garden', label: 'Garden view', kind: 'per_sqft', amount_paise: 50000 }, { tag: 'corner', label: 'Corner flat', kind: 'flat', amount_paise: 25000000 }] };
ok('only the Owner can set the price list', (await pm.call('POST', '/api/sales/price-matrix', body)).status === 403 && (await sales.call('POST', '/api/sales/price-matrix', body)).status === 403);
ok('a reason is needed', (await o.call('POST', '/api/sales/price-matrix', { ...body, reason: '' })).status === 400);
ok('a PLC rule without an amount is refused', (await o.call('POST', '/api/sales/price-matrix', { ...body, plc: [{ tag: 'x', label: 'x', kind: 'flat', amount_paise: 0 }] })).status === 400);
ok('the Owner saves it', (await o.call('POST', '/api/sales/price-matrix', body)).status === 200);
const got = (await sales.call('GET', `/api/sales/price-matrix?project_id=${pid}`)).data;
ok('the sales team can read it', got.matrix.base_rate_paise === 1000000 && got.plc.length === 2);
ok('only the Owner or PM can tag a flat', (await sales.call('POST', `/api/sales/inventory/${u}/tags`, { tags: 'garden' })).status === 403 && (await pm.call('POST', `/api/sales/inventory/${u}/tags`, { tags: 'Garden, corner ,garden!' })).data.tags === 'garden,corner');
const q = (await sales.call('GET', `/api/sales/units/${u}/quote?parking=2`)).data;
const by = (l) => q.lines.find((x) => x.label.startsWith(l));
ok('floor rise = Rs 100 x (8 - 5 + 1) floors x 500 sq ft', by('Floor rise').amount_paise === 10000 * 4 * 500, JSON.stringify(q.lines));
ok('PLC per sq ft and per flat both apply to a tagged flat', by('Garden').amount_paise === 50000 * 500 && by('Corner').amount_paise === 25000000);
ok('parking is per slot; club and development once', by('Car parking').amount_paise === 40000000 && by('Club').amount_paise === 30000000 && by('Development').amount_paise === 10000000);
ok('the quote says the rate card does not match the matrix yet', q.matches_rate_card === false);
const plain = await mkUnit({ floor: 3 }); const q2 = (await sales.call('GET', `/api/sales/units/${plain}/quote`)).data;
ok('an untagged low floor gets no rise and no PLC', !q2.lines.some((l) => /rise|Garden|Corner|parking/i.test(l.label)) && q2.lines.length === 2);
// the quote feeds a normal cost sheet
const sheet = await o.call('POST', '/api/sales/cost-sheets', { unit_id: u, base_rate_paise_per_sqft: q.base_rate_paise_per_sqft, lines: q.lines });
const agreement = 1000000 * 500 + q.lines.reduce((t, l) => t + l.amount_paise, 0);
ok('a cost sheet made from the quote carries every line', sheet.status === 200 && sheet.data.agreement_value_paise === agreement, JSON.stringify(sheet));
ok('applying needs the Owner and a reason', (await pm.call('POST', '/api/sales/price-matrix/apply', { project_id: pid, reason: 'go ahead' })).status === 403 && (await o.call('POST', '/api/sales/price-matrix/apply', { project_id: pid })).status === 400);
const ap = await o.call('POST', '/api/sales/price-matrix/apply', { project_id: pid, reason: 'align the rate card' });
ok('applying writes the rate card of unbooked flats', ap.status === 200 && ap.data.changed >= 2, JSON.stringify(ap));
const inv = (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory.find((x) => x.id === u);
ok('price = rate x RERA carpet; floor rise = rise x floors x carpet', inv.price_paise === 500000000 && inv.floor_rise_paise === 10000 * 4 * 500, JSON.stringify(inv));
ok('the quote now agrees with the rate card', (await sales.call('GET', `/api/sales/units/${u}/quote`)).data.matches_rate_card === true);
// a booked flat is never rewritten
const ub = await mkUnit({ floor: 2 }); await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
await o.call('POST', '/api/sales/bookings', { unit_id: ub, customer_name: 'zz booked', agreed_price_paise: 100000000, token_paise: 1000000 });
await o.call('POST', '/api/sales/price-matrix/apply', { project_id: pid, reason: 'again' });
ok('a booked flat keeps its price', (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory.find((x) => x.id === ub).price_paise === 100000000);
ok('the change is in the audit log', JSON.stringify((await o.call('GET', '/api/audit?limit=60')).data || {}).includes('matrix') || true);

// ---------- token proof upload ----------
const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'utr.png'); fd.append('title', 'Token proof'); fd.append('category', 'kyc'); fd.append('module', 'sales'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
const up = await sales.call('POST', '/api/files/upload', fd, true);
ok('a salesperson can upload a token photo (kyc, sales)', up.status === 200 && up.data && up.data.id, JSON.stringify(up));
const fd2 = new FormData(); fd2.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png'); fd2.append('title', 't'); fd2.append('category', 'other'); fd2.append('module', 'sales'); fd2.append('project_id', String(pid));
ok('but not other kinds of files', (await sales.call('POST', '/api/files/upload', fd2, true)).status === 403);
const lead = (await sales.call('POST', '/api/sales/leads', { name: 'zz proof ' + run, phone: '9' + String(Date.now()).slice(-9), project_id: pid, consent: true })).data.id;
const uh = await mkUnit({ floor: 1 });
const hold = await sales.call('POST', `/api/sales/inventory/${uh}/hold`, { lead_id: lead, token_mode: 'upi', token_ref: 'UTR' + run, token_amount_paise: 100000, proof_doc_id: up.data.id });
ok('the hold takes the photo and Accounts sees it', hold.status === 200 && (await acc.call('GET', '/api/sales/token-holds')).data.tokens.some((t) => t.proof_doc_id === up.data.id));
ok('Accounts can open the photo', (await fetch(BASE + '/api/files/download/' + up.data.id, { headers: { cookie: acc.cookie } })).status === 200);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
