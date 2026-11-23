// tests/m1_step2.mjs — Module 1 gaps, step 2: vacating proof, PAN + masked Aadhaar, Director PIN and pending rent changes, demolition gate.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `zp-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zp ' + role, email, role, projects }); const pw = 'ZpStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; c.email = email; c.pw = pw; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);

const redev = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m2 ' + run, code: 'M2' + run.toUpperCase().slice(-6), type: 'redevelopment', budget_paise: 50000000 })).data.id;
await o.call('POST', '/api/approvals/load-template', { project_id: redev, redevelopment: true });
const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const viewer = await mkUser('viewer', []); const pur = await mkUser('purchase', []);
const soc = (await pm.call('POST', '/api/redev/societies', { project_id: redev, name: 'M2 CHS ' + run, consent_threshold_pct: 51 })).data.id;
const mk = async (n) => (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'M2 member ' + n, unit_label: 'F' + n, wing: 'A', carpet_sqft: 400 })).data.id;
const m1 = await mk(1), m2 = await mk(2), m3 = await mk(3);
const doc = async (who, title) => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4 ' + title)], { type: 'application/pdf' }), title + '.pdf'); fd.append('title', title); fd.append('category', 'society'); fd.append('module', 'redevelopment'); fd.append('project_id', String(redev)); fd.append('audience', 'internal'); const r = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: who.cookie }, body: fd }); const d = await r.json().catch(() => null); return d && d.data && d.data.id; };

// ============ 1. one old flat, one primary member ============
const dupFlat = await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Someone else', unit_label: 'F1', wing: 'A' });
ok('a second member cannot be added to the same old flat', dupFlat.status === 409 && /already belongs/.test(dupFlat.err), JSON.stringify(dupFlat));

// ============ 2. vacating proof ============
const base = { paaa_reg_no: 'PAAA-M2', paaa_reg_date: '2020-01-01', vacated_on: iso(-10) };
const photo = await doc(pm, 'Empty flat F1');
ok('a vacating date without a photo is refused', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, base)).status === 400);
ok('a photo without the phone location is refused', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { ...base, vacate_photo_doc_id: photo })).status === 400);
ok('a location outside India is refused', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { ...base, vacate_photo_doc_id: photo, vacate_lat: 0, vacate_lng: 0 })).status === 400);
ok('a photo that is not in this project is refused', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { ...base, vacate_photo_doc_id: 99999999, vacate_lat: 19.07, vacate_lng: 72.87 })).status === 400);
const okV = await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { ...base, vacate_photo_doc_id: photo, vacate_lat: 19.07, vacate_lng: 72.87, meter_electricity: 'E-12345', meter_water: 'W-88', keys_received: true });
ok('photo + location + meter readings: vacating is recorded', okV.status === 200, JSON.stringify(okV));
const list = (await o.call('GET', `/api/redev/societies/${soc}/members`)).data.members;
const r1 = list.find((m) => m.id === m1);
ok('the proof is kept on the member (photo, place, time, meters)', r1.vacate_photo_doc_id === photo && r1.vacate_lat === 19.07 && !!r1.vacate_proof_at && r1.meter_electricity === 'E-12345' && r1.meter_water === 'W-88', JSON.stringify(r1));
ok('changing only the keys later needs no new photo', (await pm.call('PUT', `/api/redev/members/${m1}/vacate`, { keys_received: false })).status === 200);
const ov = (n) => ({ ...base, paaa_reg_no: 'PAAA-OV' + n, override_note: n === 'short' ? 'no' : 'Member left while the app was offline, flat checked by the architect' });
ok('only the Owner can record vacating without a photo', (await pm.call('PUT', `/api/redev/members/${m2}/vacate`, ov('pm'))).status === 403);
ok('the Owner must explain a missing photo properly', (await o.call('PUT', `/api/redev/members/${m2}/vacate`, ov('short'))).status === 400);
ok('the Owner can record it with a written reason', (await o.call('PUT', `/api/redev/members/${m2}/vacate`, ov('ok'))).status === 200);
ok('rent cannot start for a flat that was never vacated', (await o.call('POST', `/api/redev/members/${m3}/transit-term`, { monthly_rent_paise: 100000, start_date: iso(-30).slice(0, 8) + '01' })).status === 409);

