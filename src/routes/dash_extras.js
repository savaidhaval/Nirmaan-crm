// routes/dash_extras.js — WP-20: extra drill-down lines for the dashboard (not new tiles) and a pack of CSV reports.
// Free-plan budget: the lines come from about a dozen small aggregate queries; the budget-over line is read from a snapshot the hourly sweep
// refreshes one project at a time, because working it out live needs several queries per project. Modules that are off add nothing and cause no error.

import { budgetOverview } from './budget.js';

const rupees = (p) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');
const f2 = (p) => (Number(p) / 100).toFixed(2);

// Hourly: refresh the budget status of the one project whose snapshot is oldest (5 or so statements).
export async function dashSnapshotSweep(env, getSetting) {
  const p = await env.DB.prepare(`SELECT h.project_id AS id FROM (SELECT DISTINCT project_id FROM bud_heads WHERE deleted_at IS NULL) h JOIN projects pr ON pr.id = h.project_id AND pr.deleted_at IS NULL AND COALESCE(pr.status, '') NOT IN ('archived', 'completed')
    LEFT JOIN dash_snapshot s ON s.key = 'budget:' || h.project_id ORDER BY COALESCE(s.updated_at, '') ASC LIMIT 1`).first();
  if (!p) return;
  const ov = await budgetOverview(env, getSetting, p.id);
  const over = ov.rows.filter((r) => r.level === 'over'), near = ov.rows.filter((r) => r.level === 'near');
  await env.DB.prepare("INSERT INTO dash_snapshot (key, value_json, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json = ?2, updated_at = datetime('now')")
    .bind('budget:' + p.id, JSON.stringify({ over: over.length, near: near.length, names: over.slice(0, 3).map((r) => r.name) })).run();
}

