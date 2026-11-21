// src/index.js — NirmaanCRM Worker entry point

import { Router } from './core/router.js';
import {
  getCurrentUser, loginPassword, logout, ensureBootstrapOwner,
  setSessionCookie, clearSessionCookie, createOtpCode, verifyOtpCode, createSession, checkRateLimit,
} from './core/auth.js';
import { userCan, visibleProjectIds } from './core/permissions.js';
import { getSetting, setSetting, appKeyBytes } from './core/settings.js';
import { query } from './core/db.js';
import { sendMail, retryFailedEmails, sendDigest, notifyMissingDprs, getEmailConfig, esc as escHtml } from './core/mail.js';
import * as gdrive from './core/gdrive.js';
import { registerSalesOps, expireHolds, LEAD_TRANSITIONS } from './routes/sales_ops.js';
import { registerReports } from './routes/reports.js';
import { registerFinance } from './routes/finance.js';
import { registerMfa, mfaChallenge } from './routes/mfa.js';
import { registerImporter } from './routes/importer.js';
import { registerPrivacy } from './routes/privacy.js';

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

// Roles that must use two-step sign-in (Owner sets this under More → Security). Cached for a minute per isolate.
let mfaRolesCache = { at: 0, roles: [] };
async function mfaRequiredRoles(env) {
  if (Date.now() - mfaRolesCache.at < 60000) return mfaRolesCache.roles;
  const v = await getSetting(env, 'security.require_mfa_roles');
  mfaRolesCache = { at: Date.now(), roles: Array.isArray(v) ? v : [] };
  return mfaRolesCache.roles;
}

// Returns an error Response when the user may not proceed, else null.
function authFailure(user, allowMustChange = false, mfaRoles = []) {
  if (!user) return json({ ok: false, error: 'Please log in.' }, 401);
  if (!user.active || user.deactivated_at) return json({ ok: false, error: 'Account deactivated.' }, 403);
  if (user.must_change_password && !allowMustChange) {
    return json({ ok: false, error: 'Please choose your own password first.', code: 'must_change_password' }, 403);
  }
  if (!allowMustChange && mfaRoles.includes(user.role) && !user.mfa_enabled_at) {
    return json({ ok: false, error: 'Set up two-step sign-in first (More → Security).', code: 'mfa_enroll' }, 403);
  }
  return null;
}

async function withAuth(req, env, module, action, handler, requireHeader = true) {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  const fail = authFailure(user, false, user ? await mfaRequiredRoles(env) : []);
  if (fail) return fail;
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !/multipart\/form-data/i.test(req.headers.get('content-type') || '') && Number(req.headers.get('content-length') || 0) > 1048576) {
    return json({ ok: false, error: 'That request is too large.' }, 413);
  }
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
  // The project picker: GET ?project_id=N narrows every project-scoped list to that project (permissions.visibleProjectIds).
  if (req.method === 'GET') {
    const pid = Number(new URL(req.url).searchParams.get('project_id'));
    if (pid > 0) user.scopeProject = pid;
  }
  return handler(req, env);
}

// ---------- Health (public) ----------
router.get('/api/health', async (req, env) => {
  return json({ ok: true, env: env.ENVIRONMENT || 'production' });
});

// Never send database or stack text to the browser. The detail goes to the log (wrangler tail) with a short reference.
function serverError(e, label) {
  const ref = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  console.error(`[${label}] ref=${ref}`, e && e.stack ? e.stack : e);
  return json({ ok: false, error: `Something went wrong (ref ${ref}). Please try again. If it keeps happening, tell the Owner this reference.` }, 500);
}

const clientIp = (req) => req.headers.get('cf-connecting-ip') || 'unknown';

// The one public address of this CRM (https://crm.example.com). Falls back to the request origin only when EXTERNAL_URL is unset (local dev).
function publicBase(env, req) {
  return String(env.EXTERNAL_URL || new URL(req.url).origin).replace(/\/+$/, '');
}

// ---------- Auth routes ----------
router.post('/api/auth/login', async (req, env) => {
  try {
    await ensureBootstrap(env);
  } catch (e) {
    return serverError(e, 'bootstrap');
  }
  const ipRl = await checkRateLimit(env, `login-ip:${clientIp(req)}`, 40, 15);
  if (!ipRl.allowed) return json({ ok: false, error: 'Too many sign-in attempts from this network. Try again in 15 minutes.' }, 429);
  const { email, password } = await req.json();
  if (!email || !password) {
    return json({ ok: false, error: 'Please enter email and password.' }, 400);
  }
  try {
    const { user, session, early } = await loginPassword(env, email, password, req.headers.get('user-agent') || '', { beforeSession: (u) => mfaChallenge(env, u.id) });
    if (early) return json({ ok: true, data: { mfa_required: true, mfa_token: early } });
    const res = json({ ok: true, data: { user: safeUser(user), must_change_password: !!user.must_change_password } });
    setSessionCookie(res, session.token, session.expiresAt);
    return res;
  } catch (e) {
    return json({ ok: false, error: e.message }, /Too many/.test(e.message) ? 429 : 401);
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
  const mfaRoles = await mfaRequiredRoles(env);
  return json({ ok: true, data: { user: safeUser(user), must_change_password: !!user.must_change_password, mfa_enrolled: !!user.mfa_enabled_at, mfa_enroll_required: mfaRoles.includes(user.role) && !user.mfa_enabled_at } });
});

router.post('/api/auth/change-password', async (req, env) => {
  const user = await getCurrentUser(env, req.headers.get('cookie'));
  if (!user) return json({ ok: false, error: 'Please log in.' }, 401);
  if (req.headers.get('X-NirmaanCRM') !== '1') return json({ ok: false, error: 'Invalid request.' }, 403);
  if (!user.active || user.deactivated_at) return json({ ok: false, error: 'Account deactivated.' }, 403);
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
      return serverError(e, 'list');
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
      const wantBrand = req.user.role === 'owner' ? (Number(body.brand_id) || null) : null; // only the Owner picks a brand
      const newBrand = wantBrand && (await env.DB.prepare('SELECT id FROM brands WHERE id = ? AND deleted_at IS NULL').bind(wantBrand).first()) ? wantBrand : await defaultBrandId(env);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`
        INSERT INTO projects (name, code, address, ward, city, type, status, rera_no, rera_expiry, start_date, target_date, budget_paise, notes, brand_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(name, code, address || '', ward || '', city || 'Mumbai', type || 'new_build', status || 'planning', rera_no || '', rera_expiry || '', start_date || '', target_date || '', budget_paise || 0, notes || '', newBrand, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'projects', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created project "${name}" (${code})`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'create');
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
    const n = (v) => (v === undefined ? null : v);
    let pct = null;
    if (body.percent_complete !== undefined) { pct = Math.round(Number(body.percent_complete)); if (!(pct >= 0 && pct <= 100)) return json({ ok: false, error: 'Completion must be between 0 and 100.' }, 400); }
    if (body.status === 'archived') return json({ ok: false, error: 'Use Archive on the Projects screen (Owner only).' }, 400);
    if (body.brand_id && user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can change a project\'s brand.' }, 403);
    let brandId = null;
    if (body.brand_id) {
      if (!(await env.DB.prepare('SELECT id FROM brands WHERE id = ? AND deleted_at IS NULL').bind(Number(body.brand_id)).first())) return json({ ok: false, error: 'Unknown brand.' }, 400);
      brandId = Number(body.brand_id);
    }
    await env.DB.prepare(`UPDATE projects SET name = COALESCE(?, name), code = COALESCE(?, code), address = COALESCE(?, address), ward = COALESCE(?, ward), city = COALESCE(?, city), type = COALESCE(?, type), status = COALESCE(?, status), rera_no = COALESCE(?, rera_no), rera_expiry = COALESCE(?, rera_expiry), start_date = COALESCE(?, start_date), target_date = COALESCE(?, target_date), budget_paise = COALESCE(?, budget_paise), notes = COALESCE(?, notes), brand_id = COALESCE(?, brand_id), percent_complete = COALESCE(?, percent_complete) WHERE id = ? AND deleted_at IS NULL`).bind(n(body.name), n(body.code), n(body.address), n(body.ward), n(body.city), n(body.type), n(body.status), n(body.rera_no), n(body.rera_expiry), n(body.start_date), n(body.target_date), n(body.budget_paise), n(body.notes), brandId, pct, id).run();
    if (pct !== null) await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'progress', 'projects', ?, ?, ?)`).bind(user.user_id, id, `Certified completion set to ${pct}%`, now).run();
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
      if ((await getSetting(env, 'access.allow_second_owner')) !== 'on') {
        return json({ ok: false, error: 'Second Owner is not enabled.' }, 403);
      }
    }
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').bind(email).first();
    if (existing) {
      return json({ ok: false, error: 'A user with this email already exists.' }, 400);
    }
    const tempPassword = makeTempPassword();
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

// ---------- User management (§4.6 safeguards) ----------
function makeTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function activeOwnerCount(env, excludeId) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL AND id != ?").bind(excludeId || 0).first();
  return Number(r.n);
}

async function loadTarget(env, req) {
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
  if (!target) return { err: json({ ok: false, error: 'User not found.' }, 404) };
  const me = req.user;
  if (target.id === me.user_id) return { err: json({ ok: false, error: 'You cannot change your own role or status. Ask another Owner.' }, 400) };
  if (target.is_primary_owner) return { err: json({ ok: false, error: 'The primary Owner cannot be changed.' }, 403) };
  if (target.role === 'owner' && !me.is_primary_owner) return { err: json({ ok: false, error: 'Only the primary Owner can change another Owner.' }, 403) };
  return { target };
}

const nowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

router.put('/api/users/:id', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const { target, err } = await loadTarget(env, req);
    if (err) return err;
    const body = await req.json();
    const fields = [];
    const vals = [];
    if (body.name) { fields.push('name = ?'); vals.push(String(body.name)); }
    if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(String(body.phone)); }
    if (body.lang) { fields.push('lang = ?'); vals.push(String(body.lang)); }
    if (body.extra_roles !== undefined) {
      const extras = Array.isArray(body.extra_roles) ? body.extra_roles.filter((r) => r !== 'owner') : [];
      fields.push('extra_roles = ?'); vals.push(extras.length ? JSON.stringify(extras) : null);
    }
    if (body.role && body.role !== target.role) {
      if (!['owner', 'pm', 'site', 'sales', 'accounts', 'purchase', 'hr', 'viewer'].includes(body.role)) return json({ ok: false, error: 'Unknown role.' }, 400);
      if (body.role === 'owner') {
        if ((await getSetting(env, 'access.allow_second_owner')) !== 'on') return json({ ok: false, error: 'Second Owner is not enabled.' }, 403);
      }
      fields.push('role = ?'); vals.push(body.role);
    }
    if (fields.length) {
      await env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    }
    if (Array.isArray(body.projects)) {
      const pids = body.projects.map(Number).filter(Boolean);
      const cur = await env.DB.prepare('SELECT project_id FROM project_members WHERE user_id = ? AND removed_at IS NULL').bind(target.id).all();
      const have = cur.results.map((r) => r.project_id);
      const now = nowStr();
      for (const pid of pids.filter((x) => !have.includes(x))) {
        await env.DB.prepare('INSERT INTO project_members (project_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)').bind(pid, target.id, req.user.user_id, now).run();
      }
      for (const pid of have.filter((x) => !pids.includes(x))) {
        await env.DB.prepare('UPDATE project_members SET removed_at = ? WHERE project_id = ? AND user_id = ? AND removed_at IS NULL').bind(now, pid, target.id).run();
      }
    }
    if (body.role && body.role !== target.role) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'update', 'users', ?, ?, ?)`).bind(req.user.user_id, target.id, `Updated ${target.name}`, nowStr()).run();
    return json({ ok: true });
  });
});

router.get('/api/users/:id/projects', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    const rows = await env.DB.prepare('SELECT project_id FROM project_members WHERE user_id = ? AND removed_at IS NULL').bind(Number(req.params.id)).all();
    return json({ ok: true, data: { projects: rows.results.map((r) => r.project_id) } });
  });
});

router.post('/api/users/:id/deactivate', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const { target, err } = await loadTarget(env, req);
    if (err) return err;
    if (target.role === 'owner' && (await activeOwnerCount(env, target.id)) < 1) return json({ ok: false, error: 'There must always be one active Owner.' }, 400);
    const now = nowStr();
    await env.DB.prepare('UPDATE users SET active = 0, deactivated_at = ? WHERE id = ?').bind(now, target.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'deactivate', 'users', ?, ?, ?)`).bind(req.user.user_id, target.id, `Deactivated ${target.name}`, now).run();
    return json({ ok: true });
  });
});

router.post('/api/users/:id/reactivate', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const { target, err } = await loadTarget(env, req);
    if (err) return err;
    await env.DB.prepare('UPDATE users SET active = 1, deactivated_at = NULL WHERE id = ?').bind(target.id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'reactivate', 'users', ?, ?, ?)`).bind(req.user.user_id, target.id, `Reactivated ${target.name}`, nowStr()).run();
    return json({ ok: true });
  });
});

router.post('/api/users/:id/reset-password', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const { target, err } = await loadTarget(env, req);
    if (err) return err;
    const temp = makeTempPassword();
    const salt = makeSalt();
    const hash = await hashPassword(temp, salt);
    await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?').bind(hash, bytesToBase64(salt), target.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'reset_password', 'users', ?, ?, ?)`).bind(req.user.user_id, target.id, `Reset password for ${target.name}`, nowStr()).run();
    return json({ ok: true, data: { temporaryPassword: temp } });
  });
});

router.post('/api/users/:id/logout', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const id = Number(req.params.id);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    return json({ ok: true });
  });
});

router.post('/api/auth/logout-everyone', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id != ?').bind(req.user.user_id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'logout_all', 'users', 0, 'Logged everyone out', ?)`).bind(req.user.user_id, nowStr()).run();
    return json({ ok: true });
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
      let sql = "SELECT * FROM documents WHERE deleted_at IS NULL AND (series_key IS NULL OR series_key NOT LIKE 'brand:%') AND COALESCE(module, '') != 'brochure'";
      const params = [];
      if (projectId) {
        if (!ids.includes(Number(projectId))) {
          return json({ ok: false, error: 'Not allowed.' }, 403);
        }
        sql += ' AND project_id = ?';
        params.push(projectId);
      } else {
        const orphans = ['owner', 'pm'].includes(user.role) ? ' OR project_id IS NULL' : '';
        if (ids.length === 0 && !orphans) return json({ ok: true, data: { documents: [] } });
        sql += ` AND (${ids.length ? 'project_id IN (' + ids.map(() => '?').join(',') + ')' : '0'}${orphans})`;
        params.push(...ids);
      }
      if (!canSeeRestricted(user)) sql += " AND COALESCE(category, '') NOT IN ('kyc', 'legal', 'agreement')";
      sql += ' ORDER BY created_at DESC';
      const rows = await query(env.DB, sql, params);
      return json({ ok: true, data: { documents: rows.results } });
    } catch (e) {
      return serverError(e, 'docs');
    }
  });
});

// Link-type documents only. Files go through /api/files/upload so a client can never point a record at someone else's blob or Drive file.
router.post('/api/documents', async (req, env) => {
  return withAuth(req, env, 'projects', 'C', async (req, env) => {
    try {
      const user = req.user;
      const { project_id, title, category, external_url, audience } = await req.json();
      if (!title) return json({ ok: false, error: 'Title is required.' }, 400);
      if (!/^https:\/\/[^\s]+$/i.test(String(external_url || ''))) return json({ ok: false, error: 'A link must start with https://' }, 400);
      if (project_id && !(await visibleProjectIds(env, user)).includes(Number(project_id))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const now = nowStr();
      const result = await env.DB.prepare(`INSERT INTO documents (project_id, title, category, kind, external_url, audience, version, is_latest, uploaded_by, created_at) VALUES (?, ?, ?, 'link', ?, ?, 1, 1, ?, ?)`)
        .bind(project_id || null, String(title), category || 'other', external_url, audience === 'customer' ? 'customer' : 'internal', user.user_id, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'create', 'documents', ?, ?, ?)`).bind(user.user_id, result.meta.last_row_id, `Added link "${title}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'doc-create');
    }
  });
});

router.get('/api/documents/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').bind(id).first();
      if (!row) return json({ ok: false, error: 'Document not found.' }, 404);
      if (row.project_id && !(await visibleProjectIds(env, req.user)).includes(row.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (!docVisible(req.user, row)) return json({ ok: false, error: 'Not allowed.' }, 403);
      return json({ ok: true, data: row });
    } catch (e) {
      return serverError(e, 'doc-get');
    }
  });
});

router.delete('/api/documents/:id', async (req, env) => {
  return withAuth(req, env, 'projects', 'X', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const dd = await env.DB.prepare('SELECT project_id FROM documents WHERE id = ?').bind(id).first();
      if (!dd) return json({ ok: false, error: 'Document not found.' }, 404);
      if (dd.project_id && !(await visibleProjectIds(env, req.user)).includes(dd.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      await env.DB.prepare(`UPDATE documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(now, id).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'documents', ?, ?, ?)`).bind(req.user.user_id, 'delete', id, `Deleted document ${id}`, now).run();
      return json({ ok: true, data: { id } });
    } catch (e) {
      return serverError(e, 'doc-delete');
    }
  });
});

// ---------- Settings routes ----------
router.get('/api/settings', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT key FROM settings').all();
      const settings = {};
      for (const r of rows.results) {
        if (/password|secret|token|api_key|refresh|oauth/i.test(r.key)) { settings[r.key] = '[hidden]'; continue; }
        try { settings[r.key] = await getSetting(env, r.key); } catch (e) { settings[r.key] = '[unreadable]'; }
      }
      return json({ ok: true, data: { settings } });
    } catch (e) {
      return serverError(e, 'settings');
    }
  });
});

