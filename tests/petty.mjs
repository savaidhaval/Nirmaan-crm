// tests/petty.mjs — WP-10: site petty cash. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp10 ' + run, code: 'W10' + run.toUpperCase().slice(-5), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const site2 = await mkUser('site', [pid]); const pm = await mkUser('pm', []); const acc = await mkUser('accounts', []); const pur = await mkUser('purchase', []); const sales = await mkUser('sales', []);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const R = 100; // Rs 1 in paise
await setSetting('petty.low_balance_paise', 1000 * R);

// ---------- funds ----------
ok('site cannot open a fund', (await site.call('POST', '/api/petty/funds', { project_id: pid, custodian_user_id: site.id, opening_paise: 100 })).status === 403);
ok('fund needs a real custodian', (await acc.call('POST', '/api/petty/funds', { project_id: pid, custodian_user_id: 99999999, opening_paise: 100 })).status === 400);
const fund = (await acc.call('POST', '/api/petty/funds', { project_id: pid, custodian_user_id: site.id, opening_paise: 5000 * R })).data.id;
const bal = async (who) => ((await who.call('GET', '/api/petty/funds')).data.funds.find((f) => f.id === fund) || {});
ok('Accounts opens a Rs 5,000 fund for the site engineer', (await bal(site)).balance_paise === 5000 * R);
ok('another site engineer cannot see the fund', !(await bal(site2)).id && (await site2.call('GET', `/api/petty/funds/${fund}`)).status === 403);
ok('purchase and sales have no petty cash access', (await pur.call('GET', '/api/petty/funds')).status === 403 && (await sales.call('GET', '/api/petty/funds')).status === 403);
ok('PM and Accounts can see it', (await bal(pm)).id === fund && (await bal(acc)).id === fund);

// ---------- top-up ----------
ok('site cannot add cash to the fund', (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'top_up', amount_paise: 100 * R })).status === 403);
const tu = await acc.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'top_up', amount_paise: 3000 * R, narration: 'cash from office' });
ok('Accounts tops up Rs 3,000: counts at once', tu.status === 200 && tu.data.status === 'approved' && (await bal(site)).balance_paise === 8000 * R);

