// tests/agreement.mjs — Agreement for Sale template (advocate-approval mark) and WhatsApp share messages. Same env vars as the other suites.
const BASE = process.env.BASE || 'http://localhost:8787';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
class C { constructor() { this.cookie = ''; } async call(m, p, b) { const h = { 'X-NirmaanCRM': '1' }; if (this.cookie) h.cookie = this.cookie; if (b) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; let d = null; try { d = await res.json(); } catch (x) { /* */ } return { status: res.status, data: d && d.data, err: d && d.error, code: d && d.code }; } }
const o = new C(); await o.call('POST', '/api/auth/login', { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });

// If a check throws, put the shared switches back so the suites that follow are not affected.
const putBack = async () => { try { await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' }); await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' }); } catch (e) { /* ignore */ } };
process.on('uncaughtException', async (e) => { console.error(e); await putBack(); process.exit(1); });
const run = Date.now().toString(36); let seq = 0;
await o.call('POST', '/api/settings/sales.afs_gate', { value: 'off' }); await o.call('POST', '/api/settings/site.dual_signoff', { value: 'off' });
const pid = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-agr ' + run, code: 'AG' + run.toUpperCase().slice(-6), target_date: '2028-03-31' })).data.id;
const pid2 = (await o.call('POST', '/api/projects', { rera_no: 'P518000TEST', name: 'zz-agr2 ' + run, code: 'AH' + run.toUpperCase().slice(-6) })).data.id;
const mkUser = async (role, projects) => { const email = `ag-${role}-${++seq}-${run}@test.local`; const r = await o.call('POST', '/api/users', { name: 'ag ' + role, email, role, projects }); const pw = 'AgStrongPass-' + run; const c = new C(); await c.call('POST', '/api/auth/login', { email, password: r.data.temporaryPassword }); await c.call('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, newPassword: pw }); return c; };
const pm = await mkUser('pm', [pid]); const acc = await mkUser('accounts', [pid]); const sales = await mkUser('sales', [pid]); const site = await mkUser('site', [pid]); const otherSales = await mkUser('sales', [pid2]);

await o.call('POST', '/api/sales/plan-stages', { project_id: pid, stages: [{ stage_name: 'Slab', pct_bp: 5000, milestone_key: 'ag' + run }, { stage_name: 'Possession', pct_bp: 5000, milestone_key: 'agp' + run }] });
const mkBooking = async (n, phone) => {
  const unit = (await o.call('POST', '/api/sales/inventory', { project_id: pid, wing: 'B', floor: 3, unit_no: n + run.slice(-3), type: '2BHK', price_paise: 20000000, rera_carpet_sqft: 620 })).data.id;
  return (await o.call('POST', '/api/sales/bookings', { unit_id: unit, customer_name: 'Asha Rao', phone, email: 'asha@example.com', address: '12 Hill Road, Bandra, Mumbai', token_paise: 100000 })).data.id;
};
const bk = await mkBooking('P', '98' + String(Date.now()).slice(-8));
await o.call('POST', '/api/site/milestones', { project_id: pid, name: 'Slab', milestone_key: 'ag' + run });
const ms = (await o.call('GET', `/api/site/milestones?project_id=${pid}`)).data.milestones.find((m) => m.milestone_key === 'ag' + run);
await o.call('POST', `/api/site/milestones/${ms.id}/done`, { actual_date: new Date().toISOString().slice(0, 10), cert_ref: 'ARCH/1 test', override_note: 'test project has no CC recorded' });

// ---------- Agreement for Sale ----------
let a = await sales.call('GET', `/api/sales/bookings/${bk}/agreement`);
ok('the closer can prepare the agreement', a.status === 200, JSON.stringify(a));
const f = a.data.fields;
ok('the merge fields come from the booking and the project', /Asha Rao/.test(f.customer_name) && /Bandra/.test(f.address) && f.carpet_area === '620' && /2,00,000/.test(f.agreement_value) && /Two Lakh/.test(f.agreement_value_words) && /March 2028/.test(f.possession_date), JSON.stringify(f));
ok('the interest rate and defect period come from settings (11%, 5 years)', f.interest_rate === '11%' && f.defect_years === '5', f.interest_rate + ' ' + f.defect_years);
ok('the payment schedule lists the stages', /Slab: 50%/.test(f.payment_schedule) && /Possession: 50%/.test(f.payment_schedule));
ok('built-in wording is marked as a draft not for signing', a.data.reviewed === false && /NOT FOR SIGNING/.test(f.draft_notice) && a.data.template.source === 'built-in' && /AGREEMENT FOR SALE/.test(a.data.template.body));
ok('site role cannot prepare it', (await site.call('GET', `/api/sales/bookings/${bk}/agreement`)).status === 403);
ok('preparing the agreement is audited', (await o.call('GET', '/api/audit?action=agreement_prepared')).data.audit.some((x) => /Asha Rao/.test(x.summary)));

ok('sales cannot change the template', (await sales.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'agreement', body: 'x' })).status === 403);
ok('a made-up kind is refused', (await o.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'sale-deed', body: 'x' })).status === 400);
const sv = await pm.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'agreement', body: '{{draft_notice}}\nAgreement for {{customer_name}}, flat {{flat_no}}, {{agreement_value}}.' });
ok('the PM saves the project\'s own wording', sv.status === 200, JSON.stringify(sv));