const EDITABLE_SETTINGS = ['po.pm_approval_limit_paise', 'access.allow_second_owner', 'access.limit_roles_to_assigned_projects', 'sales.share_all_leads',
  'demand.due_days_after_milestone', 'share.default_expiry_days', 'share.default_max_views', 'files.brochure_max_mb', 'branding.apply_colours_to_app',
  'brochure.price_list_default_audience', 'storage.warn_percent', 'sales.max_holds_per_user', 'sales.max_discount_bp', 'sales.pm_max_discount_bp',
  'interest.rate_bp', 'interest.grace_days', 'interest.enabled', 'security.require_mfa_roles', 'tax.stamp_duty_bp', 'tax.metro_cess_bp', 'tax.women_concession_bp', 'tax.registration_bp', 'tax.registration_cap_paise', 'tax.gst_bp'];

router.post('/api/settings/:key', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const key = req.params.key;
      if (!EDITABLE_SETTINGS.includes(key)) return json({ ok: false, error: 'That setting cannot be changed here.' }, 400);
      const { value } = await req.json();
      await setSetting(env, key, value, req.user.user_id);
      if (key === 'security.require_mfa_roles') mfaRolesCache.at = 0;
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'update', 'settings', 0, ?, ?)`).bind(req.user.user_id, `Changed setting ${key}`, nowStr()).run();
      return json({ ok: true, data: { key, value } });
    } catch (e) {
      return serverError(e, 'settings-set');
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
      return serverError(e, 'notif');
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
      return serverError(e, 'notif-read');
    }
  });
});

// ---------- Audit routes ----------
router.get('/api/audit', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const u = new URL(req.url);
      const where = []; const params = [];
      for (const [k, col] of [['action', 'al.action'], ['entity', 'al.entity']]) { const v = u.searchParams.get(k); if (v) { where.push(`${col} = ?`); params.push(v); } }
      if (u.searchParams.get('user_id')) { where.push('al.user_id = ?'); params.push(Number(u.searchParams.get('user_id'))); }
      if (u.searchParams.get('entity_id')) { where.push('al.entity_id = ?'); params.push(Number(u.searchParams.get('entity_id'))); }
      if (u.searchParams.get('q')) { where.push('al.summary LIKE ?'); params.push('%' + u.searchParams.get('q').replace(/[%_]/g, '') + '%'); }
      if (u.searchParams.get('before_id')) { where.push('al.id < ?'); params.push(Number(u.searchParams.get('before_id'))); }
      const limit = Math.min(Math.max(Number(u.searchParams.get('limit')) || 100, 1), 200);
      const rows = await env.DB.prepare(`SELECT al.*, u.name, u.email FROM audit_log al LEFT JOIN users u ON u.id = al.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY al.id DESC LIMIT ${limit}`).bind(...params).all();
      return json({ ok: true, data: { audit: rows.results } });
    } catch (e) {
      return serverError(e, 'audit');
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
      return serverError(e, 'apr-list');
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
      const result = await env.DB.prepare(`INSERT INTO apr_items (project_id, name, authority, category, stage_order, status, applied_on, approved_on, valid_till, reminder_days, renew_months, owner_user_id, consultant, fee_paise, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, name, authority || '', category || 'approval', stage_order || 100, status || 'not_started', applied_on || null, approved_on || null, valid_till || null, reminder_days || 30, renew_months || null, owner_user_id || null, consultant || '', fee_paise || 0, notes || '', now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'apr_items', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created approval "${name}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'apr-create');
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
      return serverError(e, 'apr-get');
    }
  });
});

router.post('/api/approvals/:id/event', async (req, env) => {
  return withAuth(req, env, 'approvals', 'E', async (req, env) => {
    try {
      const user = req.user;
      const id = Number(req.params.id);
      const body = await req.json();
      const { event, note, applied_on, approved_on } = body;
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
        vals.push(id);
        await query(env.DB, `UPDATE apr_items SET ${updates.join(', ')} WHERE id = ?`, vals);
      }
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'apr_items', ?, ?, ?)`).bind(user.user_id, 'event', id, `Approval event: ${event}`, now).run();
      return json({ ok: true });
    } catch (e) {
      return serverError(e, 'apr-event');
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
      const sql = `SELECT d.*, (SELECT rev_no FROM drw_revisions WHERE drawing_id = d.id AND status = 'ifc' LIMIT 1) AS current_ifc_rev FROM drw_drawings d WHERE d.deleted_at IS NULL AND d.project_id IN (${ids.map(() => '?').join(',')})${user.role === 'site' ? " AND EXISTS (SELECT 1 FROM drw_revisions r WHERE r.drawing_id = d.id AND r.status = 'ifc')" : ''} ORDER BY d.discipline, d.code`;
      const rows = await query(env.DB, sql, ids);
      return json({ ok: true, data: { drawings: rows.results } });
    } catch (e) {
      return serverError(e, 'drw-list');
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
      return serverError(e, 'drw-create');
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
      // Site role sees ONLY the current IFC revision (enforced here, not just in the UI)
      const rows = req.user.role === 'site'
        ? await env.DB.prepare("SELECT * FROM drw_revisions WHERE drawing_id = ? AND status = 'ifc'").bind(drawingId).all()
        : await env.DB.prepare('SELECT * FROM drw_revisions WHERE drawing_id = ? ORDER BY id DESC').bind(drawingId).all();
      return json({ ok: true, data: { revisions: rows.results } });
    } catch (e) {
      return serverError(e, 'drw-rev');
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
      return serverError(e, 'ms-list');
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
      // milestone.done subscriber: matching demands scheduled -> ready (due = done + N days)
      let readied = 0;
      if (ms.milestone_key) {
        const dueDays = Number(await getSetting(env, 'demand.due_days_after_milestone')) || 7;
        const r = await env.DB.prepare(`UPDATE sal_demands SET status = 'ready', due_date = date(?, '+' || ? || ' days')
          WHERE status = 'scheduled' AND stage_id IN (SELECT id FROM sal_plan_stages WHERE project_id = ? AND milestone_key = ?)
          AND booking_id IN (SELECT b.id FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.project_id = ? AND b.status <> 'cancelled' AND (? IS NULL OR ? = '' OR i.wing = ?))`)
          .bind(String(doneDate).substring(0, 10), dueDays, ms.project_id, ms.milestone_key, ms.project_id, ms.wing || null, ms.wing || null, ms.wing || null).run();
        readied = r.meta.changes || 0;
      }
      return json({ ok: true, data: { id, actual_date: doneDate, demands_ready: readied } });
    } catch (e) {
      return serverError(e, 'ms-done');
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
      return serverError(e, 'dpr-list');
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
      if (client_uuid) {
        const dup = await env.DB.prepare('SELECT id FROM site_dprs WHERE client_uuid = ?').bind(client_uuid).first();
        if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      }
      const result = await env.DB.prepare(`INSERT INTO site_dprs (project_id, report_date, wing, work_summary, labour_count, weather, materials_used, issues, safety_incident, created_by, client_uuid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, report_date, wing || '', work_summary, labour_count || 0, weather || '', materials_used || '', issues || '', safety_incident || '', user.user_id, client_uuid || makeId(22), now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'site_dprs', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `DPR filed for ${report_date}`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'dpr-create');
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
      return serverError(e, 'snag-list');
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
      if (client_uuid) {
        const dup = await env.DB.prepare('SELECT id FROM site_snags WHERE client_uuid = ?').bind(client_uuid).first();
        if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
      }
      const result = await env.DB.prepare(`INSERT INTO site_snags (project_id, wing, location, title, severity, assigned_to, due_date, created_by, client_uuid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, wing || '', location || '', title, severity || 'medium', assigned_to || null, due_date || null, user.user_id, client_uuid || makeId(22), now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'site_snags', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Snag created: ${title}`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'snag-create');
    }
  });
});

// ---------- Procurement routes ----------
router.get('/api/procurement/vendors', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT * FROM pro_vendors WHERE deleted_at IS NULL ORDER BY name').all();
      // PAN is stored encrypted; the list only says whether one is on file (and its last 4 characters for accounts/owner).
      for (const v of rows.results) {
        const has = !!v.pan; let masked = '';
        if (has && ['owner', 'accounts'].includes(req.user.role)) { try { const p = v.pan.startsWith('enc:') ? await decryptSetting(env, v.pan.slice(4)) : v.pan; masked = '••••' + p.slice(-4); } catch (e) { masked = '••••'; } }
        v.has_pan = has; v.pan_masked = masked; delete v.pan;
      }
      return json({ ok: true, data: { vendors: rows.results } });
    } catch (e) {
      return serverError(e, 'vendors');
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
      if (body.pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(String(body.pan).trim())) return json({ ok: false, error: 'PAN looks wrong (format ABCDE1234F).' }, 400);
      const panEnc = body.pan ? 'enc:' + (await encryptSetting(env, String(body.pan).trim().toUpperCase())) : null;
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO pro_vendors (name, category, contact_person, phone, email, gstin, pan, address, rating, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(name, category || '', contact_person || '', phone || '', email || '', gstin || '', panEnc, address || '', rating || 0, notes || '', now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'pro_vendors', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created vendor "${name}"`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'vendor-create');
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
      return serverError(e, 'rfq-list');
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
      return serverError(e, 'rfq-create');
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
      return serverError(e, 'po-list');
    }
  });
});

router.post('/api/procurement/pos', async (req, env) => {
  return withAuth(req, env, 'procurement', 'C', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const { project_id, vendor_id, rfq_id, gst_bp, terms } = body;
      const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.description) : [];
      let amount_paise = Math.round(Number(body.amount_paise) || 0);
      if (items.length) amount_paise = items.reduce((t, i) => t + Math.round((Number(i.qty) || 0) * (Number(i.rate_paise) || 0)), 0);
      if (!project_id || !vendor_id || !(amount_paise > 0)) {
        return json({ ok: false, error: 'Project, vendor, and amount are required.' }, 400);
      }
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(project_id))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const gstBp = gst_bp !== undefined ? Number(gst_bp) : 1800;
      const gst_paise = Math.round(amount_paise * gstBp / 10000);
      const total_paise = amount_paise + gst_paise;
      const status = 'draft';
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      // Get next PO seq
      const counter = await env.DB.prepare('SELECT value FROM counters WHERE key = ?').bind(`po:${project_id}`).first();
      const nextSeq = (counter ? Number(counter.value) : 0) + 1;
      await env.DB.prepare('INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(`po:${project_id}`, nextSeq).run();
      const proj = await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(project_id).first();
      const poNo = `PO-${proj ? proj.code : project_id}-${String(nextSeq).padStart(4, '0')}`;
      const result = await env.DB.prepare(`INSERT INTO pro_pos (project_id, vendor_id, rfq_id, po_no, po_seq, amount_paise, gst_bp, gst_paise, total_paise, terms, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(project_id, vendor_id, rfq_id || null, poNo, nextSeq, amount_paise, gstBp, gst_paise, total_paise, terms || '', status, user.user_id, now).run();
      for (const it of items) {
        const qty = Number(it.qty) || 0; const rate = Math.round(Number(it.rate_paise) || 0);
        await env.DB.prepare('INSERT INTO pro_po_items (po_id, description, qty, unit, rate_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?)').bind(result.meta.last_row_id, String(it.description), qty, it.unit || '', rate, Math.round(qty * rate)).run();
      }
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'pro_pos', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created PO ${poNo}`, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id, po_no: poNo } });
    } catch (e) {
      return serverError(e, 'po-create');
    }
  });
});

// ---------- Sales CRM routes ----------
router.get('/api/sales/leads', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const user = req.user;
      const seeAll = user.role === 'owner' || user.role === 'pm' || (await getSetting(env, 'sales.share_all_leads')) === 'on';
      const scope = user.scopeProject ? ' AND project_id = ' + Number(user.scopeProject) : '';
      const rows = seeAll
        ? await env.DB.prepare(`SELECT * FROM sal_leads WHERE deleted_at IS NULL${scope} ORDER BY created_at DESC LIMIT 300`).all()
        : await env.DB.prepare(`SELECT * FROM sal_leads WHERE deleted_at IS NULL${scope} AND assigned_to = ? ORDER BY created_at DESC LIMIT 300`).bind(user.user_id).all();
      return json({ ok: true, data: { leads: rows.results } });
    } catch (e) {
      return serverError(e, 'lead-list');
    }
  });
});

router.get('/api/sales/inventory', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    try {
      const user = req.user;
      const projectId = new URL(req.url).searchParams.get('project_id');
      if (!projectId) return json({ ok: false, error: 'project_id required.' }, 400);
      const ids = await visibleProjectIds(env, user);
      if (!ids.includes(Number(projectId))) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const rows = await env.DB.prepare('SELECT * FROM sal_inventory WHERE project_id = ? AND deleted_at IS NULL ORDER BY wing, floor, unit_no').bind(projectId).all();
      return json({ ok: true, data: { inventory: rows.results } });
    } catch (e) {
      return serverError(e, 'inventory');
    }
  });
});

// ---------- Approvals: Mumbai template (Appendix A) ----------
const MUMBAI_TEMPLATE = [
  ['Property card / title search / search report', 'Advocate / Revenue', 'compliance', null, 0, 'Property card, 7/12 or CTS extract, title search report'],
  ['DP remark & zoning check (reservation, road line)', 'MCGM', 'approval', null, 0, 'DP remarks application receipt, zone certificate'],
  ['Architect & consultants appointed (LOA)', 'Internal', 'compliance', null, 0, 'Signed letters of appointment'],
  ['Site survey & layout plan', 'Licensed surveyor', 'compliance', null, 0, 'Survey plan, boundary demarcation'],
  ['Society consent & DA/development agreement registration', 'Society / Advocate', 'compliance', null, 1, 'Society resolution, registered DA'],
  ["Existing tenants' transit-rent & bank guarantee arrangements", 'Internal / Bank', 'compliance', 30, 1, 'Permanent alternate accommodation agreements, BG copies'],
  ['IOD application (BMC building-proposal system / AutoDCR — confirm current portal with your architect)', 'MCGM', 'approval', null, 0, 'AutoDCR submission receipt, approved plan, title documents'],
  ['Provisional Fire NOC', 'Chief Fire Officer, Mumbai Fire Brigade (MCGM)', 'noc', 30, 0, 'Fire layout drawings, application receipt'],
  ['Height NOC (AAI colour coding)', 'Airports Authority of India', 'noc', 30, 0, 'Colour-coded zoning map, NOCAS application'],
  ['Environment clearance / SEIAA (if built-up >= 20,000 sqm — confirm with your environment consultant)', 'SEIAA / MoEFCC', 'noc', 45, 0, 'EC application, consultant report'],
  ['Tree authority permission', 'MCGM Tree Authority', 'noc', 30, 0, 'Tree survey, application receipt'],
  ['Traffic NOC (if applicable)', 'Mumbai Traffic Police', 'noc', 30, 0, 'Site plan, access details'],
  ['CRZ / MCZMA clearance (if coastal plot)', 'MCZMA', 'noc', 45, 0, 'CRZ map, consultant report'],
  ['Collector / land-tenure permission (if applicable)', 'Collector', 'noc', 30, 0, 'Land tenure documents'],
  ['IOD conditions compliance (all departments)', 'MCGM', 'compliance', 15, 0, 'Compliance letters from each department'],
  ['BOCW labour cess registration & returns', 'Labour Dept', 'compliance', 30, 0, 'Registration certificate, cess receipts'],
  ["CAR / contractor's all-risk insurance", 'Insurer', 'renewal', 30, 0, 'Policy copy, premium receipt'],
  ['Commencement Certificate (CC)', 'MCGM', 'approval', 30, 0, 'IOD compliance, CC application'],
  ['MahaRERA registration (BEFORE any advertisement/sale)', 'MahaRERA', 'approval', 45, 0, 'CC, title report, CA certificate, architect certificate'],
  ['Plinth check & further CC', 'MCGM', 'approval', 15, 0, 'Plinth completion certificate by architect'],
  ['Stage-wise further CCs (superstructure)', 'MCGM', 'approval', 15, 0, 'Stage completion certificates'],
  ['RERA quarterly progress updates (confirm filing window in the current MahaRERA circular)', 'MahaRERA', 'renewal', 15, 0, 'Quarterly update form, CA statement'],
  ['70% designated-account compliance (receipts vs withdrawals)', 'Bank / CA', 'renewal', 15, 0, 'Bank statement, CA Form 3'],
  ['Fire completion NOC', 'CFO', 'noc', 30, 0, 'Fire installation completion certificate'],
  ['Lift & electrical inspector approvals', 'PWD Electrical / Lift Inspector', 'noc', 30, 0, 'Lift licence, electrical inspection report'],
  ['Building Completion Certificate (BCC)', 'MCGM', 'approval', 30, 0, 'Completion drawings, NOCs'],
  ['Occupancy Certificate (OC)', 'MCGM', 'approval', 30, 0, 'BCC, all completion NOCs'],
  ['Water/sewer connections; electricity meters', 'MCGM / electricity distributor (as applicable to your plot)', 'approval', 30, 0, 'OC, application forms'],
  ['Society formation / conveyance (as applicable)', 'Registrar / Advocate', 'compliance', 45, 0, 'Society registration documents, conveyance deed draft'],
];

router.post('/api/approvals/load-template', async (req, env) => {
  return withAuth(req, env, 'approvals', 'C', async (req, env) => {
    try {
      const { project_id, redevelopment } = await req.json();
      const ids = await visibleProjectIds(env, req.user);
      if (!project_id || !ids.includes(Number(project_id))) return json({ ok: false, error: 'Not allowed.' }, 403);
      const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM apr_items WHERE project_id = ? AND deleted_at IS NULL').bind(Number(project_id)).first();
      if (Number(have.n) > 0) return json({ ok: false, error: 'This project already has approval items. Template can only be loaded into an empty list.' }, 400);
      const rows = MUMBAI_TEMPLATE.filter((r) => redevelopment || !r[4]);
      const now = nowStr();
      const stmts = rows.map((r, i) => env.DB.prepare(`INSERT INTO apr_items (project_id, name, authority, category, stage_order, status, reminder_days, renew_months, notes, created_at) VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?)`)
        .bind(Number(project_id), r[0], r[1], r[2], (i + 1) * 10, r[3] || 30, r[2] === 'renewal' ? (r[0].startsWith('RERA quarterly') ? 3 : 12) : null, r[5], now));
      await env.DB.batch(stmts);
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'create', 'apr_items', ?, ?, ?)`).bind(req.user.user_id, Number(project_id), `Loaded Mumbai approvals template (${rows.length} items)`, now).run();
      return json({ ok: true, data: { count: rows.length } });
    } catch (e) {
      return serverError(e, 'apr-template');
    }
  });
});

