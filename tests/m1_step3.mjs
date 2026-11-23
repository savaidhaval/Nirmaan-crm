// tests/m1_step3.mjs — Module 1 gaps, step 3: CC-floor lock on indents and RA bills, monthly bank file, site readiness, inspection board, consultant follow-ups.
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

const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const viewer = await mkUser('viewer', []); const pur = await mkUser('purchase', []);
const mkProj = async (tag, type) => (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m3' + tag + ' ' + run, code: 'M3' + tag + run.toUpperCase().slice(-5), type, budget_paise: 50000000 })).data.id;
const ev = (id, body) => o.call('POST', `/api/approvals/${id}/event`, body);

// ============ 1. CC-floor lock on indents and RA bills ============
const pid = await mkProj('A', 'new_build'), pid2 = await mkProj('B', 'new_build');
await o.call('POST', '/api/approvals/load-template', { project_id: pid });
const items = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === pid);
const g = (k) => items.find((a) => a.gate_key === k);
const indent = (who, p, extra) => who.call('POST', '/api/procurement/indents', { project_id: p, items: [{ description: 'Cement', qty: 10, unit: 'bag' }], ...extra });
ok('with no floor named, an indent needs no CC check', (await indent(pm, pid, {})).status === 200);
const noCc = await indent(pm, pid, { floor: 1 });
ok('a floor is refused while no CC is approved', noCc.status === 409 && noCc.code === 'cc' && /Commencement/.test(noCc.err), JSON.stringify(noCc));
await ev(g('iod').id, { event: 'applied' }); await ev(g('iod').id, { event: 'approved', letter_no: 'M3/IOD', letter_date: iso(-30) });
await ev(g('cc').id, { event: 'applied' }); await ev(g('cc').id, { event: 'approved', letter_no: 'M3/CC', letter_date: iso(-20), cc_upto_floor: 2 });
ok('a floor inside the CC limit is accepted', (await indent(pm, pid, { floor: 2, wing: 'A' })).status === 200);
const over = await indent(pm, pid, { floor: 3 });
ok('a floor above the CC limit is refused with the limit named', over.status === 409 && over.code === 'cc' && /up to floor 2/.test(over.err), JSON.stringify(over));
ok('a nonsense floor is refused', (await indent(pm, pid, { floor: -1 })).status === 400 && (await indent(pm, pid, { floor: 999 })).status === 400);
ok('the Owner cannot go above the limit without a written reason', (await indent(o, pid, { floor: 5 })).status === 409 && (await indent(o, pid, { floor: 5, override_note: 'short' })).status === 409);
ok('the Owner can, with a proper reason', (await indent(o, pid, { floor: 5, override_note: 'Slab cast before the CRM; CC copy is with the architect' })).status === 200);
ok('a PM cannot override even with a reason', (await indent(pm, pid, { floor: 5, override_note: 'Slab cast before the CRM; CC copy is with the architect' })).status === 409);
// RA bill
await o.call('POST', '/api/settings/con.enabled', { value: 'on' });
const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz civil ' + run, trade: 'civil', pan: 'ABCDE1234F' })).data.id;
const wo = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'RCC', basis: 'lump_sum', value_paise: 100000000, retention_bp: 500 })).data.id;
await pur.call('POST', `/api/contractors/work-orders/${wo}/submit`); await o.call('POST', `/api/contractors/work-orders/${wo}/approve`, {});
const ra = (who, extra) => who.call('POST', `/api/contractors/work-orders/${wo}/ra-bills`, { gross_paise: 1000000, ...extra });
const raOver = await ra(pur, { floor: 4, wing: 'A' });
ok('an RA bill for a floor above the CC is refused', raOver.status === 409 && raOver.code === 'cc' && /floor 2/.test(raOver.err), JSON.stringify(raOver));
ok('a bill for a floor the CC covers is saved', (await ra(pur, { floor: 2 })).status === 200);
ok('a bill with no floor named is saved', (await ra(pur, {})).status === 200);
ok('the Owner can bill above the limit only with a reason', (await ra(o, { floor: 6 })).status === 409 && (await ra(o, { floor: 6, override_note: 'Work done before the CRM was used here' })).status === 200);
ok('another project with no CC still refuses a floor', (await indent(pm, pid2, { floor: 1 })).status === 409);

