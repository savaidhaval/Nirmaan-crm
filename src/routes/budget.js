// routes/budget.js — WP-7: budget by cost head per project, with committed / billed / paid and the balance.
// Figures come from the Procurement and Contractors modules through their own functions (one aggregate query each); this file never reads their tables.
import { procurementByHead, posForHead, poItemsTaggedCount, headsOnPo } from './procurement2.js';
import { contractsByHead, wosForHead, wosTaggedCount } from './contractors.js';

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const WRITERS = ['owner', 'pm'];

export async function gstInclusive(env, getSetting) { return (await getSetting(env, 'budget.gst_basis')) === 'inclusive'; }

// Words and colour for "how much of the budget is used". Never colour alone.
export function level(committed, budget) {
  if (!(budget > 0)) return { key: 'unset', text: 'No budget set' };
  const pct = (committed * 100) / budget;
  if (pct > 100) return { key: 'over', text: 'Over budget' };
  if (pct >= 90) return { key: 'near', text: 'Close to the limit' };
  return { key: 'ok', text: 'Within budget' };
}

export async function budgetOverview(env, getSetting, projectId) {
  const incl = await gstInclusive(env, getSetting);
  const [heads, po, con] = await Promise.all([
    env.DB.prepare('SELECT id, code, name, budget_paise, sort_order FROM bud_heads WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order, code').bind(projectId).all(),
    procurementByHead(env, projectId, incl), contractsByHead(env, projectId, incl),
  ]);
  const get = (id, k) => ((po[id] || {})[k] || 0) + ((con[id] || {})[k] || 0);
  const rows = heads.results.map((h) => {
    const committed = get(h.id, 'committed'), billed = get(h.id, 'billed'), paid = get(h.id, 'paid');
    const lv = level(committed, h.budget_paise);
    return { ...h, committed_paise: committed, billed_paise: billed, paid_paise: paid, balance_paise: h.budget_paise - committed,
      pct_used_bp: h.budget_paise > 0 ? Math.round((committed * 10000) / h.budget_paise) : null, level: lv.key, level_text: lv.text };
  });
  const untagged = { committed_paise: get(0, 'committed'), billed_paise: get(0, 'billed'), paid_paise: get(0, 'paid') };
  const total = rows.reduce((t, r) => ({ budget: t.budget + r.budget_paise, committed: t.committed + r.committed_paise, billed: t.billed + r.billed_paise, paid: t.paid + r.paid_paise }), { budget: 0, committed: 0, billed: 0, paid: 0 });
  return { gst_basis: incl ? 'inclusive' : 'exclusive', rows, untagged, total };
}

