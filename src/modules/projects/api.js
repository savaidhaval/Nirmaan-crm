// src/modules/projects/api.js — Projects CRUD API (§7.1)

export const routes = [
  { method: 'GET', path: '/api/projects', handler: listProjects, perm: ['projects', 'V'] },
  { method: 'POST', path: '/api/projects', handler: createProject, perm: ['projects', 'C'] },
  { method: 'GET', path: '/api/projects/:id', handler: getProject, perm: ['projects', 'V'] },
  { method: 'PUT', path: '/api/projects/:id', handler: updateProject, perm: ['projects', 'E'] },
  { method: 'DELETE', path: '/api/projects/:id', handler: deleteProject, perm: ['projects', 'X'] },
];

import { query, queryOne, run, softDelete, paginate, exists } from '../../core/db.js';
import { userCan, visibleProjectIds } from '../../core/permissions.js';
import { audit } from '../../core/audit.js';

async function listProjects(req, env) {
  const user = req.user;
  const ids = await visibleProjectIds(env, user);
  if (ids.length === 0) {
    return Response.json({ ok: true, data: { projects: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } });
  }
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT * FROM projects WHERE deleted_at IS NULL AND id IN (${placeholders}) ORDER BY name`;
  const rows = await query(env.DB, sql, ids);
  return Response.json({ ok: true, data: { projects: rows.results, page: 1, pageSize: 25, total: rows.results.length, totalPages: 1 } });
}

async function createProject(req, env) {
  const user = req.user;
  const body = await req.json();
  const { name, code, address, ward, city, type, status, rera_no, rera_expiry, start_date, target_date, budget_paise, notes } = body;
  if (!name || !code) {
    return Response.json({ ok: false, error: 'Project name and code are required.' }, { status: 400 });
  }
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = await run(env.DB, `
    INSERT INTO projects (name, code, address, ward, city, type, status, rera_no, rera_expiry, start_date, target_date, budget_paise, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [name, code, address || '', ward || '', city || 'Mumbai', type || 'new_build', status || 'planning', rera_no || '', rera_expiry || '', start_date || '', target_date || '', budget_paise || 0, notes || '', now]);
  await audit(env, user.user_id, 'create', 'projects', result.meta.last_row_id, `Created project "${name}" (${code})`);
  return Response.json({ ok: true, data: { id: result.meta.last_row_id } });
}

async function getProject(req, env) {
  const user = req.user;
  const id = Number(req.params.id);
  const ids = await visibleProjectIds(env, user);
  if (!ids.includes(id)) {
    return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  }
  const row = await queryOne(env.DB, 'SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return Response.json({ ok: false, error: 'Project not found.' }, { status: 404 });
  return Response.json({ ok: true, data: row });
}

async function updateProject(req, env) {
  const user = req.user;
  const id = Number(req.params.id);
  const ids = await visibleProjectIds(env, user);
  if (!ids.includes(id)) {
    return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  }
  const body = await req.json();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await run(env.DB, `
    UPDATE projects SET name = ?, code = ?, address = ?, ward = ?, city = ?, type = ?, status = ?, rera_no = ?, rera_expiry = ?, start_date = ?, target_date = ?, budget_paise = ?, notes = ? WHERE id = ? AND deleted_at IS NULL
  `, [body.name, body.code, body.address, body.ward, body.city, body.type, body.status, body.rera_no, body.rera_expiry, body.start_date, body.target_date, body.budget_paise, body.notes, id]);
  await audit(env, user.user_id, 'edit', 'projects', id, `Updated project ${id}`);
  return Response.json({ ok: true, data: { id } });
}

async function deleteProject(req, env) {
  const user = req.user;
  const id = Number(req.params.id);
  const ids = await visibleProjectIds(env, user);
  if (!ids.includes(id)) {
    return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  }
  await softDelete(env.DB, 'projects', id);
  await audit(env, user.user_id, 'delete', 'projects', id, `Deleted project ${id}`);
  return Response.json({ ok: true, data: { id } });
}