// ============ 2. bank details and the monthly bank file ============
const redev = await mkProj('R', 'redevelopment');
const soc = (await pm.call('POST', '/api/redev/societies', { project_id: redev, name: 'M3 CHS ' + run, consent_threshold_pct: 51 })).data.id;
const mk = async (n) => (await pm.call('POST', `/api/redev/societies/${soc}/members`, { member_name: 'Member ' + n, unit_label: 'H' + n, wing: 'A', carpet_sqft: 400 })).data.id;
const [m1, m2, m3] = [await mk(1), await mk(2), await mk(3)];
const d0 = new Date(Date.now() + 19800000);
const monthStart = (n) => new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
const start = monthStart(-2), thisMonth = monthStart(0).slice(0, 7), nextMonth = monthStart(1).slice(0, 7);
for (const [m, rent] of [[m1, 2000000], [m2, 25000000], [m3, 1000000]]) {
  await o.call('PUT', `/api/redev/members/${m}/vacate`, { paaa_reg_no: 'PAAA-' + m, paaa_reg_date: '2020-01-01', vacated_on: start, override_note: 'test fixture, no photo' });
  await o.call('POST', `/api/redev/members/${m}/transit-term`, { monthly_rent_paise: rent, start_date: start });
}
const bankBad = { holder: 'Asha Rao', account: '123456789012', ifsc: 'hdfc0001234' };
ok('a PM cannot enter bank details', (await pm.call('PUT', `/api/redev/members/${m1}/bank`, bankBad)).status === 403);
ok('a bad IFSC is refused', (await acc.call('PUT', `/api/redev/members/${m1}/bank`, { ...bankBad, ifsc: 'XYZ' })).status === 400);
ok('letters in the account number are refused', (await acc.call('PUT', `/api/redev/members/${m1}/bank`, { ...bankBad, account: '12ab5678' })).status === 400);
ok('Accounts saves bank details', (await acc.call('PUT', `/api/redev/members/${m1}/bank`, bankBad)).status === 200 && (await acc.call('PUT', `/api/redev/members/${m2}/bank`, { holder: 'Bala Menon', account: '998877665544', ifsc: 'SBIN0004321' })).status === 200);
const bs = (await acc.call('GET', `/api/redev/societies/${soc}/bank-status`)).data.members;
ok('the status shows the last 4 digits only, never the number', bs.length === 2 && bs[0].bank_acct_last4 === '9012' && !JSON.stringify(bs).includes('123456789012'), JSON.stringify(bs));
ok('a PM sees only who has details, not the digits', !JSON.stringify((await pm.call('GET', `/api/redev/societies/${soc}/bank-status`)).data).includes('9012'));
ok('the PM cannot make a bank file', (await pm.call('POST', `/api/redev/societies/${soc}/payout-batches`, { month: thisMonth })).status === 403);
const mkBatch = await acc.call('POST', `/api/redev/societies/${soc}/payout-batches`, { month: thisMonth });
const L = mkBatch.data && mkBatch.data.lines;
ok('one bank file covers the unpaid months of members who have bank details', mkBatch.status === 200 && L.length === 2 && mkBatch.data.batch.line_count === 2, JSON.stringify(mkBatch));
ok('amounts add up the months: 3 x Rs 20,000 and 3 x Rs 2,50,000', L[0].amount_paise === 6000000 && L[1].amount_paise === 75000000 && mkBatch.data.batch.total_paise === 81000000);
ok('the file has the real account numbers; the big one is marked RTGS, the small one NEFT', L[0].account === '123456789012' && L[0].ifsc === 'HDFC0001234' && L[0].mode === 'NEFT' && L[1].mode === 'RTGS' && L[0].holder === 'Asha Rao');
ok('the member without bank details is named as skipped', mkBatch.data.skipped.some((s) => /Member 3/.test(s)), JSON.stringify(mkBatch.data.skipped));
const bid = mkBatch.data.batch.id;
ok('a second file has nothing left to put in it', (await acc.call('POST', `/api/redev/societies/${soc}/payout-batches`, { month: thisMonth })).status === 409);
const sched = (await o.call('GET', `/api/redev/members/${m1}/transit`)).data.months[0];
ok('a month inside an open bank file cannot be paid on its own', (await acc.call('POST', `/api/redev/transit/${sched.id}/pay`, { amount_paise: 100 })).status === 409);
ok('a PM and a viewer cannot open the file', (await pm.call('GET', `/api/redev/payout-batches/${bid}`)).status === 403 && (await viewer.call('GET', `/api/redev/payout-batches/${bid}`)).status === 403);
ok('Accounts can download it again', (await acc.call('GET', `/api/redev/payout-batches/${bid}`)).data.lines.length === 2);
ok('marking paid needs the bank reference', (await acc.call('POST', `/api/redev/payout-batches/${bid}/paid`, { paid_on: iso(0), mode: 'neft' })).status === 400);
const paid = await acc.call('POST', `/api/redev/payout-batches/${bid}/paid`, { paid_on: iso(0), mode: 'neft', bank_ref: 'UTR-BATCH-1' });
ok('marked paid: every month in the file is paid at once', paid.status === 200 && paid.data.paid_lines === 6, JSON.stringify(paid));
ok('a WhatsApp message is ready for each member (no phone read)', paid.data.receipts.length === 2 && /UTR-BATCH-1/.test(paid.data.receipts[0].text) && /ending 9012/.test(paid.data.receipts[0].text));
const after = (await o.call('GET', `/api/redev/members/${m1}/transit`)).data;
ok('the member months now show paid, with the bank reference', after.months.slice(0, 3).every((x) => x.state === 'paid' || x.paid_paise === x.due_paise) && after.payments.some((p) => p.ref_no === 'UTR-BATCH-1'));
ok('marking the same file paid again is refused', (await acc.call('POST', `/api/redev/payout-batches/${bid}/paid`, { paid_on: iso(0), mode: 'neft', bank_ref: 'X' })).status === 409);
ok('the batch is listed as paid', (await acc.call('GET', `/api/redev/societies/${soc}/payout-batches`)).data.batches.find((b) => b.id === bid).status === 'paid');
// cancel, and a reversed payment returning to the next file
const b2 = await acc.call('POST', `/api/redev/societies/${soc}/payout-batches`, { month: nextMonth });
ok('next month makes a new file', b2.status === 200 && b2.data.batch.total_paise === 27000000 && b2.data.lines.length === 2, JSON.stringify(b2.data && b2.data.batch));
ok('cancelling needs a reason', (await acc.call('POST', `/api/redev/payout-batches/${b2.data.batch.id}/cancel`, {})).status === 400);
ok('a cancelled file frees its months', (await acc.call('POST', `/api/redev/payout-batches/${b2.data.batch.id}/cancel`, { note: 'Wrong month chosen' })).status === 200 && (await acc.call('POST', `/api/redev/societies/${soc}/payout-batches`, { month: nextMonth })).status === 200);
const pay1 = after.payments.find((p) => p.ref_no === 'UTR-BATCH-1');
await acc.call('POST', `/api/redev/transit-payments/${pay1.id}/reverse`, { reason: 'Bank returned the payment' });
ok('a reversed batch payment goes into the next file', (await acc.call('POST', `/api/redev/societies/${soc}/payout-batches`, { month: thisMonth })).status === 200);

