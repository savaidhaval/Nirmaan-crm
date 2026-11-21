// src/index.js — NirmaanCRM Worker entry point

import { Router } from './core/router.js';
import {
  getCurrentUser, loginPassword, logout, ensureBootstrapOwner,
  setSessionCookie, clearSessionCookie, createOtpCode, verifyOtpCode, createSession,
} from './core/auth.js';
import { userCan } from './core/permissions.js';
import { query } from './core/db.js';
import { sendMail, retryFailedEmails, sendDigest } from './core/mail.js';
import * as gdrive from './core/gdrive.js';

const router = new Router();

let bootstrapped = false;
async function ensureBootstrap(env) {
  if (!bootstrapped) {
    await ensureBootstrapOwner(env);
    bootstrapped = true;
  }
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function requireAuth(user) {
  if (!user) throw new Error('Please log in.');
  if (!user.active || user.deactivated_at) throw new Error('Account deactivated.');
  return user;
}

async function withAuth(req, env, module, action, handler, requireHeader = true) {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  requireAuth(user);
  if (!userCan(user, module, action)) {
    return json({ ok: false, error: 'Not allowed.' }, 403);
  }
  if (requireHeader && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
    if (req.headers.get('X-NirmaanCRM') !== '1') {
      return json({ ok: false, error: 'Invalid request.' }, 403);
    }
  }
  req.user = user;
  req.env = env;
  return handler(req, env);
}

// ---------- Health (public) ----------
router.get('/api/health', async (req, env) => {
  return json({ ok: true, env: env.ENVIRONMENT || 'production' });
});

// ---------- Debug: test permissions ----------
router.get('/api/debug/perm', async (req, env) => {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  if (!user) return json({ ok: false, error: 'Not logged in' }, 401);
  const canProjects = userCan(user, 'projects', 'V');
  const canUsers = userCan(user, 'users_settings', 'V');
  return json({ ok: true, role: user.role, canProjects, canUsers });
});

// ---------- Auth routes ----------
router.post('/api/auth/login', async (req, env) => {
  try {
    await ensureBootstrap(env);
  } catch (e) {
    return json({ ok: false, error: 'bootstrap: ' + e.message }, 500);
  }
  const { email, password } = await req.json();
  if (!email || !password) {
    return json({ ok: false, error: 'Please enter email and password.' }, 400);
  }
  try {
    const { user, session } = await loginPassword(env, email, password, req.headers.get('user-agent') || '');
    const res = json({ ok: true, data: { user: safeUser(user), must_change_password: !!user.must_change_password } });
    setSessionCookie(res, session.tokenHash, session.expiresAt);
    return res;
  } catch (e) {
    return json({ ok: false, error: 'login: ' + e.message }, 500);
  }
});

router.post('/api/auth/logout', async (req, env) => {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  if (user) await logout(env, user.session_id);
  const res = json({ ok: true });
  clearSessionCookie(res);
  return res;
});

router.get('/api/auth/me', async (req, env) => {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  if (!user) return json({ ok: false, error: 'Please log in.' }, 401);
  if (!user.active || user.deactivated_at) return json({ ok: false, error: 'Account deactivated.' }, 403);
  return json({ ok: true, data: { user: safeUser(user), must_change_password: !!user.must_change_password } });
});

router.post('/api/auth/change-password', async (req, env) => {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  if (!user) return json({ ok: false, error: 'Please log in.' }, 401);
  const { currentPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 10) {
    return json({ ok: false, error: 'New password must be at least 10 characters.' }, 400);
  }
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').bind(user.user_id).first();
  if (!row) return json({ ok: false, error: 'User not found.' }, 404);
  const ok = await verifyPassword(currentPassword, base64ToBytes(row.password_salt), row.password_hash);
  if (!ok) return json({ ok: false, error: 'Current password is incorrect.' }, 400);
  const salt = makeSalt();
  const hash = await hashPassword(newPassword, salt);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?`).bind(hash, bytesToBase64(salt), now, user.user_id).run();
  return json({ ok: true, data: { message: 'Password changed.' } });
});

// ---------- Projects routes ----------
router.get('/api/projects', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) {
        return json({ ok: true, data: { projects: [] } });
      }
      const placeholders = ids.map(() => '?').join(',');
      const sql = `SELECT * FROM projects WHERE deleted_at IS NULL AND id IN (${placeholders}) ORDER BY name`;
      const { results } = await query(env.DB, sql, ids);
      return json({ ok: true, data: { projects: results } });
    } catch (e) {
      return json({ ok: false, error: 'list: ' + e.message }, 500);
    }
  });
});

router.post('/api/projects', async (req, env) => {
  return withAuth(req, env, 'projects', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { name, code, address, ward, city, type, status, rera_no, rera_expiry, start_date, target_date, budget_paise, notes } = body;
      if (!name || !code) {
        return json({ ok: false, error: 'Project name and code are required.' }, 400);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`
        INSERT INTO projects (name, code, address, ward, city, type, status, rera_no, rera_expiry, start_date, target_date, budget_paise, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(name, code, address || '', ward || '', city || 'Mumbai', type || 'new_build', status || 'planning', rera_no || '', rera_expiry || '', start_date || '', target_date || '', budget_paise || 0, notes || '', now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'projects', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created project "${name}" (${code})`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'create: ' + e.message }, 500);
    }
  });
});

router.get('/api/projects/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    const user = req.user;
    const id = Number(req.params.id);
    const ids = await visibleProjectIds(env, user);
    if (!ids.includes(id)) {
      return json({ ok: false, error: 'Not allowed.' }, 403);
    }
    const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!row) return json({ ok: false, error: 'Project not found.' }, 404);
    return json({ ok: true, data: row });
  });
});

router.put('/api/projects/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'E', async (req, env) => {
    const user = req.user;
    const id = Number(req.params.id);
    const ids = await visibleProjectIds(env, user);
    if (!ids.includes(id)) {
      return json({ ok: false, error: 'Not allowed.' }, 403);
    }
    const body = await req.json();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await env.DB.prepare(`UPDATE projects SET name = ?, code = ?, address = ?, ward = ?, city = ?, type = ?, status = ?, rera_no = ?, rera_expiry = ?, start_date = ?, target_date = ?, budget_paise = ?, notes = ? WHERE id = ? AND deleted_at IS NULL`).bind(body.name, body.code, body.address, body.ward, body.city, body.type, body.status, body.rera_no, body.rera_expiry, body.start_date, body.target_date, body.budget_paise, body.notes, id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'projects', ?, ?, ?)`).bind(user.user_id, 'edit', id, `Updated project ${id}`, now).run();
    return json({ ok: true, data: { id } });
  });
});

