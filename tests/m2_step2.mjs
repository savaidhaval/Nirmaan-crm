// tests/m2_step2.mjs — Module 2 gaps, step 2: token proof on holds, reception check-in + buyer confirmation + source lock, CC-floor lock, WhatsApp texts, site updates.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role) => { const email = `m2b-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm2b ' + role, email, role, projects: [] }); const pw = 'M2StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-m2b ' + run, code: 'MB' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm'); const acc = await mkUser('accounts'); const sales = await mkUser('sales'); const sales2 = await mkUser('sales');
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'All', pct_bp: 10000 }] });
let n = 0;
const mkUnit = async (extra = {}) => (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'A', floor: 3, unit_no: 'T' + (++n) + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000, ...extra })).data.id;
const phone = () => '9' + String(Date.now() + (++n)).slice(-9);
const mkLead = async (who, nm, extra = {}) => (await who.call('POST', '/api/sales/leads', { name: nm + ' ' + run, phone: phone(), project_id: pid, consent: true, ...extra })).data.id;
const tok = () => ({ token_mode: 'upi', token_ref: 'UTR' + Math.random().toString(36).slice(2, 10), token_amount_paise: 500000 });

// ---------- Token holds ----------
const u1 = await mkUnit(); const l1 = await mkLead(sales, 'Tok');
const noTok = await sales.call('POST', `/api/sales/inventory/${u1}/hold`, { lead_id: l1 });
ok('a salesperson cannot block a flat without token details', noTok.status === 400 && noTok.code === 'token_proof', JSON.stringify(noTok));
ok('a short reference is refused', (await sales.call('POST', `/api/sales/inventory/${u1}/hold`, { lead_id: l1, token_mode: 'upi', token_ref: 'ab', token_amount_paise: 100 })).status === 400);
ok('with UTR and amount the flat is blocked', (await sales.call('POST', `/api/sales/inventory/${u1}/hold`, { lead_id: l1, ...tok() })).status === 200);
const lst = await acc.call('GET', '/api/sales/token-holds');
const t1 = lst.data.tokens.find((t) => t.unit_no.endsWith(run.slice(-3)) && t.lead_name === 'Tok ' + run);
ok('Accounts sees the token waiting', lst.status === 200 && !!t1, JSON.stringify(lst));
ok('Accounts was notified', JSON.stringify((await acc.call('GET', '/api/notifications')).data).includes('Token to clear'));
ok('sales cannot see or clear tokens', (await sales.call('GET', '/api/sales/token-holds')).status === 403 && (await sales.call('POST', `/api/sales/token-holds/${t1.id}/clear`, {})).status === 403);
const clr = await acc.call('POST', `/api/sales/token-holds/${t1.id}/clear`, {});
ok('Accounts clears the token and the hold is extended', clr.status === 200 && clr.data.blocked_till > new Date(Date.now() + 5 * 86400000).toISOString().replace('T', ' '), JSON.stringify(clr));
ok('a token cannot be cleared twice', (await acc.call('POST', `/api/sales/token-holds/${t1.id}/clear`, {})).status === 409);
const u2 = await mkUnit(); const l2 = await mkLead(sales, 'Tok2');
await sales.call('POST', `/api/sales/inventory/${u2}/hold`, { lead_id: l2, ...tok() });
const t2 = (await acc.call('GET', '/api/sales/token-holds')).data.tokens.find((t) => t.lead_name === 'Tok2 ' + run);
ok('rejecting needs a reason', (await acc.call('POST', `/api/sales/token-holds/${t2.id}/reject`, {})).status === 400);
ok('Accounts rejects a token that did not arrive', (await acc.call('POST', `/api/sales/token-holds/${t2.id}/reject`, { note: 'not in the bank' })).status === 200);
ok('the flat is back on sale', (await o.call('GET', `/api/sales/inventory?project_id=${pid}`)).data.inventory.find((u) => u.id === u2).status === 'available');
ok('the closer is told', JSON.stringify((await sales.call('GET', '/api/notifications')).data).includes('Token not accepted'));
ok('the closer cannot re-block it straight away', (await sales.call('POST', `/api/sales/inventory/${u2}/hold`, { lead_id: l2, ...tok() })).code === 'rehold');
const u3 = await mkUnit();
ok('the Owner can block without token details', (await o.call('POST', `/api/sales/inventory/${u3}/hold`, { lead_id: l2 })).status === 200);

