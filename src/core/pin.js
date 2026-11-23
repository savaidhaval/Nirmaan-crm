// core/pin.js — the Director's approval PIN (maker-checker) and PAN helpers for society members.
// The PIN is a 6-digit number kept only as a salted hash; wrong tries are limited. PAN is kept encrypted plus a keyed hash.
import { hashPassword, makeSalt, bytesToBase64, base64ToBytes, checkRateLimit } from './auth.js';

export const PIN_RE = /^\d{6}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export async function setPin(env, userId, pin, nowStr) {
  const salt = makeSalt();
  const hash = await hashPassword(pin, salt);
  await env.DB.prepare('UPDATE users SET approval_pin_hash = ?, approval_pin_salt = ?, approval_pin_set_at = ? WHERE id = ?').bind(hash, bytesToBase64(salt), nowStr, userId).run();
}

// Returns null when the PIN is right, otherwise a plain message.
export async function checkPin(env, userId, pin) {
  const u = await env.DB.prepare('SELECT approval_pin_hash, approval_pin_salt FROM users WHERE id = ?').bind(userId).first();
  if (!u || !u.approval_pin_hash) return 'Set your approval PIN first (Redevelopment → Transit rent → Approval PIN).';
  if (!PIN_RE.test(String(pin || ''))) return 'Enter your 6-digit approval PIN.';
  const rl = await checkRateLimit(env, `pin:${userId}`, 5, 15);
  if (!rl.allowed) return 'Too many wrong PINs. Wait 15 minutes and try again.';
  const ok = (await hashPassword(String(pin), base64ToBytes(u.approval_pin_salt))) === u.approval_pin_hash;
  if (!ok) return 'That PIN is not right.';
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(`pin:${userId}`).run();
  return null;
}

// Keyed hash of a PAN so duplicates can be found without storing it in the clear. APP_KEY is the key.
export async function panHash(env, pan) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('pan:' + String(env.APP_KEY || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(pan).toUpperCase())));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