// ---------- Drawings: issue new revision (atomic supersede) ----------
router.post('/api/drawings/:id/revisions', async (req, env) => {
  return withAuth(req, env, 'drawings', 'C', async (req, env) => {
    try {
      const drawingId = Number(req.params.id);
      const drawing = await env.DB.prepare('SELECT * FROM drw_drawings WHERE id = ? AND deleted_at IS NULL').bind(drawingId).first();
      if (!drawing) return json({ ok: false, error: 'Drawing not found.' }, 404);
      const ids = await visibleProjectIds(env, req.user);
      if (!ids.includes(drawing.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      const body = await req.json();
      const status = body.status === 'ifc' ? 'ifc' : 'draft';
      if (status === 'ifc' && !userCan(req.user, 'drawings', 'A')) return json({ ok: false, error: 'Only a PM or Owner can issue a drawing for construction.' }, 403);
      const last = await env.DB.prepare('SELECT rev_no FROM drw_revisions WHERE drawing_id = ? ORDER BY id DESC LIMIT 1').bind(drawingId).first();
      const n = last ? (parseInt(String(last.rev_no).replace(/\D/g, ''), 10) || 0) + 1 : 0;
      const revNo = 'R' + n;
      const now = nowStr();
      const stmts = [];
      if (status === 'ifc') stmts.push(env.DB.prepare("UPDATE drw_revisions SET status = 'superseded' WHERE drawing_id = ? AND status = 'ifc'").bind(drawingId));
      stmts.push(env.DB.prepare('INSERT INTO drw_revisions (drawing_id, rev_no, status, issued_on, received_from, note, document_id, issued_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(drawingId, revNo, status, status === 'ifc' ? (body.issued_on || now.substring(0, 10)) : null, body.received_from || '', body.note || '', body.document_id || null, req.user.user_id, now));
      stmts.push(env.DB.prepare('UPDATE drw_drawings SET waiting_consultant = 0 WHERE id = ?').bind(drawingId));
      await env.DB.batch(stmts);
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'create', 'drw_revisions', ?, ?, ?)`).bind(req.user.user_id, drawingId, `${drawing.code} ${revNo} issued as ${status === 'ifc' ? 'Issued For Construction' : 'Draft'}`, now).run();
      if (status === 'ifc') {
        const rcpt = await env.DB.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('site', 'pm') AND id != ?").bind(req.user.user_id).all();
        for (const u of rcpt.results) {
          await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, `New drawing: ${drawing.code} ${revNo}`, `${drawing.title} is now Issued For Construction. Older revisions are superseded.`, 'drawings', now).run();
        }
      }
      return json({ ok: true, data: { rev_no: revNo } });
    } catch (e) {
      return serverError(e, 'drw-issue');
    }
  });
});

// ---------- Site: create milestone ----------
router.post('/api/site/milestones', async (req, env) => {
  return withAuth(req, env, 'site', 'C', async (req, env) => {
    try {
      const b = await req.json();
      const ids = await visibleProjectIds(env, req.user);
      if (!b.project_id || !b.name || !ids.includes(Number(b.project_id))) return json({ ok: false, error: 'Project and name are required.' }, 400);
      const r = await env.DB.prepare('INSERT INTO site_milestones (project_id, wing, name, milestone_key, planned_date, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(Number(b.project_id), b.wing || null, b.name, b.milestone_key || null, b.planned_date || null, b.sort_order || 100, nowStr()).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: /UNIQUE/.test(e.message) ? 'That milestone key already exists for this wing.' : 'ms-create: ' + e.message }, /UNIQUE/.test(e.message) ? 400 : 500);
    }
  });
});

// ---------- Procurement: maker-checker PO approval ----------
router.post('/api/procurement/pos/:id/submit', async (req, env) => {
  return withAuth(req, env, 'procurement', 'E', async (req, env) => {
    const po = await env.DB.prepare('SELECT * FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    if (po.status !== 'draft') return json({ ok: false, error: 'Only a draft PO can be sent for approval.' }, 400);
    await env.DB.prepare("UPDATE pro_pos SET status = 'pending_approval' WHERE id = ?").bind(po.id).run();
    const limit = Number(await getSetting(env, 'po.pm_approval_limit_paise')) || 500000;
    const roles = po.total_paise > limit ? "('owner')" : "('owner', 'pm')";
    const approvers = await env.DB.prepare(`SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ${roles} AND id != ?`).bind(req.user.user_id).all();
    for (const u of approvers.results) {
      await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, `PO ${po.po_no} needs approval`, `Total ₹${(po.total_paise / 100).toLocaleString('en-IN')}`, 'procurement', nowStr()).run();
    }
    return json({ ok: true });
  });
});

async function decidePo(req, env, decision) {
  const po = await env.DB.prepare('SELECT * FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
  if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
  if (!(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
  if (po.status !== 'pending_approval') return json({ ok: false, error: 'This PO is not waiting for approval.' }, 400);
  if (po.created_by === req.user.user_id) return json({ ok: false, error: 'You cannot approve a PO you created.' }, 403);
  const limit = Number(await getSetting(env, 'po.pm_approval_limit_paise')) || 500000;
  if (req.user.role !== 'owner' && po.total_paise > limit) {
    return json({ ok: false, error: `This PO is above your approval limit (₹${(limit / 100).toLocaleString('en-IN')}). The Owner must approve it.` }, 403);
  }
  const now = nowStr();
  const status = decision === 'approve' ? 'approved' : 'rejected';
  await env.DB.prepare('UPDATE pro_pos SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?').bind(status, req.user.user_id, now, po.id).run();
  await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'pro_pos', ?, ?, ?)`).bind(req.user.user_id, decision, po.id, `${req.user.name} ${status} ${po.po_no} (₹${(po.total_paise / 100).toLocaleString('en-IN')})`, now).run();
  return json({ ok: true, data: { status } });
}
router.post('/api/procurement/pos/:id/approve', (req, env) => withAuth(req, env, 'procurement', 'A', (req, env) => decidePo(req, env, 'approve')));
router.post('/api/procurement/pos/:id/reject', (req, env) => withAuth(req, env, 'procurement', 'A', (req, env) => decidePo(req, env, 'reject')));

// ---------- Sales: inventory, payment plan, bookings, receipts ----------
router.get('/api/sales/plan-stages', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const pid = Number(new URL(req.url).searchParams.get('project_id'));
    if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare('SELECT * FROM sal_plan_stages WHERE project_id = ? AND retired = 0 ORDER BY sort_order, id').bind(pid).all();
    return json({ ok: true, data: { stages: rows.results } });
  });
});

router.get('/api/sales/bookings', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const ids = await visibleProjectIds(env, req.user);
    if (!ids.length) return json({ ok: true, data: { bookings: [] } });
    const rows = await env.DB.prepare(`SELECT b.*, i.unit_no, i.wing, (SELECT COALESCE(SUM(amount_paise + tds_paise), 0) FROM sal_receipts r WHERE r.booking_id = b.id AND r.reversed_at IS NULL AND r.kind = 'principal') AS collected_paise
      FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.deleted_at IS NULL AND b.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY b.id DESC LIMIT 200`).bind(...ids).all();
    for (const r of rows.results) r.pan = await maskPan(env, r.pan);
    return json({ ok: true, data: { bookings: rows.results } });
  });
});

router.get('/api/sales/bookings/:id', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const b = await env.DB.prepare('SELECT b.*, i.unit_no, i.wing FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.id = ? AND b.deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!b) return json({ ok: false, error: 'Booking not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(b.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const demands = await env.DB.prepare('SELECT * FROM sal_demands WHERE booking_id = ? ORDER BY id').bind(b.id).all();
    const receipts = await env.DB.prepare('SELECT * FROM sal_receipts WHERE booking_id = ? ORDER BY received_on, id').bind(b.id).all();
    b.pan = await maskPan(env, b.pan);
    return json({ ok: true, data: { booking: b, demands: demands.results, receipts: receipts.results } });
  });
});

router.get('/api/procurement/rfqs/:id/quotes', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    const rfq = await env.DB.prepare('SELECT * FROM pro_rfqs WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!rfq) return json({ ok: false, error: 'RFQ not found.' }, 404);
    if (rfq.project_id && !(await visibleProjectIds(env, req.user)).includes(rfq.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare('SELECT q.*, v.name AS vendor FROM pro_quotes q JOIN pro_vendors v ON v.id = q.vendor_id WHERE q.rfq_id = ? ORDER BY q.amount_paise').bind(rfq.id).all();
    const last = rfq.title ? await env.DB.prepare(`SELECT i.rate_paise, i.unit, p.po_no FROM pro_po_items i JOIN pro_pos p ON p.id = i.po_id WHERE p.status IN ('approved','received','part_received') AND lower(i.description) LIKE lower(?) ORDER BY p.id DESC LIMIT 1`).bind('%' + String(rfq.material || rfq.title).slice(0, 40) + '%').first() : null;
    return json({ ok: true, data: { rfq, quotes: rows.results, last_paid: last } });
  });
});

