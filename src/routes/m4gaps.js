// routes/m4gaps.js — Module 4 gaps, step 1: the 10% Agreement-for-Sale gate, the buyer's 1% TDS (s.194-IA) held until verified,
// the collections follow-up ladder, the 30/60/90-day inflow forecast, and bank follow-ups on home-loan-funded demands.
// Rates, thresholds and limits are Settings (confirm with your CA / advocate); nothing legal is hard-coded.
import { computeInterest } from './finance.js';

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const MONEY = ['owner', 'pm', 'accounts'];

// The 10% rule (MahaRERA s.13): more than 10% of the agreement value cannot be asked for before the Agreement for Sale is registered. Switch: sales.afs_gate (on unless Off).
export const afsGateOn = async (getSetting, env) => (await getSetting(env, 'sales.afs_gate')) !== 'off';

// 1% buyer TDS on a flat priced at or above the threshold (s.194-IA). Rate and threshold are Settings.
export async function tds194iaApplies(getSetting, env, agreedPaise) {
  if ((await getSetting(env, 'tax.tds_194ia_on')) === 'off') return false;
  const t = Number(await getSetting(env, 'tax.tds_194ia_threshold_paise')); const thr = Number.isFinite(t) && t > 0 ? t : 500000000;   // Rs 50 lakh
  return agreedPaise >= thr;
}

