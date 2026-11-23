// routes/sales3.js — sales completeness (WP-11 to WP-14):
//   WP-11 numbering by financial year, receipts that wait for a second person, credit/debit notes, numbering-gap report
//   WP-12 co-applicants on a booking
//   WP-13 cost sheets with discount approval, used to price a booking
//   WP-14 handover / possession checklist, home-loan details
// Money is integer paise. Tax and stamp-duty rates are inputs taken from Settings: nothing is hard-coded (confirm with your CA / advocate).
import { emit } from '../core/events.js';
import { saleBlock, approvalState, holdFor } from '../core/gates.js';

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MONEY = ['owner', 'pm', 'accounts'];
const PRIVATE_ID_ROLES = ['owner', 'accounts'];
const KIND_PREFIX = { credit_note: 'CN', debit_note: 'DN', adjustment: 'AD' };
const STARTER_HANDOVER = ['All dues cleared', 'Snag inspection done and snags fixed', 'Possession letter signed', 'Keys handed over', 'Utility meters transferred'];
const todayIST = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);
export const fyOf = (d = new Date(Date.now() + 19800000)) => { const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const a = m >= 4 ? y : y - 1; return `${a}-${String(a + 1).slice(2)}`; };

// ----- Service functions -----
// Give a demand its number the first time the letter is printed or sent. Same number every time after that. Not for stages that have not been reached.
export async function ensureDemandNumber(env, demandId) {
  const d = await env.DB.prepare('SELECT d.id, d.demand_no, d.status, b.project_id, p.code FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN projects p ON p.id = b.project_id WHERE d.id = ?').bind(demandId).first();
  if (!d) return null;
  if (d.demand_no || d.status === 'scheduled') return d.demand_no;
  const fy = fyOf(); const key = `dem:${d.project_id}:${fy}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO counters (key, value) SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM sal_demands WHERE id = ?2 AND demand_no IS NULL AND status != 'scheduled') ON CONFLICT(key) DO UPDATE SET value = value + 1").bind(key, demandId),
    env.DB.prepare("UPDATE sal_demands SET demand_no = ?1 || printf('%04d', (SELECT value FROM counters WHERE key = ?2)) WHERE id = ?3 AND demand_no IS NULL AND status != 'scheduled' AND changes() > 0").bind(`DL-${d.code}-${fy}-`, key, demandId),
  ]);
  return (await env.DB.prepare('SELECT demand_no FROM sal_demands WHERE id = ?').bind(demandId).first()).demand_no;
}

// Hourly (one statement): possession dates within 3 days for handovers still in progress. One reminder per person per booking per day.
export async function handoverDueSweep(env) {
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'Handover due: ' || b.customer_name || ' (' || COALESCE(i.wing || '-', '') || i.unit_no || ')', 'Possession offered for ' || h.possession_offered_on || '. Check the handover checklist.', 'sales', datetime('now')
    FROM sal_handover h JOIN sal_bookings b ON b.id = h.booking_id JOIN sal_inventory i ON i.id = b.unit_id
    JOIN users u ON (u.id = b.created_by OR u.role IN ('pm', 'owner')) AND u.active = 1 AND u.deleted_at IS NULL
    WHERE h.status = 'in_progress' AND h.possession_offered_on IS NOT NULL AND h.possession_offered_on <= date('now', '+3 days') AND b.status != 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Handover due: ' || b.customer_name || ' (' || COALESCE(i.wing || '-', '') || i.unit_no || ')' AND date(n.created_at) = date('now'))`).run();
}

