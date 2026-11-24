// tests/sales3.mjs — WP-11 to WP-14: numbering, receipt approval, credit notes, co-applicants, hold expiry, cost sheets, handover. Same env vars as security.mjs.
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
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const code = 'S3' + run.toUpperCase().slice(-6);
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-s3 ' + run, code, budget_paise: 50000000 })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-s3b ' + run, code: 'T3' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []); const sales2 = await mkUser('sales', []); const site = await mkUser('site', [pid]);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
const fy = (() => { const d = new Date(Date.now() + 19800000); const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const a = m >= 4 ? y : y - 1; return `${a}-${String(a + 1).slice(2)}`; })();
const cleanSettings = () => sql("DELETE FROM settings WHERE key IN ('tax.gst_bp', 'tax.stamp_duty_bp', 'sales.discount_pm_limit_paise', 'sales.handover_template', 'sales.receipt_approval_limit_paise')");
cleanSettings();   // start from the defaults, and leave them that way (settings are shared with the other test suites)
await setSetting('sales.max_holds_per_user', 5);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'On booking', pct_bp: 2000 }, { stage_name: 'Slab', pct_bp: 8000, milestone_key: 'k' + run }] });
let n = 0;
const mkUnit = async (extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: 'S' + (++n) + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000, ...extra })).data.id;
const mkLead = async (who, nm) => (await who.call('POST', '/api/sales/leads', { name: nm + ' ' + run, phone: '9' + String(Date.now() + (++n)).slice(-9), project_id: pid, source: 'walk_in', consent: true })).data.id;
const book = async (who, unit, body = {}) => who.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Cust ' + n + ' ' + run, phone: '9' + String(Date.now() + (++n)).slice(-9), agreed_price_paise: 100000000, token_paise: 1000000, ...body });

// =========================== WP-11 ===========================
const u1 = await mkUnit(); const bk = (await book(sales, u1)).data.id;
const bd = (await o.call('GET', `/api/sales/bookings/${bk}`)).data; const dem1 = bd.demands[0];
const rcpt = (who, body) => who.call('POST', `/api/sales/bookings/${bk}/receipts`, { mode: 'neft', ...body });
const r1 = await rcpt(acc, { amount_paise: 100000, demand_id: dem1.id, ref_no: 'N1' + run });
ok('receipt number carries the financial year: RC-<project>-<FY>-00001', r1.status === 200 && r1.data.receipt_no === `RC-${code}-${fy}-00001`, JSON.stringify(r1));
const burst = await Promise.all([1, 2, 3, 4, 5].map((i) => rcpt(acc, { amount_paise: 1000 * i, demand_id: dem1.id, ref_no: `B${i}${run}` })));
const nums = burst.map((b) => b.data && b.data.receipt_no);
ok('five receipts at the same moment get five different, consecutive numbers', burst.every((b) => b.status === 200) && new Set(nums).size === 5 && nums.map((x) => Number(x.slice(-5))).sort().join() === '2,3,4,5,6', nums.join());
ok('a duplicate reference is still refused', (await rcpt(acc, { amount_paise: 5, demand_id: dem1.id, ref_no: 'N1' + run })).status === 409);

// demand numbers
const dn = (await acc.call('GET', `/api/print/demand/${dem1.id}`)).data.demand.demand_no;
ok('a demand letter gets its number when printed: DL-<project>-<FY>-0001', dn === `DL-${code}-${fy}-0001`, dn);
ok('the same number every time', (await acc.call('GET', `/api/print/demand/${dem1.id}`)).data.demand.demand_no === dn);
const dem2 = bd.demands[1];
ok('a stage not yet reached has no number', (await acc.call('GET', `/api/print/demand/${dem2.id}`)).data.demand.demand_no === null);

