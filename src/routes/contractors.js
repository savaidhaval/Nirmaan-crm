// routes/contractors.js — WP-5: contractors, work orders, running-account (RA) bills, advance and retention ledger.
// Labour is paid through contractors, so there is no payroll. All money is integer paise; rates for GST/TDS are settings.
import { emit } from '../core/events.js';
import { approvalState, isDate, demolitionBlock, ccFloorBlock } from '../core/gates.js';

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const todayIST = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);
const MONEY_ROLES = ['owner', 'accounts'];
const BASES = ['lump_sum', 'item_rate', 'measured'];
const LEDGER_KIND = { ra: 'payment', advance: 'advance', retention_release: 'retention_released' };

export async function conEnabled(env, getSetting) { return (await getSetting(env, 'con.enabled')) === 'on'; }

// Hourly sweep (one statement): approved RA bills due within 2 days, one reminder per Accounts user per day.
export async function raDueSweep(env, getSetting) {
  if (!(await conEnabled(env, getSetting))) return;
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'RA bill due: ' || w.wo_no || ' / RA ' || r.ra_no, 'Due ' || r.due_date, 'contractors', datetime('now')
    FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id JOIN users u ON u.role = 'accounts' AND u.active = 1 AND u.deleted_at IS NULL
    WHERE r.status IN ('approved', 'part_paid') AND r.due_date IS NOT NULL AND r.due_date <= date('now', '+2 days')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'RA bill due: ' || w.wo_no || ' / RA ' || r.ra_no AND date(n.created_at) = date('now'))`).run();
}

// ----- Service functions other modules call (they never run SQL on con_* tables) -----
// Active contractors holding an approved work order on this project.
export async function activeContractorsForProject(env, projectId) {
  return (await env.DB.prepare(`SELECT DISTINCT c.id, c.name, c.trade FROM con_contractors c JOIN con_work_orders w ON w.contractor_id = c.id
    WHERE w.project_id = ? AND w.status = 'approved' AND c.active = 1 AND c.deleted_at IS NULL ORDER BY c.name LIMIT 100`).bind(projectId).all()).results;
}
export async function contractorNames(env, ids) {
  const list = [...new Set(ids.map(Number).filter(Boolean))].slice(0, 100);
  if (!list.length) return {};
  const rows = (await env.DB.prepare(`SELECT id, name, trade FROM con_contractors WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).all()).results;
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

// Per budget head for one project: committed (approved work orders), billed (approved RA bills) and paid on RA bills. Key 0 = not tagged.
export async function contractsByHead(env, projectId, inclGst) {
  const out = {};
  const add = (h, k, v) => { const key = h || 0; (out[key] = out[key] || { committed: 0, billed: 0, paid: 0 })[k] += Math.round(Number(v) || 0); };
  const [wo, ra, paid] = await Promise.all([
    env.DB.prepare("SELECT budget_head_id AS h, SUM(value_paise) AS v FROM con_work_orders WHERE project_id = ? AND status IN ('approved', 'closed') GROUP BY budget_head_id").bind(projectId).all(),
    env.DB.prepare(`SELECT w.budget_head_id AS h, SUM(r.gross_paise + CASE WHEN ?2 = 1 THEN r.gst_paise ELSE 0 END) AS v FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id
      WHERE w.project_id = ?1 AND r.status IN ('approved', 'part_paid', 'paid') GROUP BY w.budget_head_id`).bind(projectId, inclGst ? 1 : 0).all(),
    env.DB.prepare(`SELECT w.budget_head_id AS h, SUM(x.amount_paise) AS v FROM con_payments x JOIN con_work_orders w ON w.id = x.wo_id
      WHERE w.project_id = ? AND x.kind = 'ra' AND x.reversed_at IS NULL GROUP BY w.budget_head_id`).bind(projectId).all(),
  ]);
  for (const r of wo.results) add(r.h, 'committed', r.v);
  for (const r of ra.results) add(r.h, 'billed', r.v);
  for (const r of paid.results) add(r.h, 'paid', r.v);
  return out;
}
export async function wosForHead(env, headId) {
  return (await env.DB.prepare(`SELECT w.id, w.wo_no, w.status, c.name AS contractor, w.value_paise FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id
    WHERE w.budget_head_id = ? ORDER BY w.id DESC LIMIT 100`).bind(headId).all()).results;
}
export async function wosTaggedCount(env, headId) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM con_work_orders WHERE budget_head_id = ?').bind(headId).first()).n;
}

// Work-order items built from a drawing (for the "drawing revised" alert in Drawings).
export async function woItemsForDrawing(env, drawingId) {
  return (await env.DB.prepare(`SELECT i.id, i.description, w.wo_no, w.id AS wo_id FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id
    WHERE i.drawing_id = ? AND w.status IN ('approved', 'pending_approval', 'draft') LIMIT 50`).bind(drawingId).all()).results;
}
// An approved work order of this project (for issuing store material to it).
export async function woInProject(env, woId, projectId) {
  return env.DB.prepare("SELECT w.id, w.wo_no, c.name AS contractor FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id WHERE w.id = ? AND w.project_id = ? AND w.status = 'approved'").bind(woId, projectId).first();
}
export async function approvedWosForProject(env, projectId) {
  return (await env.DB.prepare("SELECT w.id, w.wo_no, c.name AS contractor FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id WHERE w.project_id = ? AND w.status = 'approved' ORDER BY w.id DESC LIMIT 100").bind(projectId).all()).results;
}
// Per BOQ item of a project: quantity committed in approved work orders (with approved variations), measured and billed.
export async function boqProgressCon(env, projectId) {
  return (await env.DB.prepare(`SELECT i.boq_item_id AS boq, SUM(i.qty + COALESCE((SELECT SUM(v.qty) FROM con_variations v WHERE v.wo_item_id = i.id AND v.status = 'approved'), 0)) AS committed,
      SUM(COALESCE((SELECT SUM(m.qty) FROM con_measurements m WHERE m.wo_item_id = i.id AND m.status = 'approved'), 0)) AS measured,
      SUM(COALESCE((SELECT SUM(l.qty_this_bill) FROM con_ra_lines l JOIN con_ra_bills r ON r.id = l.ra_id WHERE l.wo_item_id = i.id AND r.status != 'cancelled'), 0)) AS billed,
      SUM(i.amount_paise) AS committed_paise
    FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id WHERE w.project_id = ? AND w.status IN ('approved', 'closed') AND i.boq_item_id IS NOT NULL GROUP BY i.boq_item_id`).bind(projectId).all()).results;
}