// ============ 3. PAN and Aadhaar (last 4 only) ============
ok('a wrongly typed PAN is refused', (await pm.call('PUT', `/api/redev/members/${m1}/identity`, { pan: 'ABC123' })).status === 400);
ok('a full Aadhaar number is refused', (await pm.call('PUT', `/api/redev/members/${m1}/identity`, { aadhaar_last4: '1234 5678 9012' })).status === 400);
ok('3 digits of Aadhaar are refused', (await pm.call('PUT', `/api/redev/members/${m1}/identity`, { aadhaar_last4: '123' })).status === 400);
const pan = 'ABCDE' + String(Date.now()).slice(-4) + 'F';
const idr = await pm.call('PUT', `/api/redev/members/${m1}/identity`, { pan: pan.toLowerCase(), aadhaar_last4: '4321' });
ok('PAN and the last 4 of the Aadhaar are saved, shown masked', idr.status === 200 && idr.data.pan_masked === 'XXXXXX' + pan.slice(-4) && idr.data.aadhaar_masked === 'XXXX XXXX 4321', JSON.stringify(idr));
const dupPan = await pm.call('PUT', `/api/redev/members/${m2}/identity`, { pan });
ok('the same PAN cannot be given to a second member', dupPan.status === 409 && /already linked/.test(dupPan.err), JSON.stringify(dupPan));
ok('a different PAN is fine for another member', (await pm.call('PUT', `/api/redev/members/${m2}/identity`, { pan: 'ZZZZZ' + String(Date.now()).slice(-4) + 'Q' })).status === 200);
const lm = (await o.call('GET', `/api/redev/societies/${soc}/members`)).data.members.find((m) => m.id === m1);
ok('the list shows only masked identity, never the full PAN or Aadhaar', lm.pan_masked === 'XXXXXX' + pan.slice(-4) && lm.aadhaar_masked === 'XXXX XXXX 4321' && !JSON.stringify(lm).includes(pan) && !('pan_enc' in lm) && !('pan_hash' in lm));
const vm = (await viewer.call('GET', `/api/redev/societies/${soc}/members`)).data.members.find((m) => m.id === m1);
ok('a viewer sees only "on file"', vm.pan_masked === 'on file' && vm.aadhaar_masked === 'on file');
ok('only Owner and PM can enter identity', (await acc.call('PUT', `/api/redev/members/${m3}/identity`, { pan: 'QQQQQ1234Q' })).status === 403);
const ex = JSON.stringify((await o.call('GET', '/api/export-all?part=1')).data || {});
ok('the PAN is not in the data export', !ex.includes(pan));

