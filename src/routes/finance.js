// routes/finance.js — late-payment interest, project financials, vendor TDS/GST, Tally exports, customer statement.

const MONEY = ['owner', 'pm', 'accounts'];
const day = (s) => Date.parse(String(s).substring(0, 10) + 'T00:00:00Z');
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 86400000);
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const todayIST = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);

// ---------- Interest (simple, per day, on the late portion) ----------
export async function interestSettings(env, getSetting) {
  const rate = Number(await getSetting(env, 'interest.rate_bp'));
  const grace = Number(await getSetting(env, 'interest.grace_days'));
  const on = (await getSetting(env, 'interest.enabled')) !== 'off';
  return { enabled: on, rateBp: Number.isFinite(rate) && rate > 0 ? rate : 1100, graceDays: Number.isFinite(grace) && grace >= 0 ? grace : 0 };
}

// bookingIds: array. Returns Map(bookingId -> { demands:[…], accrued, waived, paid, due })
export async function computeInterest(env, getSetting, bookingIds, asOf = todayIST()) {
  const out = new Map();
  const cfg = await interestSettings(env, getSetting);
  if (!bookingIds.length) return { map: out, cfg };
  const ph = bookingIds.map(() => '?').join(',');
  const dem = (await env.DB.prepare(`SELECT id, booking_id, label, amount_paise, COALESCE(gst_paise, 0) AS gst_paise, due_date, status FROM sal_demands WHERE booking_id IN (${ph}) AND due_date IS NOT NULL AND status NOT IN ('cancelled', 'scheduled')`).bind(...bookingIds).all()).results;
  const ids = dem.map((d) => d.id);
  const rec = ids.length ? (await env.DB.prepare(`SELECT demand_id, amount_paise + tds_paise AS amt, received_on FROM sal_receipts WHERE demand_id IN (${ids.map(() => '?').join(',')}) AND reversed_at IS NULL AND kind = 'principal' ORDER BY received_on, id`).bind(...ids).all()).results : [];
  const waived = ids.length ? (await env.DB.prepare(`SELECT demand_id, SUM(amount_paise) AS w FROM sal_interest_waivers WHERE demand_id IN (${ids.map(() => '?').join(',')}) AND status = 'approved' GROUP BY demand_id`).bind(...ids).all()).results : [];
  const paidInt = (await env.DB.prepare(`SELECT booking_id, SUM(amount_paise) AS p FROM sal_receipts WHERE booking_id IN (${ph}) AND reversed_at IS NULL AND kind = 'interest' GROUP BY booking_id`).bind(...bookingIds).all()).results;
  const wMap = Object.fromEntries(waived.map((w) => [w.demand_id, w.w]));
  for (const id of bookingIds) out.set(id, { demands: [], accrued: 0, waived: 0, paid: 0, due: 0 });
  for (const d of dem) {
    const total = d.amount_paise + d.gst_paise;
    const start = new Date(day(d.due_date) + cfg.graceDays * 86400000).toISOString().substring(0, 10);
    let remaining = total; let accrued = 0; let lateDays = 0;
    for (const r of rec.filter((x) => x.demand_id === d.id)) {
      const portion = Math.min(r.amt, remaining); remaining -= portion;
      const dd = Math.max(0, daysBetween(start, r.received_on));
      lateDays = Math.max(lateDays, dd);
      accrued += (portion * cfg.rateBp * dd) / (10000 * 365);
    }
    if (remaining > 0) { const dd = Math.max(0, daysBetween(start, asOf)); lateDays = Math.max(lateDays, dd); accrued += (remaining * cfg.rateBp * dd) / (10000 * 365); }
    accrued = cfg.enabled ? Math.round(accrued) : 0;
    const w = Math.min(wMap[d.id] || 0, accrued);
    const row = out.get(d.booking_id);
    row.demands.push({ demand_id: d.id, label: d.label, due_date: d.due_date, days_late: lateDays, outstanding_paise: Math.max(remaining, 0), accrued_paise: accrued, waived_paise: w });
    row.accrued += accrued; row.waived += w;
  }
  for (const p of paidInt) if (out.has(p.booking_id)) out.get(p.booking_id).paid = p.p;
  for (const row of out.values()) row.due = Math.max(row.accrued - row.waived - row.paid, 0);
  return { map: out, cfg };
}

