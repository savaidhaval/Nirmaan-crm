// tests/stores.mjs — WP-8: stock ledger. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp8 ' + run, code: 'W8' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-wp8b ' + run, code: 'V8' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []);
const stock = async (who, project, itemId) => ((await who.call('GET', `/api/stores/stock?project_id=${project}`)).data.stock.find((s) => s.item_id === itemId) || {}).qty;

// ---------- items ----------
ok('site cannot add an item', (await site.call('POST', '/api/stores/items', { name: 'x', unit: 'u' })).status === 403);
ok('sales cannot see stores', (await sales.call('GET', `/api/stores/stock?project_id=${pid}`)).status === 403);
ok('item needs a name', (await pur.call('POST', '/api/stores/items', { name: ' ' })).status === 400);
const cem = (await pur.call('POST', '/api/stores/items', { name: 'Cement ' + run, unit: 'bags', category: 'civil' })).data.id;
ok('duplicate item refused', (await pur.call('POST', '/api/stores/items', { name: 'Cement ' + run, unit: 'bags' })).status === 409);
ok('site can read items', (await site.call('GET', '/api/stores/items')).data.items.some((i) => i.id === cem));

// ---------- GRN puts stock in the store ----------
const v1 = (await o.call('POST', '/api/procurement/vendors', { name: 'zz v ' + run })).data.id;
ok('PO with an unknown stock item refused', (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, stock_item_id: 99999999, items: [{ description: 'Cement', qty: 100, unit: 'bags', rate_paise: 40000 }] })).status === 400);
const po = (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, stock_item_id: cem, items: [{ description: 'Cement', qty: 100, unit: 'bags', rate_paise: 40000 }] })).data;
await pur.call('POST', `/api/procurement/pos/${po.id}/submit`, {}); await o.call('POST', `/api/procurement/pos/${po.id}/approve`, {});
const pl = (await site.call('GET', `/api/procurement/pos/${po.id}/lines`)).data.items[0];
ok('stock starts at 0', (await stock(site, pid, cem)) === 0);
const gu = 'grn-' + run;
ok('GRN of 100 bags', (await site.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), client_uuid: gu, lines: [{ po_item_id: pl.id, qty_received: 100 }] })).status === 200);
ok('store shows 100 bags', (await stock(site, pid, cem)) === 100);
await site.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'CH' + Math.random().toString(36).slice(2, 10), client_uuid: gu, lines: [{ po_item_id: pl.id, qty_received: 100 }] });
ok('GRN retry does not double the stock', (await stock(site, pid, cem)) === 100);

// ---------- issue ----------
const iu = 'iss-' + run;
const i1 = await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 30, where_used: 'Slab 3', client_uuid: iu });
ok('issue 30 -> 70 left', i1.status === 200 && i1.data.on_hand === 70, JSON.stringify(i1));
ok('issue retry (offline) does not issue twice', (await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 30, client_uuid: iu })).data.duplicate === true && (await stock(site, pid, cem)) === 70);
const big = await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 100 });
ok('cannot issue more than is in store (plain message)', big.status === 400 && /Only 70/.test(big.err), big.err);
ok('refused issue changed nothing', (await stock(site, pid, cem)) === 70);
const [r1, r2] = await Promise.all([site.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 50 }), site.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 50 })]);
ok('two simultaneous issues of 50 from 70: exactly one wins', [r1.status, r2.status].sort().join() === '200,400' && (await stock(site, pid, cem)) === 20, `${r1.status},${r2.status} ${await stock(site, pid, cem)}`);
ok('accounts cannot issue', (await acc.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 1 })).status === 403);
ok('site cannot issue from another project', (await site.call('POST', '/api/stores/issue', { project_id: pid2, item_id: cem, qty: 1 })).status === 403);
ok('quantity must be positive', (await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: cem, qty: 0 })).status === 400);
await pm.call('POST', '/api/stores/adjust', { project_id: pid, item_id: cem, qty: 30, reason: 'opening count', client_uuid: 'op-' + run }).then(async (a) => pur.call('POST', `/api/stores/moves/${a.data.id}/approve`, {}));
ok('purchase cannot approve adjustments', (await stock(site, pid, cem)) === 20);
const pa = (await pm.call('GET', `/api/stores/moves?project_id=${pid}&status=pending`)).data.moves[0];
ok('PM cannot approve own adjustment', (await pm.call('POST', `/api/stores/moves/${pa.id}/approve`, {})).status === 403);
ok('owner approves it: 50 in store', (await o.call('POST', `/api/stores/moves/${pa.id}/approve`, {})).status === 200 && (await stock(site, pid, cem)) === 50);