export function registerDashExtras(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, csvBom } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const csv = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });

  router.get('/api/dashboard/extras', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      const role = req.user.role; const ids = await visibleProjectIds(env, req.user); const J = JSON.stringify(ids);
      const money = ['owner', 'pm', 'accounts'].includes(role), mgr = ['owner', 'pm'].includes(role);
      if (!ids.length) return json({ ok: true, data: { groups: [] } });
      const conOn = (await getSetting(env, 'con.enabled')) === 'on';
      const pct = Math.round(Number(await getSetting(env, 'rera.designated_pct_bp')) || 7000);
      const q = (sql, ...b) => env.DB.prepare(sql).bind(J, ...b);
      const jobs = {};
      if (mgr || role === 'viewer') {
        jobs.soc = q(`SELECT s.name, s.consent_threshold_bp AS th, s.count_basis AS basis, COUNT(m.id) AS total, COALESCE(SUM(m.consent_status = 'consented'), 0) AS ok, COALESCE(SUM(m.carpet_sqft), 0) AS at, COALESCE(SUM(CASE WHEN m.consent_status = 'consented' THEN m.carpet_sqft END), 0) AS ao
          FROM red_societies s LEFT JOIN red_members m ON m.society_id = s.id AND m.deleted_at IS NULL WHERE s.deleted_at IS NULL AND s.project_id IN (SELECT value FROM json_each(?1)) GROUP BY s.id LIMIT 60`).all();
        jobs.bg = q("SELECT COUNT(*) AS n FROM red_transit_terms t JOIN red_members m ON m.id = t.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL WHERE s.project_id IN (SELECT value FROM json_each(?1)) AND t.bg_expiry BETWEEN date('now') AND date('now', '+30 days')").first();
      }
      if (money) {
        if (conOn) jobs.ra = q(`SELECT COALESCE(SUM(r.status IN ('draft', 'checked')), 0) AS wait_n, COALESCE(SUM(CASE WHEN r.status IN ('draft', 'checked') THEN r.net_paise END), 0) AS wait_p, COALESCE(SUM(CASE WHEN r.status IN ('approved', 'part_paid', 'paid') THEN r.retention_paise END), 0) AS ret
          FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id WHERE w.project_id IN (SELECT value FROM json_each(?1))`).first();
        jobs.bud = env.DB.prepare("SELECT key, value_json FROM dash_snapshot WHERE key LIKE 'budget:%' LIMIT 100").all();
        jobs.rent = q(`SELECT COUNT(*) AS n, COALESCE(SUM(r.due_paise - COALESCE((SELECT SUM(p.amount_paise) FROM red_transit_payments p WHERE p.schedule_id = r.id AND p.reversed_at IS NULL), 0)), 0) AS p
          FROM red_transit_schedule r JOIN red_members m ON m.id = r.member_id AND m.deleted_at IS NULL JOIN red_societies s ON s.id = m.society_id AND s.deleted_at IS NULL
          WHERE s.project_id IN (SELECT value FROM json_each(?1)) AND r.due_on < date('now') AND r.due_paise > COALESCE((SELECT SUM(p.amount_paise) FROM red_transit_payments p WHERE p.schedule_id = r.id AND p.reversed_at IS NULL), 0)`).first();
        jobs.rq = q("SELECT COUNT(*) AS n, COALESCE(SUM(q.amount_paise + q.tds_paise), 0) AS p FROM sal_receipt_requests q JOIN sal_bookings b ON b.id = q.booking_id WHERE q.status = 'pending' AND b.project_id IN (SELECT value FROM json_each(?1))").first();
        jobs.rera = q(`SELECT COALESCE(SUM(CASE WHEN g > 0 THEN g ELSE 0 END), 0) AS gap FROM (SELECT (COALESCE((SELECT SUM(r.amount_paise + r.tds_paise) FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE b.project_id = p.id AND r.reversed_at IS NULL AND r.kind = 'principal'), 0) * ?2 / 10000)
          - COALESCE((SELECT SUM(e.amount_paise) FROM rera_account_entries e WHERE e.project_id = p.id AND e.kind = 'deposit' AND e.reversed_at IS NULL), 0) AS g FROM projects p WHERE p.deleted_at IS NULL AND p.id IN (SELECT value FROM json_each(?1)))`, pct).first();
      }
      if (mgr || role === 'purchase' || role === 'accounts') {
        jobs.low = q("SELECT COUNT(*) AS n FROM stk_balance b JOIN stk_items i ON i.id = b.item_id AND i.active = 1 WHERE b.reorder_level > 0 AND b.qty <= b.reorder_level AND b.project_id IN (SELECT value FROM json_each(?1))").first();
        jobs.ind = q("SELECT COUNT(*) AS n FROM pro_indents WHERE status = 'submitted' AND deleted_at IS NULL AND project_id IN (SELECT value FROM json_each(?1))").first();
      }
      if (mgr || role === 'accounts') {
        jobs.ho = q("SELECT COUNT(*) AS n FROM sal_handover h JOIN sal_bookings b ON b.id = h.booking_id WHERE h.status = 'in_progress' AND b.project_id IN (SELECT value FROM json_each(?1))").first();
        jobs.vb = q("SELECT COUNT(DISTINCT l.id) AS visited, COUNT(DISTINCT CASE WHEN l.status = 'booked' THEN l.id END) AS booked FROM sal_visits v JOIN sal_leads l ON l.id = v.lead_id WHERE v.status = 'done' AND v.deleted_at IS NULL AND l.deleted_at IS NULL AND l.project_id IN (SELECT value FROM json_each(?1))").first();
      }
      const keys = Object.keys(jobs); const res = await Promise.all(keys.map((k) => jobs[k])); const r = {}; keys.forEach((k, i) => { r[k] = res[i]; });
      const groups = []; const add = (tile, lines) => { const l = lines.filter(Boolean); if (l.length) groups.push({ tile, lines: l }); };
      const line = (label, value, route, tone = '') => ({ label, value, route, tone });
      // Approvals and compliance
      add('Approvals', [
        r.soc && r.soc.results.length ? (() => { const rows = r.soc.results.map((s) => { const a = s.basis === 'area' && s.at > 0; return { name: s.name, pct: s.total ? Math.round(((a ? s.ao : s.ok) * 1000) / (a ? s.at : s.total)) / 10 : 0, th: s.th / 100, total: s.total }; }).filter((s) => s.total); const below = rows.filter((s) => s.pct < s.th).sort((a, b) => a.pct - b.pct);
          return line(below.length ? `${below.length} of ${rows.length} societies are below the consent threshold (lowest: ${below[0].name}, ${below[0].pct}%)` : `All ${rows.length} societies have reached the consent threshold`, '', 'redevelopment', below.length ? 'warn' : 'good'); })() : null,
        r.bg && r.bg.n ? line('Bank guarantees expiring within 30 days', String(r.bg.n), 'redevelopment', 'bad') : null,
      ]);
      // Money in
      add('Money in', [
        r.rent && r.rent.n ? line(`Transit rent overdue (${r.rent.n} month${r.rent.n > 1 ? 's' : ''})`, rupees(r.rent.p), 'redevelopment', 'bad') : null,
        r.rq && r.rq.n ? line('Receipts waiting for a second person', `${r.rq.n} · ${rupees(r.rq.p)}`, 'sales', 'warn') : null,
        r.rera && r.rera.gap > 0 ? line('Still to deposit in the RERA accounts', rupees(r.rera.gap), 'rera', 'bad') : null,
      ]);
      // Money out
      const snaps = (r.bud ? r.bud.results : []).filter((x) => ids.includes(Number(x.key.split(':')[1]))).map((x) => { try { return JSON.parse(x.value_json); } catch (e) { return { over: 0, near: 0, names: [] }; } });
      const over = snaps.reduce((s, x) => s + x.over, 0), names = snaps.flatMap((x) => x.names).slice(0, 3);
      add('Money out', [
        r.ra && r.ra.wait_n ? line('Contractor bills waiting for approval', `${r.ra.wait_n} · ${rupees(r.ra.wait_p)}`, 'contractors', 'warn') : null,
        r.ra && r.ra.ret ? line('Retention being held from contractors', rupees(r.ra.ret), 'contractors', '') : null,
        snaps.length ? line(over ? `Budget heads over their budget: ${names.join(', ')}${over > names.length ? ' and more' : ''}` : 'No budget head is over its budget', over ? String(over) : '', 'budget', over ? 'bad' : 'good') : null,
      ]);
      // Site
      add('Site', [
        r.low && r.low.n ? line('Store items at or below their reorder level', String(r.low.n), 'stores', 'warn') : null,
        r.ind && r.ind.n ? line('Material requests waiting for approval', String(r.ind.n), 'procurement', 'warn') : null,
      ]);
      // Sales
      add('Sales', [
        r.ho && r.ho.n ? line('Handovers in progress', String(r.ho.n), 'sales', '') : null,
        r.vb && r.vb.visited ? line(`Visits that turned into bookings: ${r.vb.booked} of ${r.vb.visited}`, `${Math.round((r.vb.booked * 1000) / r.vb.visited) / 10}%`, 'sales', '') : null,
      ]);
      return json({ ok: true, data: { groups } });
    } catch (e) { return serverError(e, 'dash-extras'); }
  }));

  // ---------- reports pack (CSV with BOM). Owner, PM and Accounts. ----------
  const REPORTS = {
    contractor_ledger: { name: 'contractor-ledger.csv', head: ['Contractor', 'Work order', 'Project', 'Date', 'Entry', 'Reference', 'Bill (net payable)', 'Paid'], needsCon: true,
      sql: `SELECT c.name AS a, w.wo_no AS b, pr.name AS c, substr(COALESCE(r.approved_at, r.created_at), 1, 10) AS d, 'Running bill ' || r.ra_no AS e, '' AS f, r.net_paise AS g, 0 AS h FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id JOIN con_contractors c ON c.id = w.contractor_id JOIN projects pr ON pr.id = w.project_id WHERE r.status IN ('approved', 'part_paid', 'paid') AND w.project_id IN (SELECT value FROM json_each(?1))
        UNION ALL SELECT c.name, w.wo_no, pr.name, p.paid_on, CASE p.kind WHEN 'advance' THEN 'Advance paid' ELSE 'Payment' END, COALESCE(p.ref_no, ''), 0, p.amount_paise FROM con_payments p JOIN con_work_orders w ON w.id = p.wo_id JOIN con_contractors c ON c.id = w.contractor_id JOIN projects pr ON pr.id = w.project_id WHERE p.reversed_at IS NULL AND w.project_id IN (SELECT value FROM json_each(?1))
        ORDER BY 1, 2, 4 LIMIT 5000`, money: [6, 7] },
    wo_summary: { name: 'work-orders-value-billed-paid.csv', head: ['Work order', 'Contractor', 'Project', 'Status', 'Order value', 'Billed (gross)', 'Retention held', 'Paid (incl. advance)'], needsCon: true,
      sql: `SELECT w.wo_no AS a, c.name AS b, pr.name AS c, w.status AS d, w.value_paise AS e,
          COALESCE((SELECT SUM(r.gross_paise) FROM con_ra_bills r WHERE r.wo_id = w.id AND r.status IN ('approved', 'part_paid', 'paid')), 0) AS f,
          COALESCE((SELECT SUM(r.retention_paise) FROM con_ra_bills r WHERE r.wo_id = w.id AND r.status IN ('approved', 'part_paid', 'paid')), 0) AS g,
          COALESCE((SELECT SUM(p.amount_paise) FROM con_payments p WHERE p.wo_id = w.id AND p.reversed_at IS NULL), 0) AS h
        FROM con_work_orders w JOIN con_contractors c ON c.id = w.contractor_id JOIN projects pr ON pr.id = w.project_id WHERE w.project_id IN (SELECT value FROM json_each(?1)) ORDER BY pr.name, w.wo_no LIMIT 3000`, money: [4, 5, 6, 7] },
    stock_on_hand: { name: 'stock-on-hand.csv', head: ['Project', 'Item', 'Unit', 'Quantity', 'Reorder level', 'Status', '', ''],
      sql: `SELECT pr.name AS a, i.name AS b, COALESCE(i.unit, '') AS c, b.qty AS d, b.reorder_level AS e, CASE WHEN b.reorder_level > 0 AND b.qty <= b.reorder_level THEN 'LOW' ELSE 'ok' END AS f, '' AS g, '' AS h FROM stk_balance b JOIN stk_items i ON i.id = b.item_id JOIN projects pr ON pr.id = b.project_id
        WHERE i.active = 1 AND b.project_id IN (SELECT value FROM json_each(?1)) ORDER BY pr.name, i.name LIMIT 5000`, money: [] },
    collections_by_month: { name: 'collections-by-month.csv', head: ['Month', 'Project', 'Receipts', 'Received', 'TDS deducted', '', '', ''],
      sql: `SELECT strftime('%Y-%m', r.received_on) AS a, pr.name AS b, COUNT(*) AS c, SUM(r.amount_paise) AS d, SUM(r.tds_paise) AS e, '' AS f, '' AS g, '' AS h FROM sal_receipts r JOIN sal_bookings bk ON bk.id = r.booking_id JOIN projects pr ON pr.id = bk.project_id
        WHERE r.reversed_at IS NULL AND r.kind = 'principal' AND bk.project_id IN (SELECT value FROM json_each(?1)) GROUP BY a, pr.id ORDER BY a DESC, pr.name LIMIT 2000`, money: [3, 4] },
    discount_register: { name: 'discount-register.csv', head: ['Booked on', 'Project', 'Flat', 'Customer', 'Rate card price', 'Agreed price', 'Discount', 'Reason / approved by'],
      sql: `SELECT substr(b.created_at, 1, 10) AS a, pr.name AS b, COALESCE(i.wing || '-', '') || i.unit_no AS c, b.customer_name AS d, b.list_price_paise AS e, b.agreed_price_paise AS f, b.list_price_paise - b.agreed_price_paise AS g, COALESCE(b.discount_reason, '') || CASE WHEN u.name IS NOT NULL THEN ' (approved by ' || u.name || ')' ELSE '' END AS h
        FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id LEFT JOIN users u ON u.id = b.approved_by
        WHERE b.deleted_at IS NULL AND b.list_price_paise IS NOT NULL AND b.list_price_paise > b.agreed_price_paise AND b.project_id IN (SELECT value FROM json_each(?1)) ORDER BY b.created_at DESC LIMIT 3000`, money: [4, 5, 6] },
  };
  router.get('/api/reports/pack/:kind', async (req, env) => withAuth(req, env, 'reports', 'X', async (req, env) => {
    try {
      const rep = REPORTS[req.params.kind]; if (!rep) return bad('Unknown report.', 404);
      if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return bad('Not allowed.', 403);
      const ids = await visibleProjectIds(env, req.user);
      if (rep.needsCon && (await getSetting(env, 'con.enabled')) !== 'on') return bad('Contractors is switched off, so this report is empty.', 409);
      const rows = ids.length ? (await env.DB.prepare(rep.sql).bind(JSON.stringify(ids)).all()).results : [];
      const body = rows.map((r) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k, i) => (rep.money.includes(i) ? f2(r[k] || 0) : (r[k] ?? ''))));
      return csv(rep.name, [rep.head, ...body]);
    } catch (e) { return serverError(e, 'report-pack'); }
  }));
  router.get('/api/reports/pack', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return bad('Not allowed.', 403);
    return json({ ok: true, data: { reports: [['contractor_ledger', 'Contractor ledger (bills and payments)'], ['wo_summary', 'Work orders: value, billed and paid'], ['stock_on_hand', 'Stock on hand'], ['collections_by_month', 'Collections by month'], ['discount_register', 'Discount register']].map(([key, label]) => ({ key, label })) } });
  }));
}
