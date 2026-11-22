// routes/rera.js — WP-15: the project's RERA designated account: required deposit vs deposited vs withdrawn, and the gap.
// The required percentage is a setting (rera.designated_pct_bp, default 7000 = 70%). It is not asserted here as law: confirm the current rule and the
// certification needed for withdrawals with your CA / advocate. There is no bank link: Accounts records what the bank statement shows.
import { procurementByHead } from './procurement2.js';
import { contractsByHead } from './contractors.js';

const rupees = (p) => '₹' + Math.round(Number(p) / 100).toLocaleString('en-IN');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const BAL_SQL = "COALESCE((SELECT SUM(CASE kind WHEN 'deposit' THEN amount_paise ELSE -amount_paise END) FROM rera_account_entries WHERE project_id = ?1 AND reversed_at IS NULL), 0)";

export async function reraPctBp(env, getSetting) { const v = Math.round(num(await getSetting(env, 'rera.designated_pct_bp'))); return v > 0 && v <= 10000 ? v : 7000; }

// Weekly reminder (Monday after 9 am IST) when a project has deposited less than required, and a quarterly one. One statement each; once per day.
export async function reraSweep(env, getSetting) {
  const ist = new Date(Date.now() + 19800000);
  if (ist.getUTCDay() !== 1 || ist.getUTCHours() < 9) return;
  const pct = await reraPctBp(env, getSetting);
  await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
    SELECT u.id, 'RERA account: deposit gap at ' || p.name, 'Required about ₹' || (x.req / 100) || ', deposited ₹' || (x.dep / 100) || '. Check the bank statement and record the deposit.', 'rera', datetime('now')
    FROM (SELECT p.id AS pid,
            (SELECT COALESCE(SUM(r.amount_paise + r.tds_paise), 0) FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE b.project_id = p.id AND r.reversed_at IS NULL AND r.kind = 'principal') * ?1 / 10000 AS req,
            (SELECT COALESCE(SUM(amount_paise), 0) FROM rera_account_entries e WHERE e.project_id = p.id AND e.kind = 'deposit' AND e.reversed_at IS NULL) AS dep
          FROM projects p WHERE p.deleted_at IS NULL) x
    JOIN projects p ON p.id = x.pid JOIN users u ON u.role IN ('owner', 'accounts') AND u.active = 1 AND u.deleted_at IS NULL
    WHERE x.req > x.dep AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'RERA account: deposit gap at ' || p.name AND date(n.created_at) = date('now'))`).bind(pct).run();
  if ([1, 4, 7, 10].includes(ist.getUTCMonth() + 1) && ist.getUTCDate() <= 7) {
    await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, 'RERA quarterly: designated-account certificate', 'Ask your CA whether the quarterly certificate and statement for each project are due. Confirm the requirement with your CA / advocate.', 'rera', datetime('now')
      FROM users u WHERE u.role IN ('owner', 'accounts', 'pm') AND u.active = 1 AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'RERA quarterly: designated-account certificate' AND date(n.created_at) = date('now'))`).run();
  }
}