// receipts waiting for approval
await setSetting('sales.receipt_approval_limit_paise', 500000);
const before = (await o.call('GET', `/api/sales/bookings/${bk}`)).data;
const settledBefore = before.demands[0].settled_paise;
const big = await rcpt(acc, { amount_paise: 600000, demand_id: dem1.id, ref_no: 'BIG' + run });
ok('a receipt above the limit waits for approval', big.status === 200 && big.data.pending === true && big.data.request_id, JSON.stringify(big));
const mid = (await o.call('GET', `/api/sales/bookings/${bk}`)).data;
ok('nothing changes while it waits: no receipt, demand unchanged', mid.demands[0].settled_paise === settledBefore && mid.receipts.length === before.receipts.length);
ok('the same pending receipt cannot be entered twice', (await rcpt(acc, { amount_paise: 600000, demand_id: dem1.id, ref_no: 'BIG' + run })).status === 409);
const small = await rcpt(acc, { amount_paise: 400000, demand_id: dem1.id, ref_no: 'SM' + run });
ok('a small receipt still posts at once, and takes the next number', small.status === 200 && Number(small.data.receipt_no.slice(-5)) === 7, JSON.stringify(small));
ok('Accounts cannot approve', (await acc.call('POST', `/api/sales/receipt-requests/${big.data.request_id}/approve`, {})).status === 403);
const pend = (await pm.call('GET', '/api/sales/receipt-requests')).data.requests.find((x) => x.id === big.data.request_id);
ok('PM sees it in the waiting list', pend && pend.customer_name.startsWith('Cust'));
const ap = await pm.call('POST', `/api/sales/receipt-requests/${big.data.request_id}/approve`, {});
ok('PM approves: the receipt is posted with the next number', ap.status === 200 && Number(ap.data.receipt_no.slice(-5)) === 8, JSON.stringify(ap));
const after = (await o.call('GET', `/api/sales/bookings/${bk}`)).data;
ok('demand settled by exactly the approved amount', after.demands[0].settled_paise === settledBefore + 400000 + 600000, `${after.demands[0].settled_paise} vs ${settledBefore + 1000000}`);
ok('cannot approve twice', (await pm.call('POST', `/api/sales/receipt-requests/${big.data.request_id}/approve`, {})).status === 409);
const big2 = await rcpt(acc, { amount_paise: 700000, demand_id: dem1.id, ref_no: 'BIG2' + run });
ok('rejecting needs a reason', (await pm.call('POST', `/api/sales/receipt-requests/${big2.data.request_id}/reject`, {})).status === 400);
ok('rejected receipt posts nothing', (await pm.call('POST', `/api/sales/receipt-requests/${big2.data.request_id}/reject`, { note: 'wrong cheque' })).status === 200 && (await o.call('GET', `/api/sales/bookings/${bk}`)).data.receipts.length === after.receipts.length);
const big3 = await rcpt(o, { amount_paise: 800000, demand_id: dem1.id, ref_no: 'BIG3' + run });
{ const r = await o.call('POST', `/api/sales/receipt-requests/${big3.data.request_id}/approve`, {}); ok('the Owner approves a receipt they recorded themselves', r.status === 200, JSON.stringify(r.data || r.error));
  const au = (await o.call('GET', '/api/audit?entity=sal_receipt_requests&entity_id=' + big3.data.request_id)).data.audit; ok('the audit says it was approved by the Owner as maker', au.some((x) => /approved by Owner as maker/.test(x.summary))); }
await setSetting('sales.receipt_approval_limit_paise', 0);

