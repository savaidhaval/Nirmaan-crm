import { ccFloorBlock } from '../core/gates.js';
import { indentBoqFlags } from './m3gaps.js';

// routes/procurement2.js — WP-4 procurement addendum: indents, multi-line RFQ + per-line quotes,
// GRN by PO line, bill part-payments (reversed, never deleted), and procurement reports.

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MONEY_ROLES = ['owner', 'pm', 'accounts', 'purchase'];

// ----- Service functions other modules call (Budget asks here; it never reads pro_* tables itself) -----
const PO_LIVE = "('approved', 'part_received', 'received')";

// Per budget head for one project: committed (approved POs), billed (bills, shared by item value) and paid. Key 0 = not tagged to any head.
// inclGst: false = figures without GST (default), true = with GST. Money in paise.
export async function procurementByHead(env, projectId, inclGst) {
  const g = inclGst ? 1 : 0;
  const out = { 0: { committed: 0, billed: 0, paid: 0 } };
  const add = (h, k, v) => { const key = h || 0; (out[key] = out[key] || { committed: 0, billed: 0, paid: 0 })[k] += Math.round(Number(v) || 0); };
  const [committed, noItems, billed] = await Promise.all([
    env.DB.prepare(`SELECT i.budget_head_id AS h, SUM(i.amount_paise + CASE WHEN ?2 = 1 THEN i.amount_paise * p.gst_bp / 10000 ELSE 0 END) AS v
      FROM pro_po_items i JOIN pro_pos p ON p.id = i.po_id WHERE p.project_id = ?1 AND p.deleted_at IS NULL AND p.status IN ${PO_LIVE} GROUP BY i.budget_head_id`).bind(projectId, g).all(),
    env.DB.prepare(`SELECT SUM(CASE WHEN ?2 = 1 THEN p.total_paise ELSE p.amount_paise END) AS v FROM pro_pos p WHERE p.project_id = ?1 AND p.deleted_at IS NULL AND p.status IN ${PO_LIVE}
      AND NOT EXISTS (SELECT 1 FROM pro_po_items i WHERE i.po_id = p.id)`).bind(projectId, g).first(),
    env.DB.prepare(`WITH bp AS (SELECT b.po_id,
        CASE WHEN ?2 = 1 THEN b.amount_paise ELSE COALESCE(b.taxable_paise, b.amount_paise - b.gst_paise) END AS base,
        CASE WHEN b.status = 'paid' AND NOT EXISTS (SELECT 1 FROM pro_payments x WHERE x.bill_id = b.id AND x.reversed_at IS NULL) THEN b.amount_paise - b.tds_paise
             ELSE COALESCE((SELECT SUM(x.amount_paise) FROM pro_payments x WHERE x.bill_id = b.id AND x.reversed_at IS NULL), 0) END AS paid
      FROM pro_bills b WHERE b.project_id = ?1 AND b.status != 'cancelled')
      SELECT i.budget_head_id AS h, SUM(bp.base * 1.0 * i.amount_paise / p.amount_paise) AS billed, SUM(bp.paid * 1.0 * i.amount_paise / p.amount_paise) AS paid
        FROM bp JOIN pro_pos p ON p.id = bp.po_id JOIN pro_po_items i ON i.po_id = p.id WHERE p.amount_paise > 0 GROUP BY i.budget_head_id
      UNION ALL
      SELECT NULL, SUM(base), SUM(paid) FROM bp WHERE po_id IS NULL OR NOT EXISTS (SELECT 1 FROM pro_po_items i WHERE i.po_id = bp.po_id)`).bind(projectId, g).all(),
  ]);
  for (const r of committed.results) add(r.h, 'committed', r.v);
  add(0, 'committed', noItems && noItems.v);
  for (const r of billed.results) { add(r.h, 'billed', r.billed); add(r.h, 'paid', r.paid); }
  return out;
}

export async function vendorName(env, id) {
  const r = await env.DB.prepare('SELECT name FROM pro_vendors WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  return r ? r.name : null;
}

// The POs behind one head (for the head detail screen).
export async function posForHead(env, headId) {
  return (await env.DB.prepare(`SELECT p.id, p.po_no, p.status, v.name AS vendor, SUM(i.amount_paise) AS amount_paise
    FROM pro_po_items i JOIN pro_pos p ON p.id = i.po_id JOIN pro_vendors v ON v.id = p.vendor_id WHERE i.budget_head_id = ? AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.id DESC LIMIT 100`).bind(headId).all()).results;
}
export async function poItemsTaggedCount(env, headId) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM pro_po_items WHERE budget_head_id = ?').bind(headId).first()).n;
}
// Head ids on a PO (to check budgets after the PO is approved).
export async function headsOnPo(env, poId) {
  return (await env.DB.prepare('SELECT DISTINCT budget_head_id AS h FROM pro_po_items WHERE po_id = ? AND budget_head_id IS NOT NULL').bind(poId).all()).results.map((r) => r.h);
}


