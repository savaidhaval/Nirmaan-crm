// tests/drw_acks.mjs — WP-22: drawing acknowledgement. Same env vars as security.mjs.
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
import { execSync } from 'node:child_process';
const pid = (await o.call('POST', '/api/projects', { name: 'zz-da ' + run, code: 'DA' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pm = await mkUser('pm', []); const sales = await mkUser('sales', []);
const s1 = await mkUser('site', [pid]); const s2 = await mkUser('site', [pid]); const s3 = await mkUser('site', []);
const notes = async (who) => JSON.stringify((await who.call('GET', '/api/notifications')).data);
const dr = await pm.call('POST', '/api/drawings', { project_id: pid, code: 'A-' + run.slice(-4), title: 'Typical floor plan', discipline: 'arch' }); ok('drawing created', dr.status === 200, JSON.stringify(dr));
const did = dr.data.id;
const summary = async (who) => (await who.call('GET', '/api/drawings/acks/summary')).data.acks.find((a) => a.drawing_id === did);
ok('a drawing with no IFC revision has nothing to confirm', (await summary(s1)) === undefined);
await pm.call('POST', `/api/drawings/${did}/revisions`, { status: 'draft' });
const revsDraft = (await pm.call('GET', `/api/drawings/${did}/revisions`)).data.revisions;
ok('a draft revision cannot be confirmed', (await s1.call('POST', `/api/drawings/revisions/${revsDraft[0].id}/ack`)).status === 409);
await pm.call('POST', `/api/drawings/${did}/revisions`, { status: 'ifc' });
let sm = await summary(s1); const rev1 = sm.revision_id;
ok('issuing R1 for construction: 2 site users are assigned, none has confirmed', sm.site_total === 2 && sm.site_acked === 0 && sm.my_ack === null && /^R\d/.test(sm.rev_no), JSON.stringify(sm));
// who may confirm
ok('only site users can confirm: PM, Sales are refused', (await pm.call('POST', `/api/drawings/revisions/${rev1}/ack`)).status === 403 && (await sales.call('POST', `/api/drawings/revisions/${rev1}/ack`)).status === 403);
ok('a site user not assigned to the project cannot', [403, 404].includes((await s3.call('POST', `/api/drawings/revisions/${rev1}/ack`)).status));
ok('requests without the header are refused', (await fetch(BASE + `/api/drawings/revisions/${rev1}/ack`, { method: 'POST', headers: { cookie: s1.cookie } })).status === 403);
const a1 = await s1.call('POST', `/api/drawings/revisions/${rev1}/ack`);
ok('the site user taps "I have seen it"', a1.status === 200 && a1.data.already === false);
ok('tapping again is harmless and says so', (await s1.call('POST', `/api/drawings/revisions/${rev1}/ack`)).data.already === true);
ok('it is recorded once in the audit log', ((JSON.stringify((await o.call('GET', '/api/audit?limit=80')).data).match(/Confirmed seen: A-/g)) || []).length === 1);
sm = await summary(s1); ok('the summary now shows 1 of 2 and my confirmation', sm.site_acked === 1 && !!sm.my_ack && (await summary(s2)).my_ack === null);
const pa = (await pm.call('GET', `/api/drawings/${did}/acks`)).data;
ok('the PM sees every site user: who has seen it and who has not', pa.total === 2 && pa.seen === 1 && pa.people.length === 2 && pa.people.filter((p) => p.acked_at).length === 1);
const sa = (await s2.call('GET', `/api/drawings/${did}/acks`)).data;
ok('a site user sees only their own line (not colleagues)', sa.people.length === 1 && sa.people[0].acked_at === null);
// a new revision resets it
const old = rev1; await pm.call('POST', `/api/drawings/${did}/revisions`, { status: 'ifc' });
sm = await summary(s1);
ok('a newer revision starts again at 0 of 2', sm.revision_id !== old && sm.site_acked === 0 && sm.my_ack === null);
ok('the old revision can no longer be confirmed', (await s2.call('POST', `/api/drawings/revisions/${old}/ack`)).status === 409);
ok('notification for the new issue already goes to site users', (await notes(s2)).includes('New drawing: A-'));
// the reminder: nothing is sent for a revision that is still new
await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2000));
ok('no reminder before the time limit', !(await notes(s2)).includes('Please confirm you have seen drawing'));
if (process.env.D1_PERSIST_TO) {
  try {
    execSync(`npx wrangler d1 execute nirmaan-db --local --persist-to ${process.env.D1_PERSIST_TO} --command "UPDATE drw_revisions SET created_at = datetime('now', '-30 hours') WHERE id = ${sm.revision_id}"`, { stdio: 'ignore' });
    await s1.call('POST', `/api/drawings/revisions/${sm.revision_id}/ack`); // site 1 confirms the new revision, site 2 does not
    await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2500));
    ok('the person who did not confirm gets a reminder', (await notes(s2)).includes('Please confirm you have seen drawing A-'));
    ok('the person who confirmed gets none', !(await notes(s1)).includes('Please confirm you have seen drawing'));
    ok('the PM is told how many have not confirmed', (await notes(pm)).includes('Drawing not confirmed: A-') && (await notes(pm)).includes('1 site user(s)'));
    ok('a user not on the project is not nagged', !(await notes(s3)).includes('Please confirm'));
    await fetch(BASE + '/__scheduled?cron=30+*+*+*+*'); await new Promise((r) => setTimeout(r, 2000));
    ok('running the sweep again the same day sends no duplicates', ((await notes(s2)).match(/Please confirm you have seen drawing A-/g) || []).length === 1 && ((await notes(pm)).match(/Drawing not confirmed: A-/g) || []).length === 1);
    await s2.call('POST', `/api/drawings/revisions/${sm.revision_id}/ack`);
    ok('once everyone has confirmed the summary shows 2 of 2', (await summary(pm)).site_acked === 2);
  } catch (e) { console.log('SKIP  reminder tests:', String(e.message).slice(0, 80)); }
} else console.log('SKIP  reminder tests (D1_PERSIST_TO not set)');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
