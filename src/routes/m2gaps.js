// routes/m2gaps.js — Module 2 gaps, step 1: minimum selling price (MSP), channel-partner KYC vault and RERA-expiry payment gate,
// lead-SLA auto-reassign, "is this number already ours?" check, and the CC-floor sale lock.
// Rates and limits come from Settings (confirm with your CA / advocate); nothing legal is hard-coded.
import { PAN_RE } from '../core/pin.js';
import { approvalState } from '../core/gates.js';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const phone10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Brokerage may be paid only to a partner whose KYC the Owner/Accounts approved and whose MahaRERA registration has not expired.
// Returns a plain message, or null when payment is allowed.
export async function partnerPayBlock(env, partnerId) {
  const p = await env.DB.prepare('SELECT firm, rera_no, rera_valid_till, kyc_status FROM sal_partners WHERE id = ? AND deleted_at IS NULL').bind(partnerId).first();
  if (!p) return 'Channel partner not found.';
  if (p.kyc_status !== 'approved') return `${p.firm}: KYC is not approved yet. Add the MahaRERA certificate, PAN and GSTIN, then approve it, before paying brokerage.`;
  if (!String(p.rera_no || '').trim() || !p.rera_valid_till) return `${p.firm}: the MahaRERA registration number or expiry date is missing.`;
  if (p.rera_valid_till < todayIST()) return `${p.firm}: MahaRERA registration expired on ${p.rera_valid_till}. Brokerage cannot be paid until it is renewed and updated.`;
  return null;
}

// Optional lock (setting sales.lock_above_cc = on): flats above the highest floor covered by an approved CC / plinth CC / further CC cannot be sold.
// No CC floor recorded = no lock. Returns a plain message, or null.
export async function ccSaleBlock(env, getSetting, unit) {
  if ((await getSetting(env, 'sales.lock_above_cc')) !== 'on' || unit.floor == null) return null;
  const st = await approvalState(env, unit.project_id);
  const upto = st.ccUpto(unit.wing || null);
  if (upto == null || unit.floor <= upto) return null;
  return `Floor ${unit.floor} is above the approved CC (up to floor ${upto}). It opens for sale when the next Further CC is approved.`;
}

// Hourly: a new lead nobody has touched within the SLA goes to the next executive and the managers are told.
// Set-based: a fixed handful of statements however many leads there are. Hourly sweep, so "15 minutes" really means "at the next sweep after 15 minutes".
export async function leadSlaReassign(env, getSetting, nowStr) {
  const hour = new Date(Date.now() + 19800000).getUTCHours();
  if (hour < 9 || hour >= 19) return 0;
  const raw = await getSetting(env, 'sales.sla_minutes'); const set = Number(raw);
  const mins = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(set) && set >= 0 ? set : 15;
  if (mins === 0) return 0;
  const leads = (await env.DB.prepare(`SELECT id, name, assigned_to FROM sal_leads WHERE deleted_at IS NULL AND status = 'new' AND first_contact_at IS NULL AND sla_reassigns < 3
    AND COALESCE(sla_assigned_at, created_at) < datetime('now', '-' || ? || ' minutes') ORDER BY id LIMIT 30`).bind(mins).all()).results;
  if (!leads.length) return 0;
  const execs = (await env.DB.prepare(`SELECT u.id, u.name, (SELECT COUNT(*) FROM sal_leads l WHERE l.assigned_to = u.id AND l.deleted_at IS NULL AND l.status NOT IN ('booked','lost')) AS open_leads
    FROM users u WHERE u.role = 'sales' AND u.active = 1 AND u.deleted_at IS NULL ORDER BY u.id`).all()).results;
  if (execs.length < 2) return 0;
  const load = new Map(execs.map((e) => [e.id, e.open_leads])); const nameOf = new Map(execs.map((e) => [e.id, e.name]));
  const moves = [];
  for (const l of leads) {
    const cand = execs.filter((e) => e.id !== l.assigned_to).sort((a, b) => load.get(a.id) - load.get(b.id) || a.id - b.id)[0];
    if (!cand) continue;
    load.set(cand.id, load.get(cand.id) + 1);
    moves.push({ id: l.id, to: cand.id, name: String(l.name).slice(0, 60), from: l.assigned_to, s: `Lead "${String(l.name).slice(0, 60)}" not called within ${mins} minutes: moved to ${cand.name}.` });
  }
  if (!moves.length) return 0;
  const j = JSON.stringify(moves); const now = nowStr();
  await env.DB.batch([
    env.DB.prepare(`UPDATE sal_leads SET assigned_to = (SELECT json_extract(m.value, '$.to') FROM json_each(?1) m WHERE json_extract(m.value, '$.id') = sal_leads.id), sla_reassigns = sla_reassigns + 1, sla_assigned_at = ?2
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`).bind(j, now),
    // one statement for both: the new executive of each lead, and one summary line for the Owner and PM
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT json_extract(value, '$.to'), 'New lead for you: ' || json_extract(value, '$.name'), 'The previous executive did not call in time. Please call now.', 'lead#' || json_extract(value, '$.id'), ?2 FROM json_each(?1)
      UNION ALL SELECT u.id, ?3, 'Open Sales to see who it went to.', 'sales', ?2 FROM users u WHERE u.active = 1 AND u.deleted_at IS NULL AND u.role IN ('owner', 'pm')`).bind(j, now, `${moves.length} lead${moves.length === 1 ? '' : 's'} not called within ${mins} minutes: moved to the next executive`),
    env.DB.prepare(`INSERT INTO sal_activities (lead_id, type, outcome, note, by_user, created_at) SELECT json_extract(value, '$.id'), 'note', 'sla_reassign', json_extract(value, '$.s'), NULL, ?2 FROM json_each(?1)`).bind(j, now),
    env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) SELECT NULL, 'sla_reassign', 'sal_leads', json_extract(value, '$.id'), json_extract(value, '$.s'), ?2 FROM json_each(?1)`).bind(j, now),
  ]);
  return moves.length;
}

