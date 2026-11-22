// tests/partydocs.mjs — WP-9: vendor and contractor document expiry. Same env vars as security.mjs.
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
const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []); const site = await mkUser('site', []); const sales = await mkUser('sales', []);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
await setSetting('con.enabled', 'on');
const vendor = (await o.call('POST', '/api/procurement/vendors', { name: 'zz Vendor ' + run })).data.id;
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz Contractor ' + run })).data.id;

// ---------- vendor documents ----------
ok('site cannot see party documents', (await site.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).status === 403);
ok('sales cannot see party documents', (await sales.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).status === 403);
ok('party type is required', (await pur.call('POST', '/api/partydocs', { party_id: vendor, doc_type: 'x' })).status === 400);
ok('document type is typed freely but required', (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: ' ' })).status === 400);
ok('bad date refused', (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'GST certificate', valid_till: '31/12/2026' })).status === 400);
ok('unknown vendor refused', (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: 99999999, doc_type: 'GST certificate' })).status === 404);
const d1 = (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Insurance policy', valid_till: iso(20), reminder_days: 30 })).data.id;
const list = (await pur.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).data.docs;
ok('document due in 20 days is "expiring"', list.length === 1 && list[0].state === 'expiring' && list[0].days_left === 20, JSON.stringify(list));
const far = (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Agreement', valid_till: iso(200) })).data.id;
const noExp = (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'PAN copy' })).data.id;
const gone = (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Old licence', valid_till: iso(-5), reminder_days: 30 })).data.id;
const states = Object.fromEntries((await pur.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).data.docs.map((d) => [d.doc_type, d.state]));
ok('states: valid, no expiry, expired', states['Agreement'] === 'valid' && states['PAN copy'] === 'no_expiry' && states['Old licence'] === 'expired', JSON.stringify(states));

// ---------- contractor documents ----------
const c1 = (await pur.call('POST', '/api/partydocs', { party_type: 'contractor', party_id: con, doc_type: 'Labour licence', valid_till: iso(10) })).data.id;
ok('contractor documents work', (await pm.call('GET', `/api/partydocs?party_type=contractor&party_id=${con}`)).data.docs.length === 1);
ok('accounts can view vendor documents', (await acc.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).status === 200);
await setSetting('con.enabled', 'off');
ok('contractor documents follow the module switch', (await pur.call('GET', `/api/partydocs?party_type=contractor&party_id=${con}`)).status === 403);
await setSetting('con.enabled', 'on');

// ---------- reminders ----------
const tick = await fetch(BASE + '/__scheduled?cron=30+*+*+*+*');
if (tick.status === 200) {
  await new Promise((r) => setTimeout(r, 1500));
  const notes = async (who) => JSON.stringify((await who.call('GET', '/api/notifications')).data);
  let n = await notes(pm);
  ok('PM is told about the document expiring in 20 days', n.includes('Document expiring: zz Vendor') && n.includes('Insurance policy'));
  ok('PM is told the old licence has EXPIRED', n.includes('Document EXPIRED: zz Vendor') && n.includes('Old licence'));
  ok('Purchase is told too', (await notes(pur)).includes('Insurance policy'));
  ok('a far-off document and one with no expiry stay quiet', !n.includes('(#' + far + ')') && !n.includes('(#' + noExp + ')'));
  ok('contractor document reminder includes the contractor name', n.includes('Document expiring: zz Contractor') && n.includes('Labour licence'));
  ok('Accounts and Site are not bothered', !(await notes(acc)).includes('Insurance policy') && !(await notes(site)).includes('Insurance policy'));
  await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1200));
  ok('same reminder is not repeated within a week', JSON.stringify((await pm.call('GET', '/api/notifications')).data).split('(#' + d1 + ')').length === 2);
} else console.log('SKIP  reminder tests (dev server started without --test-scheduled)');

// ---------- replacing re-arms ----------
const renew = await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Insurance policy', valid_till: iso(365), replaces_id: d1 });
ok('renewed copy replaces the old one', renew.status === 200);
const after = (await pur.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).data.docs;
const oldRow = after.find((d) => d.id === d1), newRow = after.find((d) => d.id === renew.data.id);
ok('old copy is marked replaced and the new one is valid', oldRow.state === 'replaced' && newRow.state === 'valid' && newRow.days_left === 365, JSON.stringify([oldRow.state, newRow.state]));
ok('a document cannot be replaced twice', (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Insurance policy', replaces_id: d1 })).status === 404);
ok('replacing a document of another party is refused', (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'x', replaces_id: c1 })).status === 404);
const exp2 = (await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Renewal test', valid_till: iso(5) })).data.id;
await pur.call('POST', '/api/partydocs', { party_type: 'vendor', party_id: vendor, doc_type: 'Renewal test', valid_till: iso(400), replaces_id: exp2 });
if (tick.status === 200) { await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1200)); ok('no reminder for a document that was replaced', !JSON.stringify((await pm.call('GET', '/api/notifications')).data).includes('(#' + exp2 + ')')); }

// ---------- removing, header ----------
ok('only the Owner can delete a document: Purchase is refused', (await pur.call('DELETE', `/api/partydocs/${gone}?party_type=vendor`)).status === 403);
ok('document can be removed', (await o.call('DELETE', `/api/partydocs/${gone}?party_type=vendor`)).status === 200 && !(await pur.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).data.docs.some((d) => d.id === gone));
ok('viewer-only roles cannot remove (sales is refused)', (await sales.call('DELETE', `/api/partydocs/${noExp}?party_type=vendor`)).status === 403);
ok('requests without the header are refused', (await fetch(BASE + '/api/partydocs', { method: 'POST', headers: { cookie: pur.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ party_type: 'vendor' }) })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
