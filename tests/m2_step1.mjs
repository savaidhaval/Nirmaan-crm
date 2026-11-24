// tests/m2_step1.mjs — Module 2 gaps, step 1: MSP floor, partner KYC + RERA expiry gate, broker lock at booking, re-hold block, "is this number ours?", lead SLA auto-reassign, rehab hidden from sales.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `m2-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm2 ' + role, email, role, projects }); const pw = 'M2StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m2 ' + run, code: 'M2' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []); const sales2 = await mkUser('sales', []);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
let n = 0;
const mkUnit = async (extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: 'M' + (++n) + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000, ...extra })).data.id;
const phone = () => '9' + String(Date.now() + (++n)).slice(-9);

// ---------- MSP ----------
const uM = await mkUnit();
ok('only the Owner can set MSP', (await pm.call('POST', '/api/sales/msp', { unit_id: uM, msp_paise: 90000000, reason: 'floor rate' })).status === 403);
ok('MSP needs a reason', (await o.call('POST', '/api/sales/msp', { unit_id: uM, msp_paise: 90000000, reason: '' })).status === 400);
ok('Owner sets MSP for one flat', (await o.call('POST', '/api/sales/msp', { unit_id: uM, msp_paise: 90000000, reason: 'floor rate' })).status === 200);
ok('PM sees MSP on the stacking plan, sales does not', (await pm.call('GET', `/api/reports/stacking?project_id=${pid}`)).data.units.find((u) => u.id === uM).msp_paise === 90000000 && (await sales.call('GET', `/api/reports/stacking?project_id=${pid}`)).data.units.find((u) => u.id === uM).msp_paise === null);
const low = await o.call('POST', '/api/sales/bookings', { unit_id: uM, customer_name: 'zz low', agreed_price_paise: 85000000, token_paise: 1000000, discount_reason: 'negotiated well' });
ok('a direct booking below MSP is refused, even for the Owner', low.status === 403 && low.code === 'msp', JSON.stringify(low));
const sheetLow = await o.call('POST', '/api/sales/cost-sheets', { unit_id: uM, base_rate_paise_per_sqft: 170000 });   // 500 sq ft x Rs 1,700 = Rs 8.5 lakh, below the Rs 9 lakh MSP
ok('a cost sheet below MSP is flagged', sheetLow.status === 200 && sheetLow.data.below_msp === true, JSON.stringify(sheetLow));
await o.call('POST', `/api/sales/cost-sheets/${sheetLow.data.id}/submit`, {});
ok('the PM cannot approve a cost sheet below MSP', (await pm.call('POST', `/api/sales/cost-sheets/${sheetLow.data.id}/approve`, {})).status === 403);
await o.call('POST', '/api/redev/approval-pin', { pin: '482913', password: process.env.OWNER_PASSWORD });
ok('the Owner cannot approve below MSP without the PIN', (await o.call('POST', `/api/sales/cost-sheets/${sheetLow.data.id}/approve`, {})).code === 'pin_required');
ok('wrong PIN refused', (await o.call('POST', `/api/sales/cost-sheets/${sheetLow.data.id}/approve`, { pin: '111222' })).status === 400);
ok('Owner approves below MSP with the PIN', (await o.call('POST', `/api/sales/cost-sheets/${sheetLow.data.id}/approve`, { pin: '482913' })).status === 200);
const viaSheet = await o.call('POST', '/api/sales/bookings', { unit_id: uM, customer_name: 'zz sheet', cost_sheet_id: sheetLow.data.id, token_paise: 1000000 });
ok('the approved below-MSP sheet can price the booking', viaSheet.status === 200, JSON.stringify(viaSheet));
const uOk = await mkUnit(); await o.call('POST', '/api/sales/msp', { unit_id: uOk, msp_paise: 90000000, reason: 'floor' });
const okSheet = await o.call('POST', '/api/sales/cost-sheets', { unit_id: uOk, base_rate_paise_per_sqft: 200000 });
ok('a cost sheet above MSP is not flagged and the PM can approve it', okSheet.data.below_msp === false && (await o.call('POST', `/api/sales/cost-sheets/${okSheet.data.id}/submit`, {})).status === 200 && (await pm.call('POST', `/api/sales/cost-sheets/${okSheet.data.id}/approve`, {})).status === 200);
const proj = await o.call('POST', '/api/sales/msp', { project_id: pid, rate_paise_per_sqft: 180000, reason: 'launch floor rate' });
ok('MSP can be set for a whole project by rate per sq ft', proj.status === 200 && proj.data.changed >= 1, JSON.stringify(proj));

