// routes/m3gaps.js — Module 3 gaps, step 1: CC-floor check for work orders and daily reports, work-order cap against the BOQ,
// BOQ allowance on indent lines, the gate-receipt rules, and the weekly wastage alert. Limits come from Settings; confirm with your PM / QS.
import { approvalState } from '../core/gates.js';

// Soft CC-floor check: only when a CC floor is on record for the wing. (No CC recorded = no lock, as for sales.)
export async function ccOverFloor(env, projectId, wing, floors, stateCache) {
  const list = [...new Set(floors.filter((f) => f != null))];
  if (!list.length) return null;
  const st = stateCache || await approvalState(env, projectId);
  const upto = st.ccUpto(wing || null);
  if (upto == null) return null;
  const over = list.filter((f) => f > upto);
  return over.length ? `The approved CC covers work up to floor ${upto}; this is for floor ${Math.max(...over)}.` : null;
}

// Work-order lines tied to BOQ items: quantity may not exceed what the BOQ still has free (after other live work orders), nor the rate the BOQ rate.
// Returns a plain message or null. Pass the lines being drafted ({boq, qty, rate}) and the work order being replaced (none for a new one).
export async function boqCapProblem(env, projectId, items, exceptWoId = 0) {
  const ids = [...new Set(items.filter((i) => i.boq).map((i) => i.boq))];
  if (!ids.length) return null;
  const j = JSON.stringify(ids);
  const [boq, used] = await env.DB.batch([
    env.DB.prepare('SELECT id, code, description, qty, rate_paise, unit FROM bud_items WHERE project_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(projectId, j),
    env.DB.prepare(`SELECT i.boq_item_id AS b, SUM(i.qty) AS q FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id
      WHERE w.project_id = ? AND w.id != ? AND w.status NOT IN ('rejected', 'cancelled', 'closed') AND i.boq_item_id IN (SELECT value FROM json_each(?)) GROUP BY i.boq_item_id`).bind(projectId, exceptWoId, j),
  ]);
  const usedBy = Object.fromEntries(used.results.map((u) => [u.b, u.q]));
  const mine = {};
  for (const i of items) if (i.boq) mine[i.boq] = (mine[i.boq] || 0) + i.qty;
  for (const b of boq.results) {
    const free = b.qty - (usedBy[b.id] || 0);
    if (mine[b.id] > free + 1e-9) return `${b.description}${b.code ? ' (' + b.code + ')' : ''}: the BOQ has ${+free.toFixed(3)} ${b.unit || ''} still free (BOQ ${b.qty}, other work orders ${+(usedBy[b.id] || 0).toFixed(3)}), but this order asks for ${+mine[b.id].toFixed(3)}.`;
    const dear = items.find((i) => i.boq === b.id && i.rate > b.rate_paise);
    if (dear) return `${b.description}${b.code ? ' (' + b.code + ')' : ''}: the rate is more than the BOQ rate (BOQ rate ${b.rate_paise / 100}, this order ${dear.rate / 100}).`;
  }
  return null;
}

// Indent lines against the BOQ: mark a line "over BOQ" when the quantity already asked for (not rejected) plus this one passes the BOQ quantity.
export async function indentBoqFlags(env, projectId, items) {
  const ids = [...new Set(items.map((i) => i.boq).filter(Boolean))];
  if (!ids.length) return { flags: new Map(), names: {} };
  const j = JSON.stringify(ids);
  const [boq, asked] = await env.DB.batch([
    env.DB.prepare('SELECT id, description, qty, unit FROM bud_items WHERE project_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(projectId, j),
    env.DB.prepare(`SELECT ii.boq_item_id AS b, SUM(ii.qty) AS q FROM pro_indent_items ii JOIN pro_indents x ON x.id = ii.indent_id
      WHERE x.project_id = ? AND x.deleted_at IS NULL AND x.status != 'rejected' AND ii.boq_item_id IN (SELECT value FROM json_each(?)) GROUP BY ii.boq_item_id`).bind(projectId, j),
  ]);
  const by = Object.fromEntries(boq.results.map((b) => [b.id, b])); const before = Object.fromEntries(asked.results.map((a) => [a.b, a.q]));
  const running = { ...before }; const flags = new Map(); const names = {};
  items.forEach((it, idx) => {
    const b = by[it.boq]; if (!b) return;
    running[b.id] = (running[b.id] || 0) + it.qty;
    if (running[b.id] > b.qty + 1e-9) { flags.set(idx, true); names[idx] = `${b.description}: ${+running[b.id].toFixed(3)} asked in all, BOQ ${b.qty} ${b.unit || ''}`; }
  });
  return { flags, names };
}

// Monday 10:00-10:59 India time (called from the hourly sweep): material issued to work orders beyond what the measured work needed plus the allowed wastage.
// Three statements however many materials there are.
export async function wastageSweep(env, getSetting, nowStr) {
  const ist = new Date(Date.now() + 19800000);
  if (!env.WASTAGE_TEST && (ist.getUTCDay() !== 1 || ist.getUTCHours() !== 10)) return 0;   // WASTAGE_TEST exists only in test builds (.dev.vars / CI)
  const raw = Number(await getSetting(env, 'stk.wastage_alert_bp')); const tol = Number.isFinite(raw) && raw >= 0 && (await getSetting(env, 'stk.wastage_alert_bp')) !== null ? raw : 250;
  const [theo, issued] = await env.DB.batch([
    env.DB.prepare(`SELECT w.project_id AS p, i.stock_item_id AS s, SUM(COALESCE(m.q, 0) * i.consumption_per_unit) AS t FROM con_wo_items i JOIN con_work_orders w ON w.id = i.wo_id
      LEFT JOIN (SELECT wo_item_id, SUM(qty) AS q FROM con_measurements WHERE status = 'approved' GROUP BY wo_item_id) m ON m.wo_item_id = i.id
      WHERE w.status IN ('approved', 'closed') AND i.stock_item_id IS NOT NULL AND i.consumption_per_unit > 0 GROUP BY w.project_id, i.stock_item_id`),
    env.DB.prepare(`SELECT project_id AS p, item_id AS s, SUM(CASE kind WHEN 'issue' THEN qty WHEN 'receipt' THEN -qty ELSE 0 END) AS q FROM stk_moves WHERE wo_id IS NOT NULL AND status = 'posted' GROUP BY project_id, item_id`),
  ]);
  const iss = Object.fromEntries(issued.results.map((r) => [r.p + ':' + r.s, r.q]));
  const week = `${ist.getUTCFullYear()}-${String(Math.ceil((((ist - Date.UTC(ist.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
  const alerts = theo.results.filter((r) => r.t > 0 && (iss[r.p + ':' + r.s] || 0) > r.t * (10000 + tol) / 10000 + 1e-9)
    .map((r) => ({ p: r.p, s: r.s, t: Math.round(r.t * 1000) / 1000, q: Math.round((iss[r.p + ':' + r.s] || 0) * 1000) / 1000, k: `wastage:${r.p}:${r.s}:${week}` })).slice(0, 50);
  if (!alerts.length) return 0;
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'Material wastage above ' || (?3 / 100.0) || '%: ' || COALESCE((SELECT name FROM stk_items WHERE id = json_extract(a.value, '$.s')), 'item'),
      'Issued ' || json_extract(a.value, '$.q') || ' against ' || json_extract(a.value, '$.t') || ' needed for the measured work. Check the store and the work orders.', json_extract(a.value, '$.k'), ?2
    FROM json_each(?1) a JOIN users u ON u.active = 1 AND u.deleted_at IS NULL AND u.role IN ('owner', 'pm')
    WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.link = json_extract(a.value, '$.k'))`).bind(JSON.stringify(alerts), nowStr(), tol).run();
  return alerts.length;
}
