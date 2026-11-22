// tests/professionals.mjs — professionals register and contracts kept per vendor, contractor and professional. Same env vars as security.mjs.
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

// ---------- register ----------
ok('site and sales cannot see professionals', (await site.call('GET', '/api/professionals')).status === 403 && (await sales.call('GET', '/api/professionals')).status === 403);
ok('name is required', (await pur.call('POST', '/api/professionals', { name: ' ', profession: 'Architect' })).status === 400);
ok('bad PAN refused', (await pur.call('POST', '/api/professionals', { name: 'x', pan: '12' })).status === 400);
ok('bad email refused', (await pur.call('POST', '/api/professionals', { name: 'x', email: 'nope' })).status === 400);
const arch = (await pm.call('POST', '/api/professionals', { name: 'Ar. Mehta ' + run, profession: 'Architect', firm: 'Mehta & Associates', phone: '9800000001', pan: 'ABCDE1234F' })).data.id;
const adv = (await pur.call('POST', '/api/professionals', { name: 'Adv. Rao ' + run, profession: 'Advocate' })).data.id;
const list = (await acc.call('GET', '/api/professionals')).data.professionals;
const a = list.find((p) => p.id === arch);
ok('Accounts sees the PAN masked only', a.has_pan && a.pan_masked === '••••234F' && !JSON.stringify(list).includes('ABCDE1234F'));
ok('Purchase never sees PAN digits', (await pur.call('GET', '/api/professionals')).data.professionals.find((p) => p.id === arch).pan_masked === '');
ok('search by profession finds the advocate', (await pur.call('GET', `/api/professionals?q=advocate`)).data.professionals.some((p) => p.id === adv));
ok('search by name', (await pur.call('GET', `/api/professionals?q=mehta ${run}`)).data.professionals.length === 1);
ok('viewer can read, accounts can edit', (await acc.call('PUT', `/api/professionals/${adv}`, { firm: 'Rao Law' })).status === 200 && (await acc.call('GET', '/api/professionals')).data.professionals.find((p) => p.id === adv).firm === 'Rao Law');
ok('edit keeps the PAN when none is sent', (await pm.call('PUT', `/api/professionals/${arch}`, { phone: '9800000002' })).status === 200 && (await acc.call('GET', '/api/professionals')).data.professionals.find((p) => p.id === arch).pan_masked === '••••234F');
ok('sales cannot add', (await sales.call('POST', '/api/professionals', { name: 'x' })).status === 403);

// ---------- contracts kept for professionals, vendors and contractors ----------
const vendor = (await o.call('POST', '/api/procurement/vendors', { name: 'zz Vendor ' + run })).data.id;
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz Contractor ' + run })).data.id;
const add = (type, id, body) => pur.call('POST', '/api/partydocs', { party_type: type, party_id: id, ...body });
ok('professional: architect agreement kept as a contract', (await add('professional', arch, { doc_type: 'Architect agreement', kind: 'contract', valid_till: iso(300) })).status === 200);
ok('professional: other documents too', (await add('professional', arch, { doc_type: 'COA registration', valid_till: iso(15) })).status === 200);
ok('vendor: supply contract', (await add('vendor', vendor, { doc_type: 'Supply contract', kind: 'contract', valid_till: iso(200) })).status === 200);
ok('contractor: work contract', (await add('contractor', con, { doc_type: 'Work contract', kind: 'contract' })).status === 200);
const docs = (await pur.call('GET', `/api/partydocs?party_type=professional&party_id=${arch}`)).data.docs;
ok('contracts are listed first and marked as contracts', docs.length === 2 && docs[0].kind === 'contract' && docs[1].kind === 'document', JSON.stringify(docs.map((d) => d.kind)));
ok('unknown kind falls back to a plain document', (await add('vendor', vendor, { doc_type: 'Misc', kind: 'weird' })).status === 200 && (await pur.call('GET', `/api/partydocs?party_type=vendor&party_id=${vendor}`)).data.docs.find((d) => d.doc_type === 'Misc').kind === 'document');
ok('unknown professional refused', (await add('professional', 99999999, { doc_type: 'x' })).status === 404);
ok('site cannot reach professional documents', (await site.call('GET', `/api/partydocs?party_type=professional&party_id=${arch}`)).status === 403);
ok('a contract can be replaced by the signed copy and the old one is marked replaced', await (async () => {
  const c = docs.find((d) => d.kind === 'contract');
  const r = await add('professional', arch, { doc_type: 'Architect agreement', kind: 'contract', valid_till: iso(700), replaces_id: c.id });
  const after = (await pur.call('GET', `/api/partydocs?party_type=professional&party_id=${arch}`)).data.docs;
  return r.status === 200 && after.find((d) => d.id === c.id).state === 'replaced' && after.filter((d) => d.kind === 'contract' && d.current).length === 1;
})());

// ---------- reminders say "Contract" ----------
await add('professional', adv, { doc_type: 'Retainer agreement', kind: 'contract', valid_till: iso(10), reminder_days: 30 });
const tick = await fetch(BASE + '/__scheduled?cron=30+*+*+*+*');
if (tick.status === 200) {
  await new Promise((r) => setTimeout(r, 1500));
  const n = JSON.stringify((await pm.call('GET', '/api/notifications')).data);
  ok('PM is told a contract is expiring, naming the professional', n.includes('Contract expiring: Adv. Rao') && n.includes('Retainer agreement'));
  ok('professional documents expiring soon are included', n.includes('Document expiring: Ar. Mehta') && n.includes('COA registration'));
} else console.log('SKIP  reminders (dev server without --test-scheduled)');
ok('requests without the header are refused', (await fetch(BASE + '/api/professionals', { method: 'POST', headers: { cookie: pm.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
