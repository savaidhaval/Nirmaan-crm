// routes/m5.js — Module 5, step 1: snags pinned on the floor plan and tied to a contractor's work order (open snags lock that order's retention),
// the six-point no-dues check before keys, the possession-funds ledger (corpus, advance maintenance, share money, fit-out deposit),
// the possession certificate / key receipt, the defect-liability helpdesk, and the society (CHS) handover vault.
// Every rate, period and limit is a Setting (confirm with your CA / advocate); nothing legal is hard-coded.
import { computeInterest } from './finance.js';

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const MONEY = ['owner', 'pm', 'accounts'];
export const FUND_HEADS = { corpus: 'Society corpus fund', maintenance: 'Advance maintenance', share_money: 'Society share money', fitout_deposit: 'Fit-out deposit (refundable)' };
export const SNAG_CATEGORIES = ['civil', 'flooring', 'doors_windows', 'plumbing', 'electrical', 'painting', 'other'];
const DLP_CATEGORIES = ['plumbing', 'electrical', 'seepage', 'civil', 'finishing', 'other'];
export const CHS_DEFAULTS = [['Occupancy Certificate (OC)', 'document'], ['Building Completion Certificate (BCC)', 'document'], ['Sanctioned drawings and plans', 'document'], ['Structural stability certificate', 'document'],
  ['Fire NOC / Final fire certificate (CFO)', 'document'], ['Lift: warranty and AMC', 'amc'], ['STP: warranty and AMC', 'amc'], ['DG set: warranty and AMC', 'amc'], ['Water meter transfer', 'document'],
  ['Electricity meter transfer', 'document'], ['Society corpus and maintenance ledger (audited)', 'document'], ['Share register and share certificates', 'document']];

// ---------- the six no-dues points for one flat ----------
export async function noDuesPoints(env, getSetting, booking) {
  const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(booking.id).first();
  const [dem, tds, funds, snags, ints] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(amount_paise + COALESCE(gst_paise, 0) - settled_paise), 0) AS d FROM sal_demands WHERE booking_id = ? AND status NOT IN ('cancelled', 'scheduled')").bind(booking.id).first(),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_paise), 0) AS a FROM sal_tds_credits WHERE booking_id = ? AND status = 'pending'").bind(booking.id).first(),
    env.DB.prepare("SELECT head, kind, COALESCE(SUM(amount_paise), 0) AS a FROM sal_possession_funds WHERE booking_id = ? AND reversed_at IS NULL GROUP BY head, kind").bind(booking.id).all(),
    env.DB.prepare("SELECT COUNT(*) AS open_all, COALESCE(SUM(CASE WHEN severity IN ('high', 'critical') THEN 1 ELSE 0 END), 0) AS crit FROM site_snags WHERE unit_id = ? AND deleted_at IS NULL AND status <> 'verified'").bind(booking.unit_id).first(),
    computeInterest(env, getSetting, [booking.id]),
  ]);
  const interestDue = (ints.map.get(booking.id) || {}).due || 0;
  const f = {}; for (const r of funds.results) { f[r.head] = f[r.head] || { due: 0, received: 0, refunded: 0 }; f[r.head][r.kind] = Number(r.a); }
  const heads = Object.keys(f).filter((h) => h !== 'fitout_deposit' && f[h].due > 0);
  const short = heads.filter((h) => f[h].received < f[h].due);
  const fundsNeeded = (await getSetting(env, 'sales.nodues_funds_required')) !== 'off';
  const funds_ok = heads.length ? short.length === 0 : !fundsNeeded;
  const points = [
    { key: 'dues', label: 'Agreement value, GST and late interest paid', ok: dem.d <= 0 && interestDue <= 0, detail: dem.d > 0 || interestDue > 0 ? `${rupees(Math.max(dem.d, 0))} instalments and ${rupees(Math.max(interestDue, 0))} interest still due` : 'Nothing due' },
    { key: 'tds', label: "Buyer's 1% TDS (Form 16B) verified", ok: !tds.n, detail: tds.n ? `${rupees(tds.a)} of TDS not yet verified` : 'Verified or not applicable' },
    { key: 'funds', label: 'Corpus, advance maintenance and share money received', ok: funds_ok, detail: !heads.length ? (fundsNeeded ? 'No corpus / maintenance / share money has been set for this flat yet' : 'Not required (switched off)') : short.length ? short.map((h) => `${FUND_HEADS[h]}: ${rupees(f[h].due - f[h].received)} short`).join('; ') : 'Received in full' },
    { key: 'afs', label: 'Registered Agreement for Sale on file', ok: !!String(booking.afs_reg_no || '').trim(), detail: booking.afs_reg_no ? 'Registration no. ' + booking.afs_reg_no : 'Registration number not recorded' },
    { key: 'snags', label: 'No critical snag open', ok: !snags.crit, detail: snags.crit ? `${snags.crit} critical snag${snags.crit === 1 ? '' : 's'} open` + (snags.open_all > snags.crit ? ` (${snags.open_all} open in all)` : '') : snags.open_all ? `${snags.open_all} minor snag${snags.open_all === 1 ? '' : 's'} still open` : 'None open' },
    { key: 'letters', label: 'Signed possession letter and indemnity / fit-out undertaking uploaded', ok: !!(ho && ho.letter_doc_id && ho.indemnity_doc_id), detail: ho && ho.letter_doc_id && ho.indemnity_doc_id ? 'Both on file' : `Missing: ${[!(ho && ho.letter_doc_id) ? 'possession letter' : '', !(ho && ho.indemnity_doc_id) ? 'indemnity / undertaking' : ''].filter(Boolean).join(' and ')}` },
  ];
  return { points, all_green: points.every((p) => p.ok), handover_status: ho ? ho.status : null, funds: f };
}

