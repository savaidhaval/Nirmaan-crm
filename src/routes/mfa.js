// routes/mfa.js — TOTP (RFC 6238) second factor with one-time recovery codes.
// The secret is stored encrypted with APP_KEY; a code can be used only once (replay protection); recovery codes are stored hashed.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32decode(str) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Uint8Array.from(out);
}

export async function totpAt(secretBytes, step) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8); const dv = new DataView(buf); dv.setUint32(0, Math.floor(step / 2 ** 32)); dv.setUint32(4, step >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const newCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(10)); const s = Array.from(b, (x) => a[x % a.length]).join(''); return s.slice(0, 5) + '-' + s.slice(5); };

// Verify a 6-digit code (±1 step) for a user. Returns true and records the step so the same code cannot be replayed.
export async function verifyTotp(env, decryptSetting, userId, code) {
  const row = await env.DB.prepare('SELECT * FROM user_totp WHERE user_id = ?').bind(userId).first();
  if (!row) return false;
  const secret = b32decode(await decryptSetting(env, row.secret_enc));
  const now = Math.floor(Date.now() / 30000);
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  for (const step of [now, now - 1, now + 1]) {
    if (step <= row.last_step) continue;
    if ((await totpAt(secret, step)) === c) {
      const r = await env.DB.prepare('UPDATE user_totp SET last_step = ? WHERE user_id = ? AND last_step < ?').bind(step, userId, step).run();
      if (r.meta.changes) return true;
    }
  }
  return false;
}

export async function useRecoveryCode(env, userId, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c)) return false;
  const h = await sha('recovery:' + c);
  const r = await env.DB.prepare('UPDATE user_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').bind(new Date().toISOString().replace('T', ' ').substring(0, 19), userId, h).run();
  return !!r.meta.changes;
}

// After a correct first factor: if the user has TOTP, start a challenge instead of a session.
export async function mfaChallenge(env, userId) {
  const enrolled = await env.DB.prepare('SELECT enabled_at FROM user_totp WHERE user_id = ? AND enabled_at IS NOT NULL').bind(userId).first();
  if (!enrolled) return null;
  const raw = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  const exp = new Date(Date.now() + 5 * 60000).toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha('mfa:' + token), userId, exp).run();
  return token;
}