router.post('/api/procurement/rfqs/:id/quotes', async (req, env) => {
  return withAuth(req, env, 'procurement', 'C', async (req, env) => {
    const rfq = await env.DB.prepare('SELECT * FROM pro_rfqs WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!rfq) return json({ ok: false, error: 'RFQ not found.' }, 404);
    if (rfq.project_id && !(await visibleProjectIds(env, req.user)).includes(rfq.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const b = await req.json();
    const amount = Math.round(Number(b.amount_paise) || 0);
    if (!b.vendor_id || !(amount > 0)) return json({ ok: false, error: 'Vendor and amount are required.' }, 400);
    const r = await env.DB.prepare('INSERT INTO pro_quotes (rfq_id, vendor_id, rate_paise, amount_paise, delivery_days, terms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(rfq.id, Number(b.vendor_id), Math.round(Number(b.rate_paise) || 0), amount, b.delivery_days ?? null, b.terms || '', nowStr()).run();
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

router.post('/api/procurement/quotes/:id/select', async (req, env) => {
  return withAuth(req, env, 'procurement', 'E', async (req, env) => {
    const q = await env.DB.prepare('SELECT * FROM pro_quotes WHERE id = ?').bind(Number(req.params.id)).first();
    if (!q) return json({ ok: false, error: 'Quote not found.' }, 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE pro_quotes SET selected = 0 WHERE rfq_id = ?').bind(q.rfq_id),
      env.DB.prepare('UPDATE pro_quotes SET selected = 1 WHERE id = ?').bind(q.id),
      env.DB.prepare("UPDATE pro_rfqs SET status = 'awarded' WHERE id = ?").bind(q.rfq_id),
    ]);
    return json({ ok: true });
  });
});

// GRN: site can create (procurement 'C'). Idempotent on client_uuid so offline retries never duplicate.
router.post('/api/procurement/pos/:id/grn', async (req, env) => {
  return withAuth(req, env, 'procurement', 'C', async (req, env) => {
    const po = await env.DB.prepare('SELECT * FROM pro_pos WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    if (!['approved', 'part_received'].includes(po.status)) return json({ ok: false, error: 'Material can only be received against an approved PO.' }, 400);
    const b = await req.json();
    if (b.client_uuid) {
      const dup = await env.DB.prepare('SELECT id FROM pro_grns WHERE client_uuid = ?').bind(b.client_uuid).first();
      if (dup) return json({ ok: true, data: { id: dup.id, duplicate: true } });
    }
    const now = nowStr();
    const r = await env.DB.prepare('INSERT INTO pro_grns (po_id, received_on, qty_note, challan_no, received_by, client_uuid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(po.id, b.received_on || now.substring(0, 10), b.qty_note || '', b.challan_no || '', req.user.user_id, b.client_uuid || null, now).run();
    await env.DB.prepare('UPDATE pro_pos SET status = ? WHERE id = ?').bind(b.full ? 'received' : 'part_received', po.id).run();
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

router.get('/api/procurement/grns', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    const ids = await visibleProjectIds(env, req.user);
    if (!ids.length) return json({ ok: true, data: { grns: [] } });
    const rows = await env.DB.prepare(`SELECT g.*, p.po_no FROM pro_grns g JOIN pro_pos p ON p.id = g.po_id WHERE g.deleted_at IS NULL AND p.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY g.id DESC LIMIT 100`).bind(...ids).all();
    return json({ ok: true, data: { grns: rows.results } });
  });
});

router.get('/api/procurement/bills', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
    const ids = await visibleProjectIds(env, req.user);
    if (!ids.length) return json({ ok: true, data: { bills: [] } });
    const rows = await env.DB.prepare(`SELECT b.*, v.name AS vendor, p.po_no FROM pro_bills b JOIN pro_vendors v ON v.id = b.vendor_id LEFT JOIN pro_pos p ON p.id = b.po_id
      WHERE (p.id IS NULL OR p.project_id IN (${ids.map(() => '?').join(',')})) ORDER BY b.status = 'paid', b.due_date LIMIT 200`).bind(...ids).all();
    return json({ ok: true, data: { bills: rows.results } });
  });
});

router.post('/api/procurement/bills/:id/pay', async (req, env) => {
  return withAuth(req, env, 'procurement', 'E', async (req, env) => {
    const b = await req.json();
    const bill = await env.DB.prepare('SELECT * FROM pro_bills WHERE id = ?').bind(Number(req.params.id)).first();
    if (!bill) return json({ ok: false, error: 'Bill not found.' }, 404);
    await env.DB.prepare("UPDATE pro_bills SET status = 'paid', paid_on = ?, payment_ref = ? WHERE id = ?").bind(b.paid_on || nowStr().substring(0, 10), b.payment_ref || '', bill.id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'pay', 'pro_bills', ?, ?, ?)`).bind(req.user.user_id, bill.id, `Marked bill ${bill.bill_no || bill.id} paid`, nowStr()).run();
    return json({ ok: true });
  });
});

router.get('/api/procurement/vendors/:id/ledger', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    if (req.user.role === 'site') return json({ ok: false, error: 'Not allowed.' }, 403);
    const id = Number(req.params.id);
    const ids = await visibleProjectIds(env, req.user);
    if (!ids.length) return json({ ok: true, data: { pos: [], bills: [] } });
    const ph = ids.map(() => '?').join(',');
    const pos = await env.DB.prepare(`SELECT po_no, total_paise, status, created_at FROM pro_pos WHERE vendor_id = ? AND deleted_at IS NULL AND project_id IN (${ph}) ORDER BY id DESC`).bind(id, ...ids).all();
    const bills = await env.DB.prepare(`SELECT b.bill_no, b.amount_paise, b.status, b.due_date, b.paid_on FROM pro_bills b LEFT JOIN pro_pos p ON p.id = b.po_id WHERE b.vendor_id = ? AND (p.id IS NULL OR p.project_id IN (${ph})) ORDER BY b.id DESC`).bind(id, ...ids).all();
    return json({ ok: true, data: { pos: pos.results, bills: bills.results } });
  });
});

// ---------- Print data (letterhead pages are rendered in the browser from this) ----------
async function defaultBrandId(env) {
  const r = await env.DB.prepare('SELECT id FROM brands WHERE is_default = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1').first();
  return r ? r.id : 1;
}

async function brandIdForProject(env, projectId) {
  const p = projectId ? await env.DB.prepare('SELECT brand_id FROM projects WHERE id = ?').bind(projectId).first() : null;
  return (p && p.brand_id) || (await defaultBrandId(env));
}

// Pictures uploaded for one brand, e.g. ['logo', 'signature']
async function brandPictures(env, brandId) {
  const rows = await env.DB.prepare("SELECT series_key FROM documents WHERE series_key LIKE ? AND is_latest = 1 AND deleted_at IS NULL").bind(`brand:${brandId}:%`).all();
  return rows.results.map((r) => r.series_key.split(':')[2]);
}

// Brand for a project: the project's brand profile, then project-level overrides field by field.
async function printBrand(env, projectId) {
  const brandId = await brandIdForProject(env, projectId);
  const rows = await env.DB.prepare('SELECT * FROM brand_profiles WHERE (brand_id = ? AND project_id IS NULL) OR project_id = ?').bind(brandId, projectId || 0).all();
  const co = rows.results.find((r) => r.project_id === null) || {};
  const pr = rows.results.find((r) => r.project_id === projectId) || {};
  const out = {};
  for (const k of ['legal_name', 'trade_name', 'tagline', 'address', 'phone', 'email', 'website', 'gstin', 'cin_or_llpin', 'promoter_rera_ref', 'bank_account_name', 'bank_name', 'bank_branch', 'bank_ifsc', 'signatory_name', 'signatory_title', 'footer_text', 'colour_primary', 'letterhead_mode', 'margin_top_mm', 'margin_bottom_mm', 'margin_side_mm']) {
    out[k] = (pr[k] !== null && pr[k] !== undefined && pr[k] !== '') ? pr[k] : (co[k] ?? '');
  }
  out.brand_id = brandId;
  out.pictures = await brandPictures(env, brandId);
  return out; // PAN and bank account number stay encrypted in the DB and are never printed from here
}

router.get('/api/print/po/:id', async (req, env) => {
  return withAuth(req, env, 'procurement', 'V', async (req, env) => {
    const po = await env.DB.prepare('SELECT p.*, v.name AS vendor, v.address AS vendor_address, v.gstin AS vendor_gstin, v.phone AS vendor_phone, pr.name AS project_name, pr.address AS project_address FROM pro_pos p JOIN pro_vendors v ON v.id = p.vendor_id JOIN projects pr ON pr.id = p.project_id WHERE p.id = ? AND p.deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!po) return json({ ok: false, error: 'PO not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(po.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const items = await env.DB.prepare('SELECT * FROM pro_po_items WHERE po_id = ? ORDER BY id').bind(po.id).all();
    const issued = ['approved', 'part_received', 'received'].includes(po.status);
    return json({ ok: true, data: { kind: 'po', draft: !issued, po, items: items.results, brand: await printBrand(env, po.project_id) } });
  });
});

router.get('/api/print/demand/:id', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const d = await env.DB.prepare(`SELECT d.*, b.customer_name, b.address AS customer_address, b.project_id, b.gst_bp, i.unit_no, i.wing, pr.name AS project_name, pr.rera_no FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id WHERE d.id = ?`).bind(Number(req.params.id)).first();
    if (!d) return json({ ok: false, error: 'Demand not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(d.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    return json({ ok: true, data: { kind: 'demand', draft: d.status === 'scheduled', demand: d, brand: await printBrand(env, d.project_id) } });
  });
});

router.get('/api/print/receipt/:id', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const r = await env.DB.prepare(`SELECT r.*, b.customer_name, b.project_id, i.unit_no, i.wing, pr.name AS project_name, d.label AS demand_label FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id LEFT JOIN sal_demands d ON d.id = r.demand_id WHERE r.id = ?`).bind(Number(req.params.id)).first();
    if (!r) return json({ ok: false, error: 'Receipt not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(r.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    return json({ ok: true, data: { kind: 'receipt', draft: !!r.reversed_at, receipt: r, brand: await printBrand(env, r.project_id) } });
  });
});

// ---------- CSV exports (UTF-8 BOM, Excel-friendly) ----------
function csvResponse(name, headers, rows) {
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = '﻿' + [headers.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
}
const rupees = (p) => ((Number(p) || 0) / 100).toFixed(2);

router.get('/api/export/:what', async (req, env) => {
  return withAuth(req, env, 'reports', 'X', async (req, env) => {
    const ids = await visibleProjectIds(env, req.user);
    if (!ids.length) return json({ ok: false, error: 'Nothing to export.' }, 404);
    const ph = ids.map(() => '?').join(',');
    const what = req.params.what;
    if (what === 'receipts') {
      const rows = await env.DB.prepare(`SELECT r.received_on, b.customer_name, pr.name AS project, i.wing, i.unit_no, r.amount_paise, r.tds_paise, r.mode, r.ref_no, r.reversed_at FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id WHERE b.project_id IN (${ph}) ORDER BY r.received_on`).bind(...ids).all();
      return csvResponse('receipts.csv', ['Date', 'Customer', 'Project', 'Wing', 'Flat', 'Amount (INR)', 'TDS (INR)', 'Mode', 'Reference', 'Reversed'], rows.results.map((r) => [r.received_on, r.customer_name, r.project, r.wing, r.unit_no, rupees(r.amount_paise), rupees(r.tds_paise), r.mode, r.ref_no, r.reversed_at ? 'Yes' : '']));
    }
    if (what === 'receivables') {
      const rows = await env.DB.prepare(`SELECT b.customer_name, pr.name AS project, i.wing, i.unit_no, b.agreed_price_paise, b.status, (SELECT COALESCE(SUM(amount_paise + tds_paise), 0) FROM sal_receipts r WHERE r.booking_id = b.id AND r.reversed_at IS NULL AND r.kind = 'principal') AS collected FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id WHERE b.deleted_at IS NULL AND b.project_id IN (${ph}) ORDER BY b.id`).bind(...ids).all();
      return csvResponse('receivables.csv', ['Customer', 'Project', 'Wing', 'Flat', 'Agreed price (INR)', 'Collected (INR)', 'Balance (INR)', 'Status'], rows.results.map((r) => [r.customer_name, r.project, r.wing, r.unit_no, rupees(r.agreed_price_paise), rupees(r.collected), rupees(r.agreed_price_paise - r.collected), r.status]));
    }
    if (what === 'purchases') {
      const rows = await env.DB.prepare(`SELECT p.po_no, v.name AS vendor, pr.name AS project, p.amount_paise, p.gst_paise, p.total_paise, p.status, p.created_at FROM pro_pos p JOIN pro_vendors v ON v.id = p.vendor_id JOIN projects pr ON pr.id = p.project_id WHERE p.deleted_at IS NULL AND p.project_id IN (${ph}) ORDER BY p.id`).bind(...ids).all();
      return csvResponse('purchase-register.csv', ['PO', 'Vendor', 'Project', 'Amount (INR)', 'GST (INR)', 'Total (INR)', 'Status', 'Created'], rows.results.map((r) => [r.po_no, r.vendor, r.project, rupees(r.amount_paise), rupees(r.gst_paise), rupees(r.total_paise), r.status, r.created_at]));
    }
    if (what === 'leads') {
      const rows = await env.DB.prepare('SELECT name, phone, source, status, config_pref, created_at FROM sal_leads WHERE deleted_at IS NULL ORDER BY id').all();
      return csvResponse('leads.csv', ['Name', 'Mobile', 'Source', 'Status', 'Wants', 'Created'], rows.results.map((r) => [r.name, r.phone, r.source, r.status, r.config_pref, r.created_at]));
    }
    return json({ ok: false, error: 'Unknown export.' }, 404);
  });
});

async function buildExport(env) {
  const tables = ['projects', 'apr_items', 'apr_events', 'drw_drawings', 'drw_revisions', 'site_milestones', 'site_dprs', 'site_snags', 'pro_vendors', 'pro_rfqs', 'pro_quotes', 'pro_pos', 'pro_po_items', 'pro_grns', 'pro_bills',
    'sal_leads', 'sal_activities', 'sal_visits', 'sal_inventory', 'sal_partners', 'sal_bookings', 'sal_plan_stages', 'sal_demands', 'sal_receipts', 'documents', 'audit_log'];
  const out = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of tables) out.tables[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  for (const r of out.tables.sal_bookings) r.pan = await maskPan(env, r.pan); // never export a customer's PAN
  out.tables.users = (await env.DB.prepare('SELECT id, name, email, phone, role, lang, active, created_at FROM users').all()).results;
  return out;
}

// Nightly backup (02:00 IST): JSON export saved to the connected Google Drive under /Backups. Only the Owner's Drive holds it.
async function nightlyBackup(env) {
  const log = await env.DB.prepare("INSERT INTO backup_log (kind, status, started_at) VALUES ('nightly', 'running', ?)").bind(nowStr()).run();
  const id = log.meta.last_row_id;
  try {
    if (!(await driveReady(env))) throw new Error('Google Drive is not connected, so no backup was saved.');
    const body = new TextEncoder().encode(JSON.stringify(await buildExport(env)));
    const day = new Date(Date.now() + 19800000).toISOString().substring(0, 10);
    await withDrive(env, async (token) => {
      const root = await getSettingRaw(env, 'storage.gdrive.root_folder_id');
      const found = await gdrive.findDriveFolder(env, token, 'Backups', root);
      const folder = (found.files && found.files[0]) ? found.files[0].id : (await gdrive.createDriveFolder(env, token, 'Backups', root)).id;
      const session = await gdrive.resumableUploadInit(env, token, `nirmaan-backup-${day}.json`, 'application/json', folder, body.byteLength);
      await gdrive.resumableUploadPut(env, token, session, body, body.byteLength, 'application/json');
    });
    await env.DB.prepare("UPDATE backup_log SET status = 'ok', bytes = ?, files_written = 1, finished_at = ? WHERE id = ?").bind(body.byteLength, nowStr(), id).run();
  } catch (e) {
    await env.DB.prepare("UPDATE backup_log SET status = 'failed', note = ?, finished_at = ? WHERE id = ?").bind(String(e.message).slice(0, 300), nowStr(), id).run();
    const owners = await env.DB.prepare("SELECT id FROM users WHERE role = 'owner' AND active = 1").all();
    for (const o of owners.results) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(o.id, 'Nightly backup did not run', String(e.message).slice(0, 200), 'storage', nowStr()).run();
  }
}

// Owner-only full data export (JSON). Secrets, sessions, OTP codes and file contents are left out.
router.get('/api/export-all', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Owner only.' }, 403);
    const out = await buildExport(env);
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="nirmaan-export.json"', 'Cache-Control': 'no-store' } });
  });
});

router.post('/api/auth/lang', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    const { lang } = await req.json();
    if (!['en', 'hi', 'mr'].includes(lang)) return json({ ok: false, error: 'Unknown language.' }, 400);
    await env.DB.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(lang, req.user.user_id).run();
    return json({ ok: true });
  });
});

// ---------- Versioned series helper (brochures, brand pictures) ----------
async function nextVersion(env, seriesKey, projectId) {
  const prev = await env.DB.prepare('SELECT id, version FROM documents WHERE series_key = ? AND COALESCE(project_id, 0) = COALESCE(?, 0) AND is_latest = 1 AND deleted_at IS NULL').bind(seriesKey, projectId || null).first();
  if (!prev) return { version: 1, supersedes: null };
  await env.DB.prepare('UPDATE documents SET is_latest = 0 WHERE id = ?').bind(prev.id).run();
  return { version: Number(prev.version) + 1, supersedes: prev.id };
}

// ---------- Brochure library ----------
const BROCHURE_CATS = ['brochure', 'price_list', 'floor_plan', 'rera_certificate', 'sample_flat', 'other'];

router.get('/api/brochures', async (req, env) => {
  return withAuth(req, env, 'brochures', 'V', async (req, env) => {
    const ids = await visibleProjectIds(env, req.user);
    if (!ids.length) return json({ ok: true, data: { items: [] } });
    const customerOnly = !['owner', 'pm'].includes(req.user.role); // internal price lists never reach sales
    const pid = new URL(req.url).searchParams.get('project_id');
    const scope = pid ? (ids.includes(Number(pid)) ? [Number(pid)] : []) : ids;
    if (!scope.length) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare(`SELECT d.id, d.project_id, d.title, d.category, d.kind, d.external_url, d.audience, d.language, d.series_key, d.version, d.size_bytes, d.mime, d.created_at, p.name AS project,
      (SELECT COUNT(*) FROM documents o WHERE o.series_key = d.series_key AND COALESCE(o.project_id,0) = COALESCE(d.project_id,0) AND o.deleted_at IS NULL) AS versions
      FROM documents d LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.module = 'brochure' AND d.is_latest = 1 AND d.deleted_at IS NULL AND d.project_id IN (${scope.map(() => '?').join(',')}) ${customerOnly ? "AND d.audience = 'customer'" : ''} ORDER BY p.name, d.category, d.title`).bind(...scope).all();
    return json({ ok: true, data: { items: rows.results } });
  });
});

router.get('/api/brochures/versions', async (req, env) => {
  return withAuth(req, env, 'brochures', 'E', async (req, env) => {
    const u = new URL(req.url);
    const pid = Number(u.searchParams.get('project_id'));
    if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare("SELECT id, title, version, is_latest, size_bytes, kind, external_url, created_at FROM documents WHERE module = 'brochure' AND series_key = ? AND project_id = ? AND deleted_at IS NULL ORDER BY version DESC").bind(u.searchParams.get('series_key') || '', pid).all();
    return json({ ok: true, data: { versions: rows.results } });
  });
});

// Link-type brochure (new item or a new version of an existing series)
router.post('/api/brochures/link', async (req, env) => {
  return withAuth(req, env, 'brochures', 'C', async (req, env) => {
    const b = await req.json();
    if (!b.title || !/^https:\/\/[^\s]+$/i.test(String(b.external_url || ''))) return json({ ok: false, error: 'Title and an https:// link are required.' }, 400);
    const pid = Number(b.project_id);
    if (!(await visibleProjectIds(env, req.user)).includes(pid)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const cat = BROCHURE_CATS.includes(b.category) ? b.category : 'brochure';
    const series = b.series_key || `${cat}:${String(b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    const { version, supersedes } = await nextVersion(env, series, pid);
    const r = await env.DB.prepare(`INSERT INTO documents (project_id, title, category, kind, module, external_url, audience, language, series_key, version, is_latest, supersedes_id, uploaded_by, created_at) VALUES (?, ?, ?, 'link', 'brochure', ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(pid, String(b.title), cat, b.external_url, b.audience === 'customer' ? 'customer' : 'internal', b.language || null, series, version, supersedes, req.user.user_id, nowStr()).run();
    return json({ ok: true, data: { id: r.meta.last_row_id, version } });
  });
});

// ---------- Archive / restore a finished project ----------
router.get('/api/projects-archived', async (req, env) => {
  return withAuth(req, env, 'projects', 'E', async (req, env) => {
    const rows = await env.DB.prepare("SELECT * FROM projects WHERE status = 'archived' AND deleted_at IS NULL ORDER BY name").all();
    return json({ ok: true, data: { projects: rows.results } });
  });
});

router.post('/api/projects/:id/archive', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can archive a project.' }, 403);
    const id = Number(req.params.id);
    const p = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!p) return json({ ok: false, error: 'Project not found.' }, 404);
    await env.DB.prepare("UPDATE projects SET status = 'archived', notes = COALESCE(notes, '') || ? WHERE id = ?").bind(`\n[prev status: ${p.status}]`, id).run();
    let driveNote = 'Files stay where they are.';
    try {
      if (await driveReady(env)) {
        const f = await env.DB.prepare('SELECT drive_folder_id FROM drive_folders WHERE path_key = ?').bind('p:' + id).first();
        if (f) {
          await withDrive(env, async (token) => {
            const root = await getSettingRaw(env, 'storage.gdrive.root_folder_id');
            const found = await gdrive.findDriveFolder(env, token, '_archive', root);
            const arch = (found.files && found.files[0]) ? found.files[0].id : (await gdrive.createDriveFolder(env, token, '_archive', root)).id;
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.drive_folder_id}?addParents=${arch}&removeParents=${root}&fields=id`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error('Drive move failed (' + res.status + ')');
          });
          driveNote = 'Its Drive folder was moved into _archive.';
        }
      }
    } catch (e) { driveNote = 'Project archived, but the Drive folder could not be moved: ' + e.message; }
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'archive', 'projects', ?, ?, ?)`).bind(req.user.user_id, id, `Archived project ${p.name}`, nowStr()).run();
    return json({ ok: true, data: { note: driveNote } });
  });
});

router.post('/api/projects/:id/restore', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can restore a project.' }, 403);
    const id = Number(req.params.id);
    const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND status = 'archived'").bind(id).first();
    if (!p) return json({ ok: false, error: 'Archived project not found.' }, 404);
    const prev = (String(p.notes || '').match(/\[prev status: ([a-z_]+)\]\s*$/) || [, 'planning'])[1];
    await env.DB.prepare('UPDATE projects SET status = ? WHERE id = ?').bind(prev, id).run();
    try {
      if (await driveReady(env)) {
        const f = await env.DB.prepare('SELECT drive_folder_id FROM drive_folders WHERE path_key = ?').bind('p:' + id).first();
        if (f) await withDrive(env, async (token) => {
          const root = await getSettingRaw(env, 'storage.gdrive.root_folder_id');
          const found = await gdrive.findDriveFolder(env, token, '_archive', root);
          if (found.files && found.files[0]) await fetch(`https://www.googleapis.com/drive/v3/files/${f.drive_folder_id}?addParents=${root}&removeParents=${found.files[0].id}&fields=id`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
        });
      }
    } catch (e) { /* folder move is best effort */ }
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'restore', 'projects', ?, ?, ?)`).bind(req.user.user_id, id, `Restored project ${p.name}`, nowStr()).run();
    return json({ ok: true });
  });
});

// ---------- Snag workflow: open -> fixed -> verified ----------
router.post('/api/site/snags/:id/status', async (req, env) => {
  return withAuth(req, env, 'site', 'E', async (req, env) => {
    const s = await env.DB.prepare('SELECT * FROM site_snags WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!s) return json({ ok: false, error: 'Snag not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(s.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const { status } = await req.json();
    if (!['open', 'fixed', 'verified'].includes(status)) return json({ ok: false, error: 'Unknown status.' }, 400);
    if (status === 'verified' && !userCan(req.user, 'site', 'A')) return json({ ok: false, error: 'Only a PM or Owner can verify a fix.' }, 403);
    await env.DB.prepare('UPDATE site_snags SET status = ?, closed_at = ? WHERE id = ?').bind(status, status === 'verified' ? nowStr() : null, s.id).run();
    return json({ ok: true });
  });
});

// ---------- People (HR): staff, open positions, candidates ----------
router.get('/api/people/staff', async (req, env) => {
  return withAuth(req, env, 'people', 'V', async (req, env) => {
    const rows = await env.DB.prepare('SELECT * FROM ppl_staff WHERE deleted_at IS NULL ORDER BY active DESC, name').all();
    return json({ ok: true, data: { staff: rows.results } });
  });
});

router.post('/api/people/staff', async (req, env) => {
  return withAuth(req, env, 'people', 'C', async (req, env) => {
    const b = await req.json();
    if (!b.name) return json({ ok: false, error: 'Name is required.' }, 400);
    const r = await env.DB.prepare('INSERT INTO ppl_staff (name, role_title, department, phone, email, joined_on, employment, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(b.name, b.role_title || '', b.department || '', b.phone || '', b.email || '', b.joined_on || null, b.employment || 'staff', b.notes || '', nowStr()).run();
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

router.put('/api/people/staff/:id', async (req, env) => {
  return withAuth(req, env, 'people', 'E', async (req, env) => {
    const b = await req.json();
    await env.DB.prepare('UPDATE ppl_staff SET name = COALESCE(?, name), role_title = COALESCE(?, role_title), department = COALESCE(?, department), phone = COALESCE(?, phone), email = COALESCE(?, email), active = COALESCE(?, active) WHERE id = ?')
      .bind(b.name || null, b.role_title ?? null, b.department ?? null, b.phone ?? null, b.email ?? null, b.active === undefined ? null : (b.active ? 1 : 0), Number(req.params.id)).run();
    return json({ ok: true });
  });
});

router.get('/api/people/hiring', async (req, env) => {
  return withAuth(req, env, 'people', 'V', async (req, env) => {
    const rows = await env.DB.prepare(`SELECT h.*, p.name AS project, (SELECT COUNT(*) FROM ppl_candidates c WHERE c.hiring_id = h.id AND c.deleted_at IS NULL) AS candidates FROM ppl_hiring h LEFT JOIN projects p ON p.id = h.project_id WHERE h.deleted_at IS NULL ORDER BY h.status, h.id DESC`).all();
    return json({ ok: true, data: { positions: rows.results } });
  });
});

router.post('/api/people/hiring', async (req, env) => {
  return withAuth(req, env, 'people', 'C', async (req, env) => {
    const b = await req.json();
    if (!b.position) return json({ ok: false, error: 'Position is required.' }, 400);
    const r = await env.DB.prepare('INSERT INTO ppl_hiring (position, project_id, status, opened_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(b.position, b.project_id ? Number(b.project_id) : null, 'open', nowStr().substring(0, 10), b.notes || '', nowStr()).run();
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

router.get('/api/people/hiring/:id/candidates', async (req, env) => {
  return withAuth(req, env, 'people', 'V', async (req, env) => {
    const rows = await env.DB.prepare('SELECT * FROM ppl_candidates WHERE hiring_id = ? AND deleted_at IS NULL ORDER BY id DESC').bind(Number(req.params.id)).all();
    return json({ ok: true, data: { candidates: rows.results } });
  });
});

router.post('/api/people/hiring/:id/candidates', async (req, env) => {
  return withAuth(req, env, 'people', 'C', async (req, env) => {
    const b = await req.json();
    if (!b.name) return json({ ok: false, error: 'Name is required.' }, 400);
    const r = await env.DB.prepare('INSERT INTO ppl_candidates (hiring_id, name, phone, note, created_at) VALUES (?, ?, ?, ?, ?)').bind(Number(req.params.id), b.name, b.phone || '', b.note || '', nowStr()).run();
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

const CAND_FLOW = ['new', 'screened', 'interview', 'offered', 'hired', 'rejected'];
router.post('/api/people/candidates/:id/status', async (req, env) => {
  return withAuth(req, env, 'people', 'E', async (req, env) => {
    const c = await env.DB.prepare('SELECT c.*, h.position FROM ppl_candidates c JOIN ppl_hiring h ON h.id = c.hiring_id WHERE c.id = ? AND c.deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!c) return json({ ok: false, error: 'Candidate not found.' }, 404);
    const b = await req.json();
    if (!CAND_FLOW.includes(b.status)) return json({ ok: false, error: 'Unknown status.' }, 400);
    const stmts = [env.DB.prepare('UPDATE ppl_candidates SET status = ?, interview_on = COALESCE(?, interview_on), note = COALESCE(?, note) WHERE id = ?').bind(b.status, b.interview_on || null, b.note ?? null, c.id)];
    if (b.status === 'hired' && c.status !== 'hired') {
      stmts.push(env.DB.prepare('INSERT INTO ppl_staff (name, role_title, phone, joined_on, employment, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(c.name, c.position, c.phone || '', nowStr().substring(0, 10), 'staff', 'Hired via Open Positions', nowStr()));
      stmts.push(env.DB.prepare("UPDATE ppl_hiring SET status = 'filled' WHERE id = ? AND status = 'open'").bind(c.hiring_id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, data: { converted: b.status === 'hired' && c.status !== 'hired' } });
  });
});

router.get('/api/people/interviews', async (req, env) => {
  return withAuth(req, env, 'people', 'V', async (req, env) => {
    const rows = await env.DB.prepare("SELECT c.*, h.position FROM ppl_candidates c JOIN ppl_hiring h ON h.id = c.hiring_id WHERE c.deleted_at IS NULL AND c.status = 'interview' AND c.interview_on IS NOT NULL AND date(c.interview_on) >= date('now') ORDER BY c.interview_on LIMIT 50").all();
    return json({ ok: true, data: { interviews: rows.results } });
  });
});

// ---------- Letterhead pictures: served only to signed-in staff, never publicly ----------
router.get('/api/print/asset/:kind', async (req, env) => {
  return withAuth(req, env, 'branding', 'V', async (req, env) => {
    const kind = req.params.kind;
    if (!['logo', 'signature', 'stamp', 'letterhead', 'header', 'footer'].includes(kind)) return json({ ok: false, error: 'Unknown picture.' }, 404);
    const brandId = Number(new URL(req.url).searchParams.get('brand')) || (await defaultBrandId(env));
    const row = await env.DB.prepare(`SELECT fb.data, fb.mime FROM documents d JOIN file_blobs fb ON fb.id = d.blob_id WHERE d.series_key = ? AND d.is_latest = 1 AND d.deleted_at IS NULL ORDER BY d.version DESC LIMIT 1`).bind(`brand:${brandId}:${kind}`).first();
    if (!row) return json({ ok: false, error: 'Not uploaded.' }, 404);
    return new Response(blobBytes(row.data), { headers: { 'Content-Type': row.mime || 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
});

// ---------- Email a demand letter to the customer (HTML in the email body) ----------
router.post('/api/sales/demands/:id/email', async (req, env) => {
  return withAuth(req, env, 'sales', 'E', async (req, env) => {
    const d = await env.DB.prepare(`SELECT d.*, b.customer_name, b.email AS customer_email, b.project_id, i.unit_no, i.wing, pr.name AS project_name FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id WHERE d.id = ?`).bind(Number(req.params.id)).first();
    if (!d) return json({ ok: false, error: 'Demand not found.' }, 404);
    if (!(await visibleProjectIds(env, req.user)).includes(d.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const body = await req.json().catch(() => ({}));
    const to = String(body.to || d.customer_email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: false, error: 'This customer has no email address. Type one in.' }, 400);
    if (d.status === 'scheduled') return json({ ok: false, error: 'This payment stage has not been reached yet.' }, 400);
    const brand = await printBrand(env, d.project_id);
    const total = d.amount_paise + (d.gst_paise || 0) - (d.settled_paise || 0);
    const inr = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const html = `<div style="font-family:Georgia,serif;max-width:620px;margin:auto"><h2 style="margin:0">${escHtml(brand.trade_name || brand.legal_name || '')}</h2><p style="color:#555;margin:2px 0 16px">${escHtml(brand.address || '')}</p>
      <h3>Payment demand — ${escHtml(d.project_name)}, ${escHtml((d.wing ? d.wing + '-' : '') + d.unit_no)}</h3><p>Dear ${escHtml(d.customer_name)},</p>
      <p>As per the agreed payment plan, the stage <b>${escHtml(d.label)}</b> has been reached.${d.due_date ? ' Please pay on or before <b>' + escHtml(d.due_date) + '</b>.' : ''}</p>
      <table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #999;padding:6px">${escHtml(d.label)}</td><td style="border:1px solid #999;padding:6px;text-align:right">${inr(d.amount_paise)}</td></tr>
      <tr><td style="border:1px solid #999;padding:6px">GST</td><td style="border:1px solid #999;padding:6px;text-align:right">${inr(d.gst_paise || 0)}</td></tr>
      <tr><td style="border:1px solid #999;padding:6px"><b>Amount due</b></td><td style="border:1px solid #999;padding:6px;text-align:right"><b>${inr(total)}</b></td></tr></table>
      ${brand.bank_name ? `<p>Pay to: ${escHtml(brand.bank_account_name)}, ${escHtml(brand.bank_name)}, IFSC ${escHtml(brand.bank_ifsc)}. Please contact our office for the account number.</p>` : ''}
      <p>Regards,<br>${escHtml(brand.signatory_name || brand.legal_name || '')}</p></div>`;
    const r = await sendMail(env, to, `Payment demand — ${d.project_name} ${d.wing ? d.wing + '-' : ''}${d.unit_no}`, html, { template: 'demand' });
    await env.DB.prepare('UPDATE sal_demands SET sent_at = ? WHERE id = ?').bind(nowStr(), d.id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'email', 'sal_demands', ?, ?, ?)`).bind(req.user.user_id, d.id, `Emailed demand "${d.label}" to ${d.customer_name}`, nowStr()).run();
    return json({ ok: true, data: { sent: r.sent, error: r.error } });
  });
});

