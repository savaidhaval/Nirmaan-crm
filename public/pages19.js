// pages19.js — design refresh: grouped menu (several groups can stay open), role-relevant groups only, phone menu, install button, photo crop.

Object.assign(ICONS, {
  'g-projects': 'M3 21h18M5 21V7l7-4 7 4v14M9 9h2M13 9h2M9 13h2M13 13h2', 'g-money': 'M12 3v18M16 7c0-1.500-1.800-2.500-4-2.500S8 5.500 8 7s1.800 2.500 4 3 4 1.500 4 3-1.800 3-4 3-4-1.500-4-3',
  'g-sales': 'M3 3v18h18M7 15l4-5 3 3 5-7', 'g-people': 'M9 11a3.500 3.500 0 100-7 3.500 3.500 0 000 7zM2 20a7 7 0 0114 0M17 5a3 3 0 010 6M22 20a6 6 0 00-4-5.600',
  'g-library': 'M4 4h6v16H4zM14 4h6v16h-6zM4 8h6M14 8h6', 'g-admin': 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1a7 7 0 00-2-1l-.500-2h-4L10 7a7 7 0 00-2 1L6 7 4 11l2 1a7 7 0 000 2l-2 1 2 4 2-1a7 7 0 002 1l.500 2h4l.500-2a7 7 0 002-1l2 1 2-4-2-1a7 7 0 000-2z',
  'g-you': 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', menu: 'M4 7h16M4 12h16M4 17h16', download: 'M12 3v12M7 10l5 5 5-5M4 21h16', chev: 'M9 6l6 6-6 6',
});

// Where each page lives. A page the person may not open (by role) never appears, so each position sees only its own groups.
const NAV_GROUPS = [
  ['Projects', 'g-projects', ['projects', 'approvals', 'drawings', 'site', 'stores', 'redevelopment']],
  ['Money', 'g-money', ['procurement', 'contractors', 'budget', 'petty', 'rera', 'feasibility', 'bank', 'tally', 'finance', 'reports']],
  ['Sales', 'g-sales', ['sales', 'stacking', 'demandletters', 'enquiryform', 'brochures']],
  ['People', 'g-people', ['team', 'people']],
  ['Library', 'g-library', ['documents', 'professionals', 'branding', 'sharelinks']],
  ['Admin', 'g-admin', ['users', 'audit', 'datatools', 'storage', 'email', 'settings']],
  ['You', 'g-you', ['profile', 'workreport', 'security']],
];
const NAV_TOP = ['dashboard', 'home', 'ai', 'insights'];
const _sidebarItems19 = sidebarItems;
// Returns the same shape as before ([[group, items]]) so every other screen keeps working.
sidebarItems = function (role) {
  const flat = _sidebarItems19(role).flatMap((g) => g[1]); const seen = new Set(); const byRoute = {};
  flat.forEach((i) => { if (!seen.has(i.route)) { seen.add(i.route); byRoute[i.route] = i; } });
  const out = [[null, NAV_TOP.map((r) => byRoute[r]).filter(Boolean)]];
  const used = new Set(NAV_TOP);
  NAV_GROUPS.forEach(([name, , routes]) => { const items = routes.map((r) => byRoute[r]).filter(Boolean); routes.forEach((r) => used.add(r)); if (items.length) out.push([name, items]); });
  const rest = flat.filter((i) => !used.has(i.route) && !used.has(i.route)); const extra = [...new Map(rest.map((i) => [i.route, i])).values()];
  if (extra.length) out.push(['More', extra]);
  return out;
};
const navIcon = (name) => (NAV_GROUPS.find((g) => g[0] === name) || [0, 'g-projects'])[1];

const NAV_KEY = 'nirmaan.nav.open';
const navOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(NAV_KEY) || '[]')); } catch (e) { return new Set(); } };
const navSave = (set) => { try { localStorage.setItem(NAV_KEY, JSON.stringify([...set])); } catch (e) { /* storage blocked */ } };