// ----- PO charges and terms (transport, loading, packing, insurance, other; delivery, payment terms, warranty, penalty) -----
const PO_CATEGORIES = ['cement', 'steel', 'rmc', 'sand_aggregate', 'blocks_bricks', 'electrical', 'plumbing', 'tiles', 'paint', 'hardware', 'other'];
const CHARGE_KEYS = ['transport_paise', 'loading_paise', 'packing_paise', 'insurance_paise', 'other_charges_paise'];
// Works out the PO totals with the charges and returns the UPDATE statement, or { error }.
// goods: value of the material lines before GST. Charges carry their own GST rate (defaults to the PO rate).
export function poTermsStatement(env, po, goods, b) {
  const t = (k, n) => (b[k] === undefined ? (po[k] ?? null) : (String(b[k] || '').trim().slice(0, n) || null));
  const ch = {};
  for (const k of CHARGE_KEYS) {
    const v = b[k] === undefined ? (po[k] || 0) : Math.round(Number(b[k]) || 0);
    if (!(v >= 0 && v <= 1e13)) return { error: 'Check the charges.' };
    ch[k] = v;
  }
  const cat = b.material_category === undefined ? (po.material_category ?? null) : (PO_CATEGORIES.includes(b.material_category) ? b.material_category : null);
  let details = po.category_details ?? null;
  if (b.category_details !== undefined) {
    const o = b.category_details && typeof b.category_details === 'object' ? b.category_details : {};
    const clean = Object.fromEntries(Object.entries(o).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), String(v == null ? '' : v).trim().slice(0, 200)]).filter(([, v]) => v));
    details = Object.keys(clean).length ? JSON.stringify(clean) : null;
  }
  const chGst = b.charges_gst_bp === undefined ? (po.charges_gst_bp ?? null) : (b.charges_gst_bp === '' || b.charges_gst_bp == null ? null : Math.round(Number(b.charges_gst_bp)));
  if (chGst != null && !(chGst >= 0 && chGst <= 5000)) return { error: 'Check the GST on charges.' };
  if (b.delivery_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.delivery_date)) return { error: 'Check the delivery date.' };
  const charges = CHARGE_KEYS.reduce((x, k) => x + ch[k], 0);
  const gstBp = Number(po.gst_bp) || 0;
  const amount = goods + charges;
  const gst = Math.round(goods * gstBp / 10000) + Math.round(charges * (chGst == null ? gstBp : chGst) / 10000);
  return { stmt: env.DB.prepare(`UPDATE pro_pos SET material_category = ?, transport_paise = ?, loading_paise = ?, packing_paise = ?, insurance_paise = ?, other_charges_paise = ?, other_charges_label = ?, charges_gst_bp = ?,
      price_basis = ?, delivery_date = ?, delivery_address = ?, payment_terms = ?, warranty = ?, penalty_clause = ?, category_details = ?, terms = ?, amount_paise = ?, gst_paise = ?, total_paise = ? WHERE id = ?`)
    .bind(cat, ch.transport_paise, ch.loading_paise, ch.packing_paise, ch.insurance_paise, ch.other_charges_paise, t('other_charges_label', 60), chGst, t('price_basis', 80),
      b.delivery_date === undefined ? (po.delivery_date ?? null) : (b.delivery_date || null), t('delivery_address', 300), t('payment_terms', 300), t('warranty', 200), t('penalty_clause', 300), details, t('terms', 2000), amount, gst, amount + gst, po.id),
    amount, gst, total: amount + gst };
}

// Per BOQ item of a project: quantity and value ordered on approved POs (for the BOQ report in Budget).
export async function boqProgressPo(env, projectId) {
  return (await env.DB.prepare(`SELECT i.boq_item_id AS boq, SUM(i.qty) AS ordered, SUM(i.amount_paise) AS ordered_paise FROM pro_po_items i JOIN pro_pos p ON p.id = i.po_id
    WHERE p.project_id = ? AND p.deleted_at IS NULL AND p.status IN ('approved', 'part_received', 'received') AND i.boq_item_id IS NOT NULL GROUP BY i.boq_item_id`).bind(projectId).all()).results;
}