// ---------- Documents attached to a record (site photos etc.) ----------
router.get('/api/attachments', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    const u = new URL(req.url);
    const entity = u.searchParams.get('entity'); const eid = Number(u.searchParams.get('entity_id'));
    if (!['site_dprs', 'site_snags', 'pro_grns'].includes(entity)) return json({ ok: false, error: 'Unknown record type.' }, 400);
    const rows = await env.DB.prepare('SELECT id, title, mime, size_bytes, project_id, created_at FROM documents WHERE entity = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY id').bind(entity, eid).all();
    const ids = await visibleProjectIds(env, req.user);
    return json({ ok: true, data: { files: rows.results.filter((r) => !r.project_id || ids.includes(r.project_id)) } });
  });
});

// ---------- Sales: lead timeline, follow-ups, visits ----------
async function leadAccess(env, user, id) {
  const lead = await env.DB.prepare('SELECT * FROM sal_leads WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if (!lead) return { err: json({ ok: false, error: 'Lead not found.' }, 404) };
  const seeAll = ['owner', 'pm'].includes(user.role) || (await getSetting(env, 'sales.share_all_leads')) === 'on';
  if (!seeAll && lead.assigned_to !== user.user_id) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
  if (lead.project_id && !(await visibleProjectIds(env, user)).includes(lead.project_id)) return { err: json({ ok: false, error: 'Not allowed.' }, 403) };
  return { lead };
}

router.get('/api/sales/leads/:id', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const { lead, err } = await leadAccess(env, req.user, Number(req.params.id));
    if (err) return err;
    const acts = await env.DB.prepare('SELECT a.*, u.name AS by_name FROM sal_activities a LEFT JOIN users u ON u.id = a.by_user WHERE a.lead_id = ? ORDER BY a.id DESC LIMIT 100').bind(lead.id).all();
    const visits = await env.DB.prepare('SELECT * FROM sal_visits WHERE lead_id = ? AND deleted_at IS NULL ORDER BY visit_at DESC').bind(lead.id).all();
    return json({ ok: true, data: { lead, activities: acts.results, visits: visits.results } });
  });
});

