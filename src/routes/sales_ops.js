// routes/sales_ops.js — sales rules that protect money and inventory:
// atomic unit holds/bookings, lead protection, discount approval, receipt integrity, refunds, cost sheet, lead-intake webhook.
// D1 has no SELECT ... FOR UPDATE; every claim below is a single conditional UPDATE whose `changes` count decides the winner.
import { saleBlock, holdFor } from '../core/gates.js';

export const LEAD_TRANSITIONS = {
  new: ['contacted', 'interested', 'visit_scheduled', 'lost'],
  contacted: ['interested', 'visit_scheduled', 'negotiating', 'lost'],
  interested: ['visit_scheduled', 'negotiating', 'lost'],
  visit_scheduled: ['visited', 'interested', 'lost'],
  visited: ['negotiating', 'interested', 'visit_scheduled', 'lost'],
  negotiating: ['visit_scheduled', 'lost'],
  booked: [],                       // only the booking flow sets this; cancellation reopens via the Owner
  lost: ['interested'],             // reopening a lost lead is a manager action
};

export const phone10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const MANAGER = ['owner', 'pm'];

export const shared = {};   // createLead is shared with the CSV importer

export function registerSalesOps(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, userCan, getSetting, nowStr, encryptSetting, clientIp, checkRateLimit } = h;

  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();

  async function num(env, key, dflt) { const v = Number(await getSetting(env, key)); return Number.isFinite(v) && v > 0 ? v : dflt; }

  // Least-loaded active sales user (round robin by open leads)
  async function pickAssignee(env) {
    const r = await env.DB.prepare(`SELECT u.id, (SELECT COUNT(*) FROM sal_leads l WHERE l.assigned_to = u.id AND l.deleted_at IS NULL AND l.status NOT IN ('booked','lost')) AS open_leads
      FROM users u WHERE u.role = 'sales' AND u.active = 1 AND u.deleted_at IS NULL ORDER BY open_leads, u.id LIMIT 1`).first();
    return r ? r.id : null;
  }

  async function createLead(env, user, b, { systemSource } = {}) {
    const name = String(b.name || '').trim().slice(0, 120);
    const norm = phone10(b.phone);
    if (!name) return { status: 400, error: 'Name is required.' };
    if (norm.length !== 10) return { status: 400, error: 'Enter a 10-digit mobile number.' };
    const projectId = b.project_id ? Number(b.project_id) : null;
    if (projectId && user && !(await visibleProjectIds(env, user)).includes(projectId)) return { status: 403, error: 'Not allowed.' };
    const partnerId = b.channel_partner_id ? Number(b.channel_partner_id) : null;
    // Lead protection: the first registration wins, whatever formatting the number comes in ("+91 98200 12345" = "09820012345").
    const dup = await env.DB.prepare('SELECT l.id, l.name, l.created_at, l.channel_partner_id, p.firm FROM sal_leads l LEFT JOIN sal_partners p ON p.id = l.channel_partner_id WHERE l.phone_norm = ? AND l.deleted_at IS NULL ORDER BY l.id LIMIT 1').bind(norm).first();
    if (dup) {
      const who = dup.firm ? `channel partner ${dup.firm}` : 'our direct team';
      return { status: 409, error: `This mobile number is already registered (${dup.name}) by ${who} on ${String(dup.created_at).substring(0, 10)}.`, duplicate: dup.id };
    }
    if (partnerId && !(await env.DB.prepare('SELECT id FROM sal_partners WHERE id = ? AND deleted_at IS NULL AND active = 1').bind(partnerId).first())) return { status: 400, error: 'Unknown channel partner.' };
    const assignee = user && user.role === 'sales' ? user.user_id : await pickAssignee(env);
    const now = nowStr();
    const r = await env.DB.prepare(`INSERT INTO sal_leads (project_id, name, phone, phone_norm, email, source, source_detail, budget_paise, config_pref, status, assigned_to, consent, consent_at, notes, channel_partner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`)
      .bind(projectId, name, String(b.phone).trim().slice(0, 20), norm, String(b.email || '').slice(0, 120), String(systemSource || b.source || 'other').slice(0, 40), String(b.source_detail || '').slice(0, 120), Math.round(Number(b.budget_paise) || 0), String(b.config_pref || '').slice(0, 40), assignee, b.consent ? 1 : 0, b.consent_at || (b.consent ? now : null), String(b.notes || '').slice(0, 500), partnerId, now).run();
    await audit(env, user, 'create', 'sal_leads', r.meta.last_row_id, `Lead "${name}" registered${partnerId ? ' via channel partner #' + partnerId : ''}${systemSource ? ' from ' + systemSource : ''}`);
    return { status: 200, id: r.meta.last_row_id, assignee };
  }

  shared.createLead = createLead;

  router.post('/api/sales/leads', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      const r = await createLead(env, req.user, await req.json());
      return r.status === 200 ? json({ ok: true, data: { id: r.id } }) : json({ ok: false, error: r.error }, r.status);
    } catch (e) { return serverError(e, 'lead-create'); }
  }));

  // Edit a lead. Name/email/needs: owner, PM or the assigned rep. A phone change is a poaching vector: Owner only, with a reason, in the audit log.
  router.put('/api/sales/leads/:id', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const l = await env.DB.prepare('SELECT * FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!l) return json({ ok: false, error: 'Lead not found.' }, 404);
      if (!MANAGER.includes(req.user.role) && l.assigned_to !== req.user.user_id) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      const sets = []; const vals = [];
      if (b.name) { sets.push('name = ?'); vals.push(String(b.name).trim().slice(0, 120)); }
      if (b.email !== undefined) { sets.push('email = ?'); vals.push(String(b.email).slice(0, 120)); }
      if (b.config_pref !== undefined) { sets.push('config_pref = ?'); vals.push(String(b.config_pref).slice(0, 40)); }
      if (b.budget_paise !== undefined) { sets.push('budget_paise = ?'); vals.push(Math.round(Number(b.budget_paise) || 0)); }
      if (b.phone && phone10(b.phone) !== l.phone_norm) {
        if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can change a lead\'s mobile number.' }, 403);
        if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for changing the number.' }, 400);
        const n = phone10(b.phone);
        if (n.length !== 10) return json({ ok: false, error: 'Enter a 10-digit mobile number.' }, 400);
        if (await env.DB.prepare('SELECT id FROM sal_leads WHERE phone_norm = ? AND id != ? AND deleted_at IS NULL').bind(n, l.id).first()) return json({ ok: false, error: 'Another lead already has that number.' }, 409);
        sets.push('phone = ?', 'phone_norm = ?'); vals.push(String(b.phone).trim().slice(0, 20), n);
        await audit(env, req.user, 'phone_change', 'sal_leads', l.id, `Lead phone changed ${l.phone} -> ${b.phone}. Reason: ${b.reason}`);
      }
      if (!sets.length) return json({ ok: true });
      await env.DB.prepare(`UPDATE sal_leads SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, l.id).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'lead-edit'); }
  }));

  router.post('/api/sales/leads/:id/reassign', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const l = await env.DB.prepare('SELECT * FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!l) return json({ ok: false, error: 'Lead not found.' }, 404);
      const b = await req.json();
      const to = await env.DB.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'sales' AND active = 1 AND deleted_at IS NULL").bind(Number(b.assigned_to)).first();
      if (!to) return json({ ok: false, error: 'Pick an active sales user.' }, 400);
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the reassignment.' }, 400);
      await env.DB.prepare('UPDATE sal_leads SET assigned_to = ? WHERE id = ?').bind(to.id, l.id).run();
      await audit(env, req.user, 'reassign', 'sal_leads', l.id, `Lead "${l.name}" reassigned from user ${l.assigned_to} to ${to.name}. Reason: ${b.reason}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'lead-reassign'); }
  }));

  // ---------- Inventory: create, price changes (audited), segregation ----------
  router.post('/api/sales/inventory', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      if (!MANAGER.includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or PM can add flats.' }, 403);
      const b = await req.json();
      if (!(await visibleProjectIds(env, req.user)).includes(Number(b.project_id)) || !b.unit_no) return json({ ok: false, error: 'Project and flat number are required.' }, 400);
      const category = ['rehab', 'landowner'].includes(b.category) ? b.category : 'sale';
      const price = Math.round(Number(b.price_paise) || 0);
      if (category === 'sale' && !(price > 0)) return json({ ok: false, error: 'A flat for sale needs a price.' }, 400);
      const r = await env.DB.prepare('INSERT INTO sal_inventory (project_id, wing, floor, unit_no, type, carpet_sqft, rera_carpet_sqft, price_paise, floor_rise_paise, category, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(Number(b.project_id), b.wing || null, b.floor ?? null, String(b.unit_no).slice(0, 20), String(b.type || '').slice(0, 20), b.carpet_sqft || null, b.rera_carpet_sqft || null, price, Math.round(Number(b.floor_rise_paise) || 0), category, category === 'rehab' ? 'rehab' : category === 'landowner' ? 'landowner' : 'available', nowStr()).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) return json({ ok: false, error: 'That unit already exists in this wing.' }, 400);
      return serverError(e, 'inv-create');
    }
  }));

  router.put('/api/sales/inventory/:id', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const u = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!u) return json({ ok: false, error: 'Unit not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(u.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      // The bucket (sale / rehab / landowner) is fixed once set: sales staff cannot move a flat between buckets.
      if (b.category !== undefined && b.category !== u.category) return json({ ok: false, error: 'The flat\'s bucket (free sale, rehab or landowner) is locked once it is set.' }, 400);
      if (u.status === 'booked' && (b.price_paise !== undefined || b.floor_rise_paise !== undefined || b.category)) return json({ ok: false, error: 'A booked flat\'s price cannot be changed. Cancel or transfer the booking first.' }, 400);
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the change.' }, 400);
      const price = b.price_paise !== undefined ? Math.round(Number(b.price_paise)) : u.price_paise;
      const rise = b.floor_rise_paise !== undefined ? Math.round(Number(b.floor_rise_paise)) : u.floor_rise_paise;
      if (!(price >= 0) || !(rise >= 0)) return json({ ok: false, error: 'Invalid amount.' }, 400);
      await env.DB.prepare('UPDATE sal_inventory SET price_paise = ?, floor_rise_paise = ? WHERE id = ?').bind(price, rise, u.id).run();
      await audit(env, req.user, 'price_change', 'sal_inventory', u.id, `${u.wing || ''}-${u.unit_no}: price ${rupees(u.price_paise)} -> ${rupees(price)}, floor rise ${rupees(u.floor_rise_paise || 0)} -> ${rupees(rise)}. Reason: ${b.reason}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'inv-edit'); }
  }));

  // ---------- Holds: one conditional UPDATE decides the winner; 48 hours max; no extensions by sales ----------
  router.post('/api/sales/inventory/:id/hold', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      const u = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!u) return json({ ok: false, error: 'Unit not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(u.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json().catch(() => ({}));
      const leadId = b.lead_id ? Number(b.lead_id) : null;
      if (!leadId) return json({ ok: false, error: 'Pick the lead this hold is for.' }, 400);
      const lead = await env.DB.prepare('SELECT * FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(leadId).first();
      if (!lead || (!MANAGER.includes(req.user.role) && lead.assigned_to !== req.user.user_id)) return json({ ok: false, error: 'You can only hold a flat for your own lead.' }, 403);
      if (!MANAGER.includes(req.user.role)) {
        const max = await num(env, 'sales.max_holds_per_user', 5);
        const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM sal_inventory WHERE hold_by = ? AND status = 'held'").bind(req.user.user_id).first();
        if (Number(mine.n) >= max) return json({ ok: false, error: `You already hold ${max} flats. Release one or convert a hold into a booking first.` }, 400);
      }
      const hours = Math.min(48, Math.max(1, Number(b.hours) || 48));
      const until = new Date(Date.now() + hours * 3600000).toISOString().replace('T', ' ').substring(0, 19);
      const r = await env.DB.prepare("UPDATE sal_inventory SET status = 'held', hold_by = ?, hold_lead_id = ?, hold_at = ?, blocked_till = ? WHERE id = ? AND status = 'available' AND deleted_at IS NULL")
        .bind(req.user.user_id, leadId, nowStr(), until, u.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Someone else already holds or has booked this flat.' }, 409);
      await audit(env, req.user, 'hold', 'sal_inventory', u.id, `${u.wing || ''}-${u.unit_no} held for lead "${lead.name}" until ${until}`);
      return json({ ok: true, data: { blocked_till: until } });
    } catch (e) { return serverError(e, 'hold'); }
  }));

  router.post('/api/sales/inventory/:id/release', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      const u = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!u || u.status !== 'held') return json({ ok: false, error: 'That flat is not on hold.' }, 400);
      if (!(await visibleProjectIds(env, req.user)).includes(u.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (!MANAGER.includes(req.user.role) && u.hold_by !== req.user.user_id) return json({ ok: false, error: 'Only the person who holds it, or a manager, can release it.' }, 403);
      await env.DB.prepare("UPDATE sal_inventory SET status = 'available', hold_by = NULL, hold_lead_id = NULL, hold_at = NULL, blocked_till = NULL WHERE id = ? AND status = 'held'").bind(u.id).run();
      await audit(env, req.user, 'release', 'sal_inventory', u.id, `${u.wing || ''}-${u.unit_no} hold released`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'release'); }
  }));

  // A manager may extend a hold, once, only with a reason (sales cannot: that is how prime units get hoarded)
  router.post('/api/sales/inventory/:id/extend', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const u = await env.DB.prepare("SELECT * FROM sal_inventory WHERE id = ? AND status = 'held'").bind(Number(req.params.id)).first();
      if (!u) return json({ ok: false, error: 'That flat is not on hold.' }, 400);
      const b = await req.json();
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for extending.' }, 400);
      const until = new Date(Date.now() + 24 * 3600000).toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare('UPDATE sal_inventory SET blocked_till = ? WHERE id = ?').bind(until, u.id).run();
      await audit(env, req.user, 'extend_hold', 'sal_inventory', u.id, `${u.wing || ''}-${u.unit_no} hold extended 24h. Reason: ${b.reason}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'extend'); }
  }));

  // ---------- Payment plan: changes are audited; only the Owner may change it once bookings exist ----------
  router.post('/api/sales/plan-stages', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { project_id, stages } = await req.json();
      const pid = Number(project_id);
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (!MANAGER.includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or PM can change the payment plan.' }, 403);
      if (!Array.isArray(stages) || !stages.length || stages.length > 30) return json({ ok: false, error: 'Add between 1 and 30 stages.' }, 400);
      const clean = stages.map((s) => ({ stage_name: String(s.stage_name || '').trim().slice(0, 80), pct_bp: parseInt(s.pct_bp, 10), milestone_key: s.milestone_key ? String(s.milestone_key).trim().slice(0, 40) : null }));
      if (clean.some((s) => !s.stage_name || !(s.pct_bp > 0))) return json({ ok: false, error: 'Every stage needs a name and a percentage above zero.' }, 400);
      const total = clean.reduce((t, s) => t + s.pct_bp, 0);
      if (total !== 10000) return json({ ok: false, error: `Stages must total 100% (they total ${(total / 100).toFixed(2)}%).` }, 400);
      const booked = await env.DB.prepare("SELECT COUNT(*) AS n FROM sal_bookings WHERE project_id = ? AND status <> 'cancelled' AND deleted_at IS NULL").bind(pid).first();
      if (Number(booked.n) > 0 && req.user.role !== 'owner') return json({ ok: false, error: 'Bookings already exist. Only the Owner can change the plan, and existing customers\' demands stay as they were.' }, 403);
      const before = (await env.DB.prepare('SELECT stage_name, pct_bp, milestone_key FROM sal_plan_stages WHERE project_id = ? AND retired = 0 ORDER BY sort_order, id').bind(pid).all()).results;
      const stmts = [env.DB.prepare('UPDATE sal_plan_stages SET retired = 1 WHERE project_id = ? AND retired = 0').bind(pid)];
      clean.forEach((s, i) => stmts.push(env.DB.prepare('INSERT INTO sal_plan_stages (project_id, stage_name, pct_bp, milestone_key, sort_order) VALUES (?, ?, ?, ?, ?)').bind(pid, s.stage_name, s.pct_bp, s.milestone_key, (i + 1) * 10)));
      stmts.push(env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'plan_change', 'sal_plan_stages', pid, `Payment plan changed. Before: ${JSON.stringify(before)} After: ${JSON.stringify(clean)}`.slice(0, 600), nowStr()));
      await env.DB.batch(stmts);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'plan'); }
  }));

  // ---------- Booking: atomic claim, discount approval, hold/token rules ----------
  router.post('/api/sales/bookings', async (req, env) => withAuth(req, env, 'sales', 'C', async (req, env) => {
    let claimed = null;
    try {
      const b = await req.json();
      const user = req.user;
      const unit = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(b.unit_id)).first();
      if (!unit) return json({ ok: false, error: 'Unit not found.' }, 404);
      if (!(await visibleProjectIds(env, user)).includes(unit.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (unit.category === 'rehab') return json({ ok: false, error: 'Rehab flats are allotted to existing members and cannot be sold.' }, 400);
      if (unit.category === 'landowner') return json({ ok: false, error: 'This flat belongs to the landowner or partner share and cannot be sold from here.' }, 400);
      { const blk = await saleBlock(env, unit.project_id); if (blk) return json({ ok: false, error: blk, code: 'rera' }, 409); }
      { const held = await holdFor(env, unit.project_id, unit.wing); if (held) return json({ ok: false, error: held + '. Flats in it cannot be booked until the hold is released.', code: 'hold' }, 409); }
      const name = String(b.customer_name || '').trim().slice(0, 150);
      if (!name) return json({ ok: false, error: 'Customer name is required.' }, 400);
      const manager = MANAGER.includes(user.role);
      if (unit.status === 'held' && !manager && unit.hold_by !== user.user_id) return json({ ok: false, error: 'This flat is on hold for someone else.' }, 409);
      if (!['available', 'held'].includes(unit.status)) return json({ ok: false, error: unit.status === 'booked' ? 'This unit is already booked.' : 'This flat is not available.' }, 409);

      const list = unit.price_paise + (unit.floor_rise_paise || 0);
      // A booking can take its price from an approved cost sheet: the discount was already approved there, so the per-role limit below is skipped.
      let sheet = null;
      if (b.cost_sheet_id) {
        const chk = await shared.approvedSheetForBooking(env, Number(b.cost_sheet_id), unit);
        if (chk.error) return json({ ok: false, error: chk.error }, 400);
        sheet = chk.sheet;
      }
      const agreed = sheet ? sheet.agreement_value_paise : Math.round(Number(b.agreed_price_paise) || list);
      if (!(agreed > 0) || !(list > 0)) return json({ ok: false, error: 'Agreed price is required.' }, 400);
      const token = Math.round(Number(b.token_paise) || 0);
      if (token < 0) return json({ ok: false, error: 'Invalid token amount.' }, 400);
      if (unit.status === 'held' && !(token > 0)) return json({ ok: false, error: 'Record the token amount received to convert a hold into a booking.' }, 400);
      if (token > Math.floor(agreed / 10) && user.role !== 'owner') return json({ ok: false, error: 'RERA: an advance above 10% of the price cannot be taken before a registered agreement. Ask the Owner if an agreement is already registered.' }, 400);

      // Discounts: reason always; above the rep's limit a manager must make the booking
      let discountBp = 0; let approvedBy = null;
      if (agreed < list) {
        discountBp = Math.round((list - agreed) * 10000 / list);
        if (sheet) approvedBy = sheet.approved_by;
        else {
          if (String(b.discount_reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the discount (price is below the rate card).' }, 400);
          const limit = user.role === 'owner' ? 10000 : user.role === 'pm' ? await num(env, 'sales.pm_max_discount_bp', 300) : await num(env, 'sales.max_discount_bp', 100);
          if (discountBp > limit) return json({ ok: false, error: `A discount of ${(discountBp / 100).toFixed(2)}% is above your limit (${(limit / 100).toFixed(2)}%). The ${user.role === 'pm' ? 'Owner' : 'PM or Owner'} must book it.` }, 403);
          if (manager) approvedBy = user.user_id;
        }
      }

      const stages = (await env.DB.prepare('SELECT * FROM sal_plan_stages WHERE project_id = ? AND retired = 0 ORDER BY sort_order, id').bind(unit.project_id).all()).results;
      if (stages.length && stages.reduce((t, s) => t + s.pct_bp, 0) !== 10000) return json({ ok: false, error: 'The payment plan stages must total 100% before booking.' }, 400);
      const gstBp = b.gst_bp !== undefined ? Number(b.gst_bp) : 500;
      const partnerId = b.channel_partner_id && (await env.DB.prepare('SELECT id FROM sal_partners WHERE id = ? AND deleted_at IS NULL').bind(Number(b.channel_partner_id)).first()) ? Number(b.channel_partner_id) : null;

      // Atomic claim: only one caller can flip this unit; everyone else gets 0 changes.
      const claim = await env.DB.prepare("UPDATE sal_inventory SET status = 'booked', blocked_till = NULL, hold_by = NULL, hold_lead_id = NULL, hold_at = NULL WHERE id = ? AND deleted_at IS NULL AND (status = 'available' OR (status = 'held' AND (hold_by = ? OR ? = 1)))")
        .bind(unit.id, user.user_id, manager ? 1 : 0).run();
      if (!claim.meta.changes) return json({ ok: false, error: 'Someone else just booked or held this flat.' }, 409);
      claimed = { id: unit.id, status: unit.status, hold_by: unit.hold_by, hold_lead_id: unit.hold_lead_id, hold_at: unit.hold_at, blocked_till: unit.blocked_till };

      const now = nowStr();
      const snapshot = JSON.stringify({ list_price_paise: list, rate_per_sqft_rera: unit.rera_carpet_sqft ? Math.round(agreed / unit.rera_carpet_sqft) : null, carpet_sqft: unit.carpet_sqft, rera_carpet_sqft: unit.rera_carpet_sqft, type: unit.type, floor: unit.floor });
      const ins = await env.DB.prepare(`INSERT INTO sal_bookings (project_id, unit_id, lead_id, customer_name, phone, email, address, pan, token_paise, agreed_price_paise, gst_bp, status, booking_date, created_by, created_at, channel_partner_id, brokerage_bp, list_price_paise, discount_reason, approved_by, unit_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'token', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(unit.project_id, unit.id, b.lead_id ? Number(b.lead_id) : (unit.hold_lead_id || null), name, String(b.phone || '').slice(0, 20), String(b.email || '').slice(0, 120), String(b.address || '').slice(0, 300),
          b.pan ? 'enc:' + (await encryptSetting(env, String(b.pan).trim().toUpperCase())) : '', token, agreed, gstBp, now.substring(0, 10), user.user_id, now, partnerId, partnerId ? Math.round(Number(b.brokerage_bp) || 0) || null : null,
          list, discountBp ? String(b.discount_reason || (sheet ? `Per approved cost sheet v${sheet.version}` : '')).slice(0, 300) : null, approvedBy, snapshot).run();
      const bookingId = ins.meta.last_row_id;
      const stmts = [];
      let allocated = 0;
      stages.forEach((st, i) => {
        const amount = i === stages.length - 1 ? agreed - allocated : Math.floor(agreed * st.pct_bp / 10000);
        allocated += amount;
        stmts.push(env.DB.prepare('INSERT INTO sal_demands (booking_id, stage_id, label, amount_paise, gst_paise, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(bookingId, st.id, st.stage_name, amount, Math.round(amount * gstBp / 10000), st.milestone_key ? 'scheduled' : 'ready', now));
      });
      if (sheet) stmts.push(env.DB.prepare('UPDATE sal_cost_sheets SET booking_id = ? WHERE id = ? AND booking_id IS NULL').bind(bookingId, sheet.id));
      const leadId = b.lead_id ? Number(b.lead_id) : unit.hold_lead_id;
      if (leadId) stmts.push(env.DB.prepare("UPDATE sal_leads SET status = 'booked', next_followup_at = NULL WHERE id = ?").bind(leadId));
      stmts.push(env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(user.user_id, 'create', 'sal_bookings', bookingId, `Booked ${unit.wing ? unit.wing + '-' : ''}${unit.unit_no} for ${name}: agreed ${rupees(agreed)} vs rate card ${rupees(list)}${discountBp ? ` (discount ${(discountBp / 100).toFixed(2)}%, reason: ${b.discount_reason}${approvedBy ? ', approved by user ' + approvedBy : ''})` : ''}, token ${rupees(token)}`, now));
      await env.DB.batch(stmts);
      return json({ ok: true, data: { id: bookingId, demands: stages.length, discount_bp: discountBp, warning: null } });
    } catch (e) {
      // Undo the claim so the flat does not stay stuck as booked without a booking.
      if (claimed) { try { await env.DB.prepare("UPDATE sal_inventory SET status = ?, hold_by = ?, hold_lead_id = ?, hold_at = ?, blocked_till = ? WHERE id = ? AND status = 'booked' AND NOT EXISTS (SELECT 1 FROM sal_bookings WHERE unit_id = ? AND status <> 'cancelled' AND deleted_at IS NULL)").bind(claimed.status, claimed.hold_by, claimed.hold_lead_id, claimed.hold_at, claimed.blocked_till, claimed.id, claimed.id).run(); } catch (e2) { /* logged below */ } }
      if (/UNIQUE/.test(String(e.message))) return json({ ok: false, error: 'This unit is already booked.' }, 409);
      return serverError(e, 'booking-create');
    }
  }));

  // ---------- Document numbers: April-March financial year (IST), taken from a counter inside the same batch as the document ----------
  const istNow = () => new Date(Date.now() + 19800000);
  const fyOf = (d = istNow()) => { const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const a = m >= 4 ? y : y - 1; return `${a}-${String(a + 1).slice(2)}`; };
  shared.fyOf = fyOf;

  async function notifyApprovers(env, exceptUserId, title, body) {
    const users = await env.DB.prepare("SELECT id FROM users WHERE role IN ('pm', 'owner') AND active = 1 AND deleted_at IS NULL AND id != ? LIMIT 20").bind(exceptUserId || 0).all();
    if (!users.results.length) return;
    const now = nowStr();
    await env.DB.batch(users.results.map((u) => env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, title, body, 'sales', now)));
  }

  // Post a receipt: the number, the receipt, the demand settlement and the audit row are one atomic batch. Two receipts at the same moment get different numbers.
  async function postReceipt(env, booking, f, user, extra = []) {
    const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(booking.project_id).first();
    const fy = fyOf(); const key = `rcpt:${booking.project_id}:${fy}`; const prefix = `RC-${proj ? proj.code : booking.project_id}-${fy}-`;
    const now = nowStr();
    const stmts = [
      env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1').bind(key),
      env.DB.prepare(`INSERT INTO sal_receipts (booking_id, demand_id, amount_paise, tds_paise, mode, ref_no, received_on, received_by, note, receipt_no, account, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? || printf('%05d', (SELECT value FROM counters WHERE key = ?)), ?, ?, ?)`)
        .bind(booking.id, f.demandId, f.amount, f.tds, f.mode, f.ref, f.received_on || now.substring(0, 10), user.user_id, String(f.note || '').slice(0, 300), prefix, key, f.account, f.kind, now),
    ];
    if (f.demandId) stmts.push(env.DB.prepare(`UPDATE sal_demands SET settled_paise = settled_paise + ?, status = CASE WHEN settled_paise + ? >= amount_paise + COALESCE(gst_paise, 0) THEN 'paid' ELSE 'partial' END WHERE id = ?`).bind(f.amount + f.tds, f.amount + f.tds, f.demandId));
    stmts.push(...extra);
    const res = await env.DB.batch(stmts);
    const id = res[1].meta.last_row_id;
    const rn = (await env.DB.prepare('SELECT receipt_no FROM sal_receipts WHERE id = ?').bind(id).first()).receipt_no;
    await audit(env, user, 'create', 'sal_receipts', booking.id, `${f.kind === 'interest' ? 'Interest receipt' : 'Receipt'} ${rn} ${rupees(f.amount)} (${f.mode}${f.ref ? ' ' + f.ref : ''}, ${f.account}) from ${booking.customer_name}`);
    return { receiptNo: rn, id };
  }
  shared.postReceipt = postReceipt;
  shared.notifyApprovers = notifyApprovers;

  // ---------- Receipts: who may record, cash limit, numbering, no duplicates, reversal ----------
  router.post('/api/sales/bookings/:id/receipts', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts, the PM or the Owner can record a receipt.' }, 403);
      const b = await req.json();
      const booking = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!booking) return json({ ok: false, error: 'Booking not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(booking.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (booking.status === 'cancelled') return json({ ok: false, error: 'This booking is cancelled.' }, 400);
      const amount = Math.round(Number(b.amount_paise) || 0); const tds = Math.round(Number(b.tds_paise) || 0);
      if (!(amount > 0) || tds < 0) return json({ ok: false, error: 'Amount is required.' }, 400);
      const mode = ['bank', 'cheque', 'upi', 'cash', 'rtgs', 'neft'].includes(b.mode) ? b.mode : 'bank';
      if (mode === 'cash' && amount >= 20000000) return json({ ok: false, error: 'Cash of ₹2,00,000 or more cannot be accepted (Income-tax Act s.269ST). Use bank transfer or cheque.' }, 400);
      const ref = String(b.ref_no || '').trim().slice(0, 60);
      if (mode !== 'cash' && !ref) return json({ ok: false, error: 'Enter the cheque / transaction reference.' }, 400);
      if (ref && await env.DB.prepare('SELECT id FROM sal_receipts WHERE booking_id = ? AND ref_no = ? AND mode = ? AND reversed_at IS NULL').bind(booking.id, ref, mode).first()) return json({ ok: false, error: 'A receipt with this reference already exists for this booking.' }, 409);
      const account = b.account === 'project_other' ? 'project_other' : 'rera_designated';
      if (account === 'project_other' && !['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or Accounts can route a receipt outside the RERA designated account.' }, 403);
      const kind = b.kind === 'interest' ? 'interest' : 'principal';   // interest paid on delayed instalments does not settle any demand
      let demandId = null;
      if (b.demand_id && kind === 'principal') {
        const d = await env.DB.prepare('SELECT id FROM sal_demands WHERE id = ? AND booking_id = ?').bind(Number(b.demand_id), booking.id).first();
        if (!d) return json({ ok: false, error: 'That demand does not belong to this booking.' }, 400);
        demandId = d.id;
      }
      const fields = { amount, tds, mode, ref, account, kind, demandId, received_on: b.received_on, note: b.note };
      // Optional second-person approval for large receipts: it waits in its own list and changes nothing until approved.
      const limit = Number(await getSetting(env, 'sales.receipt_approval_limit_paise')) || 0;
      if (limit > 0 && amount + tds >= limit) {
        if (ref && await env.DB.prepare("SELECT id FROM sal_receipt_requests WHERE booking_id = ? AND ref_no = ? AND mode = ? AND status IN ('pending', 'approving')").bind(booking.id, ref, mode).first()) return json({ ok: false, error: 'This receipt is already waiting for approval.' }, 409);
        const rq = await env.DB.prepare(`INSERT INTO sal_receipt_requests (booking_id, demand_id, amount_paise, tds_paise, mode, ref_no, received_on, note, account, kind, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(booking.id, demandId, amount, tds, mode, ref, b.received_on || nowStr().substring(0, 10), String(b.note || '').slice(0, 300), account, kind, req.user.user_id, nowStr()).run();
        await notifyApprovers(env, req.user.user_id, `Receipt to approve: ${rupees(amount)}`, `${booking.customer_name}, ${mode}${ref ? ' ' + ref : ''}. Recorded by ${req.user.name}.`);
        return json({ ok: true, data: { pending: true, request_id: rq.meta.last_row_id, message: `A receipt of ${rupees(amount + tds)} or more needs a second person's approval. It has been sent to the PM or Owner.` } });
      }
      const posted = await postReceipt(env, booking, fields, req.user);
      return json({ ok: true, data: { receipt_no: posted.receiptNo } });
    } catch (e) { return serverError(e, 'receipt'); }
  }));

  router.post('/api/sales/receipts/:id/reverse', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const r = await env.DB.prepare('SELECT r.*, b.project_id, b.customer_name FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE r.id = ?').bind(Number(req.params.id)).first();
      if (!r) return json({ ok: false, error: 'Receipt not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(r.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (r.reversed_at) return json({ ok: false, error: 'Already reversed.' }, 400);
      const b = await req.json();
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the reversal (e.g. cheque bounced).' }, 400);
      const stmts = [env.DB.prepare('UPDATE sal_receipts SET reversed_at = ?, reversed_by = ?, reversal_note = ? WHERE id = ? AND reversed_at IS NULL').bind(nowStr(), req.user.user_id, String(b.reason).slice(0, 300), r.id)];
      if (r.demand_id) stmts.push(env.DB.prepare(`UPDATE sal_demands SET settled_paise = MAX(settled_paise - ?, 0), status = CASE WHEN settled_paise - ? <= 0 THEN 'ready' WHEN settled_paise - ? >= amount_paise + COALESCE(gst_paise, 0) THEN 'paid' ELSE 'partial' END WHERE id = ?`).bind(r.amount_paise + r.tds_paise, r.amount_paise + r.tds_paise, r.amount_paise + r.tds_paise, r.demand_id));
      stmts.push(env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'reverse', 'sal_receipts', r.id, `Receipt ${r.receipt_no || r.id} ${rupees(r.amount_paise)} from ${r.customer_name} reversed. Reason: ${b.reason}`, nowStr()));
      await env.DB.batch(stmts);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'reverse'); }
  }));

  // Agreement for sale / registration dates (drives the "Registered" state on the stacking plan)
  router.post('/api/sales/bookings/:id/registration', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const booking = await env.DB.prepare("SELECT * FROM sal_bookings WHERE id = ? AND status <> 'cancelled' AND deleted_at IS NULL").bind(Number(req.params.id)).first();
      if (!booking) return json({ ok: false, error: 'Active booking not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(booking.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      const ok = (d) => d === null || d === undefined || d === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(d));
      if (!ok(b.agreement_date) || !ok(b.registration_date)) return json({ ok: false, error: 'Dates must look like 2026-11-30.' }, 400);
      await env.DB.prepare('UPDATE sal_bookings SET agreement_date = COALESCE(?, agreement_date), registration_date = COALESCE(?, registration_date), status = CASE WHEN ? IS NOT NULL THEN \'registered\' ELSE status END WHERE id = ?')
        .bind(b.agreement_date || null, b.registration_date || null, b.registration_date || null, booking.id).run();
      await audit(env, req.user, 'registration', 'sal_bookings', booking.id, `Booking of ${booking.customer_name}: agreement ${b.agreement_date || '-'}, registration ${b.registration_date || '-'}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'registration'); }
  }));

  // ---------- Cancellation, refunds, unit transfer ----------
  router.post('/api/sales/bookings/:id/cancel', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const booking = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!booking) return json({ ok: false, error: 'Booking not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(booking.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (booking.status === 'cancelled') return json({ ok: false, error: 'Already cancelled.' }, 400);
      const { reason } = await req.json();
      if (String(reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the cancellation.' }, 400);
      const now = nowStr();
      await env.DB.batch([
        env.DB.prepare("UPDATE sal_bookings SET status = 'cancelled', cancelled_on = ?, cancel_reason = ? WHERE id = ?").bind(now.substring(0, 10), String(reason).slice(0, 300), booking.id),
        env.DB.prepare("UPDATE sal_inventory SET status = 'available', hold_by = NULL, hold_lead_id = NULL, hold_at = NULL, blocked_till = NULL WHERE id = ?").bind(booking.unit_id),
        env.DB.prepare("UPDATE sal_demands SET status = 'cancelled' WHERE booking_id = ? AND status != 'paid'").bind(booking.id),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'cancel', 'sal_bookings', booking.id, `Cancelled booking of ${booking.customer_name}. Reason: ${reason}`, now),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'cancel'); }
  }));

  router.post('/api/sales/bookings/:id/refund', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      const booking = await env.DB.prepare('SELECT * FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!booking) return json({ ok: false, error: 'Booking not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(booking.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (booking.status !== 'cancelled') return json({ ok: false, error: 'Cancel the booking first.' }, 400);
      const b = await req.json();
      const amount = Math.round(Number(b.amount_paise) || 0); const forfeit = Math.round(Number(b.forfeited_paise) || 0);
      if (!(amount >= 0) || !(forfeit >= 0) || (amount === 0 && forfeit === 0)) return json({ ok: false, error: 'Enter the refund and forfeiture amounts.' }, 400);
      if (forfeit > Math.floor(booking.agreed_price_paise / 10)) return json({ ok: false, error: 'Forfeiture cannot exceed 10% of the agreed price.' }, 400);
      const col = await env.DB.prepare('SELECT COALESCE(SUM(amount_paise + tds_paise), 0) AS t FROM sal_receipts WHERE booking_id = ? AND reversed_at IS NULL AND kind = \'principal\'').bind(booking.id).first();
      const used = await env.DB.prepare("SELECT COALESCE(SUM(amount_paise + forfeited_paise), 0) AS t FROM sal_refunds WHERE booking_id = ? AND status != 'rejected'").bind(booking.id).first();
      if (amount + forfeit + Number(used.t) > Number(col.t)) return json({ ok: false, error: 'Refund plus forfeiture is more than the customer paid.' }, 400);
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason.' }, 400);
      const r = await env.DB.prepare('INSERT INTO sal_refunds (booking_id, amount_paise, forfeited_paise, reason, status, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(booking.id, amount, forfeit, String(b.reason).slice(0, 300), 'requested', req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'refund_request', 'sal_refunds', r.meta.last_row_id, `Refund ${rupees(amount)} (forfeit ${rupees(forfeit)}) requested for ${booking.customer_name}. ${b.reason}`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'refund'); }
  }));

  const refundAct = (path, fn) => router.post(path, async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const rf = await env.DB.prepare('SELECT f.*, b.customer_name, b.project_id FROM sal_refunds f JOIN sal_bookings b ON b.id = f.booking_id WHERE f.id = ?').bind(Number(req.params.id)).first();
      if (!rf) return json({ ok: false, error: 'Refund not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(rf.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      return fn(req, env, rf);
    } catch (e) { return serverError(e, 'refund-act'); }
  }));
  refundAct('/api/sales/refunds/:id/approve', async (req, env, rf) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can approve a refund.' }, 403);
    if (rf.requested_by === req.user.user_id) return json({ ok: false, error: 'You cannot approve a refund you requested.' }, 403);
    if (rf.status !== 'requested') return json({ ok: false, error: 'This refund is not waiting for approval.' }, 400);
    await env.DB.prepare("UPDATE sal_refunds SET status = 'approved', approved_by = ? WHERE id = ? AND status = 'requested'").bind(req.user.user_id, rf.id).run();
    await audit(env, req.user, 'refund_approve', 'sal_refunds', rf.id, `Refund ${rupees(rf.amount_paise)} to ${rf.customer_name} approved`);
    return json({ ok: true });
  });
  refundAct('/api/sales/refunds/:id/reject', async (req, env, rf) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can reject a refund.' }, 403);
    await env.DB.prepare("UPDATE sal_refunds SET status = 'rejected', approved_by = ? WHERE id = ? AND status = 'requested'").bind(req.user.user_id, rf.id).run();
    await audit(env, req.user, 'refund_reject', 'sal_refunds', rf.id, `Refund to ${rf.customer_name} rejected`);
    return json({ ok: true });
  });
  refundAct('/api/sales/refunds/:id/pay', async (req, env, rf) => {
    if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can mark a refund paid.' }, 403);
    if (rf.status !== 'approved') return json({ ok: false, error: 'The Owner must approve it first.' }, 400);
    const b = await req.json();
    if (!String(b.ref_no || '').trim()) return json({ ok: false, error: 'Enter the payment reference.' }, 400);
    await env.DB.prepare("UPDATE sal_refunds SET status = 'paid', paid_on = ?, ref_no = ? WHERE id = ? AND status = 'approved'").bind(b.paid_on || nowStr().substring(0, 10), String(b.ref_no).slice(0, 60), rf.id).run();
    await audit(env, req.user, 'refund_paid', 'sal_refunds', rf.id, `Refund ${rupees(rf.amount_paise)} to ${rf.customer_name} paid (ref ${b.ref_no})`);
    return json({ ok: true });
  });

  router.get('/api/sales/bookings/:id/refunds', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const b = await env.DB.prepare('SELECT project_id FROM sal_bookings WHERE id = ?').bind(Number(req.params.id)).first();
    if (!b || !(await visibleProjectIds(env, req.user)).includes(b.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare('SELECT * FROM sal_refunds WHERE booking_id = ? ORDER BY id DESC').bind(Number(req.params.id)).all();
    return json({ ok: true, data: { refunds: rows.results } });
  }));

  router.post('/api/sales/bookings/:id/transfer', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      if (!MANAGER.includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or PM can transfer a booking to another flat.' }, 403);
      const booking = await env.DB.prepare("SELECT * FROM sal_bookings WHERE id = ? AND status <> 'cancelled' AND deleted_at IS NULL").bind(Number(req.params.id)).first();
      if (!booking) return json({ ok: false, error: 'Active booking not found.' }, 404);
      if (!(await visibleProjectIds(env, req.user)).includes(booking.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json();
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the transfer.' }, 400);
      const to = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND project_id = ? AND deleted_at IS NULL').bind(Number(b.to_unit_id), booking.project_id).first();
      if (!to || to.category !== 'sale') return json({ ok: false, error: 'Pick an available flat in the same project.' }, 400);
      const claim = await env.DB.prepare("UPDATE sal_inventory SET status = 'booked' WHERE id = ? AND status = 'available'").bind(to.id).run();
      if (!claim.meta.changes) return json({ ok: false, error: 'That flat is not available.' }, 409);
      await env.DB.batch([
        env.DB.prepare('UPDATE sal_bookings SET unit_id = ? WHERE id = ?').bind(to.id, booking.id),
        env.DB.prepare("UPDATE sal_inventory SET status = 'available' WHERE id = ?").bind(booking.unit_id),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'transfer', 'sal_bookings', booking.id, `Booking of ${booking.customer_name} moved from unit ${booking.unit_id} to ${to.wing || ''}-${to.unit_no}. Price and demands unchanged. Reason: ${b.reason}`, nowStr()),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'transfer'); }
  }));

  // ---------- Cost sheet (Maharashtra). Rates are settings so the CA can adjust them; the numbers are an estimate. ----------
  router.post('/api/sales/cost-sheet', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    const b = await req.json();
    const agreed = Math.round(Number(b.agreed_price_paise) || 0);
    if (!(agreed > 0)) return json({ ok: false, error: 'Price is required.' }, 400);
    const extras = Math.round(Number(b.other_charges_paise) || 0);           // parking, club, PLC etc., part of the agreement value
    const value = agreed + extras;
    const stampBp = await num(env, 'tax.stamp_duty_bp', 500);                  // 5%
    const metroBp = await num(env, 'tax.metro_cess_bp', 100);                  // 1% metro cess (Mumbai)
    const womenOffBp = b.buyer === 'woman' ? Number(await getSetting(env, 'tax.women_concession_bp')) || 0 : 0;
    const regBp = await num(env, 'tax.registration_bp', 100);                  // 1%
    const regCap = await num(env, 'tax.registration_cap_paise', 3000000);     // Rs 30,000 cap
    const gstBp = b.gst_bp !== undefined ? Number(b.gst_bp) : await num(env, 'tax.gst_bp', 500);   // 5% (1% affordable)
    const stamp = Math.round(value * Math.max(stampBp - womenOffBp, 0) / 10000);
    const metro = Math.round(value * metroBp / 10000);
    const registration = Math.min(Math.round(value * regBp / 10000), value > 3000000 * 100 ? regCap : Math.round(value * regBp / 10000));
    const gst = Math.round(value * gstBp / 10000);
    const rera = Number(b.rera_carpet_sqft) || 0;
    return json({ ok: true, data: {
      agreement_value_paise: value, stamp_duty_paise: stamp, metro_cess_paise: metro, registration_paise: registration, gst_paise: gst,
      total_buyer_outflow_paise: value + stamp + metro + registration + gst,
      rate_per_sqft_rera_paise: rera ? Math.round(value / rera) : null,
      rates: { stamp_bp: stampBp, women_concession_bp: womenOffBp, metro_bp: metroBp, registration_bp: regBp, registration_cap_paise: regCap, gst_bp: gstBp },
      note: 'Estimate only. Stamp duty, cess, registration and GST rates change; confirm with your CA and the sub-registrar before quoting.',
    } });
  }));

  // ---------- Lead intake webhook (portals, Meta lead ads, website forms) ----------
  // POST /api/webhooks/leads/:source with header X-Signature = hex HMAC-SHA256(body, WEBHOOK_SECRET) and X-Timestamp (unix seconds, within 5 minutes).
  router.post('/api/webhooks/leads/:source', async (req, env) => {
    try {
      if (!env.WEBHOOK_SECRET) return json({ ok: false, error: 'Webhook intake is not configured.' }, 503);
      const rl = await checkRateLimit(env, `webhook:${clientIp(req)}`, 120, 10);
      if (!rl.allowed) return json({ ok: false, error: 'Too many requests.' }, 429);
      const raw = await req.text();
      if (raw.length > 20000) return json({ ok: false, error: 'Too large.' }, 413);
      const ts = Number(req.headers.get('x-timestamp'));
      if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return json({ ok: false, error: 'Stale or missing timestamp.' }, 401);
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`))), (b) => b.toString(16).padStart(2, '0')).join('');
      const got = String(req.headers.get('x-signature') || '').toLowerCase();
      let diff = sig.length ^ got.length; for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
      if (diff !== 0) return json({ ok: false, error: 'Bad signature.' }, 401);
      const source = String(req.params.source).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || 'webhook';
      const body = JSON.parse(raw);
      const evId = `${source}:${body.id || sig}`;
      if (await env.DB.prepare('SELECT id FROM webhook_seen WHERE id = ?').bind(evId).first()) return json({ ok: true, data: { duplicate: true } });
      await env.DB.prepare('INSERT INTO webhook_seen (id, source) VALUES (?, ?)').bind(evId, source).run();
      const proj = body.project_code ? await env.DB.prepare('SELECT id FROM projects WHERE code = ? AND deleted_at IS NULL').bind(String(body.project_code)).first() : null;
      const r = await createLead(env, null, { name: body.name, phone: body.phone, email: body.email, project_id: proj ? proj.id : null, source_detail: body.campaign || body.source_detail, config_pref: body.config || body.config_pref, consent: !!body.consent, notes: body.message }, { systemSource: source });
      if (r.status === 409) return json({ ok: true, data: { duplicate: true } });
      if (r.status !== 200) return json({ ok: false, error: r.error }, r.status);
      if (r.assignee) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(r.assignee, `New ${source} lead: ${String(body.name).slice(0, 60)}`, 'Call within the hour.', `lead#${r.id}`, nowStr()).run();
      return json({ ok: true, data: { id: r.id } });
    } catch (e) { return serverError(e, 'webhook'); }
  });
}