function paintSideNav() {
  const side = $('side-nav'); if (!side || !currentUser) return;
  const groups = sidebarItems(currentUser.role), open = navOpen();
  groups.forEach(([name, items]) => { if (name && items.some((i) => i.route === currentPage)) open.add(name); });
  const link = (i) => `<a class="side-link${i.route === currentPage ? ' active' : ''}" href="#" data-route="${i.route}">${icon(i.icon)}<span>${esc(t(i.label))}</span></a>`;
  side.innerHTML = groups.map(([name, items]) => {
    if (!name) return items.map(link).join('');
    const isOpen = open.has(name), active = items.some((i) => i.route === currentPage);
    return `<div class="side-grp"><button class="side-head${active ? ' has-active' : ''}" data-grp="${esc(name)}" aria-expanded="${isOpen}">${icon(navIcon(name))}<span>${esc(t(name))}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS.chev}"/></svg></button><div class="side-sub${isOpen ? ' open' : ''}">${items.map(link).join('')}</div></div>`;
  }).join('') + `<div class="side-sep"></div>${link({ route: 'help', icon: 'help', label: 'Help' })}`;
  side.querySelectorAll('[data-route]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.route); }; });
  side.querySelectorAll('[data-grp]').forEach((b) => { b.onclick = () => { const s = navOpen(); const n = b.dataset.grp; if (s.has(n)) s.delete(n); else s.add(n); navSave(s); const on = s.has(n); b.setAttribute('aria-expanded', on); b.nextElementSibling.classList.toggle('open', on); }; });
  const foot = $('side-foot'); if (foot) foot.textContent = `${currentUser.name}${currentUser.position ? ' · ' + currentUser.position : ' · ' + currentUser.role}`;
}

// ---- top bar: install button ----
function paintInstall() {
  const bar = document.querySelector('.top-right'); if (!bar || !currentUser) return;
  if (!$('btn-install')) {
    const b = document.createElement('button'); b.className = 'icon-btn'; b.id = 'btn-install'; b.title = 'Install the app'; b.setAttribute('aria-label', 'Install the app'); b.setAttribute('data-install', ''); b.innerHTML = icon('download', 20);
    b.onclick = () => nirmaanInstall.open(); bar.insertBefore(b, $('btn-help') || bar.firstChild);
    const menu = $('user-menu'); if (menu && !$('menu-install')) { const m = document.createElement('div'); m.className = 'menu-item'; m.id = 'menu-install'; m.setAttribute('data-install', ''); m.textContent = 'Install the app'; m.onclick = () => { menu.style.display = 'none'; nirmaanInstall.open(); }; menu.insertBefore(m, $('menu-password')); }
  }
  document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = nirmaanInstall.standalone(); });
}

const _renderApp19 = renderApp;
renderApp = function () { _renderApp19.apply(this, arguments); paintSideNav(); paintInstall(); };

// ---- bottom tabs: the last one is now "Menu" ----
const _bottom19 = getBottomNavItems;
getBottomNavItems = function (role) { const items = _bottom19(role).filter((i) => i.route !== 'more').slice(0, 4); return [...items, { label: 'Menu', route: 'more', icon: 'menu' }]; };

