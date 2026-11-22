// routes/ai_facts.js — read-only fact gathering for the AI assistant (a reporting layer, like reports.js and the dashboard).
// Every topic checks the asker's permission and project access first, returns short plain lines, and never includes phone numbers,
// emails, PAN, Aadhaar, bank details or file contents. The model only ever sees these lines.
import { budgetOverview } from './budget.js';

const rupees = (p) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');
const day = (s) => String(s || '').substring(0, 10);
const inList = (ids) => { const l = ids.slice(0, 90); return { sql: l.map(() => '?').join(','), args: l }; };
const istDate = (offsetDays = 0) => new Date(Date.now() + 19800000 + offsetDays * 86400000).toISOString().substring(0, 10);

// topic key -> { words, label, module, roles?, build(env, ctx) -> string[] }
export const TOPICS = {
  bills_due: {
    label: 'vendor bills due', words: /\b(bill|bills|payable|vendor payment|pay(ing)? vendors?|invoices?)\b/i, module: 'procurement', not: ['site'],
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const rows = (await env.DB.prepare(`SELECT v.name AS vendor, b.bill_no, b.due_date, b.amount_paise - b.tds_paise - COALESCE((SELECT SUM(x.amount_paise) FROM pro_payments x WHERE x.bill_id = b.id AND x.reversed_at IS NULL), 0) AS due
        FROM pro_bills b JOIN pro_vendors v ON v.id = b.vendor_id WHERE b.project_id IN (${sql}) AND b.status IN ('received', 'approved', 'part_paid') AND b.due_date IS NOT NULL AND b.due_date <= date('now', '+14 days')
        ORDER BY b.due_date LIMIT 12`).bind(...args).all()).results.filter((r) => r.due > 0);
      const total = rows.reduce((t, r) => t + r.due, 0);
      return [`Vendor bills due in the next 14 days or already overdue: ${rows.length} bills, ${rupees(total)} in total.`, ...rows.map((r) => `${r.vendor}, bill ${r.bill_no || '-'}, due ${day(r.due_date)}, ${rupees(r.due)} still to pay${r.due_date < istDate() ? ' (OVERDUE)' : ''}`)];
    },
  },
  receivables: {
    label: 'customer payments overdue', words: /\b(receivable|collections?|overdue|customers? (owe|due|pending)|demand|demands|outstanding|dues?)\b/i, module: 'sales', roles: ['owner', 'pm', 'accounts'],
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const rows = (await env.DB.prepare(`SELECT b.customer_name, i.unit_no, d.label, d.due_date, d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise AS due
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id
        WHERE b.project_id IN (${sql}) AND b.status != 'cancelled' AND d.status != 'scheduled' AND d.due_date < date('now') AND d.settled_paise < d.amount_paise + COALESCE(d.gst_paise, 0) ORDER BY due DESC LIMIT 12`).bind(...args).all()).results;
      const total = rows.reduce((t, r) => t + r.due, 0);
      return [`Overdue customer payments (largest ${rows.length} shown): ${rupees(total)} in total.`, ...rows.map((r) => `${r.customer_name}, flat ${r.unit_no}, ${r.label}, was due ${day(r.due_date)}, ${rupees(r.due)} outstanding`)];
    },
  },
  approvals: {
    label: 'approvals and permissions', words: /\b(approval|approvals|rera|noc|permission|permissions|licen[cs]e|sanction|plan|ward|commencement)\b/i, module: 'approvals',
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const rows = (await env.DB.prepare(`SELECT p.name AS project, a.name, a.status, a.valid_till FROM apr_items a JOIN projects p ON p.id = a.project_id
        WHERE a.project_id IN (${sql}) AND a.deleted_at IS NULL AND (a.status != 'approved' OR (a.valid_till IS NOT NULL AND a.valid_till <= date('now', '+60 days')))
        ORDER BY COALESCE(a.valid_till, '9999'), a.stage_order LIMIT 15`).bind(...args).all()).results;
      return [`Approvals not yet granted, or expiring within 60 days: ${rows.length} shown.`, ...rows.map((r) => `${r.project}: ${r.name}, status ${String(r.status || 'not started').replace(/_/g, ' ')}${r.valid_till ? ', valid till ' + day(r.valid_till) : ''}`)];
    },
  },
  budget: {
    label: 'budget by cost head', words: /\b(budget|over budget|cost head|committed|overrun|variance)\b/i, module: 'budget',
    async build(env, c) {
      const out = [];
      for (const pid of c.ids.slice(0, 4)) {
        const p = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(pid).first();
        const ov = await budgetOverview(env, c.getSetting, pid);
        if (!ov.rows.length) continue;
        out.push(`Project ${p.name}: budget ${rupees(ov.total.budget)}, committed ${rupees(ov.total.committed)}, billed ${rupees(ov.total.billed)}, paid ${rupees(ov.total.paid)} (figures ${ov.gst_basis} of GST).`);
        for (const r of ov.rows.filter((x) => x.level === 'over' || x.level === 'near')) out.push(`  ${r.name}: ${r.level_text}. Budget ${rupees(r.budget_paise)}, committed ${rupees(r.committed_paise)} (${(r.pct_used_bp / 100).toFixed(1)}%).`);
      }
      return out.length ? out : ['No budget heads have been set up yet.'];
    },
  },
  stock: {
    label: 'store and stock', words: /\b(stock|store|stores|material|reorder|low stock|cement|steel|sand|bags)\b/i, module: 'stores',
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const low = (await env.DB.prepare(`SELECT i.name, i.unit, p.name AS project, b.qty, b.reorder_level FROM stk_balance b JOIN stk_items i ON i.id = b.item_id JOIN projects p ON p.id = b.project_id
        WHERE b.project_id IN (${sql}) AND b.reorder_level > 0 AND b.qty <= b.reorder_level ORDER BY p.name, i.name LIMIT 12`).bind(...args).all()).results;
      const top = (await env.DB.prepare(`SELECT i.name, i.unit, p.name AS project, b.qty FROM stk_balance b JOIN stk_items i ON i.id = b.item_id JOIN projects p ON p.id = b.project_id
        WHERE b.project_id IN (${sql}) AND b.qty > 0 ORDER BY b.qty DESC LIMIT 10`).bind(...args).all()).results;
      return [`Items at or below their reorder level: ${low.length}.`, ...low.map((r) => `LOW: ${r.name} at ${r.project}: ${r.qty} ${r.unit || ''} left (reorder at ${r.reorder_level})`), 'Stock on hand (largest quantities):', ...top.map((r) => `${r.name} at ${r.project}: ${r.qty} ${r.unit || ''}`)];
    },
  },
  petty: {
    label: 'petty cash', words: /\b(petty|petty cash|cash in hand|float)\b/i, module: 'petty',
    async build(env, c) {
      let where = 'f.active = 1', args = [];
      if (c.user.role === 'site') { where += ' AND f.custodian_user_id = ?'; args = [c.user.user_id]; }
      else { const l = inList(c.ids); if (!l.sql) return []; where += ` AND f.project_id IN (${l.sql})`; args = l.args; }
      const rows = (await env.DB.prepare(`SELECT p.name AS project, u.name AS custodian,
          f.opening_paise + COALESCE(SUM(CASE WHEN e.status = 'approved' THEN CASE e.kind WHEN 'top_up' THEN e.amount_paise ELSE -e.amount_paise END END), 0) AS balance,
          COALESCE(SUM(CASE WHEN e.status = 'submitted' AND e.kind != 'top_up' THEN e.amount_paise END), 0) AS pending
        FROM pty_funds f JOIN projects p ON p.id = f.project_id LEFT JOIN users u ON u.id = f.custodian_user_id LEFT JOIN pty_entries e ON e.fund_id = f.id WHERE ${where} GROUP BY f.id LIMIT 15`).bind(...args).all()).results;
      return [`Petty-cash funds: ${rows.length}.`, ...rows.map((r) => `${r.project}, held by ${r.custodian}: ${rupees(r.balance)} in hand${r.pending ? `, ${rupees(r.pending)} waiting for approval` : ''}`)];
    },
  },
  contractors: {
    label: 'contractor payments', words: /\b(contractor|contractors|retention|ra bill|ra bills|work order|work orders|advance)\b/i, module: 'contractors', not: ['site'], needsContractors: true,
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const due = (await env.DB.prepare(`SELECT c.name, SUM(r.net_paise - COALESCE((SELECT SUM(x.amount_paise) FROM con_payments x WHERE x.ra_id = r.id AND x.kind = 'ra' AND x.reversed_at IS NULL), 0)) AS due
        FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id JOIN con_contractors c ON c.id = w.contractor_id WHERE w.project_id IN (${sql}) AND r.status IN ('approved', 'part_paid') GROUP BY c.id HAVING due > 0 ORDER BY due DESC LIMIT 10`).bind(...args).all()).results;
      const led = (await env.DB.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'retention_held' THEN amount_paise WHEN 'retention_released' THEN -amount_paise END), 0) AS retention,
          COALESCE(SUM(CASE kind WHEN 'advance' THEN amount_paise WHEN 'advance_recovery' THEN -amount_paise END), 0) AS advance FROM con_ledger WHERE project_id IN (${sql})`).bind(...args).first());
      const wait = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id WHERE w.project_id IN (${sql}) AND r.status IN ('draft', 'checked')`).bind(...args).first()).n;
      return [`Approved RA bills still to be paid, by contractor (top ${due.length}):`, ...due.map((r) => `${r.name}: ${rupees(r.due)}`), `Retention being held in total: ${rupees(led.retention)}. Advances not yet recovered: ${rupees(led.advance)}. RA bills waiting for check or approval: ${wait}.`];
    },
  },
  leads: {
    label: 'sales leads', words: /\b(lead|leads|follow.?ups?|enquir(y|ies)|prospects?|visits?|site visit)\b/i, module: 'sales',
    async build(env, c) {
      const l = inList(c.ids);
      const mine = c.seeAllLeads ? '' : ' AND l.assigned_to = ?';
      const scope = `(l.project_id IS NULL${l.sql ? ` OR l.project_id IN (${l.sql})` : ''})`;
      const base = [...l.args, ...(c.seeAllLeads ? [] : [c.user.user_id])];
      const overdue = (await env.DB.prepare(`SELECT l.name, l.status, l.next_followup_at, p.name AS project FROM sal_leads l LEFT JOIN projects p ON p.id = l.project_id
        WHERE l.deleted_at IS NULL AND l.status NOT IN ('booked', 'lost') AND l.next_followup_at IS NOT NULL AND l.next_followup_at < datetime('now') AND ${scope}${mine} ORDER BY l.next_followup_at LIMIT 12`).bind(...base).all()).results;
      const by = (await env.DB.prepare(`SELECT l.status, COUNT(*) AS n FROM sal_leads l WHERE l.deleted_at IS NULL AND ${scope}${mine} GROUP BY l.status`).bind(...base).all()).results;
      return [`Leads by stage: ${by.map((r) => `${String(r.status).replace(/_/g, ' ')} ${r.n}`).join(', ') || 'none'}.`, `Leads whose follow-up is overdue: ${overdue.length} shown.`,
        ...overdue.map((r) => `${r.name} (${String(r.status).replace(/_/g, ' ')}${r.project ? ', ' + r.project : ''}), follow-up was due ${day(r.next_followup_at)}`)];
    },
  },
  site: {
    label: 'site reports and snags', words: /\b(dpr|daily report|reports?|snag|snags|site|labour|progress)\b/i, module: 'site',
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const y = istDate(-1);
      const rows = (await env.DB.prepare(`SELECT p.name, (SELECT COUNT(*) FROM site_dprs d WHERE d.project_id = p.id AND d.report_date = ? AND d.deleted_at IS NULL) AS yesterday,
          (SELECT COUNT(*) FROM site_snags s WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.severity = 'high' AND s.status IN ('open', 'fixed')) AS high_snags,
          (SELECT COUNT(*) FROM site_snags s WHERE s.project_id = p.id AND s.deleted_at IS NULL AND s.status = 'open') AS open_snags
        FROM projects p WHERE p.id IN (${sql}) AND p.deleted_at IS NULL LIMIT 10`).bind(y, ...args).all()).results;
      return [`Site status for ${y}:`, ...rows.map((r) => `${r.name}: ${r.yesterday ? r.yesterday + ' daily report(s) filed' : 'NO daily report filed'}; ${r.open_snags} open snags, ${r.high_snags} of them high severity`)];
    },
  },
  documents: {
    label: 'contracts and documents expiring', words: /\b(contract|contracts|expir\w*|insurance|agreement|agreements|documents?)\b/i, module: 'procurement', roles: ['owner', 'pm', 'purchase', 'accounts'],
    async build(env) {
      const rows = (await env.DB.prepare(`SELECT party_label, doc_type, kind, valid_till FROM pro_party_docs WHERE deleted_at IS NULL AND superseded_by IS NULL AND valid_till IS NOT NULL AND valid_till <= date('now', '+45 days') ORDER BY valid_till LIMIT 12`).all()).results;
      return [`Contracts and documents expiring within 45 days or already expired: ${rows.length}.`, ...rows.map((r) => `${r.party_label}: ${r.doc_type} (${r.kind}), ${r.valid_till < istDate() ? 'EXPIRED on' : 'valid till'} ${day(r.valid_till)}`)];
    },
  },
  purchase: {
    label: 'purchase orders', words: /\b(po|pos|purchase order|purchase orders|indent|indents|procurement|supplier|suppliers)\b/i, module: 'procurement', not: ['site'],
    async build(env, c) {
      const { sql, args } = inList(c.ids); if (!sql) return [];
      const pend = (await env.DB.prepare(`SELECT p.po_no, v.name AS vendor, p.total_paise FROM pro_pos p JOIN pro_vendors v ON v.id = p.vendor_id WHERE p.project_id IN (${sql}) AND p.deleted_at IS NULL AND p.status = 'pending_approval' ORDER BY p.id DESC LIMIT 10`).bind(...args).all()).results;
      const open = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pro_pos WHERE project_id IN (${sql}) AND deleted_at IS NULL AND status IN ('approved', 'part_received')`).bind(...args).first()).n;
      const ind = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pro_indents WHERE project_id IN (${sql}) AND deleted_at IS NULL AND status IN ('submitted', 'approved')`).bind(...args).first()).n;
      return [`Purchase orders waiting for approval: ${pend.length}.`, ...pend.map((r) => `${r.po_no} to ${r.vendor}, ${rupees(r.total_paise)}`), `Approved purchase orders still receiving material: ${open}. Material requests (indents) not yet turned into an RFQ: ${ind}.`];
    },
  },
};

