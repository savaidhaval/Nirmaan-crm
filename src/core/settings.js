// settings.js — get/set with AES-GCM encrypt/decrypt using APP_KEY (§4.4, §5)

const PLAIN_PREFIX = 'plain:';

// APP_KEY -> raw AES key bytes. A valid base64/base64url 16/24/32-byte key is used as-is
// (so data encrypted earlier still decrypts); anything else is hashed to 32 bytes.
export async function appKeyBytes(appKey) {
  const raw = String(appKey || '');
  if (!raw) throw new Error('APP_KEY secret is not set.');
  try {
    const std = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
    if ([16, 24, 32].includes(bin.length)) return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch (e) { /* not base64 */ }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
}
const ENC_PREFIX = 'enc:';

function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(ENC_PREFIX);
}

export async function getSetting(env, key) {
  const { results } = await env.DB.prepare(
    'SELECT value_json FROM settings WHERE key = ?'
  ).bind(key).all();
  if (!results || results.length === 0) return null;
  const row = results[0];
  let val = row.value_json;
  if (isEncrypted(val)) {
    val = await decryptValue(env.APP_KEY, val.substring(ENC_PREFIX.length));
  }
  try {
    return JSON.parse(val);
  } catch (e) {
    return val;
  }
}

export async function setSetting(env, key, value, updatedBy) {
  let val = typeof value === 'string' ? value : JSON.stringify(value);
  const encrypted = await encryptValue(env.APP_KEY, val);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await env.DB.prepare(
    `INSERT INTO settings (key, value_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).bind(key, encrypted, updatedBy, now).run();
}

export async function deleteSetting(env, key) {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
}

async function encryptValue(appKeyB64, plaintext) {
  const key = await crypto.subtle.importKey(
    'raw',
    await appKeyBytes(appKeyB64),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(new Uint8Array(iv), 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  return ENC_PREFIX + bytesToBase64(combined);
}

async function decryptValue(appKeyB64, ciphertextB64) {
  const combined = base64ToBytes(ciphertextB64);
  const iv = combined.slice(0, 12);
  const enc = combined.slice(12);
  const key = await crypto.subtle.importKey(
    'raw',
    await appKeyBytes(appKeyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    enc
  );
  return new TextDecoder().decode(dec);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const DEFAULTS = {
  'storage.driver': 'gdrive',
  'storage.gdrive.status': 'not_connected',
  'storage.warn_percent': 80,
  'files.brochure_max_mb': 25,
  'share.default_expiry_days': 14,
  'share.default_max_views': null,
  'access.limit_roles_to_assigned_projects': ['pm', 'site', 'sales', 'accounts', 'purchase', 'hr', 'viewer'],
  'projects.start_gate': 'on',
  'access.allow_second_owner': 'off',
  'branding.apply_colours_to_app': 'on',
  'brochure.price_list_default_audience': 'internal',
  'po.pm_approval_limit_paise': 500000,
  'sales.share_all_leads': 'off',
  'demand.due_days_after_milestone': 7,
  'rer.a_quarterly_reminder_days': 15,
};

export async function ensureDefaults(env, updatedBy) {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = await getSetting(env, key);
    if (existing === null) {
      await setSetting(env, key, value, updatedBy);
    }
  }
}
