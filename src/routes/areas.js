// routes/areas.js — the area a project's "per sq ft" figures are divided by. One query per call; nothing here changes money.
//   saleable   = RERA carpet area of the flats for sale
//   carpet_all = RERA carpet area of every flat (sale, rehab and landowner)
//   builtup    = the project's built-up area, typed by the PM
//   plot       = the plot area (square metres x 10.7639)
const SQFT_PER_SQM = 10.7639;
const BASES = ['saleable', 'carpet_all', 'builtup', 'plot'];
export const BASIS_LABEL = { saleable: 'RERA carpet area of the flats for sale', carpet_all: 'RERA carpet area of all flats (sale, rehab and landowner)', builtup: 'built-up area of the project', plot: 'plot area' };

export function registerAreas(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const ph = (a) => a.map(() => '?').join(',');
  const shape = (p, a) => {
    const saleable = Math.round((a ? a.sale : 0) * 100) / 100, rehab = Math.round((a ? a.rehab : 0) * 100) / 100, land = Math.round((a ? a.land : 0) * 100) / 100;
    const carpetAll = Math.round((saleable + rehab + land) * 100) / 100, builtup = p.builtup_sqft || null, plot = p.plot_area_sqm ? Math.round(p.plot_area_sqm * SQFT_PER_SQM * 100) / 100 : null;
    const basis = BASES.includes(p.area_basis) ? p.area_basis : 'saleable';
    const area = { saleable, carpet_all: carpetAll, builtup, plot }[basis] || null;
    return { project_id: p.id, name: p.name, saleable_sqft: saleable, rehab_sqft: rehab, landowner_sqft: land, carpet_all_sqft: carpetAll, builtup_sqft: builtup, plot_sqft: plot, basis, basis_label: BASIS_LABEL[basis], area_sqft: area && area > 0 ? area : null, flats_without_area: a ? a.missing : 0 };
  };

  // One project, or (no project_id) every project the person can see.
  router.get('/api/areas', async (req, env) => withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const pid = Number(new URL(req.url).searchParams.get('project_id')) || 0;
      const ids = await visibleProjectIds(env, req.user); const scope = pid ? ids.filter((x) => x === pid) : ids.slice(0, 90);
      if (!scope.length) return pid ? bad('Pick a project.') : json({ ok: true, data: { areas: [] } });
      const [projects, units] = await Promise.all([
        env.DB.prepare(`SELECT id, name, builtup_sqft, plot_area_sqm, area_basis FROM projects WHERE deleted_at IS NULL AND id IN (${ph(scope)})`).bind(...scope).all(),
        env.DB.prepare(`SELECT project_id, SUM(CASE WHEN category = 'sale' THEN COALESCE(rera_carpet_sqft, 0) ELSE 0 END) AS sale, SUM(CASE WHEN category = 'rehab' THEN COALESCE(rera_carpet_sqft, 0) ELSE 0 END) AS rehab,
          SUM(CASE WHEN category = 'landowner' THEN COALESCE(rera_carpet_sqft, 0) ELSE 0 END) AS land, SUM(COALESCE(rera_carpet_sqft, 0) = 0) AS missing FROM sal_inventory WHERE deleted_at IS NULL AND project_id IN (${ph(scope)}) GROUP BY project_id`).bind(...scope).all(),
      ]);
      const by = Object.fromEntries(units.results.map((u) => [u.project_id, u]));
      const areas = projects.results.map((p) => shape(p, by[p.id]));
      return pid ? json({ ok: true, data: areas[0] }) : json({ ok: true, data: { areas } });
    } catch (e) { return serverError(e, 'areas'); }
  }));

  router.post('/api/areas', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the Owner or PM can set the project area.', 403);
      const b = await req.json().catch(() => ({}));
      const pid = Number(b.project_id); if (!pid || !(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Pick a project.');
      const sets = [], vals = [];
      if (b.builtup_sqft !== undefined) { const v = b.builtup_sqft === '' || b.builtup_sqft === null ? null : Number(b.builtup_sqft); if (v !== null && !(v > 0 && v < 1e8)) return bad('Check the built-up area (square feet).'); sets.push('builtup_sqft = ?'); vals.push(v); }
      if (b.area_basis !== undefined) { if (!BASES.includes(b.area_basis)) return bad('Pick one of the area choices.'); sets.push('area_basis = ?'); vals.push(b.area_basis); }
      if (!sets.length) return bad('Nothing to save.');
      await env.DB.batch([
        env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, pid),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'project_area', 'projects', pid, `Project area for per-sq-ft figures: ${b.area_basis !== undefined ? 'basis ' + b.area_basis : ''}${b.builtup_sqft !== undefined ? ' built-up ' + b.builtup_sqft : ''}`.slice(0, 300), nowStr()),
      ]);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'areas-set'); }
  }));
}