const LEAD_FLOW = ['new', 'contacted', 'interested', 'visit_scheduled', 'visited', 'negotiating', 'booked', 'lost'];
router.post('/api/sales/leads/:id/activity', async (req, env) => {
  return withAuth(req, env, 'sales', 'E', async (req, env) => {
    const { lead, err } = await leadAccess(env, req.user, Number(req.params.id));
    if (err) return err;
    const b = await req.json();
    const type = ['call', 'whatsapp', 'note', 'email'].includes(b.type) ? b.type : 'note';
    // Logging a call without saying when to call next is how leads go cold: next follow-up is mandatory unless the lead is closed.
    const closing = ['booked', 'lost'].includes(b.status);
    if (type === 'call' && !b.next_followup_at && !closing) return json({ ok: false, error: 'Pick the next follow-up date before saving a call.' }, 400);
    if (b.status && !LEAD_FLOW.includes(b.status)) return json({ ok: false, error: 'Unknown status.' }, 400);
    if (b.status && b.status !== lead.status) {
      if (b.status === 'booked') return json({ ok: false, error: 'A lead becomes Booked only when you book a flat for them.' }, 400);
      if (!(LEAD_TRANSITIONS[lead.status] || []).includes(b.status)) return json({ ok: false, error: `A ${lead.status.replace('_', ' ')} lead cannot be moved to ${b.status.replace('_', ' ')}.` }, 400);
      if (lead.status === 'lost' && !['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Only a manager can reopen a lost lead.' }, 403);
    }
    const now = nowStr();
    const stmts = [env.DB.prepare('INSERT INTO sal_activities (lead_id, type, outcome, note, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(lead.id, type, b.outcome || '', b.note || '', req.user.user_id, now),
      env.DB.prepare(`UPDATE sal_leads SET last_contact_at = ?, first_contact_at = COALESCE(first_contact_at, ?), next_followup_at = ?, status = CASE WHEN ? IS NOT NULL THEN ? WHEN status = 'new' THEN 'contacted' ELSE status END WHERE id = ?`)
        .bind(now, now, closing ? null : (b.next_followup_at || lead.next_followup_at), b.status || null, b.status || null, lead.id)];
    await env.DB.batch(stmts);
    return json({ ok: true });
  });
});

router.post('/api/sales/leads/:id/visit', async (req, env) => {
  return withAuth(req, env, 'sales', 'E', async (req, env) => {
    const { lead, err } = await leadAccess(env, req.user, Number(req.params.id));
    if (err) return err;
    const b = await req.json();
    if (!b.visit_at) return json({ ok: false, error: 'Pick the visit date and time.' }, 400);
    const now = nowStr();
    const r = await env.DB.prepare('INSERT INTO sal_visits (lead_id, project_id, visit_at, status, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(lead.id, lead.project_id, b.visit_at, 'scheduled', req.user.user_id, now).run();
    await env.DB.batch([env.DB.prepare("UPDATE sal_leads SET status = CASE WHEN status IN ('new','contacted','interested') THEN 'visit_scheduled' ELSE status END, next_followup_at = ? WHERE id = ?").bind(b.visit_at, lead.id),
      env.DB.prepare('INSERT INTO sal_activities (lead_id, type, note, by_user, created_at) VALUES (?, ?, ?, ?, ?)').bind(lead.id, 'visit', `Site visit scheduled for ${b.visit_at}`, req.user.user_id, now)]);
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

router.post('/api/sales/visits/:id/status', async (req, env) => {
  return withAuth(req, env, 'sales', 'E', async (req, env) => {
    const v = await env.DB.prepare('SELECT * FROM sal_visits WHERE id = ? AND deleted_at IS NULL').bind(Number(req.params.id)).first();
    if (!v) return json({ ok: false, error: 'Visit not found.' }, 404);
    const { lead, err } = await leadAccess(env, req.user, v.lead_id);
    if (err) return err;
    const b = await req.json();
    if (!['done', 'no_show', 'cancelled'].includes(b.status)) return json({ ok: false, error: 'Unknown status.' }, 400);
    await env.DB.batch([env.DB.prepare('UPDATE sal_visits SET status = ?, feedback = ? WHERE id = ?').bind(b.status, b.feedback || '', v.id),
      env.DB.prepare("UPDATE sal_leads SET status = CASE WHEN ? = 'done' THEN 'visited' ELSE status END WHERE id = ?").bind(b.status, lead.id),
      env.DB.prepare('INSERT INTO sal_activities (lead_id, type, outcome, note, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(lead.id, 'visit', b.status, b.feedback || '', req.user.user_id, nowStr())]);
    return json({ ok: true });
  });
});

// Follow-ups due today or overdue, and visits in the next 7 days (for the Sales home strip)
router.get('/api/sales/followups', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    const user = req.user;
    const seeAll = ['owner', 'pm'].includes(user.role) || (await getSetting(env, 'sales.share_all_leads')) === 'on';
    const scope = user.scopeProject ? ' AND project_id = ' + Number(user.scopeProject) : '';
    const mine = seeAll ? '' : ' AND assigned_to = ' + Number(user.user_id);
    const leads = await env.DB.prepare(`SELECT id, name, phone, status, next_followup_at, project_id FROM sal_leads WHERE deleted_at IS NULL AND status NOT IN ('booked','lost') AND next_followup_at IS NOT NULL AND date(next_followup_at) <= date('now', '+0 days', '+5 hours', '+30 minutes')${scope}${mine} ORDER BY next_followup_at LIMIT 50`).all();
    const visits = await env.DB.prepare(`SELECT v.id, v.visit_at, v.status, l.name, l.phone, l.id AS lead_id FROM sal_visits v JOIN sal_leads l ON l.id = v.lead_id WHERE v.deleted_at IS NULL AND v.status = 'scheduled' AND date(v.visit_at) >= date('now') AND date(v.visit_at) <= date('now', '+7 days')${scope.replace('project_id', 'v.project_id')}${mine.replace('assigned_to', 'l.assigned_to')} ORDER BY v.visit_at LIMIT 50`).all();
    return json({ ok: true, data: { followups: leads.results, visits: visits.results } });
  });
});

// ---------- Sales: channel partners + brokerage payable ----------
router.get('/api/sales/partners', async (req, env) => {
  return withAuth(req, env, 'sales', 'V', async (req, env) => {
    if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const rows = await env.DB.prepare(`SELECT p.*,
      (SELECT COALESCE(SUM(CAST((SELECT COALESCE(SUM(r.amount_paise + r.tds_paise), 0) FROM sal_receipts r WHERE r.booking_id = b.id AND r.reversed_at IS NULL AND r.kind = 'principal') * COALESCE(b.brokerage_bp, p.brokerage_default_bp, 0) / 10000 AS INTEGER)), 0) FROM sal_bookings b WHERE b.channel_partner_id = p.id AND b.status <> 'cancelled' AND b.deleted_at IS NULL) AS earned_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM sal_brokerage_payments x WHERE x.partner_id = p.id AND x.reversed_at IS NULL) AS paid_paise
      FROM sal_partners p WHERE p.deleted_at IS NULL ORDER BY p.firm`).all();
    return json({ ok: true, data: { partners: rows.results } });
  });
});

router.post('/api/sales/partners', async (req, env) => {
  return withAuth(req, env, 'sales', 'E', async (req, env) => {
    if (!['owner', 'pm', 'accounts'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403);
    const b = await req.json();
    if (!b.firm) return json({ ok: false, error: 'Firm name is required.' }, 400);
    const r = await env.DB.prepare('INSERT INTO sal_partners (firm, contact, phone, rera_no, brokerage_default_bp, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(b.firm, b.contact || '', b.phone || '', b.rera_no || '', Math.round(Number(b.brokerage_default_bp) || 0), nowStr()).run();
    return json({ ok: true, data: { id: r.meta.last_row_id } });
  });
});

router.post('/api/sales/partners/:id/payments', async (req, env) => {
  return withAuth(req, env, 'sales', 'A', async (req, env) => {
    const b = await req.json();
    const amount = Math.round(Number(b.amount_paise) || 0);
    if (!(amount > 0)) return json({ ok: false, error: 'Amount is required.' }, 400);
    const pid = Number(req.params.id);
    const bk = b.booking_id ? await env.DB.prepare('SELECT id FROM sal_bookings WHERE id = ? AND channel_partner_id = ?').bind(Number(b.booking_id), pid).first() : await env.DB.prepare('SELECT id FROM sal_bookings WHERE channel_partner_id = ? ORDER BY id DESC LIMIT 1').bind(pid).first();
    if (!bk) return json({ ok: false, error: 'This partner has no bookings yet.' }, 400);
    await env.DB.prepare('INSERT INTO sal_brokerage_payments (booking_id, partner_id, amount_paise, tds_paise, paid_on, mode, ref_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(bk.id, pid, amount, Math.round(Number(b.tds_paise) || 0), b.paid_on || nowStr().substring(0, 10), b.mode || 'bank', b.ref_no || '', nowStr()).run();
    return json({ ok: true });
  });
});

// ---------- Reports: lead funnel, sources, response time ----------
router.get('/api/reports/funnel', async (req, env) => {
  return withAuth(req, env, 'reports', 'V', async (req, env) => {
    if (!userCan(req.user, 'sales', 'V')) return json({ ok: false, error: 'Not allowed.' }, 403);
    const scope = req.user.scopeProject ? ' AND project_id = ' + Number(req.user.scopeProject) : '';
    const seeAll = ['owner', 'pm', 'accounts', 'viewer'].includes(req.user.role) || (await getSetting(env, 'sales.share_all_leads')) === 'on';
    const mine = seeAll ? '' : ' AND assigned_to = ' + Number(req.user.user_id);
    const status = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM sal_leads WHERE deleted_at IS NULL${scope}${mine} GROUP BY status`).all();
    const source = await env.DB.prepare(`SELECT source, COUNT(*) AS n, SUM(status = 'booked') AS booked FROM sal_leads WHERE deleted_at IS NULL${scope}${mine} GROUP BY source ORDER BY n DESC`).all();
    const resp = await env.DB.prepare(`SELECT AVG((julianday(first_contact_at) - julianday(created_at)) * 24) AS hrs, COUNT(*) AS n FROM sal_leads WHERE deleted_at IS NULL AND first_contact_at IS NOT NULL${scope}${mine}`).first();
    return json({ ok: true, data: { status: status.results, source: source.results, avg_first_response_hours: resp.hrs == null ? null : Math.round(resp.hrs * 10) / 10, responded: resp.n } });
  });
});

// ---------- Global search ----------
router.get('/api/search', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    const q = String(new URL(req.url).searchParams.get('q') || '').trim();
    if (q.length < 2) return json({ ok: true, data: { results: [] } });
    const like = '%' + q.replace(/[%_\\]/g, '') + '%';
    const user = req.user; const ids = await visibleProjectIds(env, user);
    const out = [];
    if (!ids.length) return json({ ok: true, data: { results: [] } });
    const ph = ids.map(() => '?').join(',');
    for (const r of (await env.DB.prepare(`SELECT id, name, code FROM projects WHERE deleted_at IS NULL AND id IN (${ph}) AND (name LIKE ? OR code LIKE ?) LIMIT 5`).bind(...ids, like, like).all()).results) out.push({ kind: 'Project', title: r.name, sub: r.code, route: 'projects' });
    if (userCan(user, 'drawings', 'V')) for (const r of (await env.DB.prepare(`SELECT code, title FROM drw_drawings WHERE deleted_at IS NULL AND project_id IN (${ph}) AND (code LIKE ? OR title LIKE ?) LIMIT 8`).bind(...ids, like, like).all()).results) out.push({ kind: 'Drawing', title: r.code, sub: r.title, route: 'drawings' });
    if (userCan(user, 'approvals', 'V')) for (const r of (await env.DB.prepare(`SELECT name, status FROM apr_items WHERE deleted_at IS NULL AND project_id IN (${ph}) AND name LIKE ? LIMIT 6`).bind(...ids, like).all()).results) out.push({ kind: 'Approval', title: r.name, sub: r.status, route: 'approvals' });
    if (userCan(user, 'sales', 'V')) {
      const seeAll = ['owner', 'pm'].includes(user.role) || (await getSetting(env, 'sales.share_all_leads')) === 'on';
      for (const r of (await (seeAll ? env.DB.prepare('SELECT id, name, phone FROM sal_leads WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?) LIMIT 8').bind(like, like) : env.DB.prepare('SELECT id, name, phone FROM sal_leads WHERE deleted_at IS NULL AND assigned_to = ? AND (name LIKE ? OR phone LIKE ?) LIMIT 8').bind(user.user_id, like, like)).all()).results) out.push({ kind: 'Lead', title: r.name, sub: r.phone, route: 'sales' });
      for (const r of (await env.DB.prepare(`SELECT b.customer_name, i.unit_no FROM sal_bookings b JOIN sal_inventory i ON i.id = b.unit_id WHERE b.deleted_at IS NULL AND b.project_id IN (${ph}) AND (b.customer_name LIKE ? OR i.unit_no LIKE ?) LIMIT 6`).bind(...ids, like, like).all()).results) out.push({ kind: 'Booking', title: r.customer_name, sub: 'Flat ' + r.unit_no, route: 'sales' });
    }
    if (userCan(user, 'procurement', 'V') && user.role !== 'site') {
      for (const r of (await env.DB.prepare('SELECT name, phone FROM pro_vendors WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?) LIMIT 6').bind(like, like).all()).results) out.push({ kind: 'Vendor', title: r.name, sub: r.phone || '', route: 'procurement' });
      for (const r of (await env.DB.prepare(`SELECT po_no, status FROM pro_pos WHERE deleted_at IS NULL AND project_id IN (${ph}) AND po_no LIKE ? LIMIT 6`).bind(...ids, like).all()).results) out.push({ kind: 'PO', title: r.po_no, sub: r.status, route: 'procurement' });
    }
    for (const r of (await env.DB.prepare(`SELECT title, category, module, audience FROM documents WHERE deleted_at IS NULL AND (series_key IS NULL OR series_key NOT LIKE 'brand:%') AND (project_id IS NULL OR project_id IN (${ph})) AND title LIKE ? LIMIT 8`).bind(...ids, like).all()).results) {
      if (r.module === 'brochure' && r.audience !== 'customer' && !['owner', 'pm'].includes(user.role)) continue;
      if (!docVisible(user, r)) continue;
      out.push({ kind: r.module === 'brochure' ? 'Brochure' : 'Document', title: r.title, sub: r.category || '', route: r.module === 'brochure' ? 'brochures' : 'documents' });
    }
    return json({ ok: true, data: { results: out.slice(0, 40) } });
  });
});

// ---------- Google Drive storage routing (Mode G) ----------
async function driveReady(env) {
  return (await getSettingRaw(env, 'storage.driver')) === 'gdrive' && (await getSettingRaw(env, 'storage.gdrive.status')) === 'connected';
}

async function driveToken(env, force) {
  const enc = await getSettingRaw(env, 'storage.gdrive.access_token_enc');
  const exp = await getSettingRaw(env, 'storage.gdrive.access_expires_at');
  if (!force && enc && exp && new Date(String(exp).replace(' ', 'T') + (String(exp).includes('Z') ? '' : 'Z')).getTime() > Date.now() + 60000) return decryptSetting(env, enc);
  const refreshEnc = await getSettingRaw(env, 'storage.gdrive.refresh_token_enc');
  if (!refreshEnc) throw new gdrive.GDriveError('Google Drive is not connected.', 'needs_reconnect');
  try {
    const r = await gdrive.refreshAccessToken(env, refreshEnc);
    await setSettingRaw(env, 'storage.gdrive.access_token_enc', await encryptSetting(env, r.access_token), null);
    await setSettingRaw(env, 'storage.gdrive.access_expires_at', new Date(Date.now() + (r.expires_in || 3000) * 1000).toISOString(), null);
    return r.access_token;
  } catch (e) {
    if (e.code === 'invalid_grant') await setSettingRaw(env, 'storage.gdrive.status', 'needs_reconnect', null);
    throw e;
  }
}

// Run a Drive call; on an expired token refresh once and retry.
async function withDrive(env, fn) {
  let token = await driveToken(env, false);
  try { return await fn(token); }
  catch (e) {
    if (e.code === 'invalid_token') return fn(await driveToken(env, true));
    throw e;
  }
}

async function driveFolderFor(env, token, projectId) {
  const key = 'p:' + (projectId || 0);
  const hit = await env.DB.prepare('SELECT drive_folder_id FROM drive_folders WHERE path_key = ?').bind(key).first();
  if (hit) return hit.drive_folder_id;
  const root = await getSettingRaw(env, 'storage.gdrive.root_folder_id');
  const proj = projectId ? await env.DB.prepare('SELECT code FROM projects WHERE id = ?').bind(projectId).first() : null;
  const name = proj ? proj.code : 'General';
  const found = await gdrive.findDriveFolder(env, token, name, root);
  const id = (found.files && found.files[0]) ? found.files[0].id : (await gdrive.createDriveFolder(env, token, name, root)).id;
  await env.DB.prepare('INSERT OR IGNORE INTO drive_folders (path_key, project_id, drive_folder_id) VALUES (?, ?, ?)').bind(key, projectId || null, id).run();
  return id;
}

async function driveUpload(env, file, projectId) {
  const buf = await file.arrayBuffer();
  return withDrive(env, async (token) => {
    const folder = await driveFolderFor(env, token, projectId);
    const session = await gdrive.resumableUploadInit(env, token, file.name || 'file', file.type, folder, buf.byteLength);
    const meta = await gdrive.resumableUploadPut(env, token, session, buf, buf.byteLength, file.type);
    return { fileId: meta.id, md5: meta.md5Checksum || null, folder };
  });
}

async function driveResponse(env, doc, req, disposition) {
  let upstream;
  try {
    upstream = await withDrive(env, (token) => gdrive.getDriveFile(env, token, doc.drive_file_id, req.headers.get('range')));
  } catch (e) {
    return new Response('Files from Google Drive are paused right now. Ask the Owner to reconnect Google Drive.', { status: 503 });
  }
  const h = new Headers({
    'Content-Type': doc.mime || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  });
  for (const k of ['content-length', 'content-range', 'accept-ranges']) if (upstream.headers.get(k)) h.set(k, upstream.headers.get(k));
  return new Response(upstream.body, { status: upstream.status, headers: h });
}


registerFinance(router, { withAuth, json, serverError, visibleProjectIds, userCan, getSetting, nowStr, encryptSetting, decryptSetting, printBrand });
registerMfa(router, { json, serverError, getCurrentUser, getSetting, nowStr, encryptSetting, decryptSetting, checkRateLimit, createSession, setSessionCookie, safeUser, withAuth, clientIp });
registerImporter(router, { withAuth, json, serverError, visibleProjectIds, nowStr, encryptSetting });
registerPrivacy(router, { withAuth, json, serverError, nowStr, decryptSetting });
registerReports(router, { withAuth, json, serverError, visibleProjectIds, getSetting, nowStr });
registerSalesOps(router, { withAuth, json, serverError, visibleProjectIds, userCan, getSetting, nowStr, encryptSetting, clientIp, checkRateLimit });

// ---------- Branding routes ----------
router.get('/api/branding', async (req, env) => {
  return withAuth(req, env, 'branding', 'V', async (req, env) => {
    try {
      const u = new URL(req.url);
      const brandId = Number(u.searchParams.get('brand_id')) || (await defaultBrandId(env));
      const pid = Number(u.searchParams.get('override_project_id')) || null;
      const row = pid
        ? await env.DB.prepare('SELECT * FROM brand_profiles WHERE project_id = ?').bind(pid).first()
        : await env.DB.prepare('SELECT * FROM brand_profiles WHERE brand_id = ? AND project_id IS NULL').bind(brandId).first();
      const br = row ? { ...row } : { brand_id: brandId };
      br.brand_id = brandId;
      const last4 = async (enc) => { try { const v = enc ? await decryptSetting(env, enc) : ''; return v ? '••••' + v.slice(-4) : ''; } catch (e) { return ''; } };
      // PAN and bank account number: only the Owner sees even the masked form (§4.5); ciphertext never leaves the server.
      br.pan_masked = req.user.role === 'owner' ? await last4(br.pan_enc) : null;
      br.bank_account_masked = req.user.role === 'owner' ? await last4(br.bank_account_enc) : null;
      delete br.pan_enc; delete br.bank_account_enc;
      if (!['owner', 'accounts'].includes(req.user.role)) { br.bank_name = ''; br.bank_branch = ''; br.bank_ifsc = ''; br.bank_account_name = ''; }
      br.pictures = await brandPictures(env, brandId);
      return json({ ok: true, data: { branding: row ? br : { brand_id: brandId, pictures: br.pictures } } });
    } catch (e) {
      return serverError(e, 'branding');
    }
  });
});

// ---------- Brands (several brands in one CRM) ----------
router.get('/api/brands', async (req, env) => {
  return withAuth(req, env, 'branding', 'V', async (req, env) => {
    const rows = await env.DB.prepare(`SELECT b.id, b.name, b.is_default, (SELECT COUNT(*) FROM projects p WHERE p.brand_id = b.id AND p.deleted_at IS NULL) AS projects FROM brands b WHERE b.deleted_at IS NULL ORDER BY b.is_default DESC, b.name`).all();
    return json({ ok: true, data: { brands: rows.results } });
  });
});

router.post('/api/brands', async (req, env) => {
  return withAuth(req, env, 'branding', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can add a brand.' }, 403);
    const name = String((await req.json()).name || '').trim();
    if (!name) return json({ ok: false, error: 'Brand name is required.' }, 400);
    try {
      const r = await env.DB.prepare('INSERT INTO brands (name, created_at) VALUES (?, ?)').bind(name, nowStr()).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'create', 'brands', ?, ?, ?)`).bind(req.user.user_id, r.meta.last_row_id, `Added brand ${name}`, nowStr()).run();
      return json({ ok: true, data: { id: r.meta.last_row_id } });
    } catch (e) {
      return json({ ok: false, error: /UNIQUE/.test(e.message) ? 'A brand with that name already exists.' : 'brand-create: ' + e.message }, /UNIQUE/.test(e.message) ? 400 : 500);
    }
  });
});

router.put('/api/brands/:id', async (req, env) => {
  return withAuth(req, env, 'branding', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can change a brand.' }, 403);
    const id = Number(req.params.id);
    const b = await req.json();
    const cur = await env.DB.prepare('SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!cur) return json({ ok: false, error: 'Brand not found.' }, 404);
    const stmts = [];
    if (b.name) stmts.push(env.DB.prepare('UPDATE brands SET name = ? WHERE id = ?').bind(String(b.name).trim(), id));
    if (b.is_default) { stmts.push(env.DB.prepare('UPDATE brands SET is_default = 0 WHERE id != ?').bind(id)); stmts.push(env.DB.prepare('UPDATE brands SET is_default = 1 WHERE id = ?').bind(id)); }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true });
  });
});

router.delete('/api/brands/:id', async (req, env) => {
  return withAuth(req, env, 'branding', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can remove a brand.' }, 403);
    const id = Number(req.params.id);
    const cur = await env.DB.prepare('SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!cur) return json({ ok: false, error: 'Brand not found.' }, 404);
    if (cur.is_default) return json({ ok: false, error: 'The default brand cannot be removed. Make another brand the default first.' }, 400);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE brand_id = ? AND deleted_at IS NULL').bind(id).first();
    if (Number(n.n) > 0) return json({ ok: false, error: 'Move this brand\'s projects to another brand first.' }, 400);
    await env.DB.prepare('UPDATE brands SET deleted_at = ? WHERE id = ?').bind(nowStr(), id).run();
    return json({ ok: true });
  });
});

router.post('/api/branding', async (req, env) => {
  return withAuth(req, env, 'branding', 'E', async (req, env) => {
    try {
      const user = req.user;
      const body = await req.json();
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const fields = ['legal_name', 'trade_name', 'tagline', 'address', 'phone', 'email', 'website', 'gstin', 'cin_or_llpin', 'promoter_rera_ref',
        'bank_account_name', 'bank_name', 'bank_branch', 'bank_ifsc', 'signatory_name', 'signatory_title',
        'footer_text', 'wa_intro_text', 'colour_primary', 'colour_secondary', 'colour_accent', 'letterhead_mode',
        'margin_top_mm', 'margin_bottom_mm', 'margin_side_mm'];
      const defaults = { colour_primary: '#1d4ed8', letterhead_mode: 'generated', margin_top_mm: 45, margin_bottom_mm: 30, margin_side_mm: 20 };
      for (const cf of ['colour_primary', 'colour_secondary', 'colour_accent']) {
        if (body[cf] && !/^#[0-9a-fA-F]{3,8}$/.test(body[cf])) return json({ ok: false, error: 'Colours must look like #1d4ed8.' }, 400);
      }
      const vals = fields.map((f) => (body[f] !== undefined && body[f] !== '' ? body[f] : (defaults[f] ?? '')));
      const projectId = body.project_id ? Number(body.project_id) : null;
      const brandId = projectId ? await brandIdForProject(env, projectId) : (Number(body.brand_id) || (await defaultBrandId(env)));
      if (!(await env.DB.prepare('SELECT id FROM brands WHERE id = ? AND deleted_at IS NULL').bind(brandId).first())) return json({ ok: false, error: 'Unknown brand.' }, 400);
      const existing = projectId
        ? await env.DB.prepare('SELECT id FROM brand_profiles WHERE project_id = ?').bind(projectId).first()
        : await env.DB.prepare('SELECT id FROM brand_profiles WHERE brand_id = ? AND project_id IS NULL').bind(brandId).first();
      if (!['generated', 'bands', 'image'].includes(vals[fields.indexOf('letterhead_mode')])) return json({ ok: false, error: 'Unknown letterhead style.' }, 400);
      if (!userCan(user, 'branding', 'E')) return json({ ok: false, error: 'Not allowed.' }, 403);
      const secret = {};
      if (body.pan) secret.pan_enc = await encryptSetting(env, String(body.pan).trim().toUpperCase());
      if (body.bank_account) secret.bank_account_enc = await encryptSetting(env, String(body.bank_account).replace(/\s+/g, ''));
      const sk = Object.keys(secret);
      if (existing) {
        if (sk.length) await env.DB.prepare(`UPDATE brand_profiles SET ${sk.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).bind(...sk.map((k) => secret[k]), existing.id).run();
        await env.DB.prepare(`UPDATE brand_profiles SET ${fields.map((f) => f + ' = ?').join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`)
          .bind(...vals, user.user_id, now, existing.id).run();
      } else {
        await env.DB.prepare(`INSERT INTO brand_profiles (project_id, brand_id, ${[...fields, ...sk].join(', ')}, updated_by, updated_at, created_at) VALUES (?, ?, ${[...fields, ...sk].map(() => '?').join(', ')}, ?, ?, ?)`)
          .bind(projectId, brandId, ...vals, ...sk.map((k) => secret[k]), user.user_id, now, now).run();
      }
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'brand_profiles', ?, ?, ?)`).bind(user.user_id, 'create', 0, 'Updated company branding', now).run();
      return json({ ok: true });
    } catch (e) {
      return serverError(e, 'branding-set');
    }
  });
});

// ---------- Share links routes ----------
router.get('/api/share-links', async (req, env) => {
  return withAuth(req, env, 'share_links', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT sl.id, sl.recipient_label, sl.expires_at, sl.max_views, sl.view_count, sl.last_viewed_at, sl.created_at, d.title FROM share_links sl JOIN documents d ON d.id = sl.document_id WHERE sl.revoked_at IS NULL ORDER BY sl.created_at DESC LIMIT 50').all();
      return json({ ok: true, data: { links: rows.results } });
    } catch (e) {
      return serverError(e, 'share-list');
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
      const doc = await env.DB.prepare('SELECT id, title, project_id, audience FROM documents WHERE id = ? AND deleted_at IS NULL').bind(Number(document_id)).first();
      if (!doc) return json({ ok: false, error: 'Document not found.' }, 404);
      if (doc.project_id && !(await visibleProjectIds(env, user)).includes(doc.project_id)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (doc.audience !== 'customer') return json({ ok: false, error: 'This file is internal. Only files marked "can be shared with customers" can be sent.' }, 400);
      const days = Number(await getSetting(env, 'share.default_expiry_days')) || 14;
      const expiry = expires_at || new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').substring(0, 19);
      const token = crypto.getRandomValues(new Uint8Array(32));
      const tokenHash = await crypto.subtle.digest('SHA-256', token);
      const tokenB64 = bytesToBase64(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const hashB64 = bytesToBase64(new Uint8Array(tokenHash));
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const result = await env.DB.prepare(`INSERT INTO share_links (token_hash, document_id, project_id, recipient_label, created_by, expires_at, max_views, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(hashB64, doc.id, doc.project_id, recipient_label || '', user.user_id, expiry, max_views || null, now).run();
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'share_links', ?, ?, ?)`).bind(user.user_id, 'create', result.meta.last_row_id, `Created share link`, now).run();
      return json({ ok: true, data: { token: tokenB64, link: `/s/${tokenB64}` } });
    } catch (e) {
      return serverError(e, 'share-create');
    }
  });
});

router.post('/api/share-links/:id/revoke', async (req, env) => {
  return withAuth(req, env, 'share_links', 'E', async (req, env) => {
    const id = Number(req.params.id);
    await env.DB.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL').bind(nowStr(), req.user.user_id, id).run();
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'revoke', 'share_links', ?, 'Revoked a customer link', ?)`).bind(req.user.user_id, id, nowStr()).run();
    return json({ ok: true });
  });
});

// ---------- Email routes ----------
router.get('/api/email/settings', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    const c = await getEmailConfig(env);
    return json({ ok: true, data: { provider: c.provider, host: c.host, port: c.port, security: c.security, username: c.username, from_name: c.fromName, from_email: c.fromEmail,
      password_set: !!c.password, brevo_key_set: !!c.brevoKey, otp_enabled: (await getSetting(env, 'email.otp_enabled')) === 'on' } });
  });
});

router.post('/api/email/settings', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const b = await req.json();
    const uid = req.user.user_id;
    const set = (k, v) => setSetting(env, k, v, uid);
    if (!['smtp', 'brevo_api'].includes(b.provider || 'smtp')) return json({ ok: false, error: 'Unknown provider.' }, 400);
    await set('email.provider', b.provider || 'smtp');
    await set('smtp.host', String(b.host || '').trim());
    await set('smtp.port', Number(b.port) || 465);
    await set('smtp.security', b.security === 'starttls' ? 'starttls' : 'ssl');
    await set('smtp.username', String(b.username || '').trim());
    await set('smtp.from_name', String(b.from_name || 'NirmaanCRM').trim());
    await set('smtp.from_email', String(b.from_email || '').trim());
    if (b.password) await set('smtp.password', String(b.password));       // stored AES-GCM encrypted with APP_KEY
    if (b.brevo_key) await set('brevo.api_key', String(b.brevo_key));
    await set('email.otp_enabled', 'off');                                // must pass a fresh test before codes are offered
    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'update', 'settings', 0, 'Changed email settings', ?)`).bind(uid, nowStr()).run();
    return json({ ok: true });
  });
});

// Sends a test message to the logged-in Owner only (never to an arbitrary address).
router.post('/api/email/test', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const result = await sendMail(env, req.user.email, 'NirmaanCRM test email', '<h2>It works</h2><p>This is a test email from your NirmaanCRM system.</p>', { template: 'test' });
    if (result.sent) await setSetting(env, 'email.otp_enabled', 'on', req.user.user_id);
    return json({ ok: true, data: { sent: result.sent, error: result.error, to: req.user.email } });
  });
});

router.post('/api/email/digest-now', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    const r = await sendDigest(env, req.user.email);
    return json({ ok: true, data: { sent: r.sent, error: r.error } });
  });
});