// credit notes
const dBefore = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[1];
ok('site/sales cannot raise a credit note', (await sales.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dem2.id, kind: 'credit_note', amount_paise: 100, reason: 'goodwill gesture' })).status === 403);
ok('credit note needs a reason', (await acc.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dem2.id, kind: 'credit_note', amount_paise: 100, reason: 'x' })).status === 400);
const cn = await acc.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dem2.id, kind: 'credit_note', amount_paise: 10000000, gst_paise: 500000, reason: 'Rs 1,00,000 goodwill credit' });
ok('credit note is proposed, demand unchanged', cn.status === 200 && (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[1].amount_paise === dBefore.amount_paise);
ok('Accounts cannot approve their own credit note', (await acc.call('POST', `/api/sales/adjustments/${cn.data.id}/approve`, {})).status === 403);
const pmNote = await pm.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dem2.id, kind: 'credit_note', amount_paise: 100, reason: 'rounding off the stage' });
ok('PM cannot approve their own credit note', (await pm.call('POST', `/api/sales/adjustments/${pmNote.data.id}/approve`, {})).status === 403);
const apn = await pm.call('POST', `/api/sales/adjustments/${cn.data.id}/approve`, {});
ok('PM approves: numbered CN-<project>-<FY>-0001', apn.status === 200 && apn.data.adj_no === `CN-${code}-${fy}-0001`, JSON.stringify(apn));
const dAfter = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[1];
ok('the demand is lowered to the paisa (amount and GST)', dAfter.amount_paise === dBefore.amount_paise - 10000000 && dAfter.gst_paise === dBefore.gst_paise - 500000, JSON.stringify([dBefore.amount_paise, dAfter.amount_paise, dAfter.gst_paise]));
ok('an approved note cannot be approved again', (await pm.call('POST', `/api/sales/adjustments/${cn.data.id}/approve`, {})).status === 409);
ok('a credit below what is already paid is refused', (await acc.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dem1.id, kind: 'credit_note', amount_paise: 99999999, reason: 'too much credit' })).status === 400);
ok('reversal needs a reason', (await pm.call('POST', `/api/sales/adjustments/${cn.data.id}/reverse`, {})).status === 400);
ok('reversal restores the demand exactly', (await pm.call('POST', `/api/sales/adjustments/${cn.data.id}/reverse`, { reason: 'issued by mistake' })).status === 200 && (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[1].amount_paise === dBefore.amount_paise);
const dbn = await acc.call('POST', `/api/sales/bookings/${bk}/adjustments`, { demand_id: dem2.id, kind: 'debit_note', amount_paise: 200000, gst_paise: 10000, reason: 'extra work charged' });
const dbApp = await o.call('POST', `/api/sales/adjustments/${dbn.data.id}/approve`, {});
ok('debit note raises the demand and has its own series (DN)', dbApp.status === 200 && dbApp.data.adj_no === `DN-${code}-${fy}-0001` && (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[1].amount_paise === dBefore.amount_paise + 200000);
const pc = (await acc.call('GET', `/api/print/creditnote/${cn.data.id}`)).data;
ok('credit note print data (reversed note prints as DRAFT)', pc.kind === 'creditnote' && pc.draft === true && pc.note.adj_no === apn.data.adj_no);
const gaps = (await acc.call('GET', `/api/sales/reports/numbering?project_id=${pid}`)).data;
const rcS = gaps.series.find((s) => s.series.startsWith('RC-')), dlS = gaps.series.find((s) => s.series.startsWith('DL-')), cnS = gaps.series.find((s) => s.series.startsWith('CN-'));
ok('numbering report: no gaps in receipts, demand letters or credit notes', rcS && rcS.highest === 9 && rcS.issued === 9 && rcS.missing.length === 0 && dlS.missing.length === 0 && cnS.issued === 1 && cnS.missing.length === 0, JSON.stringify(gaps.series));
const csv = await acc.call('GET', `/api/sales/reports/numbering?project_id=${pid}&csv=1`, null, true); ok('numbering CSV', csv.status === 200 && (await csv.text()).includes('Missing numbers'));
ok('sales cannot read the numbering report', (await sales.call('GET', `/api/sales/reports/numbering?project_id=${pid}`)).status === 403);

// =========================== WP-12 ===========================
const holdUnit = await mkUnit(); const leadK = await mkLead(sales, 'Kulkarni');
const hold = await sales.call('POST', `/api/sales/inventory/${holdUnit}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: leadK, hours: 1 });
ok('sales holds a flat for a lead', hold.status === 200);
const stk = (await pm.call('GET', `/api/reports/stacking?project_id=${pid}`)).data;
const hu = stk.units.find((u) => u.id === holdUnit);
ok('the flat card says who holds it, for which lead, until when', hu && hu.state === 'token_locked' && hu.holder && hu.holder_lead === 'Kulkarni ' + run && hu.blocked_till, JSON.stringify(hu));
ok('another salesperson cannot take over the hold (not their lead)', [403, 409].includes((await sales2.call('POST', `/api/sales/inventory/${holdUnit}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: leadK })).status));
await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1500));
ok('holder is warned an hour before it ends', JSON.stringify((await sales.call('GET', '/api/notifications')).data).includes('Hold ending soon'));
sql(`UPDATE sal_inventory SET blocked_till = datetime('now', '-5 minutes') WHERE id = ${holdUnit}`);
const holdB = await mkUnit(); const leadL = await mkLead(sales, 'Lonkar'); await sales.call('POST', `/api/sales/inventory/${holdB}/hold`, { token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 100000, lead_id: leadL, hours: 1 }); sql(`UPDATE sal_inventory SET blocked_till = datetime('now', '-1 minutes') WHERE id = ${holdB}`);
await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1800));
const inv = (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory;
ok('both expired holds are released by the hourly sweep', inv.find((u) => u.id === holdUnit).status === 'available' && inv.find((u) => u.id === holdB).status === 'available');
ok('and the holder is told', JSON.stringify((await sales.call('GET', '/api/notifications')).data).includes('Hold expired'));

const parties = (await o.call('GET', `/api/sales/bookings/${bk}/parties`)).data.parties;
ok('a booking starts with no co-applicants', parties.length === 0);
const cp1 = await sales.call('POST', `/api/sales/bookings/${bk}/parties`, { name: 'Mrs Kulkarni', phone: '9811111111', relation: 'spouse', share_bp: 4000, pan: 'ABCDE1234F', aadhaar: '1234 5678 9012' });
ok('sales adds a co-applicant (40% share)', cp1.status === 200);
ok('shares above 100% are refused', (await sales.call('POST', `/api/sales/bookings/${bk}/parties`, { name: 'X', share_bp: 7000 })).status === 400);
ok('Aadhaar must be 12 digits', (await sales.call('POST', `/api/sales/bookings/${bk}/parties`, { name: 'X', aadhaar: '12345' })).status === 400);
const seenA = (await acc.call('GET', `/api/sales/bookings/${bk}/parties`)).data.parties[0], seenPm = (await pm.call('GET', `/api/sales/bookings/${bk}/parties`)).data.parties[0], seenS = (await sales.call('GET', `/api/sales/bookings/${bk}/parties`)).data.parties[0];
ok('Accounts and the booking\'s own salesperson see PAN last 4 and masked Aadhaar', seenA.pan_masked === '••••234F' && seenA.aadhaar_masked === 'XXXX XXXX 9012' && seenS.pan_masked === '••••234F');
ok('PM sees neither PAN nor Aadhaar', seenPm.pan_masked === '' && seenPm.aadhaar_masked === '' && seenPm.has_pan === true);
ok('the full Aadhaar or PAN never appears in any response', !JSON.stringify([seenA, seenPm, seenS]).includes('123456789012') && !JSON.stringify([seenA, seenS]).includes('ABCDE1234F'));
ok('another salesperson cannot touch this booking', (await sales2.call('GET', `/api/sales/bookings/${bk}/parties`)).status === 403);
ok('only the Owner can delete a co-applicant: Sales is refused', (await sales.call('DELETE', `/api/sales/parties/${cp1.data.id}`)).status === 403);
ok('co-applicant can be removed (kept in the audit log)', (await o.call('DELETE', `/api/sales/parties/${cp1.data.id}`)).status === 200 && (await o.call('GET', `/api/sales/bookings/${bk}/parties`)).data.parties.length === 0);

// =========================== WP-13 ===========================
await setSetting('tax.gst_bp', 500); await setSetting('tax.stamp_duty_bp', 600); await setSetting('sales.discount_pm_limit_paise', 10000000);
const csUnit = await mkUnit(); const csLead = await mkLead(sales, 'Sheet Lead');
const sheetBody = (extra) => ({ unit_id: csUnit, lead_id: csLead, area_basis: 'rera_carpet', base_rate_paise_per_sqft: 200000, registration_paise: 3000000, lines: [{ label: 'Parking', kind: 'addition', amount_paise: 5000000 }, { label: 'Festival offer', kind: 'discount', amount_paise: 30000000 }], ...extra });
ok('accounts cannot make a cost sheet', (await acc.call('POST', '/api/sales/cost-sheets', sheetBody({}))).status === 403);
ok('another salesperson cannot make a sheet for this lead', (await sales2.call('POST', '/api/sales/cost-sheets', sheetBody({}))).status === 403);
ok('the flat must have an area', (await sales.call('POST', '/api/sales/cost-sheets', sheetBody({ unit_id: await mkUnit({ rera_carpet_sqft: 0 }) }))).status === 400);
const cs1 = await sales.call('POST', '/api/sales/cost-sheets', sheetBody({}));
ok('cost sheet maths to the paisa (rate x area + parking - discount, GST and stamp duty from Settings)', cs1.status === 200 && cs1.data.agreement_value_paise === 75000000 && cs1.data.gst_paise === 3750000 && cs1.data.stamp_duty_paise === 4500000 && cs1.data.total_paise === 86250000 && cs1.data.below_list_paise === 25000000, JSON.stringify(cs1.data));
ok('discounts bigger than the price are refused', (await sales.call('POST', '/api/sales/cost-sheets', sheetBody({ lines: [{ label: 'x', kind: 'discount', amount_paise: 999999999 }] }))).status === 400);
ok('creator sends it for approval', (await sales.call('POST', `/api/sales/cost-sheets/${cs1.data.id}/submit`, {})).status === 200);
ok('the creator cannot approve', (await sales.call('POST', `/api/sales/cost-sheets/${cs1.data.id}/approve`, {})).status === 403);
const pmApp = await pm.call('POST', `/api/sales/cost-sheets/${cs1.data.id}/approve`, {});
ok('a Rs 2,50,000 discount is above the PM limit: routed to the Owner', pmApp.status === 403 && /Owner/.test(pmApp.err), pmApp.err);
ok('Owner approves', (await o.call('POST', `/api/sales/cost-sheets/${cs1.data.id}/approve`, {})).status === 200);
const cs2 = await sales.call('POST', '/api/sales/cost-sheets', sheetBody({ lines: [{ label: 'Festival offer', kind: 'discount', amount_paise: 5000000 }] }));
ok('a new version supersedes the old one', cs2.data.version === 2 && (await sales.call('GET', `/api/sales/cost-sheets?unit_id=${csUnit}`)).data.sheets.find((s) => s.id === cs1.data.id).status === 'superseded');
ok('a draft cost sheet cannot price a booking', (await book(sales, csUnit, { cost_sheet_id: cs2.data.id, lead_id: csLead })).status === 400);
ok('a superseded sheet cannot be used either', (await book(sales, csUnit, { cost_sheet_id: cs1.data.id, lead_id: csLead })).status === 400);
await sales.call('POST', `/api/sales/cost-sheets/${cs2.data.id}/submit`, {});
ok('PM approves a smaller discount (within the limit)', (await pm.call('POST', `/api/sales/cost-sheets/${cs2.data.id}/approve`, {})).status === 200);
const printed = (await acc.call('GET', `/api/print/costsheet/${cs2.data.id}`)).data;
ok('print data: letterhead sheet with lines; DRAFT only until approved', printed.kind === 'costsheet' && printed.draft === false && printed.lines.length === 1 && (await acc.call('GET', `/api/print/costsheet/${cs1.data.id}`)).data.draft === true);
const bkCs = await book(sales, csUnit, { cost_sheet_id: cs2.data.id, lead_id: csLead, agreed_price_paise: 1 });
const bkRow = bkCs.status === 200 ? (await o.call('GET', `/api/sales/bookings/${bkCs.data.id}`)).data : null;
ok('the booking takes its price from the approved sheet, to the paisa (the typed price is ignored)', bkCs.status === 200 && bkRow.booking.agreed_price_paise === 95000000 && bkRow.demands.reduce((t, d) => t + d.amount_paise, 0) === 95000000, JSON.stringify(bkCs));
ok('the discount reason points at the sheet and the sheet approver is on the booking', /cost sheet v2/.test(bkRow.booking.discount_reason) && bkRow.booking.approved_by > 0);
ok('a sheet cannot price a second booking', (await book(o, await mkUnit(), { cost_sheet_id: cs2.data.id })).status === 400);
const rep = (await acc.call('GET', '/api/sales/reports/discounts')).data.rows.find((r) => r.project === 'zz-s3 ' + run);
ok('discount report: given by person and project', rep && rep.sheets === 1 && rep.discount_paise === 5000000, JSON.stringify(rep));
ok('sales cannot read the discount report', (await sales.call('GET', '/api/sales/reports/discounts')).status === 403);

// =========================== WP-14 ===========================
const hoUnit = await mkUnit(); const bkH = (await book(sales, hoUnit)).data.id;
ok('handover cannot open before the agreement date', (await sales.call('POST', `/api/sales/bookings/${bkH}/handover`, {})).status === 400);
await pm.call('POST', `/api/sales/bookings/${bkH}/registration`, { agreement_date: iso(-30) });
ok('accounts cannot open a handover', (await acc.call('POST', `/api/sales/bookings/${bkH}/handover`, {})).status === 403);
const ho = await sales.call('POST', `/api/sales/bookings/${bkH}/handover`, {});
ok('Sales opens the handover', ho.status === 200);
const hd = (await sales.call('GET', `/api/sales/bookings/${bkH}/handover`)).data;
ok('the starter checklist is created and flagged as a starter list', hd.items.length === 5 && hd.template_is_starter === true && hd.handover.status === 'in_progress');
ok('a second handover for the same booking is refused', (await sales.call('POST', `/api/sales/bookings/${bkH}/handover`, {})).status === 409);
ok('tick an item', (await sales.call('POST', `/api/sales/handover-items/${hd.items[0].id}`, { done: true, note: 'cleared' })).status === 200 && (await sales.call('GET', `/api/sales/bookings/${bkH}/handover`)).data.items[0].done === 1);
ok('possession details saved', (await sales.call('POST', `/api/sales/bookings/${bkH}/handover/details`, { possession_offered_on: iso(2), oc_reference: 'OC/123' })).status === 200);
ok('bad date refused', (await sales.call('POST', `/api/sales/bookings/${bkH}/handover/details`, { possession_offered_on: '2/2/2026' })).status === 400);
// loans
ok('a loan cannot be disbursed beyond the sanction', (await acc.call('POST', `/api/sales/bookings/${bkH}/loans`, { bank: 'HDFC', sanction_paise: 100, disbursed_paise: 200 })).status === 400);
const ln = await acc.call('POST', `/api/sales/bookings/${bkH}/loans`, { bank: 'HDFC', sanction_paise: 50000000, sanction_date: iso(-10), disbursed_paise: 10000000 });
ok('Accounts records a home loan', ln.status === 200 && (await sales.call('GET', `/api/sales/bookings/${bkH}/handover`)).data.loans[0].bank === 'HDFC');
ok('disbursement can be updated', (await acc.call('POST', `/api/sales/loans/${ln.data.id}`, { disbursed_paise: 30000000 })).status === 200 && (await sales.call('GET', `/api/sales/bookings/${bkH}/handover`)).data.loans[0].disbursed_paise === 30000000);
// unit snags
ok('a snag cannot point at a flat in another project', (await site.call('POST', '/api/site/snags', { project_id: pid, title: 'x', unit_id: (await o.call('POST', '/api/sales/inventory', { project_id: pid2, unit_no: 'Z' + run.slice(-3), price_paise: 1 })).data.id })).status === 400);
const snag = await site.call('POST', '/api/site/snags', { project_id: pid, title: 'Tile cracked in living room', severity: 'medium', unit_id: hoUnit });
ok('site raises a snag on the flat', snag.status === 200 && (await sales.call('GET', `/api/sales/bookings/${bkH}/handover`)).data.snags.some((s) => s.title.startsWith('Tile cracked')));
// handover due reminder and the pending report (before completing)
const tick = await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1500));
const notes = JSON.stringify((await pm.call('GET', '/api/notifications')).data);
ok('the hourly sweep reminds PM about a handover due within 3 days', notes.includes('Handover due:'));
const repH = (await sales.call('GET', '/api/sales/reports/handovers')).data.rows.find((r) => r.booking_id === bkH);
ok('pending handovers report: 1 of 5 ticked, 1 open snag', repH && repH.items === 5 && repH.items_done === 1 && repH.open_snags === 1, JSON.stringify(repH));
const hcsv = await pm.call('GET', '/api/sales/reports/handovers?csv=1', null, true); ok('pending handovers CSV', hcsv.status === 200 && (await hcsv.text()).includes('Open snags'));
// complete with warnings
ok('Sales cannot hand over possession (PM or Owner only)', (await sales.call('POST', `/api/sales/bookings/${bkH}/handover/complete`, {})).status === 403);
const noOc = await pm.call('POST', `/api/sales/bookings/${bkH}/handover/complete`, {});
ok('no possession before the OC is approved', noOc.status === 409 && /Occupancy Certificate/.test(noOc.err), JSON.stringify(noOc));
const ocItem = (await o.call('POST', '/api/approvals', { project_id: pid, name: 'Occupancy Certificate (OC)', authority: 'MCGM' })).data.id;
await o.call('POST', `/api/approvals/${ocItem}/event`, { event: 'applied' });
ok('approving the OC needs the letter number and date', (await o.call('POST', `/api/approvals/${ocItem}/event`, { event: 'approved' })).status === 400);
ok('the OC is approved with its letter', (await o.call('POST', `/api/approvals/${ocItem}/event`, { event: 'approved', letter_no: 'CHE/OC/123', letter_date: iso(-1) })).status === 200);
const needWhy = await pm.call('POST', `/api/sales/bookings/${bkH}/handover/complete`, {});
ok('open checklist items, a snag or dues stop possession until someone gives a reason', needWhy.status === 409 && needWhy.data === undefined && /checklist|snag|due/.test(needWhy.err), JSON.stringify(needWhy));
const done = await o.call('POST', `/api/sales/bookings/${bkH}/handover/complete`, { override_note: 'Customer accepted; tile to be replaced within 7 days' });
ok('the Owner hands over with a written reason; what was open is recorded', done.status === 200 && done.data.warnings.some((w) => /4 checklist items/.test(w)) && done.data.warnings.some((w) => /1 snag/.test(w)), JSON.stringify(done));
ok('the flat becomes "possessed" and shows on the stacking plan', (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory.find((u) => u.id === hoUnit).status === 'possessed' && (await pm.call('GET', `/api/reports/stacking?project_id=${pid}`)).data.units.find((u) => u.id === hoUnit).state === 'possessed');
ok('handing over twice is refused', (await o.call('POST', `/api/sales/bookings/${bkH}/handover/complete`, { override_note: 'x' })).status === 409);
ok('items are locked after handover', (await sales.call('POST', `/api/sales/handover-items/${hd.items[1].id}`, { done: true })).status === 409);
ok('completed handover leaves the pending report', !(await sales.call('GET', '/api/sales/reports/handovers')).data.rows.some((r) => r.booking_id === bkH));
// custom template
await setSetting('sales.handover_template', JSON.stringify(['Dues cleared', 'Keys handed over']));
const unit3 = await mkUnit(); const bk3 = (await book(sales, unit3)).data.id; await pm.call('POST', `/api/sales/bookings/${bk3}/registration`, { agreement_date: iso(-5) }); await sales.call('POST', `/api/sales/bookings/${bk3}/handover`, {});
const hd3 = (await sales.call('GET', `/api/sales/bookings/${bk3}/handover`)).data; ok('the checklist template is a setting you can edit', hd3.items.length === 2 && hd3.items[0].label === 'Dues cleared' && hd3.template_is_starter === false);
ok('site engineers have no access to the sales handover', (await site.call('GET', `/api/sales/bookings/${bk3}/handover`)).status === 403);
ok('requests without the header are refused', (await fetch(BASE + `/api/sales/bookings/${bk3}/handover`, { method: 'POST', headers: { cookie: sales.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
cleanSettings();
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