// ---------- reorder level and the low-stock reminder ----------
ok('site cannot set reorder level', (await site.call('POST', '/api/stores/reorder', { project_id: pid, item_id: cem, reorder_level: 60 })).status === 403);
ok('purchase sets reorder level 60', (await pur.call('POST', '/api/stores/reorder', { project_id: pid, item_id: cem, reorder_level: 60 })).status === 200);
ok('store shows the item as low', (await site.call('GET', `/api/stores/stock?project_id=${pid}`)).data.stock.find((s) => s.item_id === cem).low === true);
const tick = await fetch(BASE + '/__scheduled?cron=30+*+*+*+*');
if (tick.status === 200) {
  await new Promise((r) => setTimeout(r, 1500));
  const n = JSON.stringify((await pm.call('GET', '/api/notifications')).data);
  ok('hourly sweep tells the PM about low stock', n.includes('Low stock: Cement'), n.slice(0, 200));
  await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 1200));
  ok('only one reminder per day', JSON.stringify((await pm.call('GET', '/api/notifications')).data).split('Low stock: Cement ' + run).length === 2);
} else console.log('SKIP  sweep test (dev server started without --test-scheduled)');

// ---------- transfer ----------
ok('site cannot send to a project it is not on', (await site.call('POST', '/api/stores/transfer', { project_id: pid, to_project_id: pid2, item_id: cem, qty: 5 })).status === 403);
const tr = await pm.call('POST', '/api/stores/transfer', { project_id: pid, to_project_id: pid2, item_id: cem, qty: 20, note: 'for tower B' });
ok('transfer 20 bags: 30 here, 20 there', tr.status === 200 && (await stock(pm, pid, cem)) === 30 && (await stock(pm, pid2, cem)) === 20, JSON.stringify(tr));
const trBig = await pm.call('POST', '/api/stores/transfer', { project_id: pid, to_project_id: pid2, item_id: cem, qty: 31 });
ok('transfer of more than held is refused and moves nothing', trBig.status === 400 && (await stock(pm, pid, cem)) === 30 && (await stock(pm, pid2, cem)) === 20);
ok('cannot transfer to the same project', (await pm.call('POST', '/api/stores/transfer', { project_id: pid, to_project_id: pid, item_id: cem, qty: 1 })).status === 400);

// ---------- adjustments ----------
ok('adjustment needs a reason', (await site.call('POST', '/api/stores/adjust', { project_id: pid, item_id: cem, qty: -5 })).status === 400);
const adj = await site.call('POST', '/api/stores/adjust', { project_id: pid, item_id: cem, qty: -5, reason: 'bags torn' });
ok('adjustment waits for approval: balance unchanged', adj.status === 200 && (await stock(site, pid, cem)) === 30);
ok('site cannot approve', (await site.call('POST', `/api/stores/moves/${adj.data.id}/approve`, {})).status === 403);
ok('PM approves: 25 left', (await pm.call('POST', `/api/stores/moves/${adj.data.id}/approve`, {})).status === 200 && (await stock(site, pid, cem)) === 25);
ok('cannot decide twice', (await pm.call('POST', `/api/stores/moves/${adj.data.id}/approve`, {})).status === 409);
const adj2 = await site.call('POST', '/api/stores/adjust', { project_id: pid, item_id: cem, qty: -500, reason: 'typo' });
ok('adjustment that would go below zero cannot be approved', (await pm.call('POST', `/api/stores/moves/${adj2.data.id}/approve`, {})).status === 400);
ok('rejecting leaves stock alone', (await pm.call('POST', `/api/stores/moves/${adj2.data.id}/reject`, {})).status === 200 && (await stock(site, pid, cem)) === 25);

// ---------- log and reports ----------
const mv = (await acc.call('GET', `/api/stores/moves?project_id=${pid}`)).data.moves;
const kinds = new Set(mv.map((m) => m.kind));
ok('moves log shows receipt, issue, transfer and adjust', ['receipt', 'issue', 'transfer_out', 'adjust'].every((k) => kinds.has(k)), [...kinds].join());
const csv = await acc.call('GET', `/api/stores/stock?project_id=${pid}&csv=1`, null, true); const t1 = await csv.text();
ok('stock CSV', csv.status === 200 && t1.includes('On hand') && t1.includes('Cement'));
const csv2 = await acc.call('GET', `/api/stores/moves?project_id=${pid}&csv=1`, null, true);
ok('moves CSV', csv2.status === 200 && (await csv2.text()).includes('issue'));
ok('requests without the header are refused', (await fetch(BASE + '/api/stores/issue', { method: 'POST', headers: { cookie: site.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
