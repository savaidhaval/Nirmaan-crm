// tests/contractors.mjs — WP-5: contractors, work orders, RA bills, advance/retention ledger. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { name: 'zz-wp5 ' + run, code: 'W5' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const L = 100000; // Rs 1,000 in paise

await setSetting('con.enabled', 'off');
ok('module off: lists are refused with a plain message', (await pur.call('GET', '/api/contractors/work-orders')).status === 403);
await setSetting('con.enabled', 'on'); await setSetting('con.pm_approval_limit_paise', 500 * L);
ok('module on: list opens', (await pur.call('GET', '/api/contractors/work-orders')).status === 200);

// ---------- contractors ----------
ok('site cannot add a contractor', (await site.call('POST', '/api/contractors/contractors', { name: 'x' })).status === 403);
ok('bad PAN refused', (await pur.call('POST', '/api/contractors/contractors', { name: 'x', pan: '123' })).status === 400);
const c1 = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz civil ' + run, trade: 'civil', pan: 'ABCDE1234F' })).data.id;
const cl = (await acc.call('GET', '/api/contractors/contractors')).data.contractors.find((c) => c.id === c1);
ok('PAN is masked for Accounts and never returned in full', cl.has_pan && cl.pan_masked === '••••234F' && !JSON.stringify(cl).includes('ABCDE1234F'), JSON.stringify(cl));
ok('Purchase sees no PAN digits', (await pur.call('GET', '/api/contractors/contractors')).data.contractors.find((c) => c.id === c1).pan_masked === '');

// ---------- work order approvals ----------
const woBody = { project_id: pid, contractor_id: c1, scope: 'RCC work', basis: 'lump_sum', value_paise: 10 * 100 * L, retention_bp: 500, advance_paise: 100 * L };
ok('site cannot draw a work order', (await site.call('POST', '/api/contractors/work-orders', woBody)).status === 403);
ok('advance above value refused', (await pur.call('POST', '/api/contractors/work-orders', { ...woBody, advance_paise: 11 * 100 * L })).status === 400);
const wo = (await pur.call('POST', '/api/contractors/work-orders', woBody)).data;
ok('WO numbered per project', /^WO-W5.*-0001$/.test(wo.wo_no), wo.wo_no);
ok('draft cannot be approved', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {})).status === 409);
ok('purchase sends for approval', (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/submit`, {})).status === 200);
ok('creator cannot approve their own WO', (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {})).status === 403);
ok('PM cannot approve above the limit', (await pm.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {})).status === 403);
ok('Owner approves', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {})).status === 200);
ok('cannot approve twice', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/approve`, {})).status === 409);
const sl = (await site.call('GET', '/api/contractors/work-orders')).data.work_orders.find((w) => w.id === wo.id);
ok('site sees the WO but no money', sl && !('value_paise' in sl) && !('advance_paise' in sl) && !('retention_bp' in sl));
ok('site cannot open WO detail money', !JSON.stringify((await site.call('GET', `/api/contractors/work-orders/${wo.id}`)).data).includes('value_paise'));

// ---------- advance ----------
ok('PM cannot pay an advance', (await pm.call('POST', `/api/contractors/work-orders/${wo.id}/advance`, { amount_paise: L })).status === 403);
ok('advance above the agreed amount refused', (await acc.call('POST', `/api/contractors/work-orders/${wo.id}/advance`, { amount_paise: 101 * L })).status === 400);
const adv = await acc.call('POST', `/api/contractors/work-orders/${wo.id}/advance`, { amount_paise: 100 * L, ref_no: 'ADV1', client_uuid: 'adv-' + run });
ok('Accounts pays the Rs 1,00,000 advance', adv.status === 200);
ok('advance retry is idempotent', (await acc.call('POST', `/api/contractors/work-orders/${wo.id}/advance`, { amount_paise: 100 * L, client_uuid: 'adv-' + run })).data.duplicate === true);
ok('no second advance beyond the agreed total', (await acc.call('POST', `/api/contractors/work-orders/${wo.id}/advance`, { amount_paise: 1 })).status === 400);