// Called after a PO or work order is approved. Returns plain-language warnings and tells the Owner and PM (once per head per week).
export async function checkHeadOver(env, getSetting, nowStr, projectId, headIds) {
  const ids = [...new Set((headIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const ov = await budgetOverview(env, getSetting, projectId);
  const warnings = [];
  for (const r of ov.rows.filter((x) => ids.includes(x.id) && x.level === 'over')) {
    const msg = `${r.name} is over budget: ${rupees(r.committed_paise)} committed against ${rupees(r.budget_paise)}.`;
    warnings.push(msg);
    const title = `Over budget: ${r.code} ${r.name} (head ${r.id})`;
    await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, ?1, ?2, 'budget', ?3 FROM users u WHERE u.role IN ('owner', 'pm') AND u.active = 1 AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = ?1 AND n.created_at > datetime('now', '-7 days'))`).bind(title, msg, nowStr()).run();
  }
  return warnings;
}

export async function headBelongsToProject(env, headId, projectId) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM bud_heads WHERE id = ? AND project_id = ? AND deleted_at IS NULL').bind(headId, projectId).first());
}
export { headsOnPo };

export async function boqItemInProject(env, id, projectId) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM bud_items WHERE id = ? AND project_id = ? AND deleted_at IS NULL').bind(id, projectId).first());
}

export function registerBudget(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, csvBom, boqProgressCon, boqProgressPo } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'bud_heads', id || 0, String(summary).slice(0, 300), nowStr());

  async function projectOk(env, req, pid) { return pid && (await visibleProjectIds(env, req.user)).includes(pid); }

  // ----- BOQ items under each head: quantity x rate, then committed / ordered / measured / billed against each -----
  const pOk = async (env, req, pid) => pid > 0 && (await visibleProjectIds(env, req.user)).includes(pid);
  router.get('/api/budget/boq', async (req, env) => withAuth(req, env, 'budget', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const pid = Number(q.get('project_id'));
      if (!(await pOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const [items, con, po] = await Promise.all([
        env.DB.prepare(`SELECT b.*, h.code AS head_code, h.name AS head_name FROM bud_items b JOIN bud_heads h ON h.id = b.head_id WHERE b.project_id = ? AND b.deleted_at IS NULL AND (? = '' OR COALESCE(b.wing, '') = ?) AND (? = '' OR b.floor = CAST(? AS INTEGER)) ORDER BY h.sort_order, h.code, b.code, b.id LIMIT 1000`).bind(pid, String(q.get('wing') || ''), String(q.get('wing') || ''), String(q.get('floor') ?? ''), String(q.get('floor') ?? '')).all(),
        boqProgressCon(env, pid), boqProgressPo(env, pid),
      ]);
      const C = Object.fromEntries(con.map((r) => [r.boq, r])), P = Object.fromEntries(po.map((r) => [r.boq, r]));
      const rows = items.results.map((b) => { const c = C[b.id] || {}, p = P[b.id] || {}; const committed = (c.committed || 0) + (p.ordered || 0);
        return { ...b, committed_qty: committed, measured_qty: c.measured || 0, billed_qty: c.billed || 0, committed_paise: (c.committed_paise || 0) + (p.ordered_paise || 0),
          over_qty: committed > b.qty + 1e-9, pct_used: b.qty ? Math.round((committed * 1000) / b.qty) / 10 : 0 }; });
      if (q.get('csv')) return new Response(csvBom([['Head', 'Code', 'Item', 'Wing / building', 'Floor', 'Unit', 'BOQ qty', 'Rate', 'BOQ amount', 'Committed qty', 'Measured qty', 'Billed qty', 'Committed value'],
        ...rows.map((r) => [r.head_code, r.code || '', r.description, r.wing || '', r.floor == null ? '' : r.floor, r.unit || '', r.qty, (r.rate_paise / 100).toFixed(2), (r.amount_paise / 100).toFixed(2), r.committed_qty, r.measured_qty, r.billed_qty, (r.committed_paise / 100).toFixed(2)])]),
        { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="boq-status.csv"', 'Cache-Control': 'no-store' } });
      return json({ ok: true, data: { items: rows } });
    } catch (e) { return serverError(e, 'boq-list'); }
  }));
  // Add BOQ items: one, or a pasted list (up to 200) under one head.
  router.post('/api/budget/boq', async (req, env) => withAuth(req, env, 'budget', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id), head = Number(b.head_id);
      if (!(await pOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      if (!(await env.DB.prepare('SELECT 1 AS x FROM bud_heads WHERE id = ? AND project_id = ? AND deleted_at IS NULL').bind(head, pid).first())) return json({ ok: false, error: 'Pick a budget head of this project.' }, 400);
      const list = (Array.isArray(b.lines) ? b.lines : [b]).slice(0, 201);
      if (list.length > 200) return json({ ok: false, error: 'At most 200 lines at a time.' }, 400);
      const rows = [];
      for (const [n, l] of list.entries()) {
        const desc = String(l.description || '').trim().slice(0, 200), qty = Number(l.qty), rate = Math.round(Number(l.rate_paise));
        if (!desc || !(qty > 0) || !(rate >= 0)) return json({ ok: false, error: `Line ${n + 1}: needs a description, a quantity and a rate.` }, 400);
        const fl = l.floor === '' || l.floor == null ? null : Math.round(Number(l.floor));
        if (fl != null && !(fl >= -5 && fl <= 200)) return json({ ok: false, error: `Line ${n + 1}: check the floor number.` }, 400);
        rows.push({ code: String(l.code || '').trim().slice(0, 30) || null, desc, unit: String(l.unit || '').trim().slice(0, 20) || null, qty, rate, wing: String(l.wing || b.wing || '').trim().slice(0, 30) || null, floor: fl });
      }
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO bud_items (project_id, head_id, code, description, unit, qty, rate_paise, amount_paise, created_by, created_at, wing, floor)
          SELECT ?1, ?2, json_extract(value, '$.code'), json_extract(value, '$.desc'), json_extract(value, '$.unit'), json_extract(value, '$.qty'), json_extract(value, '$.rate'), CAST(ROUND(json_extract(value, '$.qty') * json_extract(value, '$.rate')) AS INTEGER), ?3, ?4, json_extract(value, '$.wing'), json_extract(value, '$.floor') FROM json_each(?5)`)
          .bind(pid, head, req.user.user_id, now, JSON.stringify(rows)),
        audit(env, req.user, 'create', head, `BOQ: ${rows.length} item(s) added`),
      ]);
      return json({ ok: true, data: { added: rows.length } });
    } catch (e) { return serverError(e, 'boq-add'); }
  }));
  router.put('/api/budget/boq/:id', async (req, env) => withAuth(req, env, 'budget', 'E', async (req, env) => {
    try {
      const it = await env.DB.prepare('SELECT * FROM bud_items WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!it || !(await pOk(env, req, it.project_id))) return json({ ok: false, error: 'BOQ item not found.' }, 404);
      const b = await req.json();
      if (b.wing !== undefined || b.floor !== undefined) {   // where the line belongs: no reason needed, no money changes
        const wing = b.wing !== undefined ? String(b.wing || '').trim().slice(0, 30) || null : it.wing;
        const fl = b.floor !== undefined ? (b.floor === '' || b.floor == null ? null : Math.round(Number(b.floor))) : it.floor;
        if (fl != null && !(fl >= -5 && fl <= 200)) return json({ ok: false, error: 'Check the floor number.' }, 400);
        if (b.qty === undefined && b.rate_paise === undefined) { await env.DB.prepare('UPDATE bud_items SET wing = ?, floor = ? WHERE id = ?').bind(wing, fl, it.id).run(); return json({ ok: true }); }
        await env.DB.prepare('UPDATE bud_items SET wing = ?, floor = ? WHERE id = ?').bind(wing, fl, it.id).run();
      }
      const qty = b.qty !== undefined ? Number(b.qty) : it.qty, rate = b.rate_paise !== undefined ? Math.round(Number(b.rate_paise)) : it.rate_paise;
      if (!(qty > 0) || !(rate >= 0)) return json({ ok: false, error: 'Check the quantity and rate.' }, 400);
      const reason = String(b.reason || '').trim().slice(0, 200); if (!reason) return json({ ok: false, error: 'Say why the BOQ changes (revised drawing, client change...).' }, 400);
      await env.DB.batch([
        env.DB.prepare('UPDATE bud_items SET qty = ?, rate_paise = ?, amount_paise = ?, description = COALESCE(?, description), unit = COALESCE(?, unit) WHERE id = ?').bind(qty, rate, Math.round(qty * rate), b.description ? String(b.description).slice(0, 200) : null, b.unit ? String(b.unit).slice(0, 20) : null, it.id),
        audit(env, req.user, 'edit', it.head_id, `BOQ ${it.code || it.id} ${it.description}: qty ${it.qty} → ${qty}, rate ${it.rate_paise / 100} → ${rate / 100} (${reason})`),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'boq-edit'); }
  }));
  router.delete('/api/budget/boq/:id', async (req, env) => withAuth(req, env, 'budget', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can delete.' }, 403);
      const it = await env.DB.prepare('SELECT * FROM bud_items WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!it || !(await pOk(env, req, it.project_id))) return json({ ok: false, error: 'BOQ item not found.' }, 404);
      const used = [...(await boqProgressCon(env, it.project_id)), ...(await boqProgressPo(env, it.project_id))].some((r) => r.boq === it.id);
      if (used) return json({ ok: false, error: 'Work orders or POs use this BOQ item. It cannot be deleted.' }, 409);
      await env.DB.batch([env.DB.prepare('UPDATE bud_items SET deleted_at = ? WHERE id = ?').bind(nowStr(), it.id), audit(env, req.user, 'delete', it.head_id, `BOQ item deleted: ${it.description}`)]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'boq-del'); }
  }));

  router.get('/api/budget/heads', async (req, env) => withAuth(req, env, 'budget', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { heads: [] } });
      const rows = await env.DB.prepare(`SELECT h.id, h.project_id, h.code, h.name, p.name AS project FROM bud_heads h JOIN projects p ON p.id = h.project_id
        WHERE h.deleted_at IS NULL AND h.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name, h.sort_order, h.code LIMIT 300`).bind(...ids).all();
      return json({ ok: true, data: { heads: rows.results } });
    } catch (e) { return serverError(e, 'bud-heads'); }
  }));

  router.post('/api/budget/heads', async (req, env) => withAuth(req, env, 'budget', 'C', async (req, env) => {
    try {
      if (!WRITERS.includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or the PM can set budget heads.' }, 403);
      const b = await req.json();
      const pid = Number(b.project_id), code = String(b.code || '').trim().toUpperCase().slice(0, 12), name = String(b.name || '').trim().slice(0, 80), budget = Math.round(num(b.budget_paise));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      if (!code || !name) return json({ ok: false, error: 'Give the head a short code and a name (e.g. ST, Steel).' }, 400);
      if (budget < 0) return json({ ok: false, error: 'Budget cannot be negative.' }, 400);
      const dup = await env.DB.prepare('SELECT id FROM bud_heads WHERE project_id = ? AND code = ?').bind(pid, code).first();
      if (dup) return json({ ok: false, error: `The code ${code} is already used in this project.` }, 409);
      const r = await env.DB.prepare('INSERT INTO bud_heads (project_id, code, name, budget_paise, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(pid, code, name, budget, Math.round(num(b.sort_order)), req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', r.meta.last_row_id, `Budget head ${code} ${name}: ${rupees(budget)}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'bud-create'); }
  }));

  router.put('/api/budget/heads/:id', async (req, env) => withAuth(req, env, 'budget', 'E', async (req, env) => {
    try {
      if (!WRITERS.includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or the PM can change a budget.' }, 403);
      const head = await env.DB.prepare('SELECT * FROM bud_heads WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!head || !(await projectOk(env, req, head.project_id))) return json({ ok: false, error: 'Budget head not found.' }, 404);
      const b = await req.json();
      const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) : head.name;
      const budget = b.budget_paise !== undefined ? Math.round(num(b.budget_paise)) : head.budget_paise;
      if (!name || budget < 0) return json({ ok: false, error: 'Name is needed and the budget cannot be negative.' }, 400);
      await env.DB.prepare('UPDATE bud_heads SET name = ?, budget_paise = ?, sort_order = ? WHERE id = ?').bind(name, budget, b.sort_order !== undefined ? Math.round(num(b.sort_order)) : head.sort_order, head.id).run();
      await audit(env, req.user, 'update', head.id, `Budget head ${head.code}: ${rupees(head.budget_paise)} → ${rupees(budget)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bud-update'); }
  }));

  // Remove a head only while nothing is tagged to it.
  router.delete('/api/budget/heads/:id', async (req, env) => withAuth(req, env, 'budget', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can delete a budget head.' }, 403);
      const head = await env.DB.prepare('SELECT * FROM bud_heads WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!head || !(await projectOk(env, req, head.project_id))) return json({ ok: false, error: 'Budget head not found.' }, 404);
      if ((await poItemsTaggedCount(env, head.id)) + (await wosTaggedCount(env, head.id)) > 0) return json({ ok: false, error: 'Purchase orders or work orders are tagged to this head. Set its budget to 0 instead.' }, 409);
      await env.DB.prepare('UPDATE bud_heads SET deleted_at = ? WHERE id = ?').bind(nowStr(), head.id).run();
      await audit(env, req.user, 'delete', head.id, `Removed budget head ${head.code}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bud-delete'); }
  }));

  router.get('/api/budget/overview', async (req, env) => withAuth(req, env, 'budget', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const ov = await budgetOverview(env, getSetting, pid);
      if (new URL(req.url).searchParams.get('csv')) {
        const f = (p) => (Number(p) / 100).toFixed(2);
        const rows = [['Code', 'Head', 'Budget', 'Committed', 'Billed', 'Paid', 'Balance', '% used', 'Status'],
          ...ov.rows.map((r) => [r.code, r.name, f(r.budget_paise), f(r.committed_paise), f(r.billed_paise), f(r.paid_paise), f(r.balance_paise), r.pct_used_bp == null ? '' : (r.pct_used_bp / 100).toFixed(1), r.level_text]),
          ['', 'Not tagged to a head', '', f(ov.untagged.committed_paise), f(ov.untagged.billed_paise), f(ov.untagged.paid_paise), '', '', ''],
          ['', `Figures ${ov.gst_basis} of GST`, '', '', '', '', '', '', '']];
        return new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="budget.csv"', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, data: ov });
    } catch (e) { return serverError(e, 'bud-overview'); }
  }));

  router.get('/api/budget/heads/:id/detail', async (req, env) => withAuth(req, env, 'budget', 'V', async (req, env) => {
    try {
      const head = await env.DB.prepare('SELECT * FROM bud_heads WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!head || !(await projectOk(env, req, head.project_id))) return json({ ok: false, error: 'Budget head not found.' }, 404);
      const [pos, wos] = await Promise.all([posForHead(env, head.id), wosForHead(env, head.id)]);
      return json({ ok: true, data: { head, pos, work_orders: wos } });
    } catch (e) { return serverError(e, 'bud-detail'); }
  }));
}