// ---------- Partner KYC + RERA expiry gate + broker lock ----------
const part = (await o.call('POST', '/api/sales/partners', { firm: 'zz Realty ' + run, brokerage_default_bp: 200 })).data.id;
const part2 = (await o.call('POST', '/api/sales/partners', { firm: 'zz Other ' + run, brokerage_default_bp: 200 })).data.id;
const leadP = (await o.call('POST', '/api/sales/leads', { name: 'zz via broker ' + run, phone: phone(), project_id: pid, channel_partner_id: part, consent: true })).data.id;
const uP = await mkUnit();
const wrong = await o.call('POST', '/api/sales/bookings', { unit_id: uP, lead_id: leadP, customer_name: 'zz cust', channel_partner_id: part2, token_paise: 1000000 });
ok('a different broker cannot be tagged at booking', wrong.status === 409 && wrong.code === 'partner_lock', JSON.stringify(wrong));
const bkP = await o.call('POST', '/api/sales/bookings', { unit_id: uP, lead_id: leadP, customer_name: 'zz cust', token_paise: 1000000 });
const bkd = (await o.call('GET', `/api/sales/bookings/${bkP.data.id}`)).data;
ok('the booking inherits the broker who registered the lead', bkP.status === 200 && (bkd.booking || bkd).channel_partner_id === part, JSON.stringify(bkP));
const uQ = await mkUnit();
ok('tagging a broker on a booking with no lead is refused', (await o.call('POST', '/api/sales/bookings', { unit_id: uQ, customer_name: 'zz walkin', channel_partner_id: part, token_paise: 1000000 })).code === 'partner_lock');
ok('the Owner can override with a written reason', (await o.call('POST', '/api/sales/bookings', { unit_id: uQ, customer_name: 'zz walkin', channel_partner_id: part, partner_override_reason: 'Broker introduced the buyer by phone, proof on file', token_paise: 1000000 })).status === 200);
const pay = (body = {}) => o.call('POST', `/api/sales/partners/${part}/payments`, { amount_paise: 10000, ...body });
ok('brokerage cannot be paid before KYC is approved', (await pay()).code === 'partner_kyc');
ok('PM cannot approve KYC', (await pm.call('POST', `/api/sales/partners/${part}/kyc/approve`, {})).status === 403);
ok('KYC approval needs the details first', (await o.call('POST', `/api/sales/partners/${part}/kyc/approve`, {})).status === 400);
ok('a bad PAN is refused', (await o.call('POST', `/api/sales/partners/${part}/kyc`, { pan: 'BADPAN' })).status === 400);
ok('a bad GSTIN is refused', (await o.call('POST', `/api/sales/partners/${part}/kyc`, { gstin: '27ABC' })).status === 400);
ok('sales cannot save KYC', (await sales.call('POST', `/api/sales/partners/${part}/kyc`, { pan: 'QWERT9876K' })).status === 403);
await o.call('POST', `/api/sales/partners/${part}/kyc`, { pan: 'QWERT9876K', gstin: '27QWERT9876K1Z5', rera_no: 'A51900012345', rera_valid_till: iso(-3) });
ok('an expired MahaRERA date blocks approval', (await o.call('POST', `/api/sales/partners/${part}/kyc/approve`, {})).status === 400);
await o.call('POST', `/api/sales/partners/${part}/kyc`, { rera_valid_till: iso(200) });
ok('Accounts can approve KYC once details are complete', (await acc.call('POST', `/api/sales/partners/${part}/kyc/approve`, {})).status === 200);
const lp = (await o.call('GET', '/api/sales/partners')).data.partners.find((p) => p.id === part);
ok('the list shows KYC state and PAN last 4 only, never the encrypted PAN', lp.kyc_status === 'approved' && lp.pan_last4 === '876K' && lp.pan_enc === undefined && !JSON.stringify(lp).includes('enc:'), JSON.stringify(lp));
ok('brokerage can be paid once KYC is approved and RERA is valid', (await pay()).status === 200);
sql(`UPDATE sal_partners SET rera_valid_till = '${iso(-1)}' WHERE id = ${part}`);
const exp = await pay();
ok('brokerage is blocked again the day the MahaRERA registration expires', exp.code === 'partner_kyc' && /expired/.test(exp.err || ''), JSON.stringify(exp));
await o.call('POST', `/api/sales/partners/${part}/kyc`, { rera_valid_till: iso(300) });
ok('changing KYC details needs a fresh approval', (await pay()).code === 'partner_kyc');