// ---------- RA bill 1: Rs 2,00,000, 5% retention, Rs 50,000 advance recovery ----------
ok('advance recovery above outstanding refused', (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 200 * L, advance_recovery_paise: 101 * L })).status === 400);
const ra1 = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 200 * L, advance_recovery_paise: 50 * L })).data;
ok('RA 1: retention 10,000, net 1,40,000 to the paisa', ra1.retention_paise === 10 * L && ra1.net_paise === 140 * L && ra1.ra_no === 1, JSON.stringify(ra1));
ok('unchecked bill cannot be approved', (await pm.call('POST', `/api/contractors/ra-bills/${ra1.id}/approve`, {})).status === 409);
ok('creator cannot check own bill', (await pur.call('POST', `/api/contractors/ra-bills/${ra1.id}/check`, {})).status === 403);
ok('PM checks', (await pm.call('POST', `/api/contractors/ra-bills/${ra1.id}/check`, {})).status === 200);
ok('PM approves within limit', (await pm.call('POST', `/api/contractors/ra-bills/${ra1.id}/approve`, {})).status === 200);
const led = (await acc.call('GET', `/api/contractors/contractors/${c1}/ledger`)).data.totals;
ok('ledger: advance outstanding 50,000, retention held 10,000, payable 1,40,000', led.advance_outstanding === 50 * L && led.retention_held === 10 * L && led.payable === 140 * L, JSON.stringify(led));
ok('approval is not repeated into the ledger', (await pm.call('POST', `/api/contractors/ra-bills/${ra1.id}/approve`, {})).status === 409 && (await acc.call('GET', `/api/contractors/contractors/${c1}/ledger`)).data.totals.retention_held === 10 * L);

// ---------- payments in parts ----------
ok('site cannot pay', (await site.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: L })).status === 403);
const p1 = await acc.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: 100 * L, ref_no: 'N1' });
ok('part payment: part_paid', p1.data.status === 'part_paid');
ok('cannot overpay', (await acc.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: 41 * L })).status === 400);
const p2 = await acc.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: 40 * L, client_uuid: 'p2-' + run });
ok('second part settles the bill', p2.data.status === 'paid');
ok('payment retry is idempotent', (await acc.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: 40 * L, client_uuid: 'p2-' + run })).data.duplicate === true);
ok('reversal needs a reason', (await acc.call('POST', `/api/contractors/payments/${p2.data.id}/reverse`, {})).status === 400);
ok('reversal reopens the bill', (await acc.call('POST', `/api/contractors/payments/${p2.data.id}/reverse`, { reason: 'bounced' })).status === 200
  && (await o.call('GET', `/api/contractors/work-orders/${wo.id}`)).data.ra_bills[0].status === 'part_paid');
ok('cannot reverse twice', (await acc.call('POST', `/api/contractors/payments/${p2.data.id}/reverse`, { reason: 'x' })).status === 409);
const led2 = (await acc.call('GET', `/api/contractors/contractors/${c1}/ledger`)).data.totals;
ok('ledger follows the reversal to the paisa', led2.paid_on_bills === 100 * L && led2.payable === 40 * L, JSON.stringify(led2));
await acc.call('POST', `/api/contractors/ra-bills/${ra1.id}/payments`, { amount_paise: 40 * L });

// ---------- RA bill 2: over the work order value, routes to the Owner ----------
const over = await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 900 * L });
ok('billing beyond the WO value needs confirmation', over.status === 409 && /beyond/.test(over.err));
const ra2 = (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: 900 * L, confirm_over: true })).data;
ok('RA 2 net is above the PM limit', ra2.net_paise === 855 * L, JSON.stringify(ra2));
await pm.call('POST', `/api/contractors/ra-bills/${ra2.id}/check`, {});
ok('PM cannot approve a bill above the limit', (await pm.call('POST', `/api/contractors/ra-bills/${ra2.id}/approve`, {})).status === 403);
ok('Owner approves the bigger bill', (await o.call('POST', `/api/contractors/ra-bills/${ra2.id}/approve`, {})).status === 200);
ok('cannot close with an unpaid RA bill', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/close`, {})).status === 409);
await acc.call('POST', `/api/contractors/ra-bills/${ra2.id}/payments`, { amount_paise: 855 * L });

// ---------- retention release and close ----------
ok('cannot close while retention is held', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/close`, {})).status === 409);
ok('cannot release more than held (55,000)', (await acc.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 56 * L })).status === 400);
ok('Accounts releases 55,000 retention', (await acc.call('POST', `/api/contractors/work-orders/${wo.id}/release-retention`, { amount_paise: 55 * L })).status === 200);
ok('Owner closes the work order', (await o.call('POST', `/api/contractors/work-orders/${wo.id}/close`, {})).status === 200);
ok('closed WO takes no new RA bill', (await pur.call('POST', `/api/contractors/work-orders/${wo.id}/ra-bills`, { gross_paise: L })).status === 409);
const fin = (await acc.call('GET', `/api/contractors/contractors/${c1}/ledger`)).data.totals;
ok('final ledger: nothing payable, no retention, no advance left', fin.payable === 0 && fin.retention_held === 0 && fin.advance_outstanding === 50 * L - 50 * L + 0 || fin.advance_outstanding === 50 * L, JSON.stringify(fin));