// ============ 3. site readiness ============
const rd0 = (await pm.call('GET', `/api/projects/${redev}/readiness`)).data;
ok('readiness is a percentage with the checks listed and what is pending', Number.isInteger(rd0.pct) && rd0.checks.length >= 5 && /ready/.test(rd0.headline) && rd0.pending.length > 0, JSON.stringify(rd0));
ok('it says how many members are still to vacate', rd0.checks.find((c) => c.key === 'vacated').done === 3 && rd0.checks.find((c) => c.key === 'paaa').done === 3);
await o.call('POST', '/api/approvals/load-template', { project_id: redev, redevelopment: true });
const ri = (await o.call('GET', '/api/approvals')).data.items.filter((a) => a.project_id === redev).find((a) => a.gate_key === 'iod');
await ev(ri.id, { event: 'applied' }); await ev(ri.id, { event: 'approved', letter_no: 'M3/R/IOD', letter_date: iso(-3) });
const rd1 = (await pm.call('GET', `/api/projects/${redev}/readiness`)).data;
ok('approving the IOD raises the score', rd1.pct > rd0.pct && rd1.checks.find((c) => c.key === 'iod').pct === 100, `${rd0.pct} -> ${rd1.pct}`);
ok('a project with no members has a score from approvals and proofs only', (await pm.call('GET', `/api/projects/${pid2}/readiness`)).data.checks.every((c) => ['iod', 'cc', 'proofs'].includes(c.key)));

// ============ 4. inspection board ============
const ins = (await viewer.call('GET', `/api/projects/${redev}/inspection`)).data;
ok('the inspection board lists the approved IOD with its letter', ins.project.id === redev && ins.approvals.some((a) => a.gate_key === 'iod' && a.letter_no === 'M3/R/IOD'), JSON.stringify(ins.approvals.map((a) => a.name)));
ok('drawings issued for construction come as a list', Array.isArray(ins.drawings));
ok('an unknown project is refused', (await pm.call('GET', '/api/projects/999999/inspection')).status === 403);

// ============ 5. Monday follow-ups ============
await o.call('POST', '/api/approvals', { project_id: redev, name: 'zz fire layout ' + run, authority: 'MCGM', consultant: 'Arch Sharma ' + run, target_date: iso(-4) });
await o.call('POST', '/api/approvals', { project_id: redev, name: 'zz plinth drawing ' + run, authority: 'MCGM', consultant: 'Arch Sharma ' + run, target_date: iso(10) });
const cs = (await pm.call('GET', `/api/projects/${redev}/consultant-summary`)).data;
const grp = cs.groups.find((x) => x.consultant === 'Arch Sharma ' + run);
ok('pending items are grouped by consultant, late ones counted', grp && grp.count === 2 && grp.late === 1, JSON.stringify(cs.groups.map((x) => [x.consultant, x.count, x.late])));
ok('each group has a ready message that names the items and what is late', /zz fire layout/.test(grp.text.toUpperCase().toLowerCase()) || /ZZ FIRE LAYOUT/.test(grp.text), grp && grp.text);
ok('the message marks the late item', /LATE/.test(grp.text));
ok('a site user on another project cannot read the follow-ups', (await (await mkUser('site', [pid2])).call('GET', `/api/projects/${redev}/consultant-summary`)).status === 403);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
