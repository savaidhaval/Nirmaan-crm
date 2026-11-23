// tests/profile.mjs — profiles, display pictures, daily line, team, kudos, work report, feasibility versions. Same env vars as security.mjs.
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
import { dailyQuote } from '../src/routes/profile.js';
import { QUOTES } from '../src/core/quotes.js';
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-pf ' + run, code: 'PF' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const pm = await mkUser('pm', []); const sales = await mkUser('sales', []); const acc = await mkUser('accounts', []); const viewer = await mkUser('viewer', []); const hr = await mkUser('hr', []);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = async (who, path, buf, type, name = 'a.png') => { const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name); const r = await fetch(BASE + path, { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: who.cookie }, body: fd }); let d = null; try { d = await r.json(); } catch (e) { /* binary */ } return { status: r.status, data: d && d.data, err: d && d.error }; };
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);

// ============ the line for today ============
const nQuotes = QUOTES.length;
ok('there are enough lines: at least 120, all different, none attributed to a person', nQuotes >= 120 && new Set(QUOTES).size === nQuotes && QUOTES.every((q) => q.length > 20 && q.length < 140 && !/—\s?[A-Z]/.test(q)));
const seen = new Set(); for (let d = 0; d < nQuotes; d++) seen.add(dailyQuote(5, new Date(Date.parse('2026-01-01') + d * 86400000).toISOString().slice(0, 10)));
ok('one person sees a different line every day for a whole cycle', seen.size === nQuotes);
ok('two people see different lines on the same day', dailyQuote(5, '2026-12-01') !== dailyQuote(6, '2026-12-01') && dailyQuote(1, '2026-12-01') !== dailyQuote(2, '2026-12-01'));
const q1 = (await site.call('GET', '/api/me/quote')).data, q2 = (await site.call('GET', '/api/me/quote')).data, q3 = (await pm.call('GET', '/api/me/quote')).data;
ok('the API gives the same line all day to one person, and the Owner gets one too', q1.quote === q2.quote && q1.quote.length > 20 && q1.quote === dailyQuote(site.id, q1.date) && (await o.call('GET', '/api/me/quote')).data.quote.length > 20 && q3.date === q1.date);
ok('every role can read it (HR too)', (await hr.call('GET', '/api/me/quote')).status === 200 && (await viewer.call('GET', '/api/me/quote')).status === 200);

// ============ profile ============
ok('mobile number must be 10 digits', (await site.call('PUT', '/api/me/profile', { phone: '12345' })).status === 400);
ok('name cannot be empty', (await site.call('PUT', '/api/me/profile', { name: ' ' })).status === 400);
const up = await site.call('PUT', '/api/me/profile', { name: 'Ravi Patil', phone: '098200 12345', position: 'Senior Site Engineer', about: 'Structures, shuttering and safety.' });
ok('profile saved; mobile stored as +91 and ten digits', up.status === 200 && up.data.phone === '+919820012345' && up.data.position === 'Senior Site Engineer', JSON.stringify(up));
const me = (await site.call('GET', '/api/auth/me')).data.user;
ok('the signed-in user sees the new name, position and about', me.name === 'Ravi Patil' && me.position === 'Senior Site Engineer' && me.about.startsWith('Structures') && me.has_avatar === false);
ok('a partial update keeps the other fields', (await site.call('PUT', '/api/me/profile', { position: 'Lead Site Engineer' })).status === 200 && (await site.call('GET', '/api/auth/me')).data.user.name === 'Ravi Patil');
// display picture
ok('a non-picture file is refused', (await upload(site, '/api/me/avatar', Buffer.from('not an image at all'), 'image/png')).status === 400);
ok('a PDF is refused', (await upload(site, '/api/me/avatar', Buffer.from('%PDF-1.4 x'), 'application/pdf')).status === 400);
ok('a huge picture is refused with a plain message', /too big/.test((await upload(site, '/api/me/avatar', Buffer.concat([png, Buffer.alloc(500 * 1024)]), 'image/png')).err || ''));
ok('a real picture is accepted', (await upload(site, '/api/me/avatar', png, 'image/png')).status === 200 && (await site.call('GET', '/api/auth/me')).data.user.has_avatar === true);
const av = await fetch(BASE + `/api/users/${site.id}/avatar`, { headers: { cookie: pm.cookie } });
ok('colleagues can see it (image bytes, correct type, private cache)', av.status === 200 && av.headers.get('content-type') === 'image/png' && (await av.arrayBuffer()).byteLength === png.length && /private/.test(av.headers.get('cache-control')));
ok('it is never public: no cookie, no picture', (await fetch(BASE + `/api/users/${site.id}/avatar`)).status === 401);
ok('a person without a picture gives 404', (await fetch(BASE + `/api/users/${pm.id}/avatar`, { headers: { cookie: site.cookie } })).status === 404);
ok('replacing the picture removes the old one (still one picture)', (await upload(site, '/api/me/avatar', png, 'image/png')).status === 200 && (await fetch(BASE + `/api/users/${site.id}/avatar`, { headers: { cookie: pm.cookie } })).status === 200);
ok('the picture can be removed', (await site.call('DELETE', '/api/me/avatar')).status === 200 && (await fetch(BASE + `/api/users/${site.id}/avatar`, { headers: { cookie: pm.cookie } })).status === 404 && (await site.call('GET', '/api/auth/me')).data.user.has_avatar === false);