export function registerM4Gaps(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const ph = (a) => a.map(() => '?').join(',');
  const num = async (env, key, dflt) => { const v = Number(await getSetting(env, key)); return Number.isFinite(v) && v > 0 ? v : dflt; };

  // ---------- Buyer TDS credits ----------
  router.get('/api/sales/tds-credits', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { credits: [] } });
      const status = new URL(req.url).searchParams.get('status') || 'pending';
      const rows = (await env.DB.prepare(`SELECT t.id, t.amount_paise, t.status, t.challan_no, t.paid_on, t.form16b_doc_id, t.created_at, b.id AS booking_id, b.customer_name, i.wing, i.unit_no, r.receipt_no
        FROM sal_tds_credits t JOIN sal_bookings b ON b.id = t.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN sal_receipts r ON r.id = t.receipt_id
        WHERE b.project_id IN (${ph(ids)}) AND t.status = ? ORDER BY t.id LIMIT 200`).bind(...ids, status === 'verified' ? 'verified' : 'pending').all()).results;
      return json({ ok: true, data: { credits: rows, total_paise: rows.reduce((t, r) => t + r.amount_paise, 0) } });
    } catch (e) { return serverError(e, 'tds-credits'); }
  }));

  router.post('/api/sales/tds-credits/:id/verify', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return bad('Only Accounts or the Owner can verify the buyer\'s TDS.', 403);
      const c = await env.DB.prepare('SELECT t.*, b.project_id, b.customer_name FROM sal_tds_credits t JOIN sal_bookings b ON b.id = t.booking_id WHERE t.id = ?').bind(Number(req.params.id)).first();
      if (!c || !(await visibleProjectIds(env, req.user)).includes(c.project_id)) return bad('Not found.', 404);
      if (c.status !== 'pending') return bad('This TDS is already ' + c.status + '.', 409);
      const b = await req.json().catch(() => ({}));
      const challan = String(b.challan_no || '').trim().slice(0, 40);
      if (challan.length < 6) return bad('Enter the Form 26QB acknowledgement number from the challan.');
      if (!isDate(b.paid_on) || b.paid_on > todayIST()) return bad('Enter the date the buyer paid the TDS (not in the future).');
      let doc = null;
      if (b.form16b_doc_id) { doc = await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(b.form16b_doc_id), c.project_id).first(); if (!doc) return bad('The Form 16B / challan copy was not found.'); }
      const now = nowStr();
      const r = await env.DB.prepare("UPDATE sal_tds_credits SET status = 'verified', challan_no = ?, form16b_doc_id = ?, paid_on = ?, verified_by = ?, verified_at = ? WHERE id = ? AND status = 'pending'").bind(challan, doc ? doc.id : null, b.paid_on, req.user.user_id, now, c.id).run();
      if (!r.meta.changes) return bad('This TDS was just decided by someone else.', 409);
      await env.DB.batch([
        env.DB.prepare('UPDATE sal_receipts SET tds_paise = tds_paise + ? WHERE id = ?').bind(c.amount_paise, c.receipt_id),
        env.DB.prepare(`UPDATE sal_demands SET settled_paise = settled_paise + ?1, status = CASE WHEN settled_paise + ?1 >= amount_paise + COALESCE(gst_paise, 0) THEN 'paid' ELSE 'partial' END WHERE id = ?2 AND ?2 IS NOT NULL AND status != 'cancelled'`).bind(c.amount_paise, c.demand_id),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'tds_verify', 'sal_tds_credits', c.id, `Buyer TDS ${rupees(c.amount_paise)} of ${c.customer_name} verified (26QB ack ${challan}, paid ${b.paid_on})`.slice(0, 600), now),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'tds-verify'); }
  }));

  // ---------- Collections follow-up ladder: due soon, overdue, overdue 15+ days (with interest) ----------
  router.get('/api/sales/collections-ladder', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role) && req.user.role !== 'sales') return bad('Not allowed.', 403);
      const ids = await visibleProjectIds(env, req.user); const pid = Number(new URL(req.url).searchParams.get('project_id')) || 0;
      const scope = pid ? ids.filter((x) => x === pid) : ids.slice(0, 90); if (!scope.length) return json({ ok: true, data: { soon: [], late: [], late15: [], days_soon: 3 } });
      const today = todayIST(); const soonDays = await num(env, 'sales.remind_before_days', 3), longDays = await num(env, 'sales.remind_interest_days', 15);
      const mine = req.user.role === 'sales' && (await getSetting(env, 'sales.share_all_leads')) !== 'on' ? ' AND b.created_by = ' + Number(req.user.user_id) : '';
      const rows = (await env.DB.prepare(`SELECT d.id, d.booking_id, d.label, d.due_date, d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise AS due_paise, b.customer_name, b.phone, i.wing, i.unit_no, p.name AS project
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id
        WHERE d.status IN ('ready', 'partial') AND d.due_date IS NOT NULL AND d.due_date <= ? AND b.status != 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${ph(scope)})${mine}
          AND d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise > 0 ORDER BY d.due_date LIMIT 300`).bind(plusDays(today, soonDays), ...scope).all()).results;
      const out = { soon: [], late: [], late15: [], days_soon: soonDays, days_interest: longDays };
      for (const r of rows) { const late = daysBetween(r.due_date, today); r.days_late = late; (late > longDays - 1 ? out.late15 : late >= 1 ? out.late : out.soon).push(r); }
      if (out.late15.length) {
        const bookings = [...new Set(out.late15.map((r) => r.booking_id))].slice(0, 40);
        const { map } = await computeInterest(env, getSetting, bookings);
        for (const r of out.late15) { const b = map.get(r.booking_id); const d = b && b.demands.find((x) => x.demand_id === r.id); r.interest_paise = d ? Math.max(0, d.accrued_paise - d.waived_paise) : 0; }
      }
      return json({ ok: true, data: out });
    } catch (e) { return serverError(e, 'ladder'); }
  }));

  // ---------- Inflow forecast: demands falling due in the next 30 / 60 / 90 days, and the home-loan money still to come ----------
  router.get('/api/reports/collections-forecast', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const ids = await visibleProjectIds(env, req.user); const pid = Number(new URL(req.url).searchParams.get('project_id')) || 0;
      const scope = pid ? ids.filter((x) => x === pid) : ids.slice(0, 90); if (!scope.length) return json({ ok: true, data: { windows: [], loans_pending_paise: 0 } });
      const today = todayIST();
      const [loans, undated] = await Promise.all([
        env.DB.prepare(`SELECT COALESCE(SUM(l.sanction_paise - l.disbursed_paise), 0) AS v FROM sal_booking_loans l JOIN sal_bookings b ON b.id = l.booking_id WHERE l.deleted_at IS NULL AND b.status != 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${ph(scope)})`).bind(...scope).first(),
        env.DB.prepare(`SELECT COALESCE(SUM(d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise), 0) AS v, COUNT(*) AS n FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE d.status = 'scheduled' AND d.due_date IS NULL AND b.status != 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${ph(scope)})`).bind(...scope).first(),
      ]);
      const g = await env.DB.prepare(`SELECT CASE WHEN d.due_date <= ? THEN 0 WHEN d.due_date <= ? THEN 30 WHEN d.due_date <= ? THEN 60 WHEN d.due_date <= ? THEN 90 ELSE 999 END AS w,
          SUM(d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise) AS v, COUNT(*) AS n
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE d.status IN ('ready', 'partial', 'scheduled') AND d.due_date IS NOT NULL AND b.status != 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${ph(scope)})
        GROUP BY w`).bind(today, plusDays(today, 30), plusDays(today, 60), plusDays(today, 90), ...scope).all();
      const by = Object.fromEntries(g.results.map((r) => [r.w, r]));
      const win = (k, label) => ({ label, paise: by[k] ? by[k].v : 0, count: by[k] ? by[k].n : 0 });
      return json({ ok: true, data: { windows: [win(0, 'Already due'), win(30, 'Next 30 days'), win(60, '31 to 60 days'), win(90, '61 to 90 days')], later_paise: by[999] ? by[999].v : 0, undated_paise: undated.v, undated_count: undated.n, loans_pending_paise: loans.v,
        note: 'Demands are counted on their due date. Stages not yet certified have no date and are shown separately. The home-loan figure is what banks have sanctioned and not yet paid, with no date.' } });
    } catch (e) { return serverError(e, 'forecast'); }
  }));

  // ---------- Bank follow-ups: a demand on a booking with a home loan, unpaid some days after it fell due ----------
  router.get('/api/sales/bank-followups', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { followups: [], days: 10 } });
      const days = await num(env, 'sales.bank_followup_days', 10); const cutoff = plusDays(todayIST(), -days);
      const rows = (await env.DB.prepare(`SELECT d.id AS demand_id, d.label, d.due_date, d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise AS due_paise, b.id AS booking_id, b.customer_name, b.phone, i.wing, i.unit_no, p.name AS project,
          l.id AS loan_id, l.bank, l.sanction_paise, l.disbursed_paise, l.rm_name, l.rm_email, l.rm_phone, l.coordinator_email
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id
          JOIN sal_booking_loans l ON l.booking_id = b.id AND l.deleted_at IS NULL AND l.sanction_paise > l.disbursed_paise
        WHERE d.status IN ('ready', 'partial') AND d.due_date IS NOT NULL AND d.due_date <= ? AND b.status != 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${ph(ids)})
          AND d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise > 0 ORDER BY d.due_date LIMIT 200`).bind(cutoff, ...ids).all()).results;
      for (const r of rows) r.days_late = daysBetween(r.due_date, todayIST());
      return json({ ok: true, data: { followups: rows, days } });
    } catch (e) { return serverError(e, 'bank-followups'); }
  }));
}