router.post('/api/email/retry', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    await retryFailedEmails(env);
    return json({ ok: true });
  });
});

router.get('/api/email/log', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'V', async (req, env) => {
    try {
      const rows = await env.DB.prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 50').all();
      return json({ ok: true, data: { emails: rows.results } });
    } catch (e) {
      return serverError(e, 'email-log');
    }
  });
});

router.get('/api/auth/methods', async (req, env) => json({ ok: true, data: { otp: (await getSetting(env, 'email.otp_enabled')) === 'on' } }));

router.post('/api/auth/otp/send', async (req, env) => {
  try {
    if ((await getSetting(env, 'email.otp_enabled')) !== 'on') return json({ ok: false, error: 'Login by email code is not switched on.' }, 400);
    const email = String((await req.json()).email || '').trim().toLowerCase();
    if (!email) return json({ ok: false, error: 'Please enter your email.' }, 400);
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    const rl1 = await checkRateLimit(env, `otp-send:${email}`, 3, 15);
    const rl2 = await checkRateLimit(env, `otp-send-ip:${ip}`, 10, 15);
    if (!rl1.allowed || !rl2.allowed) return json({ ok: false, error: 'Too many requests. Try again in 15 minutes.' }, 429);
    const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE lower(email) = ? AND active = 1 AND deleted_at IS NULL').bind(email).first();
    if (user) {
      const code = await createOtpCode(env, user.email);
      await sendMail(env, user.email, 'Your NirmaanCRM login code', `<h2>Your login code</h2><p style="font-size:28px;letter-spacing:4px"><b>${code}</b></p><p>It works for 10 minutes. If you did not ask for it, ignore this email.</p>`, { template: 'otp' });
    }
    // Same answer whether or not the account exists.
    return json({ ok: true, data: { message: 'If that email belongs to an active account, a code is on its way.' } });
  } catch (e) {
    return json({ ok: false, error: 'Could not send the code.' }, 500);
  }
});

router.post('/api/auth/otp/verify', async (req, env) => {
  try {
    const b = await req.json();
    const email = String(b.email || '').trim().toLowerCase();
    if (!email || !b.code) return json({ ok: false, error: 'Email and code are required.' }, 400);
    const rl = await checkRateLimit(env, `otp-verify:${email}`, 10, 15);
    if (!rl.allowed) return json({ ok: false, error: 'Too many tries. Try again in 15 minutes.' }, 429);
    const u = await env.DB.prepare('SELECT email FROM users WHERE lower(email) = ? AND deleted_at IS NULL').bind(email).first();
    const result = u ? await verifyOtpCode(env, u.email, b.code) : { ok: false, error: 'That code is not right.' };
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    const user = result.user;
    const early = await mfaChallenge(env, user.id);
    if (early) return json({ ok: true, data: { mfa_required: true, mfa_token: early } });
    const session = await createSession(env, user.id, req.headers.get('user-agent') || '');
    await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowStr(), user.id).run();
    const res = json({ ok: true, data: { user: safeUser({ user_id: user.id, ...user }), must_change_password: !!user.must_change_password } });
    setSessionCookie(res, session.token, session.expiresAt);
    return res;
  } catch (e) {
    return json({ ok: false, error: 'Could not check the code.' }, 500);
  }
});

// ---------- Document file upload/download ----------
router.post('/api/files/upload', async (req, env) => {
  return withAuth(req, env, 'projects', 'V', async (req, env) => {
    try {
      const user = req.user;
      const formData = await req.formData();
      const modForPerm = formData.get('module');
      const mayUpload = userCan(user, 'projects', 'C') || (['site', 'procurement'].includes(modForPerm) && userCan(user, modForPerm, 'C') && !formData.get('series_key'));
      if (!mayUpload) return json({ ok: false, error: 'Not allowed.' }, 403);
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
      if (seriesKey && String(seriesKey).startsWith('brand:')) {
        if (!userCan(user, 'branding', 'E')) return json({ ok: false, error: 'Not allowed.' }, 403);
        const m = /^brand:(\d+):(logo|logo_icon|signature|stamp|letterhead|header|footer|favicon|pwa_192|pwa_512)$/.exec(String(seriesKey));
        if (!m || !(await env.DB.prepare('SELECT id FROM brands WHERE id = ? AND deleted_at IS NULL').bind(Number(m[1])).first())) return json({ ok: false, error: 'Unknown brand picture.' }, 400);
      }

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

      const maxMb = Number(await getSetting(env, 'files.brochure_max_mb')) || 25;
      if (file.size > maxMb * 1048576) return json({ ok: false, error: `This file is bigger than the ${maxMb} MB limit.` }, 413);
      let driveInfo = null;
      if (await driveReady(env) && !(seriesKey && String(seriesKey).startsWith('brand:'))) {
        try { driveInfo = await driveUpload(env, file, projectId ? Number(projectId) : null); }
        catch (e) { if (file.size > 1500000) return json({ ok: false, error: 'Google Drive is paused right now (ask the Owner to reconnect it). Files over 1.5 MB cannot be saved until then.' }, 503); }
      }
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      if (!sniffOk(file.type, head, new Uint8Array(await file.slice(0, 1024).arrayBuffer()))) {
        return json({ ok: false, error: 'The file contents do not match its type. Re-save it as a normal PDF, JPG or PNG and try again.' }, 400);
      }
      const MAX_DB_BYTES = 1500000; // D1 rows top out near 2 MB; bigger files need Google Drive or a link
      if (!driveInfo && file.size > MAX_DB_BYTES) {
        return json({ ok: false, error: `This file is ${(file.size / 1048576).toFixed(1)} MB. Files stored in the database can be at most 1.5 MB. Photos are shrunk automatically; for large PDFs connect Google Drive or add a link instead.` }, 413);
      }
      const sizeBytes = file.size;
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      let blobId = null;
      if (!driveInfo) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const blobResult = await env.DB.prepare(`INSERT INTO file_blobs (mime, size_bytes, data, created_at) VALUES (?, ?, ?, ?)`).bind(file.type, sizeBytes, bytes, now).run();
        blobId = blobResult.meta.last_row_id;
      }

      // A new upload in an existing series becomes the latest version; older ones stay as history.
      let version = 1;
      let supersedes = null;
      if (seriesKey) {
        const prev = await env.DB.prepare('SELECT id, version FROM documents WHERE series_key = ? AND COALESCE(project_id, 0) = COALESCE(?, 0) AND is_latest = 1 AND deleted_at IS NULL').bind(seriesKey, projectId ? Number(projectId) : null).first();
        if (prev) {
          await env.DB.prepare('UPDATE documents SET is_latest = 0 WHERE id = ?').bind(prev.id).run();
          version = Number(prev.version) + 1; supersedes = prev.id;
        }
      }
      const docResult = await env.DB.prepare(`
        INSERT INTO documents (project_id, title, category, kind, module, entity, entity_id, mime, size_bytes, store, blob_id, drive_file_id, drive_folder_id, md5, audience, language, series_key, version, is_latest, supersedes_id, uploaded_by, created_at)
        VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).bind(projectId || null, title, category, module || null, entity || null, entityId || null, file.type, sizeBytes, driveInfo ? 'gdrive' : 'd1', blobId, driveInfo ? driveInfo.fileId : null, driveInfo ? driveInfo.folder : null, driveInfo ? driveInfo.md5 : null, audience, language, seriesKey, version, supersedes, user.user_id, now).run();

      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, 'documents', ?, ?, ?)`).bind(user.user_id, 'create', docResult.meta.last_row_id, `Uploaded file "${title}"`, now).run();

      return json({ ok: true, data: { id: docResult.meta.last_row_id } });
    } catch (e) {
      return serverError(e, 'file-upload');
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

      if (doc.module === 'brochure' && doc.audience !== 'customer' && !['owner', 'pm'].includes(req.user.role)) return json({ ok: false, error: 'Not allowed.' }, 403); // internal brochures stay internal
      if (!docVisible(req.user, doc)) return json({ ok: false, error: 'Not allowed.' }, 403);
      if (doc.store === 'gdrive') return driveResponse(env, doc, req, 'attachment');
      if (doc.store === 'd1' || doc.store === null) {
        const blob = await env.DB.prepare('SELECT * FROM file_blobs WHERE id = ?').bind(doc.blob_id).first();
        if (!blob) return json({ ok: false, error: 'File data not found.' }, 404);
        return new Response(blobBytes(blob.data), {
          headers: {
            'Content-Type': doc.mime || 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
          },
        });
      }

      return json({ ok: false, error: 'File storage mode not yet implemented.' }, 501);
    } catch (e) {
      return serverError(e, 'file-download');
    }
  });
});

// ---------- Branding images (public) ----------
router.get('/brand/logo.png', async (req, env) => {
  return serveBrandingFile(env, 'logo');
});

router.get('/brand/logo_icon.png', async (req, env) => {
  return serveBrandingFile(env, 'logo_icon');
});

router.get('/brand/pwa_192.png', async (req, env) => {
  return serveBrandingFile(env, 'pwa_192');
});

router.get('/brand/pwa_512.png', async (req, env) => {
  return serveBrandingFile(env, 'pwa_512');
});

router.get('/brand/favicon.png', async (req, env) => {
  return serveBrandingFile(env, 'favicon');
});

router.get('/brand/theme.css', async (req, env) => {
  try {
    const row = await env.DB.prepare('SELECT * FROM brand_profiles WHERE project_id IS NULL AND brand_id = ?').bind(await defaultBrandId(env)).first();
    if (!row) return new Response(':root { --brand: #1d4ed8; }', { headers: { 'Content-Type': 'text/css' } });
    const css = `:root { --brand: ${row.colour_primary || '#1d4ed8'}; --brand-secondary: ${row.colour_secondary || ''}; --brand-accent: ${row.colour_accent || ''}; }`;
    return new Response(css, { headers: { 'Content-Type': 'text/css' } });
  } catch (e) {
    return new Response(':root { --brand: #1d4ed8; }', { headers: { 'Content-Type': 'text/css' } });
  }
});

