// routes/visits.js — WP-19: structured site-visit feedback, an optional location check-in, and visit-to-booking conversion.
// Location is personal data: it is saved only when the person taps "Check in here", never blocks anything, and is only compared with the project's location.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const INTEREST = ['hot', 'warm', 'cold'];
const NEXT_STEPS = ['call_back', 'second_visit', 'send_cost_sheet', 'ready_to_book', 'not_interested'];
const STARTER_OBJECTIONS = ['Price is high', 'Location', 'Possession date', 'Layout or size', 'Loan approval', 'Just exploring'];

function metres(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export async function visitOptions(env, getSetting) {
  const t = await getSetting(env, 'sales.visit_objections');
  let list = Array.isArray(t) ? t : (typeof t === 'string' && t.trim() ? t.split(/[;\n]/) : []);
  list = list.map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  const r = Math.round(Number(await getSetting(env, 'sales.visit_radius_m')));
  return { objections: list.length ? list : STARTER_OBJECTIONS, radius_m: r > 0 && r <= 5000 ? r : 200 };
}

// Used by the existing visit-status route: validate and normalise the feedback fields.
export function cleanFeedback(b, objections) {
  const out = { interest: INTEREST.includes(b.interest) ? b.interest : null, objection: null, next_step: NEXT_STEPS.includes(b.next_step) ? b.next_step : null };
  if (b.objection) { const o = String(b.objection).trim().slice(0, 60); out.objection = objections.includes(o) ? o : o; }
  return out;
}

export function registerVisits(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr, leadAccess } = h;

  router.get('/api/sales/visit-options', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try { return json({ ok: true, data: { ...(await visitOptions(env, getSetting)), interest: INTEREST, next_steps: NEXT_STEPS } }); } catch (e) { return serverError(e, 'visit-options'); }
  }));

  // Feedback can also be added or corrected after the visit is marked done.
  router.post('/api/sales/visits/:id/feedback', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const v = await env.DB.prepare('SELECT * FROM sal_visits WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!v) return json({ ok: false, error: 'Visit not found.' }, 404);
      const { err } = await leadAccess(env, req.user, v.lead_id); if (err) return err;
      if (v.status !== 'done') return json({ ok: false, error: 'Mark the visit as done first.' }, 409);
      const b = await req.json(); const f = cleanFeedback(b, (await visitOptions(env, getSetting)).objections);
      await env.DB.prepare('UPDATE sal_visits SET interest = COALESCE(?, interest), objection = COALESCE(?, objection), next_step = COALESCE(?, next_step) WHERE id = ?').bind(f.interest, f.objection, f.next_step, v.id).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'visit-feedback'); }
  }));

  // "Check in here". Always saved; if the project's location is known and the person is far away, say so (a warning, not a block).
  router.post('/api/sales/visits/:id/checkin', async (req, env) => withAuth(req, env, 'sales', 'E', async (req, env) => {
    try {
      const v = await env.DB.prepare('SELECT * FROM sal_visits WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!v) return json({ ok: false, error: 'Visit not found.' }, 404);
      const { lead, err } = await leadAccess(env, req.user, v.lead_id); if (err) return err;
      if (v.status === 'cancelled') return json({ ok: false, error: 'This visit was cancelled.' }, 409);
      const b = await req.json(); const lat = num(b.lat), lng = num(b.lng), acc = num(b.accuracy_m);
      if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return json({ ok: false, error: 'The location looks wrong.' }, 400);
      const pid = v.project_id || lead.project_id;
      const proj = pid ? await env.DB.prepare('SELECT lat, lng FROM projects WHERE id = ?').bind(pid).first() : null;
      const has = !!(proj && proj.lat != null && proj.lng != null);
      const dist = has ? metres(lat, lng, proj.lat, proj.lng) : null;
      const radius = (await visitOptions(env, getSetting)).radius_m;
      await env.DB.prepare('UPDATE sal_visits SET checked_in_at = ?, lat = ?, lng = ?, accuracy_m = ?, distance_m = ? WHERE id = ?').bind(nowStr(), lat, lng, acc, dist, v.id).run();
      const far = has && dist > radius + (acc || 0);
      return json({ ok: true, data: { project_has_location: has, distance_m: dist, radius_m: radius, far, warning: far ? `You are about ${dist} m from the project (the limit is ${radius} m). The check-in was saved anyway.` : null } });
    } catch (e) { return serverError(e, 'visit-checkin'); }
  }));

  router.post('/api/projects/:id/location', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Only the PM or the Owner can set the project location.' }, 403);
      const pid = Number(req.params.id);
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const b = await req.json(); const lat = num(b.lat), lng = num(b.lng);
      if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return json({ ok: false, error: 'The location looks wrong.' }, 400);
      await env.DB.prepare('UPDATE projects SET lat = ?, lng = ? WHERE id = ?').bind(lat, lng, pid).run();
      await env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(req.user.user_id, 'update', 'projects', pid, 'Project site location set', nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'project-location'); }
  }));

  // Visit-to-booking: of the leads that came for at least one visit, how many booked? By project, source and person.
  router.get('/api/sales/reports/visit-conversion', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const seeAll = ['owner', 'pm', 'accounts', 'viewer'].includes(req.user.role) || (await getSetting(env, 'sales.share_all_leads')) === 'on';
      const ids = (await visibleProjectIds(env, req.user)).slice(0, 90);
      const scope = `(l.project_id IS NULL${ids.length ? ` OR l.project_id IN (${ids.map(() => '?').join(',')})` : ''})${seeAll ? '' : ' AND l.assigned_to = ?'}`;
      const args = [...ids, ...(seeAll ? [] : [req.user.user_id])];
      const group = async (sel, join) => (await env.DB.prepare(`SELECT ${sel} AS label, COUNT(DISTINCT l.id) AS visited, COUNT(DISTINCT CASE WHEN l.status = 'booked' THEN l.id END) AS booked
        FROM sal_visits v JOIN sal_leads l ON l.id = v.lead_id ${join} WHERE v.status = 'done' AND v.deleted_at IS NULL AND l.deleted_at IS NULL AND ${scope} GROUP BY 1 ORDER BY visited DESC LIMIT 100`).bind(...args).all()).results
        .map((r) => ({ ...r, conversion_pct: r.visited ? Math.round((r.booked * 1000) / r.visited) / 10 : 0 }));
      const [byProject, bySource, byPerson, interest, checked] = await Promise.all([
        group("COALESCE(p.name, 'No project')", 'LEFT JOIN projects p ON p.id = COALESCE(v.project_id, l.project_id)'),
        group("COALESCE(NULLIF(l.source, ''), 'unknown')", ''),
        group("COALESCE(u.name, 'Unassigned')", 'LEFT JOIN users u ON u.id = l.assigned_to'),
        env.DB.prepare(`SELECT COALESCE(v.interest, 'not recorded') AS label, COUNT(*) AS n FROM sal_visits v JOIN sal_leads l ON l.id = v.lead_id WHERE v.status = 'done' AND v.deleted_at IS NULL AND ${scope} GROUP BY 1`).bind(...args).all(),
        env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(v.checked_in_at IS NOT NULL), 0) AS checked FROM sal_visits v JOIN sal_leads l ON l.id = v.lead_id WHERE v.status = 'done' AND v.deleted_at IS NULL AND ${scope}`).bind(...args).first(),
      ]);
      if (new URL(req.url).searchParams.get('csv')) {
        const rows = [['Group', 'Name', 'Leads who visited', 'Of them booked', 'Conversion %']];
        for (const [g, list] of [['Project', byProject], ['Source', bySource], ['Salesperson', byPerson]]) for (const r of list) rows.push([g, r.label, r.visited, r.booked, r.conversion_pct]);
        const { csvBom } = h;
        return new Response(csvBom(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="visit-to-booking.csv"', 'Cache-Control': 'no-store' } });
      }
      return json({ ok: true, data: { by_project: byProject, by_source: bySource, by_person: byPerson, interest: interest.results, visits_done: checked.n, visits_checked_in: checked.checked } });
    } catch (e) { return serverError(e, 'rep-visit-conv'); }
  }));
}
