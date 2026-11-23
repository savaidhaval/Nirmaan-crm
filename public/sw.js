// sw.js — PWA service worker. Caches the static shell only, never API or file responses.
// Network-first so a new deploy is picked up immediately; cache is the offline fallback.

const CACHE_NAME = 'nirmaan-shell-v31';
const SHELL_URLS = ['/', '/login.html', '/app.css', '/ui.js', '/app.js', '/pages.js', '/pages2.js', '/pages3.js', '/pages4.js', '/pages5.js', '/pages6.js', '/pages7.js', '/pages8.js', '/pages9.js', '/pages10.js', '/pages11.js', '/pages12.js', '/pages13.js', '/pages14.js', '/pages15.js', '/pages16.js', '/pages17.js', '/pages18.js', '/pages19.js', '/pages20.js', '/pages21.js', '/pages22.js', '/pages23.js', '/pages24.js', '/pages25.js', '/pages26.js', '/pages27.js', '/pages28.js', '/identity/brand-kit.css', '/identity/brand-tokens.css', '/identity/logo-horizontal.png', '/identity/icon-mark.png', '/identity/favicon.svg', '/identity/fonts/inter-400.woff2', '/identity/fonts/inter-600.woff2', '/identity/fonts/jakarta-700.woff2', '/identity/fonts/jakarta-800.woff2', '/install.js', '/manifest.json', '/charts.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname.startsWith('/s/')) return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && SHELL_URLS.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