// Which topics does this question touch? (at most 3, in the order of the list above)
export function pickTopics(question) {
  return Object.entries(TOPICS).filter(([, t]) => t.words.test(question)).map(([k]) => k).slice(0, 3);
}

// Run the topics the asker is allowed to see. Returns { sections: [{key,label,lines}], blocked: [labels] }.
export async function gatherFacts(env, ctx, keys) {
  const sections = [], blocked = [];
  for (const k of keys) {
    const t = TOPICS[k];
    const allowed = ctx.userCan(ctx.user, t.module, 'V') && !(t.not || []).includes(ctx.user.role) && (!t.roles || t.roles.includes(ctx.user.role))
      && (!t.needsContractors || (await ctx.getSetting(env, 'con.enabled')) === 'on');
    if (!allowed) { blocked.push(t.label); continue; }
    sections.push({ key: k, label: t.label, lines: await t.build(env, ctx) });
  }
  return { sections, blocked };
}

// ---------- facts about one record, for drafts and summaries (no phone, email, PAN or bank details) ----------
export async function leadFacts(env, leadId) {
  const l = await env.DB.prepare(`SELECT l.id, l.name, l.status, l.source, l.budget_paise, l.config_pref, l.next_followup_at, l.last_contact_at, l.created_at, l.project_id, l.assigned_to, p.name AS project
    FROM sal_leads l LEFT JOIN projects p ON p.id = l.project_id WHERE l.id = ? AND l.deleted_at IS NULL`).bind(leadId).first();
  if (!l) return null;
  const acts = (await env.DB.prepare('SELECT type, outcome, note, created_at FROM sal_activities WHERE lead_id = ? ORDER BY id DESC LIMIT 10').bind(leadId).all()).results;
  const lines = [`Lead: ${l.name}. Stage: ${String(l.status).replace(/_/g, ' ')}. Source: ${l.source || 'unknown'}. Project: ${l.project || 'not chosen'}.`,
    `Looking for: ${l.config_pref || 'not recorded'}. Budget: ${l.budget_paise ? rupees(l.budget_paise) : 'not recorded'}.`,
    `First enquiry: ${day(l.created_at)}. Last contact: ${l.last_contact_at ? day(l.last_contact_at) : 'none yet'}. Next follow-up: ${l.next_followup_at ? day(l.next_followup_at) : 'not set'}.`,
    'Recent activity (newest first):', ...acts.map((a) => `${day(a.created_at)} ${a.type || ''}${a.outcome ? ' (' + a.outcome + ')' : ''}: ${String(a.note || '').slice(0, 160)}`)];
  return { lead: l, lines };
}