export function registerContractors(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, encryptSetting, decryptSetting, printBrand, csvBom, headBelongsToProject, onWoApproved, boqItemInProject, drawingInProject, stockItemExists, issuedForWo } = h;

  const guard = (action, fn) => (req, env) => withAuth(req, env, 'contractors', action, async (req, env) => {
    if (!(await conEnabled(env, getSetting))) return json({ ok: false, error: 'The Contractors module is switched off. The Owner can switch it on in Settings.' }, 403);
    return fn(req, env);
  });

  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 300), nowStr());

  async function notifyRoles(env, roles, title, body, exceptUserId) {
    const users = await env.DB.prepare(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND active = 1 AND deleted_at IS NULL AND id != ? LIMIT 20`).bind(...roles, exceptUserId || 0).all();
    if (!users.results.length) return;
    const now = nowStr();
    await env.DB.batch(users.results.map((u) => env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, title, body, 'contractors', now)));
  }
  const csvResponse = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  const stripMoney = (w) => { for (const k of ['value_paise', 'retention_bp', 'advance_paise']) delete w[k]; return w; };

  async function pmLimit(env) { return num(await getSetting(env, 'con.pm_approval_limit_paise')) || 50000000; }
  const mayDecide = (user, amount, limit) => user.role === 'owner' || (user.role === 'pm' && amount <= limit);

  // Advance / retention balances for one work order, from the append-only ledger (one aggregate query).
  async function woBalances(env, woId) {
    const rows = await env.DB.prepare('SELECT kind, COALESCE(SUM(amount_paise), 0) AS s FROM con_ledger WHERE wo_id = ? GROUP BY kind').bind(woId).all();
    const m = Object.fromEntries(rows.results.map((r) => [r.kind, r.s]));
    return { advance_paid: m.advance || 0, advance_recovered: m.advance_recovery || 0, advance_outstanding: (m.advance || 0) - (m.advance_recovery || 0),
      retention_held: (m.retention_held || 0) - (m.retention_released || 0), paid_on_bills: m.payment || 0 };
  }

  async function loadWo(env, req) {
    const wo = await env.DB.prepare('SELECT w.*, c.name AS contractor, c.trade FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id WHERE w.id = ?').bind(Number(req.params.id)).first();
    if (!wo) return { err: json({ ok: false, error: 'Work order not found.' }, 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(wo.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { wo };
  }
  async function loadRa(env, req) {
    const ra = await env.DB.prepare('SELECT r.*, w.project_id, w.contractor_id, w.wo_no, w.status AS wo_status FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id WHERE r.id = ?').bind(Number(req.params.id)).first();
    if (!ra) return { err: json({ ok: false, error: 'RA bill not found.' }, 404) };
    if (!(await visibleProjectIds(env, req.user)).includes(ra.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { ra };
  }

  // ---------- status (always readable, so menus can hide the module) ----------
  router.get('/api/contractors/status', async (req, env) => withAuth(req, env, 'contractors', 'V', async (req, env) => json({ ok: true, data: { enabled: await conEnabled(env, getSetting) } })));

  // Site engineers use this to fill the daily report. Quiet when the module is off (they then see the single labour box).
  router.get('/api/contractors/for-project', async (req, env) => withAuth(req, env, 'contractors', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (!(await conEnabled(env, getSetting))) return json({ ok: true, data: { enabled: false, contractors: [] } });
      return json({ ok: true, data: { enabled: true, contractors: await activeContractorsForProject(env, pid) } });
    } catch (e) { return serverError(e, 'con-for-project'); }
  }));

  // ---------- contractors ----------
  router.get('/api/contractors/contractors', guard('V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT id, name, phone, trade, pan_enc, gstin, agreement_document_id, active FROM con_contractors WHERE deleted_at IS NULL ORDER BY active DESC, name LIMIT 300').all();
      for (const c of rows.results) {
        c.has_pan = !!c.pan_enc; c.pan_masked = '';
        if (c.pan_enc && MONEY_ROLES.includes(req.user.role)) { try { c.pan_masked = '••••' + (await decryptSetting(env, c.pan_enc)).slice(-4); } catch (e) { c.pan_masked = '••••'; } }
        delete c.pan_enc;
      }
      return json({ ok: true, data: { contractors: rows.results } });
    } catch (e) { return serverError(e, 'con-list'); }
  }));

  router.post('/api/contractors/contractors', guard('C', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      const name = String(b.name || '').trim();
      if (!name) return json({ ok: false, error: 'Contractor name is required.' }, 400);
      if (b.pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(b.pan).trim())) return json({ ok: false, error: 'PAN looks wrong (format ABCDE1234F).' }, 400);
      const pan = b.pan ? await encryptSetting(env, String(b.pan).trim().toUpperCase()) : null;
      const r = await env.DB.prepare('INSERT INTO con_contractors (name, phone, trade, pan_enc, gstin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(name.slice(0, 120), String(b.phone || '').slice(0, 20), String(b.trade || '').slice(0, 60), pan, String(b.gstin || '').slice(0, 20), nowStr()).run();
      await audit(env, req.user, 'create', 'con_contractors', r.meta.last_row_id, `Added contractor "${name}"`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'con-create'); }
  }));

  router.post('/api/contractors/contractors/:id/active', guard('E', async (req, env) => {
    try {
      const b = await req.json();
      await env.DB.prepare('UPDATE con_contractors SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, Number(req.params.id)).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'con-active'); }
  }));

  // ---------- work orders ----------
  router.post('/api/contractors/work-orders', guard('C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase'].includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can draw up a work order.' }, 403);
      const b = await req.json();
      const pid = Number(b.project_id), cid = Number(b.contractor_id);
      const basis = BASES.includes(b.basis) ? b.basis : 'lump_sum';
      if (!pid || !cid) return json({ ok: false, error: 'Pick the project and the contractor.' }, 400);
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const con = await env.DB.prepare('SELECT id FROM con_contractors WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(cid).first();
      if (!con) return json({ ok: false, error: 'Contractor not found or inactive.' }, 404);
      const items = (Array.isArray(b.items) ? b.items : []).filter((i) => i && String(i.description || '').trim() && num(i.qty) > 0 && num(i.rate_paise) > 0).slice(0, 60)
        .map((i) => ({ description: String(i.description).trim().slice(0, 200), qty: num(i.qty), unit: String(i.unit || '').slice(0, 20), rate: Math.round(num(i.rate_paise)),
          boq: Number(i.boq_item_id) || null, drawing: Number(i.drawing_id) || null, stock: Number(i.stock_item_id) || null, cons: i.consumption_per_unit === '' || i.consumption_per_unit == null ? null : num(i.consumption_per_unit), wast: i.wastage_bp === '' || i.wastage_bp == null ? null : Math.round(num(i.wastage_bp)) }));
      for (const i of items) {
        if (i.boq && !(await boqItemInProject(env, i.boq, pid))) return json({ ok: false, error: 'A BOQ item is not in this project.' }, 400);
        if (i.drawing && !(await drawingInProject(env, i.drawing, pid))) return json({ ok: false, error: 'A drawing is not in this project.' }, 400);
        if (i.stock && !(await stockItemExists(env, i.stock))) return json({ ok: false, error: 'A store item does not exist.' }, 400);
        if (i.cons != null && !(i.cons > 0)) return json({ ok: false, error: 'Material per unit must be more than zero.' }, 400);
        if (i.wast != null && !(i.wast >= 0 && i.wast <= 5000)) return json({ ok: false, error: 'Allowed wastage looks wrong.' }, 400);
      }
      if (basis !== 'lump_sum' && !items.length) return json({ ok: false, error: 'Add the items with quantity and rate.' }, 400);
      const value = items.length ? items.reduce((t, i) => t + Math.round(i.qty * i.rate), 0) : Math.round(num(b.value_paise));
      if (!(value > 0)) return json({ ok: false, error: 'Enter the work order value.' }, 400);
      const ret = Math.round(num(b.retention_bp));
      if (ret < 0 || ret > 3000) return json({ ok: false, error: 'Retention looks wrong (0 to 30%).' }, 400);
      const adv = Math.round(num(b.advance_paise));
      if (adv < 0 || adv > value) return json({ ok: false, error: 'Advance cannot be more than the work order value.' }, 400);
      const recBp = b.advance_recovery_bp !== undefined && b.advance_recovery_bp !== '' ? Math.round(num(b.advance_recovery_bp)) : Math.round(num(await getSetting(env, 'con.advance_recovery_bp')) || 1000);
      if (adv > 0 && !(recBp > 0 && recBp <= 10000)) return json({ ok: false, error: 'Say what share of each bill recovers the advance (1% to 100%).' }, 400);
      const headId = b.budget_head_id ? Number(b.budget_head_id) : null;
      if (headId && !(await headBelongsToProject(env, headId, pid))) return json({ ok: false, error: 'That budget head belongs to a different project.' }, 400);
      const c = await env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value').bind(`wo:${pid}`).first();
      const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(pid).first();
      const no = `WO-${proj ? proj.code : pid}-${String(c.value).padStart(4, '0')}`;
      const r = await env.DB.prepare("INSERT INTO con_work_orders (project_id, contractor_id, wo_no, scope, basis, value_paise, retention_bp, advance_paise, status, created_by, created_at, budget_head_id, advance_recovery_bp, is_demolition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)")
        .bind(pid, cid, no, String(b.scope || '').slice(0, 1000), basis, value, ret, adv, req.user.user_id, nowStr(), headId, adv > 0 ? recBp : null, b.is_demolition ? 1 : 0).run();
      const id = r.meta.last_row_id;
      await env.DB.batch([
        ...items.map((i) => env.DB.prepare('INSERT INTO con_wo_items (wo_id, description, qty, unit, rate_paise, amount_paise, boq_item_id, drawing_id, stock_item_id, consumption_per_unit, wastage_bp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, i.description, i.qty, i.unit, i.rate, Math.round(i.qty * i.rate), i.boq, i.drawing, i.stock, i.cons, i.wast)),
        audit(env, req.user, 'create', 'con_work_orders', id, `Work order ${no} drafted for ${rupees(value)}`),
      ]);
      return json({ ok: true, data: { id, wo_no: no, value_paise: value } });
    } catch (e) { return serverError(e, 'wo-create'); }
  }));

  router.get('/api/contractors/work-orders', guard('V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { work_orders: [] } });
      const rows = await env.DB.prepare(`SELECT w.*, c.name AS contractor, c.trade, p.name AS project FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id JOIN projects p ON p.id = w.project_id
        WHERE w.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY w.id DESC LIMIT 150`).bind(...ids).all();
      return json({ ok: true, data: { work_orders: req.user.role === 'site' ? rows.results.map(stripMoney) : rows.results } });
    } catch (e) { return serverError(e, 'wo-list'); }
  }));

  router.get('/api/contractors/work-orders/:id', guard('V', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (req.user.role === 'site') return json({ ok: true, data: { work_order: stripMoney(wo), items: [], ra_bills: [] } });
      const [items, bills, used, bal] = await Promise.all([
        env.DB.prepare('SELECT * FROM con_wo_items WHERE wo_id = ? ORDER BY id').bind(wo.id).all(),
        env.DB.prepare(`SELECT r.*, COALESCE((SELECT SUM(x.amount_paise) FROM con_payments x WHERE x.ra_id = r.id AND x.kind = 'ra' AND x.reversed_at IS NULL), 0) AS paid_paise FROM con_ra_bills r WHERE r.wo_id = ? ORDER BY r.ra_no`).bind(wo.id).all(),
        env.DB.prepare(`SELECT l.wo_item_id, SUM(l.qty_this_bill) AS qty FROM con_ra_lines l JOIN con_ra_bills r ON r.id = l.ra_id WHERE r.wo_id = ? AND r.status != 'cancelled' GROUP BY l.wo_item_id`).bind(wo.id).all(),
        woBalances(env, wo.id),
      ]);
      const [vq, mq, pv, pm] = await env.DB.batch([
        env.DB.prepare("SELECT wo_item_id, SUM(qty) AS q FROM con_variations WHERE wo_id = ? AND status = 'approved' AND wo_item_id IS NOT NULL GROUP BY wo_item_id").bind(wo.id),
        env.DB.prepare("SELECT wo_item_id, SUM(qty) AS q FROM con_measurements WHERE wo_id = ? AND status = 'approved' GROUP BY wo_item_id").bind(wo.id),
        env.DB.prepare("SELECT COUNT(*) AS n FROM con_variations WHERE wo_id = ? AND status = 'pending'").bind(wo.id),
        env.DB.prepare("SELECT COUNT(*) AS n FROM con_measurements WHERE wo_id = ? AND status = 'pending'").bind(wo.id),
      ]);
      const usedMap = Object.fromEntries(used.results.map((u) => [u.wo_item_id, u.qty]));
      const vMap = Object.fromEntries(vq.results.map((u) => [u.wo_item_id, u.q])), mMap = Object.fromEntries(mq.results.map((u) => [u.wo_item_id, u.q]));
      return json({ ok: true, data: { work_order: wo, items: items.results.map((i) => ({ ...i, billed_qty: usedMap[i.id] || 0, variation_qty: vMap[i.id] || 0, allowed_qty: i.qty + (vMap[i.id] || 0), measured_qty: mMap[i.id] || 0 })),
        ra_bills: bills.results, balances: bal, pending_variations: pv.results[0].n, pending_measurements: pm.results[0].n } });
    } catch (e) { return serverError(e, 'wo-get'); }
  }));

  router.post('/api/contractors/work-orders/:id/submit', guard('E', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (wo.created_by !== req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'Only the person who drew it up can send it for approval.' }, 403);
      const r = await env.DB.prepare("UPDATE con_work_orders SET status = 'pending_approval' WHERE id = ? AND status IN ('draft', 'rejected')").bind(wo.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Only a draft can be sent for approval.' }, 409);
      await notifyRoles(env, wo.value_paise > await pmLimit(env) ? ['owner'] : ['owner', 'pm'], `Work order to approve: ${wo.wo_no}`, `${wo.contractor}, ${rupees(wo.value_paise)}`, req.user.user_id);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'wo-submit'); }
  }));

  const decideWo = (decision) => guard('A', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (wo.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve a work order you drew up.' }, 403);
      const limit = await pmLimit(env);
      if (!mayDecide(req.user, wo.value_paise, limit)) return json({ ok: false, error: `This work order is above your limit (${rupees(limit)}). The Owner must decide.` }, 403);
      if (decision === 'rejected' && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      // A demolition work order is released only when the IOD and the site proofs (meter removal, tree and barricade NOCs) are on file.
      if (decision === 'approved' && wo.is_demolition) { const blk = await demolitionBlock(env, wo.project_id, getSetting); if (blk) return json({ ok: false, error: blk, code: 'demolition_gate' }, 409); }
      const r = await env.DB.prepare("UPDATE con_work_orders SET status = ?, approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ? AND status = 'pending_approval'")
        .bind(decision, req.user.user_id, nowStr(), String(b.note || '').slice(0, 300), wo.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This work order is not waiting for approval.' }, 409);
      await audit(env, req.user, decision === 'approved' ? 'approve' : 'reject', 'con_work_orders', wo.id, `${req.user.name} ${decision} ${wo.wo_no} (${rupees(wo.value_paise)})${wo.created_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`).run();
      if (decision === 'approved') emit('wo.approved', { wo_id: wo.id, project_id: wo.project_id, contractor_id: wo.contractor_id, value_paise: wo.value_paise });
      if (wo.created_by) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(wo.created_by, `Work order ${decision}: ${wo.wo_no}`, String(b.note || ''), 'contractors', nowStr()).run();
      const warnings = decision === 'approved' && wo.budget_head_id ? await onWoApproved(env, wo) : [];
      return json({ ok: true, data: { warnings } });
    } catch (e) { return serverError(e, 'wo-decide'); }
  });
  router.post('/api/contractors/work-orders/:id/approve', decideWo('approved'));
  router.post('/api/contractors/work-orders/:id/reject', decideWo('rejected'));

  router.post('/api/contractors/work-orders/:id/close', guard('A', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM con_ra_bills WHERE wo_id = ? AND status IN ('draft', 'checked', 'approved', 'part_paid')").bind(wo.id).first();
      if (open.n) return json({ ok: false, error: 'Some RA bills are not settled yet.' }, 409);
      { const bal0 = await woBalances(env, wo.id); if (bal0.advance_outstanding > 0) return json({ ok: false, error: `${rupees(bal0.advance_outstanding)} of the advance is not recovered yet. Recover it on a bill (or as a deduction) before closing.`, code: 'advance' }, 409); }
      const bal = await woBalances(env, wo.id);
      if (bal.retention_held > 0) return json({ ok: false, error: `Release the retention (${rupees(bal.retention_held)}) before closing.` }, 409);
      const r = await env.DB.prepare("UPDATE con_work_orders SET status = 'closed' WHERE id = ? AND status = 'approved'").bind(wo.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Only an approved work order can be closed.' }, 409);
      await audit(env, req.user, 'close', 'con_work_orders', wo.id, `Closed ${wo.wo_no}`).run();
      return json({ ok: true, data: { advance_outstanding: bal.advance_outstanding } });
    } catch (e) { return serverError(e, 'wo-close'); }
  }));

  // ---------- advance and retention release (money out, Accounts/Owner only) ----------
  async function moneyOut(req, env, kind) {
    const { wo, err } = await loadWo(env, req); if (err) return err;
    if (!MONEY_ROLES.includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can record payments.' }, 403);
    if (wo.status !== 'approved') return json({ ok: false, error: 'The work order must be approved first.' }, 409);
    const b = await req.json();
    const amount = Math.round(num(b.amount_paise));
    if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount.' }, 400);
    let early = '';
    if (kind === 'retention_release') {
      // Retention is held for the defect liability period, counted from the OC.
      const months = Math.round(num(await getSetting(env, 'con.dlp_months'))) || 60;
      const oc = (await approvalState(env, wo.project_id)).ocDate(null);
      const until = oc ? new Date(Date.UTC(+oc.slice(0, 4), +oc.slice(5, 7) - 1 + months, +oc.slice(8, 10))).toISOString().slice(0, 10) : null;
      if (!until || todayIST() < until) {
        early = until ? `before the defect liability period ends on ${until}` : 'before the OC (the defect liability period starts at the OC)';
        if (req.user.role !== 'owner') return json({ ok: false, error: `Retention cannot be released ${early}. Only the Owner can release it early, with a reason.`, code: 'dlp' }, 409);
        if (!String(b.note || '').trim()) return json({ ok: false, error: `This is ${early}. Write why it is being released early.`, code: 'dlp' }, 400);
      }
    }
    const uuid = String(b.client_uuid || crypto.randomUUID());
    const dup = await env.DB.prepare('SELECT id FROM con_payments WHERE client_uuid = ?').bind(uuid).first();
    if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
    const guardSql = kind === 'advance'
      ? "(SELECT COALESCE(SUM(amount_paise), 0) FROM con_ledger WHERE wo_id = ?1 AND kind = 'advance') + ?2 <= (SELECT advance_paise FROM con_work_orders WHERE id = ?1)"
      : "(SELECT COALESCE(SUM(CASE kind WHEN 'retention_held' THEN amount_paise WHEN 'retention_released' THEN -amount_paise END), 0) FROM con_ledger WHERE wo_id = ?1) >= ?2";
    const res = await env.DB.batch([
      env.DB.prepare(`INSERT INTO con_payments (wo_id, ra_id, kind, amount_paise, paid_on, mode, ref_no, note, client_uuid, created_by, created_at)
        SELECT ?1, NULL, '${kind}', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${guardSql}`)
        .bind(wo.id, amount, String(b.paid_on || todayIST()).slice(0, 10), String(b.mode || '').slice(0, 20), String(b.ref_no || '').slice(0, 60), String(b.note || '').slice(0, 200), uuid, req.user.user_id, nowStr()),
      env.DB.prepare(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, ref_table, ref_id, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, 'con_payments', id, ?6 FROM con_payments WHERE client_uuid = ?7`).bind(wo.contractor_id, wo.project_id, wo.id, LEDGER_KIND[kind], amount, nowStr(), uuid),
    ]);
    if (!res[0].meta.changes) {
      return json({ ok: false, error: kind === 'advance' ? `That is more than the advance agreed on this work order (${rupees(wo.advance_paise)}).` : 'That is more than the retention being held.' }, 400);
    }
    await audit(env, req.user, kind, 'con_work_orders', wo.id, `${kind === 'advance' ? 'Advance' : 'Retention released'} ${rupees(amount)} on ${wo.wo_no}${early ? ` (${early}; reason: ${String(b.note).slice(0, 120)})` : ''}`).run();
    return json({ ok: true, data: { id: res[0].meta.last_row_id } });
  }
  router.post('/api/contractors/work-orders/:id/advance', guard('E', async (req, env) => { try { return await moneyOut(req, env, 'advance'); } catch (e) { return serverError(e, 'wo-advance'); } }));
  router.post('/api/contractors/work-orders/:id/release-retention', guard('E', async (req, env) => { try { return await moneyOut(req, env, 'retention_release'); } catch (e) { return serverError(e, 'wo-retention'); } }));

  // ---------- variations (extra quantity or a new item) ----------
  async function varLimit(env) { return num(await getSetting(env, 'con.variation_owner_limit_paise')) || 50000000; }
  router.get('/api/contractors/work-orders/:id/variations', guard('V', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (req.user.role === 'site') return json({ ok: true, data: { variations: [] } });
      const rows = (await env.DB.prepare(`SELECT v.*, i.description AS item, u.name AS created_by_name, a.name AS approved_by_name FROM con_variations v LEFT JOIN con_wo_items i ON i.id = v.wo_item_id
        LEFT JOIN users u ON u.id = v.created_by LEFT JOIN users a ON a.id = v.approved_by WHERE v.wo_id = ? ORDER BY v.id DESC LIMIT 100`).bind(wo.id).all()).results;
      return json({ ok: true, data: { variations: rows, owner_limit_paise: await varLimit(env) } });
    } catch (e) { return serverError(e, 'var-list'); }
  }));
  router.post('/api/contractors/work-orders/:id/variations', guard('C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase'].includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can raise a variation.' }, 403);
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (wo.status !== 'approved') return json({ ok: false, error: 'Variations are raised on an approved work order.' }, 409);
      const b = await req.json();
      const reason = String(b.reason || '').trim().slice(0, 300);
      if (!reason) return json({ ok: false, error: 'Say why the extra work is needed (site instruction, drawing change, client change...).' }, 400);
      let itemId = b.wo_item_id ? Number(b.wo_item_id) : null, desc = String(b.description || '').trim().slice(0, 200), unit = String(b.unit || '').slice(0, 20), qty = null, rate = null, amount;
      if (itemId) {
        const it = await env.DB.prepare('SELECT * FROM con_wo_items WHERE id = ? AND wo_id = ?').bind(itemId, wo.id).first();
        if (!it) return json({ ok: false, error: 'That item is not on this work order.' }, 400);
        qty = num(b.qty); if (!(qty > 0)) return json({ ok: false, error: 'Enter the extra quantity.' }, 400);
        rate = it.rate_paise; amount = Math.round(qty * rate); desc = desc || it.description; unit = it.unit;   // extra quantity is at the work-order rate
      } else if (num(b.qty) > 0 && num(b.rate_paise) > 0) {
        if (!desc) return json({ ok: false, error: 'Describe the new item.' }, 400);
        qty = num(b.qty); rate = Math.round(num(b.rate_paise)); amount = Math.round(qty * rate);
      } else {
        if (!desc) return json({ ok: false, error: 'Describe the extra work.' }, 400);
        amount = Math.round(num(b.amount_paise)); if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount of the extra work.' }, 400);
      }
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO con_variations (wo_id, wo_item_id, description, unit, qty, rate_paise, amount_paise, reason, drawing_ref, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'pending\', ?, ?)')
          .bind(wo.id, itemId, desc, unit, qty, rate, amount, reason, String(b.drawing_ref || '').slice(0, 120) || null, req.user.user_id, now),
        audit(env, req.user, 'create', 'con_variations', wo.id, `Variation on ${wo.wo_no}: ${desc} ${rupees(amount)} (${reason})`),
      ]);
      const limit = await varLimit(env);
      await notifyRoles(env, amount > limit ? ['owner'] : ['owner', 'pm'], `Variation to approve: ${wo.wo_no}`, `${desc}: ${rupees(amount)}. ${reason}`, req.user.user_id);
      return json({ ok: true, data: { id: res[0].meta.last_row_id, amount_paise: amount, needs_owner: amount > limit } });
    } catch (e) { return serverError(e, 'var-create'); }
  }));
  const decideVar = (approve) => guard('A', async (req, env) => {
    try {
      const v = await env.DB.prepare('SELECT v.*, w.project_id, w.wo_no FROM con_variations v JOIN con_work_orders w ON w.id = v.wo_id WHERE v.id = ?').bind(Number(req.params.id)).first();
      if (!v || !(await visibleProjectIds(env, req.user)).includes(v.project_id)) return json({ ok: false, error: 'Variation not found.' }, 404);
      if (v.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve a variation you raised.' }, 403);
      const limit = await varLimit(env);
      if (approve && v.amount_paise > limit && req.user.role !== 'owner') return json({ ok: false, error: `Variations above ${rupees(limit)} need the Owner.` }, 403);
      const b = await req.json().catch(() => ({}));
      if (!approve && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE con_variations SET status = ?, approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(approve ? 'approved' : 'rejected', req.user.user_id, now, String(b.note || '').slice(0, 300), v.id),
        // a new item with quantity and rate joins the work order so it can be measured and billed
        env.DB.prepare(`INSERT INTO con_wo_items (wo_id, description, qty, unit, rate_paise, amount_paise, variation_id) SELECT wo_id, description, qty, unit, rate_paise, amount_paise, id FROM con_variations
          WHERE id = ? AND status = 'approved' AND wo_item_id IS NULL AND qty > 0 AND rate_paise > 0 AND changes() > 0`).bind(v.id),
        audit(env, req.user, approve ? 'approve' : 'reject', 'con_variations', v.id, `${req.user.name} ${approve ? 'approved' : 'rejected'} variation on ${v.wo_no}: ${v.description} ${rupees(v.amount_paise)}${v.created_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'This variation was already decided.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'var-decide'); }
  });
  router.post('/api/contractors/variations/:id/approve', decideVar(true));
  router.post('/api/contractors/variations/:id/reject', decideVar(false));

  // ---------- joint measurements (site engineer + contractor's person) ----------
  router.get('/api/contractors/work-orders/:id/measurements', guard('V', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      const [rows, items] = await env.DB.batch([
        env.DB.prepare(`SELECT m.*, i.description AS item, i.unit, u.name AS measured_by_name, a.name AS approved_by_name FROM con_measurements m JOIN con_wo_items i ON i.id = m.wo_item_id
          LEFT JOIN users u ON u.id = m.measured_by LEFT JOIN users a ON a.id = m.approved_by WHERE m.wo_id = ? ORDER BY m.id DESC LIMIT 200`).bind(wo.id),
        env.DB.prepare('SELECT id, description, unit FROM con_wo_items WHERE wo_id = ? ORDER BY id').bind(wo.id),
      ]);
      return json({ ok: true, data: { measurements: rows.results, items: items.results } });
    } catch (e) { return serverError(e, 'meas-list'); }
  }));
  router.post('/api/contractors/work-orders/:id/measurements', guard('V', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase', 'site'].includes(req.user.role)) return json({ ok: false, error: 'Only the site engineer, Purchase, the PM or the Owner can record a measurement.' }, 403);
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (wo.status !== 'approved') return json({ ok: false, error: 'Measurements are recorded on an approved work order.' }, 409);
      const b = await req.json();
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM con_measurements WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const it = await env.DB.prepare('SELECT id, description FROM con_wo_items WHERE id = ? AND wo_id = ?').bind(Number(b.wo_item_id), wo.id).first();
      if (!it) return json({ ok: false, error: 'Pick the work-order item.' }, 400);
      const location = String(b.location || '').trim().slice(0, 120);
      if (!location) return json({ ok: false, error: 'Say where it was measured (wing, floor, grid).' }, 400);
      const rep = String(b.contractor_rep || '').trim().slice(0, 80);
      if (!rep) return json({ ok: false, error: "Enter the contractor's person who measured with you." }, 400);
      const dim = (k) => (b[k] === '' || b[k] == null ? null : num(b[k]));
      const nos = dim('nos'), L = dim('length_m'), W = dim('width_m'), D = dim('depth_m');
      if ([nos, L, W, D].some((x) => x != null && x < 0)) return json({ ok: false, error: 'Measurements cannot be negative.' }, 400);
      const parts = [nos, L, W, D].filter((x) => x != null);
      const qty = b.qty !== undefined && b.qty !== '' ? num(b.qty) : (parts.length ? Math.round(parts.reduce((t, x) => t * x, 1) * 1000) / 1000 : 0);
      if (!(qty > 0)) return json({ ok: false, error: 'Enter the measured quantity (or the sizes to work it out).' }, 400);
      const photo = b.photo_doc_id ? Number(b.photo_doc_id) : null;
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare("INSERT INTO con_measurements (wo_id, wo_item_id, location, nos, length_m, width_m, depth_m, qty, contractor_rep, photo_doc_id, note, status, measured_by, created_at, client_uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)")
          .bind(wo.id, it.id, location, nos, L, W, D, qty, rep, photo, String(b.note || '').slice(0, 300) || null, req.user.user_id, now, uuid),
        audit(env, req.user, 'create', 'con_measurements', wo.id, `Measurement on ${wo.wo_no}: ${it.description} ${qty} at ${location} (with ${rep})`),
      ]);
      return json({ ok: true, data: { id: res[0].meta.last_row_id, qty } });
    } catch (e) { return serverError(e, 'meas-create'); }
  }));
  const decideMeas = (approve) => guard('A', async (req, env) => {
    try {
      const m = await env.DB.prepare('SELECT m.*, w.project_id, w.wo_no FROM con_measurements m JOIN con_work_orders w ON w.id = m.wo_id WHERE m.id = ?').bind(Number(req.params.id)).first();
      if (!m || !(await visibleProjectIds(env, req.user)).includes(m.project_id)) return json({ ok: false, error: 'Measurement not found.' }, 404);
      if (m.measured_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'Someone else must approve a measurement you recorded.' }, 403);
      const b = await req.json().catch(() => ({}));
      if (!approve && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE con_measurements SET status = ?, approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(approve ? 'approved' : 'rejected', req.user.user_id, nowStr(), String(b.note || '').slice(0, 300), m.id),
        audit(env, req.user, approve ? 'approve' : 'reject', 'con_measurements', m.id, `${req.user.name} ${approve ? 'approved' : 'rejected'} measurement ${m.qty} at ${m.location} on ${m.wo_no}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'This measurement was already decided.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'meas-decide'); }
  });
  router.post('/api/contractors/measurements/:id/approve', decideMeas(true));
  router.post('/api/contractors/measurements/:id/reject', decideMeas(false));

  // ---------- what a work-order item is linked to: BOQ item, drawing, store material it uses ----------
  router.put('/api/contractors/wo-items/:id/links', guard('E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase'].includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can change this.' }, 403);
      const it = await env.DB.prepare('SELECT i.*, w.project_id, w.wo_no FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id WHERE i.id = ?').bind(Number(req.params.id)).first();
      if (!it || !(await visibleProjectIds(env, req.user)).includes(it.project_id)) return json({ ok: false, error: 'Item not found.' }, 404);
      const b = await req.json();
      const pick = (k) => (b[k] === undefined ? it[k] : (b[k] === '' || b[k] == null ? null : Number(b[k])));
      const boq = pick('boq_item_id'), drw = pick('drawing_id'), stock = pick('stock_item_id'), cons = pick('consumption_per_unit'), wast = pick('wastage_bp');
      if (boq && !(await boqItemInProject(env, boq, it.project_id))) return json({ ok: false, error: 'That BOQ item is not in this project.' }, 400);
      if (drw && !(await drawingInProject(env, drw, it.project_id))) return json({ ok: false, error: 'That drawing is not in this project.' }, 400);
      if (stock && !(await stockItemExists(env, stock))) return json({ ok: false, error: 'That store item does not exist.' }, 400);
      if (cons != null && !(cons > 0)) return json({ ok: false, error: 'Material per unit must be more than zero.' }, 400);
      if (wast != null && !(wast >= 0 && wast <= 5000)) return json({ ok: false, error: 'Allowed wastage looks wrong.' }, 400);
      if (stock && cons == null) return json({ ok: false, error: 'Say how much of the store item one unit of work uses.' }, 400);
      await env.DB.batch([
        env.DB.prepare('UPDATE con_wo_items SET boq_item_id = ?, drawing_id = ?, stock_item_id = ?, consumption_per_unit = ?, wastage_bp = ? WHERE id = ?').bind(boq, drw, stock, cons, wast, it.id),
        audit(env, req.user, 'edit', 'con_wo_items', it.id, `${it.wo_no} ${it.description}: links updated`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'wo-item-links'); }
  }));

  // ---------- debit notes (rework, wastage, damage, penalty, excess material) ----------
  const DN_REASONS = ['rework', 'wastage', 'damage', 'penalty', 'excess_material', 'other'];
  router.get('/api/contractors/work-orders/:id/debit-notes', guard('V', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (req.user.role === 'site') return json({ ok: true, data: { debit_notes: [] } });
      const rows = (await env.DB.prepare(`SELECT d.*, u.name AS created_by_name, a.name AS approved_by_name, r.ra_no FROM con_debit_notes d LEFT JOIN users u ON u.id = d.created_by LEFT JOIN users a ON a.id = d.approved_by
        LEFT JOIN con_ra_bills r ON r.id = d.ra_id WHERE d.wo_id = ? ORDER BY d.id DESC LIMIT 100`).bind(wo.id).all()).results;
      return json({ ok: true, data: { debit_notes: rows } });
    } catch (e) { return serverError(e, 'dn-list'); }
  }));
  router.post('/api/contractors/work-orders/:id/debit-notes', guard('V', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase'].includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can raise a debit note.' }, 403);
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (!['approved', 'closed'].includes(wo.status)) return json({ ok: false, error: 'Debit notes are raised on an approved work order.' }, 409);
      const b = await req.json();
      if (!DN_REASONS.includes(b.reason)) return json({ ok: false, error: 'Pick the reason (rework, wastage, damage, penalty, excess material).' }, 400);
      const desc = String(b.description || '').trim().slice(0, 300); if (!desc) return json({ ok: false, error: 'Describe what it is for.' }, 400);
      const qty = b.qty === '' || b.qty == null ? null : num(b.qty), rate = b.rate_paise === '' || b.rate_paise == null ? null : Math.round(num(b.rate_paise));
      const amount = qty != null && rate != null ? Math.round(qty * rate) : Math.round(num(b.amount_paise));
      if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount (or quantity and rate).' }, 400);
      const photo = Number(b.photo_doc_id) || null;
      if (photo && !(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL').bind(photo).first())) return json({ ok: false, error: 'That photo was not found.' }, 400);
      const res = await env.DB.batch([
        env.DB.prepare("INSERT INTO con_debit_notes (wo_id, reason, description, qty, unit, rate_paise, amount_paise, photo_doc_id, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
          .bind(wo.id, b.reason, desc, qty, String(b.unit || '').slice(0, 20) || null, rate, amount, photo, req.user.user_id, nowStr()),
        audit(env, req.user, 'create', 'con_debit_notes', wo.id, `Debit note on ${wo.wo_no}: ${b.reason} ${rupees(amount)} — ${desc}`),
      ]);
      await notifyRoles(env, ['owner', 'pm'], `Debit note to approve: ${wo.wo_no}`, `${b.reason.replace('_', ' ')}: ${rupees(amount)}. ${desc}`, req.user.user_id);
      return json({ ok: true, data: { id: res[0].meta.last_row_id, amount_paise: amount } });
    } catch (e) { return serverError(e, 'dn-create'); }
  }));
  const decideDn = (approve) => guard('A', async (req, env) => {
    try {
      const d = await env.DB.prepare('SELECT d.*, w.project_id, w.wo_no FROM con_debit_notes d JOIN con_work_orders w ON w.id = d.wo_id WHERE d.id = ?').bind(Number(req.params.id)).first();
      if (!d || !(await visibleProjectIds(env, req.user)).includes(d.project_id)) return json({ ok: false, error: 'Debit note not found.' }, 404);
      if (d.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'Someone else must approve a debit note you raised.' }, 403);
      const b = await req.json().catch(() => ({}));
      if (!approve && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE con_debit_notes SET status = ?, approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'").bind(approve ? 'approved' : 'rejected', req.user.user_id, nowStr(), String(b.note || '').slice(0, 300), d.id),
        audit(env, req.user, approve ? 'approve' : 'reject', 'con_debit_notes', d.id, `${req.user.name} ${approve ? 'approved' : 'rejected'} debit note on ${d.wo_no}: ${rupees(d.amount_paise)}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'Already decided.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'dn-decide'); }
  });
  router.post('/api/contractors/debit-notes/:id/approve', decideDn(true));
  router.post('/api/contractors/debit-notes/:id/reject', decideDn(false));

  // ---------- material reconciliation: free-issue material against what the measured work should have used ----------
  router.get('/api/contractors/work-orders/:id/reconciliation', guard('V', async (req, env) => {
    try {
      const { wo, err } = await loadWo(env, req); if (err) return err;
      const items = (await env.DB.prepare(`SELECT i.id, i.description, i.unit, i.stock_item_id, i.consumption_per_unit, COALESCE(i.wastage_bp, 0) AS wastage_bp,
          COALESCE((SELECT SUM(m.qty) FROM con_measurements m WHERE m.wo_item_id = i.id AND m.status = 'approved'), 0) AS measured
        FROM con_wo_items i WHERE i.wo_id = ? AND i.stock_item_id IS NOT NULL AND i.consumption_per_unit > 0`).bind(wo.id).all()).results;
      const issued = await issuedForWo(env, wo.id, [...new Set(items.map((i) => i.stock_item_id))]);   // [{ item_id, name, unit, qty }] from the Store
      const by = {};
      for (const i of items) {
        const r = (by[i.stock_item_id] = by[i.stock_item_id] || { stock_item_id: i.stock_item_id, theoretical: 0, allowed: 0, from: [] });
        const t = i.measured * i.consumption_per_unit; r.theoretical += t; r.allowed += t * (10000 + i.wastage_bp) / 10000;
        r.from.push(`${i.description}: ${+i.measured.toFixed(3)} ${i.unit || ''} x ${i.consumption_per_unit}`);
      }
      for (const x of issued) { const r = (by[x.item_id] = by[x.item_id] || { stock_item_id: x.item_id, theoretical: 0, allowed: 0, from: [] }); r.issued = x.qty; r.name = x.name; r.unit = x.unit; }
      const rows = Object.values(by).map((r) => ({ ...r, issued: r.issued || 0, theoretical: Math.round(r.theoretical * 1000) / 1000, allowed: Math.round(r.allowed * 1000) / 1000,
        excess: Math.max(0, Math.round(((r.issued || 0) - r.allowed) * 1000) / 1000) }));
      return json({ ok: true, data: { rows, note: 'Issued = material the store issued to this work order. Theoretical = approved measured quantity x material per unit. Excess above the allowed wastage can be charged with a debit note.' } });
    } catch (e) { return serverError(e, 'wo-recon'); }
  }));

  // ---------- RA bills ----------
  // Limits: an item can be billed up to its work-order quantity plus approved variations, and never beyond what is measured and approved.
  // A lump-sum order can be billed up to its value plus approved variations. Advance is recovered at the order's rate unless a reason is given.
  router.post('/api/contractors/work-orders/:id/ra-bills', guard('C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase'].includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can raise an RA bill.' }, 403);
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (wo.status !== 'approved') return json({ ok: false, error: 'RA bills can only be raised on an approved work order.' }, 409);
      const b = await req.json();
      // CC-floor lock: a bill for work above the approved CC floor is refused (the Owner may go ahead with a written reason).
      const raWing = String(b.wing || '').trim().slice(0, 20) || null;
      const raFloor = b.floor === '' || b.floor == null ? null : Math.round(num(b.floor));
      if (raFloor != null && !(raFloor >= 0 && raFloor <= 200)) return json({ ok: false, error: 'Check the floor number (0 is the plinth).' }, 400);
      let raOverride = null;
      { const blk = await ccFloorBlock(env, wo.project_id, raWing, raFloor);
        if (blk) {
          const why = String(b.override_note || '').trim().slice(0, 300);
          if (req.user.role !== 'owner' || why.length < 10) return json({ ok: false, error: blk + (req.user.role === 'owner' ? ' As the Owner you can go ahead only with a written reason.' : ' This work is not covered by the approved CC yet.'), code: 'cc' }, 409);
          raOverride = why;
        } }
      const [itemsR, usedR, varR, measR] = await env.DB.batch([
        env.DB.prepare('SELECT id, description, qty, unit, rate_paise FROM con_wo_items WHERE wo_id = ?').bind(wo.id),
        env.DB.prepare("SELECT l.wo_item_id, SUM(l.qty_this_bill) AS q FROM con_ra_lines l JOIN con_ra_bills r ON r.id = l.ra_id WHERE r.wo_id = ? AND r.status != 'cancelled' GROUP BY l.wo_item_id").bind(wo.id),
        env.DB.prepare("SELECT wo_item_id, SUM(COALESCE(qty, 0)) AS q, SUM(amount_paise) AS a FROM con_variations WHERE wo_id = ? AND status = 'approved' GROUP BY wo_item_id").bind(wo.id),
        env.DB.prepare("SELECT wo_item_id, SUM(qty) AS q FROM con_measurements WHERE wo_id = ? AND status = 'approved' GROUP BY wo_item_id").bind(wo.id),
      ]);
      const items = itemsR.results;
      const used = Object.fromEntries(usedR.results.map((u) => [u.wo_item_id, u.q]));
      const extraQty = Object.fromEntries(varR.results.filter((v) => v.wo_item_id).map((v) => [v.wo_item_id, v.q]));
      const lumpExtra = varR.results.filter((v) => !v.wo_item_id).reduce((t, v) => t + (v.a || 0), 0);
      const measured = Object.fromEntries(measR.results.map((m) => [m.wo_item_id, m.q]));
      const problems = []; let gross = 0; const lines = [];
      if (items.length) {
        const byId = Object.fromEntries(items.map((i) => [i.id, i]));
        for (const l of Array.isArray(b.lines) ? b.lines : []) {
          const it = byId[Number(l.wo_item_id)]; const q = num(l.qty);
          if (!it) return json({ ok: false, error: 'A line does not belong to this work order.' }, 400);
          if (!(q > 0)) continue;
          const allowed = it.qty + (extraQty[it.id] || 0), before = used[it.id] || 0;
          if (before + q > allowed + 1e-9) problems.push(`${it.description}: ${+(before + q).toFixed(3)} ${it.unit || ''} billed in total, but only ${+allowed.toFixed(3)} is in the work order${extraQty[it.id] ? ' with its approved variations' : ''}. Raise a variation first.`);
          else if (before + q > (measured[it.id] || 0) + 1e-9) problems.push(`${it.description}: only ${+((measured[it.id] || 0) - before).toFixed(3)} ${it.unit || ''} is measured and approved and not yet billed. Record the joint measurement first.`);
          const amt = Math.round(q * it.rate_paise); gross += amt; lines.push({ item: it, q, amt });
        }
        if (!lines.length) return json({ ok: false, error: 'Enter the quantity done for at least one item.' }, 400);
      } else {
        gross = Math.round(num(b.gross_paise));
        if (!(gross > 0)) return json({ ok: false, error: 'Enter the amount of work done.' }, 400);
        const prev = await env.DB.prepare("SELECT COALESCE(SUM(gross_paise), 0) AS s FROM con_ra_bills WHERE wo_id = ? AND status != 'cancelled'").bind(wo.id).first();
        if (prev.s + gross > wo.value_paise + lumpExtra) problems.push(`Billed so far would be ${rupees(prev.s + gross)} against ${rupees(wo.value_paise + lumpExtra)} (work order${lumpExtra ? ' plus approved variations' : ''}). Raise a variation first.`);
      }
      if (problems.length) return json({ ok: false, error: problems[0], code: 'over_limit', warnings: problems }, 409);
      const retention = Math.round((gross * wo.retention_bp) / 10000);
      const typed = Math.round(num(b.other_deductions_paise));
      if (typed < 0) return json({ ok: false, error: 'Deductions cannot be negative.' }, 400);
      // approved debit notes not yet recovered are deducted on this bill
      const dn = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS a FROM con_debit_notes WHERE wo_id = ? AND status = 'approved' AND ra_id IS NULL").bind(wo.id).first();
      const other = typed + dn.a;
      // advance recovery: the order's share of this bill, up to what is still outstanding
      const bal = await woBalances(env, wo.id);
      const pend = await env.DB.prepare("SELECT COALESCE(SUM(advance_recovery_paise), 0) AS s FROM con_ra_bills WHERE wo_id = ? AND status IN ('draft', 'checked')").bind(wo.id).first();
      const left = Math.max(0, bal.advance_outstanding - pend.s);
      const recBp = wo.advance_recovery_bp != null ? wo.advance_recovery_bp : (left > 0 ? Math.round(num(await getSetting(env, 'con.advance_recovery_bp')) || 1000) : 0);
      const due = Math.min(left, Math.round((gross * recBp) / 10000));
      let rec = b.advance_recovery_paise === undefined || b.advance_recovery_paise === '' ? due : Math.round(num(b.advance_recovery_paise));
      if (rec < 0) return json({ ok: false, error: 'Deductions cannot be negative.' }, 400);
      if (rec > left) return json({ ok: false, error: `Only ${rupees(left)} of advance is left to recover.` }, 400);
      const recReason = String(b.advance_recovery_reason || '').trim().slice(0, 200);
      if (rec < due && !recReason) return json({ ok: false, error: `This bill should recover ${rupees(due)} of the advance. Say why it recovers less.`, code: 'recovery' }, 400);
      const gstBp = b.gst_bp !== undefined ? Math.round(num(b.gst_bp)) : Math.round(num(await getSetting(env, 'con.gst_bp')));
      const tdsBp = b.tds_bp !== undefined ? Math.round(num(b.tds_bp)) : Math.round(num(await getSetting(env, 'con.tds_bp')));
      if (gstBp < 0 || gstBp > 2800 || tdsBp < 0 || tdsBp > 3000) return json({ ok: false, error: 'GST or TDS rate looks wrong.' }, 400);
      const gst = Math.round((gross * gstBp) / 10000), tds = Math.round((gross * tdsBp) / 10000);
      const net = gross - retention - rec - other + gst - tds;
      if (!(net >= 0)) return json({ ok: false, error: dn.a ? `Deductions (including ${rupees(dn.a)} of debit notes) are more than the bill.` : 'Deductions are more than the bill.' }, 400);
      const key = `ra:${wo.id}`, now = nowStr();
      const note = [String(b.note || '').trim(), rec < due ? `Advance recovery reduced from ${rupees(due)}: ${recReason}` : '', dn.n ? `Debit notes ${rupees(dn.a)} deducted` : ''].filter(Boolean).join(' · ').slice(0, 300);
      const RA = '(SELECT id FROM con_ra_bills WHERE wo_id = ? AND ra_no = (SELECT value FROM counters WHERE key = ?))';
      // one batch: number, bill, lines and audit together (all or nothing)
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1').bind(key),
        env.DB.prepare(`INSERT INTO con_ra_bills (wo_id, ra_no, period_from, period_to, due_date, gross_paise, retention_paise, advance_recovery_paise, other_deductions_paise, gst_bp, gst_paise, tds_bp, tds_paise, net_paise, status, note, created_by, created_at, wing, floor, cc_override_note)
          VALUES (?, (SELECT value FROM counters WHERE key = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`)
          .bind(wo.id, key, b.period_from || null, b.period_to || null, b.due_date || null, gross, retention, rec, other, gstBp, gst, tdsBp, tds, net, note, req.user.user_id, now, raWing, raFloor, raOverride),
        ...lines.map((l) => env.DB.prepare(`INSERT INTO con_ra_lines (ra_id, wo_item_id, qty_this_bill, rate_paise, amount_paise) VALUES (${RA}, ?, ?, ?, ?)`).bind(wo.id, key, l.item.id, l.q, l.item.rate_paise, l.amt)),
        env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) SELECT ?, 'create', 'con_ra_bills', id, ?, ? FROM con_ra_bills WHERE id = ${RA}`)
          .bind(req.user.user_id, `RA bill on ${wo.wo_no}: gross ${rupees(gross)}, net ${rupees(net)}`, now, wo.id, key),
        env.DB.prepare(`UPDATE con_debit_notes SET status = 'recovered', ra_id = ${RA} WHERE wo_id = ? AND status = 'approved' AND ra_id IS NULL`).bind(wo.id, key, wo.id),
        env.DB.prepare(`SELECT id, ra_no FROM con_ra_bills WHERE id = ${RA}`).bind(wo.id, key),
      ]);
      const ra = res[res.length - 1].results[0];
      return json({ ok: true, data: { id: ra.id, ra_no: ra.ra_no, gross_paise: gross, retention_paise: retention, advance_recovery_paise: rec, debit_notes_paise: dn.a, other_deductions_paise: other, gst_paise: gst, tds_paise: tds, net_paise: net, warnings: [] } });
    } catch (e) { return serverError(e, 'ra-create'); }
  }));

  router.post('/api/contractors/ra-bills/:id/check', guard('A', async (req, env) => {
    try {
      const { ra, err } = await loadRa(env, req); if (err) return err;
      if (ra.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot check a bill you raised.' }, 403);
      const r = await env.DB.prepare("UPDATE con_ra_bills SET status = 'checked', checked_by = ? WHERE id = ? AND status = 'draft'").bind(req.user.user_id, ra.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Only a draft can be checked.' }, 409);
      await notifyRoles(env, ra.gross_paise > await pmLimit(env) ? ['owner'] : ['owner', 'pm'], `RA bill to approve: ${ra.wo_no} / RA ${ra.ra_no}`, `Net ${rupees(ra.net_paise)}`, req.user.user_id);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ra-check'); }
  }));

  router.post('/api/contractors/ra-bills/:id/approve', guard('A', async (req, env) => {
    try {
      const { ra, err } = await loadRa(env, req); if (err) return err;
      if (ra.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve a bill you raised.' }, 403);
      if (ra.checked_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You checked this bill, so someone else must approve it.' }, 403);
      const limit = await pmLimit(env);
      // the limit is on the work done (gross), not on what is left after deductions
      if (!mayDecide(req.user, ra.gross_paise, limit)) return json({ ok: false, error: `This bill's work done (${rupees(ra.gross_paise)}) is above your limit (${rupees(limit)}). The Owner must approve it.` }, 403);
      const now = nowStr();
      // One batch: status change, then ledger rows that exist only if the bill is approved by me and has none yet.
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE con_ra_bills SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ? AND status = 'checked'").bind(req.user.user_id, now, ra.id),
        env.DB.prepare(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, ref_table, ref_id, created_at)
          SELECT ?2, ?3, w.id, 'retention_held', r.retention_paise, 'con_ra_bills', r.id, ?4 FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id
          WHERE r.id = ?1 AND r.status = 'approved' AND r.approved_by = ?5 AND r.retention_paise > 0 AND NOT EXISTS (SELECT 1 FROM con_ledger WHERE ref_table = 'con_ra_bills' AND ref_id = ?1 AND kind = 'retention_held')`).bind(ra.id, ra.contractor_id, ra.project_id, now, req.user.user_id),
        env.DB.prepare(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, ref_table, ref_id, created_at)
          SELECT ?2, ?3, w.id, 'advance_recovery', r.advance_recovery_paise, 'con_ra_bills', r.id, ?4 FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id
          WHERE r.id = ?1 AND r.status = 'approved' AND r.approved_by = ?5 AND r.advance_recovery_paise > 0 AND NOT EXISTS (SELECT 1 FROM con_ledger WHERE ref_table = 'con_ra_bills' AND ref_id = ?1 AND kind = 'advance_recovery')`).bind(ra.id, ra.contractor_id, ra.project_id, now, req.user.user_id),
        audit(env, req.user, 'approve', 'con_ra_bills', ra.id, `${req.user.name} approved ${ra.wo_no} / RA ${ra.ra_no} (net ${rupees(ra.net_paise)})${ra.created_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'This bill is not waiting for approval (it must be checked first).' }, 409);
      emit('ra.approved', { ra_id: ra.id, wo_id: ra.wo_id, project_id: ra.project_id, gross_paise: ra.gross_paise, net_paise: ra.net_paise });
      if (ra.created_by) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(ra.created_by, `RA bill approved: ${ra.wo_no} / RA ${ra.ra_no}`, '', 'contractors', now).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ra-approve'); }
  }));

  router.post('/api/contractors/ra-bills/:id/cancel', guard('A', async (req, env) => {
    try {
      const { ra, err } = await loadRa(env, req); if (err) return err;
      const b = await req.json();
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why.' }, 400);
      const r = await env.DB.prepare("UPDATE con_ra_bills SET status = 'cancelled', cancel_note = ? WHERE id = ? AND status IN ('draft', 'checked')").bind(String(b.reason).slice(0, 200), ra.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Only a bill that is not yet approved can be cancelled.' }, 409);
      await env.DB.prepare("UPDATE con_debit_notes SET status = 'approved', ra_id = NULL WHERE ra_id = ? AND status = 'recovered'").bind(ra.id).run();
      await audit(env, req.user, 'cancel', 'con_ra_bills', ra.id, `Cancelled ${ra.wo_no} / RA ${ra.ra_no}: ${String(b.reason).slice(0, 100)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ra-cancel'); }
  }));

  const syncRa = (env, raId) => env.DB.prepare(`UPDATE con_ra_bills SET status = CASE
      WHEN COALESCE((SELECT SUM(amount_paise) FROM con_payments WHERE ra_id = ?1 AND kind = 'ra' AND reversed_at IS NULL), 0) >= net_paise THEN 'paid'
      WHEN COALESCE((SELECT SUM(amount_paise) FROM con_payments WHERE ra_id = ?1 AND kind = 'ra' AND reversed_at IS NULL), 0) > 0 THEN 'part_paid' ELSE 'approved' END
    WHERE id = ?1 AND status IN ('approved', 'part_paid', 'paid')`).bind(raId);

  router.post('/api/contractors/ra-bills/:id/payments', guard('E', async (req, env) => {
    try {
      if (!MONEY_ROLES.includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can record payments.' }, 403);
      const { ra, err } = await loadRa(env, req); if (err) return err;
      const b = await req.json();
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM con_payments WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });   // a retry of a payment already saved
      if (!['approved', 'part_paid'].includes(ra.status)) return json({ ok: false, error: 'Only an approved bill can be paid.' }, 409);
      const amount = Math.round(num(b.amount_paise));
      if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount paid.' }, 400);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare(`INSERT INTO con_payments (wo_id, ra_id, kind, amount_paise, paid_on, mode, ref_no, note, client_uuid, created_by, created_at)
          SELECT ?1, ?2, 'ra', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE (SELECT net_paise FROM con_ra_bills WHERE id = ?2) - COALESCE((SELECT SUM(amount_paise) FROM con_payments WHERE ra_id = ?2 AND kind = 'ra' AND reversed_at IS NULL), 0) >= ?3`)
          .bind(ra.wo_id, ra.id, amount, String(b.paid_on || todayIST()).slice(0, 10), String(b.mode || '').slice(0, 20), String(b.ref_no || '').slice(0, 60), String(b.note || '').slice(0, 200), uuid, req.user.user_id, now),
        env.DB.prepare(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, ref_table, ref_id, created_at)
          SELECT ?1, ?2, ?3, 'payment', ?4, 'con_payments', id, ?5 FROM con_payments WHERE client_uuid = ?6`).bind(ra.contractor_id, ra.project_id, ra.wo_id, amount, now, uuid),
        syncRa(env, ra.id),
        audit(env, req.user, 'pay', 'con_ra_bills', ra.id, `Paid ${rupees(amount)} on ${ra.wo_no} / RA ${ra.ra_no}`),
      ]);
      if (!res[0].meta.changes) {
        const paid = await env.DB.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS s FROM con_payments WHERE ra_id = ? AND kind = 'ra' AND reversed_at IS NULL").bind(ra.id).first();
        return json({ ok: false, error: `Only ${rupees(ra.net_paise - paid.s)} is still due on this bill.` }, 400);
      }
      const after = await env.DB.prepare('SELECT status FROM con_ra_bills WHERE id = ?').bind(ra.id).first();
      return json({ ok: true, data: { id: res[0].meta.last_row_id, status: after.status } });
    } catch (e) { return serverError(e, 'ra-pay'); }
  }));

  router.post('/api/contractors/payments/:id/reverse', guard('E', async (req, env) => {
    try {
      if (!MONEY_ROLES.includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can reverse a payment.' }, 403);
      const b = await req.json();
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why this payment is reversed.' }, 400);
      const pay = await env.DB.prepare('SELECT p.*, w.project_id, w.contractor_id FROM con_payments p JOIN con_work_orders w ON w.id = p.wo_id WHERE p.id = ?').bind(Number(req.params.id)).first();
      if (!pay) return json({ ok: false, error: 'Payment not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(pay.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare('UPDATE con_payments SET reversed_at = ?, reversal_note = ? WHERE id = ? AND reversed_at IS NULL').bind(now, String(b.reason).slice(0, 200), pay.id),
        env.DB.prepare(`INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, ref_table, ref_id, created_at)
          SELECT ?1, ?2, ?3, ?4, -amount_paise, 'con_payments_reversal', id, ?5 FROM con_payments WHERE id = ?6 AND reversed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM con_ledger WHERE ref_table = 'con_payments_reversal' AND ref_id = ?6)`).bind(pay.contractor_id, pay.project_id, pay.wo_id, LEDGER_KIND[pay.kind], now, pay.id),
        ...(pay.ra_id ? [syncRa(env, pay.ra_id)] : []),
        audit(env, req.user, 'reverse', 'con_payments', pay.id, `Reversed ${rupees(pay.amount_paise)}: ${String(b.reason).slice(0, 100)}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'Already reversed.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'con-reverse'); }
  }));

  // ---------- ledger and reports ----------
  router.get('/api/contractors/contractors/:id/ledger', guard('V', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { entries: [], totals: {} } });
      const ph = ids.map(() => '?').join(',');
      const cid = Number(req.params.id);
      const [entries, tot, due] = await Promise.all([
        env.DB.prepare(`SELECT l.*, w.wo_no FROM con_ledger l JOIN con_work_orders w ON w.id = l.wo_id WHERE l.contractor_id = ? AND l.project_id IN (${ph}) ORDER BY l.id DESC LIMIT 200`).bind(cid, ...ids).all(),
        env.DB.prepare(`SELECT kind, COALESCE(SUM(amount_paise), 0) AS s FROM con_ledger WHERE contractor_id = ? AND project_id IN (${ph}) GROUP BY kind`).bind(cid, ...ids).all(),
        env.DB.prepare(`SELECT COALESCE(SUM(r.net_paise), 0) AS billed FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id WHERE w.contractor_id = ? AND w.project_id IN (${ph}) AND r.status IN ('approved', 'part_paid', 'paid')`).bind(cid, ...ids).first(),
      ]);
      const m = Object.fromEntries(tot.results.map((r) => [r.kind, r.s]));
      const totals = { advance_given: m.advance || 0, advance_recovered: m.advance_recovery || 0, advance_outstanding: (m.advance || 0) - (m.advance_recovery || 0),
        retention_held: (m.retention_held || 0) - (m.retention_released || 0), paid_on_bills: m.payment || 0, billed_net: due.billed, payable: due.billed - (m.payment || 0) };
      return json({ ok: true, data: { entries: entries.results, totals } });
    } catch (e) { return serverError(e, 'con-ledger'); }
  }));

  router.get('/api/contractors/reports/summary', guard('V', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await visibleProjectIds(env, req.user);
      const rows = ids.length ? (await env.DB.prepare(`SELECT w.wo_no, c.name AS contractor, p.name AS project, w.status, w.value_paise,
          COALESCE((SELECT SUM(r.gross_paise) FROM con_ra_bills r WHERE r.wo_id = w.id AND r.status IN ('approved', 'part_paid', 'paid')), 0) AS billed_paise,
          COALESCE((SELECT SUM(x.amount_paise) FROM con_payments x WHERE x.wo_id = w.id AND x.reversed_at IS NULL), 0) AS paid_paise,
          COALESCE((SELECT SUM(CASE kind WHEN 'retention_held' THEN amount_paise WHEN 'retention_released' THEN -amount_paise END) FROM con_ledger WHERE wo_id = w.id), 0) AS retention_held_paise,
          COALESCE((SELECT SUM(CASE kind WHEN 'advance' THEN amount_paise WHEN 'advance_recovery' THEN -amount_paise END) FROM con_ledger WHERE wo_id = w.id), 0) AS advance_outstanding_paise
        FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id JOIN projects p ON p.id = w.project_id
        WHERE w.status IN ('approved', 'closed') AND w.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY w.id DESC LIMIT 300`).bind(...ids).all()).results : [];
      if (new URL(req.url).searchParams.get('csv')) {
        const f = (p) => (Number(p) / 100).toFixed(2);
        return csvResponse('contractor-work-orders.csv', [['Work order', 'Contractor', 'Project', 'Status', 'Value', 'Billed (gross)', 'Paid', 'Retention held', 'Advance outstanding'],
          ...rows.map((r) => [r.wo_no, r.contractor, r.project, r.status, f(r.value_paise), f(r.billed_paise), f(r.paid_paise), f(r.retention_held_paise), f(r.advance_outstanding_paise)])]);
      }
      return json({ ok: true, data: { rows } });
    } catch (e) { return serverError(e, 'con-report'); }
  }));

  // ---------- print data (letterhead pages render in the browser) ----------
  router.get('/api/print/wo/:id', guard('V', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const { wo, err } = await loadWo(env, req); if (err) return err;
      const [items, proj, con] = await Promise.all([
        env.DB.prepare('SELECT * FROM con_wo_items WHERE wo_id = ? ORDER BY id').bind(wo.id).all(),
        env.DB.prepare('SELECT name, address FROM projects WHERE id = ?').bind(wo.project_id).first(),
        env.DB.prepare('SELECT gstin, phone FROM con_contractors WHERE id = ?').bind(wo.contractor_id).first(),
      ]);
      return json({ ok: true, data: { kind: 'wo', draft: !['approved', 'closed'].includes(wo.status), wo: { ...wo, project_name: proj && proj.name, project_address: proj && proj.address, contractor_gstin: con && con.gstin }, items: items.results, brand: await printBrand(env, wo.project_id) } });
    } catch (e) { return serverError(e, 'print-wo'); }
  }));
  router.get('/api/print/ra/:id', guard('V', async (req, env) => {
    try {
      if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
      const { ra, err } = await loadRa(env, req); if (err) return err;
      const [lines, w] = await Promise.all([
        env.DB.prepare('SELECT l.*, i.description, i.unit FROM con_ra_lines l JOIN con_wo_items i ON i.id = l.wo_item_id WHERE l.ra_id = ? ORDER BY l.id').bind(ra.id).all(),
        env.DB.prepare('SELECT w.wo_no, w.retention_bp, c.name AS contractor, p.name AS project_name FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id JOIN projects p ON p.id = w.project_id WHERE w.id = ?').bind(ra.wo_id).first(),
      ]);
      return json({ ok: true, data: { kind: 'ra', draft: !['approved', 'part_paid', 'paid'].includes(ra.status), ra: { ...ra, ...w }, lines: lines.results, brand: await printBrand(env, ra.project_id) } });
    } catch (e) { return serverError(e, 'print-ra'); }
  }));
}