router.delete('/api/projects/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'X', async (req, env) => {
    const user = req.user;
    const id = Number(req.params.id);
    const ids = await visibleProjectIds(env, user);
    if (!ids.includes(id)) {
      return json({ ok: false, error: 'Not allowed.' }, 403);
    }
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await env.DB.prepare(`UPDATE projects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(now, id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'projects', ?, ?, ?)`).bind(user.user_id, 'delete', id, `Deleted project ${id}`, now).run();
    return json({ ok: true, data: { id } });
  });
});

// ---------- Users routes ----------
router.get('/api/users', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    const rows = await env.DB.prepare('SELECT id, name, email, phone, role, lang, active, last_login_at, must_change_password, is_primary_owner, deactivated_at, created_at FROM users WHERE deleted_at IS NULL ORDER BY name').all();
    return json({ ok: true, data: { users: rows.results } });
  });
});

router.post('/api/users', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'C', async (req, env) => {
    const user = req.user;
    const body = await req.json();
    const { name, email, phone, role, extra_roles, projects, lang } = body;
    if (!name || !email || !role) {
      return json({ ok: false, error: 'Name, email, and role are required.' }, 400);
    }
    if (role === 'owner') {
      const allowSecond = await env.DB.prepare("SELECT value_json FROM settings WHERE key = ?").bind('access.allow_second_owner').first();
      if (!allowSecond || allowSecond.value_json !== '"on"') {
        return json({ ok: false, error: 'Second Owner is not enabled.' }, 403);
      }
    }
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').bind(email).first();
    if (existing) {
      return json({ ok: false, error: 'A user with this email already exists.' }, 400);
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let tempPassword = '';
    for (let i = 0; i < 12; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];
    const salt = makeSalt();
    const hash = await hashPassword(tempPassword, salt);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const result = await env.DB.prepare(`INSERT INTO users (name, email, phone, role, password_hash, password_salt, lang, active, must_change_password, extra_roles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`).bind(name, email, phone || '', role, hash, bytesToBase64(salt), lang || 'en', extra_roles ? JSON.stringify(extra_roles) : null, now).run();
    const userId = result.meta.last_row_id;
    if (projects && Array.isArray(projects)) {
      for (const pid of projects) {
        await env.DB.prepare('INSERT INTO project_members (project_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)').bind(pid, userId, user.user_id, now).run();
      }
    }
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'users', ?, ?, ?)`).bind(user.user_id, 'create', userId, `Added ${name} as ${roleLabel(role)}`, now).run();
    return json({ ok: true, data: { id: userId, temporaryPassword: tempPassword } });
  });
});

// ---------- Documents routes ----------
router.get('/api/documents', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const user = req.user;
      const url = new URL(req.url);
      const projectId = url.searchParams.get('project_id');
      const ids = await visibleProjectIds(env, user);
      let sql = 'SELECT * FROM documents WHERE deleted_at IS NULL';
      const params = [];
      if (projectId) {
        if (!ids.includes(Number(projectId))) {
          return json({ ok: false, error: 'Not allowed.' }, 403);
        }
        sql += ' AND project_id = ?';
        params.push(projectId);
      } else if (ids.length > 0) {
        sql += ' AND project_id IN (' + ids.map(() => '?').join(',') + ')';
        params.push(...ids);
      } else {
        return json({ ok: true, data: { documents: [] } });
      }
      sql += ' ORDER BY created_at DESC';
      const rows = await query(env.DB, sql, params);
      return json({ ok: true, data: { documents: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'docs: ' + e.message }, 500);
    }
  });
});

router.post('/api/documents', async (req, env) => {
  return withAuth(req, env, 'projects', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, title, category, kind, module, entity, entity_id, mime, size_bytes, store, drive_file_id, drive_folder_id, thumb_drive_file_id, md5, audience, language, series_key, version, is_latest, supersedes_id, external_url, r2_key, blob_id } = body;
      if (!title) {
        return json({ ok: false, error: 'Title is required.' }, 400);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`
        INSERT INTO documents (project_id, title, category, kind, module, entity, entity_id, mime, size_bytes, store, drive_file_id, drive_folder_id, thumb_drive_file_id, md5, audience, language, series_key, version, is_latest, supersedes_id, external_url, r2_key, blob_id, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(project_id || null, title, category || 'other', kind || 'file', module || null, entity || null, entity_id || null, mime || null, size_bytes || 0, store || null, drive_file_id || null, drive_folder_id || null, thumb_drive_file_id || null, md5 || null, audience || 'internal', language || null, series_key || null, version || 1, is_latest !== undefined ? is_latest : 1, supersedes_id || null, external_url || null, r2_key || null, blob_id || null, user.user_id, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'documents', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Uploaded document "${title}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'doc-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/documents/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').bind(id).first();
      if (!row) return json({ ok: false, error: 'Document not found.' }, 404);
      return json({ ok: true, data: row });
    } catch (e) {
      return json({ ok: false, error: 'doc-get: ' + e.message }, 500);
    }
  });
});

router.delete('/api/documents/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'X', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare(`UPDATE documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(now, id).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'documents', ?, ?, ?)`).bind(req.user.user_id, 'delete', id, `Deleted document ${id}`, now).run();
      return json({ ok: true, data: { id } });
    } catch (e) {
      return json({ ok: false, error: 'doc-delete: ' + e.message }, 500);
    }
  });
});

// ---------- Settings routes ----------
router.get('/api/settings', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT key, value_json FROM settings').all();
      const settings = {};
      for (const r of rows.results) {
        try { settings[r.key] = JSON.parse(r.value_json); } catch (e) { settings[r.key] = r.value_json; }
      }
      return json({ ok: true, data: { settings } });
    } catch (e) {
      return json({ ok: false, error: 'settings: ' + e.message }, 500);
    }
  });
});

router.post('/api/settings/:key', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const key = req.params.key;
      const body = await req.json();
      const { value } = body;
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare(`INSERT INTO settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at`).bind(key, val, req.user.user_id, now).run();
      return json({ ok: true, data: { key, value } });
    } catch (e) {
      return json({ ok: false, error: 'settings-set: ' + e.message }, 500);
    }
  });
});

// ---------- Notifications routes ----------
router.get('/api/notifications', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(req.user.user_id).all();
      return json({ ok: true, data: { notifications: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'notif: ' + e.message }, 500);
    }
  });
});

router.post('/api/notifications/:id/read', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').bind(now, id, req.user.user_id).run();
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'notif-read: ' + e.message }, 500);
    }
  });
});

// ---------- Audit routes ----------
router.get('/api/audit', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT al.*, u.name, u.email FROM audit_log al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.created_at DESC LIMIT 100').all();
      return json({ ok: true, data: { audit: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'audit: ' + e.message }, 500);
    }
  });
});

