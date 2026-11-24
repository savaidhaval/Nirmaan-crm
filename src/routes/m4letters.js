// routes/m4letters.js — Module 4, step 2: letters that staff download in Word and send themselves (a custom demand letter per milestone, a general
// allotment letter), "sent" marks kept by hand, and the cancellation refund waterfall. The wording is the advocate's: nothing legal is built in beyond a plain
// starting text that can be replaced, and every figure that can change is a Setting (confirm with your CA / advocate).
import { ensureDemandNumber } from './sales3.js';
import { computeInterest } from './finance.js';

const rupees = (p) => '₹ ' + (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const longDate = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? '' : `${d.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const MANAGE = ['owner', 'pm', 'accounts'];
const SENT_VIA = ['email', 'whatsapp', 'hand', 'courier', 'other'];

// Indian number words: 12,50,000 -> "Twelve Lakh Fifty Thousand Rupees Only"
export function rupeesInWords(paise) {
  let n = Math.floor(Number(paise || 0) / 100); if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const parts = []; const cr = Math.floor(n / 10000000); n %= 10000000; const lk = Math.floor(n / 100000); n %= 100000; const th = Math.floor(n / 1000); n %= 1000;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (n) parts.push(three(n));
  return parts.join(' ') + ' Rupees Only';
}

export const DEFAULT_DEMAND = `{{date}}
Ref: {{demand_no}}

To,
{{customer_name}}
{{address}}

Subject: Demand for payment, {{stage_name}}. Flat No. {{flat_no}}, {{project}} (MahaRERA Registration No. {{rera_no}})

Dear Sir / Madam,

We are pleased to inform you that the work of "{{stage_name}}" has been completed at the above project, as certified by our Architect. As per the payment schedule agreed with you, the following instalment is now due:

Instalment: {{stage_name}}
Amount: {{demand_amount}}
GST: {{gst_amount}}
Total payable: {{total_due}} ({{total_due_words}})
Due date: {{due_date}}
{{arrears_line}}
Please make the payment on or before the due date by cheque, RTGS or NEFT in favour of the project's RERA Collection Account:
{{bank_details}}

Interest on delayed payment will be charged as per the Agreement for Sale and the RERA rules.{{interest_line}} If you have already paid, please ignore this letter and send us the payment details.

Thanking you,
Yours faithfully,
For {{company}}

{{signatory}}`;

export const DEFAULT_ALLOTMENT = `{{date}}

To,
{{customer_name}}
{{address}}

ALLOTMENT LETTER

Project: {{project}} (MahaRERA Registration No. {{rera_no}})

Dear Sir / Madam,

We are pleased to allot to you Flat No. {{flat_no}} (RERA carpet area {{carpet_area}} sq. ft.) in the above project, for a total consideration of {{agreement_value}} ({{agreement_value_words}}), excluding GST, stamp duty, registration and other charges as applicable. You have paid {{token_amount}} on {{booking_date}} towards the booking.

Payment schedule:
{{payment_schedule}}

{{other_details}}

The Agreement for Sale will be executed and registered as required by law. This allotment is subject to the terms of the Agreement for Sale.

Yours faithfully,
For {{company}}

{{signatory}}`;


export const DEFAULT_AGREEMENT = `{{draft_notice}}
AGREEMENT FOR SALE

This Agreement for Sale is made at Mumbai on {{agreement_date}}

BETWEEN

{{company}}, the Promoter of the project "{{project}}", registered under the Real Estate (Regulation and Development) Act, 2016 with MahaRERA Registration No. {{rera_no}}, hereinafter called the "Promoter" (which expression includes its successors and assigns) of the ONE PART

AND

{{customer_name}}, residing at {{address}}, hereinafter called the "Allottee" (which expression includes heirs, executors, administrators, successors and permitted assigns) of the OTHER PART.

WHEREAS

A. The Promoter is developing the project "{{project}}" on the land described in the Schedule, as per the plans and permissions sanctioned by the Planning Authority, and has registered it with the Maharashtra Real Estate Regulatory Authority.

B. The Allottee has applied for Flat No. {{flat_no}} on Floor {{floor}} (RERA carpet area {{carpet_area}} sq. ft.) in the project, and has paid {{token_amount}} on {{booking_date}} as booking amount, the receipt of which the Promoter acknowledges.

C. The parties desire to record the terms on which the Promoter agrees to sell and the Allottee agrees to purchase the said flat.

NOW THIS AGREEMENT WITNESSETH AS FOLLOWS:

1. SALE AND CONSIDERATION
1.1 The Promoter agrees to sell and the Allottee agrees to purchase the said flat for a total consideration of {{agreement_value}} ({{agreement_value_words}}), exclusive of GST, stamp duty, registration fees and other charges payable as per law.
1.2 The consideration is payable in the following instalments:
{{payment_schedule}}
1.3 All payments are to be made to the project's RERA designated collection account:
{{bank_details}}
1.4 Not less than seventy per cent (70%) of the amounts received from allottees is deposited in the separate designated account and used only as the RERA permits.

2. DELAYED PAYMENT
If the Allottee fails to pay any instalment on its due date, the Allottee shall pay interest on the delayed amount at the rate of {{interest_rate}} per annum, calculated from the due date to the date of payment.

3. POSSESSION
3.1 The Promoter shall give possession of the flat to the Allottee on or before {{possession_date}}, subject to force majeure and the Allottee having paid all dues.
3.2 If the Promoter fails to give possession by that date, the Promoter shall pay interest to the Allottee as the RERA and the Rules provide.

4. DEFECT LIABILITY
If, within {{defect_years}} years from the date of possession, any structural defect or defect in workmanship, quality or provision of services is brought to the Promoter's notice in writing, the Promoter shall rectify it at its own cost within thirty days, as the RERA provides.

5. CANCELLATION AND REFUND
Cancellation and refund will be governed by the RERA and the Rules made under it. The Promoter may retain only such part of the booking amount as the law allows and shall refund the balance within the period the law allows.

6. REGISTRATION AND STAMP DUTY
This Agreement shall be presented for registration within the time the law allows. Stamp duty, registration fees and GST are borne by the Allottee as per law.

7. GENERAL
7.1 Notices shall be sent to the addresses above, by registered post or by email to {{email}}.
7.2 This Agreement is governed by the laws of India and the courts at Mumbai have jurisdiction, subject to the provisions of the RERA.
7.3 {{other_details}}

SCHEDULE: Description of the land, the project and the flat to be added by the advocate.

IN WITNESS WHEREOF the parties have signed this Agreement on the date first written above.

For {{company}}                                          Allottee(s)
{{signatory}}                                            {{customer_name}}

Witness 1: ______________________        Witness 2: ______________________`;

export function registerM4Letters(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, printBrand } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const setting = async (env, key, d = '') => { const v = await getSetting(env, key); return v == null ? d : String(v); };

  const common = async (env, booking) => {
    const [unit, proj, parties, stages] = await Promise.all([
      env.DB.prepare('SELECT wing, unit_no, floor, rera_carpet_sqft, carpet_sqft FROM sal_inventory WHERE id = ?').bind(booking.unit_id).first(),
      env.DB.prepare('SELECT name, rera_no FROM projects WHERE id = ?').bind(booking.project_id).first(),
      env.DB.prepare('SELECT name FROM sal_booking_parties WHERE booking_id = ? AND deleted_at IS NULL ORDER BY id').bind(booking.id).all(),
      env.DB.prepare('SELECT stage_name, pct_bp FROM sal_plan_stages WHERE project_id = ? AND retired = 0 ORDER BY sort_order, id').bind(booking.project_id).all(),
    ]);
    const brand = await printBrand(env, booking.project_id).catch(() => ({}));
    const co = (parties.results || []).map((p) => p.name).filter(Boolean);
    const flat = `${unit && unit.wing ? unit.wing + '-' : ''}${unit ? unit.unit_no : ''}`;
    const agreed = booking.agreed_price_paise || 0;
    return {
      date: longDate(todayIST()), customer_name: [booking.customer_name, ...co].join(' and '), address: booking.address || '', phone: booking.phone || '', email: booking.email || '',
      project: proj ? proj.name : '', rera_no: proj ? proj.rera_no || '' : '', flat_no: flat, wing: unit ? unit.wing || '' : '', floor: unit && unit.floor != null ? String(unit.floor) : '',
      carpet_area: unit ? String(unit.rera_carpet_sqft || unit.carpet_sqft || '') : '', agreement_value: rupees(agreed), agreement_value_words: rupeesInWords(agreed),
      token_amount: rupees(booking.token_paise), booking_date: booking.booking_date ? longDate(booking.booking_date) : '',
      payment_schedule: (stages.results || []).map((s, i) => `${i + 1}. ${s.stage_name}: ${(s.pct_bp / 100).toFixed(s.pct_bp % 100 ? 2 : 0)}% (${rupees(Math.round(agreed * s.pct_bp / 10000))})`).join('\n'),
      company: brand.trade_name || brand.legal_name || '', signatory: await setting(env, 'sales.letter_signatory', 'Authorised Signatory'), other_details: '',
      bank_details: await setting(env, 'sales.collection_account_text', '(add the RERA Collection Account details in Settings: sales.collection_account_text)'),
    };
  };

  const templateFor = async (env, projectId, kind, stageId) => {
    if (stageId) { const t = await env.DB.prepare('SELECT * FROM sal_letter_templates WHERE project_id = ? AND kind = ? AND stage_id = ?').bind(projectId, kind, stageId).first(); if (t) return { ...t, source: 'stage' }; }
    const g = await env.DB.prepare('SELECT * FROM sal_letter_templates WHERE project_id = ? AND kind = ? AND stage_id IS NULL').bind(projectId, kind).first();
    if (g) return { ...g, source: 'project' };
    return { body: kind === 'demand' ? DEFAULT_DEMAND : kind === 'agreement' ? DEFAULT_AGREEMENT : DEFAULT_ALLOTMENT, doc_id: null, source: 'built-in' };
  };

  // ---------- templates ----------
  router.get('/api/sales/letter-templates', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const [tpl, stages] = await Promise.all([
        env.DB.prepare('SELECT t.id, t.kind, t.stage_id, t.title, t.body, t.doc_id, t.updated_at, t.reviewed_by, t.reviewed_on, s.stage_name FROM sal_letter_templates t LEFT JOIN sal_plan_stages s ON s.id = t.stage_id WHERE t.project_id = ? ORDER BY t.kind, t.stage_id').bind(pid).all(),
        env.DB.prepare('SELECT id, stage_name, milestone_key FROM sal_plan_stages WHERE project_id = ? AND retired = 0 ORDER BY sort_order, id').bind(pid).all(),
      ]);
      return json({ ok: true, data: { templates: tpl.results, stages: stages.results, defaults: { demand: DEFAULT_DEMAND, allotment: DEFAULT_ALLOTMENT, agreement: DEFAULT_AGREEMENT },
        fields: ['date', 'customer_name', 'address', 'phone', 'email', 'project', 'rera_no', 'flat_no', 'wing', 'floor', 'carpet_area', 'agreement_value', 'agreement_value_words', 'token_amount', 'booking_date', 'payment_schedule', 'company', 'signatory', 'other_details', 'demand_no', 'stage_name', 'demand_amount', 'gst_amount', 'total_due', 'total_due_words', 'due_date', 'arrears_line', 'interest_line', 'bank_details', 'agreement_date', 'possession_date', 'defect_years', 'interest_rate', 'draft_notice'] } });
    } catch (e) { return serverError(e, 'letter-templates'); }
  }));

  router.post('/api/sales/letter-templates', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!MANAGE.includes(req.user.role)) return bad('Only the Owner, PM or Accounts can change letter templates.', 403);
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      if (!['demand', 'allotment', 'agreement'].includes(b.kind)) return bad('Pick demand letter, allotment letter or agreement.');
      const stageId = b.kind === 'demand' && b.stage_id ? Number(b.stage_id) : null;
      if (stageId && !(await env.DB.prepare('SELECT id FROM sal_plan_stages WHERE id = ? AND project_id = ?').bind(stageId, pid).first())) return bad('That payment stage is not in this project.');
      const body = String(b.body || '').slice(0, 20000); const docId = b.doc_id ? Number(b.doc_id) : null;
      if (!body.trim() && !docId) return bad('Write the letter text, or upload a Word template.');
      if (docId && !(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(docId, pid).first())) return bad('The Word template was not found.');
      await env.DB.prepare(`INSERT INTO sal_letter_templates (project_id, kind, stage_id, title, body, doc_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, kind, COALESCE(stage_id, 0)) DO UPDATE SET title = excluded.title, body = excluded.body, doc_id = excluded.doc_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at, reviewed_by = NULL, reviewed_on = NULL`)
        .bind(pid, b.kind, stageId, String(b.title || '').slice(0, 80) || null, body.trim() ? body : null, docId, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'letter_template', 'sal_letter_templates', pid, `${b.kind} letter template saved${stageId ? ' for a stage' : ''}${docId ? ' (Word file)' : ''}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'letter-template-save'); }
  }));

  router.delete('/api/sales/letter-templates/:id', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!MANAGE.includes(req.user.role)) return bad('Not allowed.', 403);
      const t = await env.DB.prepare('SELECT id, project_id, kind FROM sal_letter_templates WHERE id = ?').bind(Number(req.params.id)).first();
      if (!t || !(await visibleProjectIds(env, req.user)).includes(t.project_id)) return bad('Not found.', 404);
      await env.DB.prepare('DELETE FROM sal_letter_templates WHERE id = ?').bind(t.id).run();
      await audit(env, req.user, 'letter_template_delete', 'sal_letter_templates', t.id, `${t.kind} letter template removed; the built-in text is used again`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'letter-template-delete'); }
  }));

  // ---------- one demand letter ----------
  const demandOf = async (env, req) => {
    const d = await env.DB.prepare('SELECT d.*, b.project_id FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE d.id = ?').bind(Number(req.params.id)).first();
    if (!d || !(await visibleProjectIds(env, req.user)).includes(d.project_id)) return { err: bad('Demand not found.', 404) };
    return { d };
  };

  router.get('/api/sales/demands/:id/letter', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MANAGE, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { d, err } = await demandOf(env, req); if (err) return err;
      if (d.status === 'scheduled' || d.status === 'cancelled') return bad('This demand is not ready, so there is no letter to make yet.', 409);
      const booking = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ?').bind(d.booking_id).first();
      const f = await common(env, booking);
      const demandNo = await ensureDemandNumber(env, d.id);
      const due = d.amount_paise + (d.gst_paise || 0) - d.settled_paise;
      const [arr, interest] = await Promise.all([
        env.DB.prepare("SELECT COALESCE(SUM(amount_paise + COALESCE(gst_paise, 0) - settled_paise), 0) AS a FROM sal_demands WHERE booking_id = ? AND id != ? AND status IN ('ready', 'partial') AND due_date IS NOT NULL AND due_date < ?").bind(d.booking_id, d.id, todayIST()).first(),
        computeInterest(env, getSetting, [d.booking_id]),
      ]);
      const row = interest.map.get(d.booking_id); const accrued = row ? row.demands.reduce((t, x) => t + Math.max(0, x.accrued_paise - x.waived_paise), 0) : 0;
      Object.assign(f, { demand_no: demandNo || '', stage_name: d.label, demand_amount: rupees(d.amount_paise), gst_amount: rupees(d.gst_paise || 0), total_due: rupees(due), total_due_words: rupeesInWords(due), due_date: d.due_date ? longDate(d.due_date) : 'on receipt',
        arrears_line: arr.a > 0 ? `Earlier instalments overdue: ${rupees(arr.a)}` : '', interest_line: accrued > 0 ? ` Interest accrued so far on your account is ${rupees(accrued)}.` : '' });
      const stage = d.stage_id ? d.stage_id : null;
      const tpl = await templateFor(env, d.project_id, 'demand', stage);
      return json({ ok: true, data: { fields: f, template: { body: tpl.body, doc_id: tpl.doc_id, source: tpl.source }, sent_at: d.sent_at, sent_via: d.sent_via, customer: booking.customer_name } });
    } catch (e) { return serverError(e, 'demand-letter'); }
  }));

  router.post('/api/sales/demands/:id/mark-sent', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (![...MANAGE, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { d, err } = await demandOf(env, req); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (b.sent === false) {
        await env.DB.prepare('UPDATE sal_demands SET sent_at = NULL, sent_via = NULL, sent_by = NULL WHERE id = ?').bind(d.id).run();
        await audit(env, req.user, 'demand_unsent', 'sal_demands', d.id, `Demand letter "${d.label}" un-marked as sent`);
        return json({ ok: true });
      }
      const via = SENT_VIA.includes(b.via) ? b.via : 'email';
      await env.DB.prepare('UPDATE sal_demands SET sent_at = COALESCE(sent_at, ?), sent_via = ?, sent_by = ? WHERE id = ?').bind(nowStr(), via, req.user.user_id, d.id).run();
      await audit(env, req.user, 'demand_sent', 'sal_demands', d.id, `Demand letter "${d.label}" marked as sent by ${via}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'demand-mark-sent'); }
  }));

  // ---------- allotment letter ----------
  const bookingOf = async (env, req) => {
    const b = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!b || !(await visibleProjectIds(env, req.user)).includes(b.project_id)) return { err: bad('Booking not found.', 404) };
    return { b };
  };
  router.get('/api/sales/bookings/:id/allotment-letter', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MANAGE, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req); if (err) return err;
      const fields = await common(env, b); const tpl = await templateFor(env, b.project_id, 'allotment', null);
      return json({ ok: true, data: { fields, template: { body: tpl.body, doc_id: tpl.doc_id, source: tpl.source }, sent_at: b.allotment_sent_at, sent_via: b.allotment_sent_via, customer: b.customer_name } });
    } catch (e) { return serverError(e, 'allotment-letter'); }
  }));
  router.post('/api/sales/bookings/:id/allotment-sent', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (![...MANAGE, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req); if (err) return err;
      const body = await req.json().catch(() => ({}));
      if (body.sent === false) { await env.DB.prepare('UPDATE sal_bookings SET allotment_sent_at = NULL, allotment_sent_by = NULL, allotment_sent_via = NULL WHERE id = ?').bind(b.id).run(); await audit(env, req.user, 'allotment_unsent', 'sal_bookings', b.id, `Allotment letter of ${b.customer_name} un-marked as sent`); return json({ ok: true }); }
      const via = SENT_VIA.includes(body.via) ? body.via : 'email';
      await env.DB.prepare('UPDATE sal_bookings SET allotment_sent_at = COALESCE(allotment_sent_at, ?), allotment_sent_by = ?, allotment_sent_via = ? WHERE id = ?').bind(nowStr(), req.user.user_id, via, b.id).run();
      await audit(env, req.user, 'allotment_sent', 'sal_bookings', b.id, `Allotment letter of ${b.customer_name} marked as sent by ${via}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'allotment-sent'); }
  }));


  // ---------- Agreement for Sale (starting text only; the advocate's approval is recorded before it is treated as final) ----------
  router.post('/api/sales/letter-templates/:id/review', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can record the advocate\'s approval.', 403);
      const t = await env.DB.prepare('SELECT id, project_id, kind FROM sal_letter_templates WHERE id = ?').bind(Number(req.params.id)).first();
      if (!t || !(await visibleProjectIds(env, req.user)).includes(t.project_id)) return bad('Not found.', 404);
      if (t.kind !== 'agreement') return bad('Only the Agreement for Sale needs an advocate\'s approval mark.');
      const b = await req.json().catch(() => ({}));
      const name = String(b.advocate || '').trim();
      if (name.length < 3) return bad('Type the advocate\'s name who approved this wording.');
      await env.DB.prepare('UPDATE sal_letter_templates SET reviewed_by = ?, reviewed_on = ? WHERE id = ?').bind(name.slice(0, 80), todayIST(), t.id).run();
      await audit(env, req.user, 'agreement_reviewed', 'sal_letter_templates', t.id, `Agreement for Sale wording marked as approved by advocate ${name.slice(0, 80)}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'agreement-review'); }
  }));

  router.get('/api/sales/bookings/:id/agreement', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MANAGE, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req); if (err) return err;
      if (b.status === 'cancelled') return bad('This booking is cancelled, so there is no agreement to make.', 409);
      const f = await common(env, b);
      const proj = await env.DB.prepare('SELECT target_date FROM projects WHERE id = ?').bind(b.project_id).first();
      const tpl = await templateFor(env, b.project_id, 'agreement', null);
      const reviewed = tpl.source !== 'built-in' && !!tpl.reviewed_on;
      const bp = Number(await setting(env, 'interest.rate_bp', '1100')) || 1100;
      Object.assign(f, { agreement_date: longDate(todayIST()), possession_date: proj && proj.target_date ? longDate(proj.target_date) : '[date of possession: fill in]',
        defect_years: await setting(env, 'sales.agreement_defect_years', '5'), interest_rate: (bp / 100).toFixed(bp % 100 ? 2 : 0) + '%',
        draft_notice: reviewed ? '' : "DRAFT FOR THE ADVOCATE'S REVIEW. NOT FOR SIGNING." });
      await audit(env, req.user, 'agreement_prepared', 'sal_bookings', b.id, `Agreement for Sale of ${b.customer_name} prepared (${reviewed ? 'advocate-approved wording' : 'wording NOT yet approved by an advocate'})`);
      return json({ ok: true, data: { fields: f, template: { body: tpl.body, doc_id: tpl.doc_id, source: tpl.source, id: tpl.id || null }, reviewed, reviewed_by: tpl.reviewed_by || null, reviewed_on: tpl.reviewed_on || null, customer: b.customer_name } });
    } catch (e) { return serverError(e, 'agreement'); }
  }));

  // ---------- WhatsApp share: builds the message and the wa.me link; the user taps Send in WhatsApp. No WhatsApp API, nothing is sent from the server. ----------
  router.post('/api/sales/bookings/:id/whatsapp', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (![...MANAGE, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req); if (err) return err;
      const body = await req.json().catch(() => ({}));
      const kind = String(body.kind || '');
      if (!['demand', 'receipt', 'balance', 'agreement', 'thanks'].includes(kind)) return bad('Pick what to send.');
      const ph = String(b.phone || '').replace(/\D/g, '').slice(-10);
      if (ph.length !== 10) return bad('This customer has no 10-digit mobile number on file.');
      const f = await common(env, b); const co = f.company || 'our team'; const hi = `Dear ${b.customer_name},`;
      let text;
      if (kind === 'demand') {
        const d = await env.DB.prepare('SELECT * FROM sal_demands WHERE id = ? AND booking_id = ?').bind(Number(body.demand_id), b.id).first();
        if (!d) return bad('Demand not found.', 404);
        if (['scheduled', 'cancelled'].includes(d.status)) return bad('This demand is not ready to send.', 409);
        const due = d.amount_paise + (d.gst_paise || 0) - d.settled_paise;
        if (due <= 0) return bad('This demand is already paid.', 409);
        text = `${hi}\nYour instalment "${d.label}" for Flat ${f.flat_no}, ${f.project} is ready. Amount due: ${rupees(due)}${d.due_date ? ', on or before ' + longDate(d.due_date) : ''}.\nPlease pay to the RERA collection account: ${f.bank_details}\nIf you have already paid, please share the payment details.\n- ${co}`;
      } else if (kind === 'receipt') {
        const r = await env.DB.prepare('SELECT * FROM sal_receipts WHERE id = ? AND booking_id = ? AND reversed_at IS NULL').bind(Number(body.receipt_id), b.id).first();
        if (!r) return bad('Receipt not found.', 404);
        text = `${hi}\nWe have received ${rupees(r.amount_paise)} on ${longDate(r.received_on)} for Flat ${f.flat_no}, ${f.project}${r.kind === 'interest' ? ' (interest on delayed payment)' : ''}. Receipt no. ${r.receipt_no || ''}. Thank you.\n- ${co}`;
      } else if (kind === 'balance') {
        const [due, interest] = await Promise.all([
          env.DB.prepare("SELECT COALESCE(SUM(amount_paise + COALESCE(gst_paise, 0) - settled_paise), 0) AS a FROM sal_demands WHERE booking_id = ? AND status IN ('ready', 'partial')").bind(b.id).first(),
          computeInterest(env, getSetting, [b.id]),
        ]);
        const row = interest.map.get(b.id); const acc = row ? row.demands.reduce((t, x) => t + Math.max(0, x.accrued_paise - x.waived_paise), 0) : 0;
        text = `${hi}\nYour account for Flat ${f.flat_no}, ${f.project}: instalments due now ${rupees(due.a)}${acc > 0 ? `; interest on delayed payment so far ${rupees(acc)}` : ''}. Please contact us for the full statement.\n- ${co}`;
      } else if (kind === 'agreement') {
        text = `${hi}\nThe Agreement for Sale for Flat ${f.flat_no}, ${f.project} is ready for your review. Please call us to fix a date for signing and registration.\n- ${co}`;
      } else {
        text = `${hi}\nThank you for choosing Flat ${f.flat_no} at ${f.project}. We will stay in touch with the next steps.\n- ${co}`;
      }
      await audit(env, req.user, 'whatsapp_share', 'sal_bookings', b.id, `WhatsApp ${kind} message prepared for ${b.customer_name}`);
      return json({ ok: true, data: { phone: '91' + ph, text, url: `https://wa.me/91${ph}?text=${encodeURIComponent(text)}` } });
    } catch (e) { return serverError(e, 'whatsapp-share'); }
  }));

  // ---------- cancellation refund waterfall ----------
  // What the buyer paid, what may be kept (the cap is a Setting, 10% of the consideration to begin with, per the booking-amount rule in the MahaRERA model
  // Agreement for Sale), and what goes back, with the date it is due. Brokerage already paid and any administrative charge count inside the same cap.
  router.get('/api/sales/bookings/:id/cancel-waterfall', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MANAGE.includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req); if (err) return err;
      const [paid, brok, gstRow, tdsOpen] = await Promise.all([
        env.DB.prepare("SELECT COALESCE(SUM(amount_paise + tds_paise), 0) AS p FROM sal_receipts WHERE booking_id = ? AND reversed_at IS NULL AND kind = 'principal'").bind(b.id).first(),
        env.DB.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS p FROM sal_brokerage_payments WHERE booking_id = ? AND reversed_at IS NULL').bind(b.id).first(),
        env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN amount_paise + COALESCE(gst_paise, 0) > 0 THEN gst_paise * settled_paise / (amount_paise + COALESCE(gst_paise, 0)) ELSE 0 END), 0) AS g FROM sal_demands WHERE booking_id = ? AND status != 'cancelled'").bind(b.id).first(),
        env.DB.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS t FROM sal_tds_credits WHERE booking_id = ? AND status = 'pending'").bind(b.id).first(),
      ]);
      const url = new URL(req.url).searchParams;
      const capBp = Math.min(10000, Math.max(0, Math.round(Number(await getSetting(env, 'sales.cancel_cap_bp')) || 1000)));
      const refundDays = Math.max(0, Math.round(Number(await getSetting(env, 'sales.refund_days')) || 45));
      const admin = Math.max(0, Math.round(Number(url.get('admin_paise')) || Math.round(Number(await getSetting(env, 'sales.cancel_admin_paise')) || 0)));
      const maxKeep = Math.floor((b.agreed_price_paise || 0) * capBp / 10000);
      const brokerage = Math.round(Number(brok.p)); const includeBrokerage = url.get('brokerage') !== '0';
      const paidP = Math.round(Number(paid.p));
      const room = Math.max(0, Math.min(maxKeep, paidP));
      const brokerageUsed = includeBrokerage ? Math.min(brokerage, room) : 0;
      const adminUsed = Math.min(admin, Math.max(0, room - brokerageUsed));
      const forfeit = Math.max(0, room - brokerageUsed - adminUsed);
      const refund = Math.max(0, paidP - brokerageUsed - adminUsed - forfeit);
      const from = b.cancelled_on || todayIST();
      return json({ ok: true, data: { paid_paise: paidP, consideration_paise: b.agreed_price_paise, cap_bp: capBp, max_keep_paise: maxKeep, brokerage_paid_paise: brokerage, brokerage_deducted_paise: brokerageUsed,
        admin_deducted_paise: adminUsed, forfeit_paise: forfeit, refund_paise: refund, refund_due_on: plusDays(from, refundDays), refund_days: refundDays, gst_in_paid_paise: Math.round(Number(gstRow.g)), buyer_tds_unverified_paise: Math.round(Number(tdsOpen.t)),
        notes: [`The booking amount that may be kept is at most ${(capBp / 100).toFixed(2)}% of the consideration (${rupees(maxKeep)}); brokerage already paid and any administrative charge count inside that limit, as the MahaRERA model agreement allows only a booking-amount forfeiture. Confirm with your advocate.`,
          `The balance is to be returned within ${refundDays} days of the cancellation.`, 'GST collected on instalments is adjusted by a credit note and is not a deduction.',
          ...(tdsOpen.t ? ['Part of the money the buyer deducted as TDS is not yet verified; the buyer claims that from the Income-tax Department, so it is not refunded by you.'] : [])] } });
    } catch (e) { return serverError(e, 'cancel-waterfall'); }
  }));
}