// ---------- expenses ----------
ok('expense needs an amount', (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea', amount_paise: 0 })).status === 400);
ok('expense needs to say what for', (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', amount_paise: 100 })).status === 400);
ok('another site engineer cannot spend from this fund', (await site2.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea', amount_paise: 100 })).status === 403);
const eu = 'exp-' + run;
const e1 = await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea & snacks', amount_paise: 600 * R, narration: 'labour tea', client_uuid: eu });
ok('site records an expense: waits for approval, balance unchanged', e1.status === 200 && e1.data.status === 'submitted' && (await bal(site)).balance_paise === 8000 * R && (await bal(site)).pending_paise === 600 * R);
ok('offline retry creates no second expense', (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Tea & snacks', amount_paise: 600 * R, client_uuid: eu })).data.duplicate === true && (await bal(site)).pending_paise === 600 * R);
ok('PM sees it in the approval list, site does not get the list', (await pm.call('GET', '/api/petty/pending')).data.entries.some((x) => x.id === e1.data.id) && (await site.call('GET', '/api/petty/pending')).status === 403);
ok('site cannot approve their own expense', (await site.call('POST', `/api/petty/entries/${e1.data.id}/approve`, {})).status === 403);
ok('accounts cannot approve', (await acc.call('POST', `/api/petty/entries/${e1.data.id}/approve`, {})).status === 403);
const ap = await pm.call('POST', `/api/petty/entries/${e1.data.id}/approve`, {});
ok('PM approves: balance drops to Rs 7,400', ap.status === 200 && (await bal(site)).balance_paise === 7400 * R && (await bal(site)).pending_paise === 0);
ok('cannot approve twice', (await pm.call('POST', `/api/petty/entries/${e1.data.id}/approve`, {})).status === 409);

// ---------- reject, cancel ----------
const e2 = (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Stationery', amount_paise: 900 * R })).data.id;
ok('rejection needs a reason', (await pm.call('POST', `/api/petty/entries/${e2}/reject`, {})).status === 400);
ok('rejected entry does not change the balance', (await pm.call('POST', `/api/petty/entries/${e2}/reject`, { note: 'no bill' })).status === 200 && (await bal(site)).balance_paise === 7400 * R);
const e3 = (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Transport', amount_paise: 100 * R })).data.id;
ok('creator can cancel a waiting entry (with a reason)', (await site.call('POST', `/api/petty/entries/${e3}/cancel`, {})).status === 400 && (await site.call('POST', `/api/petty/entries/${e3}/cancel`, { reason: 'duplicate' })).status === 200);
ok('cancelled entry is not in the approval list and cannot be approved', !(await pm.call('GET', '/api/petty/pending')).data.entries.some((x) => x.id === e3) && (await pm.call('POST', `/api/petty/entries/${e3}/approve`, {})).status === 409);
ok('accounts cannot cancel an approved entry', (await acc.call('POST', `/api/petty/entries/${e1.data.id}/cancel`, { reason: 'x' })).status === 403);

// ---------- PM-entered expense needs another approver; low balance ----------
const e4 = (await pm.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Repairs', amount_paise: 6500 * R })).data.id;
ok('PM cannot approve an entry they made', (await pm.call('POST', `/api/petty/entries/${e4}/approve`, {})).status === 403);
const ap4 = await o.call('POST', `/api/petty/entries/${e4}/approve`, {});
ok('Owner approves it: balance Rs 900 is below the Rs 1,000 limit', ap4.status === 200 && ap4.data.low_balance === true && (await bal(site)).balance_paise === 900 * R, JSON.stringify(ap4));
const nn = async (who) => JSON.stringify((await who.call('GET', '/api/notifications')).data);
ok('custodian and Accounts are told the fund is low', (await nn(site)).includes('Petty cash running low') && (await nn(acc)).includes('Petty cash running low'));
const e5 = (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'expense', category: 'Misc', amount_paise: 100 * R })).data.id; await pm.call('POST', `/api/petty/entries/${e5}/approve`, {});
ok('low-balance warning is not repeated the same day', (await nn(site)).split('Petty cash running low').length === 2);
ok('Owner can cancel an approved entry with a reason: balance comes back', (await o.call('POST', `/api/petty/entries/${e5}/cancel`, { reason: 'entered twice' })).status === 200 && (await bal(site)).balance_paise === 900 * R);

// ---------- returns, statement ----------
const rt = (await site.call('POST', '/api/petty/entries', { fund_id: fund, kind: 'return', amount_paise: 400 * R, narration: 'returned to office' })).data.id;
await pm.call('POST', `/api/petty/entries/${rt}/approve`, {});
ok('cash returned to the office reduces the fund', (await bal(site)).balance_paise === 500 * R);
const st = (await acc.call('GET', `/api/petty/funds/${fund}`)).data;
ok('statement lists every entry, with status', st.entries.length >= 7 && st.entries.some((e) => e.status === 'rejected') && st.entries.some((e) => e.status === 'cancelled'));
ok('category totals count approved expenses only', st.categories.find((c) => c.category === 'Tea & snacks').total === 600 * R && st.categories.find((c) => c.category === 'Repairs').total === 6500 * R && !st.categories.some((c) => c.category === 'Stationery'), JSON.stringify(st.categories));
const csv = await acc.call('GET', `/api/petty/funds/${fund}?csv=1`, null, true); const txt = await csv.text();
ok('statement CSV', csv.status === 200 && txt.includes('Tea & snacks') && txt.includes('Balance'));
ok('photos can be attached to an entry (attachments list)', (await site.call('GET', `/api/attachments?entity=pty_entries&entity_id=${e1.data.id}`)).status === 200);
ok('requests without the header are refused', (await fetch(BASE + '/api/petty/entries', { method: 'POST', headers: { cookie: site.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
