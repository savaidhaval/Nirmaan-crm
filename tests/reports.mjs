// tests/reports.mjs — executive reports. Same env vars as security.mjs.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error }; } }
const run = Date.now().toString(36); const digits = String(Date.now()).slice(-8);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mk = async (role, projects) => { const email = `zr-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'zr ' + role, email, role, projects }); const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: 'ZrStrongPass-' + run }); return c; };
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-r ' + run, code: 'R' + run.toUpperCase().slice(-6) })).data.id;
const site = await mk('site', [pid]); const acc = await mk('accounts', []); const sales = await mk('sales', [pid]);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Booking', pct_bp: 3000, milestone_key: 'k' + run }, { stage_name: 'Rest', pct_bp: 7000, milestone_key: 'z' + run }] });
const mkUnit = async (wing, floor, n, type, extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing, floor, unit_no: n, type, price_paise: 10000000, rera_carpet_sqft: 500, ...extra })).data.id;
const a301 = await mkUnit('A', 3, '301', '2BHK'); const a302 = await mkUnit('A', 3, '302', '2BHK'); const a801 = await mkUnit('A', 8, '801', '3BHK'); const a802 = await mkUnit('A', 8, '802', '3BHK'); const rehab = await mkUnit('A', 1, '101', '1BHK', { category: 'rehab', price_paise: 0 });
const lead = (await sales.call('POST', '/api/sales/leads', { name: 'zz held', phone: '92' + digits, project_id: pid, source: 'meta' })).data.id;
await sales.call('POST', `/api/sales/inventory/${a802}/hold`, { lead_id: lead });
const b1 = (await o.call('POST', '/api/sales/bookings', { unit_id: a301, customer_name: 'zz one', token_paise: 100000 })).data.id;
const b2 = (await o.call('POST', '/api/sales/bookings', { unit_id: a801, customer_name: 'zz two', agreed_price_paise: 9500000, discount_reason: 'launch offer approved', token_paise: 100000 })).data.id;
await o.call('POST', `/api/sales/bookings/${b2}/registration`, { agreement_date: '2026-11-01', registration_date: '2026-11-15' });

const st = (await sales.call('GET', `/api/reports/stacking?project_id=${pid}`)).data;
const state = (id) => st.units.find((u) => u.id === id).state;
ok('stacking: available/booked/registered/token-locked/rehab all present', state(a302) === 'available' && state(a301) === 'booked' && state(a801) === 'registered' && state(a802) === 'token_locked' && state(rehab) === 'rehab', JSON.stringify(st.counts));
ok('stacking counts and rate per sq ft', st.counts.available === 1 && st.units.find((u) => u.id === a301).rate_sqft_paise === 20000);
ok('token-locked unit shows holder and expiry', !!st.units.find((u) => u.id === a802).holder && !!st.units.find((u) => u.id === a802).blocked_till);
const stSite = await site.call('GET', `/api/reports/stacking?project_id=${pid}`);
ok('site cannot open the stacking plan', stSite.status === 403);

// receipts: 1 designated (70%) + 1 other so escrow routing is visible
const d1 = (await o.call('GET', `/api/sales/bookings/${b1}`)).data.demands[0];
await acc.call('POST', `/api/sales/bookings/${b1}/receipts`, { amount_paise: 600000, demand_id: d1.id, ref_no: 'E1' + run });
await acc.call('POST', `/api/sales/bookings/${b1}/receipts`, { amount_paise: 400000, demand_id: d1.id, ref_no: 'E2' + run, account: 'project_other' });
const cf = (await acc.call('GET', `/api/reports/cashflow?project_id=${pid}`)).data;
ok('escrow: 60% routed to designated account is flagged non-compliant', cf.escrow.designated_pct === 60 && cf.escrow.compliant === false && cf.escrow.shortfall_paise === 100000, JSON.stringify(cf.escrow));
ok('cash flow has this month collected', cf.months.some((m) => m.collected === 1000000));
ok('sales cannot read cash flow', (await sales.call('GET', `/api/reports/cashflow?project_id=${pid}`)).status === 403);

// aging: mark the milestone done 100 days ago -> demand due 93 days ago
await o.call('POST', '/api/site/milestones', { project_id: pid, name: 'Plinth', milestone_key: 'k' + run });
const ms = (await o.call('GET', `/api/site/milestones?project_id=${pid}`)).data.milestones.find((m) => m.milestone_key === 'k' + run);
await o.call('POST', `/api/site/milestones/${ms.id}/done`, { actual_date: new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10), cert_ref: 'ARCH/1 test', override_note: 'test project has no CC recorded' });
const ag = (await o.call('GET', `/api/reports/aging?project_id=${pid}`)).data;
ok('aging puts the old demand in 90+ days', ag.buckets[4].count >= 1 && ag.top.some((t) => t.days > 90), JSON.stringify(ag.buckets));
ok('future milestone money reported as scheduled', ag.scheduled_count >= 1);

// marketing
await o.call('POST', '/api/marketing/spend', { source: 'meta', month: new Date().toISOString().slice(0, 7), amount_paise: 1000000, project_id: pid });
ok('sales cannot enter spend', (await sales.call('POST', '/api/marketing/spend', { source: 'meta', month: '2026-01', amount_paise: 5 })).status === 403);
const mk2 = (await o.call('GET', `/api/reports/marketing?project_id=${pid}`)).data;
const meta = mk2.sources.find((s) => s.source === 'meta');
ok('marketing: spend and cost per lead for a source', meta && meta.spend_paise === 1000000 && meta.cost_per_lead_paise === 1000000 / meta.leads, JSON.stringify(meta));

// velocity + leakage
const vel = (await o.call('GET', `/api/reports/velocity?project_id=${pid}`)).data;
const t3 = vel.by_type.find((t) => t.key === '3BHK');
ok('absorption by configuration', t3.total === 2 && t3.sold === 1 && t3.absorption_pct === 50, JSON.stringify(t3));
ok('realisation below 100% shows leakage', t3.realisation_pct === 95);
ok('floor band absorption', vel.by_floor.some((f) => f.key === 'Floors 6–10' && f.sold === 1));
ok('discount list flags the 5% deal over the sales limit', vel.leakage.length === 1 && vel.leakage[0].discount_bp === 500 && vel.leakage[0].over_limit === true && vel.leakage[0].unapproved === false);
ok('site cannot read velocity', (await site.call('GET', `/api/reports/velocity?project_id=${pid}`)).status === 403);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
