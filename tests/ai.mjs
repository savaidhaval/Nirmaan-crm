// tests/ai.mjs — AI assistant (runs with AI_MOCK=1, so no real model is called). Same env vars as security.mjs.
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
const pid = (await o.call('POST', '/api/projects', { name: 'zz-ai ' + run, code: 'A1' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { name: 'zz-ai-other ' + run, code: 'B1' + run.toUpperCase().slice(-6), budget_paise: 50000000 })).data.id;
const site = await mkUser('site', [pid]); const pm = await mkUser('pm', []); const pur = await mkUser('purchase', []); const acc = await mkUser('accounts', []); const sales = await mkUser('sales', []); const hr = await mkUser('hr', []);
const setSetting = (k, v) => o.call('POST', '/api/settings/' + k, { value: v });
const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);

// ---------- switch, status, roles ----------
await setSetting('ai.enabled', 'off'); await setSetting('ai.daily_limit', 10000);
const off = await pm.call('POST', '/api/ai/ask', { question: 'which bills are due' });
ok('AI off: plain message, nothing runs', off.status === 403 && /switched off/.test(off.err));
await setSetting('ai.enabled', 'on');
ok('status shows on and the topics it can answer', (await pm.call('GET', '/api/ai/status')).data.enabled === true && (await pm.call('GET', '/api/ai/status')).data.topics.length >= 8);
ok('HR has no AI access', (await hr.call('POST', '/api/ai/ask', { question: 'stock' })).status === 403);
ok('empty question refused', (await pm.call('POST', '/api/ai/ask', { question: ' ' })).status === 400);
const unk = (await pm.call('POST', '/api/ai/ask', { question: 'what is the weather like' })).data;
ok('unknown question: tells what it can answer, uses no AI', unk.model_used === false && /I can answer questions about/.test(unk.answer));

// ---------- permission-filtered facts ----------
const vendor = (await o.call('POST', '/api/procurement/vendors', { name: 'zz Vendor ' + run })).data.id;
const bill = await o.call('POST', '/api/procurement/bills', { vendor_id: vendor, project_id: pid, bill_no: 'AIB' + run, amount_paise: 1180000, due_date: iso(-2) });
const a1 = (await acc.call('POST', '/api/ai/ask', { question: 'Which vendor bills are due?' })).data;
ok('Accounts: answer is based on vendor bills with the exact amount and OVERDUE flag', a1.model_used && a1.based_on.includes('vendor bills due') && a1.facts.join(' ').includes('zz Vendor') && a1.facts.join(' ').includes('₹11,800') && a1.facts.join(' ').includes('OVERDUE'), JSON.stringify(a1.facts));
ok('the answer carries a "based on" list and the facts', Array.isArray(a1.facts) && a1.facts.length > 1);
const sBill = (await site.call('POST', '/api/ai/ask', { question: 'Which vendor bills are due?' })).data;
ok('Site engineer cannot get bill data', sBill.model_used === false && /does not have access/.test(sBill.answer), sBill.answer);
const slBill = (await sales.call('POST', '/api/ai/ask', { question: 'vendor bills due' })).data;
ok('Sales cannot get bill data either', slBill.model_used === false && /does not have access/.test(slBill.answer));

// stock: only the projects the person is assigned to
const item = (await pur.call('POST', '/api/stores/items', { name: 'AIItem ' + run, unit: 'bags' })).data.id;
for (const p of [pid, pid2]) { await pm.call('POST', '/api/stores/reorder', { project_id: p, item_id: item, reorder_level: 50 }); await pm.call('POST', '/api/stores/adjust', { project_id: p, item_id: item, qty: 10, reason: 'opening' }); }
const pend = (await o.call('GET', `/api/stores/moves?project_id=${pid}&status=pending`)).data.moves[0]; await o.call('POST', `/api/stores/moves/${pend.id}/approve`, {});
const pend2 = (await o.call('GET', `/api/stores/moves?project_id=${pid2}&status=pending`)).data.moves[0]; await o.call('POST', `/api/stores/moves/${pend2.id}/approve`, {});
const stk = (await site.call('POST', '/api/ai/ask', { question: 'what stock is running low?' })).data;
ok('Site sees low stock for its own project only', stk.facts.join(' ').includes('AIItem ' + run) && stk.facts.filter((l) => l.includes('AIItem ' + run)).length === 2 && !stk.facts.join(' ').includes('zz-ai-other'), JSON.stringify(stk.facts));
const stkPm = (await pm.call('POST', '/api/ai/ask', { question: 'stock low' })).data;
ok('PM sees both projects', stkPm.facts.join(' ').includes('zz-ai-other ' + run));

// contracts expiring (professional + vendor)
const prof = (await pur.call('POST', '/api/professionals', { name: 'Adv. AI ' + run, profession: 'Advocate' })).data.id;
await pur.call('POST', '/api/partydocs', { party_type: 'professional', party_id: prof, doc_type: 'Retainer agreement', kind: 'contract', valid_till: iso(12) });
const docq = (await pur.call('POST', '/api/ai/ask', { question: 'which contracts are expiring soon?' })).data;
ok('contracts expiring: lists the advocate retainer', docq.facts.join(' ').includes('Adv. AI ' + run) && docq.facts.join(' ').includes('Retainer agreement'), JSON.stringify(docq.facts));
ok('Site cannot ask about contracts', /does not have access/.test((await site.call('POST', '/api/ai/ask', { question: 'contracts expiring' })).data.answer));