export function registerFinance(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, userCan, getSetting, nowStr, encryptSetting, decryptSetting } = h;
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const ph = (a) => a.map(() => '?').join(',');

  async function bookingAccess(env, user, id) {
    const b = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!b) return { err: json({ ok: false, error: 'Booking not found.' }, 404) };
    if (!(await visibleProjectIds(env, user)).includes(b.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { b };
  }

  router.get('/api/sales/bookings/:id/interest', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const { b, err } = await bookingAccess(env, req.user, Number(req.params.id));
      if (err) return err;
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(new URL(req.url).searchParams.get('as_of') || '') ? new URL(req.url).searchParams.get('as_of') : todayIST();
      const { map, cfg } = await computeInterest(env, getSetting, [b.id], asOf);
      const waivers = (await env.DB.prepare('SELECT w.*, d.label FROM sal_interest_waivers w JOIN sal_demands d ON d.id = w.demand_id WHERE d.booking_id = ? ORDER BY w.id DESC').bind(b.id).all()).results;
      return json({ ok: true, data: { as_of: asOf, rate_bp: cfg.rateBp, grace_days: cfg.graceDays, enabled: cfg.enabled, ...map.get(b.id), waivers,
        note: 'Simple interest per day on the late amount at the configured rate (RERA: SBI highest MCLR + 2%). Confirm the rate with your advocate.' } });
    } catch (e) { return serverError(e, 'interest'); }
  }));

  // Waiver: the Owner may waive with a reason (audited). A PM or Accounts can only request; the Owner approves (never the requester).
  router.post('/api/sales/demands/:id/interest-waiver', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const d = await env.DB.prepare('SELECT d.*, b.project_id, b.customer_name FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE d.id = ?').bind(Number(req.params.id)).first();
      if (!d || !(await visibleProjectIds(env, req.user)).includes(d.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the waiver.' }, 400);
      const { map } = await computeInterest(env, getSetting, [d.booking_id]);
      const row = map.get(d.booking_id).demands.find((x) => x.demand_id === d.id);
      const room = row ? row.accrued_paise - row.waived_paise : 0;
      const amount = Math.round(Number(b.amount_paise) || room);
      if (!(amount > 0) || amount > room) return json({ ok: false, error: `Interest available to waive on this demand is ${rupees(room)}.` }, 400);
      const owner = req.user.role === 'owner';
      const r = await env.DB.prepare('INSERT INTO sal_interest_waivers (demand_id, amount_paise, reason, status, requested_by, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(d.id, amount, String(b.reason).slice(0, 300), owner ? 'approved' : 'requested', req.user.user_id, owner ? req.user.user_id : null, nowStr()).run();
      await audit(env, req.user, owner ? 'interest_waived' : 'interest_waiver_request', 'sal_interest_waivers', r.meta.last_row_id, `Interest ${rupees(amount)} on "${d.label}" for ${d.customer_name} ${owner ? 'waived' : 'waiver requested'}. Reason: ${b.reason}`);
      return json({ ok: true, data: { id: r.meta.last_row_id, status: owner ? 'approved' : 'requested' } });
    } catch (e) { return serverError(e, 'waiver'); }
  }));

  const waiverAct = (verb, status) => router.post(`/api/sales/waivers/:id/${verb}`, async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can decide a waiver.' }, 403);
      const w = await env.DB.prepare('SELECT w.*, b.project_id FROM sal_interest_waivers w JOIN sal_demands d ON d.id = w.demand_id JOIN sal_bookings b ON b.id = d.booking_id WHERE w.id = ?').bind(Number(req.params.id)).first();
      if (!w || !(await visibleProjectIds(env, req.user)).includes(w.project_id)) return json({ ok: false, error: 'Not found.' }, 404);
      if (w.status !== 'requested') return json({ ok: false, error: 'Already decided.' }, 400);
      if (w.requested_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve your own request.' }, 403);
      await env.DB.prepare('UPDATE sal_interest_waivers SET status = ?, approved_by = ? WHERE id = ? AND status = \'requested\'').bind(status, req.user.user_id, w.id).run();
      await audit(env, req.user, `interest_waiver_${status}`, 'sal_interest_waivers', w.id, `Waiver of ${rupees(w.amount_paise)} ${status}${w.requested_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'waiver-act'); }
  }));
  waiverAct('approve', 'approved'); waiverAct('reject', 'rejected');

  router.get('/api/reports/interest', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { rows: [], totals: { accrued: 0, waived: 0, paid: 0, due: 0 } } });
      const bks = (await env.DB.prepare(`SELECT b.id, b.customer_name, i.wing, i.unit_no FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.project_id IN (${ph(ids)}) AND b.status <> 'cancelled' AND b.deleted_at IS NULL LIMIT 500`).bind(...ids).all()).results;
      const { map, cfg } = await computeInterest(env, getSetting, bks.map((b) => b.id));
      const rows = bks.map((b) => ({ booking_id: b.id, customer: b.customer_name, flat: `${b.wing || ''}-${b.unit_no}`, ...map.get(b.id), demands: undefined })).filter((r) => r.accrued > 0).sort((a, b) => b.due - a.due);
      const totals = rows.reduce((t, r) => ({ accrued: t.accrued + r.accrued, waived: t.waived + r.waived, paid: t.paid + r.paid, due: t.due + r.due }), { accrued: 0, waived: 0, paid: 0, due: 0 });
      return json({ ok: true, data: { rows: rows.slice(0, 50), totals, rate_bp: cfg.rateBp, enabled: cfg.enabled } });
    } catch (e) { return serverError(e, 'interest-report'); }
  }));

  // ---------- Customer statement of account ----------
  router.get('/api/print/statement/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const { b, err } = await bookingAccess(env, req.user, Number(req.params.id));
      if (err) return err;
      const unit = await env.DB.prepare('SELECT i.wing, i.unit_no, p.name AS project_name, p.rera_no FROM sal_inventory i JOIN projects p ON p.id = ? WHERE i.id = ?').bind(b.project_id, b.unit_id).first();
      const demands = (await env.DB.prepare('SELECT id, label, amount_paise, COALESCE(gst_paise,0) AS gst_paise, due_date, settled_paise, status FROM sal_demands WHERE booking_id = ? AND status <> \'cancelled\' ORDER BY id').bind(b.id).all()).results;
      const receipts = (await env.DB.prepare('SELECT receipt_no, amount_paise, tds_paise, mode, ref_no, received_on, kind, reversed_at FROM sal_receipts WHERE booking_id = ? ORDER BY received_on, id').bind(b.id).all()).results;
      const { map } = await computeInterest(env, getSetting, [b.id]);
      const brandMod = await h.printBrand(env, b.project_id);
      return json({ ok: true, data: { kind: 'statement', draft: false, booking: { id: b.id, customer_name: b.customer_name, agreed_price_paise: b.agreed_price_paise, status: b.status, address: b.address }, unit, demands, receipts, interest: map.get(b.id), as_of: todayIST(), brand: brandMod } });
    } catch (e) { return serverError(e, 'statement'); }
  }));

  // ---------- Project financials ----------
  router.get('/api/reports/project-financials', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Pick a project.' }, 400);
      const p = await env.DB.prepare('SELECT id, name, budget_paise, percent_complete FROM projects WHERE id = ?').bind(pid).first();
      const po = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('approved','part_received','received') THEN total_paise END), 0) AS committed, COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN total_paise END), 0) AS pending FROM pro_pos WHERE project_id = ? AND deleted_at IS NULL`).bind(pid).first();
      const bills = await env.DB.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS billed, COALESCE(SUM(CASE WHEN status = 'paid' AND NOT EXISTS (SELECT 1 FROM pro_payments x WHERE x.bill_id = pro_bills.id AND x.reversed_at IS NULL) THEN amount_paise - tds_paise END), 0) + (SELECT COALESCE(SUM(x.amount_paise), 0) FROM pro_payments x JOIN pro_bills bb ON bb.id = x.bill_id WHERE bb.project_id = ? AND x.reversed_at IS NULL) AS paid_net, COALESCE(SUM(CASE WHEN status = 'paid' THEN tds_paise END), 0) AS paid_tds, COALESCE(SUM(tds_paise), 0) AS tds FROM pro_bills WHERE project_id = ?`).bind(pid, pid).first();
      bills.paid_gross = bills.paid_net + bills.paid_tds;
      const sales = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(agreed_price_paise), 0) AS booked FROM sal_bookings WHERE project_id = ? AND status <> 'cancelled' AND deleted_at IS NULL`).bind(pid).first();
      const inv = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('available','held') AND category = 'sale' THEN price_paise + COALESCE(floor_rise_paise,0) END), 0) AS unsold FROM sal_inventory WHERE project_id = ? AND deleted_at IS NULL`).bind(pid).first();
      const col = await env.DB.prepare(`SELECT COALESCE(SUM(r.amount_paise + r.tds_paise), 0) AS collected, COALESCE(SUM(CASE WHEN r.account = 'rera_designated' THEN r.amount_paise + r.tds_paise ELSE 0 END), 0) AS designated FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE b.project_id = ? AND r.reversed_at IS NULL AND r.kind = 'principal'`).bind(pid).first();
      const dem = await env.DB.prepare(`SELECT COALESCE(SUM(d.amount_paise + COALESCE(d.gst_paise,0) - d.settled_paise), 0) AS receivable FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE b.project_id = ? AND d.status IN ('ready','partial') AND b.status <> 'cancelled'`).bind(pid).first();
      const budget = p.budget_paise || 0; const committed = Number(po.committed);
      const pct = p.percent_complete || 0;
      const designated = Number(col.designated);
      const collectedPct = sales.booked ? Math.round((Number(col.collected) * 1000) / sales.booked) / 10 : null;
      const flags = [];
      if (budget && committed > budget) flags.push(`Committed spend is ${rupees(committed - budget)} over budget.`);
      if (collectedPct !== null && collectedPct > pct + 15) flags.push(`Collections (${collectedPct}%) are well ahead of construction (${pct}%). Check the payment plan stages.`);
      if (!budget) flags.push('Set a project budget to see variance and margin.');
      return json({ ok: true, data: {
        project: p.name, percent_complete: pct,
        cost: { budget_paise: budget, committed_paise: committed, pending_po_paise: Number(po.pending), billed_paise: Number(bills.billed), paid_gross_paise: Number(bills.paid_gross), paid_net_paise: Number(bills.paid_net), unpaid_bills_paise: Number(bills.billed) - Number(bills.paid_gross), tds_deducted_paise: Number(bills.tds),
          uncommitted_budget_paise: budget ? Math.max(budget - committed, 0) : null },
        sales: { bookings: sales.n, booked_value_paise: Number(sales.booked), unsold_list_paise: Number(inv.unsold), collected_paise: Number(col.collected), collected_pct: collectedPct, receivable_paise: Number(dem.receivable), designated_paise: designated },
        projection: { revenue_paise: Number(sales.booked) + Number(inv.unsold), cost_paise: Math.max(budget, committed), margin_paise: Number(sales.booked) + Number(inv.unsold) - Math.max(budget, committed),
          margin_pct: (Number(sales.booked) + Number(inv.unsold)) ? Math.round(((Number(sales.booked) + Number(inv.unsold) - Math.max(budget, committed)) * 1000) / (Number(sales.booked) + Number(inv.unsold))) / 10 : null },
        rera: { designated_collected_paise: designated, eligible_withdrawal_paise: Math.round((designated * pct) / 100), note: 'Estimate: money in the designated account × certified completion. A withdrawal needs the CA / engineer / architect certificates (Form 3). Confirm with your CA.' },
        flags } });
    } catch (e) { return serverError(e, 'project-financials'); }
  }));

  // ---------- Vendor bills with GST + TDS ----------
  router.post('/api/procurement/bills', async (req, env) => withAuth(req, env, 'procurement', 'E', async (req, env) => {
    try {
      const b = await req.json();
      const amount = Math.round(Number(b.amount_paise) || 0);
      if (!b.vendor_id || !(amount > 0)) return json({ ok: false, error: 'Vendor and amount are required.' }, 400);
      const vendor = await env.DB.prepare('SELECT * FROM pro_vendors WHERE id = ? AND deleted_at IS NULL').bind(Number(b.vendor_id)).first();
      if (!vendor) return json({ ok: false, error: 'Vendor not found.' }, 404);
      let projectId = b.project_id ? Number(b.project_id) : null;
      let po = null;
      if (b.po_id) {
        po = await env.DB.prepare('SELECT * FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(b.po_id)).first();
        if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
        if (po.vendor_id !== vendor.id) return json({ ok: false, error: 'This bill is from a different vendor than the PO.' }, 400);
        projectId = po.project_id;
      }
      const billNo = String(b.bill_no || '').trim().slice(0, 40);
      if (billNo && await env.DB.prepare('SELECT 1 AS x FROM pro_bills WHERE vendor_id = ? AND lower(trim(bill_no)) = lower(?) LIMIT 1').bind(vendor.id, billNo).first()) return json({ ok: false, error: `Bill ${billNo} from ${vendor.name} is already recorded.`, code: 'duplicate' }, 409);
      if (!projectId || !(await visibleProjectIds(env, req.user)).includes(projectId)) return json({ ok: false, error: 'Pick the project this bill belongs to.' }, 400);
      const gst = Math.max(0, Math.round(Number(b.gst_paise) || 0));
      if (gst >= amount) return json({ ok: false, error: 'GST cannot be the whole bill.' }, 400);
      const taxable = b.taxable_paise ? Math.round(Number(b.taxable_paise)) : amount - gst;
      let bp = Math.max(0, Math.round(Number(b.tds_bp) || 0)); let note = null;
      const noPan = Math.round(Number(await getSetting(env, 'tax.tds_no_pan_bp'))) || 2000;
      if (bp > 0 && !vendor.pan) { if (bp < noPan) { bp = noPan; note = `No PAN on file for this vendor: TDS raised to ${noPan / 100}% (s.206AA, confirm with your CA). Add the PAN to use the normal rate.`; } }
      // Match against the PO and what was received: material received x PO rate (+ the PO's charges), less what is already billed, plus the tolerance.
      let hold = null;
      if (po) {
        const tol = Math.max(0, Math.round(Number(await getSetting(env, 'pro.tolerance_bp')) || 300));
        const [rcv, lines, prev] = await env.DB.batch([
          env.DB.prepare('SELECT COALESCE(SUM(gi.qty_received * i.rate_paise), 0) AS v FROM pro_grn_items gi JOIN pro_grns g ON g.id = gi.grn_id AND g.deleted_at IS NULL JOIN pro_po_items i ON i.id = gi.po_item_id WHERE i.po_id = ?').bind(po.id),
          env.DB.prepare('SELECT COUNT(*) AS n FROM pro_po_items WHERE po_id = ?').bind(po.id),
          env.DB.prepare('SELECT COALESCE(SUM(COALESCE(taxable_paise, amount_paise - COALESCE(gst_paise, 0))), 0) AS v FROM pro_bills WHERE po_id = ?').bind(po.id),
        ]);
        const charges = ['transport_paise', 'loading_paise', 'packing_paise', 'insurance_paise', 'other_charges_paise'].reduce((t, k) => t + (po[k] || 0), 0);
        const goodsCap = lines.results[0].n ? rcv.results[0].v : po.amount_paise - charges;
        const allowed = Math.round(goodsCap * (10000 + tol) / 10000) + (lines.results[0].n && !rcv.results[0].v ? 0 : charges) - prev.results[0].v;
        if (taxable > allowed) hold = lines.results[0].n && !rcv.results[0].v ? 'Nothing has been received against this PO yet.' : `Billed ${rupees(taxable)} (before GST) but only ${rupees(Math.max(0, allowed))} is supported by material received at PO rates (with ${tol / 100}% tolerance).`;
      }
      if (bp > 3000) return json({ ok: false, error: 'TDS rate looks wrong.' }, 400);
      const tds = Math.round((taxable * bp) / 10000);
      const section = bp > 0 ? String(b.tds_section || '194C').slice(0, 8) : null;
      const r = await env.DB.prepare('INSERT INTO pro_bills (po_id, vendor_id, project_id, bill_no, amount_paise, taxable_paise, gst_paise, tds_section, tds_bp, tds_paise, due_date, created_at, hold_reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(b.po_id ? Number(b.po_id) : null, vendor.id, projectId, billNo, amount, taxable, gst, section, bp, tds, b.due_date || null, nowStr(), hold, req.user.user_id).run();
      await audit(env, req.user, 'create', 'pro_bills', r.meta.last_row_id, `Bill ${b.bill_no || ''} ${rupees(amount)} from ${vendor.name}${tds ? `, TDS ${rupees(tds)} (${section} @ ${bp / 100}%)` : ''}`);
      if (hold) {
        const now = nowStr();
        await env.DB.prepare("INSERT INTO notifications (user_id, title, body, link, created_at) SELECT id, ?, ?, 'procurement', ? FROM users WHERE role IN ('pm', 'owner') AND active = 1 AND deleted_at IS NULL LIMIT 20").bind(`Bill on hold: ${vendor.name} ${billNo}`, hold, now).run();
      }
      return json({ ok: true, data: { id: r.meta.last_row_id, tds_paise: tds, net_payable_paise: amount - tds, note, on_hold: !!hold, hold_reason: hold } });
    } catch (e) { return serverError(e, 'bill'); }
  }));

  // A bill held because it did not match the PO / receipts: the PM or the Owner checks it and releases it with a note.
  router.post('/api/procurement/bills/:id/release', async (req, env) => withAuth(req, env, 'procurement', 'A', async (req, env) => {
    try {
      const bill = await env.DB.prepare('SELECT * FROM pro_bills WHERE id = ?').bind(Number(req.params.id)).first();
      if (!bill || !bill.project_id || !(await visibleProjectIds(env, req.user)).includes(bill.project_id)) return json({ ok: false, error: 'Bill not found.' }, 404);
      if (!bill.hold_reason || bill.released_at) return json({ ok: false, error: 'This bill is not on hold.' }, 409);
      if (bill.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'Someone else must release a bill you entered.' }, 403);
      const b = await req.json().catch(() => ({}));
      const note = String(b.note || '').trim().slice(0, 300);
      if (!note) return json({ ok: false, error: 'Say why the bill is right (e.g. extra quantity agreed, short receipt entered late).' }, 400);
      const r = await env.DB.prepare('UPDATE pro_bills SET released_by = ?, released_at = ?, release_note = ? WHERE id = ? AND released_at IS NULL').bind(req.user.user_id, nowStr(), note, bill.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Already released.' }, 409);
      await audit(env, req.user, 'release', 'pro_bills', bill.id, `Bill ${bill.bill_no || bill.id} released from hold: ${note}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bill-release'); }
  }));

  router.post('/api/procurement/bills/:id/tds-deposit', async (req, env) => withAuth(req, env, 'procurement', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can record a TDS deposit.' }, 403);
      const bill = await env.DB.prepare('SELECT * FROM pro_bills WHERE id = ?').bind(Number(req.params.id)).first();
      if (!bill || !bill.tds_paise) return json({ ok: false, error: 'This bill has no TDS.' }, 400);
      const b = await req.json();
      if (!String(b.challan || '').trim()) return json({ ok: false, error: 'Enter the challan number (BSR code / serial).' }, 400);
      await env.DB.prepare('UPDATE pro_bills SET tds_deposited_on = ?, tds_challan = ? WHERE id = ?').bind(b.deposited_on || todayIST(), String(b.challan).slice(0, 40), bill.id).run();
      await audit(env, req.user, 'tds_deposit', 'pro_bills', bill.id, `TDS ${rupees(bill.tds_paise)} deposited, challan ${b.challan}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'tds-deposit'); }
  }));

  // TDS by quarter and section. Due date: 7th of the next month (30 April for March).
  router.get('/api/reports/tds', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { rows: [] } });
      const rows = (await env.DB.prepare(`SELECT b.id, b.bill_no, b.tds_section, b.tds_bp, b.tds_paise, b.tds_deposited_on, b.tds_challan, substr(b.created_at, 1, 10) AS deducted_on, v.name AS vendor, v.pan IS NOT NULL AND v.pan <> '' AS has_pan
        FROM pro_bills b JOIN pro_vendors v ON v.id = b.vendor_id WHERE b.project_id IN (${ph(ids)}) AND b.tds_paise > 0 ORDER BY b.created_at DESC LIMIT 300`).bind(...ids).all()).results;
      const today = todayIST();
      const withDue = rows.map((r) => {
        const d = new Date(r.deducted_on + 'T00:00:00Z'); const m = d.getUTCMonth(); const y = d.getUTCFullYear();
        const due = m === 2 ? `${y}-04-30` : new Date(Date.UTC(y, m + 1, 7)).toISOString().substring(0, 10);
        const q = m >= 3 && m <= 5 ? 'Q1' : m >= 6 && m <= 8 ? 'Q2' : m >= 9 && m <= 11 ? 'Q3' : 'Q4';
        return { ...r, due_date: due, quarter: q, overdue: !r.tds_deposited_on && due < today };
      });
      const pending = withDue.filter((r) => !r.tds_deposited_on).reduce((t, r) => t + r.tds_paise, 0);
      return json({ ok: true, data: { rows: withDue, pending_paise: pending, overdue_count: withDue.filter((r) => r.overdue).length, note: 'Deposit by the 7th of the next month. Late deposit attracts interest and a late fee; confirm with your CA.' } });
    } catch (e) { return serverError(e, 'tds-report'); }
  }));

  // ---------- Tally-friendly exports ----------
  const csv = (name, headers, rows) => {
    const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return new Response('﻿' + [headers.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  };
  const ddmmyyyy = (d) => { const [y, m, dd] = String(d).substring(0, 10).split('-'); return `${dd}-${m}-${y}`; };
  const r2 = (p) => (Number(p) / 100).toFixed(2);

  router.get('/api/export/tally/:what', async (req, env) => withAuth(req, env, 'reports', 'X', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: false, error: 'Nothing to export.' }, 404);
      if (req.params.what === 'receipts') {
        const rows = (await env.DB.prepare(`SELECT r.received_on, r.receipt_no, r.amount_paise, r.tds_paise, r.mode, r.ref_no, r.account, r.kind, b.customer_name, p.name AS project, i.wing, i.unit_no
          FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id JOIN projects p ON p.id = b.project_id JOIN sal_inventory i ON i.id = b.unit_id WHERE b.project_id IN (${ph(ids)}) AND r.reversed_at IS NULL ORDER BY r.received_on, r.id`).bind(...ids).all()).results;
        return csv('tally-receipts.csv', ['Voucher Date', 'Voucher Type Name', 'Voucher Number', 'Party Ledger Name', 'Bank / Cash Ledger', 'Amount', 'TDS Receivable', 'Narration'],
          rows.map((r) => [ddmmyyyy(r.received_on), 'Receipt', r.receipt_no, r.customer_name, r.mode === 'cash' ? 'Cash' : (r.account === 'rera_designated' ? 'RERA Designated Account - ' : 'Project Account - ') + r.project, r2(r.amount_paise), r2(r.tds_paise), `${r.kind === 'interest' ? 'Interest on delayed payment' : 'Instalment'} ${r.wing || ''}-${r.unit_no} ${r.mode} ${r.ref_no || ''}`.trim()]));
      }
      if (req.params.what === 'purchases') {
        const rows = (await env.DB.prepare(`SELECT b.created_at, b.bill_no, b.amount_paise, b.taxable_paise, b.gst_paise, b.tds_section, b.tds_paise, v.name AS vendor, v.gstin, p.name AS project FROM pro_bills b JOIN pro_vendors v ON v.id = b.vendor_id JOIN projects p ON p.id = b.project_id WHERE b.project_id IN (${ph(ids)}) ORDER BY b.created_at`).bind(...ids).all()).results;
        return csv('tally-purchases.csv', ['Voucher Date', 'Voucher Type Name', 'Supplier Invoice No', 'Party Ledger Name', 'Party GSTIN', 'Purchase Ledger', 'Taxable Value', 'GST', 'TDS Section', 'TDS Amount', 'Invoice Total'],
          rows.map((r) => [ddmmyyyy(r.created_at), 'Purchase', r.bill_no, r.vendor, r.gstin || '', 'Purchases - ' + r.project, r2(r.taxable_paise ?? r.amount_paise - r.gst_paise), r2(r.gst_paise), r.tds_section || '', r2(r.tds_paise), r2(r.amount_paise)]));
      }
      return json({ ok: false, error: 'Unknown export.' }, 404);
    } catch (e) { return serverError(e, 'tally'); }
  }));
}
