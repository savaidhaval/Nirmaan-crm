// src/modules/users/api.js — User management API (§4.6)

export const routes = [
  { method: 'GET', path: '/api/users', handler: listUsers, perm: ['users_settings', 'V'] },
  { method: 'POST', path: '/api/users', handler: createUser, perm: ['users_settings', 'C'] },
  { method: 'GET', path: '/api/users/:id', handler: getUser, perm: ['users_settings', 'V'] },
  { method: 'PUT', path: '/api/users/:id', handler: updateUser, perm: ['users_settings', 'E'] },
  { method: 'DELETE', path: '/api/users/:id', handler: deactivateUser, perm: ['users_settings', 'E'] },
  { method: 'POST', path: '/api/users/:id/logout', handler: logoutUser, perm: ['users_settings', 'E'] },
];

import { query, queryOne, run, softDelete } from '../../core/db.js';
import { userCan, roleLabel, roleOneLine, visibleProjectIds } from '../../core/permissions.js';
import { makeSalt, hashPassword, bytesToBase64 } from '../../core/auth.js';
import { audit } from '../../core/audit.js';

function makeTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function listUsers(req, env) {
  const rows = await query(env.DB, 'SELECT id, name, email, phone, role, lang, active, last_login_at, must_change_password, is_primary_owner, deactivated_at, created_at FROM users WHERE deleted_at IS NULL ORDER BY name');
  return Response.json({ ok: true, data: { users: rows.results } });
}

