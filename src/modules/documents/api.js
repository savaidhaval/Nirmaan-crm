// src/modules/documents/api.js — Documents vault API (§7.1)

export const routes = [
  { method: 'GET', path: '/api/documents', handler: listDocuments, perm: ['projects', 'V'] },
  { method: 'POST', path: '/api/documents', handler: createDocument, perm: ['projects', 'C'] },
  { method: 'GET', path: '/api/documents/:id', handler: getDocument, perm: ['projects', 'V'] },
  { method: 'DELETE', path: '/api/documents/:id', handler: deleteDocument, perm: ['projects', 'X'] },
];

import { query, queryOne, run, softDelete } from '../../core/db.js';
import { visibleProjectIds } from '../../core/permissions.js';
import { audit } from '../../core/audit.js';

async function listDocuments(req, env) {
  const user = req.user;
  const ids = await visibleProjectIds(env, user);
  const projectId = new URL(req.url).searchParams.get('project_id');
  if (projectId && !ids.includes(Number(projectId))) {
    return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  }
  let sql = 'SELECT * FROM documents WHERE deleted_at IS NULL';
  const params = [];
  if (projectId) {
    sql += ' AND project_id = ?';
    params.push(projectId);
  } else if (ids.length > 0) {
    sql += ' AND project_id IN (' + ids.map(() => '?').join(',') + ')';
    params.push(...ids);
  } else {
    return Response.json({ ok: true, data: { documents: [] } });
  }
  sql += ' ORDER BY created_at DESC';
  const stmt = env.DB.prepare(sql);
  params.forEach((p, i) => stmt.bind(i + 1, p));
  const { results } = await stmt.all();
  return Response.json({ ok: true, data: { documents: results } });
}

async function createDocument(req, env) {
  const user = req.user;
  const body = await req.json();
  const { project_id, title, category, kind, module, entity, entity_id, mime, size_bytes, store, drive_file_id, drive_folder_id, thumb_drive_file_id, md5, audience, language, series_key, version, is_latest, supersedes_id, external_url, r2_key, blob_id } = body;
  if (!title) {
    return Response.json({ ok: false, error: 'Title is required.' }, { status: 400 });
  }
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = await run(env.DB, `
    INSERT INTO documents (project_id, title, category, kind, module, entity, entity_id, mime, size_bytes, store, drive_file_id, drive_folder_id, thumb_drive_file_id, md5, audience, language, series_key, version, is_latest, supersedes_id, external_url, r2_key, blob_id, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [project_id || null, title, category || 'other', kind || 'file', module || null, entity || null, entity_id || null, mime || null, size_bytes || 0, store || null, drive_file_id || null, drive_folder_id || null, thumb_drive_file_id || null, md5 || null, audience || 'internal', language || null, series_key || null, version || 1, is_latest !== undefined ? is_latest : 1, supersedes_id || null, external_url || null, r2_key || null, blob_id || null, user.user_id, now]);
  await audit(env, user.user_id, 'create', 'documents', result.meta.last_row_id, `Uploaded document "${title}"`);
  return Response.json({ ok: true, data: { id: result.meta.last_row_id } });
}

async function getDocument(req, env) {
  const id = Number(req.params.id);
  const row = await queryOne(env.DB, 'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return Response.json({ ok: false, error: 'Document not found.' }, { status: 404 });
  return Response.json({ ok: true, data: row });
}

async function deleteDocument(req, env) {
  const user = req.user;
  const id = Number(req.params.id);
  await softDelete(env.DB, 'documents', id);
  await audit(env, user.user_id, 'delete', 'documents', id, `Deleted document ${id}`);
  return Response.json({ ok: true, data: { id } });
}