let tpl = (await o.call('GET', `/api/sales/letter-templates?project_id=${pid}`)).data;
const t = tpl.templates.find((x) => x.kind === 'agreement');
ok('the list shows it, unapproved, with the built-in text available', t && !t.reviewed_on && /AGREEMENT FOR SALE/.test(tpl.defaults.agreement));
ok('PM cannot record the advocate\'s approval', (await pm.call('POST', `/api/sales/letter-templates/${t.id}/review`, { advocate: 'Adv. Mehta' })).status === 403);
ok('the approval needs the advocate\'s name', (await o.call('POST', `/api/sales/letter-templates/${t.id}/review`, {})).status === 400);
ok('the Owner records the approval', (await o.call('POST', `/api/sales/letter-templates/${t.id}/review`, { advocate: 'Adv. Mehta' })).status === 200);
a = await acc.call('GET', `/api/sales/bookings/${bk}/agreement`);
ok('approved wording drops the draft notice', a.data.reviewed === true && a.data.fields.draft_notice === '' && a.data.reviewed_by === 'Adv. Mehta' && a.data.template.source === 'project', JSON.stringify(a.data.fields.draft_notice));
await pm.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'agreement', body: 'Changed wording {{customer_name}}' });
a = await o.call('GET', `/api/sales/bookings/${bk}/agreement`);
ok('changing the wording clears the approval', a.data.reviewed === false && /NOT FOR SIGNING/.test(a.data.fields.draft_notice));
await o.call('POST', `/api/sales/letter-templates/${t.id}/review`, { advocate: 'Adv. Mehta' });
const dt = (await o.call('POST', '/api/sales/letter-templates', { project_id: pid, kind: 'demand', body: 'Demand {{customer_name}}' }), (await o.call('GET', `/api/sales/letter-templates?project_id=${pid}`)).data.templates.find((x) => x.kind === 'demand'));
ok('the approval mark applies to the agreement only', (await o.call('POST', `/api/sales/letter-templates/${dt.id}/review`, { advocate: 'Adv. Mehta' })).status === 400);
ok('the approval is audited', (await o.call('GET', '/api/audit?action=agreement_reviewed')).data.audit.length >= 1);
await o.call('DELETE', `/api/sales/letter-templates/${t.id}`);
ok('going back to the built-in text brings the draft notice back', (await o.call('GET', `/api/sales/bookings/${bk}/agreement`)).data.reviewed === false);

// ---------- WhatsApp share ----------
const wa = (c, id, body) => c.call('POST', `/api/sales/bookings/${id}/whatsapp`, body);
let w = await sales.call('POST', `/api/sales/bookings/${bk}/whatsapp`, { kind: 'thanks' });
ok('a thank-you message opens a wa.me link to the customer\'s number', w.status === 200 && /^https:\/\/wa\.me\/91\d{10}\?text=/.test(w.data.url) && /Asha Rao/.test(w.data.text), JSON.stringify(w));
ok('the message text is in the link, properly encoded', decodeURIComponent(w.data.url.split('?text=')[1]) === w.data.text);
const dem = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands.find((d) => d.label === 'Slab');
w = await acc.call('POST', `/api/sales/bookings/${bk}/whatsapp`, { kind: 'demand', demand_id: dem.id });
ok('a demand message carries the stage, the amount due and the bank details line', w.status === 200 && /Slab/.test(w.data.text) && /Amount due: ₹ ?1,05,000/.test(w.data.text) && /RERA collection account/.test(w.data.text), w.data && w.data.text);
ok('a demand that is not ready is refused', (await wa(acc, bk, { kind: 'demand', demand_id: (await o.call('GET', `/api/sales/bookings/${bk}`)).data.demands.find((d) => d.label === 'Possession').id })).status === 409);
ok('a made-up demand id is refused', (await wa(acc, bk, { kind: 'demand', demand_id: 99999999 })).status === 404);
const rc = await acc.call('POST', `/api/sales/bookings/${bk}/receipts`, { amount_paise: 2500000, demand_id: dem.id, ref_no: 'UTR' + run, mode: 'bank' });
const rid = (await o.call('GET', `/api/sales/bookings/${bk}`)).data.receipts[0].id;
w = await acc.call('POST', `/api/sales/bookings/${bk}/whatsapp`, { kind: 'receipt', receipt_id: rid });
ok('a receipt message carries the amount and the receipt number', w.status === 200 && /25,000/.test(w.data.text) && /RC-/.test(w.data.text), w.data && w.data.text);
w = await acc.call('POST', `/api/sales/bookings/${bk}/whatsapp`, { kind: 'balance' });
ok('a balance message shows what is due now', w.status === 200 && /instalments due now/.test(w.data.text), w.data && w.data.text);
ok('an agreement-ready message names the flat', (await wa(sales, bk, { kind: 'agreement' })).data.text.includes('Agreement for Sale'));
ok('an unknown kind is refused', (await wa(o, bk, { kind: 'spam' })).status === 400);
ok('the site role cannot use it', (await wa(site, bk, { kind: 'thanks' })).status === 403);
ok('every share is audited', (await o.call('GET', '/api/audit?action=whatsapp_share')).data.audit.length >= 5);

await o.call('DELETE', `/api/sales/letter-templates/${dt.id}`);   // leave no template behind (the delete-rights suite looks for one)
await o.call('POST', '/api/settings/site.dual_signoff', { value: 'on' }); await o.call('POST', '/api/settings/sales.afs_gate', { value: 'on' });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
