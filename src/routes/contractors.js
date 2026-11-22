// routes/contractors.js — WP-5: contractors, work orders, running-account (RA) bills, advance and retention ledger.
// Labour is paid through contractors, so there is no payroll. All money is integer paise; rates for GST/TDS are settings.
import { emit } from '../core/events.js';

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

export function registerContractors(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, encryptSetting, decryptSetting, printBrand, csvBom, headBelongsToProject, onWoApproved } = h;

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
        .map((i) => ({ description: String(i.description).trim().slice(0, 200), qty: num(i.qty), unit: String(i.unit || '').slice(0, 20), rate: Math.round(num(i.rate_paise)) }));
      if (basis !== 'lump_sum' && !items.length) return json({ ok: false, error: 'Add the items with quantity and rate.' }, 400);
      const value = items.length ? items.reduce((t, i) => t + Math.round(i.qty * i.rate), 0) : Math.round(num(b.value_paise));
      if (!(value > 0)) return json({ ok: false, error: 'Enter the work order value.' }, 400);
      const ret = Math.round(num(b.retention_bp));
      if (ret < 0 || ret > 3000) return json({ ok: false, error: 'Retention looks wrong (0 to 30%).' }, 400);
      const adv = Math.round(num(b.advance_paise));
      if (adv < 0 || adv > value) return json({ ok: false, error: 'Advance cannot be more than the work order value.' }, 400);
      const headId = b.budget_head_id ? Number(b.budget_head_id) : null;
      if (headId && !(await headBelongsToProject(env, headId, pid))) return json({ ok: false, error: 'That budget head belongs to a different project.' }, 400);
      const c = await env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value').bind(`wo:${pid}`).first();
      const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(pid).first();
      const no = `WO-${proj ? proj.code : pid}-${String(c.value).padStart(4, '0')}`;
      const r = await env.DB.prepare("INSERT INTO con_work_orders (project_id, contractor_id, wo_no, scope, basis, value_paise, retention_bp, advance_paise, status, created_by, created_at, budget_head_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
        .bind(pid, cid, no, String(b.scope || '').slice(0, 1000), basis, value, ret, adv, req.user.user_id, nowStr(), headId).run();
      const id = r.meta.last_row_id;
      await env.DB.batch([
        ...items.map((i) => env.DB.prepare('INSERT INTO con_wo_items (wo_id, description, qty, unit, rate_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?)').bind(id, i.description, i.qty, i.unit, i.rate, Math.round(i.qty * i.rate))),
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
      const usedMap = Object.fromEntries(used.results.map((u) => [u.wo_item_id, u.qty]));
      return json({ ok: true, data: { work_order: wo, items: items.results.map((i) => ({ ...i, billed_qty: usedMap[i.id] || 0 })), ra_bills: bills.results, balances: bal } });
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
      if (wo.created_by === req.user.user_id) return json({ ok: false, error: 'You cannot approve a work order you drew up.' }, 403);
      const limit = await pmLimit(env);
      if (!mayDecide(req.user, wo.value_paise, limit)) return json({ ok: false, error: `This work order is above your limit (${rupees(limit)}). The Owner must decide.` }, 403);
      if (decision === 'rejected' && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const r = await env.DB.prepare("UPDATE con_work_orders SET status = ?, approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ? AND status = 'pending_approval'")
        .bind(decision, req.user.user_id, nowStr(), String(b.note || '').slice(0, 300), wo.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This work order is not waiting for approval.' }, 409);
      await audit(env, req.user, decision === 'approved' ? 'approve' : 'reject', 'con_work_orders', wo.id, `${req.user.name} ${decision} ${wo.wo_no} (${rupees(wo.value_paise)})`).run();
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
    await audit(env, req.user, kind, 'con_work_orders', wo.id, `${kind === 'advance' ? 'Advance' : 'Retention released'} ${rupees(amount)} on ${wo.wo_no}`).run();
    return json({ ok: true, data: { id: res[0].meta.last_row_id } });
  }
  router.post('/api/contractors/work-orders/:id/advance', guard('E', async (req, env) => { try { return await moneyOut(req, env, 'advance'); } catch (e) { return serverError(e, 'wo-advance'); } }));
  router.post('/api/contractors/work-orders/:id/release-retention', guard('E', async (req, env) => { try { return await moneyOut(req, env, 'retention_release'); } catch (e) { return serverError(e, 'wo-retention'); } }));

  // ---------- RA bills ----------
  router.post('/api/contractors/work-orders/:id/ra-bills', guard('C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'purchase'].includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can raise an RA bill.' }, 403);
      const { wo, err } = await loadWo(env, req); if (err) return err;
      if (wo.status !== 'approved') return json({ ok: false, error: 'RA bills can only be raised on an approved work order.' }, 409);
      const b = await req.json();
      const items = (await env.DB.prepare('SELECT id, description, qty, rate_paise FROM con_wo_items WHERE wo_id = ?').bind(wo.id).all()).results;
      const warnings = []; let gross = 0; const lines = [];
      if (items.length) {
        const byId = Object.fromEntries(items.map((i) => [i.id, i]));
        const used = Object.fromEntries((await env.DB.prepare("SELECT l.wo_item_id, SUM(l.qty_this_bill) AS q FROM con_ra_lines l JOIN con_ra_bills r ON r.id = l.ra_id WHERE r.wo_id = ? AND r.status != 'cancelled' GROUP BY l.wo_item_id").bind(wo.id).all()).results.map((u) => [u.wo_item_id, u.q]));
        for (const l of Array.isArray(b.lines) ? b.lines : []) {
          const it = byId[Number(l.wo_item_id)]; const q = num(l.qty);
          if (!it) return json({ ok: false, error: 'A line does not belong to this work order.' }, 400);
          if (!(q > 0)) continue;
          if ((used[it.id] || 0) + q > it.qty + 1e-9) warnings.push(`${it.description}: ${(used[it.id] || 0) + q} billed in total against ${it.qty} in the work order`);
          const amt = Math.round(q * it.rate_paise); gross += amt; lines.push({ item: it, q, amt });
        }
        if (!lines.length) return json({ ok: false, error: 'Enter the quantity done for at least one item.' }, 400);
      } else {
        gross = Math.round(num(b.gross_paise));
        if (!(gross > 0)) return json({ ok: false, error: 'Enter the amount of work done.' }, 400);
        const prev = await env.DB.prepare("SELECT COALESCE(SUM(gross_paise), 0) AS s FROM con_ra_bills WHERE wo_id = ? AND status != 'cancelled'").bind(wo.id).first();
        if (prev.s + gross > wo.value_paise) warnings.push(`Billed so far ${rupees(prev.s + gross)} against a work order of ${rupees(wo.value_paise)}`);
      }
      if (warnings.length && !b.confirm_over) return json({ ok: false, error: 'This bill goes beyond the work order.', code: 'over_limit', warnings }, 409);
      const retention = Math.round((gross * wo.retention_bp) / 10000);
      const rec = Math.round(num(b.advance_recovery_paise)), other = Math.round(num(b.other_deductions_paise));
      if (rec < 0 || other < 0) return json({ ok: false, error: 'Deductions cannot be negative.' }, 400);
      if (rec > 0) {
        const bal = await woBalances(env, wo.id);
        const pend = await env.DB.prepare("SELECT COALESCE(SUM(advance_recovery_paise), 0) AS s FROM con_ra_bills WHERE wo_id = ? AND status IN ('draft', 'checked')").bind(wo.id).first();
        if (rec > bal.advance_outstanding - pend.s) return json({ ok: false, error: `Only ${rupees(Math.max(0, bal.advance_outstanding - pend.s))} of advance is left to recover.` }, 400);
      }
      const gstBp = b.gst_bp !== undefined ? Math.round(num(b.gst_bp)) : Math.round(num(await getSetting(env, 'con.gst_bp')));
      const tdsBp = b.tds_bp !== undefined ? Math.round(num(b.tds_bp)) : Math.round(num(await getSetting(env, 'con.tds_bp')));
      if (gstBp < 0 || gstBp > 2800 || tdsBp < 0 || tdsBp > 3000) return json({ ok: false, error: 'GST or TDS rate looks wrong.' }, 400);
      const gst = Math.round((gross * gstBp) / 10000), tds = Math.round((gross * tdsBp) / 10000);
      const net = gross - retention - rec - other + gst - tds;
      if (!(net >= 0)) return json({ ok: false, error: 'Deductions are more than the bill.' }, 400);
      const c = await env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value').bind(`ra:${wo.id}`).first();
      await env.DB.prepare(`INSERT INTO con_ra_bills (wo_id, ra_no, period_from, period_to, due_date, gross_paise, retention_paise, advance_recovery_paise, other_deductions_paise, gst_bp, gst_paise, tds_bp, tds_paise, net_paise, status, note, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
        .bind(wo.id, c.value, b.period_from || null, b.period_to || null, b.due_date || null, gross, retention, rec, other, gstBp, gst, tdsBp, tds, net, String(b.note || '').slice(0, 300), req.user.user_id, nowStr()).run();
      await env.DB.batch([
        ...lines.map((l) => env.DB.prepare('INSERT INTO con_ra_lines (ra_id, wo_item_id, qty_this_bill, rate_paise, amount_paise) VALUES ((SELECT id FROM con_ra_bills WHERE wo_id = ? AND ra_no = ?), ?, ?, ?, ?)').bind(wo.id, c.value, l.item.id, l.q, l.item.rate_paise, l.amt)),
        audit(env, req.user, 'create', 'con_ra_bills', 0, `RA ${c.value} on ${wo.wo_no}: gross ${rupees(gross)}, net ${rupees(net)}`),
      ]);
      const ra = await env.DB.prepare('SELECT id FROM con_ra_bills WHERE wo_id = ? AND ra_no = ?').bind(wo.id, c.value).first();
      return json({ ok: true, data: { id: ra.id, ra_no: c.value, gross_paise: gross, retention_paise: retention, advance_recovery_paise: rec, gst_paise: gst, tds_paise: tds, net_paise: net, warnings } });
    } catch (e) { return serverError(e, 'ra-create'); }
  }));

  router.post('/api/contractors/ra-bills/:id/check', guard('A', async (req, env) => {
    try {
      const { ra, err } = await loadRa(env, req); if (err) return err;
      if (ra.created_by === req.user.user_id) return json({ ok: false, error: 'You cannot check a bill you raised.' }, 403);
      const r = await env.DB.prepare("UPDATE con_ra_bills SET status = 'checked', checked_by = ? WHERE id = ? AND status = 'draft'").bind(req.user.user_id, ra.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Only a draft can be checked.' }, 409);
      await notifyRoles(env, ra.net_paise > await pmLimit(env) ? ['owner'] : ['owner', 'pm'], `RA bill to approve: ${ra.wo_no} / RA ${ra.ra_no}`, `Net ${rupees(ra.net_paise)}`, req.user.user_id);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ra-check'); }
  }));

  router.post('/api/contractors/ra-bills/:id/approve', guard('A', async (req, env) => {
    try {
      const { ra, err } = await loadRa(env, req); if (err) return err;
      if (ra.created_by === req.user.user_id) return json({ ok: false, error: 'You cannot approve a bill you raised.' }, 403);
      const limit = await pmLimit(env);
      if (!mayDecide(req.user, ra.net_paise, limit)) return json({ ok: false, error: `This bill is above your limit (${rupees(limit)}). The Owner must approve it.` }, 403);
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
        audit(env, req.user, 'approve', 'con_ra_bills', ra.id, `${req.user.name} approved ${ra.wo_no} / RA ${ra.ra_no} (net ${rupees(ra.net_paise)})`),
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
