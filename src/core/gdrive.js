// core/gdrive.js — Google Drive integration (§3.4)
// Plain fetch, no Google library. Scope: drive.file only.

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MAX_FILE_BYTES = 90 * 1024 * 1024; // 90 MB ceiling

export class GDriveError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
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

async function sha256(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

// AES-GCM encrypt/decrypt using APP_KEY (same approach as settings.js)
async function appKeyRaw(env) {
  return base64urlDecode(env.APP_KEY);
}

async function encryptValue(env, plaintext) {
  const key = await crypto.subtle.importKey('raw', await appKeyRaw(env), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(new Uint8Array(iv), 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  return base64urlEncode(combined);
}

async function decryptValue(env, ciphertextB64url) {
  const combined = base64urlDecode(ciphertextB64url);
  const iv = combined.slice(0, 12);
  const enc = combined.slice(12);
  const key = await crypto.subtle.importKey('raw', await appKeyRaw(env), { name: 'AES-GCM' }, false, ['decrypt']);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
  return new TextDecoder().decode(dec);
}

// ---------- OAuth ----------

export function makeOAuthStart(env, redirectUri, userId) {
  const verifier = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64urlEncode(sha256Sync(new TextEncoder().encode(verifier)));
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  return {
    authUrl,
    state,
    verifier,
    expiresAt,
  };
}

// SHA-256 sync for PKCE challenge (we need the bytes before async crypto)
function sha256Sync(bytes) {
  // Can't do sync SHA-256 in Workers; use async wrapper instead
  throw new Error('use async');
}

export async function makeOAuthStartAsync(env, redirectUri, userId) {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64urlEncode(verifierBytes);
  const challengeBytes = await sha256(verifierBytes);
  const challenge = base64urlEncode(challengeBytes);
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = base64urlEncode(stateBytes);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  return {
    authUrl,
    state,
    verifier,
    expiresAt,
    stateHash: base64urlEncode(await sha256(new TextEncoder().encode(state))),
  };
}

export async function exchangeCode(env, code, verifier, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new GDriveError(`Token exchange failed: ${data.error || res.status}`, data.error || 'token_error');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  };
}

export async function refreshAccessToken(env, refreshTokenEnc) {
  const refreshToken = await decryptValue(env, refreshTokenEnc);

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new GDriveError(`Token refresh failed: ${data.error || res.status}`, data.error || 'refresh_error');
  }

  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
}

// ---------- Drive API calls ----------

async function driveRequest(env, accessToken, method, path, body, headers = {}) {
  const url = `${DRIVE_API}${path}`;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    const h = { Authorization: `Bearer ${accessToken}`, ...headers };
    const res = await fetch(url, { method, headers: h, body });

    // Rate limit / server error — retry with growing pause
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = res.headers.get('Retry-After') || Math.pow(2, attempts);
      await new Promise((r) => setTimeout(r, Number(retryAfter) * 1000));
      continue;
    }

    if (res.status === 401) {
      throw new GDriveError('Drive access token expired or invalid.', 'invalid_token');
    }

    if (res.status === 403) {
      const txt = await res.text();
      throw new GDriveError(`Drive request forbidden: ${txt}`, 'forbidden');
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new GDriveError(`Drive request failed (${res.status}): ${txt}`, 'drive_error');
    }

    if (res.status === 204) return null;
    return res.json();
  }

  throw new GDriveError('Drive request failed after retries.', 'max_retries');
}

export async function getDriveAbout(env, accessToken) {
  const fields = 'storageQuota,emailAddress';
  return driveRequest(env, accessToken, 'GET', `/about?fields=${fields}`);
}

export async function createDriveFolder(env, accessToken, name, parentId) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
  };
  return driveRequest(env, accessToken, 'POST', '/files', JSON.stringify(metadata), {
    'Content-Type': 'application/json',
  });
}

export async function findDriveFolder(env, accessToken, name, parentId) {
  const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' AND name = '${name}'${parentId ? ` AND '${parentId}' in parents` : ''} AND trashed = false`);
  return driveRequest(env, accessToken, 'GET', `/files?q=${q}&fields=files(id,name)`);
}

export async function resumableUploadInit(env, accessToken, fileName, mimeType, parentId) {
  const metadata = {
    name: fileName,
    ...(parentId ? { parents: [parentId] } : {}),
  };

  const res = await fetch(`${DRIVE_API}/files/upload?uploadType=resumable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': '0', // will be set on the PUT
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new GDriveError(`Resumable upload init failed (${res.status}): ${txt}`, 'upload_init_error');
  }

  return res.headers.get('Location'); // session URL
}

export async function resumableUploadPut(env, accessToken, sessionUrl, bodyStream, contentLength, mimeType) {
  const res = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(contentLength),
    },
    body: bodyStream,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new GDriveError(`Resumable upload PUT failed (${res.status}): ${txt}`, 'upload_put_error');
  }

  return res.json();
}

export async function getDriveFile(env, accessToken, fileId, rangeHeader) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (rangeHeader) headers.Range = rangeHeader;

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new GDriveError(`Drive file download failed (${res.status}): ${txt}`, 'download_error');
  }
  return res;
}

export async function deleteDriveFile(env, accessToken, fileId) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text();
    throw new GDriveError(`Drive file delete failed (${res.status}): ${txt}`, 'delete_error');
  }
}

export async function getDriveFileMetadata(env, accessToken, fileId) {
  return driveRequest(env, accessToken, 'GET', `/files/${fileId}?fields=id,name,md5Checksum,size,mimeType,trashed`);
}
