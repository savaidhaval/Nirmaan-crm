// routes/stores.js — WP-8: stock on hand per project for materials we buy.
// Every balance change is made in the same db.batch() as the move that causes it, guarded so stock can never go below zero.
// Receipts arrive from Procurement through grnStockStatements() (called inside the GRN batch); this file never reads pro_* tables.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = (q) => (Math.round(Number(q) * 1000) / 1000).toString();
const MANAGERS = ['owner', 'pm', 'purchase'];

// ----- Service functions -----
export async function stockItemExists(env, id) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM stk_items WHERE id = ? AND active = 1').bind(id).first());
}

// Statements Procurement adds to its GRN batch: one receipt move + balance increase per received line that is tied to a stock item.
// lines: [{ po_item_id, stock_item_id, qty }]. uuid: the GRN's client_uuid (makes each move idempotent).
export function grnStockStatements(env, now, projectId, userId, uuid, lines) {
  const out = [];
  for (const l of lines.filter((x) => x.stock_item_id && x.qty > 0)) {
    out.push(env.DB.prepare(`INSERT INTO stk_moves (project_id, item_id, kind, qty, status, ref_table, ref_id, by_user, client_uuid, created_at)
      VALUES (?, ?, 'receipt', ?, 'posted', 'pro_grns', (SELECT id FROM pro_grns WHERE client_uuid = ?), ?, ?, ?)`).bind(projectId, l.stock_item_id, l.qty, uuid, userId, `${uuid}:${l.po_item_id}`, now));
    out.push(env.DB.prepare(`INSERT INTO stk_balance (project_id, item_id, qty) VALUES (?, ?, ?) ON CONFLICT(project_id, item_id) DO UPDATE SET qty = qty + excluded.qty`).bind(projectId, l.stock_item_id, l.qty));
  }
  return out;
}

// Hourly: one reminder per PM/Purchase user per low item per day (one statement).
export async function lowStockSweep(env) {
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'Low stock: ' || i.name || ' at ' || p.name, 'Only ' || b.qty || ' ' || COALESCE(i.unit, '') || ' left (reorder level ' || b.reorder_level || ').', 'stores', datetime('now')
    FROM stk_balance b JOIN stk_items i ON i.id = b.item_id JOIN projects p ON p.id = b.project_id JOIN users u ON u.role IN ('pm', 'purchase') AND u.active = 1 AND u.deleted_at IS NULL
    WHERE b.reorder_level > 0 AND b.qty <= b.reorder_level AND i.active = 1 AND p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Low stock: ' || i.name || ' at ' || p.name AND date(n.created_at) = date('now'))`).run();
}