export function registerM2Gaps(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, encryptSetting } = h;
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user ? user.user_id : null, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();

  // ---------- MSP: Owner sets the floor. Either one rate per sq ft for a whole project, or one flat. ----------
  router.post('/api/sales/msp', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can set the minimum selling price.' }, 403);
      const b = await req.json().catch(() => ({}));
      if (String(b.reason || '').trim().length < 5) return json({ ok: false, error: 'Give a reason for the change.' }, 400);
      if (b.unit_id) {
        const u = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(b.unit_id)).first();
        if (!u || !(await visibleProjectIds(env, req.user)).includes(u.project_id)) return json({ ok: false, error: 'Flat not found.' }, 404);
        if (u.category !== 'sale') return json({ ok: false, error: 'Only flats for sale have a minimum price.' }, 400);
        const msp = b.msp_paise === null || b.msp_paise === '' ? null : Math.round(Number(b.msp_paise));
        if (msp !== null && !(msp > 0)) return json({ ok: false, error: 'Enter the minimum price in rupees, or leave it blank to remove it.' }, 400);
        await env.DB.prepare('UPDATE sal_inventory SET msp_paise = ? WHERE id = ?').bind(msp, u.id).run();
        await audit(env, req.user, 'msp_change', 'sal_inventory', u.id, `${u.wing || ''}-${u.unit_no}: minimum selling price ${u.msp_paise ? rupees(u.msp_paise) : 'none'} -> ${msp ? rupees(msp) : 'none'}. Reason: ${b.reason}`);
        return json({ ok: true, data: { changed: 1 } });
      }
      const pid = Number(b.project_id); const rate = Math.round(Number(b.rate_paise_per_sqft));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Pick a project.' }, 400);
      if (!(rate > 0)) return json({ ok: false, error: 'Enter the minimum rate per sq ft.' }, 400);
      const r = await env.DB.prepare("UPDATE sal_inventory SET msp_paise = CAST(ROUND(? * rera_carpet_sqft) AS INTEGER) WHERE project_id = ? AND deleted_at IS NULL AND category = 'sale' AND rera_carpet_sqft > 0 AND status IN ('available', 'held')").bind(rate, pid).run();
      await audit(env, req.user, 'msp_change', 'sal_inventory', pid, `Minimum selling price set to ${rupees(rate)} per RERA sq ft for ${r.meta.changes} unsold flats of project ${pid}. Reason: ${b.reason}`);
      return json({ ok: true, data: { changed: r.meta.changes } });
    } catch (e) { return serverError(e, 'msp'); }
  }));

  // ---------- Partner KYC vault ----------
  router.post('/api/sales/partners/:id/kyc', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const p = await env.DB.prepare('SELECT * FROM sal_partners WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!p) return json({ ok: false, error: 'Partner not found.' }, 404);
      const b = await req.json().catch(() => ({}));
      const sets = []; const vals = [];
      if (b.pan !== undefined && b.pan !== '') {
        const pan = String(b.pan).trim().toUpperCase();
        if (!PAN_RE.test(pan)) return json({ ok: false, error: 'PAN looks wrong (10 characters like ABCDE1234F).' }, 400);
        sets.push('pan_enc = ?', 'pan_last4 = ?'); vals.push('enc:' + (await encryptSetting(env, pan)), pan.slice(-4));
      }
      if (b.gstin !== undefined) {
        const g = String(b.gstin).trim().toUpperCase();
        if (g && !GSTIN_RE.test(g)) return json({ ok: false, error: 'GSTIN looks wrong (15 characters).' }, 400);
        sets.push('gstin = ?'); vals.push(g);
      }
      if (b.rera_no !== undefined) { sets.push('rera_no = ?'); vals.push(String(b.rera_no).trim().slice(0, 40)); }
      if (b.rera_valid_till !== undefined) {
        if (b.rera_valid_till && !isDate(b.rera_valid_till)) return json({ ok: false, error: 'Enter the expiry date as a proper date.' }, 400);
        sets.push('rera_valid_till = ?'); vals.push(b.rera_valid_till || null);
      }
      if (b.rera_doc_id) {
        const d = await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL').bind(Number(b.rera_doc_id)).first();
        if (!d) return json({ ok: false, error: 'That document was not found.' }, 400);
        sets.push('rera_doc_id = ?'); vals.push(d.id);
      }
      if (!sets.length) return json({ ok: false, error: 'Nothing to save.' }, 400);
      sets.push("kyc_status = 'pending'", 'kyc_by = NULL', 'kyc_at = NULL');   // any change needs a fresh approval
      await env.DB.prepare(`UPDATE sal_partners SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, p.id).run();
      await audit(env, req.user, 'kyc_update', 'sal_partners', p.id, `KYC details of ${p.firm} updated; approval needed again.`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'kyc'); }
  }));

  router.post('/api/sales/partners/:id/kyc/approve', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or Accounts can approve a partner\'s KYC.' }, 403);
      const p = await env.DB.prepare('SELECT * FROM sal_partners WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!p) return json({ ok: false, error: 'Partner not found.' }, 404);
      const miss = [];
      if (!String(p.rera_no || '').trim()) miss.push('MahaRERA number');
      if (!p.rera_valid_till) miss.push('MahaRERA expiry date'); else if (p.rera_valid_till < todayIST()) miss.push('a MahaRERA registration that has not expired');
      if (!p.pan_last4) miss.push('PAN');
      if (miss.length) return json({ ok: false, error: `Cannot approve yet. Needed: ${miss.join(', ')}.` }, 400);
      await env.DB.prepare("UPDATE sal_partners SET kyc_status = 'approved', kyc_by = ?, kyc_at = ? WHERE id = ?").bind(req.user.user_id, nowStr(), p.id).run();
      await audit(env, req.user, 'kyc_approve', 'sal_partners', p.id, `KYC of ${p.firm} approved (MahaRERA valid till ${p.rera_valid_till}${p.gstin ? '' : '; no GSTIN on file'}).`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'kyc-approve'); }
  }));

  // ---------- "Is this number already ours?" (reception, closer, or checking a partner's client before a visit) ----------
  router.get('/api/sales/recognize', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const n = phone10(new URL(req.url).searchParams.get('phone'));
      if (n.length !== 10) return json({ ok: false, error: 'Enter a 10-digit mobile number.' }, 400);
      const l = await env.DB.prepare(`SELECT l.id, l.name, l.created_at, l.config_pref, l.budget_paise, l.status, l.assigned_to, l.project_id, u.name AS closer, p.firm,
        (SELECT COUNT(*) FROM sal_visits v WHERE v.lead_id = l.id AND v.deleted_at IS NULL AND v.status = 'done') AS visits,
        (SELECT MAX(v.visit_at) FROM sal_visits v WHERE v.lead_id = l.id AND v.deleted_at IS NULL AND v.status = 'done') AS last_visit
        FROM sal_leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN sal_partners p ON p.id = l.channel_partner_id
        WHERE l.phone_norm = ? AND l.deleted_at IS NULL ORDER BY l.id LIMIT 1`).bind(n).first();
      if (!l) return json({ ok: true, data: { registered: false } });
      const ids = await visibleProjectIds(env, req.user);
      if (l.project_id && !ids.includes(l.project_id)) return json({ ok: true, data: { registered: true, by: l.firm ? 'a channel partner' : 'our direct team', on: String(l.created_at).slice(0, 10) } });
      const full = ['owner', 'pm'].includes(req.user.role) || l.assigned_to === req.user.user_id || (await getSetting(env, 'sales.share_all_leads')) === 'on';
      const base = { registered: true, by: l.firm ? `channel partner ${l.firm}` : 'our direct team', on: String(l.created_at).slice(0, 10) };
      if (!full) return json({ ok: true, data: { ...base, closer: l.closer } });
      return json({ ok: true, data: { ...base, lead_id: l.id, name: l.name, closer: l.closer, config_pref: l.config_pref, budget_paise: l.budget_paise, status: l.status, visits: l.visits, last_visit: l.last_visit ? String(l.last_visit).slice(0, 10) : null } });
    } catch (e) { return serverError(e, 'recognize'); }
  }));
}
