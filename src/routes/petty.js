// routes/petty.js — WP-10: site petty cash. A fund per custodian; expenses wait for PM approval; top-ups are entered by Accounts.
// Balance = opening + approved top-ups - approved expenses - approved returns. Nothing is deleted: entries are cancelled with a reason.

const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const KINDS = ['expense', 'top_up', 'return'];
const BAL = `f.opening_paise + COALESCE(SUM(CASE WHEN e.status = 'approved' THEN CASE e.kind WHEN 'top_up' THEN e.amount_paise ELSE -e.amount_paise END END), 0)`;
const PEND = `COALESCE(SUM(CASE WHEN e.status = 'submitted' AND e.kind != 'top_up' THEN e.amount_paise END), 0)`;

export function registerPetty(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, csvBom } = h;
  const audit = (env, user, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, 'pty_entries', id || 0, String(summary).slice(0, 300), nowStr());
  const csvResponse = (name, rows) => new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  const todayIST = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);

  async function notifyUsers(env, ids, title, body) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return;
    const now = nowStr();
    await env.DB.batch(list.map((id) => env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, title, body, 'petty', now)));
  }
  async function roleIds(env, roles) { return (await env.DB.prepare(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND active = 1 AND deleted_at IS NULL LIMIT 20`).bind(...roles).all()).results.map((r) => r.id); }

  // A fund is visible to its custodian, and to Owner/PM/Accounts for projects they can see.
  async function loadFund(env, req, id) {
    const f = await env.DB.prepare(`SELECT f.*, p.name AS project, u.name AS custodian, ${BAL} AS balance_paise, ${PEND} AS pending_paise
      FROM pty_funds f JOIN projects p ON p.id = f.project_id LEFT JOIN users u ON u.id = f.custodian_user_id LEFT JOIN pty_entries e ON e.fund_id = f.id WHERE f.id = ? GROUP BY f.id`).bind(id).first();
    if (!f || f.id == null) return { err: json({ ok: false, error: 'Fund not found.' }, 404) };
    const own = f.custodian_user_id === req.user.user_id;
    if (!own && (req.user.role === 'site' || !(await visibleProjectIds(env, req.user)).includes(f.project_id))) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
    return { fund: f, own };
  }

  // People who can hold petty cash (for the "open a fund" form). Names only.
  router.get('/api/petty/custodians', async (req, env) => withAuth(req, env, 'petty', 'C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      return json({ ok: true, data: { users: (await env.DB.prepare("SELECT id, name, role FROM users WHERE role IN ('site', 'pm') AND active = 1 AND deleted_at IS NULL ORDER BY name LIMIT 100").all()).results } });
    } catch (e) { return serverError(e, 'pty-custodians'); }
  }));

  router.post('/api/petty/funds', async (req, env) => withAuth(req, env, 'petty', 'C', async (req, env) => {
    try {
      if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only the Owner, PM or Accounts can open a petty-cash fund.' }, 403);
      const b = await req.json(); const pid = Number(b.project_id), cust = Number(b.custodian_user_id), opening = Math.round(num(b.opening_paise));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Pick a project.' }, 400);
      const u = await env.DB.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(cust).first();
      if (!u) return json({ ok: false, error: 'Pick who will hold the cash.' }, 400);
      if (opening < 0) return json({ ok: false, error: 'Opening cash cannot be negative.' }, 400);
      const r = await env.DB.prepare('INSERT INTO pty_funds (project_id, custodian_user_id, opening_paise, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(pid, cust, opening, req.user.user_id, nowStr()).run();
      await audit(env, req.user, 'create', r.meta.last_row_id, `Petty-cash fund opened for ${u.name}: ${rupees(opening)}`).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'pty-fund'); }
  }));

  router.get('/api/petty/funds', async (req, env) => withAuth(req, env, 'petty', 'V', async (req, env) => {
    try {
      let where = 'f.active = 1', args = [];
      if (req.user.role === 'site') { where += ' AND f.custodian_user_id = ?'; args = [req.user.user_id]; }
      else { const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { funds: [] } }); where += ` AND f.project_id IN (${ids.map(() => '?').join(',')})`; args = ids; }
      const rows = (await env.DB.prepare(`SELECT f.id, f.project_id, f.custodian_user_id, f.opening_paise, p.name AS project, u.name AS custodian, ${BAL} AS balance_paise, ${PEND} AS pending_paise
        FROM pty_funds f JOIN projects p ON p.id = f.project_id LEFT JOIN users u ON u.id = f.custodian_user_id LEFT JOIN pty_entries e ON e.fund_id = f.id WHERE ${where} GROUP BY f.id ORDER BY p.name LIMIT 100`).bind(...args).all()).results;
      const low = num(await getSetting(env, 'petty.low_balance_paise')) || 100000;
      for (const r of rows) r.low = r.balance_paise < low;
      return json({ ok: true, data: { funds: rows, low_balance_paise: low } });
    } catch (e) { return serverError(e, 'pty-funds'); }
  }));

  router.get('/api/petty/funds/:id', async (req, env) => withAuth(req, env, 'petty', 'V', async (req, env) => {
    try {
      const { fund, err } = await loadFund(env, req, Number(req.params.id)); if (err) return err;
      const rows = (await env.DB.prepare(`SELECT e.id, e.entry_date, e.kind, e.category, e.amount_paise, e.narration, e.status, e.decision_note, e.created_at, u.name AS by_name
        FROM pty_entries e LEFT JOIN users u ON u.id = e.created_by WHERE e.fund_id = ? ORDER BY e.entry_date DESC, e.id DESC LIMIT 200`).bind(fund.id).all()).results;
      const cats = (await env.DB.prepare("SELECT COALESCE(NULLIF(category, ''), 'Other') AS category, SUM(amount_paise) AS total FROM pty_entries WHERE fund_id = ? AND kind = 'expense' AND status = 'approved' GROUP BY 1 ORDER BY total DESC").bind(fund.id).all()).results;
      if (new URL(req.url).searchParams.get('csv')) {
        const f = (p) => (Number(p) / 100).toFixed(2);
        return csvResponse('petty-cash-statement.csv', [['Date', 'Kind', 'Category', 'Narration', 'Amount', 'Status', 'By'], ...rows.map((r) => [r.entry_date, r.kind, r.category || '', r.narration || '', f(r.amount_paise), r.status, r.by_name || '']),
          ['', '', '', 'Balance (approved entries)', f(fund.balance_paise), '', '']]);
      }
      return json({ ok: true, data: { fund, entries: rows, categories: cats, can_spend: req.user.role !== 'accounts' } });
    } catch (e) { return serverError(e, 'pty-fund-get'); }
  }));

  router.post('/api/petty/entries', async (req, env) => withAuth(req, env, 'petty', 'C', async (req, env) => {
    try {
      const b = await req.json();
      const { fund, err } = await loadFund(env, req, Number(b.fund_id)); if (err) return err;
      const kind = String(b.kind || '');
      const amount = Math.round(num(b.amount_paise));
      if (!KINDS.includes(kind)) return json({ ok: false, error: 'Pick expense, top-up or return.' }, 400);
      if (!(amount > 0)) return json({ ok: false, error: 'Enter the amount.' }, 400);
      if (!fund.active) return json({ ok: false, error: 'This fund is closed.' }, 409);
      if (kind === 'top_up' && !['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only Accounts or the Owner can add cash to a fund.' }, 403);
      if (kind !== 'top_up' && !(fund.custodian_user_id === req.user.user_id || ['owner', 'pm'].includes(req.user.role))) return json({ ok: false, error: 'Only the person holding this cash can record spending.' }, 403);
      if (kind === 'expense' && !String(b.category || '').trim() && !String(b.narration || '').trim()) return json({ ok: false, error: 'Say what the money was spent on.' }, 400);
      const uuid = String(b.client_uuid || crypto.randomUUID());
      const dup = await env.DB.prepare('SELECT id, status FROM pty_entries WHERE client_uuid = ?').bind(uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      const now = nowStr(); const auto = kind === 'top_up';
      const r = await env.DB.prepare(`INSERT INTO pty_entries (fund_id, entry_date, kind, category, amount_paise, narration, status, created_by, approved_by, decided_at, client_uuid, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(fund.id, String(b.entry_date || todayIST()).slice(0, 10), kind, String(b.category || '').trim().slice(0, 40), amount, String(b.narration || '').slice(0, 200),
        auto ? 'approved' : 'submitted', req.user.user_id, auto ? req.user.user_id : null, auto ? now : null, uuid, now).run();
      await audit(env, req.user, 'create', r.meta.last_row_id, `Petty cash ${kind} ${rupees(amount)} (${fund.custodian})`).run();
      if (!auto) await notifyUsers(env, await roleIds(env, ['pm', 'owner']), `Petty cash to approve: ${rupees(amount)}`, `${req.user.name}: ${String(b.category || b.narration || kind).slice(0, 80)} (${fund.project})`);
      return json({ ok: true, data: { id: r.meta.last_row_id, status: auto ? 'approved' : 'submitted' } });
    } catch (e) { return serverError(e, 'pty-entry'); }
  }));

  router.get('/api/petty/pending', async (req, env) => withAuth(req, env, 'petty', 'A', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.length) return json({ ok: true, data: { entries: [] } });
      const rows = (await env.DB.prepare(`SELECT e.id, e.fund_id, e.entry_date, e.kind, e.category, e.amount_paise, e.narration, e.created_by, p.name AS project, u.name AS by_name
        FROM pty_entries e JOIN pty_funds f ON f.id = e.fund_id JOIN projects p ON p.id = f.project_id LEFT JOIN users u ON u.id = e.created_by
        WHERE e.status = 'submitted' AND f.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY e.id LIMIT 100`).bind(...ids).all()).results;
      return json({ ok: true, data: { entries: rows } });
    } catch (e) { return serverError(e, 'pty-pending'); }
  }));

  const decide = (approve) => (req, env) => withAuth(req, env, 'petty', 'A', async (req, env) => {
    try {
      const e = await env.DB.prepare('SELECT e.*, f.project_id, f.custodian_user_id FROM pty_entries e JOIN pty_funds f ON f.id = e.fund_id WHERE e.id = ?').bind(Number(req.params.id)).first();
      if (!e || !(await visibleProjectIds(env, req.user)).includes(e.project_id)) return json({ ok: false, error: 'Entry not found.' }, 404);
      if (e.created_by === req.user.user_id && req.user.role !== 'owner') return json({ ok: false, error: 'You cannot approve your own entry.' }, 403);
      const b = await req.json().catch(() => ({}));
      if (!approve && !String(b.note || '').trim()) return json({ ok: false, error: 'Please say why it is rejected.' }, 400);
      const r = await env.DB.prepare("UPDATE pty_entries SET status = ?, approved_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'submitted'")
        .bind(approve ? 'approved' : 'rejected', req.user.user_id, nowStr(), String(b.note || '').slice(0, 200), e.id).run();
      if (!r.meta.changes) return json({ ok: false, error: 'This entry was already decided.' }, 409);
      await audit(env, req.user, approve ? 'approve' : 'reject', e.id, `${req.user.name} ${approve ? 'approved' : 'rejected'} petty cash ${rupees(e.amount_paise)}${e.created_by === req.user.user_id ? ' (approved by Owner as maker)' : ''}`).run();
      await notifyUsers(env, [e.created_by], `Petty cash ${approve ? 'approved' : 'rejected'}: ${rupees(e.amount_paise)}`, String(b.note || ''));
      let low = false;
      if (approve) {
        const f = await env.DB.prepare(`SELECT ${BAL} AS bal FROM pty_funds f LEFT JOIN pty_entries e ON e.fund_id = f.id WHERE f.id = ?`).bind(e.fund_id).first();
        const limit = num(await getSetting(env, 'petty.low_balance_paise')) || 100000;
        if (f.bal < limit) {
          low = true;
          const title = `Petty cash running low: ${rupees(f.bal)} left (fund ${e.fund_id})`;
          await env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at) SELECT u.id, ?1, 'Ask Accounts for a top-up.', 'petty', ?2 FROM users u
            WHERE (u.id = ?3 OR u.role = 'accounts') AND u.active = 1 AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title LIKE 'Petty cash running low:%(fund ' || CAST(?4 AS INTEGER) || ')' AND date(n.created_at) = date('now'))`)
            .bind(title, nowStr(), e.custodian_user_id, e.fund_id).run();
        }
      }
      return json({ ok: true, data: { low_balance: low } });
    } catch (e) { return serverError(e, 'pty-decide'); }
  });
  router.post('/api/petty/entries/:id/approve', decide(true));
  router.post('/api/petty/entries/:id/reject', decide(false));

  // Cancel instead of delete. Waiting entries: the person who made it, or Owner/PM. Approved ones: Owner only, with a reason.
  router.post('/api/petty/entries/:id/cancel', async (req, env) => withAuth(req, env, 'petty', 'C', async (req, env) => {
    try {
      const e = await env.DB.prepare('SELECT e.*, f.project_id FROM pty_entries e JOIN pty_funds f ON f.id = e.fund_id WHERE e.id = ?').bind(Number(req.params.id)).first();
      if (!e) return json({ ok: false, error: 'Entry not found.' }, 404);
      const { err } = await loadFund(env, req, e.fund_id); if (err) return err;
      const b = await req.json().catch(() => ({}));
      if (!String(b.reason || '').trim()) return json({ ok: false, error: 'Please say why.' }, 400);
      const mayWaiting = e.created_by === req.user.user_id || ['owner', 'pm'].includes(req.user.role);
      let r;
      if (e.status === 'submitted' && mayWaiting) r = await env.DB.prepare("UPDATE pty_entries SET status = 'cancelled', decision_note = ?, decided_at = ? WHERE id = ? AND status = 'submitted'").bind(String(b.reason).slice(0, 200), nowStr(), e.id).run();
      else if (e.status === 'approved' && req.user.role === 'owner') r = await env.DB.prepare("UPDATE pty_entries SET status = 'cancelled', decision_note = ?, decided_at = ? WHERE id = ? AND status = 'approved'").bind(String(b.reason).slice(0, 200), nowStr(), e.id).run();
      else return json({ ok: false, error: 'You cannot cancel this entry.' }, 403);
      if (!r.meta.changes) return json({ ok: false, error: 'This entry has already changed.' }, 409);
      await audit(env, req.user, 'cancel', e.id, `Cancelled petty cash ${rupees(e.amount_paise)}: ${String(b.reason).slice(0, 100)}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'pty-cancel'); }
  }));
}