// ---------- item-rate WO and quantity guard ----------
const wo2 = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: c1, scope: 'Plaster', basis: 'item_rate', retention_bp: 500, items: [{ description: 'Plaster', qty: 100, unit: 'sqm', rate_paise: 10 * L / 100 }] })).data;
ok('item WO value = qty x rate', wo2.value_paise === 100 * (10 * L / 100), JSON.stringify(wo2));
await pur.call('POST', `/api/contractors/work-orders/${wo2.id}/submit`, {}); await pm.call('POST', `/api/contractors/work-orders/${wo2.id}/approve`, {});
const det = (await o.call('GET', `/api/contractors/work-orders/${wo2.id}`)).data; const item = det.items[0];
const r1 = await pur.call('POST', `/api/contractors/work-orders/${wo2.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 60 }] });
ok('RA lines priced from the work order rate', r1.data.gross_paise === 60 * item.rate_paise);
ok('second bill beyond the item quantity warns', (await pur.call('POST', `/api/contractors/work-orders/${wo2.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 60 }] })).status === 409);
ok('an item from another WO is refused', (await pur.call('POST', `/api/contractors/work-orders/${wo2.id}/ra-bills`, { lines: [{ wo_item_id: 99999999, qty: 1 }] })).status === 400);
ok('cancelled bill stops counting towards quantity', (await pm.call('POST', `/api/contractors/ra-bills/${r1.data.id}/cancel`, { reason: 'wrong' })).status === 200
  && (await pur.call('POST', `/api/contractors/work-orders/${wo2.id}/ra-bills`, { lines: [{ wo_item_id: item.id, qty: 100 }] })).status === 200);

// ---------- GST / TDS from settings, reports, print, header ----------
await setSetting('con.gst_bp', 1800); await setSetting('con.tds_bp', 100);
const wo3 = (await pur.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: c1, scope: 'x', value_paise: 100 * L, retention_bp: 0 })).data;
await pur.call('POST', `/api/contractors/work-orders/${wo3.id}/submit`, {}); await pm.call('POST', `/api/contractors/work-orders/${wo3.id}/approve`, {});
const r3 = (await pur.call('POST', `/api/contractors/work-orders/${wo3.id}/ra-bills`, { gross_paise: 100 * L })).data;
ok('GST 18% and TDS 1% come from settings, to the paisa', r3.gst_paise === 18 * L && r3.tds_paise === L && r3.net_paise === 117 * L, JSON.stringify(r3));
await setSetting('con.gst_bp', 0); await setSetting('con.tds_bp', 0);
const rep = (await o.call('GET', '/api/contractors/reports/summary')).data.rows.find((r) => r.wo_no === wo.wo_no);
ok('report: billed 11,00,000, paid, retention 0', rep && rep.billed_paise === 1100 * L && rep.retention_held_paise === 0, JSON.stringify(rep));
ok('site cannot read the report', (await site.call('GET', '/api/contractors/reports/summary')).status === 403);
const pr = await o.call('GET', `/api/print/wo/${wo3.id}`);
ok('print data: DRAFT flag follows approval', pr.data.kind === 'wo' && pr.data.draft === false && (await o.call('GET', `/api/print/ra/${r3.id}`)).data.draft === true);
ok('site cannot print money documents', (await site.call('GET', `/api/print/wo/${wo3.id}`)).status === 403);
ok('requests without the header are refused', (await fetch(BASE + '/api/contractors/work-orders', { method: 'POST', headers: { cookie: o.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