// ---------- Approvals routes ----------
router.get('/api/approvals', async (req, env) => {
  return withAuth(req, env, 'approvals', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { items: [] } });
      const sql = `SELECT * FROM apr_items WHERE deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')}) ORDER BY stage_order, name`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { items: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'apr-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/approvals', async (req, env) => {
  return withAuth(req, env, 'approvals', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, name, authority, category, stage_order, status, applied_on, approved_on, valid_till, reminder_days, renew_months, owner_user_id, consultant, fee_paise, notes } = body;
      if (!project_id || !name) {
        return json({ ok: false, error: 'Project and name are required.' }, 400);
      }
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(project_id))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO apr_items (project_id, name, authority, category, stage_order, status, applied_on, approved_on, valid_till, reminder_days, renew_months, owner_user_id, consultant, fee_paise, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, name, authority || '', category || 'approval', stage_order || 100, status || 'not_started', applied_on || null, approved_on || null, valid_till || null, reminder_days || 30, renew_months || null, owner_user_id || null, consultant || '', fee_paise || 0, notes || '', now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'apr_items', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created approval "${name}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'apr-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/approvals/:id', async (req, env) => {
  return withAuth(req, env, 'approvals', 'V', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const item = await env.DB.prepare('SELECT * FROM apr_items WHERE id = ? AND deleted_at IS NULL').bind(id).first();
      if (!item) return json({ ok: false, error: 'Approval item not found.' }, 404);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.includes(item.project_id)) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const events = await env.DB.prepare('SELECT * FROM apr_events WHERE item_id = ? ORDER BY created_at').bind(id).all();
      return json({ ok: true, data: { item, events: events.results } });
    } catch (e) {
      return json({ ok: false, error: 'apr-get: ' + e.message }, 500);
    }
  });
});

router.post('/api/approvals/:id/event', async (req, env) => {
  return withAuth(req, env, 'approvals', 'E', async (req, env) => {
    try {
      const user = req.user;
      const id = Number(req.params.id);
      const body = await req.json();
      const { event, note } = body;
      if (!event) {
        return json({ ok: false, error: 'Event is required.' }, 400);
      }
      const item = await env.DB.prepare('SELECT * FROM apr_items WHERE id = ? AND deleted_at IS NULL').bind(id).first();
      if (!item) return json({ ok: false, error: 'Approval item not found.' }, 404);
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(item.project_id)) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare(`INSERT INTO apr_events (item_id, event, note, by_user, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, event, note || '', user.user_id, now).run();
      // Update item status based on event
      let newStatus = item.status;
      if (event === 'applied') newStatus = 'applied';
      if (event === 'query') newStatus = 'query';
      if (event === 'approved') { newStatus = 'approved'; }
      if (event === 'rejected') newStatus = 'rejected';
      if (event === 'expired') newStatus = 'expired';
      if (event === 'na') newStatus = 'na';
      const updates = [];
      const vals = [];
      if (newStatus !== item.status) { updates.push('status = ?'); vals.push(newStatus); }
      if (event === 'applied' && applied_on) { updates.push('applied_on = ?'); vals.push(applied_on); }
      if (event === 'approved' && approved_on) { updates.push('approved_on = ?'); vals.push(approved_on); }
      if (updates.length > 0) {
        vals.push(now, id);
        await query(env.DB, `UPDATE apr_items SET ${updates.join(', ')} WHERE id = ?`, vals);
      }
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'apr_items', ?, ?, ?)`).bind(user.user_id, 'event', id, `Approval event: ${event}`, now).run();
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'apr-event: ' + e.message }, 500);
    }
  });
});

// ---------- Drawings routes ----------
router.get('/api/drawings', async (req, env) => {
  return withAuth(req, env, 'drawings', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { drawings: [] } });
      const sql = `SELECT d.*, (SELECT rev_no FROM drw_revisions WHERE drawing_id = d.id AND status = 'ifc' AND deleted_at IS NULL LIMIT 1) AS current_ifc_rev FROM drw_drawings d WHERE d.deleted_at IS NULL AND d.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY d.discipline, d.code`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { drawings: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'drw-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/drawings', async (req, env) => {
  return withAuth(req, env, 'drawings', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, code, title, discipline, zone, waiting_consultant } = body;
      if (!project_id || !code || !title) {
        return json({ ok: false, error: 'Project, code, and title are required.' }, 400);
      }
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(project_id))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO drw_drawings (project_id, code, title, discipline, zone, waiting_consultant, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(project_id, code, title, discipline || 'arch', zone || '', waiting_consultant || 0, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'drw_drawings', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created drawing "${code}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'drw-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/drawings/:id/revisions', async (req, env) => {
  return withAuth(req, env, 'drawings', 'V', async (req, env) => {
    try {
      const drawingId = Number(req.params.id);
      const drawing = await env.DB.prepare('SELECT * FROM drw_drawings WHERE id = ? AND deleted_at IS NULL').bind(drawingId).first();
      if (!drawing) return json({ ok: false, error: 'Drawing not found.' }, 404);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.includes(drawing.project_id)) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const rows = await env.DB.prepare('SELECT * FROM drw_revisions WHERE drawing_id = ? ORDER BY created_at DESC').bind(drawingId).all();
      return json({ ok: true, data: { revisions: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'drw-rev: ' + e.message }, 500);
    }
  });
});

// ---------- Site Execution routes ----------
router.get('/api/site/milestones', async (req, env) => {
  return withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { milestones: [] } });
      const sql = `SELECT * FROM site_milestones WHERE deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order, name`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { milestones: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'ms-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/site/milestones/:id/done', async (req, env) => {
  return withAuth(req, env, 'site', 'E', async (req, env) => {
    try {
      const user = req.user;
      const id = Number(req.params.id);
      const body = await req.json();
      const { actual_date } = body;
      const ms = await env.DB.prepare('SELECT * FROM site_milestones WHERE id = ? AND deleted_at IS NULL').bind(id).first();
      if (!ms) return json({ ok: false, error: 'Milestone not found.' }, 404);
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(ms.project_id)) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const doneDate = actual_date || now;
      await env.DB.prepare(`UPDATE site_milestones SET status = 'done', actual_date = ? WHERE id = ?`).bind(doneDate, id).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'site_milestones', ?, ?, ?)`).bind(user.user_id, 'done', id, `Milestone marked done: ${ms.name}`, now).run();
      return json({ ok: true, data: { id, actual_date: doneDate } });
    } catch (e) {
      return json({ ok: false, error: 'ms-done: ' + e.message }, 500);
    }
  });
});

router.get('/api/site/dprs', async (req, env) => {
  return withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { dprs: [] } });
      const sql = `SELECT * FROM site_dprs WHERE deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')}) ORDER BY report_date DESC`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { dprs: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'dpr-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/site/dprs', async (req, env) => {
  return withAuth(req, env, 'site', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, report_date, wing, work_summary, labour_count, weather, materials_used, issues, safety_incident, client_uuid } = body;
      if (!project_id || !report_date || !work_summary) {
        return json({ ok: false, error: 'Project, date, and work summary are required.' }, 400);
      }
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(project_id))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO site_dprs (project_id, report_date, wing, work_summary, labour_count, weather, materials_used, issues, safety_incident, created_by, client_uuid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, report_date, wing || '', work_summary, labour_count || 0, weather || '', materials_used || '', issues || '', safety_incident || '', user.user_id, client_uuid || makeId(22), now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'site_dprs', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `DPR filed for ${report_date}`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'dpr-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/site/snags', async (req, env) => {
  return withAuth(req, env, 'site', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { snags: [] } });
      const sql = `SELECT * FROM site_snags WHERE deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { snags: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'snag-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/site/snags', async (req, env) => {
  return withAuth(req, env, 'site', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, wing, location, title, severity, assigned_to, due_date, client_uuid } = body;
      if (!project_id || !title) {
        return json({ ok: false, error: 'Project and title are required.' }, 400);
      }
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(project_id))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO site_snags (project_id, wing, location, title, severity, assigned_to, due_date, created_by, client_uuid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, wing || '', location || '', title, severity || 'medium', assigned_to || null, due_date || null, user.user_id, client_uuid || makeId(22), now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'site_snags', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Snag created: ${title}`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'snag-create: ' + e.message }, 500);
    }
  });
});