export function registerMfa(router, h) {
  const { json, serverError, getCurrentUser, getSetting, nowStr, encryptSetting, decryptSetting, checkRateLimit, createSession, setSessionCookie, safeUser, withAuth, clientIp } = h;
  const audit = (env, uid, action, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(uid, action, 'users', id, summary, nowStr()).run();
  const needHeader = (req) => req.headers.get('X-NirmaanCRM') === '1';

  async function me(req, env) {
    const u = await getCurrentUser(env, req.headers.get('cookie'));
    if (!u || !u.active || u.deactivated_at) return null;
    return u;
  }

  router.get('/api/auth/totp/status', async (req, env) => {
    const u = await me(req, env); if (!u) return json({ ok: false, error: 'Please log in.' }, 401);
    const row = await env.DB.prepare('SELECT enabled_at FROM user_totp WHERE user_id = ?').bind(u.user_id).first();
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL').bind(u.user_id).first();
    const roles = await getSetting(env, 'security.require_mfa_roles');
    return json({ ok: true, data: { enrolled: !!(row && row.enabled_at), pending: !!(row && !row.enabled_at), recovery_left: Number(left.n), required: Array.isArray(roles) && roles.includes(u.role) } });
  });

  router.post('/api/auth/totp/setup', async (req, env) => {
    try {
      const u = await me(req, env); if (!u) return json({ ok: false, error: 'Please log in.' }, 401);
      if (!needHeader(req)) return json({ ok: false, error: 'Invalid request.' }, 403);
      const done = await env.DB.prepare('SELECT enabled_at FROM user_totp WHERE user_id = ? AND enabled_at IS NOT NULL').bind(u.user_id).first();
      if (done) return json({ ok: false, error: 'Two-step sign-in is already on. Turn it off first to set it up again.' }, 400);
      const secret = b32encode(crypto.getRandomValues(new Uint8Array(20)));
      await env.DB.prepare('INSERT INTO user_totp (user_id, secret_enc, enabled_at, last_step, created_at) VALUES (?, ?, NULL, 0, ?) ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, enabled_at = NULL, last_step = 0').bind(u.user_id, await encryptSetting(env, secret), nowStr()).run();
      const issuer = 'NirmaanCRM';
      return json({ ok: true, data: { secret, uri: `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(u.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30` } });
    } catch (e) { return serverError(e, 'totp-setup'); }
  });

  router.post('/api/auth/totp/enable', async (req, env) => {
    try {
      const u = await me(req, env); if (!u) return json({ ok: false, error: 'Please log in.' }, 401);
      if (!needHeader(req)) return json({ ok: false, error: 'Invalid request.' }, 403);
      const rl = await checkRateLimit(env, `totp-enable:${u.user_id}`, 10, 15); if (!rl.allowed) return json({ ok: false, error: 'Too many tries. Wait 15 minutes.' }, 429);
      const { code } = await req.json();
      const pending = await env.DB.prepare('SELECT 1 FROM user_totp WHERE user_id = ? AND enabled_at IS NULL').bind(u.user_id).first();
      if (!pending) return json({ ok: false, error: 'Start the setup first.' }, 400);
      if (!(await verifyTotp(env, decryptSetting, u.user_id, code))) return json({ ok: false, error: 'That code is not right. Check the time on your phone and try the next code.' }, 400);
      const codes = Array.from({ length: 10 }, newCode);
      const hashed = await Promise.all(codes.map((c) => sha('recovery:' + c)));
      const stmts2 = [
        env.DB.prepare('UPDATE user_totp SET enabled_at = ? WHERE user_id = ?').bind(nowStr(), u.user_id),
        env.DB.prepare('DELETE FROM user_recovery_codes WHERE user_id = ?').bind(u.user_id),
        ...hashed.map((hh) => env.DB.prepare('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES (?, ?)').bind(u.user_id, hh)),
        env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(u.user_id, 'mfa_enabled', 'users', u.user_id, 'Two-step sign-in turned on', nowStr()),
      ];
      await env.DB.batch(stmts2);
      return json({ ok: true, data: { recovery_codes: codes } });
    } catch (e) { return serverError(e, 'totp-enable'); }
  });

  router.post('/api/auth/totp/disable', async (req, env) => {
    try {
      const u = await me(req, env); if (!u) return json({ ok: false, error: 'Please log in.' }, 401);
      if (!needHeader(req)) return json({ ok: false, error: 'Invalid request.' }, 403);
      const roles = await getSetting(env, 'security.require_mfa_roles');
      if (Array.isArray(roles) && roles.includes(u.role)) return json({ ok: false, error: 'Two-step sign-in is required for your role.' }, 400);
      const rl = await checkRateLimit(env, `totp-disable:${u.user_id}`, 10, 15); if (!rl.allowed) return json({ ok: false, error: 'Too many tries. Wait 15 minutes.' }, 429);
      const { code } = await req.json();
      if (!(await verifyTotp(env, decryptSetting, u.user_id, code)) && !(await useRecoveryCode(env, u.user_id, code))) return json({ ok: false, error: 'Enter a current code to turn this off.' }, 400);
      await env.DB.batch([env.DB.prepare('DELETE FROM user_totp WHERE user_id = ?').bind(u.user_id), env.DB.prepare('DELETE FROM user_recovery_codes WHERE user_id = ?').bind(u.user_id)]);
      await audit(env, u.user_id, 'mfa_disabled', u.user_id, 'Two-step sign-in turned off');
      return json({ ok: true });
    } catch (e) { return serverError(e, 'totp-disable'); }
  });

  // Second step of sign-in
  router.post('/api/auth/mfa/verify', async (req, env) => {
    try {
      const rl = await checkRateLimit(env, `mfa-ip:${clientIp(req)}`, 30, 15); if (!rl.allowed) return json({ ok: false, error: 'Too many tries. Wait 15 minutes.' }, 429);
      const { mfa_token, code } = await req.json();
      const hash = await sha('mfa:' + String(mfa_token || ''));
      const ch = await env.DB.prepare("SELECT * FROM mfa_challenges WHERE token_hash = ? AND expires_at > datetime('now')").bind(hash).first();
      if (!ch) return json({ ok: false, error: 'That sign-in timed out. Start again.' }, 401);
      if (ch.attempts >= 5) { await env.DB.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').bind(hash).run(); return json({ ok: false, error: 'Too many wrong codes. Start again.' }, 429); }
      const good = (await verifyTotp(env, decryptSetting, ch.user_id, code)) || (await useRecoveryCode(env, ch.user_id, code));
      if (!good) { await env.DB.prepare('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ?').bind(hash).run(); return json({ ok: false, error: 'That code is not right.' }, 401); }
      await env.DB.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').bind(hash).run();
      const user = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').bind(ch.user_id).first();
      if (!user) return json({ ok: false, error: 'This account is not active.' }, 403);
      const session = await createSession(env, user.id, req.headers.get('user-agent') || '');
      await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowStr(), user.id).run();
      const res = json({ ok: true, data: { user: safeUser({ user_id: user.id, ...user }), must_change_password: !!user.must_change_password } });
      setSessionCookie(res, session.token, session.expiresAt);
      return res;
    } catch (e) { return serverError(e, 'mfa-verify'); }
  });

  // Owner resets someone's second factor (lost phone). Audited, and they must enrol again if their role requires it.
  router.post('/api/users/:id/reset-mfa', async (req, env) => withAuth(req, env, 'users_settings', 'E', async (req, env) => {
    try {
      const id = Number(req.params.id);
      const t = await env.DB.prepare('SELECT id, name, is_primary_owner FROM users WHERE id = ? AND deleted_at IS NULL').bind(id).first();
      if (!t) return json({ ok: false, error: 'User not found.' }, 404);
      if (t.is_primary_owner && req.user.user_id !== t.id) return json({ ok: false, error: 'The primary Owner\'s second factor can only be reset by the Owner themself (or from the database).' }, 403);
      await env.DB.batch([env.DB.prepare('DELETE FROM user_totp WHERE user_id = ?').bind(id), env.DB.prepare('DELETE FROM user_recovery_codes WHERE user_id = ?').bind(id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]);
      await audit(env, req.user.user_id, 'mfa_reset', id, `Two-step sign-in reset for ${t.name}`);
      return json({ ok: true });
    } catch (e) { return serverError(e, 'mfa-reset'); }
  }));
}