export function registerSales3(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, encryptSetting, decryptSetting, csvBom, printBrand, shared } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 300), nowStr());
  const csvResponse = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  const f2 = (p) => (Number(p) / 100).toFixed(2);

  async function loadBooking(env, req, id) {
    const b = await env.DB.prepare('SELECT b.*, i.unit_no, i.wing FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.id = ? AND b.deleted_at IS NULL').bind(id).first();
    if (!b) return { err: json({ ok: false, error: 'Booking not found.' }, 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(b.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    // Sales people work only on their own bookings unless a manager or Accounts.
    if (req.user.role === 'sales' && b.created_by !== req.user.user_id && (await getSetting(env, 'sales.share_all_leads')) !== 'on') return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { booking: b };
  }

  // =====================================================================================
  // WP-11: receipts waiting for approval
  // =====================================================================================
  router.get('/api/sales/receipt-requests', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const q = new URL(req.url).searchParams; const status = q.get('status') || 'pending'; const bid = Number(q.get('booking_id')) || 0;
      const ids = (await visibleProjectIds(env, req.user)).slice(0, 90); if (!ids.length) return json({ ok: true, data: { requests: [] } });
      const rows = (await env.DB.prepare(`SELECT r.*, b.customer_name, i.unit_no, i.wing, u.name AS requested_by_name FROM sal_receipt_requests r JOIN sal_bookings b ON b.id = r.booking_id JOIN sal_inventory i ON i.id = b.unit_id LEFT JOIN users u ON u.id = r.requested_by
        WHERE r.status = ? AND b.project_id IN (${ids.map(() => '?').join(',')})${bid ? ' AND r.booking_id = ?' : ''} ORDER BY r.id DESC LIMIT 100`).bind(status, ...ids, ...(bid ? [bid] : [])).all()).results;
      return json({ ok: true, data: { requests: rows } });
    } catch (e) { return serverError(e, 'rcpt-req-list'); }
  }));

  router.post('/api/sales/receipt-requests/:id/approve', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    let claimed = null;
    try {
      const rq = await env.DB.prepare('SELECT * FROM sal_receipt_requests WHERE id = ?').bind(Number(req.params.id)).first();
      if (!rq) return json({ ok: false, error: 'Request not found.' }, 404);
      const { booking, err } = await loadBooking(env, req, rq.booking_id); if (err) return err;
      if (rq.requested_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve a receipt you recorded.' }, 403);
      if (booking.status === 'cancelled') return json({ ok: false, error: 'This booking is cancelled.' }, 400);
      const claim = await env.DB.prepare("UPDATE sal_receipt_requests SET status = 'approving' WHERE id = ? AND status = 'pending'").bind(rq.id).run();
      if (!claim.meta.changes) return json({ ok: false, error: 'This receipt was already decided.' }, 409);
      claimed = rq.id;
      const fields = { amount: rq.amount_paise, tds: rq.tds_paise, mode: rq.mode, ref: rq.ref_no, account: rq.account, kind: rq.kind, demandId: rq.demand_id, received_on: rq.received_on, note: rq.note };
      const posted = await shared.postReceipt(env, booking, fields, { user_id: rq.requested_by, name: 'recorded by request' }, [
        env.DB.prepare("UPDATE sal_receipt_requests SET status = 'approved', decided_by = ?, decided_at = ?, receipt_id = last_insert_rowid() WHERE id = ? AND status = 'approving'").bind(req.user.user_id, nowStr(), rq.id)]);
      claimed = null;
      await audit(env, req.user, 'approve', 'sal_receipt_requests', rq.id, `${req.user.name} approved receipt ${posted.receiptNo} of ${rupees(rq.amount_paise)}${rq.requested_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`).run();
      if (rq.requested_by) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(rq.requested_by, `Receipt approved: ${posted.receiptNo}`, `${booking.customer_name}, ${rupees(rq.amount_paise)}`, 'sales', nowStr()).run();
      return json({ ok: true, data: { receipt_no: posted.receiptNo } });
    } catch (e) {
      if (claimed) { try { await env.DB.prepare("UPDATE sal_receipt_requests SET status = 'pending' WHERE id = ? AND status = 'approving'").bind(claimed).run(); } catch (e2) { /* ignore */ } }
      return serverError(e, 'rcpt-req-approve');
    }
  }));

  router.post('/api/sales/receipt-requests/:id/reject', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const rq = await env.DB.prepare('SELECT * FROM sal_receipt_requests WHERE id = ?').bind(Number(req.params.id)).first();
      if (!rq) return json({ ok: false, error: 'Request not found.' }, 404);
      const { err } = await loadBooking(env, req, rq.booking_id); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (!String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const r = await env.DB.prepare("UPDATE sal_receipt_requests SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(req.user.user_id, nowStr(), String(b.note).slice(0, 200), rq.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This receipt was already decided.' }, 409);
      if (rq.requested_by) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(rq.requested_by, `Receipt not approved: ${rupees(rq.amount_paise)}`, String(b.note).slice(0, 200), 'sales', nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'rcpt-req-reject'); }
  }));

  // =====================================================================================
  // WP-11: credit notes, debit notes, adjustments
  // =====================================================================================
  router.post('/api/sales/bookings/:id/adjustments', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Only Accounts, the PM or the Owner can raise a credit or debit note.' }, 403);
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      const b = await req.json();
      const kind = KIND_PREFIX[b.kind] ? b.kind : null;
      const amount = Math.round(num(b.amount_paise)), gst = Math.round(num(b.gst_paise));
      if (!kind) return json({ ok: false, error: 'Pick credit note, debit note or adjustment.' }, 400);
      if (!(amount > 0) || gst < 0) return json({ ok: false, error: 'Enter the amount.' }, 400);
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give the reason (at least a few words).' }, 400);
      const d = await env.DB.prepare('SELECT id, amount_paise, gst_paise, settled_paise FROM sal_demands WHERE id = ? AND booking_id = ?').bind(Number(b.demand_id), booking.id).first();
      if (!d) return json({ ok: false, error: 'Pick the payment stage this applies to.' }, 400);
      if (kind !== 'debit_note' && d.amount_paise - amount + (d.gst_paise || 0) - gst < d.settled_paise) return json({ ok: false, error: 'That would reduce the demand below what the customer has already paid. Refund the difference instead.' }, 400);
      const r = await env.DB.prepare("INSERT INTO sal_adjustments (booking_id, demand_id, kind, amount_paise, gst_paise, reason, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
        .bind(booking.id, d.id, kind, amount, gst, String(b.reason).slice(0, 300), req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', 'sal_adjustments', r.meta.last_row_id, `${kind.replace('_', ' ')} ${rupees(amount)} proposed for ${booking.customer_name}`).run();
      await shared.notifyApprovers(env, req.user.user_id, `${kind.replace('_', ' ')} to approve: ${rupees(amount)}`, `${booking.customer_name}. ${String(b.reason).slice(0, 100)}`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'adj-create'); }
  }));

  router.get('/api/sales/bookings/:id/adjustments', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: true, data: { adjustments: [] } });
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare('SELECT a.*, d.label AS demand_label FROM sal_adjustments a JOIN sal_demands d ON d.id = a.demand_id WHERE a.booking_id = ? ORDER BY a.id DESC').bind(booking.id).all()).results;
      return json({ ok: true, data: { adjustments: rows } });
    } catch (e) { return serverError(e, 'adj-list'); }
  }));

  router.post('/api/sales/adjustments/:id/approve', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const a = await env.DB.prepare('SELECT * FROM sal_adjustments WHERE id = ?').bind(Number(req.params.id)).first();
      if (!a) return json({ ok: false, error: 'Not found.' }, 404);
      const { booking, err } = await loadBooking(env, req, a.booking_id); if (err) return err;
      if (a.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve a note you raised.' }, 403);
      const sign = a.kind === 'debit_note' ? -1 : 1;          // delta that is SUBTRACTED from the demand: positive for credit notes, negative for debit notes
      const dAmt = sign * a.amount_paise, dGst = sign * a.gst_paise;
      const fy = fyOf(); const key = `${KIND_PREFIX[a.kind].toLowerCase()}:${booking.project_id}:${fy}`;
      const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(booking.project_id).first();
      const now = nowStr();
      // The claim only succeeds while the demand can take the change (never below what was paid). Every later statement runs only if the one before changed a row.
      const res = await env.DB.batch([
        env.DB.prepare(`UPDATE sal_adjustments SET status = 'approved', approved_by = ?1, approved_at = ?2 WHERE id = ?3 AND status = 'pending' AND (created_by != ?1 OR ?6 = 1)
          AND EXISTS (SELECT 1 FROM sal_demands d WHERE d.id = sal_adjustments.demand_id AND d.amount_paise - ?4 >= 0 AND (d.amount_paise - ?4) + (COALESCE(d.gst_paise, 0) - ?5) >= d.settled_paise)`).bind(req.user.user_id, now, a.id, dAmt, dGst, req.user.role === 'owner' ? 1 : 0),
        env.DB.prepare('INSERT INTO counters (key, value) SELECT ?1, 1 WHERE changes() > 0 ON CONFLICT(key) DO UPDATE SET value = value + 1').bind(key),
        env.DB.prepare("UPDATE sal_adjustments SET adj_no = ?1 || printf('%04d', (SELECT value FROM counters WHERE key = ?2)) WHERE id = ?3 AND status = 'approved' AND adj_no IS NULL AND approved_by = ?4 AND changes() > 0")
          .bind(`${KIND_PREFIX[a.kind]}-${proj ? proj.code : booking.project_id}-${fy}-`, key, a.id, req.user.user_id),
        env.DB.prepare(`UPDATE sal_demands SET amount_paise = amount_paise - ?1, gst_paise = COALESCE(gst_paise, 0) - ?2,
            status = CASE WHEN settled_paise > 0 AND settled_paise >= (amount_paise - ?1) + (COALESCE(gst_paise, 0) - ?2) THEN 'paid' WHEN settled_paise > 0 THEN CASE WHEN status = 'paid' THEN 'partial' ELSE status END ELSE status END
          WHERE id = ?3 AND changes() > 0`).bind(dAmt, dGst, a.demand_id),
      ]);
      if (!res[0].meta.changes) {
        const cur = await env.DB.prepare('SELECT status FROM sal_adjustments WHERE id = ?').bind(a.id).first();
        return json({ ok: false, error: cur.status !== 'pending' ? 'This note was already decided.' : 'That would reduce the demand below what the customer has already paid.' }, cur.status !== 'pending' ? 409 : 400);
      }
      const done = await env.DB.prepare('SELECT adj_no FROM sal_adjustments WHERE id = ?').bind(a.id).first();
      await audit(env, req.user, 'approve', 'sal_adjustments', a.id, `${a.kind.replace('_', ' ')} ${done.adj_no} of ${rupees(a.amount_paise)} approved for ${booking.customer_name}${a.created_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`).run();
      return json({ ok: true, data: { adj_no: done.adj_no } });
    } catch (e) { return serverError(e, 'adj-approve'); }
  }));

  router.post('/api/sales/adjustments/:id/reject', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const a = await env.DB.prepare('SELECT * FROM sal_adjustments WHERE id = ?').bind(Number(req.params.id)).first();
      if (!a) return json({ ok: false, error: 'Not found.' }, 404);
      const { err } = await loadBooking(env, req, a.booking_id); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (!String(b.note || '').trim()) return json({ ok: false, error: 'Please say why.' }, 400);
      const r = await env.DB.prepare("UPDATE sal_adjustments SET status = 'rejected', decision_note = ? WHERE id = ? AND status = 'pending'").bind(String(b.note).slice(0, 200), a.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This note was already decided.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'adj-reject'); }
  }));

  // Reversal instead of delete: the demand goes back to what it was.
  router.post('/api/sales/adjustments/:id/reverse', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const a = await env.DB.prepare('SELECT * FROM sal_adjustments WHERE id = ?').bind(Number(req.params.id)).first();
      if (!a) return json({ ok: false, error: 'Not found.' }, 404);
      const { err } = await loadBooking(env, req, a.booking_id); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why it is reversed.' }, 400);
      const sign = a.kind === 'debit_note' ? -1 : 1; const dAmt = sign * a.amount_paise, dGst = sign * a.gst_paise;
      const res = await env.DB.batch([
        env.DB.prepare(`UPDATE sal_adjustments SET status = 'reversed', reversed_at = ?1, reversal_note = ?2 WHERE id = ?3 AND status = 'approved'
          AND EXISTS (SELECT 1 FROM sal_demands d WHERE d.id = sal_adjustments.demand_id AND (d.amount_paise + ?4) + (COALESCE(d.gst_paise, 0) + ?5) >= d.settled_paise)`).bind(nowStr(), String(b.reason).slice(0, 200), a.id, dAmt, dGst),
        env.DB.prepare(`UPDATE sal_demands SET amount_paise = amount_paise + ?1, gst_paise = COALESCE(gst_paise, 0) + ?2,
            status = CASE WHEN status = 'paid' AND settled_paise < (amount_paise + ?1) + (COALESCE(gst_paise, 0) + ?2) THEN 'partial' ELSE status END WHERE id = ?3 AND changes() > 0`).bind(dAmt, dGst, a.demand_id),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: a.status !== 'approved' ? 'Only an approved note can be reversed.' : 'Reversing would take the demand below what has been paid.' }, 409);
      await audit(env, req.user, 'reverse', 'sal_adjustments', a.id, `Reversed ${a.adj_no}: ${String(b.reason).slice(0, 100)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'adj-reverse'); }
  }));

  router.get('/api/print/creditnote/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const a = await env.DB.prepare(`SELECT a.*, b.customer_name, b.project_id, i.unit_no, i.wing, p.name AS project_name, d.label AS demand_label FROM sal_adjustments a JOIN sal_bookings b ON b.id = a.booking_id
        JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id JOIN sal_demands d ON d.id = a.demand_id WHERE a.id = ?`).bind(Number(req.params.id)).first();
      if (!a) return json({ ok: false, error: 'Not found.' }, 404);
      const { err } = await loadBooking(env, req, a.booking_id); if (err) return err;
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      return json({ ok: true, data: { kind: 'creditnote', draft: a.status !== 'approved', note: a, brand: await printBrand(env, a.project_id) } });
    } catch (e) { return serverError(e, 'print-cn'); }
  }));

  // =====================================================================================
  // WP-11: numbering gaps and adjustments report
  // =====================================================================================
  router.get('/api/sales/reports/numbering', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const q = new URL(req.url).searchParams; const pid = Number(q.get('project_id'));
      const ids = (await visibleProjectIds(env, req.user)); if (!pid || !ids.includes(pid)) return json({ ok: false, error: 'Pick a project.' }, 400);
      const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(pid).first();
      const [rc, dl, ad] = await Promise.all([
        env.DB.prepare('SELECT r.receipt_no AS n FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE b.project_id = ? AND r.receipt_no LIKE ? LIMIT 5000').bind(pid, `RC-${proj.code}-%-%`).all(),
        env.DB.prepare('SELECT d.demand_no AS n FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE b.project_id = ? AND d.demand_no IS NOT NULL LIMIT 5000').bind(pid).all(),
        env.DB.prepare('SELECT a.adj_no AS n FROM sal_adjustments a JOIN sal_bookings b ON b.id = a.booking_id WHERE b.project_id = ? AND a.adj_no IS NOT NULL LIMIT 5000').bind(pid).all(),
      ]);
      const series = {};
      for (const row of [...rc.results, ...dl.results, ...ad.results]) {
        const m = /^([A-Z]{2})-(.+)-(\d{4}-\d{2})-(\d+)$/.exec(row.n || ''); if (!m || m[2] !== proj.code) continue;
        const k = `${m[1]}-${m[2]}-${m[3]}`; (series[k] = series[k] || []).push(Number(m[4]));
      }
      const rows = Object.entries(series).sort().map(([k, list]) => {
        list.sort((a, b) => a - b); const have = new Set(list); const missing = [];
        for (let i = 1; i <= list[list.length - 1] && missing.length < 100; i++) if (!have.has(i)) missing.push(i);
        return { series: k, issued: list.length, highest: list[list.length - 1], missing };
      });
      const adj = (await env.DB.prepare(`SELECT a.adj_no, a.kind, a.amount_paise, a.gst_paise, a.status, a.reason, b.customer_name, a.created_at FROM sal_adjustments a JOIN sal_bookings b ON b.id = a.booking_id WHERE b.project_id = ? ORDER BY a.id DESC LIMIT 200`).bind(pid).all()).results;
      if (q.get('csv')) return csvResponse('numbering-check.csv', [['Series', 'Issued', 'Highest number', 'Missing numbers'], ...rows.map((r) => [r.series, r.issued, r.highest, r.missing.join(' ')]), [], ['Adjustments'], ['Number', 'Kind', 'Customer', 'Amount', 'GST', 'Status', 'Reason'], ...adj.map((a) => [a.adj_no || '(not approved)', a.kind, a.customer_name, f2(a.amount_paise), f2(a.gst_paise), a.status, a.reason])]);
      return json({ ok: true, data: { series: rows, adjustments: adj } });
    } catch (e) { return serverError(e, 'rep-numbering'); }
  }));

  // =====================================================================================
  // WP-12: co-applicants
  // =====================================================================================
  const mayReadIds = (req, booking) => PRIVATE_ID_ROLES.includes(req.user.role) || booking.created_by === req.user.user_id;
  async function partyOut(env, req, booking, rows) {
    const out = [];
    for (const r of rows) {
      const o = { id: r.id, name: r.name, phone: r.phone, relation: r.relation, share_bp: r.share_bp, has_pan: !!r.pan_enc, pan_masked: '', aadhaar_masked: '' };
      if (mayReadIds(req, booking)) { o.aadhaar_masked = r.aadhaar_masked || ''; if (r.pan_enc) { try { o.pan_masked = '••••' + (await decryptSetting(env, r.pan_enc)).slice(-4); } catch (e) { o.pan_masked = '••••'; } } }
      out.push(o);
    }
    return out;
  }

  router.get('/api/sales/bookings/:id/parties', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare('SELECT * FROM sal_booking_parties WHERE booking_id = ? AND deleted_at IS NULL ORDER BY id').bind(booking.id).all()).results;
      return json({ ok: true, data: { parties: await partyOut(env, req, booking, rows) } });
    } catch (e) { return serverError(e, 'party-list'); }
  }));

  router.post('/api/sales/bookings/:id/parties', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      if (!['owner', 'pm', 'accounts', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (booking.status === 'cancelled') return json({ ok: false, error: 'This booking is cancelled.' }, 400);
      const b = await req.json();
      const name = String(b.name || '').trim().slice(0, 120); if (!name) return json({ ok: false, error: 'Enter the co-applicant\'s name.' }, 400);
      const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
      if (b.phone && phone.length !== 10) return json({ ok: false, error: 'Enter a 10-digit mobile number.' }, 400);
      if (b.pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(b.pan).trim())) return json({ ok: false, error: 'PAN looks wrong (format ABCDE1234F).' }, 400);
      let aadhaar = '';
      if (b.aadhaar) {
        const dg = String(b.aadhaar).replace(/[\s-]/g, '');
        if (!/^\d{12}$/.test(dg)) return json({ ok: false, error: 'Aadhaar must be 12 digits. Only the last 4 are kept.' }, 400);
        aadhaar = `XXXX XXXX ${dg.slice(-4)}`;      // the full number is never stored
      }
      const share = Math.round(num(b.share_bp));
      if (share < 0 || share > 10000) return json({ ok: false, error: 'Share must be between 0% and 100%.' }, 400);
      const cur = await env.DB.prepare('SELECT COALESCE(SUM(share_bp), 0) AS s, COUNT(*) AS n FROM sal_booking_parties WHERE booking_id = ? AND deleted_at IS NULL').bind(booking.id).first();
      if (cur.n >= 5) return json({ ok: false, error: 'A booking can have at most 5 co-applicants.' }, 400);
      if (cur.s + share > 10000) return json({ ok: false, error: `The shares already add up to ${(cur.s / 100).toFixed(0)}%. This one would take it above 100%.` }, 400);
      const r = await env.DB.prepare('INSERT INTO sal_booking_parties (booking_id, name, phone, relation, share_bp, pan_enc, aadhaar_masked, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(booking.id, name, phone, String(b.relation || '').slice(0, 40), share, b.pan ? await encryptSetting(env, String(b.pan).trim().toUpperCase()) : null, aadhaar, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', 'sal_booking_parties', r.meta.last_row_id, `Co-applicant "${name}" added to booking of ${booking.customer_name}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'party-add'); }
  }));

  router.delete('/api/sales/parties/:id', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can delete a co-applicant.' }, 403);
      const p = await env.DB.prepare('SELECT * FROM sal_booking_parties WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!p) return json({ ok: false, error: 'Not found.' }, 404);
      const { booking, err } = await loadBooking(env, req, p.booking_id); if (err) return err;
      await env.DB.prepare('UPDATE sal_booking_parties SET deleted_at = ? WHERE id = ?').bind(nowStr(), p.id).run();
      await audit(env, req.user, 'remove', 'sal_booking_parties', p.id, `Co-applicant "${p.name}" removed from booking of ${booking.customer_name}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'party-remove'); }
  }));

  // =====================================================================================
  // WP-13: cost sheets
  // =====================================================================================
  shared.approvedSheetForBooking = async (env, id, unit) => {
    const s = await env.DB.prepare('SELECT * FROM sal_cost_sheets WHERE id = ?').bind(id).first();
    if (!s || s.unit_id !== unit.id) return { error: 'That cost sheet is for a different flat.' };
    if (s.status !== 'approved') return { error: s.status === 'superseded' ? 'That cost sheet has been replaced by a newer version.' : 'That cost sheet is not approved yet.' };
    if (s.booking_id) return { error: 'That cost sheet was already used for a booking.' };
    return { sheet: s };
  };

  async function sheetAccess(env, req, sheet) {
    const unit = await env.DB.prepare('SELECT project_id FROM sal_inventory WHERE id = ?').bind(sheet.unit_id).first();
    if (!unit || !(await visibleProjectIds(env, req.user)).includes(unit.project_id)) return null;
    if (req.user.role === 'sales' && sheet.lead_id) {
      const l = await env.DB.prepare('SELECT assigned_to FROM sal_leads WHERE id = ?').bind(sheet.lead_id).first();
      if (l && l.assigned_to !== req.user.user_id && (await getSetting(env, 'sales.share_all_leads')) !== 'on') return null;
    }
    return unit;
  }

  router.post('/api/sales/cost-sheets', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Only Sales, the PM or the Owner can make a cost sheet.' }, 403);
      const b = await req.json();
      const unit = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(b.unit_id)).first();
      if (!unit || !(await visibleProjectIds(env, req.user)).includes(unit.project_id)) return json({ ok: false, error: 'Pick a flat.' }, 400);
      if (unit.category === 'rehab') return json({ ok: false, error: 'Rehab flats are not sold.' }, 400);
      { const blk = await saleBlock(env, unit.project_id); if (blk) return json({ ok: false, error: blk, code: 'rera' }, 409); }
      { const held = await holdFor(env, unit.project_id, unit.wing); if (held) return json({ ok: false, error: held + '. No cost sheets until the hold is released.', code: 'hold' }, 409); }
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      if (leadId) {
        const l = await env.DB.prepare('SELECT assigned_to FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(leadId).first();
        if (!l) return json({ ok: false, error: 'Lead not found.' }, 404);
        if (req.user.role === 'sales' && l.assigned_to !== req.user.user_id) return json({ ok: false, error: 'You can only make a cost sheet for your own lead.' }, 403);
      }
      const basis = b.area_basis === 'carpet' ? 'carpet' : 'rera_carpet';
      const area = Number(basis === 'carpet' ? unit.carpet_sqft : unit.rera_carpet_sqft) || 0;
      if (!(area > 0)) return json({ ok: false, error: `This flat has no ${basis === 'carpet' ? 'carpet' : 'RERA carpet'} area recorded. Add it to the flat first.` }, 400);
      const rate = Math.round(num(b.base_rate_paise_per_sqft));
      if (!(rate > 0)) return json({ ok: false, error: 'Enter the rate per sq ft.' }, 400);
      const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => l && String(l.label || '').trim() && num(l.amount_paise) > 0).slice(0, 30)
        .map((l) => ({ label: String(l.label).trim().slice(0, 80), kind: l.kind === 'discount' ? 'discount' : 'addition', amount: Math.round(num(l.amount_paise)) }));
      const base = Math.round(rate * area);
      const additions = lines.filter((l) => l.kind === 'addition').reduce((t, l) => t + l.amount, 0), discount = lines.filter((l) => l.kind === 'discount').reduce((t, l) => t + l.amount, 0);
      const agreement = base + additions - discount;
      if (!(agreement > 0)) return json({ ok: false, error: 'The discounts are more than the price.' }, 400);
      const list = unit.price_paise + (unit.floor_rise_paise || 0);
      // Rates are inputs, defaulting from Settings. Nothing here is a built-in tax rule: confirm with your CA / advocate.
      const rateOf = async (given, key) => (given !== undefined && given !== '' && given !== null ? Math.round(num(given)) : Math.round(num(await getSetting(env, key))));
      const gstBp = await rateOf(b.gst_bp, 'tax.gst_bp'), stampBp = await rateOf(b.stamp_duty_bp, 'tax.stamp_duty_bp');
      if (gstBp < 0 || gstBp > 2800 || stampBp < 0 || stampBp > 1500) return json({ ok: false, error: 'A tax or stamp-duty rate looks wrong.' }, 400);
      let reg = b.registration_paise !== undefined && b.registration_paise !== '' && b.registration_paise !== null ? Math.round(num(b.registration_paise)) : null;
      if (reg === null) { const regBp = Math.round(num(await getSetting(env, 'tax.registration_bp'))), cap = Math.round(num(await getSetting(env, 'tax.registration_cap_paise'))); reg = Math.round((agreement * regBp) / 10000); if (cap > 0 && reg > cap) reg = cap; }
      if (reg < 0) return json({ ok: false, error: 'Registration fee cannot be negative.' }, 400);
      const gst = Math.round((agreement * gstBp) / 10000), stamp = Math.round((agreement * stampBp) / 10000);
      const total = agreement + gst + stamp + reg, below = Math.max(0, list - agreement);
      const prev = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM sal_cost_sheets WHERE unit_id = ? AND COALESCE(lead_id, 0) = COALESCE(?, 0)').bind(unit.id, leadId).first();
      const ins = await env.DB.prepare(`INSERT INTO sal_cost_sheets (unit_id, lead_id, version, area_basis, area_sqft, base_rate_paise_per_sqft, base_paise, additions_paise, discount_paise, list_paise, agreement_value_paise, below_list_paise,
          gst_bp, gst_paise, stamp_duty_bp, stamp_duty_paise, registration_paise, total_paise, status, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
        .bind(unit.id, leadId, prev.v + 1, basis, area, rate, base, additions, discount, list, agreement, below, gstBp, gst, stampBp, stamp, reg, total, String(b.note || '').slice(0, 300), req.user.user_id, nowStr()).run();
      const id = ins.meta.last_row_id;
      await env.DB.batch([
        ...lines.map((l) => env.DB.prepare('INSERT INTO sal_cost_sheet_lines (sheet_id, label, kind, amount_paise) VALUES (?, ?, ?, ?)').bind(id, l.label, l.kind, l.amount)),
        // One live version per flat and lead: older ones that were not used for a booking are superseded.
        env.DB.prepare("UPDATE sal_cost_sheets SET status = 'superseded' WHERE unit_id = ? AND COALESCE(lead_id, 0) = COALESCE(?, 0) AND id != ? AND booking_id IS NULL AND status IN ('draft', 'pending_approval', 'approved')").bind(unit.id, leadId, id),
        audit(env, req.user, 'create', 'sal_cost_sheets', id, `Cost sheet v${prev.v + 1} for ${unit.wing ? unit.wing + '-' : ''}${unit.unit_no}: agreement ${rupees(agreement)}, ${rupees(below)} below the rate card`),
      ]);
      return json({ ok: true, data: { id, version: prev.v + 1, agreement_value_paise: agreement, gst_paise: gst, stamp_duty_paise: stamp, registration_paise: reg, total_paise: total, below_list_paise: below } });
    } catch (e) { return serverError(e, 'cs-create'); }
  }));

  router.get('/api/sales/cost-sheets', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const unitId = Number(q.get('unit_id')); if (!unitId) return json({ ok: false, error: 'Pick a flat.' }, 400);
      const unit = await env.DB.prepare('SELECT project_id FROM sal_inventory WHERE id = ?').bind(unitId).first();
      if (!unit || !(await visibleProjectIds(env, req.user)).includes(unit.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      let rows = (await env.DB.prepare(`SELECT s.*, l.name AS lead_name, u.name AS created_by_name FROM sal_cost_sheets s LEFT JOIN sal_leads l ON l.id = s.lead_id LEFT JOIN users u ON u.id = s.created_by WHERE s.unit_id = ? ORDER BY s.id DESC LIMIT 30`).bind(unitId).all()).results;
      if (req.user.role === 'sales') { const mine = await env.DB.prepare('SELECT id FROM sal_leads WHERE assigned_to = ?').bind(req.user.user_id).all(); const set = new Set(mine.results.map((x) => x.id)); const all = (await getSetting(env, 'sales.share_all_leads')) === 'on'; rows = rows.filter((r) => all || !r.lead_id || set.has(r.lead_id)); }
      return json({ ok: true, data: { sheets: rows } });
    } catch (e) { return serverError(e, 'cs-list'); }
  }));

  router.get('/api/sales/cost-sheets/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const s = await env.DB.prepare('SELECT s.*, l.name AS lead_name FROM sal_cost_sheets s LEFT JOIN sal_leads l ON l.id = s.lead_id WHERE s.id = ?').bind(Number(req.params.id)).first();
      if (!s || !(await sheetAccess(env, req, s))) return json({ ok: false, error: 'Cost sheet not found.' }, 404);
      const lines = (await env.DB.prepare('SELECT label, kind, amount_paise FROM sal_cost_sheet_lines WHERE sheet_id = ? ORDER BY id').bind(s.id).all()).results;
      return json({ ok: true, data: { sheet: s, lines } });
    } catch (e) { return serverError(e, 'cs-get'); }
  }));

  router.post('/api/sales/cost-sheets/:id/submit', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      const s = await env.DB.prepare('SELECT * FROM sal_cost_sheets WHERE id = ?').bind(Number(req.params.id)).first();
      if (!s || !(await sheetAccess(env, req, s))) return json({ ok: false, error: 'Cost sheet not found.' }, 404);
      if (s.created_by !== req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'Only the person who made it can send it for approval.' }, 403);
      const r = await env.DB.prepare("UPDATE sal_cost_sheets SET status = 'pending_approval' WHERE id = ? AND status IN ('draft', 'rejected')").bind(s.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Only a draft can be sent for approval.' }, 409);
      await shared.notifyApprovers(env, req.user.user_id, `Cost sheet to approve: ${rupees(s.agreement_value_paise)}`, s.below_list_paise ? `${rupees(s.below_list_paise)} below the rate card.` : 'At the rate card.');
      return json({ ok: true });
    } catch (e) { return serverError(e, 'cs-submit'); }
  }));

  const decideSheet = (approve) => (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const s = await env.DB.prepare('SELECT * FROM sal_cost_sheets WHERE id = ?').bind(Number(req.params.id)).first();
      if (!s || !(await sheetAccess(env, req, s))) return json({ ok: false, error: 'Cost sheet not found.' }, 404);
      if (s.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve a cost sheet you made.' }, 403);
      const b = await req.json().catch(() => ({}));
      const limit = Math.round(num(await getSetting(env, 'sales.discount_pm_limit_paise')));
      if (approve && req.user.role !== 'owner' && s.below_list_paise > limit) return json({ ok: false, error: `This cost sheet is ${rupees(s.below_list_paise)} below the rate card, above the PM's limit (${rupees(limit)}). The Owner must approve it.` }, 403);
      if (!approve && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const r = await env.DB.prepare("UPDATE sal_cost_sheets SET status = ?, approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ? AND status = 'pending_approval'").bind(approve ? 'approved' : 'rejected', req.user.user_id, nowStr(), String(b.note || '').slice(0, 200), s.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This cost sheet is not waiting for approval.' }, 409);
      await audit(env, req.user, approve ? 'approve' : 'reject', 'sal_cost_sheets', s.id, `${req.user.name} ${approve ? 'approved' : 'rejected'} cost sheet v${s.version} (${rupees(s.agreement_value_paise)}, ${rupees(s.below_list_paise)} below rate card)${s.created_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`).run();
      if (s.created_by) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(s.created_by, `Cost sheet ${approve ? 'approved' : 'rejected'}`, String(b.note || ''), 'sales', nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'cs-decide'); }
  });
  router.post('/api/sales/cost-sheets/:id/approve', decideSheet(true));
  router.post('/api/sales/cost-sheets/:id/reject', decideSheet(false));

  router.get('/api/print/costsheet/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const s = await env.DB.prepare(`SELECT s.*, l.name AS lead_name, i.unit_no, i.wing, i.floor, i.type, i.project_id, p.name AS project_name, p.rera_no FROM sal_cost_sheets s JOIN sal_inventory i ON i.id = s.unit_id JOIN projects p ON p.id = i.project_id LEFT JOIN sal_leads l ON l.id = s.lead_id WHERE s.id = ?`).bind(Number(req.params.id)).first();
      if (!s || !(await sheetAccess(env, req, s))) return json({ ok: false, error: 'Cost sheet not found.' }, 404);
      const lines = (await env.DB.prepare('SELECT label, kind, amount_paise FROM sal_cost_sheet_lines WHERE sheet_id = ? ORDER BY id').bind(s.id).all()).results;
      return json({ ok: true, data: { kind: 'costsheet', draft: s.status !== 'approved', sheet: s, lines, brand: await printBrand(env, s.project_id) } });
    } catch (e) { return serverError(e, 'print-cs'); }
  }));

  router.get('/api/sales/reports/discounts', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = (await visibleProjectIds(env, req.user)).slice(0, 90); if (!ids.length) return json({ ok: true, data: { rows: [] } });
      const rows = (await env.DB.prepare(`SELECT p.name AS project, u.name AS made_by, COUNT(*) AS sheets, SUM(s.below_list_paise) AS discount_paise, SUM(s.list_paise) AS list_paise, SUM(s.agreement_value_paise) AS agreement_paise
        FROM sal_cost_sheets s JOIN sal_inventory i ON i.id = s.unit_id JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = s.created_by
        WHERE s.status = 'approved' AND i.project_id IN (${ids.map(() => '?').join(',')}) GROUP BY i.project_id, s.created_by ORDER BY discount_paise DESC LIMIT 200`).bind(...ids).all()).results;
      if (new URL(req.url).searchParams.get('csv')) return csvResponse('discounts-given.csv', [['Project', 'Made by', 'Approved sheets', 'Rate-card total', 'Agreement total', 'Discount given', 'Discount %'], ...rows.map((r) => [r.project, r.made_by || '', r.sheets, f2(r.list_paise), f2(r.agreement_paise), f2(r.discount_paise), r.list_paise ? ((r.discount_paise * 100) / r.list_paise).toFixed(2) : '0'])]);
      return json({ ok: true, data: { rows } });
    } catch (e) { return serverError(e, 'rep-discounts'); }
  }));

  // =====================================================================================
  // WP-14: handover, possession, home loans
  // =====================================================================================
  async function template(env) {
    const t = await getSetting(env, 'sales.handover_template');
    let list = null;
    if (Array.isArray(t)) list = t;
    else if (typeof t === 'string' && t.trim()) { try { const j = JSON.parse(t); if (Array.isArray(j)) list = j; } catch (e) { list = t.split(/[;\n]/); } }   // a JSON list, or items separated by ;
    list = (list || []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 30);
    return list.length ? list : STARTER_HANDOVER;
  }

  router.post('/api/sales/bookings/:id/handover', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Only Sales, the PM or the Owner can open a handover.' }, 403);
      if (booking.status === 'cancelled') return json({ ok: false, error: 'This booking is cancelled.' }, 400);
      if (!booking.agreement_date) return json({ ok: false, error: 'Record the agreement date first (open the booking, Agreement / registration dates).' }, 400);
      if (await env.DB.prepare('SELECT id FROM sal_handover WHERE booking_id = ?').bind(booking.id).first()) return json({ ok: false, error: 'A handover is already open for this booking.' }, 409);
      const r = await env.DB.prepare("INSERT INTO sal_handover (booking_id, status, opened_by, created_at) VALUES (?, 'in_progress', ?, ?)").bind(booking.id, req.user.user_id, nowStr()).run();
      const items = await template(env);
      await env.DB.batch([...items.map((label, i) => env.DB.prepare('INSERT INTO sal_handover_items (handover_id, label, sort_order) VALUES (?, ?, ?)').bind(r.meta.last_row_id, label, i)),
        audit(env, req.user, 'create', 'sal_handover', r.meta.last_row_id, `Handover opened for ${booking.customer_name} (${booking.wing ? booking.wing + '-' : ''}${booking.unit_no})`)]);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'ho-open'); }
  }));

  router.get('/api/sales/bookings/:id/handover', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(booking.id).first();
      const [items, loans, snags] = await Promise.all([
        ho ? env.DB.prepare('SELECT * FROM sal_handover_items WHERE handover_id = ? ORDER BY sort_order, id').bind(ho.id).all() : { results: [] },
        MONEY.includes(req.user.role) || req.user.role === 'sales' ? env.DB.prepare('SELECT * FROM sal_booking_loans WHERE booking_id = ? AND deleted_at IS NULL ORDER BY id').bind(booking.id).all() : { results: [] },
        env.DB.prepare("SELECT id, title, severity, status FROM site_snags WHERE unit_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50").bind(booking.unit_id).all(),
      ]);
      return json({ ok: true, data: { handover: ho || null, items: items.results, loans: loans.results, snags: snags.results, can_open: !!booking.agreement_date, template_is_starter: !(await getSetting(env, 'sales.handover_template')) } });
    } catch (e) { return serverError(e, 'ho-get'); }
  }));

  router.post('/api/sales/handover-items/:id', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const it = await env.DB.prepare('SELECT i.*, h.booking_id, h.status AS ho_status FROM sal_handover_items i JOIN sal_handover h ON h.id = i.handover_id WHERE i.id = ?').bind(Number(req.params.id)).first();
      if (!it) return json({ ok: false, error: 'Item not found.' }, 404);
      const { err } = await loadBooking(env, req, it.booking_id); if (err) return err;
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (it.ho_status === 'handed_over') return json({ ok: false, error: 'The flat is already handed over.' }, 409);
      const b = await req.json();
      await env.DB.prepare('UPDATE sal_handover_items SET done = ?, done_on = ?, note = COALESCE(?, note), document_id = COALESCE(?, document_id) WHERE id = ?')
        .bind(b.done ? 1 : 0, b.done ? todayIST() : null, b.note !== undefined ? String(b.note).slice(0, 300) : null, b.document_id ? Number(b.document_id) : null, it.id).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ho-item'); }
  }));

  router.post('/api/sales/bookings/:id/handover/details', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json(); const dt = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
      if ((b.possession_offered_on && !dt(b.possession_offered_on))) return json({ ok: false, error: 'Dates must look like 2026-11-30.' }, 400);
      const r = await env.DB.prepare("UPDATE sal_handover SET possession_offered_on = COALESCE(?, possession_offered_on), oc_reference = COALESCE(?, oc_reference), notes = COALESCE(?, notes) WHERE booking_id = ? AND status = 'in_progress'")
        .bind(dt(b.possession_offered_on), b.oc_reference !== undefined ? String(b.oc_reference).slice(0, 80) : null, b.notes !== undefined ? String(b.notes).slice(0, 500) : null, booking.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'There is no open handover for this booking.' }, 404);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ho-details'); }
  }));

  // Possession: never before the OC for the flat's wing. Unpaid dues need the Owner's written reason; open snags or checklist items need the PM's.
  router.post('/api/sales/bookings/:id/handover/complete', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      if (!['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Only the PM or the Owner can hand over possession.' }, 403);
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(booking.id).first();
      if (!ho) return json({ ok: false, error: 'Open the handover first.' }, 404);
      const st = await approvalState(env, booking.project_id);
      if (!st.approved('oc', booking.wing || null)) return json({ ok: false, error: `There is no Occupancy Certificate${booking.wing ? ' for wing ' + booking.wing : ''} marked approved in Approvals. Possession cannot be given before the OC.`, code: 'oc' }, 409);
      const open = (await env.DB.prepare('SELECT COUNT(*) AS n FROM sal_handover_items WHERE handover_id = ? AND done = 0').bind(ho.id).first()).n;
      const snags = (await env.DB.prepare("SELECT COUNT(*) AS n FROM site_snags WHERE unit_id = ? AND deleted_at IS NULL AND status NOT IN ('verified')").bind(booking.unit_id).first()).n;
      const due = (await env.DB.prepare("SELECT COALESCE(SUM(amount_paise + COALESCE(gst_paise, 0) - settled_paise), 0) AS d FROM sal_demands WHERE booking_id = ? AND status NOT IN ('cancelled', 'scheduled')").bind(booking.id).first()).d;
      const b = await req.json().catch(() => ({}));
      const reason = String(b.override_note || '').trim().slice(0, 300);
      const problems = [];
      if (due > 0) problems.push(`${rupees(due)} is still due`);
      if (snags) problems.push(`${snags} snag${snags === 1 ? ' is' : 's are'} not verified fixed`);
      if (open) problems.push(`${open} checklist item${open === 1 ? ' is' : 's are'} not ticked`);
      if (problems.length) {
        if (due > 0 && req.user.role !== 'owner') return json({ ok: false, error: `${problems.join('; ')}. Only the Owner can give possession with dues unpaid.`, code: 'dues', problems }, 409);
        if (!reason) return json({ ok: false, error: `${problems.join('; ')}. Give a written reason to go ahead.`, code: 'reason', problems }, 409);
      }
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE sal_handover SET status = 'handed_over', possession_given_on = ?, override_note = ? WHERE id = ? AND status = 'in_progress'").bind(todayIST(), problems.length ? reason : null, ho.id),
        env.DB.prepare("UPDATE sal_inventory SET status = 'possessed' WHERE id = ? AND status = 'booked' AND changes() > 0").bind(booking.unit_id),
        audit(env, req.user, 'handover', 'sal_handover', ho.id, `${booking.customer_name} took possession of ${booking.wing ? booking.wing + '-' : ''}${booking.unit_no}${problems.length ? ' — went ahead with: ' + problems.join('; ') + '. Reason: ' + reason : ''}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'This flat is already handed over.' }, 409);
      emit('handover.completed', { booking_id: booking.id, unit_id: booking.unit_id, project_id: booking.project_id });
      const warnings = problems;
      return json({ ok: true, data: { warnings } });
    } catch (e) { return serverError(e, 'ho-complete'); }
  }));

  router.post('/api/sales/bookings/:id/loans', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { booking, err } = await loadBooking(env, req, Number(req.params.id)); if (err) return err;
      if (!['owner', 'pm', 'accounts', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json(); const bank = String(b.bank || '').trim().slice(0, 80);
      if (!bank) return json({ ok: false, error: 'Enter the bank.' }, 400);
      const sanction = Math.round(num(b.sanction_paise)), disb = Math.round(num(b.disbursed_paise));
      if (sanction < 0 || disb < 0 || disb > sanction) return json({ ok: false, error: 'The amount disbursed cannot be more than the amount sanctioned.' }, 400);
      const r = await env.DB.prepare('INSERT INTO sal_booking_loans (booking_id, bank, sanction_paise, sanction_date, disbursed_paise, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(booking.id, bank, sanction, b.sanction_date && /^\d{4}-\d{2}-\d{2}$/.test(b.sanction_date) ? b.sanction_date : null, disb, String(b.notes || '').slice(0, 300), req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', 'sal_booking_loans', r.meta.last_row_id, `Loan from ${bank}: sanctioned ${rupees(sanction)} for ${booking.customer_name}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'loan-add'); }
  }));

  router.post('/api/sales/loans/:id', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const l = await env.DB.prepare('SELECT * FROM sal_booking_loans WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!l) return json({ ok: false, error: 'Loan not found.' }, 404);
      const { err } = await loadBooking(env, req, l.booking_id); if (err) return err;
      if (!['owner', 'pm', 'accounts', 'sales'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json(); const disb = b.disbursed_paise !== undefined ? Math.round(num(b.disbursed_paise)) : l.disbursed_paise, sanction = b.sanction_paise !== undefined ? Math.round(num(b.sanction_paise)) : l.sanction_paise;
      if (disb < 0 || sanction < 0 || disb > sanction) return json({ ok: false, error: 'The amount disbursed cannot be more than the amount sanctioned.' }, 400);
      await env.DB.prepare('UPDATE sal_booking_loans SET sanction_paise = ?, disbursed_paise = ?, notes = COALESCE(?, notes) WHERE id = ?').bind(sanction, disb, b.notes !== undefined ? String(b.notes).slice(0, 300) : null, l.id).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'loan-update'); }
  }));

  router.get('/api/sales/reports/handovers', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const ids = (await visibleProjectIds(env, req.user)).slice(0, 90); if (!ids.length) return json({ ok: true, data: { rows: [] } });
      const mine = req.user.role === 'sales' && (await getSetting(env, 'sales.share_all_leads')) !== 'on' ? ' AND b.created_by = ?' : '';
      const rows = (await env.DB.prepare(`SELECT b.id AS booking_id, b.customer_name, i.wing, i.unit_no, p.name AS project, h.possession_offered_on, h.oc_reference,
          (SELECT COUNT(*) FROM sal_handover_items x WHERE x.handover_id = h.id) AS items, (SELECT COUNT(*) FROM sal_handover_items x WHERE x.handover_id = h.id AND x.done = 1) AS items_done,
          (SELECT COUNT(*) FROM site_snags s WHERE s.unit_id = b.unit_id AND s.deleted_at IS NULL AND s.status != 'verified') AS open_snags
        FROM sal_handover h JOIN sal_bookings b ON b.id = h.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id
        WHERE h.status = 'in_progress' AND b.status != 'cancelled' AND b.project_id IN (${ids.map(() => '?').join(',')})${mine} ORDER BY h.possession_offered_on IS NULL, h.possession_offered_on LIMIT 300`).bind(...ids, ...(mine ? [req.user.user_id] : [])).all()).results;
      if (new URL(req.url).searchParams.get('csv')) return csvResponse('pending-handovers.csv', [['Project', 'Flat', 'Customer', 'Possession offered', 'Checklist done', 'Open snags', 'OC reference'], ...rows.map((r) => [r.project, `${r.wing ? r.wing + '-' : ''}${r.unit_no}`, r.customer_name, r.possession_offered_on || '', `${r.items_done}/${r.items}`, r.open_snags, r.oc_reference || ''])]);
      return json({ ok: true, data: { rows } });
    } catch (e) { return serverError(e, 'rep-handovers'); }
  }));
}