// ---------- privacy: no phone, email or PAN in anything the model sees ----------
const lead = await o.call('POST', '/api/sales/leads', { name: 'AI Lead ' + run, phone: '9' + String(Date.now()).slice(-9), email: 'ai-lead-' + run + '@example.com', project_id: pid, source: 'website', consent: true });
const leadId = lead.data.id; const phone = '9' + String(Date.now()).slice(-9);
const lq = (await o.call('POST', '/api/ai/ask', { question: 'which leads need a follow-up?' })).data;
ok('leads topic works', lq.model_used === true && lq.based_on.includes('sales leads'));
const dr = await o.call('POST', '/api/ai/draft', { kind: 'lead_followup', id: leadId, lang: 'en', tone: 'polite', channel: 'whatsapp', note: 'Offer a Saturday visit' });
ok('lead follow-up draft is produced from facts', dr.status === 200 && dr.data.draft.includes('MOCK REPLY') && dr.data.facts.join(' ').includes('AI Lead ' + run), JSON.stringify(dr));
const everything = JSON.stringify([lq, dr.data, a1, stk]);
ok('no phone number or email address ever appears in facts or drafts', !/@example\.com/.test(everything) && !/\b9\d{9}\b/.test(everything.replace(/\d{13}/g, '')));
ok('a person without access to the lead is refused', (await site.call('POST', '/api/ai/draft', { kind: 'lead_followup', id: leadId })).status === 403);
ok('unknown draft kind refused', (await o.call('POST', '/api/ai/draft', { kind: 'nope', id: 1 })).status === 400);
ok('unknown lead gives not found', (await o.call('POST', '/api/ai/draft', { kind: 'lead_followup', id: 99999999 })).status === 404);

// ---------- other drafts ----------
const vd = await pur.call('POST', '/api/ai/draft', { kind: 'vendor_quote_request', id: vendor, channel: 'email', note: '100 bags OPC cement' });
ok('Purchase drafts a quote request to a vendor', vd.status === 200 && vd.data.channel === 'email' && vd.data.facts.join(' ').includes('zz Vendor ' + run));
ok('site cannot draft vendor messages', (await site.call('POST', '/api/ai/draft', { kind: 'vendor_po_followup', id: vendor })).status === 403);
ok('sales cannot draft payment reminders', (await sales.call('POST', '/api/ai/draft', { kind: 'payment_reminder', id: 1 })).status === 403);
ok('payment reminder for an unknown demand is not found', (await acc.call('POST', '/api/ai/draft', { kind: 'payment_reminder', id: 99999999 })).status === 404);

// ---------- summaries ----------
ok('text summary', (await pm.call('POST', '/api/ai/summary', { kind: 'text', text: 'The architect agreement runs for 24 months from signing and covers concept design, drawings and site visits. ' + 'More clauses. '.repeat(5) })).data.summary.includes('MOCK REPLY'));
ok('short text is refused', (await pm.call('POST', '/api/ai/summary', { kind: 'text', text: 'hi' })).status === 400);
await site.call('POST', '/api/site/dprs', { project_id: pid, report_date: iso(-1), work_summary: 'Slab shuttering done on floor 4', labour_count: 14 });
const pw = await site.call('POST', '/api/ai/summary', { kind: 'project_week', id: pid });
ok('project week summary uses the reports and snags', pw.status === 200 && pw.data.facts.join(' ').includes('Slab shuttering') && pw.data.facts.join(' ').includes('Daily reports filed: 1'), JSON.stringify(pw.data));
ok('project week hides money from a site engineer', !pw.data.facts.join(' ').includes('Purchase orders approved'));
ok('summary of a project you are not on is refused', (await site.call('POST', '/api/ai/summary', { kind: 'project_week', id: pid2 })).status === 403);
const ls = await o.call('POST', '/api/ai/summary', { kind: 'lead', id: leadId });
ok('lead summary', ls.status === 200 && ls.data.facts.join(' ').includes('AI Lead ' + run));

// ---------- finder ----------
ok('finder: lead by name', (await o.call('GET', `/api/ai/find?kind=lead&q=ai lead ${run}`)).data.results.some((r) => r.id === leadId));
ok('finder: vendor by name', (await pur.call('GET', `/api/ai/find?kind=vendor&q=zz vendor ${run}`)).data.results.some((r) => r.id === vendor));
ok('finder: site engineer cannot find vendors or leads', (await site.call('GET', `/api/ai/find?kind=vendor&q=zz`)).data.results.length === 0 && (await site.call('GET', `/api/ai/find?kind=lead&q=ai`)).data.results.length === 0);
ok('finder: project list is scoped', (await site.call('GET', `/api/ai/find?kind=project&q=zz-ai`)).data.results.map((r) => r.id).join() === String(pid));

// ---------- limits and records ----------
const u2 = await mkUser('pm', []);
await setSetting('ai.daily_limit', 1);
const lim = await u2.call('POST', '/api/ai/ask', { question: 'stock low' });
ok('daily team limit stops further calls with a plain message', lim.status === 429 && /limit for the whole team/.test(lim.err), JSON.stringify(lim));
await setSetting('ai.daily_limit', 10000);
const fast = []; const u3 = await mkUser('accounts', []); for (let i = 0; i < 14; i++) fast.push((await u3.call('POST', '/api/ai/ask', { question: 'petty cash' })).status);
ok('one person cannot flood the AI (12 per 5 minutes)', fast.includes(429) && fast.filter((s) => s === 200).length === 12, fast.join());
const used = (await o.call('GET', '/api/ai/status')).data.used_today; ok('usage is counted', used > 10);
ok('settings can hold the AI switches', (await setSetting('ai.model', '@cf/meta/llama-3.1-8b-instruct')).status === 200);
ok('requests without the header are refused', (await fetch(BASE + '/api/ai/ask', { method: 'POST', headers: { cookie: pm.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'stock' }) })).status === 403);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
