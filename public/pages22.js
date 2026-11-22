// pages22.js — OFFLINE MODE (WP-21).
// 1. The app opens without a connection (the page files are kept by the service worker, the signed-in person by this phone).
// 2. Screens you have already opened show the last information this phone saw, marked as saved information.
// 3. Entries made without a connection (site reports, snags, material requests, receiving material, stock issues, petty cash, drawing "seen",
//    handover ticks, consent taps) are saved on the phone and sent by themselves when the connection is back. Each carries a client id, so a
//    retry can never create a duplicate. Nothing is dropped silently: an entry the server refuses stays in a "could not send" list with the reason.
// 4. Saved information and the signed-in profile are cleared on log out. Waiting entries stay until they are sent (log out asks first).

const OFF_DB = 'nirmaan-offline';
const offDb = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) { reject(new Error('no idb')); return; }
  const r = indexedDB.open(OFF_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('reads', { keyPath: 'key' });
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
const offReq = (mode, fn) => offDb().then((db) => new Promise((res, rej) => { const tx = db.transaction('reads', mode); const out = fn(tx.objectStore('reads')); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); tx.onerror = () => rej(tx.error); })).catch(() => undefined);

const READ_OK = /^\/api\/(projects|drawings|approvals|site\/|procurement\/(pos|pos-to-receive|indents|vendors)|stores|petty|contractors\/for-project|sales\/(leads|inventory|visit-options|handover)|redev\/societies|notifications|team)/;
const WRITE_OK = [
  [/^\/api\/site\/dprs$/, 'Daily site report'], [/^\/api\/site\/snags$/, 'Snag'], [/^\/api\/procurement\/indents$/, 'Material request'],
  [/^\/api\/procurement\/pos\/\d+\/grn(-lines)?$/, 'Material received'], [/^\/api\/stores\/(issue|adjust)$/, 'Stock entry'], [/^\/api\/petty\/entries$/, 'Petty cash entry'],
  [/^\/api\/drawings\/revisions\/\d+\/ack$/, 'Drawing seen'], [/^\/api\/sales\/handover-items\/\d+$/, 'Handover tick'], [/^\/api\/redev\/members\/\d+\/consent$/, 'Consent update'],
];
const writeLabel = (path) => { const m = WRITE_OK.find(([re]) => re.test(path)); return m ? m[1] : null; };
const isNetErr = (e) => e instanceof TypeError || !navigator.onLine;

// ---- saved copies of what the phone has read ----
const readKey = (path) => `${currentUser ? currentUser.id : 0}|${path}`;
async function saveRead(path, data) {
  if (!currentUser) return;
  const json = JSON.stringify(data); if (json.length > 400000) return;
  await offReq('readwrite', (s) => s.put({ key: readKey(path), at: Date.now(), data }));
}
const loadRead = (path) => offReq('readonly', (s) => s.get(readKey(path)));
const clearReads = () => offReq('readwrite', (s) => s.clear());

// ---- the waiting list ----
const Q2 = 'nirmaan.q2', Q2F = 'nirmaan.q2.failed';
const jget = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const waiting = () => jget(Q2).filter((i) => !currentUser || i.uid === currentUser.id);
const failedList = () => jget(Q2F).filter((i) => !currentUser || i.uid === currentUser.id);
// anything left in the older queue by a previous version is moved across, never lost
(function migrate() { const old = (typeof readQueue === 'function') ? readQueue() : []; if (!old.length) return; const q = jget(Q2); old.forEach((o) => q.push({ id: crypto.randomUUID(), uid: 0, url: o.url, method: 'POST', body: o.body, label: writeLabel(o.url) || 'Entry', at: o.at || Date.now(), tries: 0 })); jset(Q2, q); if (typeof writeQueue === 'function') writeQueue([]); })();