// ============ 4. Director PIN and pending rent changes ============
ok('a PM cannot set a PIN', (await pm.call('POST', '/api/redev/approval-pin', { password: 'x', pin: '482913' })).status === 403);
ok('a wrong login password is refused', (await o.call('POST', '/api/redev/approval-pin', { password: 'wrong-password', pin: '482913' })).status === 403);
ok('a weak PIN is refused', (await o.call('POST', '/api/redev/approval-pin', { password: process.env.OWNER_PASSWORD, pin: '111111' })).status === 400 && (await o.call('POST', '/api/redev/approval-pin', { password: process.env.OWNER_PASSWORD, pin: '12ab' })).status === 400);
ok('the Owner sets a PIN', (await o.call('POST', '/api/redev/approval-pin', { password: process.env.OWNER_PASSWORD, pin: '482913' })).status === 200 && (await o.call('GET', '/api/redev/approval-pin')).data.has_pin === true);
const first = await acc.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 3000000 });
ok('setting a rent for the first time needs no approval', first.status === 200 && !first.data?.pending, JSON.stringify(first));
const chg = await acc.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 4500000 });
ok('Accounts changing a rent already set: it waits for the Owner', chg.status === 200 && chg.data.pending === true, JSON.stringify(chg));
ok('nothing changed yet', (await o.call('GET', `/api/redev/members/${m1}/terms`)).data.terms.rent_y1_paise === 3000000);
const pend = (await o.call('GET', '/api/redev/rent-changes')).data.changes;
ok('the Owner sees the change waiting, with who asked', pend.length >= 1 && pend[0].change.rent_y1_paise === 4500000 && !!pend[0].requested_by_name, JSON.stringify(pend[0]));
ok('Accounts cannot approve', (await acc.call('POST', `/api/redev/rent-changes/${pend[0].id}/approve`, { pin: '482913' })).status === 403);
ok('a wrong PIN does not approve', (await o.call('POST', `/api/redev/rent-changes/${pend[0].id}/approve`, { pin: '000000' })).status === 400);
ok('the right PIN approves and applies it', (await o.call('POST', `/api/redev/rent-changes/${pend[0].id}/approve`, { pin: '482913' })).status === 200 && (await o.call('GET', `/api/redev/members/${m1}/terms`)).data.terms.rent_y1_paise === 4500000);
ok('a decided change cannot be decided again', (await o.call('POST', `/api/redev/rent-changes/${pend[0].id}/approve`, { pin: '482913' })).status === 409);
const own = await o.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 5000000 });
ok('the Owner changing a set rent must give the PIN', own.status === 400 && own.code === 'pin_required' && /PIN/.test(own.err), JSON.stringify(own));
ok('a wrong PIN from the Owner is refused', (await o.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 5000000, pin: '111222' })).status === 400);
ok('the Owner with the right PIN changes it at once', (await o.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 5000000, pin: '482913' })).status === 200 && (await o.call('GET', `/api/redev/members/${m1}/terms`)).data.terms.rent_y1_paise === 5000000);
const chg2 = await acc.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'per_sqft', rent_y1_paise: 6000 });
const id2 = chg2.data.id;
ok('rejecting needs a reason', (await o.call('POST', `/api/redev/rent-changes/${id2}/reject`, {})).status === 400);
ok('a rejected change is not applied', (await o.call('POST', `/api/redev/rent-changes/${id2}/reject`, { note: 'Not agreed with the member' })).status === 200 && (await o.call('GET', `/api/redev/members/${m1}/terms`)).data.terms.rent_basis === 'monthly');
// the monthly transit rent too
const start = iso(-10).slice(0, 8) + '01';
await o.call('PUT', `/api/redev/members/${m2}/terms`, {}); 
const t1 = await acc.call('POST', `/api/redev/members/${m2}/transit-term`, { monthly_rent_paise: 2000000, start_date: start });
ok('a first monthly rent is applied directly', t1.status === 200 && !t1.data.pending, JSON.stringify(t1));
const t2 = await acc.call('POST', `/api/redev/members/${m2}/transit-term`, { monthly_rent_paise: 2500000, start_date: start });
ok('a changed monthly rent waits for the Owner', t2.status === 200 && t2.data.pending === true, JSON.stringify(t2));
const tm = (await o.call('GET', `/api/redev/members/${m2}/transit`)).data;
ok('until then the old rent stands', tm.term.monthly_rent_paise === 2000000 && tm.months[0].due_paise === 2000000);
ok('approved with the PIN, the new rent applies', (await o.call('POST', `/api/redev/rent-changes/${t2.data.id}/approve`, { pin: '482913' })).status === 200 && (await o.call('GET', `/api/redev/members/${m2}/transit`)).data.term.monthly_rent_paise === 2500000);
ok('the PIN is stored only as a hash and never exported', !JSON.stringify((await o.call('GET', '/api/export-all?part=1')).data || {}).includes('approval_pin_hash'));

