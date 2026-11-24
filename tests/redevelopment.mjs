// tests/redevelopment.mjs — WP-1 consent meter, WP-2 rehab / transit rent / corpus, WP-3 meetings. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // these suites bill stages without registering the Agreement for Sale; the 10% rule is tested in m4_step1
let seq = 0;
const mkUser = async (role, projects) => { const email = `zp-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zp ' + role, email, role, projects }); const pw = 'ZpStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; c.email = email; c.pw = pw; return c; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const redev = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-rd ' + run, code: 'RD' + run.toUpperCase().slice(-6), type: 'redevelopment', budget_paise: 50000000 })).data.id;
const plain = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-nb ' + run, code: 'NB' + run.toUpperCase().slice(-6), type: 'new_build', budget_paise: 50000000 })).data.id;
await o.call('POST', '/api/approvals/load-template', { project_id: redev, redevelopment: true });
const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const viewer = await mkUser('viewer', []); const sales = await mkUser('sales', []); const site = await mkUser('site', [redev]); const hr = await mkUser('hr', []);
const notes = async (who) => JSON.stringify((await who.call('GET', '/api/notifications')).data);

// ============ access ============
ok('Sales, Site and HR cannot open the module', (await sales.call('GET', '/api/redev/societies')).status === 403 && (await site.call('GET', '/api/redev/societies')).status === 403 && (await hr.call('GET', '/api/redev/societies')).status === 403);
ok('a society needs a redevelopment project', /not a redevelopment/.test((await o.call('POST', '/api/redev/societies', { project_id: plain, name: 'X' })).err || ''));
ok('a society needs a name; the threshold must be 1 to 100 per cent', (await o.call('POST', '/api/redev/societies', { project_id: redev, name: '' })).status === 400 && (await o.call('POST', '/api/redev/societies', { project_id: redev, name: 'X', consent_threshold_pct: 0 })).status === 400 && (await o.call('POST', '/api/redev/societies', { project_id: redev, name: 'X', consent_threshold_pct: 120 })).status === 400);
ok('Accounts and the CA cannot add a society', (await acc.call('POST', '/api/redev/societies', { project_id: redev, name: 'X' })).status === 403 && (await viewer.call('POST', '/api/redev/societies', { project_id: redev, name: 'X' })).status === 403);
ok('requests without the header are refused', (await fetch(BASE + '/api/redev/societies', { method: 'POST', headers: { cookie: o.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
const soc = (await pm.call('POST', '/api/redev/societies', { project_id: redev, name: 'Sai Krupa CHS ' + run, registration_no: 'MUM/1234', consent_threshold_pct: 51 })).data.id;
ok('the PM creates a society (threshold stored as 5100)', soc && (await pm.call('GET', `/api/redev/societies/${soc}`)).data.society.consent_threshold_bp === 5100);

// ============ members ============
const rows = Array.from({ length: 10 }, (_, i) => ({ wing: 'A', unit_label: String(101 + i), member_name: 'Member ' + (i + 1), phone: '98200000' + String(10 + i), carpet_sqft: 400 + i * 10, member_type: i === 9 ? 'tenant' : 'owner' }));
ok('a bad phone number and an Aadhaar number are refused', (await pm.call('POST', `/api/redev/societies/${soc}/members/import`, { rows: [{ ...rows[0], phone: '123' }] })).status === 400 && (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Z', unit_label: '1', notes: 'aadhaar 1234 5678 9012' })).status === 400);
const imp = await pm.call('POST', `/api/redev/societies/${soc}/members/import`, { rows });
ok('10 members imported in one go', imp.status === 200 && imp.data.added === 10, JSON.stringify(imp));
ok('importing the same list again adds nothing (duplicates skipped)', (await pm.call('POST', `/api/redev/societies/${soc}/members/import`, { rows })).data.added === 0);
ok('more than 200 at a time is refused', (await pm.call('POST', `/api/redev/societies/${soc}/members/import`, { rows: Array.from({ length: 201 }, (_, i) => ({ unit_label: 'x' + i, member_name: 'n' + i })) })).status === 400);
const uu = 'uuid-' + run; const m1 = await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Extra One', unit_label: '201', wing: 'B', client_uuid: uu });
ok('adding one member is idempotent with a client id', m1.status === 200 && (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Extra One', unit_label: '201', wing: 'B', client_uuid: uu })).data.duplicate === true);
const list = (await pm.call('GET', `/api/redev/societies/${soc}/members`)).data;
ok('11 members listed, 25 to a page', list.total === 11 && list.page_size === 25 && list.members.length === 11);
ok('search by name or flat', (await pm.call('GET', `/api/redev/societies/${soc}/members?q=Member 3`)).data.total === 1 && (await pm.call('GET', `/api/redev/societies/${soc}/members?q=201`)).data.total === 1);
ok('phone numbers are shown to Owner and PM only', list.members[0].phone === '+919820000010' && !('phone' in (await acc.call('GET', `/api/redev/societies/${soc}/members`)).data.members[0]) && !('phone' in (await viewer.call('GET', `/api/redev/societies/${soc}/members`)).data.members[0]));
const ids = list.members.filter((m) => m.member_name.startsWith('Member ')).map((m) => m.id);
await o.call('PUT', `/api/redev/societies/${soc}`, { name: 'Sai Krupa CHS ' + run });
// 10 members + Extra One = 11 total. Threshold 51%.
const cons = (who, id, status, note) => who.call('POST', `/api/redev/members/${id}/consent`, { status, note });

// ============ consent meter ============
for (let i = 0; i < 5; i++) await cons(pm, ids[i], 'consented');
let s = (await pm.call('GET', `/api/redev/societies/${soc}`)).data.consent;
ok('5 of 11 consented = 45.5%: not reached; nobody is notified yet', s.consented === 5 && s.pct_bp === 4545 && s.reached === false && !(await notes(o)).includes('Consent threshold reached'));
const r6 = await cons(pm, ids[5], 'consented');
ok('the 6th takes it to 54.5%: reached, announced once', r6.data.crossed === 'reached' && r6.data.consent.reached === true && r6.data.consent.pct_bp === 5455, JSON.stringify(r6.data));
ok('Owner and PM are notified; Accounts is not', (await notes(o)).includes('Consent threshold reached: Sai Krupa') && (await notes(pm)).includes('Consent threshold reached: Sai Krupa') && !(await notes(acc)).includes('Consent threshold reached'));
ok('the project\'s "Society consent" approval row gets the note', JSON.stringify((await o.call('GET', `/api/approvals?project_id=${redev}`)).data).includes('Threshold reached'));
const r7 = await cons(pm, ids[6], 'consented');
ok('a further consent does not announce again', r7.data.crossed === null);
ok('marking the same status again changes nothing and logs nothing', (await cons(pm, ids[6], 'consented')).data.unchanged === true);
ok('Accounts and the CA can see the meter but cannot change consent', (await acc.call('GET', `/api/redev/societies/${soc}`)).status === 200 && (await acc.call('POST', `/api/redev/members/${ids[7]}/consent`, { status: 'consented' })).status === 403 && (await viewer.call('POST', `/api/redev/members/${ids[7]}/consent`, { status: 'declined' })).status === 403);
ok('an unknown status is refused', (await cons(pm, ids[7], 'maybe')).status === 400);
await cons(pm, ids[5], 'declined', 'Wants a bigger flat'); await cons(pm, ids[6], 'pending'); // 5 consented again = 45.5%
ok('dropping below the threshold is announced', (await notes(pm)).includes('Consent dropped below the threshold: Sai Krupa'));
const log = (await pm.call('GET', `/api/redev/societies/${soc}/consent-log`)).data.events;
ok('the consent log shows every change with who and why', log.length === 9 && log[0].to_status === 'pending' && log.some((e) => e.note === 'Wants a bigger flat' && e.by_name) , JSON.stringify(log.length));
const pend = (await acc.call('GET', `/api/redev/societies/${soc}/pending`)).data.members;
ok('the follow-up list has pending first, then declined, without phone for Accounts', pend[0].consent_status === 'pending' && pend[pend.length - 1].consent_status === 'declined' && pend.length === 6 && !('phone' in pend[0]));
const csv = await (await acc.call('GET', `/api/redev/societies/${soc}/pending?csv=1`, null, true)).text(); ok('follow-up CSV', csv.includes('Member') && csv.includes('declined'));
const rep = (await pm.call('GET', '/api/redev/report')).data.societies.find((x) => x.id === soc); ok('consent % report per society', rep.pct === 45.5 && rep.consented === 5 && rep.declined === 1);
// area basis
await o.call('PUT', `/api/redev/societies/${soc}`, { count_basis: 'area', consent_threshold_pct: 40 });
s = (await pm.call('GET', `/api/redev/societies/${soc}`)).data.consent;
ok('counting by carpet area works and the threshold is editable (area basis, 40%)', s.basis === 'area' && s.reached === true && s.threshold_bp === 4000, JSON.stringify(s));
await o.call('PUT', `/api/redev/societies/${soc}`, { count_basis: 'members', consent_threshold_pct: 51 });
ok('the legal note is returned with the society', /advocate/.test((await pm.call('GET', `/api/redev/societies/${soc}`)).data.legal_note));
// removing a member needs a reason; paging
ok('only the Owner can remove a member: the PM is refused', (await pm.call('POST', `/api/redev/members/${m1.data.id}/remove`, { reason: 'Entered by mistake' })).status === 403);
ok('removing a member needs a reason', (await o.call('POST', `/api/redev/members/${m1.data.id}/remove`, {})).status === 400 && (await o.call('POST', `/api/redev/members/${m1.data.id}/remove`, { reason: 'Entered by mistake' })).status === 200);
await pm.call('POST', `/api/redev/societies/${soc}/members/import`, { rows: Array.from({ length: 30 }, (_, i) => ({ wing: 'C', unit_label: 'C' + i, member_name: 'Bulk ' + i })) });
ok('second page of members', (await pm.call('GET', `/api/redev/societies/${soc}/members?page=2`)).data.members.length === 15 && (await pm.call('GET', `/api/redev/societies/${soc}/members`)).data.total === 40);
// documents
ok('the checklist is empty until the Owner lists items (nothing is invented)', (await pm.call('GET', `/api/redev/members/${ids[0]}/docs`)).data.items.length === 0 && (await pm.call('POST', `/api/redev/members/${ids[0]}/docs`, { item_key: 'Share certificate' })).status === 400);
await o.call('POST', '/api/settings/red.member_doc_checklist', { value: 'Share certificate; Photo ID' });
const dl = (await pm.call('GET', `/api/redev/members/${ids[0]}/docs`)).data.items; ok('the checklist comes from the setting', dl.length === 2 && dl[0].key === 'Share certificate' && dl[0].status === 'pending');
const up = async (who, name, category) => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4 ' + name)], { type: 'application/pdf' }), name); fd.append('title', name); fd.append('category', category); fd.append('module', 'redevelopment'); fd.append('project_id', String(redev)); fd.append('audience', 'internal'); const r = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: who.cookie }, body: fd }); const d = await r.json().catch(() => null); return { status: r.status, id: d && d.data && d.data.id }; };
const f1 = await up(pm, 'share-cert.pdf', 'society');
ok('a society file is attached to a checklist item', f1.id && (await pm.call('POST', `/api/redev/members/${ids[0]}/docs`, { item_key: 'Share certificate', document_id: f1.id, status: 'received' })).status === 200 && (await pm.call('GET', `/api/redev/members/${ids[0]}/docs`)).data.items[0].status === 'received');
ok('a file of another category cannot be attached', (await pm.call('POST', `/api/redev/members/${ids[0]}/docs`, { item_key: 'Photo ID', document_id: (await up(pm, 'other.pdf', 'general')).id })).status === 400);
ok('Site and Sales cannot download society files', (await fetch(BASE + `/api/files/download/${f1.id}`, { headers: { cookie: site.cookie } })).status === 403 && (await fetch(BASE + `/api/files/download/${f1.id}`, { headers: { cookie: sales.cookie } })).status === 403 && (await fetch(BASE + `/api/files/download/${f1.id}`, { headers: { cookie: acc.cookie } })).status === 200);

// ============ WP-2: rehab flats ============
const unit = async (cat, no) => (await o.call('POST', '/api/sales/inventory', { project_id: redev, wing: 'R', floor: 1, unit_no: no + run.slice(-3), type: '2BHK', carpet_sqft: 500, rera_carpet_sqft: 450, price_paise: cat === 'rehab' ? 0 : 100000000, category: cat })).data.id;
const rh1 = await unit('rehab', 'R1'), rh2 = await unit('rehab', 'R2'), sale1 = await unit('sale', 'S1');
const rr = (await pm.call('GET', `/api/redev/societies/${soc}/rehab`)).data; ok('free rehab flats are listed; sale flats are not', rr.free_units.length === 2 && !rr.free_units.some((u) => u.id === sale1));
ok('the PM sets an entitlement and allots a rehab flat', (await pm.call('POST', `/api/redev/members/${ids[0]}/rehab`, { entitlement_sqft: 450, inventory_id: rh1, status: 'allotted' })).status === 200 && (await pm.call('GET', `/api/redev/societies/${soc}/rehab`)).data.members.find((m) => m.member_id === ids[0]).status === 'allotted');
ok('the same flat cannot go to two members', (await pm.call('POST', `/api/redev/members/${ids[1]}/rehab`, { inventory_id: rh1, status: 'allotted' })).status === 409);
ok('a sale flat cannot be given as a rehab flat', (await pm.call('POST', `/api/redev/members/${ids[1]}/rehab`, { inventory_id: sale1, status: 'allotted' })).status === 400);
ok('allotted needs a flat', (await pm.call('POST', `/api/redev/members/${ids[2]}/rehab`, { status: 'allotted' })).status === 400);
ok('Sales cannot book a rehab flat', (await (async () => { const sc = await mkUser('sales', []); return (await sc.call('POST', '/api/sales/bookings', { unit_id: rh2, customer_name: 'X', phone: '9812345678', agreed_price_paise: 100 })).status; })()) >= 400);

// ============ WP-2: transit rent ============
const first = iso(0).slice(0, 7) + '-01';
const threeBack = (() => { const d = new Date(Date.now() + 19800000); d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString().slice(0, 7) + '-01'; })();
ok('transit rent cannot start before the member has vacated', (await acc.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { monthly_rent_paise: 2500000, start_date: first })).status === 409);
for (const id of ids) await o.call('PUT', `/api/redev/members/${id}/vacate`, { paaa_reg_no: 'PAAA-' + id, paaa_reg_date: '2020-01-01', vacated_on: '2020-01-01', override_note: 'test fixture, no photo' });
ok('only Owner and Accounts record rent terms', (await pm.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { monthly_rent_paise: 2500000, start_date: first })).status === 403 && (await sales.call('GET', `/api/redev/societies/${soc}/transit`)).status === 403);
ok('rent and the first month are required', (await acc.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { start_date: first })).status === 400 && (await acc.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { monthly_rent_paise: 2500000 })).status === 400);
const t1 = await acc.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { monthly_rent_paise: 2500000, start_date: first, deposit_paise: 10000000, bg_ref: 'BG-77', bg_amount_paise: 5000000, bg_expiry: iso(20) });
ok('a term schedules the next 12 months (13 rows, this month included)', t1.status === 200 && t1.data.months_scheduled === 13, JSON.stringify(t1));
const t2 = await acc.call('POST', `/api/redev/members/${ids[1]}/transit-term`, { monthly_rent_paise: 3000000, start_date: threeBack });
ok('a term that started 3 months ago has overdue months', t2.status === 200 && t2.data.months_scheduled >= 15);
const mt = (await pm.call('GET', `/api/redev/members/${ids[0]}/transit`)).data;
ok('the member\'s schedule lists the months, all due, with the rent', mt.months.length === 13 && mt.months.every((m) => m.state === 'due' || m.state === 'overdue') && mt.months[0].due_paise === 2500000);
const m0 = mt.months[0].id;
ok('a payment above what is due is refused', (await acc.call('POST', `/api/redev/transit/${m0}/pay`, { amount_paise: 2600000, mode: 'cheque', ref_no: '123456' })).status === 409);
ok('the PM cannot record a payment', (await pm.call('POST', `/api/redev/transit/${m0}/pay`, { amount_paise: 100 })).status === 403);
const p1 = await acc.call('POST', `/api/redev/transit/${m0}/pay`, { amount_paise: 1000000, mode: 'cheque', ref_no: 'CHQ 000123', paid_on: iso(0), client_uuid: 'pay-' + run });
ok('a part payment is recorded (cheque number kept)', p1.status === 200 && (await acc.call('POST', `/api/redev/transit/${m0}/pay`, { amount_paise: 1000000, client_uuid: 'pay-' + run })).data.duplicate === true);
ok('a future payment date is refused', (await acc.call('POST', `/api/redev/transit/${m0}/pay`, { amount_paise: 100, paid_on: iso(3) })).status === 400);
const [pa, pb] = await Promise.all([1, 2].map(() => acc.call('POST', `/api/redev/transit/${m0}/pay`, { amount_paise: 1500000, mode: 'neft', ref_no: 'N' + Math.random() })));
ok('two people paying the balance at the same moment: only one succeeds (no overpayment)', [pa.status, pb.status].sort().join() === '200,409', JSON.stringify([pa.status, pb.status]));
let g = (await pm.call('GET', `/api/redev/societies/${soc}/transit`)).data;
const gr = g.rows.find((r) => r.member_id === ids[0]);
ok('the month grid shows this month as paid, two members with terms, the rest without', gr.state === 'paid' && gr.paid_paise === 2500000 && g.rows.length === 2 && g.members_without_term === 38, JSON.stringify([gr, g.rows.length, g.members_without_term]));
ok('and the term that started 3 months ago has overdue months (rent is due on the 1st)', ['due', 'overdue'].includes(g.rows.find((r) => r.member_id === ids[1]).state) && (await pm.call('GET', `/api/redev/members/${ids[1]}/transit`)).data.months.filter((m) => m.state === 'overdue').length >= 3);
const payId = (await pm.call('GET', `/api/redev/members/${ids[0]}/transit`)).data.payments.find((p) => p.ref_no === 'CHQ 000123').id;
ok('reversing needs a reason', (await acc.call('POST', `/api/redev/transit-payments/${payId}/reverse`, {})).status === 400);
ok('reverse with a reason: the month is partly due again', (await acc.call('POST', `/api/redev/transit-payments/${payId}/reverse`, { reason: 'Cheque bounced' })).status === 200 && (await pm.call('GET', `/api/redev/members/${ids[0]}/transit`)).data.months[0].paid_paise === 1500000);
ok('reversing twice is refused; the payment row is kept with its reason', (await acc.call('POST', `/api/redev/transit-payments/${payId}/reverse`, { reason: 'again' })).status === 409 && (await pm.call('GET', `/api/redev/members/${ids[0]}/transit`)).data.payments.find((p) => p.id === payId).reversal_note === 'Cheque bounced');
ok('the start month cannot be moved once scheduled', (await acc.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { monthly_rent_paise: 2500000, start_date: iso(-100) })).status === 409);
await o.call('POST', '/api/redev/approval-pin', { password: process.env.OWNER_PASSWORD, pin: '482913' });
const rentChg = await acc.call('POST', `/api/redev/members/${ids[0]}/transit-term`, { monthly_rent_paise: 2600000, start_date: first, bg_expiry: iso(20), bg_ref: 'BG-77', bg_amount_paise: 5000000, deposit_paise: 10000000 });
const rentOk = rentChg.status === 200 && rentChg.data.pending === true && (await o.call('POST', `/api/redev/rent-changes/${rentChg.data.id}/approve`, { pin: '482913' })).status === 200;
ok('a rent change reaches unpaid months only', rentOk && (await pm.call('GET', `/api/redev/members/${ids[0]}/transit`)).data.months.slice(1).every((m) => m.due_paise === 2600000) && (await pm.call('GET', `/api/redev/members/${ids[0]}/transit`)).data.months[0].due_paise === 2500000);

// ============ WP-2: corpus ============
const c1 = await acc.call('POST', `/api/redev/members/${ids[0]}/corpus`, { label: 'Corpus share', amount_paise: 50000000, due_on: iso(30) });
ok('a corpus item is added', c1.status === 200 && (await acc.call('POST', `/api/redev/members/${ids[0]}/corpus`, { label: '', amount_paise: 100 })).status === 400);
ok('it is marked paid once, with a reference', (await acc.call('POST', `/api/redev/corpus/${c1.data.id}/pay`, { ref_no: 'UTR1' })).status === 200 && (await acc.call('POST', `/api/redev/corpus/${c1.data.id}/pay`, {})).status === 409);
let cp = (await pm.call('GET', `/api/redev/societies/${soc}/corpus`)).data; ok('corpus totals: due and paid', cp.due_paise === 50000000 && cp.paid_paise === 50000000);
ok('reversal needs a reason and removes it from the totals', (await acc.call('POST', `/api/redev/corpus/${c1.data.id}/reverse`, {})).status === 400 && (await acc.call('POST', `/api/redev/corpus/${c1.data.id}/reverse`, { reason: 'Wrong member' })).status === 200 && (await pm.call('GET', `/api/redev/societies/${soc}/corpus`)).data.due_paise === 0);
ok('Sales and HR cannot see corpus', (await sales.call('GET', `/api/redev/societies/${soc}/corpus`)).status === 403 && (await hr.call('GET', `/api/redev/societies/${soc}/corpus`)).status === 403);

// ============ WP-3: meetings ============
const mf = await up(pm, 'minutes.pdf', 'society');
ok('a meeting needs a date; the next action needs a description', (await pm.call('POST', `/api/redev/societies/${soc}/meetings`, { agenda: 'x' })).status === 400 && (await pm.call('POST', `/api/redev/societies/${soc}/meetings`, { held_on: iso(-1), next_action_due: iso(2) })).status === 400);
const mm = await pm.call('POST', `/api/redev/societies/${soc}/meetings`, { kind: 'general_body', held_on: iso(-1), agenda: 'Consent and appointment of architect', attendees_count: 42, resolution_text: 'Appoint architect', resolution_passed: true, minutes_document_id: mf.id, next_action: 'Collect signatures from absent members', next_action_due: iso(2) });
ok('a meeting is logged with minutes, resolution and a next action', mm.status === 200);
ok('a file of another kind or project cannot be minutes', (await pm.call('POST', `/api/redev/societies/${soc}/meetings`, { held_on: iso(-1), minutes_document_id: (await up(pm, 'x.pdf', 'general')).id })).status === 400);
const ml = (await viewer.call('GET', `/api/redev/societies/${soc}/meetings`)).data; ok('the CA can read meetings with the "record only" note, but not add', ml.meetings.length === 1 && ml.meetings[0].minutes_title === 'minutes.pdf' && /advocate/.test(ml.note) && (await viewer.call('POST', `/api/redev/societies/${soc}/meetings`, { held_on: iso(0) })).status === 403);
const mcsv = await (await pm.call('GET', `/api/redev/societies/${soc}/meetings?csv=1`, null, true)).text(); ok('meetings CSV', mcsv.includes('Appoint architect') && mcsv.includes('Collect signatures'));

// ============ the hourly sweep ============
const tick = await fetch(BASE + '/__scheduled?cron=30+*+*+*+*');
if (tick.status === 200) {
  await new Promise((r) => setTimeout(r, 2500));
  const nAcc = await notes(acc), nOwn = await notes(o), nPm = await notes(pm);
  ok('Accounts is told rent is overdue; so is the Owner', nAcc.includes('Transit rent overdue: Sai Krupa') && nOwn.includes('Transit rent overdue: Sai Krupa'));
  ok('Owner and Accounts are told the bank guarantee expires within 30 days', nAcc.includes('Bank guarantee expiring: Member 1') && nOwn.includes('Bank guarantee expiring: Member 1'));
  ok('the PM is reminded of the meeting action', nPm.includes('Meeting action due: Sai Krupa') && nPm.includes('Collect signatures'));
  ok('the Owner is not sent the PM-only meeting reminder', !nOwn.includes('Meeting action due'));
  await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2000));
  ok('running the sweep again sends no duplicates', ((await notes(pm)).match(/Meeting action due: Sai Krupa/g) || []).length === 1);
} else console.log('SKIP  sweep tests (dev server started without --test-scheduled)');
const gu = (await pm.call('GET', '/api/redev/reports/guarantees')).data; ok('guarantees expiring within 60 days are in the report', gu.rows.some((r) => r[3] === 'BG-77'));
ok('rent due this month and overdue reports work; CSV too', (await pm.call('GET', '/api/redev/reports/rent_due')).data.rows.length >= 1 && (await pm.call('GET', '/api/redev/reports/overdue')).data.rows.length >= 1 && (await (await pm.call('GET', '/api/redev/reports/overdue?csv=1', null, true)).text()).includes('Society'));
ok('Sales cannot read the money reports', (await sales.call('GET', '/api/redev/reports/overdue')).status === 403);
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