const _api22 = api;
function enqueue(path, options) {
  const body = options.body && typeof options.body === 'object' ? { ...options.body } : {};
  body.client_uuid = body.client_uuid || crypto.randomUUID();
  const q = jget(Q2); q.push({ id: crypto.randomUUID(), uid: currentUser ? currentUser.id : 0, url: path, method: (options.method || 'POST').toUpperCase(), body, label: writeLabel(path), at: Date.now(), tries: 0 });
  if (!jset(Q2, q)) throw new Error('This phone is out of space, so the entry could not be saved. Free some space and try again.');
  paintOffline(); toast('Saved on this phone. It will be sent when you are online.', 5000);
}
api = async function (path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const keep = READ_OK.test(path);
    try { const r = await _api22(path, options); if (keep) saveRead(path, r); return r; }
    catch (e) { if (keep && isNetErr(e)) { const c = await loadRead(path); if (c) { window.__staleAt = Math.min(window.__staleAt || Infinity, c.at); markStale(); return c.data; } } throw e; }
  }
  if (method === 'POST' && writeLabel(path) && (options.body === undefined || (typeof options.body === 'object' && !(options.body instanceof FormData)))) {
    const src = options.body || {}; const body = { ...src, client_uuid: src.client_uuid || crypto.randomUUID() };
    try { return await _api22(path, { ...options, body }); }
    catch (e) { if (isNetErr(e)) { enqueue(path, { ...options, body }); return { ok: true, data: { queued: true, offline: true } }; } throw e; }
  }
  return _api22(path, options);
};
// the earlier helper showed "saved" even when the entry was only queued: say it once, plainly
postOrQueue = async function (url, body, okMsg) {
  body.client_uuid = body.client_uuid || crypto.randomUUID();   // callers read it back to attach photos
  const r = await api(url, { method: 'POST', body }).catch((e) => { toast(e.message, 5000); return null; });
  if (r && !(r.data && r.data.queued) && okMsg) toast(okMsg);
  return r;
};

// ---- sending ----
let sending = false;
async function sendWaiting(manual) {
  if (sending || !currentUser) return; sending = true;
  let sent = 0;
  try {
    const q = jget(Q2); const mine = q.filter((i) => i.uid === currentUser.id || i.uid === 0); const rest = q.filter((i) => !(i.uid === currentUser.id || i.uid === 0));
    const keep = []; const failed = jget(Q2F); let stop = false;
    for (const item of mine) {
      if (stop) { keep.push(item); continue; }
      try {
        const r = await _api22(item.url, { method: item.method || 'POST', body: item.body });
        if (r.data && r.data.id && item.body.client_uuid) saveMapEntry(item.body.client_uuid, r.data.id);
        sent++;
      } catch (e) {
        if (isNetErr(e)) { keep.push(item); stop = true; }
        else if (e.status === 401) { keep.push(item); stop = true; }
        else if (e.status >= 500 && item.tries < 4) keep.push({ ...item, tries: item.tries + 1 });
        else failed.push({ ...item, uid: currentUser.id, reason: e.message || 'The server did not accept it.', failed_at: Date.now() });
      }
    }
    jset(Q2, [...rest, ...keep]); jset(Q2F, failed);
    // photos wait for the id of their report; send those whose report is now on the server
    try { const map = readMap(); for (const rec of await allPhotos()) { const id = map[rec.uuid]; if (!id) continue; try { await uploadPhoto(rec, id); await dropPhoto(rec.id); } catch (e) { if (!isNetErr(e)) await dropPhoto(rec.id); } } } catch (e) { /* photos retry next time */ }
  } finally { sending = false; paintOffline(); }
  const f = failedList().length;
  if (sent) toast(`${sent} saved entr${sent > 1 ? 'ies' : 'y'} sent${f ? `. ${f} could not be sent: tap the orange bar to see why.` : '.'}`, 6000);
  else if (manual) toast(waiting().length ? 'Still no connection. Your entries are safe on this phone.' : 'Nothing is waiting.');
  if (sent && typeof renderApp === 'function' && currentPage) { const m = $('app-main'); if (m && !document.querySelector('.modal-overlay')) renderApp(); }
}
syncQueue = () => sendWaiting(false);
window.addEventListener('online', () => { paintOffline(); setTimeout(() => sendWaiting(false), 800); });
window.addEventListener('offline', paintOffline);
setInterval(() => { if (navigator.onLine && waiting().length) sendWaiting(false); }, 45000);

