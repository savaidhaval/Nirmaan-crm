// tests/m3_step3.mjs — Module 3 gaps, step 3: repeat a request in one tap, daily-report location, receipts waiting for a photo, usual wastage by material.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; }
  async call(m, p, b, form) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; let body = b; if (b && !form) { h['Content-Type'] = 'application/json'; body = JSON.stringify(b); }
    const r = await fetch(BASE + p, { method: m, headers: h, body, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await r.json(); } catch (e) { /* */ } return { status: r.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const run = Date.now().toString(36);
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
let seq = 0;
const mkUser = async (role, projects) => { const email = `m3c-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'm3c ' + role, email, role, projects }); const pw = 'M3StrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); c.id = r.data.id; return c; };
import { execSync } from 'node:child_process';
const persist = process.env.D1_PERSIST_TO ? `--persist-to ${process.env.D1_PERSIST_TO}` : '';
const sql = (cmd) => execSync(`npx wrangler d1 execute nirmaan-db --local ${persist} --command "${cmd}"`, { stdio: 'pipe' }).toString();
const num = (out, k) => Number((out.match(new RegExp('"' + k + '":\\s*(\\d+)')) || [])[1]);
const pid = (await o.call('POST', '/api/projects', { name: 'zz-m3c ' + run, code: 'MC' + run.toUpperCase().slice(-6), type: 'new_build' })).data.id;
const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const site = await mkUser('site', [pid]);
await o.call('POST', '/api/settings/con.enabled', { value: 'on' });

// ---------- repeat a request ----------
sql(`INSERT INTO apr_items (project_id, name, gate_key, status, cc_upto_floor) VALUES (${pid}, 'Commencement Certificate', 'cc', 'approved', 3)`);
const i1 = await site.call('POST', '/api/procurement/indents', { project_id: pid, wing: 'A', floor: 2, items: [{ description: 'Binding wire', qty: 50, unit: 'kg' }, { description: 'Cover blocks', qty: 500, unit: 'nos' }] });
const again = await site.call('POST', `/api/procurement/indents/${i1.data.id}/repeat`, { needed_by: '2030-01-01' });
ok('"Ask again" makes a new request with its own number', again.status === 200 && again.data.id !== i1.data.id && again.data.indent_no !== i1.data.indent_no, JSON.stringify(again));
const det = (await site.call('GET', `/api/procurement/indents/${again.data.id}`)).data;
ok('with the same items and quantities, and says where it came from', det.items.length === 2 && det.items[0].qty === 50 && /Same as/.test(det.indent.note), JSON.stringify(det.indent));
ok('another project\'s request cannot be repeated by someone without access', (await (await mkUser('site', [])).call('POST', `/api/procurement/indents/${i1.data.id}/repeat`, {})).status === 404);
const i9 = await site.call('POST', '/api/procurement/indents', { project_id: pid, wing: 'A', floor: 2, items: [{ description: 'Cement', qty: 10, unit: 'bags' }] });
sql(`UPDATE pro_indents SET floor = 9 WHERE id = ${i9.data.id}`);
const rep9 = await site.call('POST', `/api/procurement/indents/${i9.data.id}/repeat`, {});
ok('repeating a request for a floor above the approved CC is refused like a new one', rep9.status === 409 && rep9.code === 'cc', JSON.stringify(rep9));

// ---------- daily report location ----------
await o.call('POST', `/api/projects/${pid}/location`, { lat: 19.0176, lng: 72.8562 });
const dpr = (extra) => site.call('POST', '/api/site/dprs', { project_id: pid, report_date: new Date().toISOString().slice(0, 10), wing: 'A', work_summary: 'x', labour_count: 2, work: [{ wing: 'A', floor: 2, activity: 'Brickwork', qty: 5, unit: 'sqm' }], client_uuid: 'dpr3-' + run + Math.random(), ...extra });
const near = await dpr({ lat: 19.0178, lng: 72.8563, accuracy_m: 9 });
ok('a report filed at the site has no warning and keeps its distance', near.status === 200 && !near.data.warning && near.data.distance_m < 100, JSON.stringify(near));
const far = await dpr({ lat: 19.1, lng: 72.9 });
ok('a report filed from far away is saved with a plain warning, not refused', far.status === 200 && /m from the project location/.test(far.data.warning || ''), JSON.stringify(far));
ok('the location and distance are kept on the report', Number(num(sql(`SELECT distance_m AS d FROM site_dprs WHERE id = ${far.data.id}`), 'd')) > 5000);
ok('a report without a location is still accepted', (await dpr({})).status === 200);
ok('a nonsense location is refused', (await dpr({ lat: 200, lng: 10 })).status === 400);

// ---------- receipts waiting for a photo ----------
const v1 = (await o.call('POST', '/api/procurement/vendors', { name: 'zz v ' + run })).data.id;
const po = (await pur.call('POST', '/api/procurement/pos', { project_id: pid, vendor_id: v1, items: [{ description: 'RMC', qty: 20, unit: 'cum', rate_paise: 600000 }] })).data;
await pur.call('POST', `/api/procurement/pos/${po.id}/submit`, {}); await o.call('POST', `/api/procurement/pos/${po.id}/approve`, {});
const it = (await site.call('GET', `/api/procurement/pos/${po.id}/lines`)).data.items[0];
const g = await site.call('POST', `/api/procurement/pos/${po.id}/grn-lines`, { challan_no: 'C3-' + run, lines: [{ po_item_id: it.id, qty_received: 6 }] });
ok('the receipt without a photo is listed', (await site.call('GET', '/api/procurement/grns-without-photo')).data.receipts.some((r) => r.id === g.data.id && r.challan_no === 'C3-' + run));
const fd = new FormData(); fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'g.png'); fd.append('title', 'gate'); fd.append('category', 'other'); fd.append('module', 'procurement'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
const up = (await site.call('POST', '/api/files/upload', fd, true)).data;
ok('adding the photo takes it off the list', (await site.call('POST', `/api/procurement/grns/${g.data.id}/photo`, { document_id: up.id })).status === 200 && !(await site.call('GET', '/api/procurement/grns-without-photo')).data.receipts.some((r) => r.id === g.data.id));

// ---------- usual wastage by material ----------
const mkWo = async (name, wastage) => {
  const st = (await pur.call('POST', '/api/stores/items', { name: name + ' ' + run, unit: 'kg' })).data.id;
  const con = (await pur.call('POST', '/api/contractors/contractors', { name: 'zz con ' + name + run, trade: 'RCC' })).data.id;
  const w = (await o.call('POST', '/api/contractors/work-orders', { project_id: pid, contractor_id: con, scope: 'Slab', basis: 'item_rate', items: [{ description: 'Work ' + name, qty: 100, unit: 'cum', rate_paise: 1000, stock_item_id: st, consumption_per_unit: 10, ...(wastage != null ? { wastage_bp: wastage } : {}) }] })).data;
  await o.call('POST', `/api/contractors/work-orders/${w.id}/submit`, {}); await pm.call('POST', `/api/contractors/work-orders/${w.id}/approve`, {}); await o.call('POST', `/api/contractors/work-orders/${w.id}/approve`, {});
  const wi = (await o.call('GET', `/api/contractors/work-orders/${w.id}`)).data.items[0];
  const ms = await o.call('POST', `/api/contractors/work-orders/${w.id}/measurements`, { wo_item_id: wi.id, location: 'slab', contractor_rep: 'Ramesh', qty: 10 }); await pm.call('POST', `/api/contractors/measurements/${ms.data.id}/approve`, {});
  await pur.call('POST', '/api/stores/receive', { project_id: pid, item_id: st, qty: 1000, note: 'opening' });
  return { st, w };
};
const sweep = async () => { await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500)); };
const alerted = (st) => num(sql(`SELECT COUNT(*) AS n FROM notifications WHERE link LIKE 'wastage:${pid}:${st}:%'`), 'n') > 0;
const steel = await mkWo('Steel Fe550', null);   // 10 cum x 10 kg = 100 kg needed; usual steel wastage 2.5% = 102.5 kg allowed
await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: steel.st, qty: 102, wo_id: steel.w.id, where_used: 'slab' }); await sweep();
ok('steel issued 2% over the need is within the usual 2.5%: no alert', !alerted(steel.st));
await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: steel.st, qty: 8, wo_id: steel.w.id, where_used: 'slab' }); await sweep();
ok('110 kg of steel for 100 kg of work is over 2.5%: alert', alerted(steel.st));
const rmc = await mkWo('RMC M30', null);   // usual RMC wastage 1%
await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: rmc.st, qty: 103, wo_id: rmc.w.id, where_used: 'slab' }); await sweep();
ok('concrete is held to 1%: 103 for 100 is flagged where the same on steel was not', alerted(rmc.st));
const own = await mkWo('Binding wire', 1000);   // this line allows 10%
await site.call('POST', '/api/stores/issue', { project_id: pid, item_id: own.st, qty: 108, wo_id: own.w.id, where_used: 'slab' }); await sweep();
ok('a work-order line\'s own allowance wins over the usual figure', !alerted(own.st));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