export function registerStores(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, csvBom } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'stk_moves', id || 0, String(summary).slice(0, 300), nowStr());
  const csvResponse = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });

  async function notifyRoles(env, roles, title, body) {
    const users = await env.DB.prepare(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND active = 1 AND deleted_at IS NULL LIMIT 20`).bind(...roles).all();
    if (!users.results.length) return;
    const now = nowStr();
    await env.DB.batch(users.results.map((u) => env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, title, body, 'stores', now)));
  }
  async function projectOk(env, req, pid) { return pid > 0 && (await visibleProjectIds(env, req.user)).includes(pid); }
  async function item(env, id) { return env.DB.prepare('SELECT * FROM stk_items WHERE id = ? AND active = 1').bind(id).first(); }
  async function onHand(env, pid, itemId) { const r = await env.DB.prepare('SELECT qty FROM stk_balance WHERE project_id = ? AND item_id = ?').bind(pid, itemId).first(); return r ? r.qty : 0; }

  router.get('/api/stores/items', async (req, env) => withAuth(req, env, 'stores', 'V', async (req, env) => {
    try { return json({ ok: true, data: { items: (await env.DB.prepare('SELECT id, name, unit, category FROM stk_items WHERE active = 1 ORDER BY name LIMIT 500').all()).results } }); }
    catch (e) { return serverError(e, 'stk-items'); }
  }));

  router.post('/api/stores/items', async (req, env) => withAuth(req, env, 'stores', 'C', async (req, env) => {
    try {
      if (!MANAGERS.includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can add an item.' }, 403);
      const b = await req.json();
      const name = String(b.name || '').trim().slice(0, 80), unit = String(b.unit || '').trim().slice(0, 20);
      if (!name) return json({ ok: false, error: 'Give the item a name.' }, 400);
      const dup = await env.DB.prepare('SELECT id FROM stk_items WHERE name = ? AND COALESCE(unit, \'\') = ?').bind(name, unit).first();
      if (dup) return json({ ok: false, error: 'That item already exists.' }, 409);
      const r = await env.DB.prepare('INSERT INTO stk_items (name, unit, category, created_at) VALUES (?, ?, ?, ?)').bind(name, unit, String(b.category || '').slice(0, 40), nowStr()).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'stk-item-create'); }
  }));

  router.get('/api/stores/stock', async (req, env) => withAuth(req, env, 'stores', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const rows = (await env.DB.prepare(`SELECT i.id AS item_id, i.name, i.unit, i.category, COALESCE(b.qty, 0) AS qty, COALESCE(b.reorder_level, 0) AS reorder_level
        FROM stk_items i LEFT JOIN stk_balance b ON b.item_id = i.id AND b.project_id = ? WHERE i.active = 1 ORDER BY i.name LIMIT 500`).bind(pid).all()).results;
      for (const r of rows) r.low = r.reorder_level > 0 && r.qty <= r.reorder_level;
      if (new URL(req.url).searchParams.get('csv')) return csvResponse('stock-on-hand.csv', [['Item', 'Unit', 'Category', 'On hand', 'Reorder level', 'Low'], ...rows.map((r) => [r.name, r.unit || '', r.category || '', fmt(r.qty), fmt(r.reorder_level), r.low ? 'Yes' : ''])]);
      return json({ ok: true, data: { stock: rows } });
    } catch (e) { return serverError(e, 'stk-stock'); }
  }));

  router.post('/api/stores/reorder', async (req, env) => withAuth(req, env, 'stores', 'E', async (req, env) => {
    try {
      if (!MANAGERS.includes(req.user.role)) return json({ ok: false, error: 'Only Purchase, the PM or the Owner can set a reorder level.' }, 403);
      const b = await req.json(); const pid = Number(b.project_id), itemId = Number(b.item_id), lvl = num(b.reorder_level);
      if (!(await projectOk(env, req, pid)) || !(await item(env, itemId))) return json({ ok: false, error: 'Pick a project and an item.' }, 400);
      if (lvl < 0) return json({ ok: false, error: 'Reorder level cannot be negative.' }, 400);
      await env.DB.prepare('INSERT INTO stk_balance (project_id, item_id, qty, reorder_level) VALUES (?, ?, 0, ?) ON CONFLICT(project_id, item_id) DO UPDATE SET reorder_level = excluded.reorder_level').bind(pid, itemId, lvl).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'stk-reorder'); }
  }));

  // Issue stock to work. Atomic: the balance is reduced only if enough is there, and the move is written only if it was.
  router.post('/api/stores/issue', async (req, env) => withAuth(req, env, 'stores', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id), itemId = Number(b.item_id), q = num(b.qty);
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const it = await item(env, itemId);
      if (!it) return json({ ok: false, error: 'Pick an item.' }, 400);
      if (!(q > 0)) return json({ ok: false, error: 'Enter how much was issued.' }, 400);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM stk_moves WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare('UPDATE stk_balance SET qty = qty - ?1 WHERE project_id = ?2 AND item_id = ?3 AND qty + 0.000001 >= ?1').bind(q, pid, itemId),
        env.DB.prepare(`INSERT INTO stk_moves (project_id, item_id, kind, qty, status, where_used, note, by_user, client_uuid, created_at)
          SELECT ?1, ?2, 'issue', ?3, 'posted', ?4, ?5, ?6, ?7, ?8 WHERE changes() > 0`).bind(pid, itemId, q, String(b.where_used || '').slice(0, 120), String(b.note || '').slice(0, 200), req.user.user_id, uuid, now),
      ]);
      if (!res[1].meta.changes) return json({ ok: false, error: `Only ${fmt(await onHand(env, pid, itemId))} ${it.unit || ''} of ${it.name} is in the store.` }, 400);
      return json({ ok: true, data: { id: res[1].meta.last_row_id, on_hand: await onHand(env, pid, itemId) } });
    } catch (e) { return serverError(e, 'stk-issue'); }
  }));

  // Move stock between two sites: four chained statements, each runs only if the one before it changed a row.
  router.post('/api/stores/transfer', async (req, env) => withAuth(req, env, 'stores', 'C', async (req, env) => {
    try {
      const b = await req.json(); const from = Number(b.project_id), to = Number(b.to_project_id), itemId = Number(b.item_id), q = num(b.qty);
      if (!(await projectOk(env, req, from)) || !(await projectOk(env, req, to))) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (from === to) return json({ ok: false, error: 'Pick a different project to send it to.' }, 400);
      const it = await item(env, itemId);
      if (!it || !(q > 0)) return json({ ok: false, error: 'Pick an item and a quantity.' }, 400);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM stk_moves WHERE client_uuid = ?').bind(uuid + ':out').first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const now = nowStr(), note = String(b.note || '').slice(0, 200);
      const res = await env.DB.batch([
        env.DB.prepare('UPDATE stk_balance SET qty = qty - ?1 WHERE project_id = ?2 AND item_id = ?3 AND qty + 0.000001 >= ?1').bind(q, from, itemId),
        env.DB.prepare(`INSERT INTO stk_moves (project_id, item_id, kind, qty, status, to_project_id, note, by_user, client_uuid, created_at) SELECT ?1, ?2, 'transfer_out', ?3, 'posted', ?4, ?5, ?6, ?7, ?8 WHERE changes() > 0`).bind(from, itemId, q, to, note, req.user.user_id, uuid + ':out', now),
        env.DB.prepare('INSERT INTO stk_balance (project_id, item_id, qty) SELECT ?1, ?2, ?3 WHERE changes() > 0 ON CONFLICT(project_id, item_id) DO UPDATE SET qty = qty + excluded.qty').bind(to, itemId, q),
        env.DB.prepare(`INSERT INTO stk_moves (project_id, item_id, kind, qty, status, to_project_id, note, by_user, client_uuid, created_at) SELECT ?1, ?2, 'transfer_in', ?3, 'posted', ?4, ?5, ?6, ?7, ?8 WHERE changes() > 0`).bind(to, itemId, q, from, note, req.user.user_id, uuid + ':in', now),
      ]);
      if (!res[3].meta.changes) return json({ ok: false, error: `Only ${fmt(await onHand(env, from, itemId))} ${it.unit || ''} of ${it.name} is in the store.` }, 400);
      return json({ ok: true, data: { id: res[1].meta.last_row_id } });
    } catch (e) { return serverError(e, 'stk-transfer'); }
  }));

  // Adjustment (stock count differs): needs a reason and waits for a PM before the balance changes.
  router.post('/api/stores/adjust', async (req, env) => withAuth(req, env, 'stores', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id), itemId = Number(b.item_id), q = num(b.qty);
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const it = await item(env, itemId);
      if (!it || !q) return json({ ok: false, error: 'Pick an item and the difference (use a minus for stock that is missing).' }, 400);
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Say why the stock is being adjusted.' }, 400);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM stk_moves WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const r = await env.DB.prepare("INSERT INTO stk_moves (project_id, item_id, kind, qty, status, note, by_user, client_uuid, created_at) VALUES (?, ?, 'adjust', ?, 'pending', ?, ?, ?, ?)")
        .bind(pid, itemId, q, String(b.reason).slice(0, 200), req.user.user_id, uuid, nowStr()).run();
      await notifyRoles(env, ['pm', 'owner'], `Stock adjustment to approve: ${it.name}`, `${req.user.name}: ${q > 0 ? '+' : ''}${fmt(q)} ${it.unit || ''}. ${String(b.reason).slice(0, 100)}`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'stk-adjust'); }
  }));

  // Stock received without a purchase order (opening stock, cash purchase, returned from work).
  // Purchase, the PM or the Owner add it straight away; anyone else's entry waits for a PM or the Owner.
  router.post('/api/stores/receive', async (req, env) => withAuth(req, env, 'stores', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id), itemId = Number(b.item_id), q = num(b.qty);
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const it = await item(env, itemId);
      if (!it) return json({ ok: false, error: 'Pick an item.' }, 400);
      if (!(q > 0)) return json({ ok: false, error: 'Enter how much came in.' }, 400);
      const note = String(b.note || '').trim().slice(0, 200);
      if (!note) return json({ ok: false, error: 'Say where it came from (e.g. opening stock, bought for cash, returned from site).' }, 400);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM stk_moves WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const now = nowStr(), direct = MANAGERS.includes(req.user.role);
      const res = await env.DB.batch([
        env.DB.prepare("INSERT INTO stk_moves (project_id, item_id, kind, qty, status, note, by_user, client_uuid, created_at) VALUES (?, ?, 'receipt', ?, ?, ?, ?, ?, ?)")
          .bind(pid, itemId, q, direct ? 'posted' : 'pending', note, req.user.user_id, uuid, now),
        ...(direct ? [env.DB.prepare('INSERT INTO stk_balance (project_id, item_id, qty) VALUES (?, ?, ?) ON CONFLICT(project_id, item_id) DO UPDATE SET qty = qty + excluded.qty').bind(pid, itemId, q),
          audit(env, req.user, 'receive', null, `Stock received: ${fmt(q)} ${it.unit || ''} ${it.name} (${note})`)] : []),
      ]);
      if (!direct) await notifyRoles(env, ['pm', 'owner'], `Stock received to approve: ${it.name}`, `${req.user.name}: +${fmt(q)} ${it.unit || ''}. ${note.slice(0, 100)}`);
      return json({ ok: true, data: { id: res[0].meta.last_row_id, pending: !direct, on_hand: await onHand(env, pid, itemId) } });
    } catch (e) { return serverError(e, 'stk-receive'); }
  }));

  const decide = (approve) => (req, env) => withAuth(req, env, 'stores', 'A', async (req, env) => {
    try {
      const mv = await env.DB.prepare("SELECT * FROM stk_moves WHERE id = ? AND kind IN ('adjust', 'receipt')").bind(Number(req.params.id)).first();
      if (!mv || !(await projectOk(env, req, mv.project_id))) return json({ ok: false, error: 'Entry not found.' }, 404);
      if (mv.by_user === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve your own entry.' }, 403);
      const now = nowStr();
      if (!approve) {
        const r = await env.DB.prepare("UPDATE stk_moves SET status = 'rejected', approved_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").bind(req.user.user_id, now, mv.id).run();
        if (!r.meta.changes) return json({ ok: false, error: 'Already decided.' }, 409);
        return json({ ok: true });
      }
      if ((await onHand(env, mv.project_id, mv.item_id)) + mv.qty < -0.000001) return json({ ok: false, error: 'That would take the stock below zero. Check the count.' }, 400);
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE stk_moves SET status = 'posted', approved_by = ?1, decided_at = ?2 WHERE id = ?3 AND status = 'pending' AND (by_user != ?1 OR ?4 = 1)").bind(req.user.user_id, now, mv.id, req.user.role === 'owner' ? 1 : 0),
        env.DB.prepare("INSERT INTO stk_balance (project_id, item_id, qty) SELECT project_id, item_id, qty FROM stk_moves WHERE id = ?1 AND status = 'posted' AND approved_by = ?2 AND changes() > 0 ON CONFLICT(project_id, item_id) DO UPDATE SET qty = qty + excluded.qty").bind(mv.id, req.user.user_id),
        audit(env, req.user, 'approve', mv.id, `Stock ${mv.kind === 'receipt' ? 'receipt' : 'adjustment'} ${mv.qty} approved${mv.by_user === req.user.user_id ? ' (approved by Owner as maker)' : ''}`),
      ]);
      if (!res[0].meta.changes) return json({ ok: false, error: 'Already decided.' }, 409);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'stk-decide'); }
  });
  router.post('/api/stores/moves/:id/approve', decide(true));
  router.post('/api/stores/moves/:id/reject', decide(false));

  router.get('/api/stores/moves', async (req, env) => withAuth(req, env, 'stores', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const pid = Number(q.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const extra = []; const args = [pid];
      if (q.get('item_id')) { extra.push('m.item_id = ?'); args.push(Number(q.get('item_id'))); }
      if (q.get('status')) { extra.push('m.status = ?'); args.push(String(q.get('status'))); }
      const rows = (await env.DB.prepare(`SELECT m.id, m.kind, m.qty, m.status, m.where_used, m.note, m.created_at, m.to_project_id, i.name AS item, i.unit, u.name AS by_name
        FROM stk_moves m JOIN stk_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.by_user WHERE m.project_id = ?${extra.map((e) => ' AND ' + e).join('')} ORDER BY m.id DESC LIMIT 150`).bind(...args).all()).results;
      if (q.get('csv')) return csvResponse('stock-moves.csv', [['Date', 'Item', 'Kind', 'Qty', 'Unit', 'Status', 'Used for', 'Note', 'By'], ...rows.map((r) => [r.created_at, r.item, r.kind, fmt(r.qty), r.unit || '', r.status, r.where_used || '', r.note || '', r.by_name || ''])]);
      return json({ ok: true, data: { moves: rows } });
    } catch (e) { return serverError(e, 'stk-moves'); }
  }));
}
