// tests/bulk_demands.mjs — WP-16: bulk demand letters, daily limit, retry, print sheet, public link. Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-bd ' + run, code: 'BD' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-bd2 ' + run, code: 'BE' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const sales = await mkUser('sales', []); const acc = await mkUser('accounts', []); const site = await mkUser('site', [pid]); const pm = await mkUser('pm', []);
await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'On booking', pct_bp: 10000 }] });
await o.call('POST', '/api/sales/plan-stages', { project_id: pid2, stages: [{ stage_name: 'On booking', pct_bp: 10000 }] });
await o.call('POST', '/api/settings/sales.bulk_daily_limit', { value: 1000 });
const mkBooking = async (project, n, email) => { const u = (await o.call('POST', '/api/sales/inventory', { project_id: project, wing: 'A', floor: 1 + (n % 9), unit_no: 'B' + n + run.slice(-3), type: '2BHK', carpet_sqft: 600, rera_carpet_sqft: 500, price_paise: 100000000 })).data.id;
  const b = (await o.call('POST', '/api/sales/bookings', { unit_id: u, customer_name: 'Cust ' + n + ' ' + run, phone: '98' + String(10000000 + n), email, agreed_price_paise: 100000000, token_paise: 1000000 })); if (b.status !== 200) throw new Error('booking ' + n + ' ' + JSON.stringify(b)); return b.data.id; };
const demandOf = async (bid) => (await o.call('GET', `/api/sales/bookings/${bid}`)).data.demands[0].id;
const ids = []; const bookings = [];
for (let n = 1; n <= 25; n++) { const email = n === 7 ? `fail-${run}@test.local` : n === 8 ? '' : `cust${n}-${run}@test.local`; const bid = await mkBooking(pid, n, email); bookings.push(bid); ids.push(await demandOf(bid)); }
const other = await demandOf(await mkBooking(pid2, 30, 'other@test.local'));

// ============ the Ready list ============
const rl = (await sales.call('GET', '/api/sales/ready-demands')).data;
ok('the Ready list shows the 25 demands, with a no-email flag and the limits', ids.every((i) => rl.demands.some((d) => d.id === i)) && rl.demands.find((d) => d.id === ids[7]).has_email === false && rl.demands.find((d) => d.id === ids[0]).has_email === true && rl.daily_limit === 1000, JSON.stringify(rl.demands[0]));
ok('email addresses are not sent to the list', !JSON.stringify(rl).includes('@test.local'));
ok('site engineers and others cannot use it', (await site.call('GET', '/api/sales/ready-demands')).status === 403);

