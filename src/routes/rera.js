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
    const lc = (await env.DB.prepare(`SELECT (SELECT pct_complete_bp FROM rera_certificates WHERE project_id = ?1 AND kind = 'architect' AND cancelled_at IS NULL ORDER BY cert_date DESC, id DESC LIMIT 1) AS a,
      (SELECT pct_complete_bp FROM rera_certificates WHERE project_id = ?1 AND kind = 'engineer' AND cancelled_at IS NULL ORDER BY cert_date DESC, id DESC LIMIT 1) AS e`).bind(pid).first());
    const certBp = lc.a != null && lc.e != null ? Math.min(lc.a, lc.e) : null;
    const required = Math.round((rec.realised * pct) / 10000);
    const complete = Number(proj.percent_complete) || 0;
    return { project: proj.name, pct_bp: pct, realised_paise: rec.realised, required_paise: required, deposited_paise: ent.dep, withdrawn_paise: ent.wd, balance_paise: ent.dep - ent.wd,
      gap_paise: Math.max(0, required - ent.dep), excess_paise: Math.max(0, ent.dep - required), cost_incurred_paise: cost, percent_complete: complete, completion_estimate_paise: Math.round((ent.dep * complete) / 100), certified_pct_bp: certBp, certified_limit_paise: certBp == null ? 0 : Math.round((ent.dep * certBp) / 10000), can_withdraw_paise: certBp == null ? 0 : Math.max(0, Math.min(ent.dep - ent.wd, Math.round((ent.dep * certBp) / 10000) - ent.wd)),
      note: 'A withdrawal needs the architect\'s, engineer\'s and CA\'s certificates. Confirm the current MahaRERA percentage and rules with your CA / advocate. These figures come from what is recorded in the CRM.' };
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

  // ----- certificates behind withdrawals: architect (% done), engineer (% done), CA (amount that may be withdrawn) -----
  const KINDS = { architect: 'Architect', engineer: 'Engineer', ca: 'CA' };
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  async function validDays(env) { const v = Math.round(num(await getSetting(env, 'rera.cert_valid_days'))); return v > 0 ? v : 90; }

  // All three certificates must be named, belong to this project, be dated on or before the withdrawal and not be too old.
  // The withdrawal may not take the total withdrawn above deposits x the certified % of work done (the lower of architect and engineer),
  // nor above what the CA certified (less what was already withdrawn against that CA certificate).
  async function withdrawalCerts(env, pid, b, date, amount, before) {
    const ids = { arch: Number(b.architect_cert_id) || 0, eng: Number(b.engineer_cert_id) || 0, ca: Number(b.ca_cert_id) || 0 };
    if (!ids.arch || !ids.eng || !ids.ca) return { error: 'A withdrawal needs three certificates: the architect\'s, the engineer\'s and the CA\'s. Record them first (Certificates), then pick them here.' };
    const rows = (await env.DB.prepare('SELECT c.*, (SELECT COALESCE(SUM(amount_paise), 0) FROM rera_account_entries e WHERE e.ca_cert_id = c.id AND e.kind = \'withdrawal\' AND e.reversed_at IS NULL) AS used FROM rera_certificates c WHERE c.id IN (?, ?, ?) AND c.project_id = ? AND c.cancelled_at IS NULL')
      .bind(ids.arch, ids.eng, ids.ca, pid).all()).results;
    const get = (id, kind) => rows.find((r) => r.id === id && r.kind === kind);
    const arch = get(ids.arch, 'architect'), eng = get(ids.eng, 'engineer'), ca = get(ids.ca, 'ca');
    if (!arch || !eng || !ca) return { error: 'Pick an architect\'s, an engineer\'s and a CA\'s certificate of this project.' };
    const days = await validDays(env);
    for (const c of [arch, eng, ca]) {
      if (c.cert_date > date) return { error: `The ${KINDS[c.kind]}'s certificate (${c.cert_no}) is dated after this withdrawal.` };
      if (addDays(c.cert_date, days) < date) return { error: `The ${KINDS[c.kind]}'s certificate (${c.cert_no}, ${c.cert_date}) is older than ${days} days. Get a fresh certificate.` };
    }
    const left = (ca.amount_paise || 0) - ca.used;
    if (amount > left) return { error: `The CA's certificate ${ca.cert_no} allows ${rupees(ca.amount_paise)}; ${rupees(Math.max(0, left))} of it is left.` };
    const pct = Math.min(arch.pct_complete_bp, eng.pct_complete_bp);
    const cap = Math.round((before.deposited_paise * pct) / 10000);
    if (before.withdrawn_paise + amount > cap) return { error: `Total withdrawn would be ${rupees(before.withdrawn_paise + amount)}, but at ${(pct / 100).toFixed(2)}% certified work done only ${rupees(cap)} of the ${rupees(before.deposited_paise)} deposited may be withdrawn in total.` };
    return { arch, eng, ca, cap, ref: `Architect ${arch.cert_no}; Engineer ${eng.cert_no}; CA ${ca.cert_no}`.slice(0, 120) };
  }

  router.get('/api/rera/certificates', async (req, env) => withAuth(req, env, 'rera', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      const rows = (await env.DB.prepare(`SELECT c.*, u.name AS by_name, (SELECT COALESCE(SUM(amount_paise), 0) FROM rera_account_entries e WHERE e.ca_cert_id = c.id AND e.kind = 'withdrawal' AND e.reversed_at IS NULL) AS used_paise
        FROM rera_certificates c LEFT JOIN users u ON u.id = c.created_by WHERE c.project_id = ? ORDER BY c.cert_date DESC, c.id DESC LIMIT 200`).bind(pid).all()).results;
      return json({ ok: true, data: { certificates: rows, valid_days: await validDays(env) } });
    } catch (e) { return serverError(e, 'rera-certs'); }
  }));

  router.post('/api/rera/certificates', async (req, env) => withAuth(req, env, 'rera', 'C', async (req, env) => {
    try {
      const b = await req.json(); const pid = Number(b.project_id);
      if (!(await projectOk(env, req, pid))) return json({ ok: false, error: 'Pick a project.' }, 400);
      if (!KINDS[b.kind]) return json({ ok: false, error: 'Pick architect, engineer or CA.' }, 400);
      const no = String(b.cert_no || '').trim().slice(0, 80);
      if (!no) return json({ ok: false, error: 'Enter the certificate number.' }, 400);
      const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
      if (!isDate(b.cert_date) || b.cert_date > today) return json({ ok: false, error: 'Enter the certificate date (not in the future).' }, 400);
      let pct = null, amt = null;
      if (b.kind === 'ca') { amt = Math.round(num(b.amount_paise)); if (!(amt > 0)) return json({ ok: false, error: 'Enter the amount the CA certifies may be withdrawn.' }, 400); }
      else { pct = Math.round(num(b.pct_complete) * 100); if (!(pct > 0 && pct <= 10000)) return json({ ok: false, error: 'Enter the % of work done the certificate states (1 to 100).' }, 400); }
      const doc = Number(b.document_id) || 0;
      if (!doc || !(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL AND (project_id = ? OR project_id IS NULL)').bind(doc, pid).first())) return json({ ok: false, error: 'Attach the certificate (photo or PDF).' }, 400);
      if (await env.DB.prepare('SELECT 1 AS x FROM rera_certificates WHERE project_id = ? AND kind = ? AND lower(cert_no) = lower(?) AND cancelled_at IS NULL').bind(pid, b.kind, no).first()) return json({ ok: false, error: 'That certificate is already recorded.' }, 409);
      const now = nowStr();
      const stmts = [
        env.DB.prepare('INSERT INTO rera_certificates (project_id, kind, cert_no, cert_date, issued_by, pct_complete_bp, amount_paise, document_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(pid, b.kind, no, b.cert_date, String(b.issued_by || '').slice(0, 120) || null, pct, amt, doc, String(b.note || '').slice(0, 300) || null, req.user.user_id, now),
        audit(env, req.user, 'certificate', 0, `RERA ${KINDS[b.kind]} certificate ${no} dated ${b.cert_date}: ${pct != null ? (pct / 100) + '% work done' : rupees(amt) + ' may be withdrawn'}`),
      ];
      // the architect's certificate is the project's certified completion
      if (b.kind === 'architect') stmts.push(env.DB.prepare('UPDATE projects SET percent_complete = ? WHERE id = ?').bind(Math.floor(pct / 100), pid));
      const res = await env.DB.batch(stmts);
      return json({ ok: true, data: { id: res[0].meta.last_row_id } });
    } catch (e) { return serverError(e, 'rera-cert-add'); }
  }));

  router.post('/api/rera/certificates/:id/cancel', async (req, env) => withAuth(req, env, 'rera', 'E', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can cancel a certificate entry.' }, 403);
      const c = await env.DB.prepare('SELECT * FROM rera_certificates WHERE id = ?').bind(Number(req.params.id)).first();
      if (!c || !(await projectOk(env, req, c.project_id))) return json({ ok: false, error: 'Certificate not found.' }, 404);
      const b = await req.json().catch(() => ({}));
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why.' }, 400);
      if (await env.DB.prepare("SELECT 1 AS x FROM rera_account_entries WHERE (architect_cert_id = ?1 OR engineer_cert_id = ?1 OR ca_cert_id = ?1) AND reversed_at IS NULL LIMIT 1").bind(c.id).first()) return json({ ok: false, error: 'A withdrawal relies on this certificate. Reverse the withdrawal first.' }, 409);
      const r = await env.DB.prepare('UPDATE rera_certificates SET cancelled_at = ?, cancelled_by = ?, cancel_note = ? WHERE id = ? AND cancelled_at IS NULL').bind(nowStr(), req.user.user_id, String(b.reason).slice(0, 200), c.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'Already cancelled.' }, 409);
      await audit(env, req.user, 'cancel', 0, `RERA ${KINDS[c.kind]} certificate ${c.cert_no} cancelled: ${String(b.reason).slice(0, 100)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'rera-cert-cancel'); }
  }));

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
      let certs = null;
      if (kind === 'withdrawal') { const c = await withdrawalCerts(env, pid, b, date, amount, before); if (c.error) return json({ ok: false, error: c.error, code: 'certificates' }, 400); certs = c; }
      // A withdrawal can never take the account below zero: the guard is part of the insert itself, so two at once cannot both pass.
      const r = await env.DB.prepare(`INSERT INTO rera_account_entries (project_id, entry_date, kind, amount_paise, ref_no, cert_ref, note, created_by, created_at, client_uuid, architect_cert_id, engineer_cert_id, ca_cert_id)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13 WHERE ?3 = 'deposit' OR (${BAL_SQL} >= ?4
          AND ?4 + COALESCE((SELECT SUM(amount_paise) FROM rera_account_entries WHERE ca_cert_id = ?13 AND kind = 'withdrawal' AND reversed_at IS NULL), 0) <= (SELECT amount_paise FROM rera_certificates WHERE id = ?13 AND cancelled_at IS NULL)
          AND ?4 + COALESCE((SELECT SUM(amount_paise) FROM rera_account_entries WHERE project_id = ?1 AND kind = 'withdrawal' AND reversed_at IS NULL), 0) <= ?14)`)
        .bind(pid, date, kind, amount, String(b.ref_no || '').slice(0, 60), certs ? certs.ref : String(b.cert_ref || '').slice(0, 120), String(b.note || '').slice(0, 300), req.user.user_id, nowStr(), uuid,
          certs ? certs.arch.id : null, certs ? certs.eng.id : null, certs ? certs.ca.id : null, certs ? certs.cap : 0).run();
      if (!r.meta.changes) return json({ ok: false, error: before.balance_paise < amount ? `Only ${rupees(before.balance_paise)} is in the designated account according to the records. A withdrawal cannot be more than that.` : 'Another withdrawal was recorded at the same moment; this one no longer fits the CA certificate or the certified work done. Reload and check.' }, 400);
      await audit(env, req.user, kind, r.meta.last_row_id, `RERA account ${kind} ${rupees(amount)}${b.ref_no ? ' (' + b.ref_no + ')' : ''} for ${before.project}`).run();
      const warnings = [];
      if (kind === 'withdrawal') {
        const wd = before.withdrawn_paise + amount;
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