async function createUser(req, env) {
  const user = req.user;
  const body = await req.json();
  const { name, email, phone, role, extra_roles, projects, lang } = body;
  if (!name || !email || !role) {
    return Response.json({ ok: false, error: 'Name, email, and role are required.' }, { status: 400 });
  }
  // Check second Owner safeguard
  if (role === 'owner') {
    const allowSecond = await getSettingVal(env, 'access.allow_second_owner');
    if (allowSecond !== 'on') {
      return Response.json({ ok: false, error: 'Second Owner is not enabled. Switch on access.allow_second_owner in Settings.' }, { status: 403 });
    }
    // Primary owner cannot be edited by anyone else
    const primary = await queryOne(env.DB, 'SELECT id FROM users WHERE is_primary_owner = 1 AND active = 1 AND deleted_at IS NULL LIMIT 1');
    if (primary && primary.id === user.user_id) {
      // OK, primary owner is creating
    } else {
      return Response.json({ ok: false, error: 'Only the primary Owner can create another Owner.' }, { status: 403 });
    }
  }
  // Check email uniqueness
  const existing = await queryOne(env.DB, 'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
  if (existing) {
    return Response.json({ ok: false, error: 'A user with this email already exists.' }, { status: 400 });
  }
  const tempPassword = makeTempPassword();
  const salt = makeSalt();
  const hash = await hashPassword(tempPassword, salt);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = await run(env.DB, `
    INSERT INTO users (name, email, phone, role, password_hash, password_salt, lang, active, must_change_password, extra_roles, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `, [name, email, phone || '', role, hash, bytesToBase64(salt), lang || 'en', extra_roles ? JSON.stringify(extra_roles) : null, now]);
  const userId = result.meta.last_row_id;
  // Add project memberships
  if (projects && Array.isArray(projects) && projects.length) {
    // one statement for all projects (a loop used one per project, over the free-plan 50 for a person on many projects)
    await run(env.DB, 'INSERT INTO project_members (project_id, user_id, added_by, created_at) SELECT DISTINCT value, ?, ?, ? FROM json_each(?)', [userId, user.user_id, now, JSON.stringify(projects)]);
  }
  await audit(env, user.user_id, 'create', 'users', userId, `Added ${name} as ${roleLabel(role)}`);
  return Response.json({ ok: true, data: { id: userId, temporaryPassword: tempPassword } });
}

async function getUser(req, env) {
  const id = Number(req.params.id);
  const row = await queryOne(env.DB, 'SELECT id, name, email, phone, role, lang, active, extra_roles, must_change_password, is_primary_owner, deactivated_at FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return Response.json({ ok: false, error: 'User not found.' }, { status: 404 });
  // Get project memberships
  const members = await query(env.DB, 'SELECT project_id FROM project_members WHERE user_id = ? AND removed_at IS NULL', [id]);
  row.projects = members.results.map((m) => m.project_id);
  return Response.json({ ok: true, data: row });
}

async function updateUser(req, env) {
  const user = req.user;
  const id = Number(req.params.id);
  const body = await req.json();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  // Safeguards
  const target = await queryOne(env.DB, 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!target) return Response.json({ ok: false, error: 'User not found.' }, { status: 404 });
  if (target.is_primary_owner && user.user_id !== id) {
    return Response.json({ ok: false, error: 'The primary Owner cannot be edited by anyone else.' }, { status: 403 });
  }
  if (id === user.user_id && body.role && body.role !== target.role) {
    return Response.json({ ok: false, error: 'You cannot change your own role.' }, { status: 403 });
  }
  const fields = [];
  const values = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email); }
  if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone); }
  if (body.role !== undefined) { fields.push('role = ?'); values.push(body.role); }
  if (body.lang !== undefined) { fields.push('lang = ?'); values.push(body.lang); }
  if (body.active !== undefined) { fields.push('active = ?'); values.push(body.active ? 1 : 0); }
  if (body.extra_roles !== undefined) { fields.push('extra_roles = ?'); values.push(JSON.stringify(body.extra_roles)); }
  if (fields.length > 0) {
    values.push(now, id);
    await run(env.DB, `UPDATE users SET ${fields.join(', ')}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, values);
  }
  // Update project memberships
  if (body.projects !== undefined && Array.isArray(body.projects)) {
    await run(env.DB, 'UPDATE project_members SET removed_at = ? WHERE user_id = ? AND removed_at IS NULL', [now, id]);
    if (body.projects.length) {
      await run(env.DB, 'INSERT INTO project_members (project_id, user_id, added_by, created_at) SELECT DISTINCT value, ?, ?, ? FROM json_each(?)', [id, user.user_id, now, JSON.stringify(body.projects)]);
    }
  }
  await audit(env, user.user_id, 'edit', 'users', id, `Updated user ${id}`);
  return Response.json({ ok: true, data: { id } });
}

async function deactivateUser(req, env) {
  const user = req.user;
  const id = Number(req.params.id);
  const target = await queryOne(env.DB, 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!target) return Response.json({ ok: false, error: 'User not found.' }, { status: 404 });
  if (target.is_primary_owner) {
    return Response.json({ ok: false, error: 'The primary Owner cannot be deactivated.' }, { status: 403 });
  }
  // Ensure at least one active Owner remains
  if (target.role === 'owner') {
    const ownerCount = await queryOne(env.DB, 'SELECT count(*) as cnt FROM users WHERE role = ? AND active = 1 AND deleted_at IS NULL', ['owner']);
    if (Number(ownerCount.cnt) <= 1) {
      return Response.json({ ok: false, error: 'At least one active Owner is required.' }, { status: 403 });
    }
  }
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await run(env.DB, 'UPDATE users SET active = 0, deactivated_at = ?, deactivated_by = ? WHERE id = ?', [now, user.user_id, id]);
  await run(env.DB, 'DELETE FROM sessions WHERE user_id = ?', [id]);
  await audit(env, user.user_id, 'deactivate', 'users', id, `Deactivated user ${target.name}`);
  return Response.json({ ok: true, data: { id } });
}

async function logoutUser(req, env) {
  const id = Number(req.params.id);
  await run(env.DB, 'DELETE FROM sessions WHERE user_id = ?', [id]);
  return Response.json({ ok: true, data: { message: 'All sessions logged out.' } });
}

async function getSettingVal(env, key) {
  const row = await queryOne(env.DB, 'SELECT value_json FROM settings WHERE key = ?', [key]);
  if (!row) return null;
  try { return JSON.parse(row.value_json); } catch (e) { return row.value_json; }
}
