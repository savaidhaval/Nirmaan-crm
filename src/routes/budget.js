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

export function registerBudget(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, csvBom } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'bud_heads', id || 0, String(summary).slice(0, 300), nowStr());

  async function projectOk(env, req, pid) { return pid && (await visibleProjectIds(env, req.user)).includes(pid); }

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