// ---------- Re-hold block ----------
const uH = await mkUnit(); const leadH = (await sales.call('POST', '/api/sales/leads', { name: 'zz hold ' + run, phone: phone(), project_id: pid, consent: true })).data.id;
ok('closer holds a flat', (await sales.call('POST', `/api/sales/inventory/${uH}/hold`, { lead_id: leadH })).status === 200);
ok('and releases it', (await sales.call('POST', `/api/sales/inventory/${uH}/release`, {})).status === 200);
const again = await sales.call('POST', `/api/sales/inventory/${uH}/hold`, { lead_id: leadH });
ok('the same closer cannot re-block it straight away', again.status === 409 && again.code === 'rehold', JSON.stringify(again));
ok('a manager is not blocked', (await o.call('POST', `/api/sales/inventory/${uH}/hold`, { lead_id: leadH })).status === 200);
await o.call('POST', `/api/sales/inventory/${uH}/release`, {});
const uH2 = await mkUnit(); const leadH2 = (await sales.call('POST', '/api/sales/leads', { name: 'zz hold2 ' + run, phone: phone(), project_id: pid, consent: true })).data.id;
await sales.call('POST', `/api/sales/inventory/${uH2}/hold`, { lead_id: leadH2, hours: 1 }); sql(`UPDATE sal_inventory SET blocked_till = datetime('now', '-2 minutes') WHERE id = ${uH2}`);
await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2000));
ok('a lapsed hold also blocks the same closer from re-blocking it', (await sales.call('POST', `/api/sales/inventory/${uH2}/hold`, { lead_id: leadH2 })).code === 'rehold');

// ---------- "Is this number ours?" ----------
const ph = phone(); const leadR = (await o.call('POST', '/api/sales/leads', { name: 'zz Mehta ' + run, phone: ph, project_id: pid, config_pref: '3BHK', channel_partner_id: part2, consent: true })).data.id;
const vis = (await o.call('POST', `/api/sales/leads/${leadR}/visit`, { visit_at: iso(-1) + 'T11:00' })).data;
if (vis && vis.id) await o.call('POST', `/api/sales/visits/${vis.id}/status`, { status: 'done' });
const rec = await o.call('GET', '/api/sales/recognize?phone=' + ph);
ok('a registered number is recognised, with who brought it', rec.data.registered === true && /zz Other/.test(rec.data.by), JSON.stringify(rec));
ok('the owner sees BHK, name and visits', rec.data.config_pref === '3BHK' && /zz Mehta/.test(rec.data.name), JSON.stringify(rec));
const closerIsSales = (await o.call('GET', `/api/sales/leads/${leadR}`)).data.lead.assigned_to === sales.id;
const rec2 = await (closerIsSales ? sales2 : sales).call('GET', '/api/sales/recognize?phone=+91 ' + ph);
ok('another closer only learns it is taken, not the buyer details', rec2.data.registered === true && rec2.data.name === undefined, JSON.stringify(rec2));
ok('an unknown number is free', (await o.call('GET', '/api/sales/recognize?phone=' + phone())).data.registered === false);
ok('a short number is refused', (await o.call('GET', '/api/sales/recognize?phone=123')).status === 400);

// ---------- Rehab flats hidden from sales ----------
const uRe = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'R', floor: 1, unit_no: 'RH' + run.slice(-3), category: 'rehab', rera_carpet_sqft: 400 })).data.id;
ok('the Owner still sees rehab flats on the stacking plan', (await o.call('GET', `/api/reports/stacking?project_id=${pid}`)).data.units.some((u) => u.id === uRe));
ok('sales does not see them at all', !(await sales.call('GET', `/api/reports/stacking?project_id=${pid}`)).data.units.some((u) => u.id === uRe));

// ---------- Lead SLA auto-reassign (only inside 09:00-19:00 India time) ----------
const hourIST = new Date(Date.now() + 19800000).getUTCHours();
if (hourIST >= 9 && hourIST < 19) {
  const leadS = (await sales.call('POST', '/api/sales/leads', { name: 'zz sla ' + run, phone: phone(), project_id: pid, consent: true })).data.id;
  sql(`UPDATE sal_leads SET created_at = datetime('now', '-30 minutes') WHERE id = ${leadS}`);
  await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
  const l = (await o.call('GET', `/api/sales/leads/${leadS}`)).data.lead;
  ok('an uncalled lead is moved to the next executive after the SLA', l.assigned_to !== sales.id && l.sla_reassigns === 1, JSON.stringify(l));
  ok('the new executive and the managers are told', JSON.stringify((await o.call('GET', '/api/notifications')).data).includes('moved to the next executive'));
  const touched = (await sales2.call('POST', '/api/sales/leads', { name: 'zz sla2 ' + run, phone: phone(), project_id: pid, consent: true })).data.id;
  await sales2.call('POST', `/api/sales/leads/${touched}/activity`, { type: 'call', note: 'spoke', next_followup_at: iso(1) + 'T10:00' });
  sql(`UPDATE sal_leads SET created_at = datetime('now', '-30 minutes') WHERE id = ${touched}`);
  await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
  ok('a lead that was called is left alone', (await o.call('GET', `/api/sales/leads/${touched}`)).data.lead.sla_reassigns === 0);
} else console.log('SKIP  SLA reassign (outside 09:00-19:00 India time)');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
