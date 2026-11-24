// tests/sales2.mjs — lead timeline, follow-ups, visits, partners, funnel, search. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, raw) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !(b instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return r; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-s2 ' + run, code: 'S2' + run.toUpperCase().slice(-5) })).data.id;
let seq = 0; const mk = async (role, projects) => { const email = `zs-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zs ' + role, email, role, projects }); const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: 'ZsStrongPass-' + run }); c.id = r.data.id; return c; };
const sales = await mk('sales', [pid]); const sales2 = await mk('sales', [pid]); const site = await mk('site', [pid]);

const lid = (await sales.call('POST', '/api/sales/leads', { name: 'zz lead ' + run, phone: '97' + digits, project_id: pid, source: 'walk_in' })).data.id;
ok('call without next follow-up refused', (await sales.call('POST', `/api/sales/leads/${lid}/activity`, { type: 'call', outcome: 'reached' })).status === 400);
ok('call with follow-up saved', (await sales.call('POST', `/api/sales/leads/${lid}/activity`, { type: 'call', outcome: 'reached', next_followup_at: '2020-01-01T10:00' })).status === 200);
let det = (await sales.call('GET', `/api/sales/leads/${lid}`)).data;
ok('first call moves new -> contacted and stamps first contact', det.lead.status === 'contacted' && !!det.lead.first_contact_at && det.activities.length === 1);
ok('another sales user cannot open this lead', (await sales2.call('GET', `/api/sales/leads/${lid}`)).status === 403);
ok('site cannot open leads', (await site.call('GET', `/api/sales/leads/${lid}`)).status === 403);
const fu = (await sales.call('GET', '/api/sales/followups')).data;
ok('overdue follow-up appears in Today strip', fu.followups.some((x) => x.id === lid));
const vis = (await sales.call('POST', `/api/sales/leads/${lid}/visit`, { visit_at: '2099-01-01T11:00' })).data.id;
det = (await sales.call('GET', `/api/sales/leads/${lid}`)).data;
ok('scheduling a visit sets status', det.lead.status === 'visit_scheduled' && det.visits.length === 1);
ok('visit marked done moves lead to visited', (await sales.call('POST', `/api/sales/visits/${vis}/status`, { status: 'done', feedback: 'liked 2BHK' })).status === 200 && (await sales.call('GET', `/api/sales/leads/${lid}`)).data.lead.status === 'visited');
ok('closing a lead clears the follow-up and needs none', (await sales.call('POST', `/api/sales/leads/${lid}/activity`, { type: 'call', status: 'lost', note: 'bought elsewhere' })).status === 200 && (await sales.call('GET', `/api/sales/leads/${lid}`)).data.lead.next_followup_at === null);

// partners + brokerage
ok('sales cannot see partners', (await sales.call('GET', '/api/sales/partners')).status === 403);
const part = (await o.call('POST', '/api/sales/partners', { firm: 'zz Realty ' + run, brokerage_default_bp: 200 })).data.id;
const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, unit_no: 'Q' + run.slice(-3), price_paise: 10000000 })).data.id;
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
const bk = (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'zz cust', channel_partner_id: part, partner_override_reason: 'walk-in introduced by this broker, proof on file' })).data.id;
const dem = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands[0];
await o.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 5000000, demand_id: dem.id, ref_no: 'T' + run });
let pt = (await o.call('GET', '/api/sales/partners')).data.partners.find((p) => p.id === part);
ok('brokerage earned = 2% of money received', pt.earned_paise === 100000 && pt.paid_paise === 0, JSON.stringify(pt));
await o.call('POST', `/api/sales/partners/${part}/kyc`, { pan: 'QWERT9876K', rera_no: 'A51900099999', rera_valid_till: '2099-01-01' });   // brokerage is paid only to a partner with approved KYC and a valid MahaRERA registration
await o.call('POST', `/api/sales/partners/${part}/kyc/approve`, {});
await o.call('POST', `/api/sales/partners/${part}/payments`, { amount_paise: 40000 });
pt = (await o.call('GET', '/api/sales/partners')).data.partners.find((p) => p.id === part);
ok('payment reduces payable', pt.earned_paise - pt.paid_paise === 60000);

// funnel + search + dashboard
const fun = (await o.call('GET', `/api/reports/funnel?project_id=${pid}`)).data;
ok('funnel counts the lead', fun.status.some((s) => s.status === 'lost') && fun.avg_first_response_hours !== null);
ok('site cannot read the funnel', (await site.call('GET', '/api/reports/funnel')).status === 403);
const sr = (await sales.call('GET', `/api/search?q=${encodeURIComponent('zz lead ' + run)}`)).data.results;
ok('sales search finds own lead', sr.some((r) => r.kind === 'Lead'));
ok('other sales user does not find it', !(await sales2.call('GET', `/api/search?q=${encodeURIComponent('zz lead ' + run)}`)).data.results.some((r) => r.kind === 'Lead'));
ok('site search never returns leads or vendors', !(await site.call('GET', `/api/search?q=zz`)).data.results.some((r) => ['Lead', 'Vendor', 'Booking'].includes(r.kind)));
await o.call('POST', '/api/approvals', { project_id: pid, name: 'zz expiring', valid_till: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), status: 'approved' });
const dash = (await o.call('GET', `/api/dashboard?project_id=${pid}`)).data;
ok('dashboard counts expiring approvals', dash.approvalsExpiring >= 1, JSON.stringify(dash));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
