// core/workqueue.js — one derived list of open work across every module.
// Read-only. The whole queue is one SQL statement (a UNION ALL of small indexed queries), so a request
// stays far below the free plan's 50-statement cap however many kinds the role may see.
// The project list travels as one JSON parameter, so a person on many projects does not hit the bound-parameter cap.
import { userCan as defaultUserCan } from './permissions.js';
import { todayIST } from './gates.js';

const GROUPS = {
  approvals: 'Approvals & compliance',
  site: 'Site & quality',
  procurement: 'Procurement',
  contractors: 'Contractors',
  collections: 'Collections',
  possession: 'Possession',
  meetings: 'Society meetings',
};

// kind: [group, label, route, can the assign endpoint put a person on it]
const KIND = {
  approval: ['approvals', 'Approval', 'approvals', true],
  step: ['approvals', 'Approval step', 'approvals', true],
  milestone: ['site', 'Milestone', 'site', true],
  snag: ['site', 'Snag', 'site', true],
  ncr: ['site', 'NCR', 'site', true],
  cube: ['site', 'Cube test', 'quality', false],
  dlp: ['site', 'DLP ticket', 'dlp', false],
  indent: ['procurement', 'Indent', 'procurement', false],
  po: ['procurement', 'Purchase order', 'procurement', false],
  grn: ['procurement', 'Receipt without photo', 'procurement', false],
  bill: ['procurement', 'Vendor bill', 'procurement', false],
  wo: ['contractors', 'Work order', 'contractors', false],
  variation: ['contractors', 'Variation', 'contractors', false],
  measurement: ['contractors', 'Measurement', 'contractors', false],
  ra: ['contractors', 'RA bill', 'contractors', false],
  debit_note: ['contractors', 'Debit note', 'contractors', false],
  receipt_request: ['collections', 'Receipt waiting', 'finance', false],
  hold_token: ['collections', 'Token to clear', 'sales', false],
  tds: ['collections', 'TDS to verify', 'finance', false],
  handover: ['possession', 'Handover', 'possession', false],
  meeting: ['meetings', 'Meeting action', 'redevelopment', true],
};

const day = (v) => (v ? String(v).slice(0, 10) : null);
const ageOf = (since, today) => {
  const d = day(since);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const n = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000);
  return Number.isFinite(n) ? Math.max(0, n) : null;
};
const bucketOf = (n) => (n == null ? 'unknown' : n <= 2 ? '0-2' : n <= 7 ? '3-7' : n <= 30 ? '8-30' : '30+');