async function serveBrandingFile(env, kind) {
  try {
    const seriesKey = `brand:${await defaultBrandId(env)}:${kind}`;
    const row = await env.DB.prepare(`
      SELECT d.*, fb.data, fb.mime FROM documents d
      JOIN file_blobs fb ON fb.id = d.blob_id
      WHERE d.series_key = ? AND d.is_latest = 1 AND d.deleted_at IS NULL
      ORDER BY d.version DESC LIMIT 1
    `).bind(seriesKey).first();
    if (!row || !row.data) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(blobBytes(row.data), {
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
      if (!userCan(user, 'sales', 'V') && !userCan(user, 'procurement', 'V')) {
        return json({ ok: false, error: 'Not allowed.' }, 403);
      }
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) {
        return json({ ok: true, data: { moneyIn: 0, overdueReceivables: { total: 0, cnt: 0 }, billsDue: { total: 0, cnt: 0 }, posPending: 0, dprsYesterday: 0, highSnags: 0, newLeads: 0 } });
      }
      const inList = '(' + ids.map(() => '?').join(',') + ')';
      const params = ids;

      // Money in - collected this month (non-reversed receipts)
      const collected = await env.DB.prepare(
        `SELECT COALESCE(SUM(r.amount_paise + r.tds_paise), 0) as total FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id
         WHERE r.reversed_at IS NULL AND b.project_id IN ${inList} AND strftime('%Y-%m', r.received_on) = strftime('%Y-%m', 'now')`
      ).bind(...params).first();

      // Overdue receivables
      const overdue = await env.DB.prepare(
        `SELECT COALESCE(SUM(d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise), 0) as total, COUNT(*) as cnt FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id
         WHERE b.project_id IN ${inList} AND d.status NOT IN ('paid', 'cancelled') AND d.due_date < date('now')`
      ).bind(...params).first();

      // Bills due <=7 days
      const billsDue = await env.DB.prepare(
        `SELECT COALESCE(SUM(bl.amount_paise), 0) as total, COUNT(*) as cnt FROM pro_bills bl JOIN pro_pos p ON p.id = bl.po_id
         WHERE p.project_id IN ${inList} AND bl.status NOT IN ('paid', 'cancelled') AND bl.due_date <= date('now', '+7 days')`
      ).bind(...params).first();

      // POs pending approval
      const posPending = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM pro_pos WHERE deleted_at IS NULL AND project_id IN ${inList} AND status = 'pending_approval'`
      ).bind(...params).first();

      // Site reports yesterday (IST)
      const yesterday = new Date(Date.now() + 19800000 - 86400000).toISOString().substring(0, 10);
      const dprsYesterday = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM site_dprs WHERE deleted_at IS NULL AND project_id IN ${inList} AND report_date = ?`
      ).bind(...params, yesterday).first();

      // Open high snags
      const highSnags = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM site_snags WHERE deleted_at IS NULL AND project_id IN ${inList} AND severity = 'high' AND status != 'verified'`
      ).bind(...params).first();

      // New leads this week
      const newLeads = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM sal_leads WHERE deleted_at IS NULL AND project_id IN ${inList} AND status = 'new' AND date(created_at) >= date('now', '-7 days')`
      ).bind(...params).first();

      const expiring = await env.DB.prepare(`SELECT COUNT(*) AS n FROM apr_items WHERE deleted_at IS NULL AND project_id IN ${inList} AND valid_till IS NOT NULL AND status NOT IN ('na') AND date(valid_till) <= date('now', '+30 days')`).bind(...params).first();
      const staleQueries = await env.DB.prepare(`SELECT COUNT(*) AS n FROM apr_items i WHERE i.deleted_at IS NULL AND i.project_id IN ${inList} AND i.status = 'query' AND COALESCE((SELECT MAX(created_at) FROM apr_events e WHERE e.item_id = i.id), i.created_at) < datetime('now', '-5 days')`).bind(...params).first();
      const waiting = await env.DB.prepare(`SELECT COUNT(*) AS n FROM drw_drawings d WHERE d.deleted_at IS NULL AND d.project_id IN ${inList} AND d.waiting_consultant = 1 AND NOT EXISTS (SELECT 1 FROM drw_revisions r WHERE r.drawing_id = d.id AND r.status = 'ifc')`).bind(...params).first();
      const followupsDue = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sal_leads WHERE deleted_at IS NULL AND project_id IN ${inList} AND status NOT IN ('booked','lost') AND next_followup_at IS NOT NULL AND date(next_followup_at) <= date('now', '+5 hours', '+30 minutes')`).bind(...params).first();
      return json({
        ok: true,
        data: {
          approvalsExpiring: Number(expiring?.n || 0), staleQueries: Number(staleQueries?.n || 0), waitingConsultant: Number(waiting?.n || 0), followupsDue: Number(followupsDue?.n || 0),
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
      return serverError(e, 'dashboard');
    }
  });
});

// ---------- Reports routes ----------
router.get('/api/reports/receivables', async (req, env) => {
  return withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      const user = req.user;
      const ids = await visibleProjectIds(env, user);
      if (ids.length === 0) return json({ ok: true, data: { rows: [] } });
      const rows = await env.DB.prepare(
        `SELECT b.customer_name, b.agreed_price_paise, COALESCE(SUM(r.amount_paise + r.tds_paise), 0) as collected,
         (b.agreed_price_paise - COALESCE(SUM(r.amount_paise + r.tds_paise), 0)) as balance,
         b.status
         FROM sal_bookings b
         LEFT JOIN sal_receipts r ON r.booking_id = b.id AND r.reversed_at IS NULL AND r.kind = 'principal'
         WHERE b.deleted_at IS NULL AND b.project_id IN (${ids.map(() => '?').join(',')})
         GROUP BY b.id ORDER BY b.created_at DESC LIMIT 200`
      ).bind(...ids).all();
      return json({ ok: true, data: { rows: rows.results } });
    } catch (e) {
      return serverError(e, 'receivables');
    }
  });
});

router.get('/api/reports/purchase-register', async (req, env) => {
  return withAuth(req, env, 'reports', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user);
      if (ids.length === 0) return json({ ok: true, data: { rows: [] } });
      const rows = await env.DB.prepare(
        `SELECT p.po_no, v.name as vendor, p.amount_paise, p.total_paise, p.status, p.created_at
         FROM pro_pos p
         JOIN pro_vendors v ON v.id = p.vendor_id
         WHERE p.deleted_at IS NULL AND p.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.created_at DESC LIMIT 200`
      ).bind(...ids).all();
      return json({ ok: true, data: { rows: rows.results } });
    } catch (e) {
      return serverError(e, 'purchase');
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
      const redirectUri = `${publicBase(env, req)}/api/storage/google/callback`;
      const { authUrl, state, verifier, expiresAt, stateHash } = await gdrive.makeOAuthStartAsync(env, redirectUri, user.user_id);

      // Store state in oauth_states (single-use, CSRF + PKCE protection)
      const verifierEnc = await encryptSetting(env, verifier);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await env.DB.prepare(
        'INSERT INTO oauth_states (state_hash, user_id, verifier_enc, purpose, expires_at, created_at) VALUES (?, ?, ?, \'gdrive\', ?, ?)'
      ).bind(stateHash, user.user_id, verifierEnc, expiresAt, now).run();

      return json({ ok: true, data: { authUrl } });
    } catch (e) {
      return serverError(e, 'gdrive-start');
    }
  });
});

function driveResultPage(ok, msg) {
  const e = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;text-align:center">
    <h2>${ok ? 'Google Drive connected' : 'Google Drive was not connected'}</h2><p>${e(msg)}</p><p><a href="/#storage">Back to NirmaanCRM</a></p></body>`;
}

router.get('/api/storage/google/callback', async (req, env) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(driveResultPage(false, 'Google said: ' + error + '. If it says access_denied, add your Gmail under Test users on the OAuth consent screen.'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (!code || !state) {
      return new Response('Missing sign-in parameters.', { status: 400, headers: { 'Content-Type': 'text/html' } });
    }

    const stateHash = base64urlEncode(await sha256Bytes(new TextEncoder().encode(state)));
    const row = await env.DB.prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND purpose = \'gdrive\' AND used_at IS NULL AND expires_at > datetime(\'now\')').bind(stateHash).first();
    if (!row) {
      return new Response(driveResultPage(false, 'This sign-in link is no longer valid. Go back and press Connect again.'), { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').bind(row.user_id).first();
    if (!user || user.role !== 'owner') {
      return new Response('Only the Owner can connect Google Drive.', { status: 403, headers: { 'Content-Type': 'text/html' } });
    }

    const verifier = await decryptSetting(env, row.verifier_enc);
    const redirectUri = `${publicBase(env, req)}/api/storage/google/callback`;

    const tokens = await gdrive.exchangeCode(env, code, verifier, redirectUri);

    // Get user info from Drive about
    let accountEmail = '';
    try {
      const about = await gdrive.getDriveAbout(env, tokens.access_token);
      accountEmail = (about.user && about.user.emailAddress) || about.emailAddress || '';
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
    } catch (e) {
      return new Response(driveResultPage(false, 'Connected to Google, but the NirmaanCRM folder could not be created: ' + e.message), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (!rootFolderId) return new Response(driveResultPage(false, 'Google did not return a folder id.'), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    // Mark state as used
    await env.DB.prepare('UPDATE oauth_states SET used_at = ? WHERE state_hash = ?').bind(now, row.state_hash).run();

    // Save settings
    await setSettingRaw(env, 'storage.gdrive.status', 'connected', user.id);
    if (refreshTokenEnc) await setSettingRaw(env, 'storage.gdrive.refresh_token_enc', refreshTokenEnc, user.id);
    await setSettingRaw(env, 'storage.gdrive.access_token_enc', accessTokenEnc, user.id);
    await setSettingRaw(env, 'storage.gdrive.access_expires_at', accessExpiresAt, user.id);
    if (accountEmail) await setSettingRaw(env, 'storage.gdrive.account_email', accountEmail, user.id);
    if (rootFolderId) await setSettingRaw(env, 'storage.gdrive.root_folder_id', rootFolderId, user.id);
    await setSettingRaw(env, 'storage.gdrive.connected_at', now, user.id);
    await setSettingRaw(env, 'storage.driver', 'gdrive', user.id);

    await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'connect', 'storage', 0, 'Google Drive connected', ?)`).bind(user.id, now).run();

    return Response.redirect(`${publicBase(env, req)}/#drive=ok`, 302);
  } catch (e) {
    return new Response(driveResultPage(false, 'Sign-in failed: ' + e.message), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
});

// Owner-only self-test: uploads a tiny file to Drive, reads it back, deletes it. Reports the exact failure if any.
router.post('/api/storage/test', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    if (req.user.role !== 'owner') return json({ ok: false, error: 'Only the Owner can test Google Drive.' }, 403);
    if ((await getSettingRaw(env, 'storage.gdrive.status')) !== 'connected') return json({ ok: false, error: 'Google Drive is not connected.' }, 400);
    const steps = [];
    try {
      const file = new File([`NirmaanCRM test ${new Date().toISOString()}`], 'nirmaan-test.txt', { type: 'text/plain' });
      const up = await driveUpload(env, file, null);
      steps.push('Uploaded a test file');
      const back = await withDrive(env, (t) => gdrive.getDriveFile(env, t, up.fileId, null));
      await back.text();
      steps.push('Read it back');
      await withDrive(env, (t) => gdrive.deleteDriveFile(env, t, up.fileId));
      steps.push('Deleted it');
      return json({ ok: true, data: { steps } });
    } catch (e) {
      return json({ ok: false, error: `${steps.length ? 'After "' + steps[steps.length - 1] + '": ' : ''}${e.message}`.slice(0, 400), data: { steps } }, 502);
    }
  });
});

router.post('/api/storage/google/disconnect', async (req, env) => {
  return withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const user = req.user;
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await setSettingRaw(env, 'storage.gdrive.status', 'not_connected', user.user_id);
      await setSettingRaw(env, 'storage.gdrive.refresh_token_enc', null, user.user_id);
      await setSettingRaw(env, 'storage.gdrive.access_token_enc', null, user.user_id);
      await env.DB.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'disconnect', 'storage', 0, 'Google Drive disconnected', ?)`).bind(user.user_id, now).run();
      return json({ ok: true });
    } catch (e) {
      return serverError(e, 'gdrive-disconnect');
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
      return serverError(e, 'storage-driver');
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
      return serverError(e, 'storage-status');
    }
  });
});

// ---------- Customer share link landing page ----------
router.get('/s/:token', async (req, env) => {
  return env.ASSETS.fetch(new Request(`${new URL(req.url).origin}/s`, { method: 'GET', headers: req.headers }));
});

// ---------- Customer share link file download ----------
router.get('/s/:token/file', async (req, env) => {
  try {
    const rl = await checkRateLimit(env, `share-ip:${clientIp(req)}`, 60, 10);
    if (!rl.allowed) return new Response('Too many requests. Try again in a few minutes.', { status: 429 });
    const tokenB64 = req.params.token;
    const std = tokenB64.replace(/-/g, '+').replace(/_/g, '/');
    const tokenBytes = Uint8Array.from(atob(std + '='.repeat((4 - std.length % 4) % 4)), c => c.charCodeAt(0));
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

    if (doc.store === 'gdrive') return driveResponse(env, doc, req, 'inline');
    if (doc.store === 'd1' || doc.store === null) {
      const blob = await env.DB.prepare('SELECT * FROM file_blobs WHERE id = ?').bind(doc.blob_id).first();
      if (!blob) return new Response('File data not found.', { status: 410 });
      return new Response(blobBytes(blob.data), {
        headers: {
          'Content-Type': doc.mime || 'application/octet-stream',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.title)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response('File storage mode not yet implemented.', { status: 501 });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
});

// Customer PAN: stored encrypted (enc: prefix), shown and exported only as ••••1234.
async function maskPan(env, v) {
  if (!v) return '';
  let plain = String(v);
  if (plain.startsWith('enc:')) { try { plain = await decryptSetting(env, plain.slice(4)); } catch (e) { return '••••'; } }
  return plain.length > 4 ? '••••' + plain.slice(-4) : '••••';
}

// Do the first bytes of an upload really look like what it claims to be?
function sniffOk(type, h, body) {
  const at = (i, ...b) => b.every((x, k) => h[i + k] === x);
  switch (type) {
    case 'application/pdf': return at(0, 0x25, 0x50, 0x44, 0x46);
    case 'image/png': return at(0, 0x89, 0x50, 0x4e, 0x47);
    case 'image/jpeg': return at(0, 0xff, 0xd8, 0xff);
    case 'image/webp': return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
    case 'image/heic': return at(4, 0x66, 0x74, 0x79, 0x70);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return at(0, 0x50, 0x4b);
    case 'application/msword': case 'application/vnd.ms-excel': return at(0, 0xd0, 0xcf, 0x11, 0xe0);
    case 'text/plain': case 'text/csv': return !body.includes(0);
    default: return false;
  }
}

// Buyer KYC, legal and agreement documents are for sales/accounts/PM/Owner only (site, purchase, HR, viewer never see them).
const RESTRICTED_DOC_CATS = ['kyc', 'legal', 'agreement'];
const canSeeRestricted = (user) => ['owner', 'pm', 'sales', 'accounts'].includes(user.role);
const docVisible = (user, doc) => !RESTRICTED_DOC_CATS.includes(doc.category) || canSeeRestricted(user);

// D1 returns BLOB columns as plain number arrays; turn them back into bytes before responding.
function blobBytes(d) {
  return d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : Uint8Array.from(d || []);
}

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
  const key = await crypto.subtle.importKey('raw', await appKeyBytes(env.APP_KEY), { name: 'AES-GCM' }, false, ['encrypt']);
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
  const key = await crypto.subtle.importKey('raw', await appKeyBytes(env.APP_KEY), { name: 'AES-GCM' }, false, ['decrypt']);
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


// ---------- Cron handler (§7.8 note 6) ----------
// 08:00 IST: tell Owner/PM about approvals expiring soon and queries nobody has answered for 5+ days (once per item per day).
async function approvalReminders(env) {
  const today = new Date(Date.now() + 19800000).toISOString().substring(0, 10);
  const due = await env.DB.prepare(`SELECT i.id, i.name, i.valid_till, i.reminder_days, p.name AS project FROM apr_items i JOIN projects p ON p.id = i.project_id
    WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND COALESCE(p.status,'') != 'archived' AND i.valid_till IS NOT NULL AND i.status NOT IN ('na', 'rejected')
    AND date(i.valid_till) <= date('now', '+' || COALESCE(i.reminder_days, 30) || ' days')`).all();
  const stale = await env.DB.prepare(`SELECT i.id, i.name, p.name AS project FROM apr_items i JOIN projects p ON p.id = i.project_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL AND i.status = 'query'
    AND COALESCE((SELECT MAX(created_at) FROM apr_events e WHERE e.item_id = i.id), i.created_at) < datetime('now', '-5 days')`).all();
  const users = await env.DB.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm')").all();
  const note = async (title, body, key) => {
    for (const u of users.results) {
      const dup = await env.DB.prepare("SELECT id FROM notifications WHERE user_id = ? AND link = ? AND date(created_at) = ?").bind(u.id, key, today).first();
      if (!dup) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, title, body, key, nowStr()).run();
    }
  };
  for (const r of due.results) {
    const days = Math.round((new Date(r.valid_till) - new Date(today)) / 86400000);
    await note(days < 0 ? `Expired: ${r.name}` : `Expiring in ${days} days: ${r.name}`, `${r.project} — valid till ${r.valid_till}. Confirm renewal dates with your CA/architect.`, `approvals#${r.id}`);
  }
  for (const r of stale.results) await note(`Query unanswered 5+ days: ${r.name}`, r.project, `approvals#q${r.id}`);
}

// Hourly: a new lead nobody touched in 1 hour nudges its owner; after 4 hours the Owner/PM hear about it. Business hours only (09:00-19:00 IST).
async function leadSlaNudges(env) {
  const hour = new Date(Date.now() + 19800000).getUTCHours();
  if (hour < 9 || hour >= 19) return;
  const rows = await env.DB.prepare("SELECT id, name, assigned_to, created_at FROM sal_leads WHERE deleted_at IS NULL AND status = 'new' AND first_contact_at IS NULL AND created_at < datetime('now', '-1 hours') LIMIT 50").all();
  const mgr = await env.DB.prepare("SELECT id FROM users WHERE active = 1 AND deleted_at IS NULL AND role IN ('owner', 'pm')").all();
  for (const l of rows.results) {
    const late = l.created_at < new Date(Date.now() - 4 * 3600000).toISOString().replace('T', ' ').substring(0, 19);
    const targets = late ? mgr.results.map((m) => m.id) : (l.assigned_to ? [l.assigned_to] : []);
    for (const uid of targets) {
      const key = `lead#${l.id}:${late ? '4h' : '1h'}`;
      const dup = await env.DB.prepare('SELECT id FROM notifications WHERE user_id = ? AND link = ?').bind(uid, key).first();
      if (!dup) await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid, late ? `Lead waiting 4+ hours: ${l.name}` : `New lead not contacted yet: ${l.name}`, 'Please call or WhatsApp them.', key, nowStr()).run();
    }
  }
}

async function scheduled(event, env, ctx) {
  if (env.ENVIRONMENT === 'staging') return; // staging guard
  const cron = event.cron;

  ctx.waitUntil(runCron(cron, env).catch((e) => console.error('cron failed', cron, e.message)));
}

async function runCron(cron, env) {
  const now = new Date();
  // 30 2 * * * = 08:00 IST digest
  // 30 13 * * * = 19:00 IST DPR nudge
  // 30 * * * * = hourly reminder sweep + email retry
  // 30 20 * * * = 02:00 IST nightly backup

  if (cron === '30 * * * *') {
    // Hourly: retry failed emails (max 3 attempts each)
    await retryFailedEmails(env);
    await leadSlaNudges(env);
    await expireHolds(env, nowStr);
  } else if (cron === '30 2 * * *') {
    // 08:00 IST digest to every active Owner
    const owners = await env.DB.prepare("SELECT email FROM users WHERE role = 'owner' AND active = 1 AND deleted_at IS NULL").all();
    for (const o of owners.results) {
      try { await sendDigest(env, o.email); } catch (e) { console.error('digest failed', e.message); }
    }
    await approvalReminders(env);
  } else if (cron === '30 13 * * *') {
    // 19:00 IST: in-app nudge for projects with no site report today
    await notifyMissingDprs(env);
  } else if (cron === '30 20 * * *') {
    // 02:00 IST: housekeeping — expired sessions, OTP codes and rate-limit rows
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    await env.DB.prepare("DELETE FROM otp_codes WHERE expires_at < datetime('now')").run();
    await nightlyBackup(env);
  }
}

// ---------- Main fetch handler ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      // Only one address serves the CRM: anything else (old workers.dev link, a bare IP, another domain) is sent to it.
      if (env.EXTERNAL_URL) {
        const want = new URL(env.EXTERNAL_URL);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (!local && url.hostname !== want.hostname) return Response.redirect(`${want.origin}${url.pathname}${url.search}`, 308);
      }
      if (path === '/api/health') {
        return json({ ok: true, env: env.ENVIRONMENT || 'production' });
      }
      await ensureBootstrap(env);
      if (path.startsWith('/api/') || path.startsWith('/s/') || path.startsWith('/brand/')) {
        return router.handle(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Worker error:', err);
      return serverError(err, 'worker');
    }
  },
  scheduled,
};