export async function demandFacts(env, demandId) {
  const d = await env.DB.prepare(`SELECT d.label, d.due_date, d.amount_paise, COALESCE(d.gst_paise, 0) AS gst_paise, d.settled_paise, b.project_id, b.customer_name, b.status AS booking_status, i.unit_no, i.wing, p.name AS project
    FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id WHERE d.id = ?`).bind(demandId).first();
  if (!d) return null;
  const due = d.amount_paise + d.gst_paise - d.settled_paise;
  const late = d.due_date ? Math.max(0, Math.round((Date.parse(istDate()) - Date.parse(day(d.due_date))) / 86400000)) : 0;
  return { demand: d, lines: [`Customer: ${d.customer_name}. Flat: ${d.wing ? d.wing + '-' : ''}${d.unit_no} in ${d.project}.`, `Payment stage: ${d.label}. Due date: ${d.due_date ? day(d.due_date) : 'not set'}.`,
    `Amount of this demand: ${rupees(d.amount_paise + d.gst_paise)}. Already received: ${rupees(d.settled_paise)}. Still to pay: ${rupees(due)}.`, late ? `Days past the due date: ${late}.` : 'Not yet past the due date.'] };
}

export async function vendorFacts(env, vendorId, poId) {
  const v = await env.DB.prepare('SELECT name, category FROM pro_vendors WHERE id = ? AND deleted_at IS NULL').bind(vendorId).first();
  if (!v) return null;
  const lines = [`Vendor: ${v.name}${v.category ? ' (supplies ' + v.category + ')' : ''}.`];
  let project_id = null;
  if (poId) {
    const p = await env.DB.prepare('SELECT po_no, status, total_paise, project_id, created_at FROM pro_pos WHERE id = ? AND vendor_id = ? AND deleted_at IS NULL').bind(poId, vendorId).first();
    if (p) { project_id = p.project_id; lines.push(`Purchase order ${p.po_no}, status ${String(p.status).replace(/_/g, ' ')}, value ${rupees(p.total_paise)}, raised ${day(p.created_at)}.`); }
  }
  return { vendor: v, project_id, lines };
}

