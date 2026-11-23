// routes/possession.js — Module 5 screen: one list of every booked flat with where its possession and handover stand.
// Read-only. One statement; open checklist items and open snags are counted per flat.
export function registerPossession(router, h) {
  const { withAuth, json, serverError, visibleProjectIds } = h;
  router.get('/api/possession', async (req, env) => withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const ids = (await visibleProjectIds(env, req.user)).slice(0, 90);
      if (!ids.length) return json({ ok: true, data: { flats: [], counts: {} } });
      const seeNames = ['owner', 'pm', 'accounts', 'sales'].includes(req.user.role);
      const rows = (await env.DB.prepare(`SELECT b.id AS booking_id, b.project_id, b.customer_name, b.agreement_date, i.wing, i.unit_no, h.status AS ho_status, h.possession_offered_on, h.possession_given_on,
          (SELECT COUNT(*) FROM sal_handover_items x WHERE x.handover_id = h.id AND x.done = 0) AS open_items,
          (SELECT COUNT(*) FROM site_snags s WHERE s.unit_id = b.unit_id AND s.deleted_at IS NULL AND s.status <> 'verified') AS open_snags,
          p.name AS project
        FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id JOIN projects p ON p.id = b.project_id LEFT JOIN sal_handover h ON h.booking_id = b.id
        WHERE b.deleted_at IS NULL AND b.status <> 'cancelled' AND b.project_id IN (${ids.map(() => '?').join(',')})
        ORDER BY (h.status = 'handed_over'), p.name, i.wing, i.unit_no LIMIT 400`).bind(...ids).all()).results;
      const flats = rows.map((r) => ({ ...r, customer_name: seeNames ? r.customer_name : '', stage: !r.ho_status ? 'not_started' : r.ho_status === 'handed_over' ? 'handed_over' : 'in_progress' }));
      const counts = { not_started: 0, in_progress: 0, handed_over: 0 }; flats.forEach((f) => { counts[f.stage]++; });
      return json({ ok: true, data: { flats, counts } });
    } catch (e) { return serverError(e, 'possession-list'); }
  }));
}
