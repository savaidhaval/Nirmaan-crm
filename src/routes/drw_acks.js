// routes/drw_acks.js — WP-22: site confirms they have seen the current issued-for-construction revision of a drawing.
// The PM sees who has and has not; the hourly sweep reminds people who have not after a time limit (setting drawing.ack_hours, default 24).

// Current IFC revisions older than the limit with site users (assigned to the project) who have not confirmed:
// one reminder per person per revision per day, and one summary per PM per revision per day. Two statements.
export async function drawingAckSweep(env, getSetting) {
  const hours = Math.max(1, Math.round(Number(await getSetting(env, 'drawing.ack_hours')) || 24));
  const PENDING = `FROM drw_revisions r JOIN drw_drawings d ON d.id = r.drawing_id AND d.deleted_at IS NULL
    JOIN project_members pm ON pm.project_id = d.project_id AND pm.removed_at IS NULL JOIN users su ON su.id = pm.user_id AND su.role = 'site' AND su.active = 1 AND su.deleted_at IS NULL
    WHERE r.status = 'ifc' AND r.created_at < datetime('now', '-' || ?1 || ' hours') AND r.created_at > datetime('now', '-30 days')
      AND NOT EXISTS (SELECT 1 FROM drw_acks a WHERE a.revision_id = r.id AND a.user_id = su.id)`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT su.id, 'Please confirm you have seen drawing ' || d.code || ' ' || r.rev_no, d.title || ' was issued for construction. Open Drawings and tap "I have seen ' || r.rev_no || '".', 'drawings', datetime('now')
      ${PENDING} AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = su.id AND n.title = 'Please confirm you have seen drawing ' || d.code || ' ' || r.rev_no AND date(n.created_at) = date('now')) LIMIT 300`).bind(hours),
    env.DB.prepare(`INSERT INTO notifications (user_id, title, body, link, created_at)
      SELECT u.id, 'Drawing not confirmed: ' || x.code || ' ' || x.rev_no, x.n || ' site user(s) have not confirmed they have seen it.', 'drawings', datetime('now')
      FROM (SELECT d.code, r.rev_no, r.id AS rid, COUNT(*) AS n ${PENDING} GROUP BY r.id LIMIT 100) x
      JOIN users u ON u.role = 'pm' AND u.active = 1 AND u.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = 'Drawing not confirmed: ' || x.code || ' ' || x.rev_no AND date(n.created_at) = date('now'))`).bind(hours),
  ]);
}

export function registerDrawingAcks(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const SITE_ASSIGNED = `FROM project_members pm JOIN users u ON u.id = pm.user_id AND u.role = 'site' AND u.active = 1 AND u.deleted_at IS NULL WHERE pm.removed_at IS NULL AND pm.project_id = d.project_id`;

  // One line per drawing with a current IFC revision: have I confirmed it, and how many site users have
  router.get('/api/drawings/acks/summary', async (req, env) => withAuth(req, env, 'drawings', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { acks: [] } });
      const rows = (await env.DB.prepare(`SELECT d.id AS drawing_id, r.id AS revision_id, r.rev_no, r.created_at,
          (SELECT acked_at FROM drw_acks a WHERE a.revision_id = r.id AND a.user_id = ?2) AS my_ack,
          (SELECT COUNT(*) ${SITE_ASSIGNED}) AS site_total,
          (SELECT COUNT(*) FROM drw_acks a WHERE a.revision_id = r.id AND a.user_id IN (SELECT u.id ${SITE_ASSIGNED})) AS site_acked
        FROM drw_drawings d JOIN drw_revisions r ON r.drawing_id = d.id AND r.status = 'ifc' WHERE d.deleted_at IS NULL AND d.project_id IN (SELECT value FROM json_each(?1)) LIMIT 1000`).bind(JSON.stringify(ids), req.user.user_id).all()).results;
      return json({ ok: true, data: { acks: rows, is_site: req.user.role === 'site' } });
    } catch (e) { return serverError(e, 'drw-ack-summary'); }
  }));

  // Site taps "I have seen R3". Only the current IFC revision can be confirmed.
  router.post('/api/drawings/revisions/:rid/ack', async (req, env) => withAuth(req, env, 'drawings', 'V', async (req, env) => {
    try {
      if (req.user.role !== 'site') return bad('Only site users confirm drawings.', 403);
      const r = await env.DB.prepare('SELECT r.id, r.rev_no, r.status, d.code, d.title, d.project_id FROM drw_revisions r JOIN drw_drawings d ON d.id = r.drawing_id AND d.deleted_at IS NULL WHERE r.id = ?').bind(Number(req.params.rid)).first();
      if (!r) return bad('Drawing revision not found.', 404);
      if (!(await visibleProjectIds(env, req.user)).includes(r.project_id)) return bad('Not allowed.', 403);
      if (r.status !== 'ifc') return bad('This revision is no longer the current one. Open the drawing and confirm the latest.', 409);
      const now = nowStr();
      const res = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO drw_acks (revision_id, user_id, acked_at) VALUES (?, ?, ?)').bind(r.id, req.user.user_id, now),
        env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) SELECT ?, 'confirm', 'drw_acks', ?, ?, ? WHERE changes() > 0").bind(req.user.user_id, r.id, `Confirmed seen: ${r.code} ${r.rev_no}`, now),
      ]);
      return json({ ok: true, data: { acked_at: now, already: res[0].meta.changes === 0 } });
    } catch (e) { return serverError(e, 'drw-ack'); }
  }));

  // For one drawing: who has seen the current revision. Site users see only their own line.
  router.get('/api/drawings/:id/acks', async (req, env) => withAuth(req, env, 'drawings', 'V', async (req, env) => {
    try {
      const d = await env.DB.prepare('SELECT id, code, project_id FROM drw_drawings WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
      if (!d) return bad('Drawing not found.', 404);
      if (!(await visibleProjectIds(env, req.user)).includes(d.project_id)) return bad('Not allowed.', 403);
      const rev = await env.DB.prepare("SELECT id, rev_no, created_at FROM drw_revisions WHERE drawing_id = ? AND status = 'ifc'").bind(d.id).first();
      if (!rev) return json({ ok: true, data: { revision: null, people: [] } });
      let people = (await env.DB.prepare(`SELECT u.id, u.name, a.acked_at FROM project_members pm JOIN users u ON u.id = pm.user_id AND u.role = 'site' AND u.active = 1 AND u.deleted_at IS NULL
        LEFT JOIN drw_acks a ON a.user_id = u.id AND a.revision_id = ?1 WHERE pm.removed_at IS NULL AND pm.project_id = ?2 ORDER BY u.name LIMIT 100`).bind(rev.id, d.project_id).all()).results;
      const total = people.length, seen = people.filter((p) => p.acked_at).length;
      if (req.user.role === 'site') people = people.filter((p) => p.id === req.user.user_id);
      return json({ ok: true, data: { revision: rev, people, total, seen } });
    } catch (e) { return serverError(e, 'drw-acks'); }
  }));
}