export async function projectWeekFacts(env, c, projectId) {
  const p = await env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first();
  if (!p) return null;
  const since = istDate(-7);
  const lines = [`Project: ${p.name}. Period: ${since} to ${istDate()}.`];
  if (c.userCan(c.user, 'site', 'V')) {
    const dprs = (await env.DB.prepare('SELECT report_date, work_summary, labour_count, issues FROM site_dprs WHERE project_id = ? AND deleted_at IS NULL AND report_date >= ? ORDER BY report_date DESC LIMIT 7').bind(projectId, since).all()).results;
    lines.push(`Daily reports filed: ${dprs.length} of 7 days.`, ...dprs.map((d) => `${d.report_date}: ${String(d.work_summary || '').slice(0, 200)} (labour ${d.labour_count || 0})${d.issues ? ' Problems: ' + String(d.issues).slice(0, 120) : ''}`));
    const sn = (await env.DB.prepare("SELECT title, severity, status FROM site_snags WHERE project_id = ? AND deleted_at IS NULL AND status != 'verified' ORDER BY (severity = 'high') DESC, id DESC LIMIT 8").bind(projectId).all()).results;
    lines.push(`Open snags: ${sn.length} shown.`, ...sn.map((s) => `${s.severity}: ${String(s.title).slice(0, 100)} (${s.status})`));
  }
  if (c.userCan(c.user, 'budget', 'V')) {
    const ov = await budgetOverview(env, c.getSetting, projectId);
    for (const r of ov.rows.filter((x) => x.level === 'over' || x.level === 'near')) lines.push(`Budget: ${r.name} is ${r.level_text.toLowerCase()} (committed ${rupees(r.committed_paise)} of ${rupees(r.budget_paise)}).`);
  }
  if (c.userCan(c.user, 'procurement', 'V') && c.user.role !== 'site') {
    const po = (await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS s FROM pro_pos WHERE project_id = ? AND deleted_at IS NULL AND status IN ('approved', 'part_received', 'received') AND approved_at >= ?").bind(projectId, since).first());
    lines.push(`Purchase orders approved this week: ${po.n}, worth ${rupees(po.s)}.`);
  }
  return { project: p, lines };
}