// Hourly: holds past their time go back to the pool and the holder is told; holders also get a heads-up one hour before.
// Set-based: a fixed handful of statements however many holds there are (the free plan allows about 50 queries per run).
export async function expireHolds(env) {
  await env.DB.batch([
    // 1) heads-up for holds ending within the hour (once per flat per day)
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT i.hold_by, 'Hold ending soon: ' || COALESCE(i.wing || '-', '') || i.unit_no, 'Convert it into a booking with a token, or it returns to the pool at ' || substr(i.blocked_till, 12, 5) || '.', 'sales', datetime('now')
      FROM sal_inventory i WHERE i.status = 'held' AND i.hold_by IS NOT NULL AND i.blocked_till > datetime('now') AND i.blocked_till <= datetime('now', '+1 hour') AND i.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = i.hold_by AND n.title = 'Hold ending soon: ' || COALESCE(i.wing || '-', '') || i.unit_no AND date(n.created_at) = date('now'))`),
    // 2) tell the holders of expired holds, and record it
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT i.hold_by, 'Hold expired: ' || COALESCE(i.wing || '-', '') || i.unit_no, 'The flat is available again. Convert holds into bookings with a token within 48 hours.', 'sales', datetime('now')
      FROM sal_inventory i WHERE i.status = 'held' AND i.hold_by IS NOT NULL AND i.blocked_till IS NOT NULL AND i.blocked_till < datetime('now') AND i.deleted_at IS NULL`),
    env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at)
      SELECT NULL, 'hold_expired', 'sal_inventory', i.id, COALESCE(i.wing || '-', '') || i.unit_no || ' hold expired and was released', datetime('now')
      FROM sal_inventory i WHERE i.status = 'held' AND i.blocked_till IS NOT NULL AND i.blocked_till < datetime('now') AND i.deleted_at IS NULL`),
    // 3) release them, all at once
    env.DB.prepare(`UPDATE sal_inventory SET status = 'available', hold_by = NULL, hold_lead_id = NULL, hold_at = NULL, blocked_till = NULL
      WHERE status = 'held' AND blocked_till IS NOT NULL AND blocked_till < datetime('now') AND deleted_at IS NULL`),
  ]);
}