export function registerRera(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, csvBom } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'rera_account_entries', id || 0, String(summary).slice(0, 300), nowStr());
  const todayIST = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);
  const f2 = (p) => (Number(p) / 100).toFixed(2);

  async function projectOk(env, req, pid) { return pid > 0 && (await visibleProjectIds(env, req.user)).includes(pid); }

  async function summary(env, pid) {
    const pct = await reraPctBp(env, getSetting);
    const [rec, ent, proj, po, con] = await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(r.amount_paise + r.tds_paise), 0) AS realised FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE b.project_id = ? AND r.reversed_at IS NULL AND r.kind = 'principal'").bind(pid).first(),
      env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_paise END), 0) AS dep, COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN amount_paise END), 0) AS wd FROM rera_account_entries WHERE project_id = ? AND reversed_at IS NULL").bind(pid).first(),
      env.DB.prepare('SELECT name, percent_complete FROM projects WHERE id = ?').bind(pid).first(),
      procurementByHead(env, pid, true), contractsByHead(env, pid, true),
    ]);
    const cost = Object.values(po).reduce((t, x) => t + x.billed, 0) + Object.values(con).reduce((t, x) => t + x.billed, 0);
    const required = Math.round((rec.realised * pct) / 10000);
    const complete = Number(proj.percent_complete) || 0;
    return { project: proj.name, pct_bp: pct, realised_paise: rec.realised, required_paise: required, deposited_paise: ent.dep, withdrawn_paise: ent.wd, balance_paise: ent.dep - ent.wd,
      gap_paise: Math.max(0, required - ent.dep), excess_paise: Math.max(0, ent.dep - required), cost_incurred_paise: cost, percent_complete: complete, completion_estimate_paise: Math.round((ent.dep * complete) / 100),
      note: 'Confirm the current MahaRERA percentage and the certificates needed for withdrawals with your CA / advocate. These figures come from what is recorded in the CRM.' };
  }

  router.get('/api/rera/summary', async (req, env) => withAuth(req, env, 'rera', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      return json({ ok: true, data: await summary(env, pid) });
    } catch (e) { return serverError(e, 'rera-summary'); }
  }));

  router.get('/api/rera/entries', async (req, env) => withAuth(req, env, 'rera', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const pid = Number(q.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const rows = (await env.DB.prepare('SELECT e.*, u.name AS by_name FROM rera_account_entries e LEFT JOIN users u ON u.id = e.created_by WHERE e.project_id = ? ORDER BY e.entry_date DESC, e.id DESC LIMIT 300').bind(pid).all()).results;
      if (q.get('csv')) {
        if (!userCanX(req.user)) return json({ ok: false, error: 'Not allowed.' }, 403);
        const s = await summary(env, pid);
        return new Response(csvBom([['Date', 'Kind', 'Amount', 'Bank reference', 'Certificate', 'Note', 'Recorded by', 'Status'], ...rows.map((r) => [r.entry_date, r.kind, f2(r.amount_paise), r.ref_no || '', r.cert_ref || '', r.note || '', r.by_name || '', r.reversed_at ? 'Reversed: ' + (r.reversal_note || '') : 'Active']),
          [], ['Project', s.project], [`Required deposit (${(s.pct_bp / 100).toFixed(1)}% of ${f2(s.realised_paise)} realised)`, f2(s.required_paise)], ['Deposited', f2(s.deposited_paise)], ['Withdrawn', f2(s.withdrawn_paise)], ['Balance in account', f2(s.balance_paise)], ['Still to deposit', f2(s.gap_paise)], ['Note', s.note]]),
          { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rera-account-statement.csv"', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, data: { entries: rows } });
    } catch (e) { return serverError(e, 'rera-entries'); }
  }));
  const userCanX = (u) => ['owner', 'accounts', 'viewer'].includes(u.role);

  router.post('/api/rera/entries', async (req, env) => withAuth(req, env, 'rera', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id), kind = b.kind, amount = Math.round(num(b.amount_paise));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      if (!['deposit', 'withdrawal'].includes(kind)) return json({ ok: false, error: 'Pick deposit or withdrawal.' }, 400);
      if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount.' }, 400);
      const date = b.entry_date && /^\d{4}-\d{2}-\d{2}$/.test(b.entry_date) ? b.entry_date : todayIST();
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id FROM rera_account_entries WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const before = await summary(env, pid);
      // A withdrawal can never take the account below zero: the guard is part of the insert itself, so two at once cannot both pass.
      const r = await env.DB.prepare(`INSERT INTO rera_account_entries (project_id, entry_date, kind, amount_paise, ref_no, cert_ref, note, created_by, created_at, client_uuid)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE ?3 = 'deposit' OR ${BAL_SQL} >= ?4`)
        .bind(pid, date, kind, amount, String(b.ref_no || '').slice(0, 60), String(b.cert_ref || '').slice(0, 120), String(b.note || '').slice(0, 300), req.user.user_id, nowStr(), uuid).run();
      if (!r.meta.changes) return json({ ok: false, error: `Only ${rupees(before.balance_paise)} is in the designated account according to the records. A withdrawal cannot be more than that.` }, 400);
      await audit(env, req.user, kind, r.meta.last_row_id, `RERA account ${kind} ${rupees(amount)}${b.ref_no ? ' (' + b.ref_no + ')' : ''} for ${before.project}`).run();
      const warnings = [];
      if (kind === 'withdrawal') {
        const wd = before.withdrawn_paise + amount;
        if (!String(b.cert_ref || '').trim()) warnings.push('No certificate reference was recorded for this withdrawal. Keep the CA / engineer / architect certificate on file.');
        if (wd > before.completion_estimate_paise) warnings.push(`Total withdrawn (${rupees(wd)}) is more than the deposited amount in proportion to the recorded completion of ${before.percent_complete}% (${rupees(before.completion_estimate_paise)}). Confirm with your CA.`);
        if (wd > before.cost_incurred_paise) warnings.push(`Total withdrawn (${rupees(wd)}) is more than the project cost recorded in the CRM (${rupees(before.cost_incurred_paise)}).`);
      }
      return json({ ok: true, data: { id: r.meta.last_row_id, warnings } });
    } catch (e) { return serverError(e, 'rera-entry'); }
  }));

  router.post('/api/rera/entries/:id/reverse', async (req, env) => withAuth(req, env, 'rera', 'E', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can reverse an entry.' }, 403);
      const e = await env.DB.prepare('SELECT * FROM rera_account_entries WHERE id = ?').bind(Number(req.params.id)).first();
      if (!e || !(await projectOk(env, req, e.project_id))) return json({ ok: false, error: 'Entry not found.' }, 404);
      const b = await req.json().catch(() => ({}));
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why it is reversed.' }, 400);
      // Reversing a deposit must not leave the account negative.
      const r = await env.DB.prepare(`UPDATE rera_account_entries SET reversed_at = ?1, reversed_by = ?2, reversal_note = ?3 WHERE id = ?4 AND reversed_at IS NULL
        AND (kind = 'withdrawal' OR (SELECT COALESCE(SUM(CASE kind WHEN 'deposit' THEN amount_paise ELSE -amount_paise END), 0) FROM rera_account_entries WHERE project_id = ?5 AND reversed_at IS NULL) - ?6 >= 0)`)
        .bind(nowStr(), req.user.user_id, String(b.reason).slice(0, 200), e.id, e.project_id, e.amount_paise).run();
      if (!r.meta.changes) return json({ ok: false, error: e.reversed_at ? 'Already reversed.' : 'Reversing this deposit would leave less in the account than has been withdrawn. Reverse the withdrawal first.' }, 409);
      await audit(env, req.user, 'reverse', e.id, `Reversed RERA ${e.kind} ${rupees(e.amount_paise)}: ${String(b.reason).slice(0, 100)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'rera-reverse'); }
  }));
}
