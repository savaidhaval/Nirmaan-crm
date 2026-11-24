// routes/m2step3.js — Module 2 gaps, step 3: the pricing matrix (base rate, floor rise, PLC by flat tag, parking, club, development charges)
// and the price list that fills a cost sheet in one tap. The cost sheet itself, its tax rates, discount approval and MSP checks stay in sales3.js.
// Every figure is typed by the Owner and audited; nothing is built in. Confirm with your CA.
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; };

export function registerM2Step3(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const audit = (env, user, action, entity, id, summary) =>
    env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 600), nowStr()).run();
  const normTags = (t) => [...new Set(String(t || '').toLowerCase().split(/[,;\s]+/).map((x) => x.trim().replace(/[^a-z0-9_-]/g, '')).filter(Boolean))].slice(0, 10);

  async function matrixOf(env, pid) {
    const [m, plc] = await Promise.all([
      env.DB.prepare('SELECT * FROM sal_price_matrix WHERE project_id = ?').bind(pid).first(),
      env.DB.prepare('SELECT id, tag, label, kind, amount_paise FROM sal_plc_rules WHERE project_id = ? AND retired = 0 ORDER BY id').bind(pid).all(),
    ]);
    return { matrix: m || null, plc: plc.results };
  }

  router.get('/api/sales/price-matrix', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id'));
      if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      return json({ ok: true, data: await matrixOf(env, pid) });
    } catch (e) { return serverError(e, 'matrix-get'); }
  }));

  // Owner only: this is the price the whole sales team quotes from.
  router.post('/api/sales/price-matrix', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can change the pricing matrix.', 403);
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      if (String(b.reason || '').trim().length < 5) return bad('Give a reason for the change.');
      const base = int(b.base_rate_paise), rise = int(b.rise_paise_per_floor || 0), from = int(b.rise_from_floor || 1), park = int(b.parking_paise || 0), club = int(b.club_paise || 0), dev = int(b.dev_paise || 0);
      if (!(base > 0)) return bad('Enter the base rate per sq ft.');
      if ([rise, park, club, dev].some((x) => !(x >= 0)) || !(from >= 0 && from <= 200)) return bad('An amount or floor number looks wrong.');
      const plc = (Array.isArray(b.plc) ? b.plc : []).slice(0, 30).map((r) => ({ tag: normTags(r.tag)[0], label: String(r.label || '').trim().slice(0, 60), kind: r.kind === 'flat' ? 'flat' : 'per_sqft', amount: int(r.amount_paise) }));
      if (plc.some((r) => !r.tag || !r.label || !(r.amount > 0))) return bad('Each PLC rule needs a tag, a name and an amount.');
      const before = await matrixOf(env, pid);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO sal_price_matrix (project_id, base_rate_paise, rise_paise_per_floor, rise_from_floor, parking_paise, club_paise, dev_paise, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET base_rate_paise = excluded.base_rate_paise, rise_paise_per_floor = excluded.rise_paise_per_floor, rise_from_floor = excluded.rise_from_floor, parking_paise = excluded.parking_paise, club_paise = excluded.club_paise, dev_paise = excluded.dev_paise, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
          .bind(pid, base, rise, from, park, club, dev, req.user.user_id, nowStr()),
        env.DB.prepare('UPDATE sal_plc_rules SET retired = 1 WHERE project_id = ? AND retired = 0').bind(pid),
        ...plc.map((r) => env.DB.prepare('INSERT INTO sal_plc_rules (project_id, tag, label, kind, amount_paise) VALUES (?, ?, ?, ?, ?)').bind(pid, r.tag, r.label, r.kind, r.amount)),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(req.user.user_id, 'matrix_change', 'sal_price_matrix', pid, `Pricing matrix changed. Before: ${JSON.stringify(before)} After: base ${rupees(base)}/sq ft, rise ${rupees(rise)}/sq ft/floor from floor ${from}, parking ${rupees(park)}, club ${rupees(club)}, dev ${rupees(dev)}, ${plc.length} PLC rules. Reason: ${b.reason}`.slice(0, 600), nowStr()),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'matrix-set'); }
  }));

  // Owner: write the matrix into the rate card of every flat that is not booked, so cost-sheet discounts are measured against it.
  router.post('/api/sales/price-matrix/apply', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      if (req.user.role !== 'owner') return bad('Only the Owner can apply the pricing matrix.', 403);
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      if (String(b.reason || '').trim().length < 5) return bad('Give a reason for the change.');
      const m = await env.DB.prepare('SELECT * FROM sal_price_matrix WHERE project_id = ?').bind(pid).first();
      if (!m) return bad('Save the pricing matrix first.');
      const r = await env.DB.prepare(`UPDATE sal_inventory SET price_paise = CAST(ROUND(? * rera_carpet_sqft) AS INTEGER),
          floor_rise_paise = CAST(ROUND(? * MAX(0, COALESCE(floor, 0) - ? + 1) * rera_carpet_sqft) AS INTEGER)
        WHERE project_id = ? AND deleted_at IS NULL AND category = 'sale' AND status IN ('available', 'held') AND rera_carpet_sqft > 0`).bind(m.base_rate_paise, m.rise_paise_per_floor, m.rise_from_floor, pid).run();
      await audit(env, req.user, 'matrix_apply', 'sal_inventory', pid, `Pricing matrix written into the rate card of ${r.meta.changes} unbooked flats of project ${pid}. Reason: ${b.reason}`);
      return json({ ok: true, data: { changed: r.meta.changes } });
    } catch (e) { return serverError(e, 'matrix-apply'); }
  }));

  router.post('/api/sales/inventory/:id/tags', async (req, env) => withAuth(req, env, 'sales', 'A', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the Owner or PM can tag flats.', 403);
      const u = await env.DB.prepare('SELECT id, project_id, wing, unit_no, plc_tags FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!u || !(await visibleProjectIds(env, req.user)).includes(u.project_id)) return bad('Flat not found.', 404);
      const b = await req.json().catch(() => ({})); const tags = normTags(b.tags).join(',');
      await env.DB.prepare('UPDATE sal_inventory SET plc_tags = ? WHERE id = ?').bind(tags || null, u.id).run();
      await audit(env, req.user, 'tags_change', 'sal_inventory', u.id, `${u.wing || ''}-${u.unit_no}: location tags "${u.plc_tags || ''}" -> "${tags}"`);
      return json({ ok: true, data: { tags } });
    } catch (e) { return serverError(e, 'tags'); }
  }));

  // The price list for one flat: the cost-sheet lines the matrix gives it. Read-only; the cost sheet is made by the normal route, so MSP, discount approval and taxes still apply.
  router.get('/api/sales/units/:id/quote', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const u = await env.DB.prepare('SELECT * FROM sal_inventory WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!u || !(await visibleProjectIds(env, req.user)).includes(u.project_id)) return bad('Flat not found.', 404);
      if (u.category !== 'sale') return bad('This flat is not for sale.', 400);
      const { matrix: m, plc } = await matrixOf(env, u.project_id);
      if (!m) return bad('The Owner has not set the pricing matrix for this project yet.', 409);
      const area = Number(u.rera_carpet_sqft) || 0; if (!(area > 0)) return bad('This flat has no RERA carpet area recorded.', 400);
      const slots = Math.max(0, Math.min(10, int(new URL(req.url).searchParams.get('parking') || 0) || 0));
      const lines = []; const tags = String(u.plc_tags || '').split(',').filter(Boolean);
      const floors = Math.max(0, (u.floor == null ? 0 : u.floor) - m.rise_from_floor + 1);
      if (m.rise_paise_per_floor > 0 && floors > 0) lines.push({ label: `Floor rise (floor ${u.floor})`, kind: 'addition', amount_paise: Math.round(m.rise_paise_per_floor * floors * area) });
      for (const r of plc) if (tags.includes(r.tag)) lines.push({ label: r.label, kind: 'addition', amount_paise: r.kind === 'flat' ? r.amount_paise : Math.round(r.amount_paise * area) });
      if (slots && m.parking_paise > 0) lines.push({ label: `Car parking x ${slots}`, kind: 'addition', amount_paise: m.parking_paise * slots });
      if (m.club_paise > 0) lines.push({ label: 'Club membership', kind: 'addition', amount_paise: m.club_paise });
      if (m.dev_paise > 0) lines.push({ label: 'Development charges', kind: 'addition', amount_paise: m.dev_paise });
      return json({ ok: true, data: { base_rate_paise_per_sqft: m.base_rate_paise, area_sqft: area, lines, matches_rate_card: u.price_paise === Math.round(m.base_rate_paise * area) } });
    } catch (e) { return serverError(e, 'quote'); }
  }));
}