// ---- the bar: offline notice, waiting entries, saved-information note ----
function markStale() { const n = $('stale-note'); if (n) n.textContent = `Showing information saved on this phone at ${new Date(window.__staleAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. It will refresh when you are online.`; paintOffline(); }
function paintOffline() {
  if (!currentUser) { const b = $('offline-bar'); if (b) b.hidden = true; return; }
  let bar = $('offline-bar');
  if (!bar) { bar = document.createElement('button'); bar.id = 'offline-bar'; bar.type = 'button'; bar.className = 'offline-bar'; const main = $('app-main'); if (main && main.parentNode) main.parentNode.insertBefore(bar, main); bar.onclick = showWaiting; }
  const w = waiting().length, f = failedList().length, off = !navigator.onLine;
  const stale = window.__staleAt && off;
  const parts = [];
  if (off) parts.push('You are offline. You can keep working: new entries are saved on this phone.');
  if (w) parts.push(`${w} waiting to send`);
  if (f) parts.push(`${f} could not be sent`);
  bar.hidden = !parts.length; bar.textContent = parts.join(' · '); bar.classList.toggle('bad', f > 0);
  let note = $('stale-note'); const main = $('app-main');
  if (stale && main && !note) { note = document.createElement('p'); note.id = 'stale-note'; note.className = 'muted'; main.prepend(note); markStale(); }
}
function showWaiting() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const draw = () => {
    const w = waiting(), f = failedList(); const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    ov.innerHTML = `<div class="modal" role="dialog" aria-label="Waiting to send"><h2>Waiting to send</h2>
      ${!navigator.onLine ? '<p class="muted">You are offline. These are safe on this phone and will be sent when the connection returns.</p>' : ''}
      ${w.map((i) => `<div class="card"><b>${esc(i.label || 'Entry')}</b><p class="muted">Saved ${esc(when(i.at))}${i.tries ? ' · tried ' + i.tries + ' times' : ''}</p></div>`).join('') || '<p class="muted">Nothing is waiting.</p>'}
      ${f.length ? `<h3>Could not be sent</h3>${f.map((i) => `<div class="card" style="border-left:4px solid var(--danger)"><b>${esc(i.label || 'Entry')}</b><p class="muted">${esc(i.reason)}</p><button class="btn small" data-drop="${esc(i.id)}">Discard</button></div>`).join('')}` : ''}
      <div class="modal-actions"><button class="btn" id="ow-close">Close</button><button class="btn btn-primary" id="ow-send">Send now</button></div></div>`;
    ov.querySelector('#ow-close').onclick = () => ov.parentNode.removeChild(ov);
    ov.querySelector('#ow-send').onclick = async () => { await sendWaiting(true); draw(); };
    ov.querySelectorAll('[data-drop]').forEach((b) => { b.onclick = () => { jset(Q2F, jget(Q2F).filter((x) => x.id !== b.dataset.drop)); paintOffline(); draw(); }; });
  };
  draw(); document.body.appendChild(ov);
}

// ---- opening the app with no connection ----
const ME_KEY = 'nirmaan.me';
const _loadUser22 = loadUser;
loadUser = async function () {
  let reachable = true;
  try { const ctl = new AbortController(); const t0 = setTimeout(() => ctl.abort(), 4000); await fetch('/api/health', { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t0); } catch (e) { reachable = false; }
  if (!reachable) {
    let me = null; try { me = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch (e) { /* none */ }
    if (me) { currentUser = me; try { await loadBrandChrome(); } catch (e) { /* offline: keep defaults */ } renderApp(); paintOffline(); return; }
  }
  await _loadUser22();
  if (currentUser) { try { localStorage.setItem(ME_KEY, JSON.stringify(currentUser)); } catch (e) { /* ignore */ } paintOffline(); setTimeout(() => sendWaiting(false), 1500); }
};

// ---- log out: ask when entries are still waiting; forget saved information ----
const _logout22 = logout;
logout = async function () {
  const w = waiting().length;
  if (w && !confirm(`${w} entr${w > 1 ? 'ies are' : 'y is'} still waiting to be sent from this phone. Log out anyway? They stay saved and will be sent when you log in again.`)) return;
  await clearReads(); try { localStorage.removeItem(ME_KEY); localStorage.removeItem('nirmaan.projects'); } catch (e) { /* ignore */ }
  window.__staleAt = null; await _logout22();
};

// ---- after every screen is drawn ----
const _renderApp22 = renderApp;
renderApp = function () { window.__staleAt = null; _renderApp22.apply(this, arguments); paintOffline(); };
