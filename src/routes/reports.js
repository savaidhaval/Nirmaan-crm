// routes/reports.js — executive reporting: stacking plan, cash flow + escrow, receivable aging, marketing/CP ROI, velocity + discount leakage.
export function registerReports(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr } = h;
  const MONEY_ROLES = ['owner', 'pm', 'accounts'];

  async function scopeIds(env, user, projectId) {
    const ids = await visibleProjectIds(env, user);
    if (projectId) return ids.includes(Number(projectId)) ? [Number(projectId)] : [];
    return ids;
  }
  const ph = (a) => a.map(() => '?').join(',');
  const month = (d) => String(d).substring(0, 7);

  // ---- Stacking plan: wing x floor matrix with live status ----
  router.get('/api/reports/stacking', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      const ids = await scopeIds(env, req.user, pid);
      if (!pid || !ids.length) return json({ ok: false, error: 'Pick a project.' }, 400);
      const rows = await env.DB.prepare(`SELECT i.id, i.wing, i.floor, i.unit_no, i.type, i.category, i.status, i.price_paise, i.floor_rise_paise, i.carpet_sqft, i.rera_carpet_sqft, i.blocked_till, i.hold_by,
        hu.name AS holder, hl.name AS holder_lead, b.id AS booking_id, b.customer_name, b.agreed_price_paise, b.registration_date, b.status AS booking_status
        FROM sal_inventory i LEFT JOIN users hu ON hu.id = i.hold_by LEFT JOIN sal_leads hl ON hl.id = i.hold_lead_id
        LEFT JOIN sal_bookings b ON b.unit_id = i.id AND b.status <> 'cancelled' AND b.deleted_at IS NULL
        WHERE i.project_id = ? AND i.deleted_at IS NULL ORDER BY i.wing, i.floor DESC, i.unit_no`).bind(pid).all();
      const seeNames = ['owner', 'pm', 'accounts', 'sales'].includes(req.user.role);
      const units = rows.results.map((u) => {
        let state = 'available';
        if (u.category === 'rehab') state = 'rehab';
        else if (u.status === 'possessed') state = 'possessed';
        else if (u.booking_id) state = u.registration_date ? 'registered' : 'booked';
        else if (u.status === 'held') state = 'token_locked';
        const list = u.price_paise + (u.floor_rise_paise || 0);
        return { id: u.id, wing: u.wing || '', floor: u.floor, unit_no: u.unit_no, type: u.type, state, list_paise: list, carpet_sqft: u.carpet_sqft, rera_carpet_sqft: u.rera_carpet_sqft,
          rate_sqft_paise: u.rera_carpet_sqft ? Math.round(list / u.rera_carpet_sqft) : null, holder: state === 'token_locked' ? u.holder : null, holder_lead: state === 'token_locked' && seeNames ? u.holder_lead : null, blocked_till: state === 'token_locked' ? u.blocked_till : null,
          booking_id: seeNames ? u.booking_id : null, customer: seeNames && state !== 'available' ? u.customer_name : null, agreed_paise: seeNames ? u.agreed_price_paise : null };
      });
      const counts = {}; let value = 0; let soldValue = 0;
      for (const u of units) { counts[u.state] = (counts[u.state] || 0) + 1; if (u.state !== 'rehab') { value += u.list_paise; if (['booked', 'registered', 'possessed'].includes(u.state)) soldValue += u.agreed_paise || u.list_paise; } }
      return json({ ok: true, data: { units, counts, total_list_value_paise: value, sold_value_paise: soldValue } });
    } catch (e) { return serverError(e, 'stacking'); }
  }));

  // ---- Cash flow: scheduled vs actual by month, and RERA 70/30 routing ----
  router.get('/api/reports/cashflow', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!MONEY_ROLES.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await scopeIds(env, req.user, Number(new URL(req.url).searchParams.get('project_id')) || null);
      if (!ids.length) return json({ ok: true, data: { months: [], totals: {}, escrow: {} } });
      const dem = await env.DB.prepare(`SELECT substr(d.due_date, 1, 7) AS m, SUM(d.amount_paise + COALESCE(d.gst_paise, 0)) AS due FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id
        WHERE b.project_id IN (${ph(ids)}) AND d.status != 'cancelled' AND d.due_date IS NOT NULL GROUP BY m`).bind(...ids).all();
      const rec = await env.DB.prepare(`SELECT substr(r.received_on, 1, 7) AS m, SUM(r.amount_paise + r.tds_paise) AS got FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id
        WHERE b.project_id IN (${ph(ids)}) AND r.reversed_at IS NULL AND r.kind = 'principal' GROUP BY m`).bind(...ids).all();
      const future = await env.DB.prepare(`SELECT COALESCE(SUM(d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise), 0) AS t FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE b.project_id IN (${ph(ids)}) AND d.status = 'scheduled'`).bind(...ids).first();
      const map = {};
      for (const r of dem.results) (map[r.m] = map[r.m] || { month: r.m, due: 0, collected: 0 }).due = r.due;
      for (const r of rec.results) (map[r.m] = map[r.m] || { month: r.m, due: 0, collected: 0 }).collected = r.got;
      const months = Object.values(map).filter((x) => x.month).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
      const tot = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN r.account = 'rera_designated' THEN r.amount_paise ELSE 0 END), 0) AS designated, COALESCE(SUM(CASE WHEN r.account <> 'rera_designated' THEN r.amount_paise ELSE 0 END), 0) AS other, COALESCE(SUM(r.amount_paise), 0) AS all_paise
        FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id WHERE b.project_id IN (${ph(ids)}) AND r.reversed_at IS NULL`).bind(...ids).first();
      const designatedPct = tot.all_paise ? Math.round(tot.designated * 1000 / tot.all_paise) / 10 : null;
      return json({ ok: true, data: { months, unscheduled_future_paise: Number(future.t),
        escrow: { collected_paise: tot.all_paise, designated_paise: tot.designated, other_paise: tot.other, designated_pct: designatedPct, required_pct: 70,
          required_designated_paise: Math.round(tot.all_paise * 0.7), shortfall_paise: Math.max(Math.round(tot.all_paise * 0.7) - tot.designated, 0), compliant: designatedPct === null ? null : designatedPct >= 70,
          note: 'MahaRERA: at least 70% of money collected from buyers must be deposited in the project\'s designated account. Confirm with your CA.' } } });
    } catch (e) { return serverError(e, 'cashflow'); }
  }));

  // ---- Receivable aging ----
  router.get('/api/reports/aging', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!MONEY_ROLES.includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await scopeIds(env, req.user, Number(new URL(req.url).searchParams.get('project_id')) || null);
      if (!ids.length) return json({ ok: true, data: { buckets: [], top: [] } });
      const rows = await env.DB.prepare(`SELECT d.id, d.label, b.customer_name, i.wing, i.unit_no, d.due_date, d.status,
        (d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise) AS open_paise, CAST(julianday('now') - julianday(d.due_date) AS INTEGER) AS days
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id
        WHERE b.project_id IN (${ph(ids)}) AND d.status IN ('ready', 'partial') AND b.status <> 'cancelled'`).bind(...ids).all();
      const defs = [['Not yet due', (d) => d <= 0], ['1–30 days', (d) => d >= 1 && d <= 30], ['31–60 days', (d) => d >= 31 && d <= 60], ['61–90 days', (d) => d >= 61 && d <= 90], ['Over 90 days', (d) => d > 90]];
      const buckets = defs.map(([label, fn]) => { const r = rows.results.filter((x) => fn(x.days == null ? 0 : x.days)); return { label, count: r.length, amount_paise: r.reduce((t, x) => t + x.open_paise, 0) }; });
      const top = rows.results.filter((x) => (x.days || 0) > 0).sort((a, b) => b.open_paise - a.open_paise).slice(0, 10).map((x) => ({ customer: x.customer_name, flat: `${x.wing || ''}-${x.unit_no}`, label: x.label, days: x.days, open_paise: x.open_paise }));
      const sched = await env.DB.prepare(`SELECT COALESCE(SUM(d.amount_paise + COALESCE(d.gst_paise, 0)), 0) AS t, COUNT(*) AS n FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id WHERE b.project_id IN (${ph(ids)}) AND d.status = 'scheduled' AND b.status <> 'cancelled'`).bind(...ids).first();
      return json({ ok: true, data: { buckets, top, scheduled_paise: Number(sched.t), scheduled_count: Number(sched.n) } });
    } catch (e) { return serverError(e, 'aging'); }
  }));

  // ---- Marketing spend + CP attribution ----
  router.get('/api/marketing/spend', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    if (!['owner', 'accounts', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare('SELECT * FROM mkt_spend ORDER BY month DESC, id DESC LIMIT 100').all();
    return json({ ok: true, data: { spend: rows.results } });
  }));

  router.post('/api/marketing/spend', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!['owner', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Only the Owner or Accounts can record marketing spend.' }, 403);
      const b = await req.json();
      const amount = Math.round(Number(b.amount_paise) || 0);
      if (!/^\d{4}-\d{2}$/.test(String(b.month || '')) || !(amount > 0) || !String(b.source || '').trim()) return json({ ok: false, error: 'Source, month (YYYY-MM) and amount are required.' }, 400);
      const r = await env.DB.prepare('INSERT INTO mkt_spend (project_id, source, month, amount_paise, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(b.project_id ? Number(b.project_id) : null, String(b.source).trim().toLowerCase().slice(0, 40), b.month, amount, String(b.note || '').slice(0, 200), req.user.user_id, nowStr()).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) { return serverError(e, 'spend'); }
  }));

  router.get('/api/reports/marketing', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const u = new URL(req.url);
      const ids = await scopeIds(env, req.user, Number(u.searchParams.get('project_id')) || null);
      if (!ids.length) return json({ ok: true, data: { sources: [], partners: [] } });
      const sources = await env.DB.prepare(`SELECT l.source,
        COUNT(*) AS leads,
        SUM(EXISTS (SELECT 1 FROM sal_visits v WHERE v.lead_id = l.id AND v.status = 'done')) AS visits,
        SUM(l.status = 'booked') AS bookings,
        COALESCE(SUM((SELECT b.agreed_price_paise FROM sal_bookings b WHERE b.lead_id = l.id AND b.status <> 'cancelled' AND b.deleted_at IS NULL LIMIT 1)), 0) AS booked_value_paise
        FROM sal_leads l WHERE l.deleted_at IS NULL AND (l.project_id IS NULL OR l.project_id IN (${ph(ids)})) GROUP BY l.source ORDER BY leads DESC`).bind(...ids).all();
      const spend = await env.DB.prepare(`SELECT source, SUM(amount_paise) AS spent FROM mkt_spend WHERE (project_id IS NULL OR project_id IN (${ph(ids)})) GROUP BY source`).bind(...ids).all();
      const spent = Object.fromEntries(spend.results.map((r) => [r.source, r.spent]));
      const out = sources.results.map((s) => {
        const sp = spent[String(s.source || 'other').toLowerCase()] || 0;
        return { source: s.source || 'other', leads: s.leads, visits: s.visits || 0, bookings: s.bookings || 0, booked_value_paise: s.booked_value_paise, spend_paise: sp,
          cost_per_lead_paise: s.leads && sp ? Math.round(sp / s.leads) : null, cost_per_visit_paise: s.visits && sp ? Math.round(sp / s.visits) : null, cost_per_booking_paise: s.bookings && sp ? Math.round(sp / s.bookings) : null };
      });
      const partners = await env.DB.prepare(`SELECT p.id, p.firm,
        (SELECT COUNT(*) FROM sal_leads l WHERE l.channel_partner_id = p.id AND l.deleted_at IS NULL) AS leads,
        COUNT(b.id) AS bookings, COALESCE(SUM(b.agreed_price_paise), 0) AS value_paise,
        COALESCE(SUM(CAST(b.agreed_price_paise * COALESCE(b.brokerage_bp, p.brokerage_default_bp, 0) / 10000 AS INTEGER)), 0) AS brokerage_paise
        FROM sal_partners p LEFT JOIN sal_bookings b ON b.channel_partner_id = p.id AND b.status <> 'cancelled' AND b.deleted_at IS NULL AND b.project_id IN (${ph(ids)})
        WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY value_paise DESC`).bind(...ids).all();
      return json({ ok: true, data: { sources: out, partners: partners.results.map((p) => ({ ...p, net_realisation_paise: p.value_paise - p.brokerage_paise })) } });
    } catch (e) { return serverError(e, 'marketing'); }
  }));

  // ---- Velocity + discount leakage ----
  router.get('/api/reports/velocity', async (req, env) => withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      if (!['owner', 'pm', 'accounts', 'viewer'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const ids = await scopeIds(env, req.user, Number(new URL(req.url).searchParams.get('project_id')) || null);
      if (!ids.length) return json({ ok: true, data: { by_type: [], by_floor: [], monthly: [], leakage: [] } });
      const units = (await env.DB.prepare(`SELECT i.id, i.type, i.floor, i.price_paise + COALESCE(i.floor_rise_paise, 0) AS list_paise, b.id AS booking_id, b.agreed_price_paise, b.list_price_paise, b.created_at AS booked_at
        FROM sal_inventory i LEFT JOIN sal_bookings b ON b.unit_id = i.id AND b.status <> 'cancelled' AND b.deleted_at IS NULL
        WHERE i.project_id IN (${ph(ids)}) AND i.deleted_at IS NULL AND i.category = 'sale'`).bind(...ids).all()).results;
      const group = (keyFn) => {
        const g = {};
        for (const u of units) {
          const k = keyFn(u); const x = (g[k] = g[k] || { key: k, total: 0, sold: 0, list: 0, agreed: 0 });
          x.total++;
          if (u.booking_id) { x.sold++; x.list += u.list_price_paise || u.list_paise; x.agreed += u.agreed_price_paise; }
        }
        return Object.values(g).map((x) => ({ key: x.key, total: x.total, sold: x.sold, absorption_pct: Math.round(x.sold * 1000 / x.total) / 10, realisation_pct: x.list ? Math.round(x.agreed * 1000 / x.list) / 10 : null, discount_paise: x.list - x.agreed }));
      };
      const band = (f) => (f == null ? 'Unknown' : f <= 5 ? 'Floors 1–5' : f <= 10 ? 'Floors 6–10' : f <= 15 ? 'Floors 11–15' : 'Floors 16+');
      const by_type = group((u) => u.type || 'Unspecified').sort((a, b) => a.key.localeCompare(b.key));
      const by_floor = group((u) => band(u.floor));
      const monthlyRows = await env.DB.prepare(`SELECT substr(b.created_at, 1, 7) AS m, COUNT(*) AS n, SUM(b.agreed_price_paise) AS v FROM sal_bookings b WHERE b.project_id IN (${ph(ids)}) AND b.status <> 'cancelled' AND b.deleted_at IS NULL GROUP BY m ORDER BY m DESC LIMIT 12`).bind(...ids).all();
      const limit = Number(await getSetting(env, 'sales.max_discount_bp')) || 100;
      const leak = await env.DB.prepare(`SELECT b.id, b.customer_name, i.wing, i.unit_no, b.list_price_paise, b.agreed_price_paise, b.discount_reason, b.approved_by, u.name AS approver,
        (b.list_price_paise - b.agreed_price_paise) * 10000 / b.list_price_paise AS discount_bp
        FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id LEFT JOIN users u ON u.id = b.approved_by
        WHERE b.project_id IN (${ph(ids)}) AND b.status <> 'cancelled' AND b.deleted_at IS NULL AND b.list_price_paise IS NOT NULL AND b.agreed_price_paise < b.list_price_paise
        ORDER BY discount_bp DESC LIMIT 30`).bind(...ids).all();
      return json({ ok: true, data: { by_type, by_floor, monthly: monthlyRows.results.reverse(), approved_limit_bp: limit,
        leakage: leak.results.map((r) => ({ ...r, discount_bp: Math.round(r.discount_bp), over_limit: r.discount_bp > limit, unapproved: !r.approved_by })),
        total_discount_paise: leak.results.reduce((t, r) => t + (r.list_price_paise - r.agreed_price_paise), 0) } });
    } catch (e) { return serverError(e, 'velocity'); }
  }));
}
