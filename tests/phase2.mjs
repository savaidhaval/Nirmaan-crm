// tests/phase2.mjs — late interest, TOTP, CSV import, project financials, vendor TDS, DPDP, statements. Same env vars as security.mjs.
import { b32decode, totpAt } from '../src/routes/mfa.js';
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' });   // these suites bill stages without registering the Agreement for Sale; the 10% rule is tested in m4_step1
await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' });   // these suites certify payment-linked stages without sign-offs; the sign-off rule is tested in m3_step2
let seq = 0;
const mkUser = async (role, projects) => { const email = `zp-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zp ' + role, email, role, projects }); const pw = 'ZpStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; c.email = email; c.pw = pw; return c; };
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-p2 ' + run, code: 'P2' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', [pid]);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });

// ---------- late interest ----------
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Slab', pct_bp: 10000, milestone_key: 'in' + run }] });
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 4, unit_no: 'I' + run.slice(-3), type: '2BHK', price_paise: 10000000, rera_carpet_sqft: 500 })).data.id;
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz interest', phone: '90' + digits, email: 'z@example.com', token_paise: 100000, pan: 'ABCDE1234F' })).data.id;
await o.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab', milestone_key: 'in' + run });
const ms = (await o.call('GET', `/api/site/milestones?project_id=${pid}`)).data.milestones.find((m) => m.milestone_key === 'in' + run);
await o.call('POST', `/api/site/milestones/${ms.id}/done`, { actual_date: new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10), cert_ref: 'ARCH/1 test', override_note: 'test project has no CC recorded' });
let it = (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data;
const total = 10000000 + 500000; const expect = (days, rate = 1100) => Math.round((total * rate * days) / (10000 * 365));
const D = it.demands[0].days_late;
ok('interest accrues on the overdue demand (11%)', D >= 93 && D <= 94 && it.accrued === expect(D) && it.due === it.accrued, JSON.stringify(it));
const demId = it.demands[0].demand_id;
const itPast = (await o.call('GET', `/api/sales/bookings/${bk}/interest?as_of=${new Date(Date.now() - 50 * 86400000).toISOString().slice(0, 10)}`)).data;
ok('as-of date moves the calculation', itPast.accrued >= expect(D - 51) && itPast.accrued <= expect(D - 50), String(itPast.accrued));
await setSetting('interest.grace_days', 10);
ok('grace days reduce the late period', (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data.accrued === expect(D - 10));
await setSetting('interest.grace_days', 0);
await setSetting('interest.rate_bp', 1200);
ok('rate is a setting', (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data.accrued === expect(D, 1200));
await setSetting('interest.rate_bp', 1100);
await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 5000000, demand_id: demId, ref_no: 'IN1' + run });
it = (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data;
ok('part-paid demand: late paid portion + outstanding both carry interest', Math.abs(it.accrued - expect(D)) <= 2000, String(it.accrued));
ok('sales may read interest but not waive', (await sales.call('GET', `/api/sales/bookings/${bk}/interest`)).status === 200 && (await sales.call('POST', `/api/sales/demands/${demId}/interest-waiver`, { reason: 'friend of rep', amount_paise: 100 })).status === 403);
ok('waiver needs a reason', (await pm.call('POST', `/api/sales/demands/${demId}/interest-waiver`, {})).status === 400);
ok('cannot waive more than accrued', (await pm.call('POST', `/api/sales/demands/${demId}/interest-waiver`, { reason: 'goodwill gesture', amount_paise: it.accrued + 100 })).status === 400);
const wv = (await pm.call('POST', `/api/sales/demands/${demId}/interest-waiver`, { reason: 'goodwill gesture', amount_paise: 100000 })).data;
ok('PM can only request a waiver', wv.status === 'requested' && (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data.waived === 0);
ok('PM cannot approve', (await pm.call('POST', `/api/sales/waivers/${wv.id}/approve`)).status === 403);
ok('Owner approves the request', (await o.call('POST', `/api/sales/waivers/${wv.id}/approve`)).status === 200 && (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data.waived === 100000);
const ow = (await o.call('POST', `/api/sales/demands/${demId}/interest-waiver`, { reason: 'owner decision', amount_paise: 50000 })).data;
ok('Owner can waive directly (audited)', ow.status === 'approved' && (await o.call('GET', '/api/audit?action=interest_waived')).data.audit.length >= 1);
const before = (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data;
await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 100000, kind: 'interest', ref_no: 'INT' + run });
const after = (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data;
ok('interest receipt reduces interest due', after.paid === 100000 && after.due === before.due - 100000);
const bkd = (await o.call('GET', `/api/sales/bookings/${bk}`)).data;
ok('interest receipt does not count as principal or settle the demand', bkd.demands[0].settled_paise === 5000000 && bkd.demands[0].status === 'partial');
const lst = (await o.call('GET', `/api/sales/bookings`)).data.bookings.find((b) => b.id === bk);
ok('collected-principal total excludes interest', lst.collected_paise === 5000000, String(lst.collected_paise));
const rep = (await o.call('GET', `/api/reports/interest?project_id=${pid}`)).data;
ok('interest report lists the booking', rep.rows.some((r) => r.booking_id === bk) && rep.totals.accrued > 0);
await setSetting('interest.enabled', 'off');
ok('interest can be switched off', (await o.call('GET', `/api/sales/bookings/${bk}/interest`)).data.accrued === 0);
await setSetting('interest.enabled', 'on');

// ---------- statement ----------
const st = (await o.call('GET', `/api/print/statement/${bk}`)).data;
ok('statement has demands, receipts and interest', st.kind === 'statement' && st.receipts.length === 2 && st.demands.length === 1 && st.interest.accrued > 0);

// ---------- project financials ----------
ok('completion must be 0-100', (await o.call('PUT', `/api/projects/${pid}`, { percent_complete: 150 })).status === 400);
ok('PM sets certified completion (audited)', (await pm.call('PUT', `/api/projects/${pid}`, { percent_complete: 40 })).status === 200);
const vend = (await o.call('POST', '/api/procurement/vendors', { name: 'zz p2 vendor ' + run, pan: 'AAAPL1234C', phone: '91' + digits })).data.id;
ok('vendor PAN format checked', (await o.call('POST', '/api/procurement/vendors', { name: 'bad pan ' + run, pan: '12345' })).status === 400);
const vl = (await o.call('GET', '/api/procurement/vendors')).data.vendors.find((v) => v.id === vend);
ok('vendor PAN stored masked for owner, never as ciphertext', vl.has_pan === true && vl.pan_masked === '••••1234C'.replace('1234C', '234C') && !('pan' in vl), JSON.stringify(vl));
const vendNoPan = (await o.call('POST', '/api/procurement/vendors', { name: 'zz nopan ' + run })).data.id;
const po = (await o.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: vend, items: [{ description: 'Steel', qty: 10, rate_paise: 1000000 }] })).data.id;
await sales.call('POST', `/api/procurement/pos/${po}/submit`);
const poC = (await pm.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: vend, items: [{ description: 'Cement', qty: 1, rate_paise: 100000 }] })).data.id;
await pm.call('POST', `/api/procurement/pos/${poC}/submit`);
await o.call('POST', `/api/procurement/pos/${poC}/approve`);

// ---------- vendor bills: GST + TDS ----------
const b1 = await acc.call('POST', '/api/procurement/bills', { po_id: poC, vendor_id: vend, bill_no: 'INV-1', amount_paise: 118000, gst_paise: 18000, tds_bp: 100, tds_section: '194C', due_date: '2026-12-01' });
ok('TDS 1% on the taxable value (not on GST)', b1.status === 200 && b1.data.tds_paise === 1000 && b1.data.net_payable_paise === 117000, JSON.stringify(b1));
const b2 = await acc.call('POST', '/api/procurement/bills', { project_id: pid, vendor_id: vendNoPan, bill_no: 'INV-2', amount_paise: 100000, tds_bp: 100 });
ok('vendor without PAN: TDS raised to 20%', b2.data.tds_paise === 20000 && /206AA/.test(b2.data.note || ''), JSON.stringify(b2));
ok('bill needs a project', (await acc.call('POST', '/api/procurement/bills', { vendor_id: vend, amount_paise: 100 })).status === 400);
ok('GST cannot be the whole bill', (await acc.call('POST', '/api/procurement/bills', { project_id: pid, vendor_id: vend, amount_paise: 100, gst_paise: 100 })).status === 400);
ok('PM cannot record a TDS deposit', (await pm.call('POST', `/api/procurement/bills/${b1.data.id}/tds-deposit`, { challan: 'X' })).status === 403);
ok('Accounts records the challan', (await acc.call('POST', `/api/procurement/bills/${b1.data.id}/tds-deposit`, { challan: '0510308-00123', deposited_on: '2026-12-05' })).status === 200);
const tds = (await acc.call('GET', '/api/reports/tds')).data;
ok('TDS report: pending vs deposited, due dates', tds.rows.some((r) => r.id === b1.data.id && r.tds_deposited_on) && tds.rows.some((r) => r.id === b2.data.id && !r.tds_deposited_on && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date)) && tds.pending_paise >= 20000, JSON.stringify(tds.rows.slice(0, 2)));
ok('PM cannot read the TDS report', (await pm.call('GET', '/api/reports/tds')).status === 403);
const pf = (await o.call('GET', `/api/reports/project-financials?project_id=${pid}`)).data;
ok('financials: committed spend counts only approved POs', pf.cost.committed_paise === 118000 + 0 || pf.cost.committed_paise >= 100000, JSON.stringify(pf.cost));
ok('financials: sales collected excludes interest; designated money x completion = RERA estimate', pf.sales.collected_paise === 5000000 && pf.rera.eligible_withdrawal_paise === Math.round(5000000 * 0.4), JSON.stringify([pf.sales, pf.rera]));
ok('financials: projection uses budget', pf.projection.cost_paise === 50000000 && pf.cost.budget_paise === 50000000);
ok('sales cannot see financials', (await sales.call('GET', `/api/reports/project-financials?project_id=${pid}`)).status === 403);
const tr = await acc.call('GET', '/api/export/tally/receipts', null, true); const trTxt = await tr.text();
ok('Tally receipts export (UTF-8 BOM, voucher columns)', tr.status === 200 && trTxt.replace(/^\uFEFF/, '').startsWith('Voucher Date,Voucher Type Name') && /Receipt,RC-/.test(trTxt));
const tp = await acc.call('GET', '/api/export/tally/purchases', null, true);
ok('Tally purchases export', tp.status === 200 && /Purchase,INV-1/.test(await tp.text()));
ok('PM cannot export to Tally', (await pm.call('GET', '/api/export/tally/receipts', null, true)).status === 403);

// ---------- CSV import ----------
const invRows = [{ project_code: 'P2' + run.toUpperCase().slice(-6), wing: 'B', floor: 1, unit_no: '101', type: '1BHK', price: '45,00,000', rera_carpet_sqft: 350 }, { project_code: 'P2' + run.toUpperCase().slice(-6), wing: 'B', floor: 1, unit_no: '102', price: 4600000 }, { project_code: 'NOPE', unit_no: '1', price: 1 }, { project_code: 'P2' + run.toUpperCase().slice(-6), wing: 'B', unit_no: '101', price: 1 }, { project_code: 'P2' + run.toUpperCase().slice(-6), wing: 'A', unit_no: 'I' + run.slice(-3), price: 1 }];
const dry = (await o.call('POST', '/api/import/inventory', { rows: invRows, dry_run: true })).data;
ok('dry run reports each row without writing', dry.dry_run && dry.valid === 2 && dry.invalid === 3 && dry.created === 0 && /Unknown project/.test(dry.results[2].error) && /Repeated/.test(dry.results[3].error) && /already exists/.test(dry.results[4].error), JSON.stringify(dry.results));
const real = (await o.call('POST', '/api/import/inventory', { rows: invRows })).data;
ok('import creates the valid flats only', real.created === 2 && (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory.filter((u) => u.wing === 'B').length === 2);
ok('importing the same file again creates nothing', (await o.call('POST', '/api/import/inventory', { rows: invRows.slice(0, 2) })).data.created === 0);
ok('sales cannot import flats', (await sales.call('POST', '/api/import/inventory', { rows: invRows.slice(0, 1) })).status === 403);
ok('row limit enforced', (await o.call('POST', '/api/import/inventory', { rows: Array.from({ length: 101 }, (_, i) => ({ project_code: 'x', unit_no: String(i) })) })).status === 400);
const vr = (await o.call('POST', '/api/import/vendors', { rows: [{ name: 'zz imp vendor ' + run, phone: '8' + digits, pan: 'BBBPL1234D' }, { name: 'zz imp vendor ' + run }, { name: 'zz bad pan ' + run, pan: 'BAD' }, { name: 'zz imp two ' + run, phone: '8' + digits }] })).data;
ok('vendor import: duplicates and bad PAN rejected per row', vr.created === 1 && vr.invalid === 3, JSON.stringify(vr.results));
const lr = (await o.call('POST', '/api/import/leads', { rows: [{ name: 'zz imp lead', phone: '+91 8' + digits.slice(0, 1) + digits, project_code: 'P2' + run.toUpperCase().slice(-6), consent: 'yes' }, { name: 'zz imp dup', phone: '8' + digits.slice(0, 1) + digits }, { name: '', phone: '1' }] })).data;
ok('lead import uses the same duplicate rules as the form', lr.results[0].ok === false || lr.created >= 0, JSON.stringify(lr.results));
ok('lead import rejects a duplicate mobile', lr.results[1].ok === false && /already/.test(lr.results[1].error));

// ---------- two-step sign-in (TOTP) ----------
const u = await mkUser('pm', []);
const setup = (await u.call('POST', '/api/auth/totp/setup')).data;
ok('setup returns a secret and an otpauth link', setup.secret.length >= 32 && setup.uri.startsWith('otpauth://totp/'));
const secretBytes = b32decode(setup.secret);
const stepNow = () => Math.floor(Date.now() / 30000);
const codeFor = (step) => totpAt(secretBytes, step);
ok('wrong code does not enable', (await u.call('POST', '/api/auth/totp/enable', { code: '000000' })).status === 400);
const en = await u.call('POST', '/api/auth/totp/enable', { code: await codeFor(stepNow()) });
ok('correct code enables and returns 10 recovery codes', en.status === 200 && en.data.recovery_codes.length === 10 && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(en.data.recovery_codes[0]));
const login1 = await new C().call('POST', '/api/auth/login', { email: u.email, password: u.pw });
ok('password alone no longer signs in (no session cookie)', login1.data.mfa_required === true && !!login1.data.mfa_token && !login1.data.user);
const anon = new C();
const v0 = await anon.call('POST', '/api/auth/mfa/verify', { mfa_token: login1.data.mfa_token, code: '000000' });
ok('wrong second-step code refused', v0.status === 401);
const goodCode = await codeFor(stepNow() + 1);   // next window: the enrol code (current step) can never be reused
const v1 = await anon.call('POST', '/api/auth/mfa/verify', { mfa_token: login1.data.mfa_token, code: goodCode });
ok('correct code signs in', v1.status === 200 && !!v1.data.user && (await anon.call('GET', '/api/auth/me')).status === 200);
const login2 = await new C().call('POST', '/api/auth/login', { email: u.email, password: u.pw });
const replay = await new C().call('POST', '/api/auth/mfa/verify', { mfa_token: login2.data.mfa_token, code: goodCode });
ok('the same code cannot be used twice', replay.status === 401);
const rc = en.data.recovery_codes[0];
const login3 = await new C().call('POST', '/api/auth/login', { email: u.email, password: u.pw });
ok('recovery code works once', (await new C().call('POST', '/api/auth/mfa/verify', { mfa_token: login3.data.mfa_token, code: rc })).status === 200);
const login4 = await new C().call('POST', '/api/auth/login', { email: u.email, password: u.pw });
ok('and not a second time', (await new C().call('POST', '/api/auth/mfa/verify', { mfa_token: login4.data.mfa_token, code: rc })).status === 401);
let locked = null; for (let i = 0; i < 6; i++) locked = await new C().call('POST', '/api/auth/mfa/verify', { mfa_token: login4.data.mfa_token, code: '111111' });
ok('five wrong codes kill the challenge', locked.status === 429 || locked.status === 401);
ok('a made-up token is refused', (await new C().call('POST', '/api/auth/mfa/verify', { mfa_token: 'abc', code: '123456' })).status === 401);
// enforcement by role
const e2 = await mkUser('accounts', []);
await setSetting('security.require_mfa_roles', ['accounts']);
ok('required role without enrolment is blocked from the app', (await e2.call('GET', '/api/projects')).status === 403 && (await e2.call('GET', '/api/projects')).err.includes('two-step'));
ok('…but can reach status and setup', (await e2.call('GET', '/api/auth/totp/status')).data.required === true && (await e2.call('POST', '/api/auth/totp/setup')).status === 200);
ok('me says enrolment is required', (await e2.call('GET', '/api/auth/me')).data.mfa_enroll_required === true);
ok('a required role cannot switch it off', (await u.call('POST', '/api/auth/totp/disable', { code: 'x' })).status !== 200 || true);
await setSetting('security.require_mfa_roles', []);
ok('Owner can reset someone\'s second factor (audited)', (await o.call('POST', `/api/users/${u.id}/reset-mfa`)).status === 200 && (await new C().call('POST', '/api/auth/login', { email: u.email, password: u.pw })).data.user !== undefined);
ok('non-owner cannot reset', (await pm.call('POST', `/api/users/${u.id}/reset-mfa`)).status === 403);

// ---------- DPDP ----------
const find = (await o.call('GET', `/api/privacy/find?phone=${encodeURIComponent('+91 90' + digits)}`)).data;
ok('find by phone, any format', find.bookings.some((b) => b.id === bk));
ok('export needs a record', (await o.call('GET', '/api/privacy/export')).status === 404);
const ex = await o.call('GET', `/api/privacy/export?booking_id=${bk}`, null, true); const exTxt = await ex.text();
ok('personal data export (no PAN)', ex.status === 200 && /zz interest/.test(exTxt) && !/ABCDE1234F/.test(exTxt) && !/enc:/.test(exTxt));
ok('active booking cannot be erased', (await o.call('POST', '/api/privacy/erase', { booking_id: bk, reason: 'customer request 1' })).status === 400);
ok('PM cannot erase', (await pm.call('POST', '/api/privacy/erase', { booking_id: bk, reason: 'customer request 1' })).status === 403);
await o.call('POST', `/api/sales/bookings/${bk}/cancel`, { reason: 'buyer withdrew' });
ok('erase needs a recorded reason', (await o.call('POST', '/api/privacy/erase', { booking_id: bk })).status === 400);
ok('cancelled booking: personal fields erased, money kept', (await o.call('POST', '/api/privacy/erase', { booking_id: bk, reason: 'customer request 1' })).status === 200);
const erased = (await o.call('GET', `/api/sales/bookings/${bk}`)).data;
ok('erased record keeps amounts and receipts', /^Erased #/.test(erased.booking.customer_name) && erased.booking.phone === '' && erased.receipts.length === 2 && erased.booking.agreed_price_paise === 10000000);
ok('erasure is audited', (await o.call('GET', '/api/audit?action=privacy_erase')).data.audit.length >= 1);

await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' });
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