export async function buildWorkQueue(env, user, ids, onlyPid = 0, mine = 0, can = defaultUserCan) {
  const P = (onlyPid ? [onlyPid] : (ids || [])).map(Number).filter((n) => n > 0);
  if (!P.length) return [];
  const projects = 'IN (SELECT value FROM json_each(?1))';
  const allow = (m, a = 'V') => !!(can && can(user, m, a));
  const allowAny = (m, actions) => actions.some((a) => allow(m, a));
  const m = (col) => (mine ? ` AND ${col} = ?2` : '');
  const specs = [];
  const add = (kind, sql) => specs.push({ kind, sql });

  if (allow('approvals')) {
    add('approval', `SELECT 'approval' AS kind, i.id, i.project_id, i.name AS title, i.status, i.target_date AS due,
      i.owner_user_id AS user_id, u.name AS in_charge, i.holder_designation AS detail,
      COALESCE(i.applied_on, i.created_at) AS since, COUNT(*) OVER () AS kind_total
      FROM apr_items i LEFT JOIN users u ON u.id = i.owner_user_id
      WHERE i.deleted_at IS NULL AND i.project_id ${projects}
        AND (i.status IN ('applied', 'query', 'in_progress') OR (i.status = 'not_started' AND (i.owner_user_id IS NOT NULL OR i.target_date IS NOT NULL)))${m('i.owner_user_id')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
    add('step', `SELECT 'step' AS kind, s.id, s.project_id, s.title || ' · ' || i.name AS title, s.status, s.target_date AS due,
      s.assigned_to AS user_id, u.name AS in_charge, s.responsible_designation AS detail,
      s.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM apr_steps s JOIN apr_items i ON i.id = s.item_id LEFT JOIN users u ON u.id = s.assigned_to
      WHERE s.deleted_at IS NULL AND s.project_id ${projects} AND s.status IN ('pending', 'in_progress')${m('s.assigned_to')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
  }

  if (allow('site')) {
    add('milestone', `SELECT 'milestone' AS kind, m.id, m.project_id, m.name || COALESCE(' · ' || m.wing, '') AS title, m.status,
      m.planned_date AS due, m.assigned_to AS user_id, u.name AS in_charge, NULL AS detail,
      m.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM site_milestones m LEFT JOIN users u ON u.id = m.assigned_to
      WHERE m.deleted_at IS NULL AND m.project_id ${projects} AND m.status != 'done'${m('m.assigned_to')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
    add('snag', `SELECT 'snag' AS kind, s.id, s.project_id, s.title, s.status, s.due_date AS due,
      s.assigned_to AS user_id, u.name AS in_charge, s.severity AS detail,
      s.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM site_snags s LEFT JOIN users u ON u.id = s.assigned_to
      WHERE s.deleted_at IS NULL AND s.project_id ${projects} AND s.status = 'open'${m('s.assigned_to')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
    add('ncr', `SELECT 'ncr' AS kind, q.id, q.project_id, q.title, q.status, q.due_date AS due,
      q.assigned_to AS user_id, u.name AS in_charge, q.source AS detail,
      q.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM qa_ncrs q LEFT JOIN users u ON u.id = q.assigned_to
      WHERE q.project_id ${projects} AND q.status = 'open'${m('q.assigned_to')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
    if (!mine) add('cube', `SELECT 'cube' AS kind, c.id, c.project_id, 'Cube test · ' || c.age_days || '-day' AS title, c.status,
      c.due_date AS due, NULL AS user_id, NULL AS in_charge, 'Pour #' || c.pour_id AS detail,
      c.due_date AS since, COUNT(*) OVER () AS kind_total
      FROM qa_cubes c
      WHERE c.project_id ${projects} AND c.status = 'pending'
      ORDER BY since IS NULL, since LIMIT 50`);
    add('dlp', `SELECT 'dlp' AS kind, t.id, t.project_id, t.title, t.status, t.sla_due_on AS due,
      t.created_by AS user_id, u.name AS in_charge, t.category AS detail,
      COALESCE(t.raised_on, t.created_at) AS since, COUNT(*) OVER () AS kind_total
      FROM dlp_tickets t LEFT JOIN users u ON u.id = t.created_by
      WHERE t.deleted_at IS NULL AND t.project_id ${projects}
        AND t.status IN ('open', 'assigned', 'fixed')${m('t.created_by')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
  }

  if (allow('redevelopment')) {
    add('meeting', `SELECT 'meeting' AS kind, mt.id, so.project_id, mt.next_action AS title, 'pending' AS status,
      mt.next_action_due AS due, mt.next_action_owner AS user_id, u.name AS in_charge, so.name AS detail,
      mt.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM red_meetings mt JOIN red_societies so ON so.id = mt.society_id LEFT JOIN users u ON u.id = mt.next_action_owner
      WHERE mt.deleted_at IS NULL AND so.deleted_at IS NULL AND so.project_id ${projects}
        AND mt.next_action_done = 0 AND COALESCE(mt.next_action, '') != ''${m('mt.next_action_owner')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
  }

  if (allowAny('procurement', ['V', 'C'])) {
    add('indent', `SELECT 'indent' AS kind, i.id, i.project_id, 'Indent ' || i.indent_no AS title, i.status,
      i.needed_by AS due, i.requested_by AS user_id, u.name AS in_charge, i.note AS detail,
      i.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM pro_indents i LEFT JOIN users u ON u.id = i.requested_by
      WHERE i.deleted_at IS NULL AND i.project_id ${projects} AND i.status = 'submitted'${m('i.requested_by')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
    add('grn', `SELECT 'grn' AS kind, g.id, p.project_id, 'Receipt ' || COALESCE(g.challan_no, '#' || g.id) || ' · ' || p.po_no AS title,
      'missing_photo' AS status, NULL AS due, g.received_by AS user_id, u.name AS in_charge, g.qty_note AS detail,
      g.received_on AS since, COUNT(*) OVER () AS kind_total
      FROM pro_grns g JOIN pro_pos p ON p.id = g.po_id LEFT JOIN users u ON u.id = g.received_by
      WHERE g.deleted_at IS NULL AND p.deleted_at IS NULL AND p.project_id ${projects}
        AND g.document_id IS NULL${m('g.received_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
  }

  if (allow('procurement')) {
    add('po', `SELECT 'po' AS kind, p.id, p.project_id, 'PO ' || p.po_no AS title, p.status,
      NULL AS due, p.created_by AS user_id, u.name AS in_charge, NULL AS detail,
      p.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM pro_pos p LEFT JOIN users u ON u.id = p.created_by
      WHERE p.deleted_at IS NULL AND p.project_id ${projects} AND p.status = 'pending_approval'${m('p.created_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
    add('bill', `SELECT 'bill' AS kind, b.id, COALESCE(b.project_id, p.project_id) AS project_id,
      'Bill ' || COALESCE(b.bill_no, '#' || b.id) AS title, b.status, b.due_date AS due,
      b.created_by AS user_id, u.name AS in_charge, b.hold_reason AS detail,
      b.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM pro_bills b LEFT JOIN pro_pos p ON p.id = b.po_id LEFT JOIN users u ON u.id = b.created_by
      WHERE COALESCE(b.project_id, p.project_id) ${projects}
        AND ((b.hold_reason IS NOT NULL AND b.released_at IS NULL) OR b.status IN ('received', 'approved', 'part_paid'))${m('b.created_by')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
  }

  if (allow('contractors')) {
    add('wo', `SELECT 'wo' AS kind, w.id, w.project_id, 'Work order ' || w.wo_no AS title, w.status,
      NULL AS due, w.created_by AS user_id, u.name AS in_charge, w.scope AS detail,
      w.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM con_work_orders w LEFT JOIN users u ON u.id = w.created_by
      WHERE w.project_id ${projects} AND w.status = 'pending_approval'${m('w.created_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
    add('variation', `SELECT 'variation' AS kind, v.id, w.project_id, 'Variation · ' || v.description AS title, v.status,
      NULL AS due, v.created_by AS user_id, u.name AS in_charge, w.wo_no AS detail,
      v.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM con_variations v JOIN con_work_orders w ON w.id = v.wo_id LEFT JOIN users u ON u.id = v.created_by
      WHERE w.project_id ${projects} AND v.status = 'pending'${m('v.created_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
    add('measurement', `SELECT 'measurement' AS kind, m.id, w.project_id, 'Measurement · ' || m.location AS title, m.status,
      NULL AS due, m.measured_by AS user_id, u.name AS in_charge, w.wo_no AS detail,
      m.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM con_measurements m JOIN con_work_orders w ON w.id = m.wo_id LEFT JOIN users u ON u.id = m.measured_by
      WHERE w.project_id ${projects} AND m.status = 'pending'${m('m.measured_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
    add('ra', `SELECT 'ra' AS kind, r.id, w.project_id, 'RA bill ' || r.ra_no || ' · ' || w.wo_no AS title, r.status,
      r.due_date AS due, r.created_by AS user_id, u.name AS in_charge, w.scope AS detail,
      r.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id LEFT JOIN users u ON u.id = r.created_by
      WHERE w.project_id ${projects} AND r.status IN ('draft', 'checked')${m('r.created_by')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
    add('debit_note', `SELECT 'debit_note' AS kind, d.id, w.project_id, 'Debit note · ' || d.description AS title, d.status,
      NULL AS due, d.created_by AS user_id, u.name AS in_charge, w.wo_no AS detail,
      d.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM con_debit_notes d JOIN con_work_orders w ON w.id = d.wo_id LEFT JOIN users u ON u.id = d.created_by
      WHERE w.project_id ${projects} AND d.status = 'pending'${m('d.created_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
  }

  if (allow('sales')) {
    add('receipt_request', `SELECT 'receipt_request' AS kind, rr.id, b.project_id,
      'Receipt · ' || b.customer_name AS title, rr.status, NULL AS due,
      rr.requested_by AS user_id, u.name AS in_charge,
      '₹' || CAST(rr.amount_paise / 100 AS TEXT) AS detail,
      rr.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM sal_receipt_requests rr JOIN sal_bookings b ON b.id = rr.booking_id LEFT JOIN users u ON u.id = rr.requested_by
      WHERE b.deleted_at IS NULL AND b.project_id ${projects} AND rr.status = 'pending'${m('rr.requested_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
    add('hold_token', `SELECT 'hold_token' AS kind, t.id, i.project_id,
      'Token · ' || i.unit_no AS title, t.status, NULL AS due,
      t.held_by AS user_id, u.name AS in_charge,
      '₹' || CAST(t.amount_paise / 100 AS TEXT) AS detail,
      COALESCE(t.hold_at, t.created_at) AS since, COUNT(*) OVER () AS kind_total
      FROM sal_hold_tokens t JOIN sal_inventory i ON i.id = t.unit_id LEFT JOIN users u ON u.id = t.held_by
      WHERE i.deleted_at IS NULL AND i.project_id ${projects} AND t.status = 'pending'${m('t.held_by')}
      ORDER BY since IS NULL, since LIMIT 50`);
    if (!mine) add('tds', `SELECT 'tds' AS kind, t.id, b.project_id,
      'TDS · ' || b.customer_name AS title, t.status, NULL AS due,
      NULL AS user_id, NULL AS in_charge,
      '₹' || CAST(t.amount_paise / 100 AS TEXT) AS detail,
      t.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM sal_tds_credits t JOIN sal_bookings b ON b.id = t.booking_id
      WHERE b.deleted_at IS NULL AND b.project_id ${projects} AND t.status = 'pending'
      ORDER BY since IS NULL, since LIMIT 50`);
    add('handover', `SELECT 'handover' AS kind, h.id, b.project_id,
      'Handover · ' || b.customer_name AS title, h.status,
      h.possession_offered_on AS due, h.opened_by AS user_id, u.name AS in_charge,
      b.customer_name AS detail,
      h.created_at AS since, COUNT(*) OVER () AS kind_total
      FROM sal_handover h JOIN sal_bookings b ON b.id = h.booking_id LEFT JOIN users u ON u.id = h.opened_by
      WHERE b.deleted_at IS NULL AND b.project_id ${projects} AND h.status = 'in_progress'${m('h.opened_by')}
      ORDER BY since IS NULL, since, due IS NULL, due LIMIT 50`);
  }

  if (!specs.length) return [];
  const sql = specs.map((s) => `SELECT * FROM (${s.sql})`).join(' UNION ALL ');
  const binds = mine && sql.includes('?2') ? [JSON.stringify(P), mine] : [JSON.stringify(P)];
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  const today = todayIST();
  for (const t of rows) {
    const meta = KIND[t.kind] || ['site', t.kind, 'site', false];
    t.group_key = meta[0];
    t.group = GROUPS[meta[0]] || meta[0];
    t.label = meta[1];
    t.route = meta[2];
    t.assignable = !!meta[3];
    t.kind_total = Number(t.kind_total) || 0;
    t.since = day(t.since);
    t.due = day(t.due);
    t.age_days = ageOf(t.since, today);
    t.age_bucket = bucketOf(t.age_days);
    t.late = !!(t.due && t.due < today);
    if (t.user_id != null) t.user_id = Number(t.user_id);
  }
  rows.sort((a, b) => {
    const ax = a.since || '9999-12-31', bx = b.since || '9999-12-31';
    if (ax !== bx) return ax < bx ? -1 : 1;
    const ad = a.due || '9999-12-31', bd = b.due || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  return rows;
}

// Role-aware groups for My Work: full count, oldest age, and the oldest five items in each group.
export function summarizeQueue(tasks) {
  const groups = [];
  const by = new Map();
  for (const t of tasks) {
    let g = by.get(t.group_key);
    if (!g) { g = { key: t.group_key, label: t.group, count: 0, oldest_days: t.age_days || 0, tasks: [] }; by.set(t.group_key, g); groups.push(g); }
    if (g.tasks.length < 5) g.tasks.push(t);
  }
  for (const g of groups) {
    const kinds = new Map();
    for (const t of tasks) if (t.group_key === g.key && !kinds.has(t.kind)) kinds.set(t.kind, t.kind_total);
    g.count = [...kinds.values()].reduce((a, b) => a + b, 0);
  }
  return { groups, total: groups.reduce((a, g) => a + g.count, 0), oldest_days: tasks.length ? tasks[0].age_days : null };
}