// ---------- Procurement routes ----------
router.get('/api/procurement/vendors', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT * FROM pro_vendors WHERE deleted_at IS NULL ORDER BY name').all();
      return json({ ok: true, data: { vendors: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'vendors: ' + e.message }, 500);
    }
  });
});

router.post('/api/procurement/vendors', async (req, env) => {
  return withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { name, category, contact_person, phone, email, gstin, address, rating, notes } = body;
      if (!name) return json({ ok: false, error: 'Vendor name is required.' }, 400);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO pro_vendors (name, category, contact_person, phone, email, gstin, address, rating, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(name, category || '', contact_person || '', phone || '', email || '', gstin || '', address || '', rating || 0, notes || '', now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'pro_vendors', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created vendor "${name}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'vendor-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/procurement/rfqs', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      let sql = 'SELECT * FROM pro_rfqs WHERE deleted_at IS NULL';
      const params = [];
      if (ids.length > 0) {
        sql += ' AND project_id IN (' + ids.map(() => '?').join(',') + ')';
        params.push(...ids);
      } else {
        return json({ ok: true, data: { rfqs: [] } });
      }
      sql += ' ORDER BY created_at DESC';
      const rows = await query(env.DB, sql, params);
      return json({ ok: true, data: { rfqs: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'rfq-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/procurement/rfqs', async (req, env) => {
  return withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, title, material, qty, unit, needed_by } = body;
      if (!title) return json({ ok: false, error: 'RFQ title is required.' }, 400);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO pro_rfqs (project_id, title, material, qty, unit, needed_by, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id || null, title, material || '', qty || 0, unit || '', needed_by || null, user.user_id, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'rfq-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/procurement/pos', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { pos: [] } });
      const sql = `SELECT * FROM pro_pos WHERE deleted_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { pos: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'po-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/procurement/pos', async (req, env) => {
  return withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, vendor_id, rfq_id, amount_paise, gst_bp, gst_paise, total_paise, terms, status } = body;
      if (!project_id || !vendor_id || !amount_paise) {
        return json({ ok: false, error: 'Project, vendor, and amount are required.' }, 400);
      }
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(project_id))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      // Get next PO seq
      const counter = await env.DB.prepare('SELECT value FROM counters WHERE key = ?').bind(`po:${project_id}`).first();
      const nextSeq = (counter ? Number(counter.value) : 0) + 1;
      await env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(`po:${project_id}`, nextSeq).run();
      const poNo = `PO-${project_id}-${String(nextSeq).padStart(4, '0')}`;
      const result = await env.DB.prepare(`INSERT INTO pro_pos (project_id, vendor_id, rfq_id, po_no, po_seq, amount_paise, gst_bp, gst_paise, total_paise, terms, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, vendor_id, rfq_id || null, poNo, nextSeq, amount_paise, gst_bp || 1800, gst_paise || 0, total_paise || amount_paise, terms || '', status || 'draft', user.user_id, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'pro_pos', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created PO ${poNo}`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id, po_no: poNo } });
    } catch (e) {
      return json({ ok: false, error: 'po-create: ' + e.message }, 500);
    }
  });
});

// ---------- Sales CRM routes ----------
router.get('/api/sales/leads', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const user = req.user;
      const sql = user.role === 'owner' || user.role === 'pm'
        ? 'SELECT * FROM sal_leads WHERE deleted_at IS NULL ORDER BY created_at DESC'
        : 'SELECT * FROM sal_leads WHERE deleted_at IS NULL AND assigned_to = ? ORDER BY created_at DESC';
      const params = user.role === 'owner' || user.role === 'pm' ? [] : [user.user_id];
      const rows = await query(env.DB, sql, params);
      return json({ ok: true, data: { leads: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'lead-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/sales/leads', async (req, env) => {
  return withAuth(req, env, 'sales', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { name, phone, project_id, source, source_detail, budget_paise, config_pref, status, consent, consent_at } = body;
      if (!name || !phone) {
        return json({ ok: false, error: 'Name and phone are required.' }, 400);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO sal_leads (project_id, name, phone, email, source, source_detail, budget_paise, config_pref, status, assigned_to, consent, consent_at, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id || null, name, phone, body.email || '', source || 'other', source_detail || '', budget_paise || 0, config_pref || '', status || 'new', user.user_id, consent || 0, consent_at || null, body.notes || '', now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'sal_leads', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created lead "${name}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'lead-create: ' + e.message }, 500);
    }
  });
});

router.get('/api/sales/inventory', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const user = req.user;
      const projectId = req.url.searchParams.get('project_id');
      if (!projectId) return json({ ok: false, error: 'project_id required.' }, 400);
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(projectId))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const rows = await env.DB.prepare('SELECT * FROM sal_inventory WHERE project_id = ? AND deleted_at IS NULL ORDER BY wing, floor, unit_no').bind(projectId).all();
      return json({ ok: true, data: { inventory: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'inventory: ' + e.message }, 500);
    }
  });
});

// ---------- Branding routes ----------
router.get('/api/branding', async (req, env) => {
  return withAuth(req, env, 'branding', 'V', async (req, env) => {
    try {
      const projectId = req.url.searchParams.get('project_id') || null;
      const row = await env.DB.prepare('SELECT * FROM brand_profiles WHERE project_id IS ?').bind(projectId === null ? null : Number(projectId)).first();
      // Actually use COALESCE for project_id NULL vs value
      const rows = await env.DB.prepare('SELECT * FROM brand_profiles WHERE project_id IS NULL').all();
      return json({ ok: true, data: { branding: rows.results[0] || null } });
    } catch (e) {
      return json({ ok: false, error: 'branding: ' + e.message }, 500);
    }
  });
});

router.post('/api/branding', async (req, env) => {
  return withAuth(req, env, 'branding', 'E', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare(`INSERT INTO brand_profiles (project_id, legal_name, trade_name, tagline, address, phone, email, website, gstin, cin_or_llpin, promoter_rera_ref, pan_enc, bank_account_name, bank_name, bank_branch, bank_ifsc, bank_account_enc, signatory_name, signatory_title, footer_text, wa_intro_text, colour_primary, colour_secondary, colour_accent, letterhead_mode, margin_top_mm, margin_bottom_mm, margin_side_mm, updated_by, updated_at, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        body.legal_name || '', body.trade_name || '', body.tagline || '', body.address || '', body.phone || '', body.email || '', body.website || '',
        body.gstin || '', body.cin_or_llpin || '', body.promoter_rera_ref || '', body.pan_enc || null, body.bank_account_name || '', body.bank_name || '',
        body.bank_branch || '', body.bank_ifsc || '', body.bank_account_enc || null, body.signatory_name || '', body.signatory_title || '',
        body.footer_text || '', body.wa_intro_text || '', body.colour_primary || '#1d4ed8', body.colour_secondary || '', body.colour_accent || '',
        body.letterhead_mode || 'generated', body.margin_top_mm || 45, body.margin_bottom_mm || 30, body.margin_side_mm || 20, user.user_id, now
      ).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'brand_profiles', ?, ?, ?)`).bind(user.user_id, 'create', 0, 'Updated company branding', now).run();
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'branding-set: ' + e.message }, 500);
    }
  });
});

// ---------- Share links routes ----------
router.get('/api/share-links', async (req, env) => {
  return withAuth(req, env, 'share_links', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT sl.*, d.title FROM share_links sl JOIN documents d ON d.id = sl.document_id WHERE sl.revoked_at IS NULL ORDER BY sl.created_at DESC LIMIT 50').all();
      return json({ ok: true, data: { links: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'share-list: ' + e.message }, 500);
    }
  });
});

router.post('/api/share-links', async (req, env) => {
  return withAuth(req, env, 'share_links', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { document_id, expires_at, max_views, recipient_label } = body;
      if (!document_id) return json({ ok: false, error: 'Document is required.' }, 400);
      const token = crypto.getRandomValues(new Uint8Array(32));
      const tokenHash = await crypto.subtle.digest('SHA-256', token);
      const tokenB64 = bytesToBase64(token);
      const hashB64 = bytesToBase64(new Uint8Array(tokenHash));
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO share_links (token_hash, document_id, project_id, recipient_label, created_by, expires_at, max_views, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`).bind(hashB64, document_id, recipient_label || '', user.user_id, expires_at, max_views || null, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'share_links', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created share link`, now).run();
      return json({ ok: true, data: { token: tokenB64, link: `/s/${tokenB64}` } });
    } catch (e) {
      return json({ ok: false, error: 'share-create: ' + e.message }, 500);
    }
  });
});

// ---------- Email routes ----------
router.post('/api/email/test', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const body = await req.json();
      const { to } = body;
      if (!to) return json({ ok: false, error: 'Recipient email required.' }, 400);
      const result = await sendMail(env, to, 'NirmaanCRM Test Email', '<h1>Test Email</h1><p>This is a test email from your NirmaanCRM system.</p>');
      return json({ ok: true, data: { sent: result.sent, error: result.error } });
    } catch (e) {
      return json({ ok: false, error: 'email-test: ' + e.message }, 500);
    }
  });
});

router.get('/api/email/log', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 50').all();
      return json({ ok: true, data: { emails: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'email-log: ' + e.message }, 500);
    }
  });
});

router.post('/api/auth/otp/send', async (req, env) => {
  try {
    const { email } = await req.json();
    if (!email) return json({ ok: false, error: 'Email required.' }, 400);
    const code = await createOtpCode(env, email);
    // Send the code via email
    await sendMail(env, email, 'Your NirmaanCRM Login Code', `<h1>Login Code</h1><p>Your code is <strong>${code}</strong>. It expires in 10 minutes.</p>`);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: 'otp-send: ' + e.message }, 500);
  }
});

router.post('/api/auth/otp/verify', async (req, env) => {
  try {
    const { email, code } = await req.json();
    if (!email || !code) return json({ ok: false, error: 'Email and code required.' }, 400);
    const result = await verifyOtpCode(env, email, code);
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    const user = result.user;
    const session = await createSession(env, user.id, req.headers.get('user-agent') || '');
    const res = json({ ok: true, data: { user: safeUser({ user_id: user.id, ...user }), must_change_password: !!user.must_change_password } });
    setSessionCookie(res, session.tokenHash, session.expiresAt);
    return res;
  } catch (e) {
    return json({ ok: false, error: 'otp-verify: ' + e.message }, 500);
  }
});

// ---------- Document file upload/download ----------
router.post('/api/files/upload', async (req, env) => {
  return withAuth(req, env, 'projects', 'C', async (req, env) => {
    try {
      const user = req.user;
      const formData = await req.formData();
      const file = formData.get('file');
      const projectId = formData.get('project_id');
      const title = formData.get('title');
      const category = formData.get('category') || 'other';
      const module = formData.get('module');
      const entity = formData.get('entity');
      const entityId = formData.get('entity_id');
      const audience = formData.get('audience') || 'internal';
      const language = formData.get('language') || null;
      const seriesKey = formData.get('series_key') || null;

      if (!file || !title) {
        return json({ ok: false, error: 'File and title are required.' }, 400);
      }

      // Upload allow-list — no SVG/HTML (§11.2)
      const allowedTypes = ['image/jpeg','image/png','image/webp','image/heic','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'];
      if (!allowedTypes.includes(file.type)) {
        return json({ ok: false, error: 'This file type is not allowed. Please upload JPG, PNG, PDF, CSV, or documents only.' }, 400);
      }
      if (file.name.toLowerCase().endsWith('.svg') || file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) {
        return json({ ok: false, error: 'SVG and HTML files are not allowed for security.' }, 400);
      }

      const ids = await visibleProjectIds(env, user);
      if (projectId && !ids.includes(Number(projectId))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const sizeBytes = bytes.length;

      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const blobResult = await env.DB.prepare(`INSERT INTO file_blobs (mime, size_bytes, data, created_at) VALUES (?, ?, ?, ?)`).bind(file.type, sizeBytes, bytes, now).run();
      const blobId = blobResult.meta.last_row_id;

      const docResult = await env.DB.prepare(`
        INSERT INTO documents (project_id, title, category, kind, module, entity, entity_id, mime, size_bytes, store, blob_id, audience, language, series_key, version, is_latest, uploaded_by, created_at)
        VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, 'd1', ?, ?, ?, ?, 1, 1, ?, ?)
      `).bind(projectId || null, title, category, module || null, entity || null, entityId || null, file.type, sizeBytes, blobId, audience, language, seriesKey, user.user_id, now).run();

      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'documents', ?, ?, ?)`).bind(user.user_id, 'create', docResult.meta.last_row_id, `Uploaded file "${title}"`, now).run();

      return json({ ok: true, data: { id: docResult.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: 'file-upload: ' + e.message }, 500);
    }
  });
});