// ---- phone menu: grouped list, several groups can be open ----
renderMore = function (main) {
  const o = currentUser.role === 'owner', groups = sidebarItems(currentUser.role).filter((g) => g[0] && g[0] !== 'You'), open = navOpen();
  groups.forEach(([name, items]) => { if (items.some((i) => i.route === currentPage)) open.add(name); });
  const canCsv = ['owner', 'pm', 'accounts', 'viewer'].includes(currentUser.role);
  main.innerHTML = `<h1>${esc(t('Menu'))}</h1>
    <div class="install-card" data-install><img class="app-icon" src="/icons/icon-192.png" alt=""><div style="flex:1"><b>Install the app</b><p class="muted">Add NirmaanCRM to your home screen</p></div><button class="btn small btn-primary" id="more-install">Install</button></div>
    <div class="menu-groups">${groups.map(([name, items]) => `<div class="menu-group"><button aria-expanded="${open.has(name)}" data-grp="${esc(name)}">${icon(navIcon(name))}<span>${esc(t(name))}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS.chev}"/></svg></button><div class="pills${open.has(name) ? ' open' : ''}">${items.map((i) => `<a href="#" data-go="${i.route}">${esc(t(i.label))}</a>`).join('')}</div></div>`).join('')}</div>
    <div class="menu-groups">${[['My profile', 'profile'], ['My work report', 'workreport'], ['Notifications', 'notifications'], ['Help', 'help'], ['Change password', 'password']].map(([l, r]) => `<div class="menu-group"><button data-go="${r}"><span>${esc(t(l))}</span></button></div>`).join('')}</div>
    ${canCsv ? `<div class="card"><b>Download for Excel</b><div class="row-btns"><a class="btn small" href="/api/export/receipts">Receipts</a><a class="btn small" href="/api/export/receivables">Receivables</a><a class="btn small" href="/api/export/purchases">Purchases</a><a class="btn small" href="/api/export/leads">Leads</a>${o ? '<a class="btn small" href="/api/export-all?part=1">Backup 1 of 3</a><a class="btn small" href="/api/export-all?part=2">Backup 2 of 3</a><a class="btn small" href="/api/export-all?part=3">Backup 3 of 3</a>' : ''}</div></div>` : ''}
    <button class="btn btn-full" style="margin-top:12px;color:var(--danger)" id="more-logout">${esc(t('Log out'))}</button>`;
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); navigate(b.dataset.go); }; });
  main.querySelectorAll('button[data-grp]').forEach((b) => { b.onclick = () => { const s = navOpen(); const n = b.dataset.grp; if (s.has(n)) s.delete(n); else s.add(n); navSave(s); const on = s.has(n); b.setAttribute('aria-expanded', on); b.nextElementSibling.classList.toggle('open', on); }; });
  $('more-install').onclick = () => nirmaanInstall.open(); const ic = main.querySelector('.install-card'); if (nirmaanInstall.standalone()) ic.hidden = true;
  $('more-logout').onclick = logout;
};
PAGES.more = (m) => renderMore(m);

// ---- photo crop: drag to move, slider to zoom, round window shows what people will see ----
function cropPicture(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file could not be read as a picture.', 5000); resolve(null); };
    img.onload = () => {
      const S = 300, D = 260; const w = img.naturalWidth, h = img.naturalHeight, base = D / Math.min(w, h);
      let zoom = 1, ox = 0, oy = 0;
      const ov = document.createElement('div'); ov.className = 'modal-overlay';
      ov.innerHTML = `<div class="modal" role="dialog" aria-label="Adjust your photo"><h2>Adjust your photo</h2><p class="muted" style="margin-bottom:10px">Drag to move it. Use the slider to zoom. The circle is what people will see.</p>
        <div class="crop-stage" id="cp-stage"></div><div class="crop-zoom"><span class="muted">−</span><label class="sr-only" for="cp-zoom" style="position:absolute;left:-9999px">Zoom</label><input type="range" id="cp-zoom" min="100" max="400" value="100"><span class="muted">+</span></div>
        <div class="modal-actions"><button class="btn" id="cp-cancel">Cancel</button><button class="btn btn-primary" id="cp-ok">Use photo</button></div></div>`;
      document.body.appendChild(ov);
      const stage = ov.querySelector('#cp-stage'); img.draggable = false; stage.appendChild(img); stage.insertAdjacentHTML('beforeend', '<div class="mask"></div><div class="ring"></div>');
      const clamp = () => { const sc = base * zoom, mx = Math.max(0, (w * sc - D) / 2), my = Math.max(0, (h * sc - D) / 2); ox = Math.min(mx, Math.max(-mx, ox)); oy = Math.min(my, Math.max(-my, oy)); };
      const paint = () => { clamp(); const sc = base * zoom; img.style.width = w * sc + 'px'; img.style.height = h * sc + 'px'; img.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`; };
      paint();
      let drag = null;
      stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; stage.setPointerCapture(e.pointerId); stage.style.cursor = 'grabbing'; });
      stage.addEventListener('pointermove', (e) => { if (!drag) return; ox = drag.ox + (e.clientX - drag.x); oy = drag.oy + (e.clientY - drag.y); paint(); });
      const end = () => { drag = null; stage.style.cursor = 'grab'; }; stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
      stage.addEventListener('wheel', (e) => { e.preventDefault(); const z = $('cp-zoom'); z.value = Math.min(400, Math.max(100, Number(z.value) - e.deltaY / 4)); zoom = z.value / 100; paint(); }, { passive: false });
      ov.querySelector('#cp-zoom').oninput = (e) => { zoom = e.target.value / 100; paint(); };
      const close = (v) => { URL.revokeObjectURL(url); ov.remove(); resolve(v); };
      ov.querySelector('#cp-cancel').onclick = () => close(null);
      ov.querySelector('#cp-ok').onclick = () => {
        const sc = base * zoom, sw = D / sc, sx = w / 2 + (-D / 2 - ox) / sc, sy = h / 2 + (-D / 2 - oy) / sc;
        const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256); g.drawImage(img, sx, sy, sw, sw, 0, 0, 256, 256);
        c.toBlob((b) => close(b ? new File([b], 'me.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.88);
      };
    };
    img.src = url;
  });
}
shrinkPicture = cropPicture;

// pages can be opened from an address ending in #site, #drawings ... (used by the install shortcuts)
window.addEventListener('load', () => { const r = (location.hash || '').replace('#', ''); if (r && PAGES[r]) { const t0 = setInterval(() => { if (typeof currentUser !== 'undefined' && currentUser) { clearInterval(t0); navigate(r); } }, 300); setTimeout(() => clearInterval(t0), 8000); } });