// ============ start a run ============
ok('nothing ticked is refused', (await sales.call('POST', '/api/sales/bulk-demands', { demand_ids: [] })).status === 400);
ok('more than 90 is refused with a plain message', /at most 90/.test((await sales.call('POST', '/api/sales/bulk-demands', { demand_ids: Array.from({ length: 91 }, (_, i) => i + 1) })).err || ''));
ok('headers are required', (await fetch(BASE + '/api/sales/bulk-demands', { method: 'POST', headers: { cookie: sales.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
const start = await sales.call('POST', '/api/sales/bulk-demands', { demand_ids: [...ids, 999999] });
ok('a run is created for the 25 real demands; the unknown one is reported, not fatal', start.status === 200 && start.data.queued === 25 && start.data.skipped.length === 1, JSON.stringify(start));
const runId = start.data.run_id;
ok('the same demands cannot be queued twice at once', (await sales.call('POST', '/api/sales/bulk-demands', { demand_ids: [ids[0]] })).status === 400);
ok('nothing has been emailed by just starting', (await sales.call('GET', `/api/sales/bulk-demands/${runId}`)).data.counts.sent === 0);

// ============ process in small chunks ============
let calls = 0, last, maxPer = 0;
do { last = await sales.call('POST', `/api/sales/bulk-demands/${runId}/process`); calls++; maxPer = Math.max(maxPer, last.data.sent + last.data.failed + last.data.skipped); } while (!last.data.done && calls < 20);
ok('25 letters go out in chunks of at most 3 per request (free-plan limit), not all at once', calls >= 9 && maxPer <= 3, `calls=${calls} max=${maxPer}`);
const res = (await sales.call('GET', `/api/sales/bulk-demands/${runId}`)).data;
ok('23 sent, 1 failed (forced), 1 skipped (no email)', res.counts.sent === 23 && res.counts.failed === 1 && res.counts.skipped === 1, JSON.stringify(res.counts));
const failed = res.items.find((i) => i.status === 'failed'), skipped = res.items.find((i) => i.status === 'skipped');
ok('the failure and the skip say why in plain words', /refused/.test(failed.error) && /no email/.test(skipped.error));
ok('every sent demand has its number and a sent time', res.items.filter((i) => i.status === 'sent').every((i) => /^DL-/.test(i.demand_no) && i.sent_at));
const mails = (await o.call('GET', '/api/email/log')).data.emails.filter((e) => e.template === 'demand');
ok('the emails carry the letter and a /d/ link ', mails.length >= 20 && mails.every((e) => e.body_html.includes('Amount due') && !/account number\s*:?\s*\d/i.test(e.body_html)));
// demands are marked sent
const r2 = (await sales.call('GET', '/api/sales/ready-demands')).data;
ok('sent demands show as sent on the Ready list; failed and skipped do not', r2.demands.find((d) => d.id === ids[0]).sent_at && !r2.demands.find((d) => d.id === ids[6]).sent_at && !r2.demands.find((d) => d.id === ids[7]).sent_at);
ok('a payment demand is not paid or changed by sending', (await o.call('GET', `/api/sales/bookings/${bookings[0]}`)).data.demands[0].status === 'ready');

// ============ retry ============
ok('retry puts the failed one back in the queue', (await sales.call('POST', `/api/sales/bulk-demands/${runId}/retry`)).data.requeued === 1);
await sales.call('POST', `/api/sales/bulk-demands/${runId}/process`);
ok('fixing nothing means it fails again and is listed failed', (await sales.call('GET', `/api/sales/bulk-demands/${runId}`)).data.counts.failed === 1);
ok('a bad email address is refused when fixing', (await sales.call('POST', `/api/sales/bookings/${bookings[6]}/email`, { email: 'nope' })).status === 400);
ok('the right address is saved on the booking', (await sales.call('POST', `/api/sales/bookings/${bookings[6]}/email`, { email: `fixed-${run}@test.local` })).status === 200 && (await sales.call('POST', `/api/sales/bookings/${bookings[7]}/email`, { email: `added-${run}@test.local` })).status === 200);
ok('site engineers cannot edit it', (await site.call('POST', `/api/sales/bookings/${bookings[6]}/email`, { email: 'x@y.com' })).status === 403);
await sales.call('POST', `/api/sales/bulk-demands/${runId}/retry`); await sales.call('POST', `/api/sales/bulk-demands/${runId}/process`);
const after = (await sales.call('GET', `/api/sales/bulk-demands/${runId}`)).data;
ok('after fixing the address the retry succeeds: 24 sent, 0 failed, 1 skipped (no email, listed until retried)', after.counts.sent === 24 && after.counts.failed === 0, JSON.stringify(after.counts));
const sentLogs = (await o.call('GET', '/api/email/log')).data.emails;
ok('no failed mail is left for the hourly auto-retry to send again', sentLogs.filter((e) => e.template === 'demand' && e.status === 'failed' && e.attempts < 3).length === 0);

// ============ daily limit ============
await o.call('POST', '/api/settings/sales.bulk_daily_limit', { value: 24 });
const s2 = await sales.call('POST', '/api/sales/bulk-demands', { demand_ids: [other] });
const lim = await sales.call('POST', `/api/sales/bulk-demands/${s2.data.run_id}/process`);
ok('when the daily limit is reached nothing more is sent and the screen is told why', lim.data.paused === 'daily_limit' && lim.data.counts.queued === 1, JSON.stringify(lim.data));
await o.call('POST', '/api/settings/sales.bulk_daily_limit', { value: 1000 });
ok('raising the limit lets it go', (await sales.call('POST', `/api/sales/bulk-demands/${s2.data.run_id}/process`)).data.counts.sent === 1);

// ============ results + CSV, access ============
const csv = await sales.call('GET', `/api/sales/bulk-demands/${runId}?csv=1`, null, true); const txt = await csv.text();
ok('CSV lists every demand with its result', csv.status === 200 && txt.includes('Demand no') && txt.includes(',sent,') && txt.split('\n').length >= 26);
ok('another sales person cannot open my run; Owner, PM and Accounts can', (await (await mkUser('sales', [])).call('GET', `/api/sales/bulk-demands/${runId}`)).status === 403 && (await acc.call('GET', `/api/sales/bulk-demands/${runId}`)).status === 200 && (await o.call('GET', `/api/sales/bulk-demands/${runId}`)).status === 200);

// ============ print sheet (option A) ============
const ps = await sales.call('GET', `/api/print/demands?ids=${ids.slice(0, 3).join(',')}`);
ok('print sheet data: one letter per demand, each numbered, none a draft', ps.status === 200 && ps.data.kind === 'demandbatch' && ps.data.letters.length === 3 && ps.data.letters.every((l) => l.demand.demand_no && !l.draft && l.brand));
ok('more than 10 on one sheet is refused with a plain message', /at most 10/.test((await sales.call('GET', `/api/print/demands?ids=${ids.slice(0, 11).join(',')}`)).err || ''));
ok('site engineers cannot print letters', (await site.call('GET', `/api/print/demands?ids=${ids[0]}`)).status === 403);

// ============ public link ============
const stored = (await o.call('GET', '/api/email/log')).data.emails.map((e) => e.body_html).join(' ');
const link = /\/d\/([A-Za-z0-9_-]{40,})/.exec(stored);
ok('the emails contain a /d/ link', !!link);
if (link) {
  const pub = await fetch(BASE + '/d/' + link[1]); const html = await pub.text();
  ok('the link opens the letter without a login', pub.status === 200 && html.includes('Payment demand') && html.includes('Amount due'));
  ok('not indexed, not cached, no bank account number', /noindex/.test(html) && pub.headers.get('cache-control') === 'no-store' && !/account number\s*:?\s*\d/i.test(html));
}
ok('a made-up link is refused', (await fetch(BASE + '/d/' + 'A'.repeat(43))).status === 410 && (await fetch(BASE + '/d/not$valid')).status === 410);
ok('revoking works and reports how many links were turned off', (await sales.call('POST', `/api/sales/demands/${ids[0]}/revoke-links`)).status === 200);
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