router.get('/api/files/download/:docId', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const docId = Number(req.params.docId);
      const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').bind(docId).first();
      if (!doc) return json({ ok: false, error: 'Document not found.' }, 404);

      const ids = await visibleProjectIds(env, req.user);
      if (doc.project_id && !ids.includes(doc.project_id)) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }

      if (doc.store === 'd1' || doc.store === null) {
        const blob = await env.DB.prepare('SELECT * FROM file_blobs WHERE id = ?').bind(doc.blob_id).first();
        if (!blob) return json({ ok: false, error: 'File data not found.' }, 404);
        return new Response(blob.data, {
          headers: {
            'Content-Type': doc.mime || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${doc.title}"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }

      return json({ ok: false, error: 'File storage mode not yet implemented.' }, 501);
    } catch (e) {
      return json({ ok: false, error: 'file-download: ' + e.message }, 500);
    }
  });
});

// ---------- Branding images (public) ----------
router.get('/brand/logo.png', async (req, env) => {
  return serveBrandingFile(env, 'brand:logo');
});

router.get('/brand/logo_icon.png', async (req, env) => {
  return serveBrandingFile(env, 'brand:logo_icon');
});

router.get('/brand/pwa_192.png', async (req, env) => {
  return serveBrandingFile(env, 'brand:pwa_192');
});