// ---------- Reception check-in + source lock ----------
const part = (await o.call('POST', '/api/sales/partners', { firm: 'zz Brokers ' + run })).data.id;
const part2 = (await o.call('POST', '/api/sales/partners', { firm: 'zz Rivals ' + run })).data.id;
ok('sales can list partner names (not their money)', (await sales.call('GET', '/api/sales/partner-names')).data.partners.some((p) => p.id === part));
const ph = phone();
const ci = await sales.call('POST', '/api/sales/checkins', { project_id: pid, name: 'Mr Mehta ' + run, phone: ph, partner_id: part });
ok('reception creates a check-in with a one-time link', ci.status === 200 && /^\/c\/[\w-]{20,}$/.test(ci.data.link) && ci.data.partner_firm === 'zz Brokers ' + run, JSON.stringify(ci));
const tkn = ci.data.link.split('/')[2];
const g = await fetch(BASE + '/api/public/checkin/' + tkn).then((r) => r.json());
ok('the buyer page needs no login and shows the broker, not the buyer\'s details', g.data.state === 'pending' && g.data.firm === 'zz Brokers ' + run && !JSON.stringify(g).includes(ph), JSON.stringify(g));
const post = (body, t = tkn) => fetch(BASE + '/api/public/checkin/' + t, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NirmaanCRM': '1' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
ok('a wrong number is refused', (await post({ phone: '9000000001', answer: 'yes' })).status === 400);
ok('a made-up link is refused', (await post({ phone: ph, answer: 'yes' }, 'x'.repeat(32))).status === 404);
const yes = await post({ phone: '+91 ' + ph, answer: 'yes' });
ok('the buyer confirms with their own number', yes.status === 200 && yes.data.done === true, JSON.stringify(yes));
ok('the same link cannot be used twice', (await post({ phone: ph, answer: 'yes' })).status === 409);
const leads = (await o.call('GET', '/api/sales/leads')).data.leads; const lead = leads.find((l) => l.phone_norm === ph.slice(-10));
ok('the lead exists, belongs to the broker and is locked for 45 days', lead && lead.channel_partner_id === part && !!lead.source_confirmed_at && lead.source_locked_until > new Date(Date.now() + 19800000 + 40 * 86400000).toISOString().slice(0, 10), JSON.stringify(lead));
ok('the visit is recorded', (await o.call('GET', `/api/sales/leads/${lead.id}`)).data.visits.length === 1);
const ci2 = await sales2.call('POST', '/api/sales/checkins', { project_id: pid, name: 'Mr Mehta ' + run, phone: ph, partner_id: part2 });
ok('a rival broker claiming the same buyer is refused the claim', ci2.status === 200 && /earlier/.test(ci2.data.conflict || '') && ci2.data.partner_firm === 'zz Brokers ' + run, JSON.stringify(ci2.data));
// booking inherits the confirmed broker
const uB = await mkUnit();
const bk = await o.call('POST', '/api/sales/bookings', { unit_id: uB, lead_id: lead.id, customer_name: 'Mr Mehta', token_paise: 1000000 });
const bkd = (await o.call('GET', `/api/sales/bookings/${bk.data.id}`)).data; 
ok('the booking carries the confirmed broker with no warning', bk.status === 200 && bk.data.warning === null && (bkd.booking || bkd).channel_partner_id === part, JSON.stringify(bk));
// an unconfirmed broker is dropped with a warning
const lU = await mkLead(o, 'Unconfirmed', { channel_partner_id: part2 }); const uC = await mkUnit();
const bk2 = await o.call('POST', '/api/sales/bookings', { unit_id: uC, lead_id: lU, customer_name: 'Unconfirmed', token_paise: 1000000 });
ok('a broker the buyer never confirmed is left off, with a plain warning', bk2.status === 200 && /did not confirm/.test(bk2.data.warning || ''), JSON.stringify(bk2));
// buyer says "no" while a broker had registered them
const ph3 = phone(); await o.call('POST', '/api/sales/leads', { name: 'Alone ' + run, phone: ph3, project_id: pid, channel_partner_id: part2, consent: true });
const ci3 = await sales.call('POST', '/api/sales/checkins', { project_id: pid, name: 'Alone ' + run, phone: ph3, partner_id: part2 });
const no = await post({ phone: ph3, answer: 'no' }, ci3.data.link.split('/')[2]);
const l3 = (await o.call('GET', '/api/sales/leads')).data.leads.find((l) => l.phone_norm === ph3.slice(-10));
ok('"I came on my own" gives no lock and the Owner is told', no.status === 200 && !l3.source_confirmed_at && JSON.stringify((await o.call('GET', '/api/notifications')).data).includes('Broker claim disputed'), JSON.stringify(l3));
// expired link
const ci4 = await sales.call('POST', '/api/sales/checkins', { project_id: pid, name: 'Late ' + run, phone: phone() });
sql(`UPDATE sal_checkins SET expires_at = datetime('now', '-1 minutes') WHERE id = ${ci4.data.id}`);
ok('an expired link is refused', (await post({ phone: '1', answer: 'yes' }, ci4.data.link.split('/')[2])).status !== 200 && (await fetch(BASE + '/api/public/checkin/' + ci4.data.link.split('/')[2]).then((r) => r.json())).data.state === 'expired');
ok('today\'s list shows the check-ins', (await sales.call('GET', '/api/sales/checkins')).data.checkins.length >= 3);

// ---------- CC floor lock (on by default) ----------
const pidC = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-cc ' + run, code: 'CC' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, cc_upto_floor) VALUES (${pidC}, 'Commencement Certificate', 'cc', 'approved', 5)`);
const hi = (await o.call('POST', '/api/sales/inventory', { project_id: pidC, wing: 'A', floor: 9, unit_no: 'H9' + run.slice(-3), rera_carpet_sqft: 500, price_paise: 100000000 })).data.id;
const lo = (await o.call('POST', '/api/sales/inventory', { project_id: pidC, wing: 'A', floor: 4, unit_no: 'L4' + run.slice(-3), rera_carpet_sqft: 500, price_paise: 100000000 })).data.id;
const stk = (await o.call('GET', `/api/reports/stacking?project_id=${pidC}`)).data.units;
ok('a floor above the approved CC shows as not open yet', stk.find((u) => u.id === hi).state === 'not_open' && stk.find((u) => u.id === lo).state === 'available');
ok('and cannot be booked or priced', (await o.call('POST', '/api/sales/bookings', { unit_id: hi, customer_name: 'zz', token_paise: 1000 })).code === 'cc_floor' && (await o.call('POST', '/api/sales/cost-sheets', { unit_id: hi, base_rate_paise_per_sqft: 200000 })).code === 'cc_floor');
ok('a floor under the CC is sold as normal', (await o.call('POST', '/api/sales/cost-sheets', { unit_id: lo, base_rate_paise_per_sqft: 200000 })).status === 200);
await o.call('POST', '/api/settings/sales.lock_above_cc', { value: 'off' });
ok('the lock can be switched off in Settings', (await o.call('POST', '/api/sales/cost-sheets', { unit_id: hi, base_rate_paise_per_sqft: 200000 })).status === 200);
await o.call('POST', '/api/settings/sales.lock_above_cc', { value: 'on' });

// ---------- WhatsApp texts ----------
const w = await o.call('GET', `/api/sales/leads/${lead.id}/welcome`);
ok('welcome pack text has the project, RERA number and no private data of others', w.status === 200 && /zz-m2b/.test(w.data.text) && /P518000TEST/.test(w.data.text), JSON.stringify(w));
await o.call('POST', '/api/settings/sales.brochure_url', { value: 'https://example.com/b.pdf' });
ok('the brochure link is added from Settings', /example\.com\/b\.pdf/.test((await o.call('GET', `/api/sales/leads/${lead.id}/welcome`)).data.text));
const lw = await mkLead(sales, 'Warm'); const lvis = (await sales.call('POST', `/api/sales/leads/${lw}/visit`, { visit_at: new Date().toISOString().slice(0, 16) })).data;
await sales.call('POST', `/api/sales/visits/${lvis.id}/status`, { status: 'done', interest: 'warm' });
ok('another closer cannot get the welcome text of a lead that is not theirs', (await sales2.call('GET', `/api/sales/leads/${lw}/welcome`)).status === 403);
sql(`INSERT INTO site_milestones (project_id, name, status, actual_date) VALUES (${pid}, 'Plinth complete', 'done', date('now'))`);
const re = await sales.call('GET', `/api/sales/reengage?project_id=${pid}`);
ok('site updates list the certified stage and the warm buyer who agreed to be contacted', re.status === 200 && re.data.milestones.some((m) => m.name === 'Plinth complete') && re.data.leads.some((l) => l.id === lw), JSON.stringify(re));

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
