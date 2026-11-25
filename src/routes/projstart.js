// routes/projstart.js — starting a project that was opened directly (not from Business Development), and who is on no project.
// A redevelopment project starts with the society's appointment letter (after the 79A process); a land project when the land is bought.
import { isDate, todayIST } from '../core/gates.js';
import { visibleProjectIds, getLimitRoles } from '../core/permissions.js';
import { startNeeds, START_BASIS } from '../core/projgate.js';

export function registerProjStart(router, h) {
  const { withAuth, json, serverError, nowStr } = h;
  const bad = (m, s = 400, code) => json({ ok: false, error: m, ...(code ? { code } : {}) }, s);

  // Record the paper that starts the project. 3 reads + 1 batch (update and audit).
  router.post('/api/projects/:id/start', async (req, env) => withAuth(req, env, 'projects', 'E', async (req, env) => {
    try {
      if (!['owner', 'pm'].includes(req.user.role)) return bad('Only the Owner or the PM can start a project.', 403);
      const pid = Number(req.params.id);
      if (!(await visibleProjectIds(env, req.user)).includes(pid)) return bad('Not allowed.', 403);
      const p = await env.DB.prepare('SELECT id, name, type, start_basis FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid).first();
      if (!p) return bad('Project not found.', 404);
      if (p.start_basis !== 'pending') return bad('This project has already started.', 409);
      const basis = startNeeds(p.type), redev = basis === 'appointment_letter';
      const b = await req.json();
      if (!isDate(b.started_on) || b.started_on > todayIST()) return bad(redev ? 'Enter the date on the appointment letter (not in the future).' : 'Enter the date the sale deed was registered (not in the future).');
      const ref = String(b.start_ref == null ? '' : b.start_ref).trim().slice(0, 80);
      if (!ref) return bad(redev ? 'Enter the letter number or reference.' : 'Enter the sale deed registration number.');
      const doc = Number(b.start_doc_id) || 0;
      if (!doc || !(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ? AND deleted_at IS NULL AND (project_id = ? OR project_id IS NULL)').bind(doc, pid).first())) {
        return bad(redev ? 'Attach the scanned appointment letter.' : 'Attach the scanned sale deed (or its Index-II).');
      }
      const now = nowStr();
      const [u] = await env.DB.batch([
        env.DB.prepare("UPDATE projects SET start_basis = ?, started_on = ?, start_ref = ?, start_doc_id = ? WHERE id = ? AND start_basis = 'pending'").bind(basis, b.started_on, ref, doc, pid),
        env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'start', 'projects', ?, ?, ?)").bind(req.user.user_id, pid, `${p.name} started: ${START_BASIS[basis]} ${ref} dated ${b.started_on}`, now),
      ]);
      if (!u.meta.changes) return bad('This project has already started.', 409);
      return json({ ok: true, data: { start_basis: basis } });
    } catch (e) { return serverError(e, 'project-start'); }
  }));

  // For the Owner's Welcome page: people who see no project because nobody added them to one. 2 reads.
  router.get('/api/access/unassigned', async (req, env) => withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const roles = (await getLimitRoles(env)).filter((r) => r !== 'owner');
      if (!roles.length) return json({ ok: true, data: { count: 0, people: [] } });
      const WHERE = `FROM users u WHERE u.active = 1 AND u.deleted_at IS NULL AND u.role IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (SELECT 1 FROM project_members m JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL WHERE m.user_id = u.id AND m.removed_at IS NULL)`;
      const [n, rows] = await env.DB.batch([
        env.DB.prepare(`SELECT COUNT(*) AS n ${WHERE}`).bind(JSON.stringify(roles)),
        env.DB.prepare(`SELECT u.id, u.name, u.role ${WHERE} ORDER BY u.id DESC LIMIT 10`).bind(JSON.stringify(roles)),   // newest first
      ]);
      return json({ ok: true, data: { count: n.results[0].n, people: rows.results } });
    } catch (e) { return serverError(e, 'unassigned'); }
  }));
}