router.get('/brand/pwa_512.png', async (req, env) => {
  return serveBrandingFile(env, 'brand:pwa_512');
});

router.get('/brand/favicon.png', async (req, env) => {
  return serveBrandingFile(env, 'brand:favicon');
});

router.get('/brand/theme.css', async (req, env) => {
  try {
    const row = await env.DB.prepare('SELECT * FROM brand_profiles WHERE project_id IS NULL').first();
    if (!row) return new Response(':root { --brand: #1d4ed8; }', { headers: { 'Content-Type': 'text/css' } });
    const css = `:root { --brand: ${row.colour_primary || '#1d4ed8'}; --brand-secondary: ${row.colour_secondary || ''}; --brand-accent: ${row.colour_accent || ''}; }`;
    return new Response(css, { headers: { 'Content-Type': 'text/css' } });
  } catch (e) {
    return new Response(':root { --brand: #1d4ed8; }', { headers: { 'Content-Type': 'text/css' } });
  }
});

async function serveBrandingFile(env, seriesKey) {
  try {
    const row = await env.DB.prepare(`
      SELECT d.*, fb.data, fb.mime FROM documents d
      JOIN file_blobs fb ON fb.id = d.blob_id
      WHERE d.series_key = ? AND d.is_latest = 1 AND d.deleted_at IS NULL
      ORDER BY d.version DESC LIMIT 1
    `).bind(seriesKey).first();
    if (!row || !row.data) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(row.data, {
      headers: {
        'Content-Type': row.mime || 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}

// ---------- Dashboard routes ----------
router.get('/api/dashboard', async (req, env) => {
  return withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      let projectFilter = '';
      const params = [];
      if (user.role !== 'owner' && ids.length > 0) {
        projectFilter = 'AND project_id IN (' + ids.map(() => '?').join(',') + ')';
        params.push(...ids);
      }

      // Money in - collected this month
      const collected = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount_paise + tds_paise), 0) as total FROM sal_receipts WHERE deleted_at IS NULL ${projectFilter} AND strftime('%Y-%m', received_on) = strftime('%Y-%m', 'now')`
      ).bind(...params).first();

      // Overdue receivables
      const overdue = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount_paise - settled_paise), 0) as total, COUNT(*) as cnt FROM sal_demands WHERE deleted_at IS NULL ${projectFilter} AND status != 'paid' AND status != 'cancelled' AND due_date < date('now')`
      ).bind(...params).first();

      // Bills due ≤7 days
      const billsDue = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount_paise), 0) as total, COUNT(*) as cnt FROM pro_bills WHERE deleted_at IS NULL ${projectFilter} AND status != 'paid' AND status != 'cancelled' AND due_date <= date('now', '+7 days')`
      ).bind(...params).first();

      // POs pending approval
      const posPending = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM pro_pos WHERE deleted_at IS NULL ${projectFilter} AND status = 'pending_approval'`
      ).bind(...params).first();

      // Site reports yesterday
      const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
      const dprsYesterday = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM site_dprs WHERE deleted_at IS NULL ${projectFilter} AND report_date = ?`
      ).bind(...params, yesterday).first();

      // Open high snags
      const highSnags = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM site_snags WHERE deleted_at IS NULL ${projectFilter} AND severity = 'high' AND status != 'verified'`
      ).bind(...params).first();

      // New leads this week
      const newLeads = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sal_leads WHERE deleted_at IS NULL ${projectFilter} AND status = 'new' AND date(created_at) >= date('now', '-7 days')`
      ).bind(...params).first();

      return json({
        ok: true,
        data: {
          moneyIn: Number(collected?.total || 0),
          overdueReceivables: { total: Number(overdue?.total || 0), cnt: Number(overdue?.cnt || 0) },
          billsDue: { total: Number(billsDue?.total || 0), cnt: Number(billsDue?.cnt || 0) },
          posPending: Number(posPending?.cnt || 0),
          dprsYesterday: Number(dprsYesterday?.cnt || 0),
          highSnags: Number(highSnags?.cnt || 0),
          newLeads: Number(newLeads?.cnt || 0),
        },
      });
    } catch (e) {
      return json({ ok: false, error: 'dashboard: ' + e.message }, 500);
    }
  });
});

// ---------- Reports routes ----------
router.get('/api/reports/receivables', async (req, env) => {
  return withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      let pf = '';
      const p = [];
      if (user.role !== 'owner' && ids.length > 0) {
        pf = 'AND project_id IN (' + ids.map(() => '?').join(',') + ')';
        p.push(...ids);
      }
      const rows = await env.DB.prepare(
        `SELECT b.customer_name, b.agreed_price_paise, COALESCE(SUM(r.amount_paise + r.tds_paise), 0) as collected,
         (b.agreed_price_paise - COALESCE(SUM(r.amount_paise + r.tds_paise), 0)) as balance,
         b.status
         FROM sal_bookings b
         LEFT JOIN sal_receipts r ON r.booking_id = b.id AND r.deleted_at IS NULL
         WHERE b.deleted_at IS NULL ${pf}
         GROUP BY b.id ORDER BY b.created_at DESC LIMIT 200`
      ).bind(...p).all();
      return json({ ok: true, data: { rows: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'receivables: ' + e.message }, 500);
    }
  });
});

router.get('/api/reports/purchase-register', async (req, env) => {
  return withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare(
        `SELECT p.po_no, v.name as vendor, p.amount_paise, p.total_paise, p.status, p.created_at
         FROM pro_pos p
         JOIN pro_vendors v ON v.id = p.vendor_id
         WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 200`
      ).all();
      return json({ ok: true, data: { rows: rows.results } });
    } catch (e) {
      return json({ ok: false, error: 'purchase: ' + e.message }, 500);
    }
  });
});

// ---------- Google Drive storage routes (§3.4) ----------
router.post('/api/storage/google/start', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const user = req.user;
      if (user.role !== 'owner') {
        return json({ ok: false, error: 'Only the Owner can connect Google Drive.' }, 403);
      }
      const redirectUri = `${new URL(req.url).origin}/api/storage/google/callback`;
      const { authUrl, state, verifier, expiresAt, stateHash } = await gdrive.makeOAuthStartAsync(env, redirectUri, user.user_id);

      // Store state in oauth_states (single-use, CSRF + PKCE protection)
      const verifierEnc = await encryptSetting(env, verifier);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare(
        'INSERT INTO oauth_states (state_hash, user_id, verifier_enc, purpose, expires_at, created_at) VALUES (?, ?, ?, \'gdrive\', ?, ?)'
      ).bind(stateHash, user.user_id, verifierEnc, expiresAt, now).run();

      return json({ ok: true, data: { authUrl } });
    } catch (e) {
      return json({ ok: false, error: 'gdrive-start: ' + e.message }, 500);
    }
  });
});

router.get('/api/storage/google/callback', async (req, env) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response('Google Drive sign-in was cancelled.', { status: 400, headers: { 'Content-Type': 'text/html' } });
    }
    if (!code || !state) {
      return new Response('Missing sign-in parameters.', { status: 400, headers: { 'Content-Type': 'text/html' } });
    }

    const stateHash = base64urlEncode(await sha256Bytes(new TextEncoder().encode(state)));
    const row = await env.DB.prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND purpose = \'gdrive\' AND used_at IS NULL AND expires_at > datetime(\'now\')').bind(stateHash).first();
    if (!row) {
      return new Response('This sign-in link is no longer valid.', { status: 410, headers: { 'Content-Type': 'text/html' } });
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(row.user_id).first();
    if (!user || user.role !== 'owner') {
      return new Response('Only the Owner can connect Google Drive.', { status: 403, headers: { 'Content-Type': 'text/html' } });
    }

    const verifier = await decryptSetting(env, row.verifier_enc);
    const redirectUri = `${new URL(req.url).origin}/api/storage/google/callback`;

    const tokens = await gdrive.exchangeCode(env, code, verifier, redirectUri);

    // Get user info from Drive about
    let accountEmail = '';
    try {
      const about = await gdrive.getDriveAbout(env, tokens.access_token);
      accountEmail = about.emailAddress || '';
    } catch (e) {}

    // Encrypt and store tokens
    const refreshTokenEnc = tokens.refresh_token ? await encryptSetting(env, tokens.refresh_token) : null;
    const accessTokenEnc = await encryptSetting(env, tokens.access_token);
    const accessExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Create NirmaanCRM root folder in Drive
    let rootFolderId = '';
    try {
      const existing = await gdrive.findDriveFolder(env, tokens.access_token, 'NirmaanCRM', null);
      if (existing.files && existing.files.length > 0) {
        rootFolderId = existing.files[0].id;
      } else {
        const created = await gdrive.createDriveFolder(env, tokens.access_token, 'NirmaanCRM', null);
        rootFolderId = created.id;
      }
    } catch (e) {}

    // Mark state as used
    await env.DB.prepare('UPDATE oauth_states SET used_at = ? WHERE id = ?').bind(now, row.id).run();

    // Save settings
    await setSettingRaw(env, 'storage.gdrive.status', 'connected', user.user_id);
    if (refreshTokenEnc) await setSettingRaw(env, 'storage.gdrive.refresh_token_enc', refreshTokenEnc, user.user_id);
    await setSettingRaw(env, 'storage.gdrive.access_token_enc', accessTokenEnc, user.user_id);
    await setSettingRaw(env, 'storage.gdrive.access_expires_at', accessExpiresAt, user.user_id);
    if (accountEmail) await setSettingRaw(env, 'storage.gdrive.account_email', accountEmail, user.user_id);
    if (rootFolderId) await setSettingRaw(env, 'storage.gdrive.root_folder_id', rootFolderId, user.user_id);
    await setSettingRaw(env, 'storage.gdrive.connected_at', now, user.user_id);
    await setSettingRaw(env, 'storage.driver', 'gdrive', user.user_id);

    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'storage', 0, 'Google Drive connected', ?)`).bind(user.id, now).run();

    return new Response(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h2>✅ Google Drive Connected</h2>
        <p>NirmaanCRM is now connected to <strong>${accountEmail || 'your Google account'}</strong>.</p>
        <p>You can close this window and return to the CRM.</p>
        <script>setTimeout(()=>window.close(),2000);</script>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  } catch (e) {
    return new Response('Sign-in failed: ' + e.message, { status: 500, headers: { 'Content-Type': 'text/html' } });
  }
});

