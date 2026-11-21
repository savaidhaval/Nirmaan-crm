// auth.js — sessions, PBKDF2 password hashing, OTP, bootstrap owner (§4.5, §4.6, §7.8 note 5)

const SALT_LEN = 16;
const ITERATIONS = 100000; // Cloudflare's maximum per guide
const SESSION_DAYS = 30;
const COOKIE_NAME = 'nirmaan_session';

export async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

export function makeSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LEN));
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function verifyPassword(password, salt, hash) {
  const computed = await hashPassword(password, salt);
  return computed === hash;
}

export function makeSessionToken() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function hashToken(tokenBytes) {
  const buf = await crypto.subtle.digest('SHA-256', tokenBytes);
  return bytesToBase64(new Uint8Array(buf));
}

export function setSessionCookie(res, tokenHash, expiresAt) {
  const cookie = `${COOKIE_NAME}=${tokenHash}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}`;
  res.headers.append('Set-Cookie', cookie);
}

export function clearSessionCookie(res) {
  res.headers.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

export async function getSession(env, tokenHash) {
  const row = await env.DB.prepare(`
    SELECT s.id AS session_id, s.user_id, s.expires_at, s.user_agent, s.created_at,
           u.name, u.email, u.phone, u.role, u.lang, u.active, u.extra_roles,
           u.must_change_password, u.is_primary_owner, u.deactivated_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > datetime('now') AND u.deleted_at IS NULL
  `).bind(tokenHash).first();
  return row;
}

export async function createSession(env, userId, userAgent) {
  const tokenBytes = makeSessionToken();
  const tokenHash = await hashToken(tokenBytes);
  const expiresAt = addDaysUtc(SESSION_DAYS);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tokenHash, userId, expiresAt, userAgent, now).run();
  return { tokenHash, tokenBytes, expiresAt };
}

export async function destroySession(env, tokenHash) {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
}

export async function destroyAllSessions(env) {
  await env.DB.prepare('DELETE FROM sessions').run();
}

export async function destroyUserSessions(env, userId) {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

function addDaysUtc(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

export async function checkRateLimit(env, key, maxHits, windowMinutes) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(windowStart).run();
  let row = await env.DB.prepare('SELECT * FROM rate_limits WHERE key = ? AND window_start >= ?').bind(key, windowStart).first();
  if (!row) {
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, hits) VALUES (?, ?, 1)').bind(key, now).run();
    return { allowed: true, hits: 1 };
  }
  const hits = Number(row.hits) + 1;
  await env.DB.prepare('UPDATE rate_limits SET hits = ? WHERE key = ?').bind(hits, key).run();
  return { allowed: hits <= maxHits, hits };
}

// Bootstrap owner on first login from OWNER_EMAIL / OWNER_PASSWORD secrets
export async function ensureBootstrapOwner(env) {
  const ownerEmail = env.OWNER_EMAIL;
  const ownerPassword = env.OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) return null;

  const existing = await env.DB.prepare('SELECT id FROM users WHERE role = ? AND is_primary_owner = 1 LIMIT 1').bind('owner').first();
  if (existing) return null; // already bootstrapped

  const salt = makeSalt();
  const hash = await hashPassword(ownerPassword, salt);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const result = await env.DB.prepare(`
    INSERT INTO users (name, email, phone, role, password_hash, password_salt, lang, active, must_change_password, is_primary_owner, created_at)
    VALUES (?, ?, ?, 'owner', ?, ?, 'en', 1, 1, 1, ?)
  `).bind('Owner', ownerEmail, '', hash, bytesToBase64(salt), now).run();
  return { id: result.meta.last_row_id, email: ownerEmail };
}

// Authenticate with email + password
export async function loginPassword(env, email, password, userAgent) {
  const rateKey = `login:${email}`;
  const rl = await checkRateLimit(env, rateKey, 5, 15);
  if (!rl.allowed) {
    throw new Error('Too many login attempts. Try again in 15 minutes.');
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').bind(email).first();
  if (!user) throw new Error('Invalid email or password.');

  if (!user.active) throw new Error('This account is deactivated. Contact the Owner.');

  if (user.password_hash && user.password_salt) {
    const ok = await verifyPassword(password, base64ToBytes(user.password_salt), user.password_hash);
    if (!ok) throw new Error('Invalid email or password.');
  } else if (env.OWNER_EMAIL && email === env.OWNER_EMAIL && env.OWNER_PASSWORD && password === env.OWNER_PASSWORD) {
    // Bootstrap fallback: hash is empty, use secrets directly
    const salt = makeSalt();
    const hash = await hashPassword(password, salt);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = ? WHERE id = ?').bind(hash, bytesToBase64(salt), now, user.id).run();
  } else {
    throw new Error('Invalid email or password.');
  }

  // Update last login
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();

  const session = await createSession(env, user.id, userAgent);
  return { user, session };
}

// Logout
export async function logout(env, tokenHash) {
  await destroySession(env, tokenHash);
}

// Get current user from session cookie
export async function getCurrentUser(env, cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const tokenHash = match[1];
  return getSession(env, tokenHash);
}

// OTP endpoints (dormant until email works — Phase 11)
export async function createOtpCode(env, email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = makeSalt();
  const hash = await hashPassword(code, salt);
  const expiresAt = addDaysUtc(10 / 1440); // 10 minutes
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();
  await env.DB.prepare('INSERT INTO otp_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)').bind(email, hash, expiresAt, now).run();
  return code;
}

export async function verifyOtpCode(env, email, code) {
  const row = await env.DB.prepare("SELECT * FROM otp_codes WHERE email = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (!row) return { ok: false, error: 'No code found. Request a new one.' };
  if (Number(row.attempts) >= 5) return { ok: false, error: 'Too many attempts. Request a new code.' };
  const ok = await verifyPassword(code, base64ToBytes(row.code_hash), row.code_hash);
  if (!ok) {
    await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return { ok: false, error: 'Incorrect code.' };
  }
  await env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1 AND deleted_at IS NULL').bind(email).first();
  if (!user) return { ok: false, error: 'Account not found or inactive.' };
  return { ok: true, user };
}
