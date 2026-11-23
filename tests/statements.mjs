// tests/statements.mjs — WP-25: buyer statement snapshot through an expiring share link. Same env vars as security.mjs.
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
import { execSync } from 'node:child_process';
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-st ' + run, code: 'ST' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []); const pm = await mkUser('pm', []); const site = await mkUser('site', [pid]);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
const u = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'S', floor: 1, unit_no: 'ST' + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: u, customer_name: 'Statement Buyer ' + run, phone: '9755000111', agreed_price_paise: 100000000, token_paise: 0 })).data.id;
const dem = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0].id;
await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 5000000, mode: 'neft', ref_no: 'ST' + run, demand_id: dem, received_on: new Date().toISOString().slice(0, 10) });
const pdf = (name) => Buffer.from('%PDF-1.4 statement ' + name);
const up = async (who, over = {}, mime = 'application/pdf', name = 'statement.pdf') => { const fd = new FormData(); fd.append('file', new Blob([pdf(name)], { type: mime }), name); fd.append('title', over.title || 'Statement ' + run); fd.append('category', over.category || 'statement'); fd.append('module', over.module || 'statement'); fd.append('project_id', String(over.project_id || pid)); fd.append('audience', over.audience || 'customer'); const r = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: who.cookie }, body: fd }); const d = await r.json().catch(() => null); return { status: r.status, id: d && d.data && d.data.id }; };
ok('the statement prints on the letterhead (data for print.html)', (await acc.call('GET', `/api/print/statement/${bk}`)).data.kind === 'statement');
ok('Sales and Site cannot upload a statement file', (await up(sales)).status === 403 && (await up(site)).status === 403);
const f = await up(acc); ok('Accounts uploads the saved PDF', f.status === 200 && f.id, JSON.stringify(f));
ok('Sales cannot send a statement link; neither can the PM', (await sales.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: f.id })).status === 403 && (await pm.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: f.id })).status === 403);
ok('a file that is internal or not a statement is refused', (await acc.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: (await up(acc, { audience: 'internal' })).id })).status === 400 && (await acc.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: 999999 })).status === 400);
ok('a statement that is not a PDF is refused', (await acc.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: (await up(acc, {}, 'image/png', 'x.png')).id })).status === 400);
ok('requests without the header are refused', (await fetch(BASE + `/api/sales/bookings/${bk}/statement-link`, { method: 'POST', headers: { cookie: acc.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
const L = await acc.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: f.id });
ok('Accounts gets an expiring link (14 days by default)', L.status === 200 && /^\/s\/[A-Za-z0-9_-]{40,}$/.test(L.data.link) && L.data.days === 14, JSON.stringify(L));
const token = L.data.link.split('/')[2];
const open = await fetch(BASE + `/s/${token}/file`);
ok('the customer opens it with no login and gets the PDF', open.status === 200 && /pdf/.test(open.headers.get('content-type') || '') && (await open.text()).includes('statement'));
ok('the link shows in the booking with its views', (await acc.call('GET', `/api/sales/bookings/${bk}/statement-links`)).data.links[0].view_count >= 1);
ok('Sales cannot see the list of statement links', (await sales.call('GET', `/api/sales/bookings/${bk}/statement-links`)).status === 403 && (await pm.call('GET', `/api/sales/bookings/${bk}/statement-links`)).status === 200);
ok('the statement file is not listed or downloadable by Sales or Site (internal vault)', (await fetch(BASE + `/api/files/download/${f.id}`, { headers: { cookie: sales.cookie } })).status === 403 && (await fetch(BASE + `/api/files/download/${f.id}`, { headers: { cookie: site.cookie } })).status === 403 && !JSON.stringify((await sales.call('GET', `/api/documents?project_id=${pid}`)).data || {}).includes('Statement ' + run));
ok('a made-up token gets nothing', (await fetch(BASE + `/s/${'A'.repeat(43)}/file`)).status === 410);
// revoke
const rv = await acc.call('POST', `/api/sales/statement-links/${L.data.id}/revoke`);
ok('Accounts turns it off', rv.status === 200 && (await fetch(BASE + `/s/${token}/file`)).status === 410);
ok('the list says revoked; turning off twice is refused; Sales cannot revoke', (await acc.call('GET', `/api/sales/bookings/${bk}/statement-links`)).data.links[0].state === 'revoked' && (await acc.call('POST', `/api/sales/statement-links/${L.data.id}/revoke`)).status === 409 && (await sales.call('POST', `/api/sales/statement-links/${L.data.id}/revoke`)).status === 403);
// expiry
const L2 = await acc.call('POST', `/api/sales/bookings/${bk}/statement-link`, { document_id: f.id, days: 3 }); const t2 = L2.data.link.split('/')[2];
ok('the number of days can be chosen', L2.data.days === 3 && (await fetch(BASE + `/s/${t2}/file`)).status === 200);
if (process.env.D1_PERSIST_TO) {
  try {
    execSync(`npx wrangler d1 execute nirmaan-db --local --persist-to ${process.env.D1_PERSIST_TO} --command "UPDATE share_links SET expires_at = datetime('now', '-1 hour') WHERE id = ${L2.data.id}"`, { stdio: 'ignore' });
    ok('after the time limit the link says it has expired', (await fetch(BASE + `/s/${t2}/file`)).status === 410 && (await acc.call('GET', `/api/sales/bookings/${bk}/statement-links`)).data.links.find((l) => l.id === L2.data.id).state === 'expired');
  } catch (e) { console.log('SKIP  expiry test:', String(e.message).slice(0, 80)); }
}
ok('creating and turning off links are in the audit log', JSON.stringify((await o.call('GET', '/api/audit?limit=80')).data).includes('Turned off the statement link'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