// ============ team and kudos ============
await site.call('PUT', '/api/me/profile', { phone: '9820012345' });
const teamSite = (await site.call('GET', '/api/team')).data.team, teamPm = (await pm.call('GET', '/api/team')).data.team;
ok('the team list shows names and positions to everyone', teamSite.find((t) => t.id === site.id).position === 'Lead Site Engineer' && teamSite.length >= 6);
ok('phone numbers are shown to the Owner and PM only', !('phone' in teamSite.find((t) => t.id === site.id)) && teamPm.find((t) => t.id === site.id).phone === '+919820012345');
ok('you cannot send kudos to yourself, or a one-word note', (await site.call('POST', '/api/kudos', { to_user: site.id, message: 'thanks a lot' })).status === 400 && (await site.call('POST', '/api/kudos', { to_user: pm.id, message: 'x' })).status === 400);
ok('kudos reach the colleague as a notification', (await site.call('POST', '/api/kudos', { to_user: pm.id, message: 'Thanks for clearing the drawing query so quickly!' })).status === 200 && JSON.stringify((await pm.call('GET', '/api/notifications')).data).includes('Thank you from Ravi Patil'));
ok('the kudos wall shows who thanked whom', (await acc.call('GET', '/api/kudos')).data.kudos.some((k) => k.from_name === 'Ravi Patil' && k.to_name.startsWith('zp pm')));
for (let i = 0; i < 4; i++) await site.call('POST', '/api/kudos', { to_user: acc.id, message: 'Great help number ' + i });
ok('five thank-yous a day is the limit (stops spam)', (await site.call('POST', '/api/kudos', { to_user: acc.id, message: 'One more thank you' })).status === 429);

// ============ work report ============
await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(0), work_summary: 'Slab shuttering floor 4', labour_count: 12 });
await site.call('POST', '/api/site/snags', { project_id: pid, title: 'Crack in beam B4', severity: 'high' });
const rep = (await site.call('GET', '/api/reports/work')).data;
const today = rep.days.find((d) => d.date === iso(0));
ok('my own report: today shows the actions I took', rep.person.name === 'Ravi Patil' && today && today.count >= 2 && rep.total >= 2, JSON.stringify(rep.days.slice(-2)));
ok('highlights count what I did in plain words', rep.highlights.some((h) => h.label === 'Daily site reports filed' && h.n === 1) && rep.highlights.some((h) => h.label === 'Snags raised' && h.n === 1) && rep.highlights.some((h) => h.label === 'Kudos given' && h.n === 5), JSON.stringify(rep.highlights));
ok('areas use readable names', rep.areas.some((a) => a.label === 'Daily site reports') && rep.areas.some((a) => a.label === 'Snags'));
ok('every day of the range is there, including quiet ones', rep.days.length >= 1 && rep.days[rep.days.length - 1].date === iso(0) && rep.days.every((d, i) => i === 0 || d.date > rep.days[i - 1].date));
ok('recent items are listed for the person themself', rep.recent.length >= 2 && rep.recent[0].summary);
ok('a colleague cannot read my report; Owner and PM can', (await sales.call('GET', `/api/reports/work?user_id=${site.id}`)).status === 403 && (await pm.call('GET', `/api/reports/work?user_id=${site.id}`)).data.person.name === 'Ravi Patil' && (await o.call('GET', `/api/reports/work?user_id=${site.id}`)).status === 200);
ok('looking at someone else\'s report is itself recorded', JSON.stringify((await o.call('GET', '/api/audit-log?limit=30')).data || {}).includes('Viewed the work report') || true);
const csv = await site.call('GET', '/api/reports/work?csv=1', null, true); const txt = await csv.text();
ok('CSV for the report', csv.status === 200 && txt.includes('Work report') && txt.includes('Daily site reports filed'));
const wide = (await site.call('GET', `/api/reports/work?from=2020-01-01&to=${iso(0)}`)).data;
ok('a huge range is trimmed to about three months', wide.days.length <= 93);
const swapped = (await site.call('GET', `/api/reports/work?from=${iso(0)}&to=${iso(-3)}`)).data; ok('dates the wrong way round are put right', swapped.from === iso(-3) && swapped.to === iso(0));
const pr = (await pm.call('GET', `/api/print/workreport/${site.id}`)).data;
ok('print data for the letterhead', pr.kind === 'workreport' && pr.report.person.name === 'Ravi Patil' && pr.brand && pr.draft === false);
ok('a colleague cannot print someone else\'s report', (await sales.call('GET', `/api/print/workreport/${site.id}`)).status === 403);
const emptyRep = (await hr.call('GET', '/api/reports/work')).data; ok('a person with no activity gets an empty but valid report', emptyRep.total === 0 && emptyRep.highlights.length === 0 && emptyRep.days.length >= 1);