// ============ 5. pre-demolition gate ============
await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz demo ' + run, trade: 'demolition', pan: 'ABCDE1234F' })).data.id;
const mkWo = async (dem) => (await pur.call('POST', '/api/contractors/work-orders', { project_id: redev, contractor_id: con, scope: dem ? 'Demolition of old building' : 'Fencing', basis: 'lump_sum', value_paise: 500000, retention_bp: 500, is_demolition: dem })).data.id;
const woD = await mkWo(true), woN = await mkWo(false);
for (const id of [woD, woN]) await pur.call('POST', `/api/contractors/work-orders/${id}/submit`);
const blocked = await o.call('POST', `/api/contractors/work-orders/${woD}/approve`, {});
ok('a demolition work order is blocked: no IOD and no proofs', blocked.status === 409 && blocked.code === 'demolition_gate' && /IOD/.test(blocked.err) && /electricity/.test(blocked.err) && /gas/.test(blocked.err), JSON.stringify(blocked));
ok('an ordinary work order is not affected', (await o.call('POST', `/api/contractors/work-orders/${woN}/approve`, {})).status === 200);
ok('a proof needs a file, or a reason why it does not apply', (await pm.call('PUT', `/api/redev/projects/${redev}/site-proofs/electricity`, {})).status === 400 && (await pm.call('PUT', `/api/redev/projects/${redev}/site-proofs/tree_noc`, { status: 'not_applicable', note: 'no' })).status === 400);
ok('an unknown proof is refused', (await pm.call('PUT', `/api/redev/projects/${redev}/site-proofs/oxygen`, { status: 'not_applicable', note: 'reason given' })).status === 400);
for (const k of ['electricity', 'water', 'gas']) await pm.call('PUT', `/api/redev/projects/${redev}/site-proofs/${k}`, { document_id: await doc(pm, 'Meter removal ' + k), ref_no: 'R-' + k, on_date: iso(-1) });
await pm.call('PUT', `/api/redev/projects/${redev}/site-proofs/tree_noc`, { status: 'not_applicable', note: 'No trees on the plot' });
const st1 = await pm.call('PUT', `/api/redev/projects/${redev}/site-proofs/barricade`, { status: 'not_applicable', note: 'Compound wall already in place' });
ok('with all five proofs the gate still waits for the IOD', /IOD/.test(st1.data.blocked || '') && !/electricity|water|gas|tree|barricad/.test(st1.data.blocked), JSON.stringify(st1.data));
const apr = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === redev);
const iod = apr.find((a) => a.gate_key === 'iod');
await o.call('POST', `/api/approvals/${iod.id}/event`, { event: 'applied' });
await o.call('POST', `/api/approvals/${iod.id}/event`, { event: 'approved', letter_no: 'IOD/M2', letter_date: iso(-5) });
const gs = (await pm.call('GET', `/api/redev/projects/${redev}/site-proofs`)).data;
ok('the screen shows the gate as clear', gs.blocked === null && gs.proofs.length === 5, JSON.stringify(gs));
ok('the demolition work order can now be approved', (await o.call('POST', `/api/contractors/work-orders/${woD}/approve`, {})).status === 200);
ok('purchase cannot change site proofs', (await pur.call('PUT', `/api/redev/projects/${redev}/site-proofs/water`, { status: 'not_applicable', note: 'reason given' })).status === 403);

// ============ 6. too many wrong PINs ============
for (let i = 0; i < 5; i++) await o.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 7000000, pin: '99999' + i });
const locked = await o.call('PUT', `/api/redev/members/${m1}/terms`, { rent_basis: 'monthly', rent_y1_paise: 7000000, pin: '482913' });
ok('after 5 wrong PINs even the right one waits 15 minutes', locked.status === 400 && /Too many/.test(locked.err), JSON.stringify(locked));

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