router.post('/api/storage/google/disconnect', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const user = req.user;
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await setSettingRaw(env, 'storage.gdrive.status', 'not_connected', user.user_id);
      await setSettingRaw(env, 'storage.gdrive.refresh_token_enc', null, user.user_id);
      await setSettingRaw(env, 'storage.gdrive.access_token_enc', null, user.user_id);
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'storage', 0, 'Google Drive disconnected', ?)`).bind(user.user_id, now).run();
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'gdrive-disconnect: ' + e.message }, 500);
    }
  });
});

router.post('/api/storage/driver', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { driver } = body;
      if (!['gdrive', 'd1', 'r2'].includes(driver)) {
        return json({ ok: false, error: 'Invalid driver.' }, 400);
      }
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await setSettingRaw(env, 'storage.driver', driver, user.user_id);
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'storage-driver: ' + e.message }, 500);
    }
  });
});

router.get('/api/storage/status', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const driver = await getSettingRaw(env, 'storage.driver');
      const status = await getSettingRaw(env, 'storage.gdrive.status');
      const accountEmail = await getSettingRaw(env, 'storage.gdrive.account_email');
      const warnPercent = Number(await getSettingRaw(env, 'storage.warn_percent') || 80);

      let quota = null;
      if (status === 'connected') {
        const accessTokenEnc = await getSettingRaw(env, 'storage.gdrive.access_token_enc');
        const refreshTokenEnc = await getSettingRaw(env, 'storage.gdrive.refresh_token_enc');
        let accessToken = await decryptSetting(env, accessTokenEnc);

        try {
          const about = await gdrive.getDriveAbout(env, accessToken);
          const sq = about.storageQuota || {};
          const limit = Number(sq.limit || 0);
          const usage = Number(sq.usage || 0);
          quota = { limit, usage, percent: limit > 0 ? Math.round((usage / limit) * 100) : 0, accountEmail };
        } catch (e) {
          // Token may be expired — try refresh
          if (refreshTokenEnc) {
            try {
              const refreshed = await gdrive.refreshAccessToken(env, refreshTokenEnc);
              const newAccessEnc = await encryptSetting(env, refreshed.access_token);
              await setSettingRaw(env, 'storage.gdrive.access_token_enc', newAccessEnc, req.user.user_id);
              const about = await gdrive.getDriveAbout(env, refreshed.access_token);
              const sq = about.storageQuota || {};
              quota = { limit: Number(sq.limit || 0), usage: Number(sq.usage || 0), percent: 0, accountEmail };
              if (sq.limit) quota.percent = Math.round((Number(sq.usage) / Number(sq.limit)) * 100);
            } catch (e2) {
              await setSettingRaw(env, 'storage.gdrive.status', 'needs_reconnect', req.user.user_id);
            }
          }
        }
      }

      return json({
        ok: true,
        data: {
          driver,
          gdriveStatus: status,
          accountEmail,
          warnPercent,
          quota,
        },
      });
    } catch (e) {
      return json({ ok: false, error: 'storage-status: ' + e.message }, 500);
    }
  });
});

// ---------- Customer share link landing page ----------
router.get('/s/:token', async (req, env) => {
  return env.ASSETS.fetch(new Request(`${new URL(req.url).origin}/s.html`, req));
});

// ---------- Customer share link file download ----------
router.get('/s/:token/file', async (req, env) => {
  try {
    const tokenB64 = req.params.token;
    const tokenBytes = Uint8Array.from(atob(tokenB64), c => c.charCodeAt(0));
    const hash = await crypto.subtle.digest('SHA-256', tokenBytes);
    const hashB64 = bytesToBase64(new Uint8Array(hash));

    const link = await env.DB.prepare('SELECT * FROM share_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime(\'now\')').bind(hashB64).first();
    if (!link) {
      return new Response('Link expired or invalid.', { status: 410 });
    }

    if (link.max_views !== null && Number(link.view_count) >= Number(link.max_views)) {
      return new Response('Link view limit reached.', { status: 410 });
    }

    const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL AND audience = \'customer\'').bind(link.document_id).first();
    if (!doc) {
      return new Response('File not available.', { status: 410 });
    }

    await env.DB.prepare('UPDATE share_links SET view_count = view_count + 1, last_viewed_at = datetime(\'now\') WHERE id = ?').bind(link.id).run();

    if (doc.store === 'd1' || doc.store === null) {
      const blob = await env.DB.prepare('SELECT * FROM file_blobs WHERE id = ?').bind(doc.blob_id).first();
      if (!blob) return new Response('File data not found.', { status: 410 });
      return new Response(blob.data, {
        headers: {
          'Content-Type': doc.mime || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${doc.title}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response('File storage mode not yet implemented.', { status: 501 });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
});

// ---------- Storage helper functions ----------
async function getSettingRaw(env, key) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key = ?').bind(key).first();
  if (!row) return null;
  try { return JSON.parse(row.value_json); } catch (e) { return row.value_json; }
}

async function setSettingRaw(env, key, value, updatedBy) {
  const val = typeof value === 'string' ? value : JSON.stringify(value);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare(
    `INSERT INTO settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).bind(key, val, updatedBy, now).run();
}