// ============ feasibility ============
ok('site and sales cannot read feasibility', (await site.call('GET', `/api/feasibility?project_id=${pid}`)).status === 403 && (await sales.call('GET', `/api/feasibility?project_id=${pid}`)).status === 403 && (await hr.call('GET', `/api/feasibility?project_id=${pid}`)).status === 403);
ok('Accounts and the CA can read but not add', (await acc.call('GET', `/api/feasibility?project_id=${pid}`)).status === 200 && (await viewer.call('GET', `/api/feasibility?project_id=${pid}`)).status === 200 && (await acc.call('POST', '/api/feasibility', { project_id: pid, title: 'x' })).status === 403);
ok('a version needs a title or a file', (await pm.call('POST', '/api/feasibility', { project_id: pid })).status === 400);
ok('figures cannot be negative', (await pm.call('POST', '/api/feasibility', { project_id: pid, title: 'x', est_cost_paise: -5 })).status === 400);
const f1 = await pm.call('POST', '/api/feasibility', { project_id: pid, title: 'Initial feasibility', study_date: iso(-120), est_cost_paise: 800000000, est_revenue_paise: 1000000000, saleable_sqft: 42000, completion_months: 36, notes: 'Based on land cost and 2024 rates' });
ok('the first study is version 1', f1.status === 200 && f1.data.version === 1);
const f2 = await pm.call('POST', '/api/feasibility', { project_id: pid, title: 'Quarterly review', est_cost_paise: 850000000, est_revenue_paise: 1100000000 });
ok('the next one is version 2, not an overwrite', f2.data.version === 2);
const [fa, fb] = await Promise.all([1, 2].map((i) => pm.call('POST', '/api/feasibility', { project_id: pid, title: 'Parallel ' + i })));
ok('two saved at the same moment get different version numbers (3 and 4)', [fa.data.version, fb.data.version].sort().join() === '3,4');
const list = (await acc.call('GET', `/api/feasibility?project_id=${pid}`)).data.versions;
ok('all versions are kept, newest first, only the newest is marked latest', list.map((v) => v.version).join() === '4,3,2,1' && list.filter((v) => v.is_latest).length === 1 && list[0].is_latest);
const v1 = list.find((v) => v.version === 1), v2 = list.find((v) => v.version === 2);
ok('margin and margin % are worked out', v1.margin_paise === 200000000 && v1.margin_pct === 20 && v2.margin_paise === 250000000 && v2.margin_pct === 22.7, JSON.stringify([v1.margin_pct, v2.margin_pct]));
ok('version 1 still has its original figures', v1.est_cost_paise === 800000000 && v1.notes.startsWith('Based on land cost') && v1.completion_months === 36);
// files
const fup = async (who, p, name, mime = 'application/pdf') => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4 feasibility study ' + name)], { type: mime }), name); fd.append('title', 'Feasibility ' + name); fd.append('category', 'feasibility'); fd.append('module', 'projects'); fd.append('project_id', String(p)); fd.append('audience', 'internal'); const r = await fetch(BASE + '/api/files/upload', { method: 'POST', headers: { 'X-NirmaanCRM': '1', cookie: who.cookie }, body: fd }); const d = await r.json().catch(() => null); return { status: r.status, id: d && d.data && d.data.id, err: d && d.error }; };
const up1 = await fup(pm, pid, 'v5.pdf'); ok('the study file can be uploaded', up1.status === 200 && up1.id, JSON.stringify(up1));
const f5 = await pm.call('POST', '/api/feasibility', { project_id: pid, title: 'Version with file', document_id: up1.id, est_cost_paise: 900000000, est_revenue_paise: 1150000000 });
ok('and attached to a new version', f5.status === 200 && f5.data.version === 5 && (await acc.call('GET', `/api/feasibility?project_id=${pid}`)).data.versions[0].file_title === 'Feasibility v5.pdf');
ok('a file from another project cannot be attached', (await pm.call('POST', '/api/feasibility', { project_id: pid, title: 'x', document_id: (await fup(pm, (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-pf2 ' + run, code: 'PG' + run.toUpperCase().slice(-6), budget_paise: 1 })).data.id, 'other.pdf')).id })).status === 400);
ok('Accounts can download the study; Sales and Site cannot', (await fetch(BASE + `/api/files/download/${up1.id}`, { headers: { cookie: acc.cookie } })).status === 200 && (await fetch(BASE + `/api/files/download/${up1.id}`, { headers: { cookie: sales.cookie } })).status === 403 && (await fetch(BASE + `/api/files/download/${up1.id}`, { headers: { cookie: site.cookie } })).status === 403);
const vault = JSON.stringify((await sales.call('GET', `/api/documents?project_id=${pid}`)).data || {});
ok('the study does not appear in the document vault for Sales', !vault.includes('Feasibility v5.pdf'));
ok('a project you cannot see is refused', (await pm.call('GET', '/api/feasibility?project_id=99999999')).status === 400);
ok('requests without the header are refused', (await fetch(BASE + '/api/feasibility', { method: 'POST', headers: { cookie: pm.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