export function registerProcurement2(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, csvBom, getCurrentUser, userCan, grnStockStatements, stockItemExists, getSetting } = h;

  // Site engineers hold Create (not View) on procurement. Screens they need to fill in must still be readable by them.
  const viewOrCreate = async (req, env, fn) => {
    const u = await getCurrentUser(env, req.headers.get('cookie'));
    return withAuth(req, env, 'procurement', u && userCan(u, 'procurement', 'V') ? 'V' : 'C', fn);
  };

  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 300), nowStr());

  // One notification per user of the given roles, in a single batch.
  async function notifyRoles(env, roles, title, body, link) {
    const ph = roles.map(() => '?').join(',');
    const users = await env.DB.prepare(`SELECT id FROM users WHERE role IN (${ph}) AND active = 1 AND deleted_at IS NULL LIMIT 20`).bind(...roles).all();
    if (!users.results.length) return;
    const now = nowStr();
    await env.DB.batch(users.results.map((u) => env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, title, body, link, now)));
  }
  const notifyUser = (env, userId, title, body, link) => userId
    ? env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, title, body, link, nowStr()).run() : null;

  const csvResponse = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });

  // ---------- Indents ----------
  router.post('/api/procurement/indents', async (req, env) => withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const b = await req.json();
      const items = (Array.isArray(b.items) ? b.items : []).filter((i) => i && String(i.description || '').trim() && num(i.qty) > 0).slice(0, 40);
      const rawBoq = (Array.isArray(b.items) ? b.items : []).filter((i) => i && String(i.description || '').trim() && num(i.qty) > 0).slice(0, 40).map((i) => Number(i.boq_item_id) || null);
      const pid = Number(b.project_id);
      if (!pid || !items.length) return json({ ok: false, error: 'Pick the project and add at least one item with a quantity.' }, 400);
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (b.client_uuid) {
        const dup = await env.DB.prepare('SELECT id, indent_no FROM pro_indents WHERE client_uuid = ?').bind(String(b.client_uuid)).first();
        if (dup) return json({ ok: true, data: { id: dup.id, indent_no: dup.indent_no, duplicate: true } });
      }
      // CC-floor lock: a request for a floor above the approved CC is refused (the Owner may go ahead with a written reason).
      const wing = String(b.wing || '').trim().slice(0, 20) || null;
      const floor = b.floor === '' || b.floor == null ? null : Math.round(Number(b.floor));
      if (floor != null && !(floor >= 0 && floor <= 200)) return json({ ok: false, error: 'Check the floor number (0 is the plinth).' }, 400);
      let ccOverride = null;
      const blk = await ccFloorBlock(env, pid, wing, floor);
      if (blk) {
        const why = String(b.override_note || '').trim().slice(0, 300);
        if (req.user.role !== 'owner' || why.length < 10) return json({ ok: false, error: blk + (req.user.role === 'owner' ? ' As the Owner you can go ahead only with a written reason.' : ' Material for this floor cannot be requested yet.'), code: 'cc' }, 409);
        ccOverride = why;
      }
      // Atomic counter: one statement, no read-then-write race.
      const c = await env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value').bind(`ind:${pid}`).first();
      const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(pid).first();
      const no = `IND-${proj ? proj.code : pid}-${String(c.value).padStart(4, '0')}`;
      const now = nowStr();
      const r = await env.DB.prepare("INSERT INTO pro_indents (project_id, indent_no, needed_by, note, status, requested_by, client_uuid, created_at, wing, floor, cc_override_note) VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)")
        .bind(pid, no, b.needed_by || null, String(b.note || '').slice(0, 500), req.user.user_id, b.client_uuid || null, now, wing, floor, ccOverride).run();
      const id = r.meta.last_row_id;
      // BOQ allowance: a line that passes the BOQ quantity (counting earlier requests) is marked "over BOQ" and the PM is told.
      const { flags, names } = await indentBoqFlags(env, pid, items.map((i, k) => ({ boq: rawBoq[k], qty: num(i.qty) })));
      await env.DB.batch([
        ...items.map((i, k) => env.DB.prepare('INSERT INTO pro_indent_items (indent_id, description, qty, unit, boq_item_id, over_boq) VALUES (?, ?, ?, ?, ?, ?)').bind(id, String(i.description).trim().slice(0, 200), num(i.qty), String(i.unit || '').slice(0, 20), rawBoq[k], flags.get(k) ? 1 : 0)),
        audit(env, req.user, 'create', 'pro_indents', id, `Indent ${no} raised (${items.length} items${flags.size ? ', ' + flags.size + ' over BOQ' : ''})`),
      ]);
      await notifyRoles(env, ['pm'], `Indent to approve: ${no}`, `${req.user.name} needs ${items.length} item(s).${flags.size ? ' OVER BOQ: ' + Object.values(names).slice(0, 3).join('; ') : ''}`, 'procurement');
      return json({ ok: true, data: { id, indent_no: no, over_boq: flags.size } });
    } catch (e) { return serverError(e, 'indent-create'); }
  }));

  router.get('/api/procurement/indents', async (req, env) => viewOrCreate(req, env, async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { indents: [] } });
      const q = new URL(req.url).searchParams;
      const status = q.get('status');
      const rows = await env.DB.prepare(`SELECT i.*, u.name AS requested_by_name, (SELECT COUNT(*) FROM pro_indent_items x WHERE x.indent_id = i.id) AS item_count
        FROM pro_indents i LEFT JOIN users u ON u.id = i.requested_by
        WHERE i.deleted_at IS NULL AND i.project_id IN (${ids.map(() => '?').join(',')})${status ? ' AND i.status = ?' : ''} ORDER BY i.id DESC LIMIT 100`)
        .bind(...ids, ...(status ? [status] : [])).all();
      return json({ ok: true, data: { indents: rows.results } });
    } catch (e) { return serverError(e, 'indent-list'); }
  }));

  async function loadIndent(env, req) {
    const ind = await env.DB.prepare('SELECT * FROM pro_indents WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!ind) return { err: json({ ok: false, error: 'Indent not found.' }, 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(ind.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { ind };
  }

  router.get('/api/procurement/indents/:id', async (req, env) => viewOrCreate(req, env, async (req, env) => {
    try {
      const { ind, err } = await loadIndent(env, req); if (err) return err;
      const items = await env.DB.prepare('SELECT * FROM pro_indent_items WHERE indent_id = ? ORDER BY id').bind(ind.id).all();
      return json({ ok: true, data: { indent: ind, items: items.results } });
    } catch (e) { return serverError(e, 'indent-get'); }
  }));

  const decide = (decision) => (req, env) => withAuth(req, env, 'procurement', 'A', async (req, env) => {
    try {
      const { ind, err } = await loadIndent(env, req); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (decision === 'rejected' && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      // Conditional update: two approvers tapping at once cannot both win.
      const r = await env.DB.prepare("UPDATE pro_indents SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'submitted'")
        .bind(decision, req.user.user_id, nowStr(), String(b.note || '').slice(0, 300), ind.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This indent was already decided.' }, 409);
      await audit(env, req.user, decision === 'approved' ? 'approve' : 'reject', 'pro_indents', ind.id, `${req.user.name} ${decision} ${ind.indent_no}`).run();
      await notifyUser(env, ind.requested_by, `Indent ${decision}: ${ind.indent_no}`, String(b.note || ''), 'procurement');
      if (decision === 'approved') await notifyRoles(env, ['purchase'], `Approved indent: ${ind.indent_no}`, 'Ready to convert to an RFQ.', 'procurement');
      return json({ ok: true });
    } catch (e) { return serverError(e, 'indent-decide'); }
  });
  router.post('/api/procurement/indents/:id/approve', decide('approved'));
  router.post('/api/procurement/indents/:id/reject', decide('rejected'));

  // Purchase (not site) turns an approved indent into an RFQ with the same lines.
  router.post('/api/procurement/indents/:id/convert', async (req, env) => withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Only Purchase or the PM can make an RFQ.' }, 403);
      const { ind, err } = await loadIndent(env, req); if (err) return err;
      const claim = await env.DB.prepare("UPDATE pro_indents SET status = 'converted' WHERE id = ? AND status = 'approved'").bind(ind.id).run();
      if (!claim.meta.changes) return json({ ok: false, error: 'Only an approved indent can be converted.' }, 409);
      const now = nowStr();
      const rfq = await env.DB.prepare("INSERT INTO pro_rfqs (project_id, title, needed_by, indent_id, status, created_by, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?)")
        .bind(ind.project_id, `From ${ind.indent_no}`, ind.needed_by, ind.id, req.user.user_id, now).run();
      const rid = rfq.meta.last_row_id;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO pro_rfq_items (rfq_id, description, qty, unit) SELECT ?, description, qty, unit FROM pro_indent_items WHERE indent_id = ?').bind(rid, ind.id),
        env.DB.prepare('UPDATE pro_indents SET rfq_id = ? WHERE id = ?').bind(rid, ind.id),
        audit(env, req.user, 'convert', 'pro_indents', ind.id, `${ind.indent_no} converted to RFQ ${rid}`),
      ]);
      return json({ ok: true, data: { rfq_id: rid } });
    } catch (e) { return serverError(e, 'indent-convert'); }
  }));

  // ---------- Multi-line RFQ ----------
  async function loadRfq(env, req) {
    const rfq = await env.DB.prepare('SELECT * FROM pro_rfqs WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!rfq) return { err: json({ ok: false, error: 'RFQ not found.' }, 404) };
    if (rfq.project_id && !(await visibleProjectIds(env, req.user)).includes(rfq.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { rfq };
  }

  router.post('/api/procurement/rfqs/:id/items', async (req, env) => withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const { rfq, err } = await loadRfq(env, req); if (err) return err;
      const b = await req.json();
      const items = (Array.isArray(b.items) ? b.items : []).filter((i) => i && String(i.description || '').trim() && num(i.qty) > 0).slice(0, 40);
      if (!items.length) return json({ ok: false, error: 'Add at least one item with a quantity.' }, 400);
      const quoted = await env.DB.prepare('SELECT COUNT(*) AS n FROM pro_quotes WHERE rfq_id = ? AND deleted_at IS NULL').bind(rfq.id).first();
      if (quoted.n) return json({ ok: false, error: 'Quotes are already in. Items can no longer change.' }, 409);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM pro_rfq_items WHERE rfq_id = ?').bind(rfq.id),
        ...items.map((i) => env.DB.prepare('INSERT INTO pro_rfq_items (rfq_id, description, qty, unit) VALUES (?, ?, ?, ?)').bind(rfq.id, String(i.description).trim().slice(0, 200), num(i.qty), String(i.unit || '').slice(0, 20))),
        audit(env, req.user, 'update', 'pro_rfqs', rfq.id, `RFQ items set (${items.length})`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'rfq-items'); }
  }));

  // Items, quotes with totals, per-line rates, and the lowest total — in 3 queries.
  router.get('/api/procurement/rfqs/:id/lines', async (req, env) => withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const { rfq, err } = await loadRfq(env, req); if (err) return err;
      const [items, quotes, qitems] = await Promise.all([
        env.DB.prepare('SELECT * FROM pro_rfq_items WHERE rfq_id = ? ORDER BY id').bind(rfq.id).all(),
        env.DB.prepare('SELECT q.id, q.vendor_id, q.amount_paise, q.delivery_days, q.selected, v.name AS vendor FROM pro_quotes q JOIN pro_vendors v ON v.id = q.vendor_id WHERE q.rfq_id = ? AND q.deleted_at IS NULL ORDER BY q.amount_paise').bind(rfq.id).all(),
        env.DB.prepare('SELECT qi.* FROM pro_quote_items qi JOIN pro_quotes q ON q.id = qi.quote_id WHERE q.rfq_id = ?').bind(rfq.id).all(),
      ]);
      const lowest = quotes.results.length ? Math.min(...quotes.results.map((q) => q.amount_paise)) : null;
      return json({ ok: true, data: { rfq, items: items.results, quotes: quotes.results.map((q) => ({ ...q, lowest: q.amount_paise === lowest, rates: qitems.results.filter((x) => x.quote_id === q.id) })) } });
    } catch (e) { return serverError(e, 'rfq-lines'); }
  }));

  // Quote with a rate per line; the total is calculated here, never trusted from the browser.
  router.post('/api/procurement/rfqs/:id/line-quote', async (req, env) => withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const { rfq, err } = await loadRfq(env, req); if (err) return err;
      const b = await req.json();
      const items = (await env.DB.prepare('SELECT id, qty FROM pro_rfq_items WHERE rfq_id = ?').bind(rfq.id).all()).results;
      if (!items.length) return json({ ok: false, error: 'This RFQ has no items yet.' }, 400);
      if (!b.vendor_id) return json({ ok: false, error: 'Pick a vendor.' }, 400);
      const rates = b.rates || {};
      let total = 0; const lines = [];
      for (const it of items) {
        const rate = Math.round(num(rates[it.id]));
        if (!(rate > 0)) return json({ ok: false, error: 'Enter a rate for every item.' }, 400);
        lines.push([it.id, rate]); total += Math.round(num(it.qty) * rate);
      }
      const r = await env.DB.prepare('INSERT INTO pro_quotes (rfq_id, vendor_id, rate_paise, amount_paise, delivery_days, terms, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)')
        .bind(rfq.id, Number(b.vendor_id), total, b.delivery_days ?? null, String(b.terms || '').slice(0, 300), nowStr()).run();
      const qid = r.meta.last_row_id;
      await env.DB.batch(lines.map(([iid, rate]) => env.DB.prepare('INSERT INTO pro_quote_items (quote_id, rfq_item_id, rate_paise) VALUES (?, ?, ?)').bind(qid, iid, rate)));
      return json({ ok: true, data: { id: qid, total_paise: total } });
    } catch (e) { return serverError(e, 'line-quote'); }
  }));

  // POs the site can receive material against: names and status only, never amounts.
  router.get('/api/procurement/pos-to-receive', async (req, env) => viewOrCreate(req, env, async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { pos: [] } });
      const rows = await env.DB.prepare(`SELECT p.id, p.po_no, p.status, p.project_id, v.name AS vendor_name FROM pro_pos p JOIN pro_vendors v ON v.id = p.vendor_id
        WHERE p.deleted_at IS NULL AND p.status IN ('approved', 'part_received') AND p.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.id DESC LIMIT 50`).bind(...ids).all();
      return json({ ok: true, data: { pos: rows.results } });
    } catch (e) { return serverError(e, 'pos-to-receive'); }
  }));

  // ---------- GRN by PO line ----------
  router.get('/api/procurement/pos/:id/lines', async (req, env) => viewOrCreate(req, env, async (req, env) => {
    try {
      const po = await env.DB.prepare('SELECT id, project_id, po_no, status FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      // No rates or amounts: the site engineer sees quantities only.
      const items = await env.DB.prepare(`SELECT i.id, i.description, i.qty AS ordered, i.unit, i.stock_item_id,
        COALESCE((SELECT SUM(gi.qty_received) FROM pro_grn_items gi JOIN pro_grns g ON g.id = gi.grn_id WHERE gi.po_item_id = i.id AND g.deleted_at IS NULL), 0) AS received
        FROM pro_po_items i WHERE i.po_id = ? ORDER BY i.id`).bind(po.id).all();
      return json({ ok: true, data: { po, items: items.results } });
    } catch (e) { return serverError(e, 'po-lines'); }
  }));


  // Charges and terms on a PO that is still a draft (or was sent back). Totals are worked out again.
  router.put('/api/procurement/pos/:id/terms', async (req, env) => withAuth(req, env, 'procurement', 'E', async (req, env) => {
    try {
      const po = await env.DB.prepare('SELECT * FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!po || !(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'PO not found.' }, 404);
      if (!['draft', 'rejected'].includes(po.status)) return json({ ok: false, error: 'Only a draft PO can be changed. An approved PO is final.' }, 400);
      const b = await req.json();
      const it = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS goods FROM pro_po_items WHERE po_id = ?').bind(po.id).first();
      const oldCharges = ['transport_paise', 'loading_paise', 'packing_paise', 'insurance_paise', 'other_charges_paise'].reduce((x, k) => x + (po[k] || 0), 0);
      const goods = it.n ? it.goods : po.amount_paise - oldCharges;
      const r = poTermsStatement(env, po, goods, b); if (r.error) return json({ ok: false, error: r.error }, 400);
      await env.DB.batch([r.stmt, env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'edit', 'pro_pos', po.id, `PO ${po.po_no}: charges and terms updated (total now Rs ${(r.total / 100).toFixed(2)})`, nowStr())]);
      return json({ ok: true, data: { amount_paise: r.amount, gst_paise: r.gst, total_paise: r.total } });
    } catch (e) { return serverError(e, 'po-terms'); }
  }));

  router.post('/api/procurement/pos/:id/grn-lines', async (req, env) => withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const po = await env.DB.prepare('SELECT * FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (!['approved', 'part_received'].includes(po.status)) return json({ ok: false, error: 'Material can only be received against an approved PO.' }, 400);
      const b = await req.json();
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM pro_grns WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      // Gate rules (switch: pro.grn_gate, on unless set to Off): a challan number is compulsory and can be used once per supplier.
      const gate = (await getSetting(env, 'pro.grn_gate')) !== 'off';
      const challan = String(b.challan_no || '').trim().slice(0, 40);
      if (gate) {
        if (challan.length < 3) return json({ ok: false, error: 'Enter the challan / delivery note number from the truck. It cannot be left blank.', code: 'challan' }, 400);
        const used = await env.DB.prepare('SELECT g.id, g.received_on, p.po_no FROM pro_grns g JOIN pro_pos p ON p.id = g.po_id WHERE g.vendor_id = ? AND lower(trim(g.challan_no)) = lower(?) AND g.deleted_at IS NULL LIMIT 1').bind(po.vendor_id, challan).first();
        if (used) return json({ ok: false, error: `Challan ${challan} from this supplier was already received on ${used.received_on} against ${used.po_no}. A challan number can be used only once.`, code: 'challan_reuse' }, 409);
      }
      const photoDoc = b.photo_doc_id ? Number(b.photo_doc_id) : null;
      if (photoDoc && !(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(photoDoc, po.project_id).first())) return json({ ok: false, error: 'The gate photo was not found.' }, 400);
      const truck = String(b.truck_no || '').trim().toUpperCase().slice(0, 20) || null;
      const weight = b.weight_kg === '' || b.weight_kg == null ? null : num(b.weight_kg);
      if (weight != null && !(weight > 0 && weight < 1e6)) return json({ ok: false, error: 'Check the weighbridge weight (in kg).' }, 400);
      const lat = b.lat == null || b.lat === '' ? null : num(b.lat), lng = b.lng == null || b.lng === '' ? null : num(b.lng), acc = b.accuracy_m == null || b.accuracy_m === '' ? null : num(b.accuracy_m);
      if ((lat != null || lng != null) && !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return json({ ok: false, error: 'The location looks wrong.' }, 400);
      const stockOf = Object.fromEntries((await env.DB.prepare('SELECT id, stock_item_id FROM pro_po_items WHERE po_id = ?').bind(po.id).all()).results.map((r) => [r.id, r.stock_item_id]));
      const valid = new Set(Object.keys(stockOf).map(Number));
      const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ id: Number(l.po_item_id), qty: num(l.qty_received), link: Number(l.stock_item_id) || 0 })).filter((l) => l.qty > 0);
      if (!lines.length) return json({ ok: false, error: 'Enter a quantity for at least one item.' }, 400);
      if (lines.some((l) => !valid.has(l.id))) return json({ ok: false, error: 'An item does not belong to this PO.' }, 400);
      // Never more than ordered (plus the tolerance) unless the PM or the Owner accepts the excess with a reason.
      const tol = Math.max(0, Math.round(num(await getSetting(env, 'pro.tolerance_bp')) || 300));
      const ord = Object.fromEntries((await env.DB.prepare(`SELECT i.id, i.description, i.qty, COALESCE((SELECT SUM(gi.qty_received) FROM pro_grn_items gi JOIN pro_grns g ON g.id = gi.grn_id WHERE gi.po_item_id = i.id AND g.deleted_at IS NULL), 0) AS got
        FROM pro_po_items i WHERE i.po_id = ?`).bind(po.id).all()).results.map((r) => [r.id, r]));
      const over = lines.filter((l) => ord[l.id] && ord[l.id].qty > 0 && ord[l.id].got + l.qty > ord[l.id].qty * (10000 + tol) / 10000 + 1e-9).map((l) => `${ord[l.id].description}: ${+(ord[l.id].got + l.qty).toFixed(3)} received against ${ord[l.id].qty} ordered`);
      const excessNote = String(b.excess_note || '').trim().slice(0, 300);
      if (over.length && (!['owner', 'pm'].includes(req.user.role) || !excessNote)) return json({ ok: false, error: `More than ordered: ${over.join('; ')}. ${['owner', 'pm'].includes(req.user.role) ? 'Give a reason to accept the excess.' : 'Only the PM or the Owner can accept more than the PO (plus ' + tol / 100 + '%).'}`, code: 'excess', over }, 409);
      // A line not yet tied to a store item can be tied now, so what arrives is counted in the store.
      const links = lines.filter((l) => l.link && !stockOf[l.id]);
      for (const l of links) { if (!(await stockItemExists(env, l.link))) return json({ ok: false, error: 'That store item does not exist.' }, 400); stockOf[l.id] = l.link; }
      const now = nowStr();
      const summary = String(b.qty_note || '').slice(0, 300);
      // One batch: receipt, its lines, and the PO status computed from the totals. All or nothing.
      await env.DB.batch([
        env.DB.prepare('INSERT INTO pro_grns (po_id, received_on, qty_note, challan_no, received_by, client_uuid, created_at, excess_note, vendor_id, truck_no, weight_kg, lat, lng, accuracy_m, document_id, photo_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(po.id, b.received_on || now.substring(0, 10), summary, challan, req.user.user_id, uuid, now, over.length ? excessNote : null, po.vendor_id, truck, weight, lat, lng, acc, photoDoc, photoDoc ? now : null),
        ...links.map((l) => env.DB.prepare('UPDATE pro_po_items SET stock_item_id = ? WHERE id = ? AND stock_item_id IS NULL').bind(l.link, l.id)),
        ...lines.map((l) => env.DB.prepare('INSERT INTO pro_grn_items (grn_id, po_item_id, qty_received, created_at) VALUES ((SELECT id FROM pro_grns WHERE client_uuid = ?), ?, ?, ?)').bind(uuid, l.id, l.qty, now)),
        // Items tied to a stock item also go into the store, in this same batch.
        ...grnStockStatements(env, now, po.project_id, req.user.user_id, uuid, lines.map((l) => ({ po_item_id: l.id, stock_item_id: stockOf[l.id], qty: l.qty }))),
        env.DB.prepare(`UPDATE pro_pos SET status = CASE WHEN NOT EXISTS (
            SELECT 1 FROM pro_po_items i WHERE i.po_id = ? AND COALESCE(i.qty, 0) > COALESCE((SELECT SUM(gi.qty_received) FROM pro_grn_items gi JOIN pro_grns g ON g.id = gi.grn_id WHERE gi.po_item_id = i.id AND g.deleted_at IS NULL), 0)
          ) THEN 'received' ELSE 'part_received' END WHERE id = ? AND status IN ('approved', 'part_received')`).bind(po.id, po.id),
        audit(env, req.user, 'grn', 'pro_pos', po.id, `Material received against ${po.po_no} (${lines.length} items)`),
      ]);
      const g = await env.DB.prepare('SELECT id FROM pro_grns WHERE client_uuid = ?').bind(uuid).first();
      const after = await env.DB.prepare('SELECT status FROM pro_pos WHERE id = ?').bind(po.id).first();
      await notifyRoles(env, ['purchase', 'pm'], `Material received: ${po.po_no}`, after.status === 'received' ? 'Order complete.' : 'Part delivery.', 'procurement');
      return json({ ok: true, data: { id: g.id, po_status: after.status, photo_missing: !photoDoc } });
    } catch (e) { return serverError(e, 'grn-lines'); }
  }));

  // Attach (or add later) the gate photo of a receipt, for example when the phone had no signal at the gate.
  router.post('/api/procurement/grns/:id/photo', async (req, env) => withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const g = await env.DB.prepare('SELECT g.id, g.document_id, p.project_id FROM pro_grns g JOIN pro_pos p ON p.id = g.po_id WHERE g.id = ? AND g.deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!g || !(await visibleProjectIds(env, req.user)).includes(g.project_id)) return json({ ok: false, error: 'Receipt not found.' }, 404);
      if (g.document_id) return json({ ok: false, error: 'This receipt already has its gate photo.' }, 409);
      const b = await req.json().catch(() => ({}));
      const d = await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(b.document_id), g.project_id).first();
      if (!d) return json({ ok: false, error: 'The photo was not found.' }, 400);
      await env.DB.batch([env.DB.prepare('UPDATE pro_grns SET document_id = ?, photo_at = ? WHERE id = ? AND document_id IS NULL').bind(d.id, nowStr(), g.id), audit(env, req.user, 'grn_photo', 'pro_grns', g.id, 'Gate photo added to a receipt')]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'grn-photo'); }
  }));

  // ---------- Bill payments (part payments, reversal instead of delete) ----------
  const payable = (b) => b.amount_paise - (b.tds_paise || 0);

  // Re-derive the bill status from the live payment total. Runs in the same batch as the payment write.
  const syncBillStatus = (env, billId) => env.DB.prepare(`UPDATE pro_bills SET
      status = CASE WHEN COALESCE((SELECT SUM(amount_paise) FROM pro_payments WHERE bill_id = ?1 AND reversed_at IS NULL), 0) >= amount_paise - tds_paise THEN 'paid'
                    WHEN COALESCE((SELECT SUM(amount_paise) FROM pro_payments WHERE bill_id = ?1 AND reversed_at IS NULL), 0) > 0 THEN 'part_paid' ELSE 'received' END,
      paid_on = (SELECT MAX(paid_on) FROM pro_payments WHERE bill_id = ?1 AND reversed_at IS NULL)
      WHERE id = ?1 AND status IN ('received', 'approved', 'part_paid', 'paid')`).bind(billId);

  async function recordPayment(req, env, bill, amount, b) {
    const now = nowStr();
    // Atomic over-payment guard: inserts only while the balance still covers the amount.
    const ins = await env.DB.prepare(`INSERT INTO pro_payments (bill_id, amount_paise, tds_paise, paid_on, mode, ref_no, note, created_by, created_at)
      SELECT ?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8 WHERE (SELECT amount_paise - tds_paise FROM pro_bills WHERE id = ?1) - COALESCE((SELECT SUM(amount_paise) FROM pro_payments WHERE bill_id = ?1 AND reversed_at IS NULL), 0) >= ?2`)
      .bind(bill.id, amount, String(b.paid_on || now.substring(0, 10)).slice(0, 10), String(b.mode || '').slice(0, 20), String(b.ref_no || b.payment_ref || '').slice(0, 60), String(b.note || '').slice(0, 200), req.user.user_id, now).run();
    if (!ins.meta.changes) return null;
    await env.DB.batch([syncBillStatus(env, bill.id), audit(env, req.user, 'pay', 'pro_bills', bill.id, `Paid ${rupees(amount)} on bill ${bill.bill_no || bill.id}`)]);
    return ins.meta.last_row_id;
  }

  async function billWithBalance(env, id) {
    const bill = await env.DB.prepare('SELECT * FROM pro_bills WHERE id = ?').bind(id).first();
    if (!bill) return null;
    const p = await env.DB.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM pro_payments WHERE bill_id = ? AND reversed_at IS NULL').bind(id).first();
    // Legacy bills marked paid before payments existed have no rows: treat as fully paid.
    const legacyPaid = bill.status === 'paid' && !p.paid;
    bill.paid_paise = legacyPaid ? payable(bill) : p.paid;
    bill.balance_paise = Math.max(0, payable(bill) - bill.paid_paise);
    return bill;
  }

  const billAllowed = async (env, req, bill) => {
    if (!bill.project_id) return true;
    return (await visibleProjectIds(env, req.user)).includes(bill.project_id);
  };

  router.post('/api/procurement/bills/:id/payments', async (req, env) => withAuth(req, env, 'procurement', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can record payments.' }, 403);
      const bill = await billWithBalance(env, Number(req.params.id));
      if (!bill) return json({ ok: false, error: 'Bill not found.' }, 404);
      if (!(await billAllowed(env, req, bill))) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (bill.hold_reason && !bill.released_at) return json({ ok: false, error: `This bill is on hold: ${bill.hold_reason} The PM or the Owner must release it before it is paid.`, code: 'held' }, 409);
      const b = await req.json();
      const amount = Math.round(num(b.amount_paise));
      if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount paid.' }, 400);
      if (amount > bill.balance_paise) return json({ ok: false, error: `Only ${rupees(bill.balance_paise)} is still due on this bill.` }, 400);
      const id = await recordPayment(req, env, bill, amount, b);
      if (!id) return json({ ok: false, error: 'The balance changed. Reload and try again.' }, 409);
      const after = await billWithBalance(env, bill.id);
      return json({ ok: true, data: { id, status: after.status, balance_paise: after.balance_paise } });
    } catch (e) { return serverError(e, 'bill-payment'); }
  }));

  // Old one-tap "mark paid" now pays whatever is still due, as a normal payment row.
  router.post('/api/procurement/bills/:id/pay', async (req, env) => withAuth(req, env, 'procurement', 'E', async (req, env) => {
    try {
      const bill = await billWithBalance(env, Number(req.params.id));
      if (!bill) return json({ ok: false, error: 'Bill not found.' }, 404);
      if (!(await billAllowed(env, req, bill))) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (bill.hold_reason && !bill.released_at) return json({ ok: false, error: `This bill is on hold: ${bill.hold_reason} The PM or the Owner must release it before it is paid.`, code: 'held' }, 409);
      if (bill.balance_paise <= 0) return json({ ok: false, error: 'This bill is already paid.' }, 400);
      const b = await req.json().catch(() => ({}));
      const id = await recordPayment(req, env, bill, bill.balance_paise, b);
      if (!id) return json({ ok: false, error: 'The balance changed. Reload and try again.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bill-pay'); }
  }));

  router.post('/api/procurement/payments/:id/reverse', async (req, env) => withAuth(req, env, 'procurement', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can reverse a payment.' }, 403);
      const b = await req.json();
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why this payment is reversed.' }, 400);
      const pay = await env.DB.prepare('SELECT * FROM pro_payments WHERE id = ?').bind(Number(req.params.id)).first();
      if (!pay) return json({ ok: false, error: 'Payment not found.' }, 404);
      const bill = await env.DB.prepare('SELECT * FROM pro_bills WHERE id = ?').bind(pay.bill_id).first();
      if (!(await billAllowed(env, req, bill))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const r = await env.DB.prepare('UPDATE pro_payments SET reversed_at = ?, reversal_note = ? WHERE id = ? AND reversed_at IS NULL').bind(nowStr(), String(b.reason).slice(0, 200), pay.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Already reversed.' }, 409);
      await env.DB.batch([syncBillStatus(env, bill.id), audit(env, req.user, 'reverse', 'pro_payments', pay.id, `Reversed ${rupees(pay.amount_paise)} on bill ${bill.bill_no || bill.id}: ${String(b.reason).slice(0, 100)}`)]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'payment-reverse'); }
  }));

  // ---------- Vendor ledger with exact balance (replaces the old two-list view) ----------
  router.get('/api/procurement/vendors/:id/statement', async (req, env) => withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      if (!MONEY_ROLES.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { bills: [], payable_paise: 0 } });
      const ph = ids.map(() => '?').join(',');
      const bills = await env.DB.prepare(`SELECT b.id, b.bill_no, b.amount_paise, b.tds_paise, b.status, b.due_date,
          COALESCE((SELECT SUM(x.amount_paise) FROM pro_payments x WHERE x.bill_id = b.id AND x.reversed_at IS NULL), 0) AS paid_paise
        FROM pro_bills b WHERE b.vendor_id = ? AND (b.project_id IS NULL OR b.project_id IN (${ph})) ORDER BY b.id DESC LIMIT 200`).bind(Number(req.params.id), ...ids).all();
      let payableTotal = 0;
      const out = bills.results.map((r) => {
        const net = r.amount_paise - r.tds_paise;
        const paid = r.status === 'paid' && !r.paid_paise ? net : r.paid_paise;
        const balance = Math.max(0, net - paid);
        payableTotal += balance;
        return { ...r, net_paise: net, paid_paise: paid, balance_paise: balance };
      });
      const pays = out.length ? await env.DB.prepare(`SELECT id, bill_id, amount_paise, paid_on, mode, ref_no FROM pro_payments WHERE reversed_at IS NULL AND bill_id IN (${out.map(() => '?').join(',')}) ORDER BY id DESC`).bind(...out.map((o) => o.id)).all() : { results: [] };
      return json({ ok: true, data: { bills: out, payments: pays.results, payable_paise: payableTotal } });
    } catch (e) { return serverError(e, 'vendor-statement'); }
  }));

  // ---------- Reports (JSON, or CSV with ?csv=1) ----------
  router.get('/api/procurement/reports/pending-indents', async (req, env) => withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      const rows = ids.length ? (await env.DB.prepare(`SELECT i.indent_no, p.name AS project, i.status, i.needed_by, i.created_at, u.name AS requested_by,
          (SELECT COUNT(*) FROM pro_indent_items x WHERE x.indent_id = i.id) AS items
        FROM pro_indents i JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = i.requested_by
        WHERE i.deleted_at IS NULL AND i.status IN ('submitted', 'approved') AND i.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY i.needed_by IS NULL, i.needed_by LIMIT 300`).bind(...ids).all()).results : [];
      if (new URL(req.url).searchParams.get('csv')) return csvResponse('pending-indents.csv', [['Indent', 'Project', 'Status', 'Needed by', 'Raised', 'By', 'Items'], ...rows.map((r) => [r.indent_no, r.project, r.status, r.needed_by || '', r.created_at, r.requested_by || '', r.items])]);
      return json({ ok: true, data: { rows } });
    } catch (e) { return serverError(e, 'rep-indents'); }
  }));

  router.get('/api/procurement/reports/po-vs-received', async (req, env) => withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      const rows = ids.length ? (await env.DB.prepare(`SELECT p.po_no, v.name AS vendor, i.description, i.unit, i.qty AS ordered,
          COALESCE((SELECT SUM(gi.qty_received) FROM pro_grn_items gi JOIN pro_grns g ON g.id = gi.grn_id WHERE gi.po_item_id = i.id AND g.deleted_at IS NULL), 0) AS received
        FROM pro_po_items i JOIN pro_pos p ON p.id = i.po_id JOIN pro_vendors v ON v.id = p.vendor_id
        WHERE p.deleted_at IS NULL AND p.status IN ('approved', 'part_received', 'received') AND p.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.id DESC, i.id LIMIT 400`).bind(...ids).all()).results : [];
      if (new URL(req.url).searchParams.get('csv')) return csvResponse('po-vs-received.csv', [['PO', 'Vendor', 'Item', 'Unit', 'Ordered', 'Received', 'Pending'], ...rows.map((r) => [r.po_no, r.vendor, r.description, r.unit || '', r.ordered, r.received, Math.max(0, r.ordered - r.received)])]);
      return json({ ok: true, data: { rows } });
    } catch (e) { return serverError(e, 'rep-po-received'); }
  }));
}