async function encryptSetting(env, plaintext) {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(env.APP_KEY), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(new Uint8Array(iv), 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  return base64urlEncode(combined);
}

async function decryptSetting(env, ciphertextB64url) {
  if (!ciphertextB64url) return null;
  const combined = base64urlDecode(ciphertextB64url);
  const iv = combined.slice(0, 12);
  const enc = combined.slice(12);
  const key = await crypto.subtle.importKey('raw', base64ToBytes(env.APP_KEY), { name: 'AES-GCM' }, false, ['decrypt']);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
  return new TextDecoder().decode(dec);
}

function base64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

// ---------- Helper functions ----------
function bytesToBase64(bytes) {
  let bin = '';
  for (let b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function verifyPassword(password, salt, hash) {
  const computed = await hashPassword(password, salt);
  return computed === hash;
}

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function makeSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function roleLabel(role) {
  const labels = { owner: 'Owner', pm: 'Project Manager', site: 'Site Engineer', sales: 'Sales', accounts: 'Accounts', purchase: 'Purchase', hr: 'HR / Admin', viewer: 'Viewer (CA/Auditor)' };
  return labels[role] || role;
}

function safeUser(u) {
  return {
    id: u.user_id, name: u.name, email: u.email, phone: u.phone, role: u.role,
    lang: u.lang, active: !!u.active, extra_roles: u.extra_roles,
    must_change_password: !!u.must_change_password,
    is_primary_owner: !!u.is_primary_owner,
  };
}

function makeId(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function visibleProjectIds(env, user) {
  if (!user) return [];
  if (user.role === 'owner') {
    const rows = await env.DB.prepare('SELECT id FROM projects WHERE deleted_at IS NULL').all();
    return rows.results.map((r) => r.id);
  }
  const rows = await env.DB.prepare(`SELECT pm.project_id FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = ? AND pm.removed_at IS NULL AND p.deleted_at IS NULL`).bind(user.user_id).all();
  return rows.results.map((r) => r.project_id);
}

// ---------- Cron handler (§7.8 note 6) ----------
export async function scheduled(event, env, ctx) {
  if (env.ENVIRONMENT === 'staging') return; // staging guard
  const cron = event.cron;

  ctx.waitUntil(runCron(cron, env));
}

async function runCron(cron, env) {
  const now = new Date();
  // 30 2 * * * = 08:00 IST digest
  // 30 13 * * * = 19:00 IST DPR nudge
  // 30 * * * * = hourly reminder sweep + email retry
  // 30 20 * * * = 02:00 IST nightly backup

  if (cron === '30 * * * *') {
    // Hourly: retry failed emails + DPR nudge + reminders
    await retryFailedEmails(env);
  } else if (cron === '30 2 * * *') {
    // 08:00 IST digest — send to owners
    const owners = await env.DB.prepare("SELECT email FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL").all();
    for (const o of owners.results) {
      try { await sendDigest(env, o.email); } catch (e) {}
    }
  }
}

// ---------- Main fetch handler ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/health') {
        return json({ ok: true, env: env.ENVIRONMENT || 'production' });
      }
      await ensureBootstrap(env);
      if (path.startsWith('/api/')) {
        return router.handle(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ ok: false, error: err.message || 'Internal error' }, 500);
    }
  },
};