// The society handover vault: every required item uploaded and acknowledged. Returns a plain message, or null.
export async function vaultBlock(env, projectId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN document_id IS NULL THEN 1 ELSE 0 END), 0) AS nodoc, COALESCE(SUM(CASE WHEN document_id IS NOT NULL AND ack_on IS NULL THEN 1 ELSE 0 END), 0) AS noack FROM chs_vault_items WHERE project_id = ? AND required = 1 AND deleted_at IS NULL").bind(projectId).first();
  if (!r.n) return 'The society handover vault has no items yet. Open the project\'s Society handover vault and load the checklist.';
  if (r.nodoc || r.noack) return `The society handover vault is not complete: ${r.nodoc} item${r.nodoc === 1 ? '' : 's'} not uploaded, ${r.noack} not yet acknowledged by the society secretary.`;
  return null;
}

export function registerM5(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, printBrand } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const num = async (env, key, d) => { const raw = await getSetting(env, key); if (raw === null || raw === undefined || raw === '') return d; const v = Number(raw); return Number.isFinite(v) && v >= 0 ? v : d; };
  const bookingOf = async (env, req, id) => {
    const b = await env.DB.prepare('SELECT b.*, i.wing, i.unit_no FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.id = ? AND b.deleted_at IS NULL').bind(Number(id)).first();
    if (!b || !(await visibleProjectIds(env, req.user)).includes(b.project_id)) return { err: bad('Booking not found.', 404) };
    return { b };
  };

  // ---------- snag: responsible work order + floor-plan pin ----------
  router.post('/api/site/snags/:id/assign', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const s = await env.DB.prepare('SELECT * FROM site_snags WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!s || !(await visibleProjectIds(env, req.user)).includes(s.project_id)) return bad('Snag not found.', 404);
      if (s.status === 'verified') return bad('This snag is already verified fixed.', 409);
      const b = await req.json().catch(() => ({}));
      const sets = [], vals = [];
      if (b.wo_id !== undefined) {
        if (b.wo_id) {
          const wo = await env.DB.prepare('SELECT id, wo_no, status, project_id FROM con_work_orders WHERE id = ?').bind(Number(b.wo_id)).first();
          if (!wo || wo.project_id !== s.project_id) return bad("That work order is not in this snag's project.");
          if (wo.status !== 'approved') return bad('Pick an approved work order.');
        }
        sets.push('wo_id = ?'); vals.push(b.wo_id ? Number(b.wo_id) : null);
      }
      if (b.category !== undefined) { if (b.category && !SNAG_CATEGORIES.includes(b.category)) return bad('Unknown snag category.'); sets.push('category = ?'); vals.push(b.category || null); }
      if (b.pin_x !== undefined || b.pin_y !== undefined) {
        const clear = b.pin_x === null && b.pin_y === null;
        const x = Math.round(Number(b.pin_x)), y = Math.round(Number(b.pin_y));
        if (!clear && !(x >= 0 && x <= 1000 && y >= 0 && y <= 1000)) return bad('The pin must sit on the floor plan.');
        sets.push('pin_x = ?', 'pin_y = ?'); vals.push(clear ? null : x, clear ? null : y);
      }
      if (b.plan_doc_id !== undefined) {
        if (b.plan_doc_id && !(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(b.plan_doc_id), s.project_id).first())) return bad('That floor-plan file was not found in this project.');
        sets.push('plan_doc_id = ?'); vals.push(b.plan_doc_id ? Number(b.plan_doc_id) : null);
      }
      if (!sets.length) return bad('Nothing to save.');
      await env.DB.prepare(`UPDATE site_snags SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, s.id).run();
      await audit(env, req.user, 'snag_assign', 'site_snags', s.id, `Snag "${String(s.title).slice(0, 60)}" updated${b.wo_id ? ' and given to a work order' : ''}${b.pin_x !== undefined && b.pin_x !== null ? ' with a floor-plan pin' : ''}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'snag-assign'); }
  }));

  // ---------- no-dues gate ----------
  router.get('/api/sales/bookings/:id/no-dues', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const r = await noDuesPoints(env, getSetting, b);
      return json({ ok: true, data: { ...r, strict: (await getSetting(env, 'sales.nodues_strict')) !== 'off', customer: b.customer_name } });
    } catch (e) { return serverError(e, 'no-dues'); }
  }));

  router.post('/api/sales/bookings/:id/handover/docs', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm', 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const ho = await env.DB.prepare('SELECT id, status FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      if (!ho) return bad('Open the handover first.', 404);
      if (ho.status === 'handed_over') return bad('The flat is already handed over.', 409);
      const body = await req.json().catch(() => ({})); const sets = [], vals = [];
      for (const k of ['letter_doc_id', 'indemnity_doc_id']) {
        if (body[k] === undefined) continue;
        if (body[k] && !(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(body[k]), b.project_id).first())) return bad('That file was not found in this project.');
        sets.push(`${k} = ?`); vals.push(body[k] ? Number(body[k]) : null);
      }
      if (!sets.length) return bad('Nothing to save.');
      await env.DB.prepare(`UPDATE sal_handover SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, ho.id).run();
      await audit(env, req.user, 'handover_docs', 'sal_handover', ho.id, `Possession letter / undertaking files updated for ${b.customer_name}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'ho-docs'); }
  }));

  // ---------- possession funds ledger ----------
  router.post('/api/sales/bookings/:id/possession-funds', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const body = await req.json().catch(() => ({}));
      if (!FUND_HEADS[body.head]) return bad('Pick what the money is for.');
      if (!['due', 'received', 'refunded'].includes(body.kind)) return bad('Pick due, received or refunded.');
      if (body.kind === 'due' ? !MONEY.includes(req.user.role) : !['owner', 'accounts'].includes(req.user.role)) return bad(body.kind === 'due' ? 'Only the Owner, PM or Accounts can set an amount due.' : 'Only the Owner or Accounts can record money received or refunded.', 403);
      const amount = Math.round(Number(body.amount_paise));
      if (!(amount > 0)) return bad('Enter the amount.');
      const on = body.on_date ? String(body.on_date) : todayIST();
      if (!isDate(on) || on > todayIST()) return bad('Enter the date as a proper date, not in the future.');
      if (body.kind !== 'due' && String(body.ref_no || '').trim().length < 3) return bad('Enter the cheque / UTR / receipt reference.');
      if (b.status === 'cancelled') return bad('This booking is cancelled.', 409);
      if (body.kind === 'refunded') {
        const cur = (await env.DB.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'received' THEN amount_paise WHEN 'refunded' THEN -amount_paise END), 0) AS held FROM sal_possession_funds WHERE booking_id = ? AND head = ? AND reversed_at IS NULL").bind(b.id, body.head).first()).held;
        if (amount > cur) return bad(`Only ${rupees(cur)} is held under this head, so that much at most can be refunded.`);
      }
      const r = await env.DB.prepare('INSERT INTO sal_possession_funds (booking_id, head, kind, amount_paise, on_date, ref_no, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(b.id, body.head, body.kind, amount, on, String(body.ref_no || '').trim().slice(0, 60) || null, String(body.note || '').trim().slice(0, 200) || null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'possession_fund', 'sal_possession_funds', r.meta.last_row_id, `${FUND_HEADS[body.head]} ${body.kind}: ${rupees(amount)} for ${b.customer_name} (${b.wing ? b.wing + '-' : ''}${b.unit_no})`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'poss-fund'); }
  }));

  router.get('/api/sales/bookings/:id/possession-funds', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const rows = (await env.DB.prepare('SELECT * FROM sal_possession_funds WHERE booking_id = ? ORDER BY on_date, id').bind(b.id).all()).results;
      const heads = {};
      for (const k of Object.keys(FUND_HEADS)) heads[k] = { label: FUND_HEADS[k], due: 0, received: 0, refunded: 0 };
      for (const r of rows) if (!r.reversed_at) heads[r.head][r.kind] += r.amount_paise;
      for (const k of Object.keys(heads)) { heads[k].balance_due = Math.max(0, heads[k].due - heads[k].received); heads[k].held = heads[k].received - heads[k].refunded; }
      return json({ ok: true, data: { rows, heads } });
    } catch (e) { return serverError(e, 'poss-fund-get'); }
  }));

  router.post('/api/sales/possession-funds/:id/reverse', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can reverse an entry.', 403);
      const f = await env.DB.prepare('SELECT f.*, b.project_id FROM sal_possession_funds f JOIN sal_bookings b ON b.id = f.booking_id WHERE f.id = ?').bind(Number(req.params.id)).first();
      if (!f || !(await visibleProjectIds(env, req.user)).includes(f.project_id)) return bad('Not found.', 404);
      if (f.reversed_at) return bad('Already reversed.', 409);
      const reason = String((await req.json().catch(() => ({}))).reason || '').trim();
      if (reason.length < 5) return bad('Write why it is being reversed.');
      await env.DB.prepare('UPDATE sal_possession_funds SET reversed_at = ?, reversed_by = ?, reverse_reason = ? WHERE id = ?').bind(nowStr(), req.user.user_id, reason.slice(0, 200), f.id).run();
      await audit(env, req.user, 'possession_fund_reverse', 'sal_possession_funds', f.id, `${FUND_HEADS[f.head]} ${f.kind} of ${rupees(f.amount_paise)} reversed: ${reason.slice(0, 120)}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'poss-fund-rev'); }
  }));

  // One line per flat and head: due, received, refunded, balance. The CA-ready ring-fenced ledger (add ?csv=1 for a file).
  router.get('/api/sales/possession-funds-report', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (!MONEY.includes(req.user.role)) return bad('Not allowed.', 403);
      const u = new URL(req.url); const pid = Number(u.searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const rows = (await env.DB.prepare(`SELECT b.id AS booking_id, b.customer_name, i.wing, i.unit_no, f.head,
          COALESCE(SUM(CASE WHEN f.kind = 'due' THEN f.amount_paise END), 0) AS due, COALESCE(SUM(CASE WHEN f.kind = 'received' THEN f.amount_paise END), 0) AS received, COALESCE(SUM(CASE WHEN f.kind = 'refunded' THEN f.amount_paise END), 0) AS refunded
        FROM sal_possession_funds f JOIN sal_bookings b ON b.id = f.booking_id JOIN sal_inventory i ON i.id = b.unit_id
        WHERE b.project_id = ? AND f.reversed_at IS NULL GROUP BY b.id, f.head ORDER BY i.wing, i.unit_no, f.head LIMIT 1500`).bind(pid).all()).results;
      const totals = {}; for (const k of Object.keys(FUND_HEADS)) totals[k] = { label: FUND_HEADS[k], due: 0, received: 0, refunded: 0, held: 0 };
      for (const r of rows) { const t = totals[r.head]; t.due += r.due; t.received += r.received; t.refunded += r.refunded; t.held += r.received - r.refunded; }
      if (u.searchParams.get('csv')) {
        const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const lines = [['Flat', 'Customer', 'Head', 'Due', 'Received', 'Refunded', 'Held'].join(','), ...rows.map((r) => [(r.wing ? r.wing + '-' : '') + r.unit_no, r.customer_name, FUND_HEADS[r.head], r.due / 100, r.received / 100, r.refunded / 100, (r.received - r.refunded) / 100].map(cell).join(','))];
        return new Response('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="possession-funds.csv"', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, data: { rows, totals } });
    } catch (e) { return serverError(e, 'poss-fund-report'); }
  }));

  // ---------- possession certificate and key handover receipt (only after possession has been given through the gate) ----------
  router.get('/api/print/possession/:id', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      if (![...MONEY, 'sales'].includes(req.user.role)) return bad('Not allowed.', 403);
      const { b, err } = await bookingOf(env, req, req.params.id); if (err) return err;
      const ho = await env.DB.prepare('SELECT * FROM sal_handover WHERE booking_id = ?').bind(b.id).first();
      if (!ho || ho.status !== 'handed_over') return bad('The certificate is made only after possession has been given. Complete the handover first (all six no-dues points must be green, or the Owner\'s written reason recorded).', 409, 'not_handed_over');
      const proj = await env.DB.prepare('SELECT name, code, rera_no FROM projects WHERE id = ?').bind(b.project_id).first();
      let pc = ho.pc_no;
      if (!pc) {
        pc = `PC-${proj.code}-${String(b.id).padStart(5, '0')}`;
        await env.DB.prepare('UPDATE sal_handover SET pc_no = ?, keys_released_on = COALESCE(keys_released_on, possession_given_on) WHERE id = ? AND pc_no IS NULL').bind(pc, ho.id).run();
      }
      const funds = await env.DB.prepare("SELECT head, COALESCE(SUM(CASE kind WHEN 'received' THEN amount_paise WHEN 'refunded' THEN -amount_paise END), 0) AS held FROM sal_possession_funds WHERE booking_id = ? AND reversed_at IS NULL GROUP BY head").bind(b.id).all();
      const months = await num(env, 'con.dlp_months', 60);
      const given = ho.possession_given_on;
      const dlpUntil = given ? new Date(Date.UTC(+given.slice(0, 4), +given.slice(5, 7) - 1 + months, +given.slice(8, 10))).toISOString().slice(0, 10) : null;
      const brand = await printBrand(env, b.project_id).catch(() => ({}));
      await audit(env, req.user, 'possession_certificate', 'sal_handover', ho.id, `Possession certificate ${pc} printed for ${b.customer_name}`);
      return json({ ok: true, data: { kind: 'possession', draft: false, brand, pc_no: pc, customer_name: b.customer_name, project: proj.name, rera_no: proj.rera_no, flat: (b.wing ? b.wing + '-' : '') + b.unit_no,
        possession_given_on: given, oc_reference: ho.oc_reference || '', dlp_until: dlpUntil, dlp_months: months, funds: funds.results.map((f) => ({ label: FUND_HEADS[f.head], held_paise: f.held })), override_note: ho.override_note || '' } });
    } catch (e) { return serverError(e, 'print-possession'); }
  }));

  // ---------- defect-liability helpdesk ----------
  const dlpWindow = async (env, unitId) => {
    if (!unitId) return null;
    const ho = await env.DB.prepare("SELECT h.possession_given_on, b.id AS booking_id FROM sal_handover h JOIN sal_bookings b ON b.id = h.booking_id WHERE b.unit_id = ? AND b.status <> 'cancelled' AND h.status = 'handed_over' ORDER BY h.id DESC LIMIT 1").bind(unitId).first();
    if (!ho || !ho.possession_given_on) return { booking_id: ho ? ho.booking_id : null, from: null, until: null };
    const months = await num(env, 'con.dlp_months', 60); const g = ho.possession_given_on;
    return { booking_id: ho.booking_id, from: g, until: new Date(Date.UTC(+g.slice(0, 4), +g.slice(5, 7) - 1 + months, +g.slice(8, 10))).toISOString().slice(0, 10) };
  };

  router.get('/api/dlp/tickets', async (req, env) => withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const u = new URL(req.url); const ids = await visibleProjectIds(env, req.user);
      let pids = ids; const pid = Number(u.searchParams.get('project_id')); if (pid) pids = ids.includes(pid) ? [pid] : [];
      if (!pids.length) return json({ ok: true, data: { tickets: [], counts: {} } });
      const st = u.searchParams.get('status');
      const rows = (await env.DB.prepare(`SELECT t.*, i.wing, i.unit_no, c.name AS contractor, w.wo_no, p.name AS project FROM dlp_tickets t JOIN projects p ON p.id = t.project_id LEFT JOIN sal_inventory i ON i.id = t.unit_id LEFT JOIN con_contractors c ON c.id = t.contractor_id LEFT JOIN con_work_orders w ON w.id = t.wo_id
        WHERE t.deleted_at IS NULL AND t.project_id IN (${pids.map(() => '?').join(',')})${['open', 'assigned', 'fixed', 'verified', 'rejected'].includes(st) ? ' AND t.status = ?' : ''} ORDER BY (t.status IN ('verified','rejected')), t.sla_due_on, t.id DESC LIMIT 300`).bind(...pids, ...(['open', 'assigned', 'fixed', 'verified', 'rejected'].includes(st) ? [st] : [])).all()).results;
      const today = todayIST(); const counts = { open: 0, overdue: 0 };
      const tickets = rows.map((t) => { const live = ['open', 'assigned'].includes(t.status); const overdue = live && t.sla_due_on && t.sla_due_on < today; if (live) counts.open++; if (overdue) counts.overdue++; return { ...t, flat: t.unit_no ? (t.wing ? t.wing + '-' : '') + t.unit_no : '', overdue }; });
      return json({ ok: true, data: { tickets, counts } });
    } catch (e) { return serverError(e, 'dlp-list'); }
  }));

  router.post('/api/dlp/tickets', async (req, env) => withAuth(req, env, 'site', 'C', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const title = String(b.title || '').trim(); if (title.length < 3) return bad('Write what the problem is.');
      const category = DLP_CATEGORIES.includes(b.category) ? b.category : 'other';
      if (b.client_uuid) { const d = await env.DB.prepare('SELECT id FROM dlp_tickets WHERE client_uuid = ?').bind(String(b.client_uuid)).first(); if (d) return json({ ok: true, data: { id: d.id, duplicate: true } }); }
      let unitId = null, bookingId = null, win = null;
      if (b.unit_id) {
        const un = await env.DB.prepare('SELECT id FROM sal_inventory WHERE id = ? AND project_id = ?').bind(Number(b.unit_id), pid).first();
        if (!un) return bad('That flat is not in this project.');
        unitId = un.id; win = await dlpWindow(env, unitId); bookingId = win ? win.booking_id : null;
      }
      const raised = todayIST(); const sla = await num(env, 'dlp.sla_days', 7);
      const r = await env.DB.prepare('INSERT INTO dlp_tickets (project_id, unit_id, booking_id, raised_by_name, raised_via, category, title, detail, raised_on, sla_due_on, client_uuid, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(pid, unitId, bookingId, String(b.raised_by_name || '').trim().slice(0, 80) || null, ['staff', 'phone', 'whatsapp', 'email'].includes(b.raised_via) ? b.raised_via : 'staff', category, title.slice(0, 120), String(b.detail || '').trim().slice(0, 600) || null, raised, plusDays(raised, sla), b.client_uuid ? String(b.client_uuid) : null, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'dlp_create', 'dlp_tickets', r.meta.last_row_id, `Defect ticket: ${title.slice(0, 80)}`);
      const out_of_dlp = !!(win && win.until && win.until < raised);
      return json({ ok: true, data: { id: r.meta.last_row_id, sla_due_on: plusDays(raised, sla), dlp_until: win ? win.until : null, out_of_dlp, warning: out_of_dlp ? `The defect liability period for this flat ended on ${win.until}. Log it, but check with your advocate before accepting it as a DLP claim.` : null } });
    } catch (e) { return serverError(e, 'dlp-create'); }
  }));

  const ticketOf = async (env, req) => {
    const t = await env.DB.prepare('SELECT * FROM dlp_tickets WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!t || !(await visibleProjectIds(env, req.user)).includes(t.project_id)) return { err: bad('Ticket not found.', 404) };
    return { t };
  };

  router.post('/api/dlp/tickets/:id/assign', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const { t, err } = await ticketOf(env, req); if (err) return err;
      if (!['owner', 'pm', 'site'].includes(req.user.role)) return bad('Not allowed.', 403);
      if (['verified', 'rejected'].includes(t.status)) return bad('This ticket is closed.', 409);
      const b = await req.json().catch(() => ({}));
      const wo = await env.DB.prepare('SELECT id, contractor_id, wo_no, project_id, status FROM con_work_orders WHERE id = ?').bind(Number(b.wo_id)).first();
      if (!wo || wo.project_id !== t.project_id || wo.status !== 'approved') return bad('Pick an approved work order of this project.');
      await env.DB.prepare("UPDATE dlp_tickets SET wo_id = ?, contractor_id = ?, status = 'assigned' WHERE id = ?").bind(wo.id, wo.contractor_id, t.id).run();
      await audit(env, req.user, 'dlp_assign', 'dlp_tickets', t.id, `Defect ticket given to work order ${wo.wo_no}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'dlp-assign'); }
  }));

  router.post('/api/dlp/tickets/:id/status', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const { t, err } = await ticketOf(env, req); if (err) return err;
      const b = await req.json().catch(() => ({})); const to = b.status;
      if (!['fixed', 'verified', 'rejected', 'open'].includes(to)) return bad('Unknown status.');
      if (['verified', 'rejected'].includes(t.status)) return bad('This ticket is closed.', 409);
      if (to === 'fixed') { if (!['open', 'assigned'].includes(t.status)) return bad('Only an open ticket can be marked fixed.', 409); }
      if (to === 'verified') { if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can verify a fix.', 403); if (t.status !== 'fixed') return bad('It must be marked fixed first.', 409); }
      if (to === 'rejected') { if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can reject a ticket.', 403); if (String(b.reject_reason || '').trim().length < 5) return bad('Write why it is being rejected.'); }
      if (to === 'open') { if (!['owner', 'pm'].includes(req.user.role) || t.status !== 'fixed') return bad('Only the PM or Owner can send a fixed ticket back.', 403); }
      await env.DB.prepare('UPDATE dlp_tickets SET status = ?, fixed_on = CASE WHEN ? = \'fixed\' THEN ? ELSE fixed_on END, verified_on = CASE WHEN ? = \'verified\' THEN ? ELSE verified_on END, reject_reason = CASE WHEN ? = \'rejected\' THEN ? ELSE reject_reason END WHERE id = ?')
        .bind(to === 'open' ? (t.wo_id ? 'assigned' : 'open') : to, to, todayIST(), to, todayIST(), to, String(b.reject_reason || '').trim().slice(0, 200), t.id).run();
      await audit(env, req.user, 'dlp_' + to, 'dlp_tickets', t.id, `Defect ticket "${String(t.title).slice(0, 60)}" ${to === 'open' ? 'sent back' : 'marked ' + to}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'dlp-status'); }
  }));

  // A contractor ignored a genuine ticket past its SLA: an outside vendor repairs it and the cost is held against that contractor's retention.
  router.post('/api/dlp/tickets/:id/backcharge', async (req, env) => withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const { t, err } = await ticketOf(env, req); if (err) return err;
      if (!MONEY.includes(req.user.role)) return bad('Only the Owner, PM or Accounts can raise a back-charge.', 403);
      if (!t.wo_id) return bad('Give the ticket to the contractor\'s work order first.', 409);
      if (!['open', 'assigned', 'fixed'].includes(t.status)) return bad('This ticket is closed.', 409);
      if (t.backcharge_status) return bad('A back-charge is already on this ticket.', 409);
      if (!(t.sla_due_on && t.sla_due_on < todayIST())) return bad(`The contractor still has time: the ${await num(env, 'dlp.sla_days', 7)}-day limit ends on ${t.sla_due_on}.`, 409, 'sla');
      const b = await req.json().catch(() => ({}));
      const amount = Math.round(Number(b.amount_paise)); const vendor = String(b.repair_vendor || '').trim();
      if (!(amount > 0)) return bad('Enter the repair cost.'); if (vendor.length < 3) return bad("Enter the outside repair vendor's name.");
      const held = (await env.DB.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'retention_held' THEN amount_paise WHEN 'retention_released' THEN -amount_paise END), 0) AS h FROM con_ledger WHERE wo_id = ?").bind(t.wo_id).first()).h;
      const pend = (await env.DB.prepare("SELECT COALESCE(SUM(backcharge_paise), 0) AS p FROM dlp_tickets WHERE wo_id = ? AND backcharge_status = 'pending' AND deleted_at IS NULL").bind(t.wo_id).first()).p;
      if (amount > held - pend) return bad(`Only ${rupees(Math.max(0, held - pend))} of retention is free to hold against on this work order.`, 409);
      await env.DB.prepare("UPDATE dlp_tickets SET repair_vendor = ?, backcharge_paise = ?, backcharge_status = 'pending', backcharge_note = ? WHERE id = ?").bind(vendor.slice(0, 80), amount, String(b.note || '').trim().slice(0, 200) || null, t.id).run();
      await audit(env, req.user, 'dlp_backcharge', 'dlp_tickets', t.id, `Back-charge of ${rupees(amount)} held against retention (repair by ${vendor.slice(0, 60)})`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'dlp-backcharge'); }
  }));

  // Accounts confirms the repair bill: the amount leaves the contractor's retention balance (a ledger row), so it cannot be released to them.
  router.post('/api/dlp/tickets/:id/backcharge/clear', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const { t, err } = await ticketOf(env, req); if (err) return err;
      if (!['owner', 'accounts'].includes(req.user.role)) return bad('Only the Owner or Accounts can confirm a back-charge.', 403);
      if (t.backcharge_status !== 'pending') return bad('There is no pending back-charge on this ticket.', 409);
      const wo = await env.DB.prepare('SELECT id, contractor_id, project_id FROM con_work_orders WHERE id = ?').bind(t.wo_id).first();
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE dlp_tickets SET backcharge_status = 'cleared' WHERE id = ? AND backcharge_status = 'pending'").bind(t.id),
        env.DB.prepare("INSERT INTO con_ledger (contractor_id, project_id, wo_id, kind, amount_paise, ref_table, ref_id, created_at) SELECT ?, ?, ?, 'retention_released', ?, 'dlp_backcharge', ?, ? WHERE changes() > 0").bind(wo.contractor_id, wo.project_id, wo.id, t.backcharge_paise, t.id, nowStr()),
      ]);
      if (!res[1].meta.changes) return bad('Already confirmed.', 409);
      // the numbered debit note for the contractor
      const pr = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(t.project_id).first(); const key = `dn:${t.project_id}`;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1').bind(key),
        env.DB.prepare("UPDATE dlp_tickets SET debit_no = ?1 || printf('%04d', (SELECT value FROM counters WHERE key = ?2)), debit_on = ?3 WHERE id = ?4 AND debit_no IS NULL").bind(`DN-${pr.code}-`, key, todayIST(), t.id),
      ]);
      await audit(env, req.user, 'dlp_backcharge_clear', 'dlp_tickets', t.id, `Back-charge of ${rupees(t.backcharge_paise)} deducted from the contractor's retention`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'dlp-backcharge-clear'); }
  }));

  // ---------- society (CHS) handover vault ----------
  const projOf = async (env, req, id) => { const pid = Number(id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return null; return pid; };
  router.get('/api/chs/vault', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = await projOf(env, req, new URL(req.url).searchParams.get('project_id')); if (!pid) return bad('Pick a project.');
      let items = (await env.DB.prepare('SELECT v.*, d.title AS doc_title FROM chs_vault_items v LEFT JOIN documents d ON d.id = v.document_id WHERE v.project_id = ? AND v.deleted_at IS NULL ORDER BY v.sort_order, v.id').bind(pid).all()).results;
      const progress = { required: 0, uploaded: 0, acknowledged: 0 };
      for (const it of items) if (it.required) { progress.required++; if (it.document_id) progress.uploaded++; if (it.ack_on) progress.acknowledged++; }
      const block = await vaultBlock(env, pid);
      return json({ ok: true, data: { items, progress, complete: !block, block, empty: !items.length } });
    } catch (e) { return serverError(e, 'chs-vault'); }
  }));

  router.post('/api/chs/vault/load-defaults', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const pid = await projOf(env, req, (await req.json().catch(() => ({}))).project_id); if (!pid) return bad('Pick a project.');
      const have = new Set((await env.DB.prepare('SELECT label FROM chs_vault_items WHERE project_id = ? AND deleted_at IS NULL').bind(pid).all()).results.map((r) => r.label));
      const add = CHS_DEFAULTS.filter(([l]) => !have.has(l)); const n0 = have.size;
      if (add.length) await env.DB.batch(add.map(([label, kind], i) => env.DB.prepare('INSERT INTO chs_vault_items (project_id, label, kind, required, sort_order, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)').bind(pid, label, kind, n0 + i, req.user.user_id, nowStr())));
      await audit(env, req.user, 'chs_defaults', 'projects', pid, `Society handover checklist loaded (${add.length} items added)`);
      return json({ ok: true, data: { added: add.length } });
    } catch (e) { return serverError(e, 'chs-defaults'); }
  }));

  router.post('/api/chs/vault', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({})); const pid = await projOf(env, req, b.project_id); if (!pid) return bad('Pick a project.');
      const label = String(b.label || '').trim(); if (label.length < 3) return bad('Name the document or equipment.');
      const r = await env.DB.prepare('INSERT INTO chs_vault_items (project_id, label, kind, required, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, 999, ?, ?)').bind(pid, label.slice(0, 120), b.kind === 'amc' ? 'amc' : 'document', b.required === false ? 0 : 1, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'chs_item', 'chs_vault_items', r.meta.last_row_id, `Society vault item added: ${label.slice(0, 80)}`);
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'chs-add'); }
  }));

  const itemOf = async (env, req) => {
    const it = await env.DB.prepare('SELECT * FROM chs_vault_items WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!it || !(await visibleProjectIds(env, req.user)).includes(it.project_id)) return { err: bad('Item not found.', 404) };
    return { it };
  };
  router.put('/api/chs/vault/:id', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const { it, err } = await itemOf(env, req); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (b.document_id) {
        if (!(await env.DB.prepare('SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL AND project_id = ?').bind(Number(b.document_id), it.project_id).first())) return bad('That file was not found in this project.');
        // a replaced file needs the secretary to acknowledge again
        await env.DB.prepare('UPDATE chs_vault_items SET document_id = ?, uploaded_on = ?, ack_by_name = NULL, ack_on = NULL WHERE id = ?').bind(Number(b.document_id), todayIST(), it.id).run();
      }
      if (b.valid_till !== undefined) { if (b.valid_till && !isDate(b.valid_till)) return bad('Enter the date as a proper date.'); await env.DB.prepare('UPDATE chs_vault_items SET valid_till = ? WHERE id = ?').bind(b.valid_till || null, it.id).run(); }
      if (b.note !== undefined) await env.DB.prepare('UPDATE chs_vault_items SET note = ? WHERE id = ?').bind(String(b.note).trim().slice(0, 200) || null, it.id).run();
      if (b.required !== undefined && req.user.role === 'owner') await env.DB.prepare('UPDATE chs_vault_items SET required = ? WHERE id = ?').bind(b.required ? 1 : 0, it.id).run();
      await audit(env, req.user, 'chs_item_update', 'chs_vault_items', it.id, `Society vault item "${it.label.slice(0, 60)}" updated${b.document_id ? ' (file attached)' : ''}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-update'); }
  }));
  router.post('/api/chs/vault/:id/ack', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const { it, err } = await itemOf(env, req); if (err) return err;
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the PM or Owner can record the secretary\'s acknowledgement.', 403);
      if (!it.document_id) return bad('Attach the file first.', 409);
      const who = String((await req.json().catch(() => ({}))).ack_by_name || '').trim(); if (who.length < 3) return bad("Type the society secretary's name.");
      await env.DB.prepare('UPDATE chs_vault_items SET ack_by_name = ?, ack_on = ? WHERE id = ?').bind(who.slice(0, 80), todayIST(), it.id).run();
      await audit(env, req.user, 'chs_ack', 'chs_vault_items', it.id, `"${it.label.slice(0, 60)}" acknowledged by ${who.slice(0, 60)} for the society`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-ack'); }
  }));
  router.delete('/api/chs/vault/:id', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      const { it, err } = await itemOf(env, req); if (err) return err;
      if (req.user.role !== 'owner') return bad('Only the Owner can remove an item.', 403);
      await env.DB.prepare('UPDATE chs_vault_items SET deleted_at = ? WHERE id = ?').bind(nowStr(), it.id).run();
      await audit(env, req.user, 'chs_item_remove', 'chs_vault_items', it.id, `Society vault item removed: ${it.label.slice(0, 80)}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'chs-remove'); }
  }));
}
