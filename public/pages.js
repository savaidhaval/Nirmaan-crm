// pages.js — NirmaanCRM screens (loaded after ui.js and app.js; later definitions win).
// All user-supplied text goes through esc() before it reaches innerHTML.

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const $ = (id) => document.getElementById(id);
const rupeesToPaise = (v) => Math.round((parseFloat(String(v).replace(/,/g, '')) || 0) * 100);
const today = () => new Date(Date.now() + 19800000).toISOString().substring(0, 10);

let projectCache = null;
async function getProjects(force) {
  if (!projectCache || force) {
    try {
      projectCache = (await api('/api/projects')).data.projects;
      try { localStorage.setItem('nirmaan.projects', JSON.stringify(projectCache)); } catch (e) { /* ignore */ }
    } catch (e) {
      // Offline: fall back to the last list this phone saw, so site staff can still file reports.
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem('nirmaan.projects') || 'null'); } catch (e2) { /* ignore */ }
      if (!saved) throw e;
      projectCache = saved;
    }
  }
  return projectCache;
}
async function projectOptions() {
  return (await getProjects()).map((p) => [p.id, p.name]);
}

// ---------- Modal form helper ----------
// openForm({title, fields:[{name,label,type,options,required,value,placeholder,help}], submit}) -> values | null
function openForm({ title, fields, submit = 'Save', intro = '' }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    const rows = fields.map((f) => {
      const id = 'f_' + f.name;
      let input;
      if (f.type === 'select') {
        input = `<select id="${id}">${(f.options || []).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      } else if (f.type === 'file') {
        input = `<input id="${id}" type="file">`;
      } else if (f.type === 'checkbox') {
        input = `<label class="check"><input type="checkbox" id="${id}"${f.value ? ' checked' : ''}> ${esc(f.checkLabel || f.label)}</label>`;
      } else {
        const t = f.type === 'money' ? 'text' : (f.type || 'text');
        input = `<input id="${id}" type="${t}" inputmode="${f.type === 'money' || f.type === 'number' ? 'decimal' : 'text'}" value="${esc(f.value == null ? '' : f.value)}" placeholder="${esc(f.placeholder || '')}">`;
      }
      return `<div class="field">${f.type === 'checkbox' ? '' : `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>`}${input}${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}</div>`;
    }).join('');
    ov.innerHTML = `<div class="modal"><h2>${esc(title)}</h2>${intro ? `<p class="help">${esc(intro)}</p>` : ''}<form id="modal-form">${rows}<div class="error" id="modal-error" style="display:none"></div><div class="modal-actions"><button type="button" class="btn" id="modal-cancel">${esc(t('Cancel'))}</button><button type="submit" class="btn btn-primary">${esc(submit)}</button></div></form></div>`;
    document.body.appendChild(ov);
    const close = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    $('modal-cancel').onclick = () => close(null);
    const first = ov.querySelector('input,select,textarea'); if (first) first.focus();
    $('modal-form').onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = $('f_' + f.name);
        let v = f.type === 'checkbox' ? el.checked : (f.type === 'file' ? (el.files[0] || '') : el.value.trim());
        if (f.required && (v === '' || v === false)) {
          const er = $('modal-error'); er.textContent = `${t('Please fill in')}: ${f.label}`; er.style.display = 'block'; el.focus(); return;
        }
        if (f.type === 'money') v = rupeesToPaise(v);
        else if (f.type === 'number' && v !== '') v = Number(v);
        out[f.name] = v;
      }
      close(out);
    };
  });
}

// Run an API call; toast the plain error on failure. Returns data or null.
async function act(promise, okMsg) {
  try {
    const r = await promise;
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 5000);
    return null;
  }
}

function chip(text, tone) {
  const c = { good: '#dcfce7;color:#166534', warn: '#fef3c7;color:#92400e', bad: '#fee2e2;color:#991b1b', info: '#dbeafe;color:#1e40af' }[tone] || '#e5e7eb;color:#111827';
  return `<span class="chip" style="background:${c}">${esc(text)}</span>`;
}
const STATUS_TONE = { approved: 'good', paid: 'good', done: 'good', verified: 'good', ifc: 'good', booked: 'good', applied: 'info', ready: 'info', partial: 'warn', query: 'warn', pending_approval: 'warn', open: 'warn', draft: '', rejected: 'bad', expired: 'bad', cancelled: 'bad', superseded: 'bad' };
const statusChip = (s) => chip(String(s || '').replace(/_/g, ' '), STATUS_TONE[s]);

function copyText(t) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Copy failed'));
}


// ---------- Language (en / hi / mr) ----------
const I18N = {
  hi: { 'Home': 'होम', 'Drawings': 'ड्रॉइंग', 'Site': 'साइट', 'More': 'और', 'Projects': 'प्रोजेक्ट', 'Approvals': 'मंज़ूरियाँ', 'Sales': 'बिक्री', 'Procurement': 'खरीद',
    'Site work': 'साइट का काम', "Today's work report": 'आज की कार्य रिपोर्ट', 'Raise a snag': 'समस्या दर्ज करें', 'Milestones': 'माइलस्टोन', 'Recent reports': 'हाल की रिपोर्ट', 'Snags': 'समस्याएँ',
    'Done today': 'आज पूरा', 'Project': 'प्रोजेक्ट', 'Date': 'तारीख', 'What work happened today?': 'आज क्या काम हुआ?', 'Labour on site': 'साइट पर मज़दूर', 'Problems / delays': 'समस्या / देरी',
    'Save': 'सेव करें', 'Cancel': 'रद्द करें', 'What is wrong?': 'क्या गड़बड़ है?', 'Where (wing / floor)': 'कहाँ (विंग / मंज़िल)', 'How serious?': 'कितनी गंभीर?', 'Low': 'कम', 'Medium': 'मध्यम', 'High': 'ज़्यादा',
    'Report saved': 'रिपोर्ट सेव हुई', 'Snag raised': 'समस्या दर्ज हुई', 'Latest drawings': 'नवीनतम ड्रॉइंग', 'Hello': 'नमस्ते', 'Language': 'भाषा', 'Log out': 'लॉग आउट', 'Documents': 'दस्तावेज़',
    'Notifications': 'सूचनाएँ', 'Help': 'सहायता', 'Change password': 'पासवर्ड बदलें', 'Please fill in': 'कृपया भरें', 'Waiting to send': 'भेजना बाकी', 'Saved on this phone. It will be sent when you are online.': 'फ़ोन में सेव हुआ। नेट आने पर भेज दिया जाएगा।', 'Send now': 'अभी भेजें' },
  mr: { 'Home': 'होम', 'Drawings': 'ड्रॉइंग्ज', 'Site': 'साइट', 'More': 'अधिक', 'Projects': 'प्रकल्प', 'Approvals': 'मंजुरी', 'Sales': 'विक्री', 'Procurement': 'खरेदी',
    'Site work': 'साइटचे काम', "Today's work report": 'आजचा कामाचा अहवाल', 'Raise a snag': 'अडचण नोंदवा', 'Milestones': 'टप्पे', 'Recent reports': 'अलीकडील अहवाल', 'Snags': 'अडचणी',
    'Done today': 'आज पूर्ण', 'Project': 'प्रकल्प', 'Date': 'तारीख', 'What work happened today?': 'आज कोणते काम झाले?', 'Labour on site': 'साइटवरील कामगार', 'Problems / delays': 'अडचणी / उशीर',
    'Save': 'जतन करा', 'Cancel': 'रद्द करा', 'What is wrong?': 'काय चुकले आहे?', 'Where (wing / floor)': 'कुठे (विंग / मजला)', 'How serious?': 'किती गंभीर?', 'Low': 'कमी', 'Medium': 'मध्यम', 'High': 'जास्त',
    'Report saved': 'अहवाल जतन झाला', 'Snag raised': 'अडचण नोंदवली', 'Latest drawings': 'ताजी ड्रॉइंग्ज', 'Hello': 'नमस्कार', 'Language': 'भाषा', 'Log out': 'लॉग आउट', 'Documents': 'कागदपत्रे',
    'Notifications': 'सूचना', 'Help': 'मदत', 'Change password': 'पासवर्ड बदला', 'Please fill in': 'कृपया भरा', 'Waiting to send': 'पाठवायचे बाकी', 'Saved on this phone. It will be sent when you are online.': 'फोनमध्ये जतन झाले. नेट आल्यावर पाठवले जाईल.', 'Send now': 'आता पाठवा' },
};
function t(s) {
  const lang = (currentUser && currentUser.lang) || 'en';
  return (I18N[lang] && I18N[lang][s]) || s;
}

// ---------- Offline queue (text only; photos are not queued) ----------
const QKEY = 'nirmaan.queue.v1';
const readQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { /* storage full or blocked */ } };

// POST that survives a dead network: queued on this phone, retried on reconnect. Every item carries a client_uuid so retries never duplicate.
async function postOrQueue(url, body, okMsg) {
  body.client_uuid = body.client_uuid || crypto.randomUUID();
  try {
    const r = await api(url, { method: 'POST', body });
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    if (e instanceof TypeError || !navigator.onLine) {
      const q = readQueue(); q.push({ url, body, at: Date.now() }); writeQueue(q);
      toast(t('Saved on this phone. It will be sent when you are online.'), 6000);
      return { queued: true };
    }
    toast(e.message, 5000);
    return null;
  }
}

let syncing = false;
async function syncQueue() {
  if (syncing || !currentUser) return;
  syncing = true;
  try {
    let q = readQueue();
    const keep = [];
    for (const item of q) {
      try { await api(item.url, { method: 'POST', body: item.body }); }
      catch (e) { if (e instanceof TypeError || !navigator.onLine) { keep.push(item); } /* server said no: drop, it will never succeed */ }
    }
    writeQueue(keep);
    if (q.length && !keep.length) toast('Offline items sent');
  } finally { syncing = false; }
}
window.addEventListener('online', syncQueue);


// ---------- Icons (inline SVG, no external requests) ----------
const ICONS = {
  home: 'M3 12l9-9 9 9M5 10v10h14V10', dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  projects: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h2M9 13h2M13 9h2M13 13h2M10 21v-4h4v4',
  approvals: 'M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z', drawings: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  site: 'M2 18h20M4 18a8 8 0 0116 0M12 6V3', procurement: 'M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20.5a.5.5 0 100-1 .5.5 0 000 1zM18 20.5a.5.5 0 100-1 .5.5 0 000 1z',
  sales: 'M3 17l6-6 4 4 8-8M15 7h6v6', documents: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h6',
  users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8zM21 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  branding: 'M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.3A3.7 3.7 0 0021 11c0-4.4-4-8-9-8z',
  sharelinks: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  audit: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 3h6v4H9zM9 12h6M9 16h6',
  storage: 'M18 18H7a5 5 0 01-.5-10 6 6 0 0111.4 1.5A4.3 4.3 0 0118 18z', email: 'M4 5h16v14H4zM4 7l8 6 8-6',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', more: 'M5 12h.01M12 12h.01M19 12h.01',
  money: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6', alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 3h6v4H9z', userplus: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6',
  password: 'M5 11h14v10H5zM8 11V7a4 4 0 118 0v4',
};
function icon(name, size) {
  const d = ICONS[name] || ICONS.more;
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${size ? ` style="width:${size}px;height:${size}px"` : ''}><path d="${d}"/></svg>`;
}

// Everything each role may open, grouped for the desktop sidebar.
function sidebarItems(role) {
  const H = { label: 'Home', route: role === 'owner' ? 'dashboard' : 'home', icon: role === 'owner' ? 'dashboard' : 'home' };
  const I = (label, route) => ({ label, route, icon: route });
  const by = {
    owner: [[null, [H]], ['Work', [I('Projects', 'projects'), I('Approvals', 'approvals'), I('Drawings', 'drawings'), I('Site', 'site')]], ['Money', [I('Procurement', 'procurement'), I('Sales', 'sales')]],
      ['Admin', [I('Documents', 'documents'), I('Brochures', 'brochures'), I('People', 'people'), I('Users & access', 'users'), I('Branding', 'branding'), I('Shared links', 'sharelinks'), I('Audit log', 'audit')]], ['Setup', [I('Storage', 'storage'), I('Email', 'email'), I('Settings', 'settings')]]],
    pm: [[null, [H]], ['Work', [I('Projects', 'projects'), I('Approvals', 'approvals'), I('Drawings', 'drawings'), I('Site', 'site')]], ['Money', [I('Procurement', 'procurement'), I('Sales', 'sales')]], ['Admin', [I('Documents', 'documents'), I('Brochures', 'brochures'), I('People', 'people'), I('Branding', 'branding'), I('Shared links', 'sharelinks'), I('Audit log', 'audit')]]],
    site: [[null, [H]], ['Work', [I('Drawings', 'drawings'), I('Site', 'site'), I('Procurement', 'procurement')]], ['Admin', [I('Documents', 'documents')]]],
    sales: [[null, [H]], ['Work', [I('Sales', 'sales'), I('Brochures', 'brochures')]], ['Admin', [I('Documents', 'documents')]]],
    accounts: [[null, [H]], ['Money', [I('Sales', 'sales'), I('Procurement', 'procurement')]], ['Admin', [I('Documents', 'documents'), I('Brochures', 'brochures'), I('Branding', 'branding')]]],
    purchase: [[null, [H]], ['Work', [I('Procurement', 'procurement'), I('Drawings', 'drawings')]], ['Admin', [I('Documents', 'documents')]]],
    hr: [[null, [H]], ['Work', [I('People', 'people')]]],
    viewer: [[null, [H]], ['Work', [I('Projects', 'projects'), I('Approvals', 'approvals'), I('Drawings', 'drawings'), I('Site', 'site')]], ['Admin', [I('Documents', 'documents')]]],
  };
  return by[role] || by.viewer;
}
const ROUTE_TITLES = { dashboard: 'Home', home: 'Home', more: 'More', notifications: 'Notifications', password: 'Change password', help: 'Help' };

// ---------- Navigation ----------
function getBottomNavItems(role) {
  const home = { label: 'Home', route: 'home', icon: 'home' };
  const more = { label: 'More', route: 'more', icon: 'more' };
  const I = (label, route) => ({ label, route, icon: route });
  const maps = {
    owner: [{ label: 'Home', route: 'dashboard', icon: 'dashboard' }, I('Projects', 'projects'), I('Approvals', 'approvals'), I('Sales', 'sales'), more],
    pm: [home, I('Site', 'site'), I('Approvals', 'approvals'), I('Drawings', 'drawings'), more],
    site: [home, I('Drawings', 'drawings'), I('Site', 'site'), more],
    sales: [home, I('Sales', 'sales'), more],
    accounts: [home, I('Sales', 'sales'), I('Procurement', 'procurement'), more],
    purchase: [home, I('Procurement', 'procurement'), I('Drawings', 'drawings'), more],
    hr: [home, I('People', 'people'), more],
    viewer: [home, I('Projects', 'projects'), more],
  };
  return maps[role] || maps.viewer;
}

const PAGES = {
  home: renderHome, dashboard: renderDashboard, projects: renderProjects, users: renderUsers, documents: renderDocuments,
  settings: renderSettings, approvals: renderApprovals, drawings: renderDrawings, site: renderSite, procurement: renderProcurement,
  sales: renderSales, storage: renderStorage, branding: (m) => renderBranding(m), sharelinks: renderShareLinks, more: renderMore,
  audit: renderAudit, notifications: renderNotifications, help: renderHelp, password: renderChangePassword, email: renderEmailSettings,
};

let brandChrome = null;
async function loadBrandChrome() {
  if (brandChrome) return brandChrome;
  let name = 'NirmaanCRM';
  try { name = JSON.parse(sessionStorage.getItem('nirmaan.brandname') || '"NirmaanCRM"'); } catch (e) { /* ignore */ }
  brandChrome = { name };
  try {
    const d = await api('/api/branding');
    const n = d.data.branding && (d.data.branding.trade_name || d.data.branding.legal_name);
    if (n) { brandChrome.name = n; try { sessionStorage.setItem('nirmaan.brandname', JSON.stringify(n)); } catch (e) { /* ignore */ } }
  } catch (e) { /* roles without branding access keep the default */ }
  return brandChrome;
}

function paintChrome() {
  const name = (brandChrome && brandChrome.name) || 'NirmaanCRM';
  const initial = esc(name.trim().charAt(0).toUpperCase() || 'N');
  for (const id of ['side-name', 'topbar-trade-name']) { const el = $(id); if (el) el.textContent = name; }
  for (const id of ['side-logo', 'top-logo']) {
    const el = $(id); if (!el) continue;
    el.innerHTML = `${initial}<img src="/brand/logo_icon.png" alt="" hidden>`;
    const img = el.querySelector('img');
    img.addEventListener('load', () => { el.textContent = ''; img.hidden = false; el.appendChild(img); });
    img.addEventListener('error', () => img.remove());
  }
}

let brandList = [];
let brandsLoaded = false; // refreshed after any brand or project-brand change
async function fillProjectPicker() {
  const sel = $('project-picker'); if (!sel || !currentUser) return;
  let projects = [];
  try { projects = await getProjects(); } catch (e) { sel.hidden = true; return; }
  if (!brandsLoaded) { try { brandList = (await api('/api/brands')).data.brands; } catch (e) { brandList = []; } brandsLoaded = true; }
  if (projects.length < 2) { sel.hidden = true; if (scopeProject) { setScopeProject(0); } return; }
  if (scopeProject && !projects.some((p) => p.id === scopeProject)) setScopeProject(0);
  const opt = (p) => `<option value="${p.id}"${p.id === scopeProject ? ' selected' : ''}>${esc(p.name)}</option>`;
  const groups = brandList.length > 1 ? brandList.map((b) => ({ b, ps: projects.filter((p) => p.brand_id === b.id) })).filter((g) => g.ps.length) : null;
  sel.innerHTML = `<option value="0">All projects</option>` + (groups ? groups.map((g) => `<optgroup label="${esc(g.b.name)}">${g.ps.map(opt).join('')}</optgroup>`).join('') : projects.map(opt).join(''));
  sel.value = String(scopeProject || 0);
  sel.hidden = false;
  sel.onchange = () => { setScopeProject(sel.value); renderApp(); };
}

function renderApp() {
  const main = $('app-main');
  if (!currentUser) { renderLogin(); return; }
  document.body.classList.remove('guest');
  paintChrome();
  // desktop sidebar
  const side = $('side-nav');
  if (side) {
    side.innerHTML = sidebarItems(currentUser.role).map(([group, items]) => `${group ? `<div class="side-group">${esc(t(group))}</div>` : ''}${items.map((i) => `<a class="side-link${i.route === currentPage ? ' active' : ''}" href="#" data-route="${i.route}">${icon(i.icon)}<span>${esc(t(i.label))}</span></a>`).join('')}`).join('')
      + `<div class="side-group">${esc(t('Help'))}</div><a class="side-link${currentPage === 'help' ? ' active' : ''}" href="#" data-route="help">${icon('help')}<span>${esc(t('Help'))}</span></a>`;
    side.querySelectorAll('[data-route]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.route); }; });
  }
  $('side-foot').textContent = `${currentUser.name} · ${currentUser.role}`;
  // phone bottom tabs
  const nav = $('bottom-nav');
  if (nav) {
    nav.innerHTML = '';
    getBottomNavItems(currentUser.role).forEach((item) => {
      const a = document.createElement('a');
      a.className = 'nav-item' + (item.route === currentPage ? ' active' : '');
      a.href = '#';
      a.innerHTML = `${icon(item.icon)}<span>${esc(t(item.label))}</span>`;
      a.onclick = (e) => { e.preventDefault(); navigate(item.route); };
      nav.appendChild(a);
    });
  }
  // project picker (grouped by brand when there are several)
  fillProjectPicker();
  // top bar
  $('avatar').textContent = (currentUser.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('um-name').textContent = currentUser.name; $('um-role').textContent = `${currentUser.role} · ${currentUser.email}`;
  document.title = `${t(ROUTE_TITLES[currentPage] || (sidebarItems(currentUser.role).flatMap((g) => g[1]).find((i) => i.route === currentPage) || {}).label || 'NirmaanCRM')} — NirmaanCRM`;
  window.scrollTo(0, 0);
  (PAGES[currentPage] || renderHome)(main);
}

async function loadUser() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.data.user;
    if (data.data.must_change_password) { renderChangePassword($('app-main'), true); return; }
    await loadBrandChrome();
    renderApp();
    refreshBell();
    syncQueue();
    getProjects(true).catch(() => {}); // keep a copy for offline use
  } catch (e) {
    currentUser = null;
    renderLogin();
  }
}

async function refreshBell() {
  try {
    const d = await api('/api/notifications');
    const unread = d.data.notifications.filter((n) => !n.read_at).length;
    const b = $('notify-count');
    if (b) { b.textContent = unread; b.style.display = unread ? 'inline-block' : 'none'; }
  } catch (e) { /* not fatal */ }
}

function renderChangePassword(main, forced) {
  if (forced) document.body.classList.add('guest');
  main.innerHTML = `
    <div class="login-card" style="${forced ? '' : 'margin-top:0;box-shadow:var(--shadow)'}">
      <h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
      <p class="help">${forced ? 'You are using a temporary password. ' : ''}Use at least 10 characters.</p>
      <div class="field"><label>${forced ? 'Temporary password' : 'Current password'}</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div class="field"><label>New password</label><input type="password" id="pw-new" autocomplete="new-password"></div>
      <div class="field"><label>New password again</label><input type="password" id="pw-new2" autocomplete="new-password"></div>
      <div class="error" id="pw-err" style="display:none"></div>
      <button class="btn btn-primary btn-full" id="pw-save">Save password</button>
      ${forced ? '<p class="help" style="text-align:center"><a href="#" id="pw-out">Log out</a></p>' : ''}
    </div>`;
  if ($('pw-out')) $('pw-out').onclick = (e) => { e.preventDefault(); logout(); };
  $('pw-save').onclick = async () => {
    const er = $('pw-err'); er.style.display = 'none';
    const cur = $('pw-cur').value, n1 = $('pw-new').value, n2 = $('pw-new2').value;
    if (n1.length < 10) { er.textContent = 'New password must be at least 10 characters.'; er.style.display = 'block'; return; }
    if (n1 !== n2) { er.textContent = 'The two new passwords do not match.'; er.style.display = 'block'; return; }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: n1 } });
      toast('Password changed');
      currentPage = 'home';
      await loadUser();
    } catch (e) { er.textContent = e.message; er.style.display = 'block'; }
  };
}

// ---------- Home / More / Help ----------
function renderDashboard(main) {
  const d = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const tile = (id, label, ico, tone, route, sub) => `<div class="dashboard-tile tone-${tone}" data-go="${route}" tabindex="0" role="link"><span class="ico">${icon(ico, 26)}</span><div class="tile-label">${label}</div><div class="tile-value" id="val-${id}">…</div>${sub ? `<div class="tile-sub" id="sub-${id}"></div>` : ''}</div>`;
  main.innerHTML = `<div class="hero"><div><h1>${esc(t('Hello'))}, ${esc(currentUser.name.split(' ')[0])}</h1><div class="date">${esc(d)}</div></div>
      <div class="row-btns" style="margin:0"><button class="btn btn-primary" data-go="site">${icon('site', 18)} Site report</button><button class="btn" data-go="sales">${icon('sales', 18)} New lead</button></div></div>
    <div class="dashboard-grid" id="dashboard-grid">
      ${tile('money-in', 'Money in — this month', 'money', 'good', 'sales')}
      ${tile('overdue', 'Overdue receivables', 'alert', 'bad', 'sales', 1)}
      ${tile('bills', 'Bills due in 7 days', 'clipboard', 'warn', 'procurement', 1)}
      ${tile('pos', 'POs waiting for approval', 'procurement', 'warn', 'procurement')}
      ${tile('dpr', 'Site reports yesterday', 'site', 'info', 'site')}
      ${tile('snags', 'Open high-severity snags', 'alert', 'bad', 'site')}
      ${tile('leads', 'New leads this week', 'userplus', 'info', 'sales')}
    </div>`;
  main.querySelectorAll('[data-go]').forEach((el) => { el.onclick = () => navigate(el.dataset.go); el.onkeydown = (e) => { if (e.key === 'Enter') navigate(el.dataset.go); }; });
  loadDashboard();
}

function renderHome(main) {
  if (currentUser.role === 'owner') { renderDashboard(main); return; }
  const tiles = {
    site: [['📷', "Today's work report", 'site'], ['📐', 'Latest drawings', 'drawings'], ['⚠', 'Raise a snag', 'site']],
    pm: [['📷', 'Site reports', 'site'], ['✅', 'Approvals', 'approvals'], ['📐', 'Drawings', 'drawings']],
    sales: [['🤝', 'Leads', 'sales']],
    accounts: [['💰', 'Sales & receipts', 'sales'], ['🛒', 'Purchase orders', 'procurement']],
    purchase: [['🛒', 'Procurement', 'procurement'], ['📐', 'Drawings', 'drawings']],
    hr: [['👥', 'People', 'people']], viewer: [['🏗', 'Projects', 'projects']],
  }[currentUser.role] || [];
  main.innerHTML = `<h1>${esc(t('Hello'))}, ${esc(currentUser.name)}</h1><p class="help">${esc(currentUser.role)}</p>
    <div class="grid">${tiles.map(([i, l, r]) => `<button class="btn btn-full tile-btn" data-go="${r}"><span style="font-size:28px">${i}</span><br>${esc(l)}</button>`).join('') || '<div class="empty-state"><p>Nothing here yet.</p></div>'}</div>`;
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
}

function renderMore(main) {
  const o = currentUser.role === 'owner';
  const bottom = getBottomNavItems(currentUser.role).map((i) => i.route);
  const items = [...sidebarItems(currentUser.role).flatMap((g) => g[1]).filter((i) => !bottom.includes(i.route) && i.route !== 'home' && i.route !== 'dashboard'),
    { label: 'Notifications', route: 'notifications', icon: 'bell' }, { label: 'Help', route: 'help', icon: 'help' }, { label: 'Change password', route: 'password', icon: 'password' }];
  const canCsv = ['owner', 'pm', 'accounts', 'viewer'].includes(currentUser.role);
  main.innerHTML = `<h1>${esc(t('More'))}</h1><div class="grid">${items.map((i) => `<button class="btn btn-full" style="justify-content:flex-start;gap:12px" data-go="${i.route}">${icon(i.icon, 20)}${esc(t(i.label))}</button>`).join('')}</div>
    ${canCsv ? `<div class="card"><b>Download for Excel</b><div class="row-btns"><a class="btn small" href="/api/export/receipts">Receipts</a><a class="btn small" href="/api/export/receivables">Receivables</a><a class="btn small" href="/api/export/purchases">Purchases</a><a class="btn small" href="/api/export/leads">Leads</a>${o ? '<a class="btn small" href="/api/export-all">Everything (backup)</a>' : ''}</div></div>` : ''}
    <div class="field"><label>${esc(t('Language'))}</label><select id="more-lang"><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></div>
    <button class="btn btn-full" style="margin-top:12px;color:#dc2626" id="more-logout">${esc(t('Log out'))}</button>`;
  $('more-lang').value = currentUser.lang || 'en';
  $('more-lang').onchange = async () => { if (await act(api('/api/auth/lang', { method: 'POST', body: { lang: $('more-lang').value } }))) { currentUser.lang = $('more-lang').value; renderApp(); } };
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
  $('more-logout').onclick = logout;
}

function renderHelp(main) {
  main.innerHTML = `<h1>Help</h1>
    <div class="card"><h3>Words you will see</h3>
    <p><b>IOD</b> — Intimation of Disapproval: the first building-plan approval from MCGM.</p>
    <p><b>CC</b> — Commencement Certificate: permission to start construction.</p>
    <p><b>IFC</b> — Issued For Construction: the only drawing revision site should build from.</p>
    <p><b>DPR</b> — Daily Progress Report from site.</p>
    <p><b>GRN</b> — Goods Received Note when material arrives.</p>
    <p><b>CLP</b> — Construction-linked payment plan: demands raised as site milestones complete.</p>
    <p><b>TDS</b> — tax the buyer deducts and deposits; counted towards what they have paid.</p></div>
    <div class="card"><h3>Print this</h3><p><a href="/cheatsheets" target="_blank" rel="noopener">One-page cheat sheets for each role</a> (print or save as PDF).</p></div>
    <div class="card"><h3>Need a hand?</h3><p>Ask the Owner. Approval dates and RERA deadlines here are reminders only — confirm them with your CA and architect.</p></div>`;
}

// ---------- Projects ----------
function renderProjects(main) {
  const canCreate = ['owner', 'pm'].includes(currentUser.role);
  main.innerHTML = `<h1>Projects</h1>${canCreate ? '<button class="btn btn-primary" id="btn-new-project" style="margin-bottom:16px">+ New project</button>' : ''}<div id="projects-list">Loading...</div>`;
  if (canCreate) $('btn-new-project').onclick = newProject;
  loadProjects();
}

async function newProject() {
  const v = await openForm({
    title: 'New project',
    fields: [
      { name: 'name', label: 'Project name', required: true },
      { name: 'code', label: 'Short code', required: true, placeholder: 'e.g. SHIV-A', help: 'Used in PO numbers. Letters, digits and dashes.' },
      { name: 'address', label: 'Address' }, { name: 'ward', label: 'MCGM ward' },
      { name: 'city', label: 'City', value: 'Mumbai' },
      { name: 'type', label: 'Type', type: 'select', options: [['new_build', 'New build'], ['redevelopment', 'Redevelopment']] },
      { name: 'rera_no', label: 'MahaRERA number' },
    ],
  });
  if (!v) return;
  const r = await act(api('/api/projects', { method: 'POST', body: v }), 'Project created');
  if (r) { projectCache = null; renderProjects($('app-main')); }
}

async function loadProjects() {
  try {
    const projects = await getProjects(true);
    const list = $('projects-list');
    if (!projects.length) { list.innerHTML = '<div class="empty-state"><p>No projects yet.</p></div>'; return; }
    const mgr = ['owner', 'pm'].includes(currentUser.role);
    list.innerHTML = projects.map((p) => `
      <div class="card">
        <div class="row"><div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.code)} · ${esc(p.city || '')}${p.type === 'redevelopment' ? ' · Redevelopment' : ''}</p></div>${statusChip(p.status)}</div>
        ${p.address ? `<p class="muted">${esc(p.address)}</p>` : ''}
        ${mgr ? `<div class="row-btns"><button class="btn small" data-tpl="${p.id}" data-redev="${p.type === 'redevelopment' ? 1 : 0}">Load Mumbai approvals checklist</button></div>` : ''}
      </div>`).join('');
    list.querySelectorAll('[data-tpl]').forEach((b) => {
      b.onclick = async () => {
        const r = await act(api('/api/approvals/load-template', { method: 'POST', body: { project_id: Number(b.dataset.tpl), redevelopment: b.dataset.redev === '1' } }));
        if (r) { toast(`Added ${r.data.count} checklist items`); navigate('approvals'); }
      };
    });
  } catch (e) { $('projects-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ---------- Users ----------
const ROLE_LINES = {
  owner: 'Sees and does everything', pm: 'Runs projects, approves POs up to a limit', site: 'Site engineer: daily reports, latest drawings, snags',
  sales: 'Leads, visits, bookings', accounts: 'Receipts, bills, reports', purchase: 'Vendors, RFQs and POs', hr: 'Staff and hiring only', viewer: 'Read-only',
};
const roleOpts = () => Object.entries(ROLE_LINES).filter(([r]) => r !== 'owner').map(([r, l]) => [r, `${r} — ${l}`]);

function renderUsers(main) {
  main.innerHTML = `<h1>Users & access</h1><div class="row-btns" style="margin-bottom:16px"><button class="btn btn-primary" id="u-add">+ Add person</button><button class="btn" id="u-logout-all">Log everyone out</button></div><div id="users-list">Loading...</div>`;
  $('u-add').onclick = addUser;
  $('u-logout-all').onclick = async () => { if (confirm('Log out every other person right now?')) await act(api('/api/auth/logout-everyone', { method: 'POST' }), 'Everyone else has been logged out'); };
  loadUsers();
}

function showTempPassword(name, pw) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Temporary password</h2><p>Give this to <b>${esc(name)}</b>. It is shown only once. They must choose their own password at first login.</p>
    <div class="tempbox">${esc(pw)}</div><div class="modal-actions"><button class="btn" id="tp-copy">Copy</button><button class="btn btn-primary" id="tp-done">Done</button></div></div>`;
  document.body.appendChild(ov);
  $('tp-copy').onclick = () => copyText(pw);
  $('tp-done').onclick = () => ov.remove();
}

async function addUser() {
  const projects = await projectOptions();
  const v = await openForm({
    title: 'Add person',
    fields: [
      { name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Mobile' },
      { name: 'role', label: 'Role', type: 'select', options: roleOpts() },
      { name: 'lang', label: 'Language', type: 'select', options: [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']] },
      ...projects.map(([id, n]) => ({ name: 'p' + id, type: 'checkbox', label: n, checkLabel: `Can see project: ${n}` })),
    ],
  });
  if (!v) return;
  const body = { name: v.name, email: v.email, phone: v.phone, role: v.role, lang: v.lang, projects: projects.filter(([id]) => v['p' + id]).map(([id]) => id) };
  const r = await act(api('/api/users', { method: 'POST', body }));
  if (r) { showTempPassword(v.name, r.data.temporaryPassword); loadUsers(); }
}

async function loadUsers() {
  try {
    const d = await api('/api/users');
    $('users-list').innerHTML = d.data.users.map((u) => {
      const self = u.id === currentUser.id;
      const locked = self || u.is_primary_owner;
      return `<div class="card"><div class="row"><div><h2>${esc(u.name)}${u.is_primary_owner ? ' (primary owner)' : ''}</h2><p class="muted">${esc(u.role)} · ${esc(u.email)}</p>
        <p class="muted">Last login: ${u.last_login_at ? esc(dateIST(u.last_login_at)) : 'never'}${u.must_change_password ? ' · has not chosen a password yet' : ''}</p></div>${u.active ? chip('Active', 'good') : chip('Deactivated', 'bad')}</div>
        ${locked ? '' : `<div class="row-btns">
          <button class="btn small" data-act="edit" data-id="${u.id}">Edit</button>
          <button class="btn small" data-act="reset" data-id="${u.id}" data-name="${esc(u.name)}">Reset password</button>
          <button class="btn small" data-act="logout" data-id="${u.id}">Log out</button>
          ${u.active ? `<button class="btn small" data-act="deactivate" data-id="${u.id}" data-name="${esc(u.name)}" style="color:#dc2626">Deactivate</button>` : `<button class="btn small" data-act="reactivate" data-id="${u.id}">Reactivate</button>`}</div>`}</div>`;
    }).join('');
    const users = d.data.users;
    $('users-list').querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (b.dataset.act === 'reset') { if (!confirm(`Reset password for ${b.dataset.name}?`)) return; const r = await act(api(`/api/users/${id}/reset-password`, { method: 'POST' })); if (r) showTempPassword(b.dataset.name, r.data.temporaryPassword); }
        else if (b.dataset.act === 'logout') await act(api(`/api/users/${id}/logout`, { method: 'POST' }), 'Logged out');
        else if (b.dataset.act === 'deactivate') { if (confirm(`Deactivate ${b.dataset.name}? They will be logged out.`)) { await act(api(`/api/users/${id}/deactivate`, { method: 'POST' }), 'Deactivated'); loadUsers(); } }
        else if (b.dataset.act === 'reactivate') { await act(api(`/api/users/${id}/reactivate`, { method: 'POST' }), 'Reactivated'); loadUsers(); }
        else if (b.dataset.act === 'edit') editUser(users.find((x) => String(x.id) === id));
      };
    });
  } catch (e) { $('users-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function editUser(u) {
  const projects = await projectOptions();
  const mine = (await api(`/api/users/${u.id}/projects`)).data.projects;
  const v = await openForm({
    title: `Edit ${u.name}`,
    fields: [
      { name: 'name', label: 'Full name', value: u.name, required: true }, { name: 'phone', label: 'Mobile', value: u.phone },
      { name: 'role', label: 'Role', type: 'select', options: u.role === 'owner' ? [['owner', 'owner']] : roleOpts(), value: u.role },
      ...projects.map(([id, n]) => ({ name: 'p' + id, type: 'checkbox', label: n, checkLabel: `Can see project: ${n}`, value: mine.includes(id) })),
    ],
  });
  if (!v) return;
  const r = await act(api(`/api/users/${u.id}`, { method: 'PUT', body: { name: v.name, phone: v.phone, role: v.role, projects: projects.filter(([id]) => v['p' + id]).map(([id]) => id) } }), 'Saved');
  if (r) loadUsers();
}

// ---------- Documents / Settings / Audit / Notifications ----------
function renderDocuments(main) {
  const canAdd = ['owner', 'pm'].includes(currentUser.role);
  main.innerHTML = `<h1>Documents</h1>${canAdd ? '<div class="row-btns" style="margin-bottom:16px"><button class="btn btn-primary" id="doc-up">⬆ Upload file</button><button class="btn" id="doc-link">🔗 Add link</button></div>' : ''}<div id="docs-list">Loading...</div>`;
  if (canAdd) { $('doc-up').onclick = uploadDoc; $('doc-link').onclick = addDocLink; }
  loadDocuments();
}

const DOC_CATS = [['other', 'Other'], ['drawing', 'Drawing'], ['approval', 'Approval / NOC'], ['legal', 'Legal / agreement'], ['brochure', 'Brochure'], ['photo', 'Site photo'], ['invoice', 'Invoice / bill']];

async function uploadDoc() {
  const v = await openForm({ title: 'Upload file', intro: 'JPG, PNG, PDF, Word, Excel or CSV. Photos are shrunk automatically. Up to 1.5 MB while files are stored in the database.', fields: [
    { name: 'file', label: 'File', type: 'file', required: true },
    { name: 'title', label: 'Title', required: true }, { name: 'project_id', label: 'Project', type: 'select', options: [['', '— none —'], ...(await projectOptions())] },
    { name: 'category', label: 'Type', type: 'select', options: DOC_CATS },
    { name: 'audience', label: 'Who may see it', type: 'select', options: [['internal', 'Our team only'], ['customer', 'Can be shared with customers']] }] });
  if (!v) return;
  let file = v.file;
  if (!file) return;
  file = await compressFile(file);
  const fd = new FormData();
  fd.append('file', file, v.file.name);
  fd.append('title', v.title); fd.append('category', v.category); fd.append('audience', v.audience);
  if (v.project_id) fd.append('project_id', v.project_id);
  if (await act(api('/api/files/upload', { method: 'POST', body: fd }), 'Uploaded')) loadDocuments();
}

async function addDocLink() {
  const v = await openForm({ title: 'Add link', intro: 'Paste a Google Drive / Dropbox link for big files.', fields: [
    { name: 'title', label: 'Title', required: true }, { name: 'external_url', label: 'Link (https://…)', type: 'url', required: true },
    { name: 'project_id', label: 'Project', type: 'select', options: [['', '— none —'], ...(await projectOptions())] }, { name: 'category', label: 'Type', type: 'select', options: DOC_CATS }] });
  if (!v) return;
  if (!/^https:\/\//i.test(v.external_url)) { toast('The link must start with https://'); return; }
  const body = { title: v.title, kind: 'link', external_url: v.external_url, category: v.category, project_id: v.project_id ? Number(v.project_id) : null };
  if (await act(api('/api/documents', { method: 'POST', body }), 'Link added')) loadDocuments();
}

function loadDocuments() {
  api('/api/documents').then((d) => {
    $('docs-list').innerHTML = d.data.documents.length
      ? d.data.documents.map((x) => `<div class="card"><h3>${esc(x.title)}</h3><p class="muted">${esc(x.category || '')} · ${esc(dateIST(x.created_at))}${x.audience === 'customer' ? ' · shareable' : ''}</p>${x.audience === 'customer' && userCanClient('share', 'C') ? `<button class="btn small" data-share="${x.id}">Send to customer</button> ` : ''}${x.kind === 'link' && /^https:\/\//i.test(x.external_url || '') ? `<a class="btn small" href="${esc(x.external_url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : (x.blob_id || x.drive_file_id ? `<a class="btn small" href="/api/files/download/${x.id}">Download</a>` : '')}</div>`).join('')
      : '<div class="empty-state"><p>No documents yet.</p></div>';
    $('docs-list').querySelectorAll('[data-share]').forEach((b) => { b.onclick = () => shareDoc(b.dataset.share); });
  }).catch((e) => { $('docs-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

async function shareDoc(docId) {
  const v = await openForm({ title: 'Send to customer', intro: 'Creates a private link that expires. You can cancel it any time under More → Shared links.', fields: [
    { name: 'recipient_label', label: 'Who is it for?', required: true }, { name: 'max_views', label: 'Stop after this many opens (optional)', type: 'number' }] });
  if (!v) return;
  const r = await act(api('/api/share-links', { method: 'POST', body: { document_id: Number(docId), recipient_label: v.recipient_label, max_views: v.max_views || null } }));
  if (!r) return;
  const url = location.origin + r.data.link;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Link ready</h2><p style="word-break:break-all">${esc(url)}</p><div class="modal-actions"><button class="btn" id="sh-copy">Copy</button><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Here is the document you asked for: ' + url)}">WhatsApp</a><button class="btn" id="sh-done">Done</button></div></div>`;
  document.body.appendChild(ov);
  $('sh-copy').onclick = () => copyText(url); $('sh-done').onclick = () => ov.remove();
}

function renderShareLinks(main) {
  main.innerHTML = '<h1>Shared links</h1><p class="help">Links sent to customers. Cancel one and it stops working at once.</p><div id="share-links-list">Loading...</div>';
  api('/api/share-links').then((d) => {
    $('share-links-list').innerHTML = d.data.links.map((l) => `<div class="card"><div class="row"><div><b>${esc(l.title)}</b><p class="muted">For ${esc(l.recipient_label || '—')} · expires ${esc(dateIST(l.expires_at))} · opened ${esc(l.view_count)}${l.max_views ? ' of ' + esc(l.max_views) : ''} times</p></div><button class="btn small" data-revoke="${l.id}" style="color:#dc2626">Cancel link</button></div></div>`).join('') || '<div class="empty-state"><p>No active links.</p></div>';
    $('share-links-list').querySelectorAll('[data-revoke]').forEach((b) => { b.onclick = async () => { if (confirm('Cancel this link?') && await act(api(`/api/share-links/${b.dataset.revoke}/revoke`, { method: 'POST' }), 'Link cancelled')) renderShareLinks(main); }; });
  }).catch((e) => { $('share-links-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

const SETTING_LABELS = {
  'po.pm_approval_limit_paise': ['PM approval limit for purchase orders (₹)', 'money'],
  'access.allow_second_owner': ['Allow a second Owner', 'onoff'],
  'sales.share_all_leads': ['Sales team can see everyone’s leads', 'onoff'],
  'demand.due_days_after_milestone': ['Days to pay after a milestone is done', 'number'],
  'share.default_expiry_days': ['Customer link expiry (days)', 'number'],
  'files.brochure_max_mb': ['Biggest upload allowed (MB)', 'number'],
};

function renderSettings(main) {
  main.innerHTML = '<h1>Settings</h1><div id="settings-list">Loading...</div>';
  api('/api/settings').then((d) => {
    const s = d.data.settings;
    $('settings-list').innerHTML = Object.entries(SETTING_LABELS).map(([k, [label, kind]]) => {
      const v = s[k];
      const shown = kind === 'money' ? ((Number(v) || 0) / 100) : (v == null ? '' : v);
      const input = kind === 'onoff'
        ? `<select data-key="${k}" data-kind="${kind}"><option value="off"${v !== 'on' ? ' selected' : ''}>Off</option><option value="on"${v === 'on' ? ' selected' : ''}>On</option></select>`
        : `<input data-key="${k}" data-kind="${kind}" inputmode="decimal" value="${esc(shown)}">`;
      return `<div class="field"><label>${esc(label)}</label>${input}</div>`;
    }).join('') + '<button class="btn btn-primary" id="settings-save">Save settings</button>';
    $('settings-save').onclick = async () => {
      for (const el of $('settings-list').querySelectorAll('[data-key]')) {
        let v = el.value;
        if (el.dataset.kind === 'money') v = rupeesToPaise(v); else if (el.dataset.kind === 'number') v = Number(v);
        const ok = await act(api('/api/settings/' + encodeURIComponent(el.dataset.key), { method: 'POST', body: { value: v } }));
        if (!ok) return;
      }
      toast('Settings saved');
    };
  }).catch((e) => { $('settings-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

function renderAudit(main) {
  main.innerHTML = '<h1>Audit log</h1><div id="audit-list">Loading...</div>';
  api('/api/audit').then((d) => {
    $('audit-list').innerHTML = d.data.audit.map((a) => `<div class="card"><b>${esc(a.name || 'System')}</b> — ${esc(a.summary)}<p class="muted">${esc(dateIST(a.created_at))}</p></div>`).join('') || '<div class="empty-state"><p>Nothing yet.</p></div>';
  }).catch((e) => { $('audit-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

function renderNotifications(main) {
  main.innerHTML = '<h1>Notifications</h1><div id="notif-list">Loading...</div>';
  api('/api/notifications').then((d) => {
    const list = d.data.notifications;
    $('notif-list').innerHTML = list.map((n) => `<div class="card" style="${n.read_at ? '' : 'border-left:4px solid #1d4ed8'}"><b>${esc(n.title)}</b><p>${esc(n.body || '')}</p><p class="muted">${esc(dateIST(n.created_at))}</p></div>`).join('') || '<div class="empty-state"><p>No notifications.</p></div>';
    list.filter((n) => !n.read_at).forEach((n) => api(`/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {}));
    setTimeout(refreshBell, 800);
  }).catch((e) => { $('notif-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

// ---------- Approvals ----------
const CAT_ORDER = [['approval', 'Approvals'], ['noc', 'NOCs'], ['compliance', 'Compliance'], ['renewal', 'Renewals']];
function daysLeft(d) {
  if (!d) return '';
  const n = Math.round((new Date(d) - new Date(today())) / 86400000);
  if (n < 0) return chip(`Expired ${-n} days ago`, 'bad');
  return chip(`${n} days left`, n <= 30 ? 'warn' : 'info');
}

function renderApprovals(main) {
  const canC = ['owner', 'pm'].includes(currentUser.role);
  main.innerHTML = `<h1>Approvals & Compliance</h1><p class="help">Dates are reminders only. Confirm deadlines with your architect and CA.</p>${canC ? '<button class="btn btn-primary" id="apr-new" style="margin-bottom:16px">+ Add item</button>' : ''}<div id="approvals-list">Loading...</div>`;
  if (canC) $('apr-new').onclick = newApproval;
  loadApprovals();
}

async function newApproval() {
  const v = await openForm({ title: 'New approval item', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'name', label: 'Item', required: true }, { name: 'authority', label: 'Authority (e.g. MCGM)' },
    { name: 'category', label: 'Type', type: 'select', options: CAT_ORDER },
    { name: 'valid_till', label: 'Valid till', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea' }] });
  if (!v) return;
  v.project_id = Number(v.project_id); if (!v.valid_till) delete v.valid_till;
  if (await act(api('/api/approvals', { method: 'POST', body: v }), 'Added')) loadApprovals();
}

async function loadApprovals() {
  try {
    const items = (await api('/api/approvals')).data.items;
    const list = $('approvals-list');
    if (!items.length) { list.innerHTML = '<div class="empty-state"><p>No items yet. Open Projects and tap “Load Mumbai approvals checklist”.</p></div>'; return; }
    const soon = items.filter((a) => a.valid_till && a.status === 'approved' && (new Date(a.valid_till) - new Date(today())) / 86400000 <= 30);
    let html = soon.length ? `<div class="card" style="border-color:#f59e0b;background:#fffbeb"><b>${soon.length} approval${soon.length > 1 ? 's' : ''} expiring within 30 days</b></div>` : '';
    for (const [cat, label] of CAT_ORDER) {
      const group = items.filter((a) => (a.category || 'approval') === cat);
      if (!group.length) continue;
      html += `<h3>${label}</h3>` + group.map((a) => `<div class="card clickable" data-id="${a.id}"><div class="row"><div><b>${esc(a.name)}</b><p class="muted">${esc(a.authority || '')}</p></div>${statusChip(a.status)}</div><div>${daysLeft(a.valid_till)}</div></div>`).join('');
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-id]').forEach((c) => { c.onclick = () => approvalDetail(Number(c.dataset.id)); });
  } catch (e) { $('approvals-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function approvalDetail(id) {
  const d = (await api('/api/approvals/' + id)).data;
  const a = d.item;
  const canE = userCanClient('approvals', 'E');
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(a.name)}</h2><p class="muted">${esc(a.authority || '')} · ${statusChip(a.status)}</p>
    <p>Applied: ${esc(a.applied_on || '—')} · Approved: ${esc(a.approved_on || '—')} · Valid till: ${esc(a.valid_till || '—')}</p>
    ${a.notes ? `<p class="muted">Documents needed: ${esc(a.notes)}</p>` : ''}
    ${canE ? `<div class="row-btns">${[['applied', 'Mark applied'], ['query', 'Query received'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['expired', 'Expired']].map(([e, l]) => `<button class="btn small" data-ev="${e}">${l}</button>`).join('')}</div>` : ''}
    <h3 style="margin-top:16px">Timeline</h3>${d.events.map((e) => `<p>• <b>${esc(e.event)}</b> ${e.note ? '— ' + esc(e.note) : ''} <span class="muted">${esc(dateIST(e.created_at))}</span></p>`).join('') || '<p class="muted">No activity yet.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="ad-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  $('ad-close').onclick = () => ov.remove();
  ov.querySelectorAll('[data-ev]').forEach((b) => {
    b.onclick = async () => {
      const ev = b.dataset.ev;
      const needDate = ev === 'applied' || ev === 'approved';
      const v = await openForm({ title: b.textContent, fields: [...(needDate ? [{ name: 'date', label: 'Date', type: 'date', value: today() }] : []), ...(ev === 'approved' ? [{ name: 'valid_till', label: 'Valid till (if it expires)', type: 'date' }] : []), { name: 'note', label: 'Note', type: 'textarea' }] });
      if (!v) return;
      const body = { event: ev, note: v.note };
      if (ev === 'applied') body.applied_on = v.date; if (ev === 'approved') body.approved_on = v.date;
      if (await act(api(`/api/approvals/${id}/event`, { method: 'POST', body }), 'Saved')) { ov.remove(); loadApprovals(); }
    };
  });
}

// Client-side permission hint only (the server enforces everything).
function userCanClient(module, action) {
  const r = currentUser.role;
  const deny = { share: { C: ['owner', 'pm', 'sales'] }, approvals: { E: ['owner', 'pm'] }, drawings: { C: ['owner', 'pm'], A: ['owner', 'pm'] }, site: { C: ['owner', 'pm', 'site'] }, procurement: { C: ['owner', 'pm', 'accounts', 'purchase', 'site'], E: ['owner', 'pm', 'accounts', 'purchase'], A: ['owner', 'pm'] }, sales: { C: ['owner', 'pm', 'sales', 'accounts'], E: ['owner', 'pm', 'sales', 'accounts'], A: ['owner', 'pm'] } };
  return ((deny[module] || {})[action] || []).includes(r);
}

// ---------- Drawings ----------
function renderDrawings(main) {
  main.innerHTML = `<h1>Drawings</h1>${userCanClient('drawings', 'C') ? '<button class="btn btn-primary" id="drw-new" style="margin-bottom:12px">+ New drawing</button>' : ''}
    <div class="field"><input id="drw-q" placeholder="Search by code, e.g. STR-A-501"></div><div id="drawings-list">Loading...</div>`;
  if (userCanClient('drawings', 'C')) $('drw-new').onclick = newDrawing;
  loadDrawings();
}

async function newDrawing() {
  const v = await openForm({ title: 'New drawing', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'code', label: 'Drawing code', required: true, placeholder: 'STR-A-501' }, { name: 'title', label: 'Title', required: true },
    { name: 'discipline', label: 'Discipline', type: 'select', options: [['arch', 'Architectural'], ['struct', 'Structural'], ['mep', 'MEP'], ['fire', 'Fire'], ['landscape', 'Landscape'], ['interior', 'Interior']] },
    { name: 'zone', label: 'Wing / zone' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await act(api('/api/drawings', { method: 'POST', body: v }), 'Drawing added')) loadDrawings();
}

async function loadDrawings() {
  try {
    const all = (await api('/api/drawings')).data.drawings;
    const draw = () => {
      const q = ($('drw-q').value || '').toLowerCase();
      const rows = all.filter((d) => !q || d.code.toLowerCase().includes(q) || d.title.toLowerCase().includes(q));
      $('drawings-list').innerHTML = rows.map((d) => `<div class="card clickable" data-id="${d.id}"><div class="row"><div><b>${esc(d.code)}</b><p class="muted">${esc(d.title)} · ${esc(d.discipline)}${d.zone ? ' · ' + esc(d.zone) : ''}</p></div>${d.current_ifc_rev ? chip(d.current_ifc_rev + ' · IFC', 'good') : chip('No IFC yet', 'warn')}</div></div>`).join('')
        || `<div class="empty-state"><p>${currentUser.role === 'site' ? 'No drawings have been issued for construction yet.' : 'No drawings yet.'}</p></div>`;
      $('drawings-list').querySelectorAll('[data-id]').forEach((c) => { c.onclick = () => drawingDetail(all.find((x) => String(x.id) === c.dataset.id)); });
    };
    $('drw-q').oninput = draw; draw();
  } catch (e) { $('drawings-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function drawingDetail(d) {
  const revs = (await api(`/api/drawings/${d.id}/revisions`)).data.revisions;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(d.code)}</h2><p class="muted">${esc(d.title)}</p>
    ${revs.map((r) => `<div class="card"><div class="row"><b>${esc(r.rev_no)}</b>${statusChip(r.status)}</div><p class="muted">${r.issued_on ? 'Issued ' + esc(r.issued_on) : 'Not issued'}${r.received_from ? ' · from ' + esc(r.received_from) : ''}</p>${r.status === 'superseded' ? '<p style="color:#dc2626"><b>SUPERSEDED — do not build from this.</b></p>' : ''}${r.note ? `<p>${esc(r.note)}</p>` : ''}</div>`).join('') || '<p class="muted">No revisions yet.</p>'}
    <div class="modal-actions">${userCanClient('drawings', 'C') ? '<button class="btn" id="drw-rev">Issue new revision</button>' : ''}<button class="btn btn-primary" id="drw-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  $('drw-close').onclick = () => ov.remove();
  const rb = $('drw-rev');
  if (rb) rb.onclick = async () => {
    const v = await openForm({ title: `New revision of ${d.code}`, fields: [
      { name: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft (office only)'], ['ifc', 'Issued For Construction']], help: 'Issuing IFC supersedes the previous IFC and tells site and PM.' },
      { name: 'received_from', label: 'Received from (architect / engineer)' }, { name: 'note', label: 'What changed', type: 'textarea' }] });
    if (!v) return;
    const r = await act(api(`/api/drawings/${d.id}/revisions`, { method: 'POST', body: v }));
    if (r) { toast(`${r.data.rev_no} saved`); ov.remove(); loadDrawings(); }
  };
}

// ---------- Site ----------
function renderSite(main) {
  const pending = readQueue().length;
  main.innerHTML = `<h1>${esc(t('Site work'))}</h1>${pending ? `<div class="card" style="background:#fffbeb;border-color:#f59e0b">${esc(t('Waiting to send'))}: <b>${pending}</b> <button class="btn small" id="s-sync">${esc(t('Send now'))}</button></div>` : ''}<div class="grid">
    <button class="btn btn-primary btn-full" id="s-dpr">📷 ${esc(t("Today's work report"))}</button>
    <button class="btn btn-full" id="s-snag">⚠ ${esc(t('Raise a snag'))}</button>
    ${userCanClient('site', 'C') && currentUser.role !== 'site' ? '<button class="btn btn-full" id="s-ms">📐 Add milestone</button>' : ''}</div><div id="site-list">Loading...</div>`;
  $('s-dpr').onclick = newDpr; $('s-snag').onclick = newSnag;
  if ($('s-sync')) $('s-sync').onclick = async () => { await syncQueue(); renderSite(main); };
  if ($('s-ms')) $('s-ms').onclick = newMilestone;
  loadSite();
}

async function newDpr() {
  const v = await openForm({ title: t("Today's work report"), submit: t('Save'), fields: [
    { name: 'project_id', label: t('Project'), type: 'select', options: await projectOptions() },
    { name: 'report_date', label: t('Date'), type: 'date', value: today() },
    { name: 'work_summary', label: t('What work happened today?'), type: 'textarea', required: true },
    { name: 'labour_count', label: t('Labour on site'), type: 'number' }, { name: 'issues', label: t('Problems / delays'), type: 'textarea' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await postOrQueue('/api/site/dprs', v, t('Report saved'))) renderSite($('app-main'));
}

async function newSnag() {
  const v = await openForm({ title: t('Raise a snag'), submit: t('Save'), fields: [
    { name: 'project_id', label: t('Project'), type: 'select', options: await projectOptions() },
    { name: 'title', label: t('What is wrong?'), required: true }, { name: 'location', label: t('Where (wing / floor)') },
    { name: 'severity', label: t('How serious?'), type: 'select', options: [['low', t('Low')], ['medium', t('Medium')], ['high', t('High')]], value: 'medium' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await postOrQueue('/api/site/snags', v, t('Snag raised'))) renderSite($('app-main'));
}

async function newMilestone() {
  const v = await openForm({ title: 'Add milestone', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'name', label: 'Milestone', required: true, placeholder: '5th slab' }, { name: 'wing', label: 'Wing (optional)' },
    { name: 'milestone_key', label: 'Key', placeholder: 'slab5', help: 'Payment-plan stages with the same key become due when this is done.' },
    { name: 'planned_date', label: 'Planned date', type: 'date' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await act(api('/api/site/milestones', { method: 'POST', body: v }), 'Milestone added')) loadSite();
}

async function loadSite() {
  if (!$('site-list')) return;
  try {
    const [dprs, snags, ms] = await Promise.all([api('/api/site/dprs'), api('/api/site/snags'), api('/api/site/milestones')]);
    let html = `<h3>${esc(t('Milestones'))}</h3>` + (ms.data.milestones.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.name)}</b>${m.wing ? ' · ' + esc(m.wing) : ''}<p class="muted">Planned ${esc(m.planned_date || '—')}${m.actual_date ? ' · Done ' + esc(String(m.actual_date).substring(0, 10)) : ''}</p></div>${m.status === 'done' ? statusChip('done') : (userCanClient('site', 'C') ? `<button class="btn small" data-done="${m.id}">${esc(t('Done today'))}</button>` : statusChip('pending'))}</div></div>`).join('') || '<p class="muted">No milestones yet.</p>');
    html += `<h3>${esc(t('Recent reports'))}</h3>` + (dprs.data.dprs.map((d) => `<div class="card"><b>${esc(d.report_date)}</b> · ${esc(d.labour_count || 0)} labour<p>${esc(d.work_summary)}</p></div>`).join('') || '<p class="muted">No reports yet.</p>');
    html += `<h3>${esc(t('Snags'))}</h3>` + (snags.data.snags.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.title)}</b><p class="muted">${esc(s.location || '')}</p></div><div>${chip(s.severity, s.severity === 'high' ? 'bad' : s.severity === 'medium' ? 'warn' : '')} ${statusChip(s.status)}</div></div></div>`).join('') || '<p class="muted">No open snags.</p>');
    if (!$('site-list')) return;
    $('site-list').innerHTML = html;
    $('site-list').querySelectorAll('[data-done]').forEach((b) => {
      b.onclick = async () => {
        const v = await openForm({ title: 'Milestone done', fields: [{ name: 'actual_date', label: 'Date completed', type: 'date', value: today() }] });
        if (!v) return;
        const r = await act(api(`/api/site/milestones/${b.dataset.done}/done`, { method: 'POST', body: v }));
        if (r) { toast(r.data.demands_ready ? `Done. ${r.data.demands_ready} customer payment demand(s) are now ready.` : 'Marked done'); loadSite(); }
      };
    });
  } catch (e) {
    const el = $('site-list');
    if (el) el.innerHTML = `<div class="error">${esc(e instanceof TypeError ? 'You are offline. Reports you file now are saved on this phone and sent later.' : e.message)}</div>`;
  }
}

// ---------- Procurement ----------
function renderProcurement(main) {
  main.innerHTML = `<h1>Procurement</h1><div class="grid">
    <button class="btn btn-primary btn-full" id="p-po">📄 New purchase order</button>
    <button class="btn btn-full" id="p-vendor">🛒 New vendor</button>
    <button class="btn btn-full" id="p-rfq">📋 New RFQ</button></div><div id="procurement-list">Loading...</div>`;
  $('p-po').onclick = newPo; $('p-vendor').onclick = newVendor; $('p-rfq').onclick = newRfq;
  loadProcurement();
}

async function newVendor() {
  const v = await openForm({ title: 'New vendor', fields: [{ name: 'name', label: 'Vendor name', required: true }, { name: 'category', label: 'Supplies (cement, steel…)' }, { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' }, { name: 'gstin', label: 'GSTIN' }] });
  if (v && await act(api('/api/procurement/vendors', { method: 'POST', body: v }), 'Vendor added')) loadProcurement();
}

async function newRfq() {
  const v = await openForm({ title: 'New RFQ', fields: [{ name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() }, { name: 'title', label: 'What do you need?', required: true }, { name: 'qty', label: 'Quantity', type: 'number' }, { name: 'unit', label: 'Unit' }, { name: 'needed_by', label: 'Needed by', type: 'date' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await act(api('/api/procurement/rfqs', { method: 'POST', body: v }), 'RFQ added')) loadProcurement();
}

async function newPo() {
  const vendors = (await api('/api/procurement/vendors')).data.vendors;
  if (!vendors.length) { toast('Add a vendor first'); return; }
  const v = await openForm({ title: 'New purchase order', intro: 'One line item for now. Add more lines later from the PO.', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((x) => [x.id, x.name]) },
    { name: 'description', label: 'Item', required: true }, { name: 'qty', label: 'Quantity', type: 'number', required: true }, { name: 'unit', label: 'Unit' },
    { name: 'rate', label: 'Rate per unit (₹)', type: 'money', required: true },
    { name: 'gst_bp', label: 'GST', type: 'select', options: [['1800', '18%'], ['1200', '12%'], ['500', '5%'], ['0', 'None']] }, { name: 'terms', label: 'Terms', type: 'textarea' }] });
  if (!v) return;
  const body = { project_id: Number(v.project_id), vendor_id: Number(v.vendor_id), gst_bp: Number(v.gst_bp), terms: v.terms, items: [{ description: v.description, qty: v.qty, unit: v.unit, rate_paise: v.rate }] };
  if (await act(api('/api/procurement/pos', { method: 'POST', body }), 'PO created as draft')) loadProcurement();
}

const openPrint = (k, id) => window.open(`/print.html?k=${k}&id=${id}`, '_blank', 'noopener');

async function loadProcurement() {
  try {
    const noBills = currentUser.role === 'site';
    const [vendors, pos, rfqs, bills] = await Promise.all([api('/api/procurement/vendors'), api('/api/procurement/pos'), api('/api/procurement/rfqs'), noBills ? { data: { bills: [] } } : api('/api/procurement/bills')]);
    const canA = userCanClient('procurement', 'A'), canE = userCanClient('procurement', 'E');
    let html = '<h3>Purchase orders</h3>' + (pos.data.pos.map((p) => `<div class="card"><div class="row"><div><b>${esc(p.po_no)}</b><p class="muted">Total ${moneyP(p.total_paise)}</p></div>${statusChip(p.status)}</div>
      <div class="row-btns">${p.status === 'draft' && canE ? `<button class="btn small" data-po="submit" data-id="${p.id}">Send for approval</button>` : ''}${p.status === 'pending_approval' && canA ? `<button class="btn small btn-primary" data-po="approve" data-id="${p.id}">Approve</button><button class="btn small" data-po="reject" data-id="${p.id}">Reject</button>` : ''}
      ${['approved', 'part_received'].includes(p.status) ? `<button class="btn small btn-primary" data-grn="${p.id}">Material received</button>` : ''}${!noBills && canE && ['approved', 'part_received', 'received'].includes(p.status) ? `<button class="btn small" data-bill="${p.id}" data-vendor="${p.vendor_id}">Add bill</button>` : ''}
      ${!noBills ? `<button class="btn small" data-print="${p.id}">Print</button>` : ''}</div></div>`).join('') || '<p class="muted">No purchase orders yet.</p>');
    if (!noBills) html += '<h3>Bills</h3>' + (bills.data.bills.map((b) => `<div class="card"><div class="row"><div><b>${esc(b.vendor)}</b> · ${esc(b.bill_no || '')}<p class="muted">${moneyP(b.amount_paise)}${b.due_date ? ' · due ' + esc(b.due_date) : ''}${b.po_no ? ' · ' + esc(b.po_no) : ''}</p></div>${statusChip(b.status === 'received' ? 'open' : b.status)}</div>${b.status !== 'paid' && canE ? `<button class="btn small" data-pay="${b.id}">Mark paid</button>` : ''}</div>`).join('') || '<p class="muted">No bills yet.</p>');
    html += '<h3>RFQs</h3>' + (rfqs.data.rfqs.map((r) => `<div class="card clickable" data-rfq="${r.id}"><div class="row"><b>${esc(r.title)}</b>${statusChip(r.status)}</div></div>`).join('') || '<p class="muted">No RFQs.</p>');
    html += '<h3>Vendors</h3>' + (vendors.data.vendors.map((v) => `<div class="card ${noBills ? '' : 'clickable'}" data-vendor-led="${v.id}"><b>${esc(v.name)}</b><p class="muted">${esc(v.category || '')}${v.phone ? ' · ' : ''}${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}</p></div>`).join('') || '<p class="muted">No vendors yet.</p>');
    const el = $('procurement-list'); el.innerHTML = html;
    el.querySelectorAll('[data-po]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/procurement/pos/${b.dataset.id}/${b.dataset.po}`, { method: 'POST' }), 'Done')) loadProcurement(); }; });
    el.querySelectorAll('[data-print]').forEach((b) => { b.onclick = () => openPrint('po', b.dataset.print); });
    el.querySelectorAll('[data-grn]').forEach((b) => { b.onclick = () => receiveMaterial(b.dataset.grn); });
    el.querySelectorAll('[data-bill]').forEach((b) => { b.onclick = () => addBill(b.dataset.bill, b.dataset.vendor); });
    el.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Mark bill paid', fields: [{ name: 'paid_on', label: 'Paid on', type: 'date', value: today() }, { name: 'payment_ref', label: 'Payment reference' }] }); if (v && await act(api(`/api/procurement/bills/${b.dataset.pay}/pay`, { method: 'POST', body: v }), 'Marked paid')) loadProcurement(); }; });
    el.querySelectorAll('[data-rfq]').forEach((b) => { b.onclick = () => rfqDetail(b.dataset.rfq); });
    if (!noBills) el.querySelectorAll('[data-vendor-led]').forEach((b) => { b.onclick = () => vendorLedger(b.dataset.vendorLed); });
  } catch (e) { $('procurement-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function receiveMaterial(poId) {
  const v = await openForm({ title: 'Material received', fields: [
    { name: 'received_on', label: 'Date', type: 'date', value: today() }, { name: 'challan_no', label: 'Challan / delivery note no.' },
    { name: 'qty_note', label: 'What came? (quantity, condition)', type: 'textarea', required: true }, { name: 'full', type: 'checkbox', label: 'Complete', checkLabel: 'This completes the order (nothing more is due)' }] });
  if (!v) return;
  if (await postOrQueue(`/api/procurement/pos/${poId}/grn`, v, 'Receipt recorded')) loadProcurement();
}

async function addBill(poId, vendorId) {
  const v = await openForm({ title: 'Add vendor bill', fields: [{ name: 'bill_no', label: 'Bill number' }, { name: 'amount_paise', label: 'Amount (₹, with GST)', type: 'money', required: true }, { name: 'due_date', label: 'Due date', type: 'date' }] });
  if (v && await act(api('/api/procurement/bills', { method: 'POST', body: { ...v, po_id: Number(poId), vendor_id: Number(vendorId) } }), 'Bill recorded')) loadProcurement();
}

async function vendorLedger(id) {
  const d = (await api(`/api/procurement/vendors/${id}/ledger`)).data;
  const owed = d.bills.filter((b) => b.status !== 'paid').reduce((t, b) => t + b.amount_paise, 0);
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Vendor ledger</h2><p><b>Unpaid bills: ${moneyP(owed)}</b></p>
    <h3>POs</h3>${d.pos.map((p) => `<p>${esc(p.po_no)} · ${moneyP(p.total_paise)} · ${esc(p.status)}</p>`).join('') || '<p class="muted">None</p>'}
    <h3>Bills</h3>${d.bills.map((b) => `<p>${esc(b.bill_no || '—')} · ${moneyP(b.amount_paise)} · ${esc(b.status)}</p>`).join('') || '<p class="muted">None</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="vl-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('vl-close').onclick = () => ov.remove();
}

async function rfqDetail(id) {
  const d = (await api(`/api/procurement/rfqs/${id}/quotes`)).data;
  const lowest = d.quotes.length ? Math.min(...d.quotes.map((q) => q.amount_paise)) : 0;
  const fastest = d.quotes.filter((q) => q.delivery_days != null).length ? Math.min(...d.quotes.filter((q) => q.delivery_days != null).map((q) => q.delivery_days)) : null;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(d.rfq.title)}</h2>
    <p class="muted">${d.quotes.length} quote${d.quotes.length === 1 ? '' : 's'} received${d.quotes.length < 3 ? ' — get at least 3 if you can' : ''}.${d.last_paid ? ` Last paid: ${moneyP(d.last_paid.rate_paise)}/${esc(d.last_paid.unit || 'unit')} (${esc(d.last_paid.po_no)}).` : ''}</p>
    ${d.quotes.map((q) => `<div class="card"><div class="row"><div><b>${esc(q.vendor)}</b> ${q.selected ? chip('Chosen', 'good') : ''}<p class="muted">${moneyP(q.amount_paise)}${q.delivery_days != null ? ' · ' + esc(q.delivery_days) + ' days' : ''}</p></div><div>${q.amount_paise === lowest ? chip('Lowest', 'good') : ''} ${q.delivery_days != null && q.delivery_days === fastest ? chip('Fastest', 'info') : ''}</div></div>${q.terms ? `<p class="muted">${esc(q.terms)}</p>` : ''}${!q.selected && userCanClient('procurement', 'E') ? `<button class="btn small" data-sel="${q.id}">Choose this quote</button>` : ''}</div>`).join('')}
    <div class="modal-actions">${userCanClient('procurement', 'C') ? '<button class="btn" id="rq-add">Add quote</button>' : ''}<button class="btn btn-primary" id="rq-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('rq-close').onclick = () => ov.remove();
  ov.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/procurement/quotes/${b.dataset.sel}/select`, { method: 'POST' }), 'Quote chosen')) { ov.remove(); rfqDetail(id); loadProcurement(); } }; });
  if ($('rq-add')) $('rq-add').onclick = async () => {
    const vendors = (await api('/api/procurement/vendors')).data.vendors;
    const v = await openForm({ title: 'Add quote', fields: [{ name: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((x) => [x.id, x.name]) }, { name: 'rate_paise', label: 'Rate per unit (₹)', type: 'money' }, { name: 'amount_paise', label: 'Total (₹)', type: 'money', required: true }, { name: 'delivery_days', label: 'Delivery in (days)', type: 'number' }, { name: 'terms', label: 'Terms', type: 'textarea' }] });
    if (v && await act(api(`/api/procurement/rfqs/${id}/quotes`, { method: 'POST', body: { ...v, vendor_id: Number(v.vendor_id) } }), 'Quote added')) { ov.remove(); rfqDetail(id); }
  };
}

// ---------- Sales ----------
function renderSales(main) {
  const mgr = userCanClient('sales', 'C');
  main.innerHTML = `<h1>Sales</h1><div class="grid">
    <button class="btn btn-primary btn-full" id="sl-lead">🤝 New lead</button>
    ${mgr ? '<button class="btn btn-full" id="sl-inv">🏠 Add flat</button><button class="btn btn-full" id="sl-plan">📊 Payment plan</button>' : ''}</div><div id="sales-list">Loading...</div>`;
  $('sl-lead').onclick = newLead;
  if (mgr) { $('sl-inv').onclick = newUnit; $('sl-plan').onclick = editPlan; }
  loadSales();
}

async function newLead() {
  const v = await openForm({ title: 'New lead', fields: [
    { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Mobile', type: 'tel', required: true },
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'source', label: 'Source', type: 'select', options: [['walk_in', 'Walk-in'], ['referral', 'Referral'], ['online', 'Online'], ['broker', 'Broker'], ['other', 'Other']] },
    { name: 'config_pref', label: 'Wants (1BHK / 2BHK…)' },
    { name: 'consent', type: 'checkbox', label: 'Consent', checkLabel: 'Customer agreed we may contact them (DPDP consent)', value: true }] });
  if (!v) return;
  v.project_id = Number(v.project_id); if (v.consent) v.consent_at = new Date().toISOString();
  if (await act(api('/api/sales/leads', { method: 'POST', body: v }), 'Lead added')) loadSales();
}

async function newUnit() {
  const v = await openForm({ title: 'Add flat to inventory', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'wing', label: 'Wing' }, { name: 'floor', label: 'Floor', type: 'number' }, { name: 'unit_no', label: 'Flat number', required: true },
    { name: 'type', label: 'Type (2BHK…)' }, { name: 'carpet_sqft', label: 'Carpet area (sq ft)', type: 'number' }, { name: 'price_paise', label: 'Price (₹)', type: 'money', required: true }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await act(api('/api/sales/inventory', { method: 'POST', body: v }), 'Flat added')) loadSales();
}

async function editPlan() {
  const pid = (await projectOptions());
  const v = await openForm({ title: 'Payment plan', intro: 'One stage per line: name | percent | milestone key (optional). Percentages must total 100.', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: pid },
    { name: 'text', label: 'Stages', type: 'textarea', value: 'On booking | 10\n5th slab | 30 | slab5\nPossession | 60', required: true }] });
  if (!v) return;
  const stages = v.text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, p, k] = l.split('|').map((x) => x.trim()); return { stage_name: n, pct_bp: Math.round(parseFloat(p) * 100), milestone_key: k || null }; });
  await act(api('/api/sales/plan-stages', { method: 'POST', body: { project_id: Number(v.project_id), stages } }), 'Payment plan saved');
}

async function bookUnit(unit) {
  const v = await openForm({ title: `Book ${unit.wing ? unit.wing + '-' : ''}${unit.unit_no}`, intro: 'Payment demands are created from the project payment plan, to the paisa.', fields: [
    { name: 'customer_name', label: 'Customer name', required: true }, { name: 'phone', label: 'Mobile' }, { name: 'email', label: 'Email', type: 'email' },
    { name: 'agreed_price_paise', label: 'Agreed price (₹)', type: 'money', value: ((unit.price_paise + (unit.floor_rise_paise || 0)) / 100) }, { name: 'token_paise', label: 'Token received (₹)', type: 'money' }] });
  if (!v) return;
  const r = await act(api('/api/sales/bookings', { method: 'POST', body: { unit_id: unit.id, ...v } }), 'Booked');
  if (r) { if (r.data.warning) alert(r.data.warning); loadSales(); }
}

async function bookingDetail(id) {
  const d = (await api('/api/sales/bookings/' + id)).data;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(d.booking.customer_name)}</h2><p class="muted">${esc(d.booking.wing || '')}-${esc(d.booking.unit_no)} · ${moneyP(d.booking.agreed_price_paise)}</p>
    <h3>Demands</h3>${d.demands.map((x) => `<div class="card"><div class="row"><div><b>${esc(x.label)}</b><p class="muted">${moneyP(x.amount_paise)} + GST ${moneyP(x.gst_paise)}${x.due_date ? ' · due ' + esc(x.due_date) : ''}</p></div>${statusChip(x.status)}</div><div class="row-btns">${['ready', 'partial', 'scheduled'].includes(x.status) && userCanClient('sales', 'E') ? `<button class="btn small" data-rcpt="${x.id}">Record receipt</button>` : ''}<button class="btn small" data-pdem="${x.id}">Print demand letter</button></div></div>`).join('')}
    <h3>Receipts</h3>${d.receipts.map((r) => `<p>${esc(r.received_on)} · ${moneyP(r.amount_paise)}${r.tds_paise ? ' + TDS ' + moneyP(r.tds_paise) : ''} · ${esc(r.mode || '')} <button class="btn small" data-prcp="${r.id}">Print</button></p>`).join('') || '<p class="muted">None yet.</p>'}
    <div class="modal-actions">${d.booking.status !== 'cancelled' && userCanClient('sales', 'A') ? '<button class="btn" id="bk-cancel" style="color:#dc2626">Cancel booking</button>' : ''}<button class="btn btn-primary" id="bk-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  $('bk-close').onclick = () => ov.remove();
  ov.querySelectorAll('[data-pdem]').forEach((b) => { b.onclick = () => openPrint('demand', b.dataset.pdem); });
  ov.querySelectorAll('[data-prcp]').forEach((b) => { b.onclick = () => openPrint('receipt', b.dataset.prcp); });
  if ($('bk-cancel')) $('bk-cancel').onclick = async () => {
    const v = await openForm({ title: 'Cancel booking', intro: 'The flat goes back to available.', fields: [{ name: 'reason', label: 'Reason', required: true }], submit: 'Cancel booking' });
    if (v && await act(api(`/api/sales/bookings/${id}/cancel`, { method: 'POST', body: v }), 'Cancelled')) { ov.remove(); loadSales(); }
  };
  ov.querySelectorAll('[data-rcpt]').forEach((b) => {
    b.onclick = async () => {
      const v = await openForm({ title: 'Record receipt', fields: [{ name: 'amount_paise', label: 'Amount received (₹)', type: 'money', required: true }, { name: 'tds_paise', label: 'TDS deducted (₹)', type: 'money' }, { name: 'mode', label: 'Mode', type: 'select', options: [['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['upi', 'UPI'], ['cash', 'Cash']] }, { name: 'ref_no', label: 'Reference / cheque no.' }, { name: 'received_on', label: 'Date', type: 'date', value: today() }] });
      if (v && await act(api(`/api/sales/bookings/${id}/receipts`, { method: 'POST', body: { ...v, demand_id: Number(b.dataset.rcpt) } }), 'Receipt saved')) { ov.remove(); bookingDetail(id); }
    };
  });
}

async function loadSales() {
  try {
    const [leads, bookings, projects] = await Promise.all([api('/api/sales/leads'), api('/api/sales/bookings'), getProjects()]);
    const inv = (await Promise.all(projects.filter((p) => !scopeProject || p.id === scopeProject).map((p) => api('/api/sales/inventory?project_id=' + p.id).then((r) => r.data.inventory.map((u) => ({ ...u, project: p.name }))).catch(() => [])))).flat();
    let html = '<h3>Flats</h3>' + (inv.map((u) => `<div class="card"><div class="row"><div><b>${esc(u.wing ? u.wing + '-' : '')}${esc(u.unit_no)}</b> · ${esc(u.type || '')}<p class="muted">${esc(u.project)} · ${moneyP(u.price_paise)}</p></div>${statusChip(u.status)}</div>${u.status === 'available' && userCanClient('sales', 'C') ? `<button class="btn small" data-book="${u.id}">Book this flat</button>` : ''}</div>`).join('') || '<p class="muted">No flats added yet.</p>');
    html += '<h3>Bookings</h3>' + (bookings.data.bookings.map((b) => `<div class="card clickable" data-bk="${b.id}"><div class="row"><div><b>${esc(b.customer_name)}</b> · ${esc(b.wing || '')}-${esc(b.unit_no)}<p class="muted">${moneyP(b.collected_paise)} of ${moneyP(b.agreed_price_paise)} collected</p></div>${statusChip(b.status)}</div></div>`).join('') || '<p class="muted">No bookings yet.</p>');
    html += '<h3>Leads</h3>' + (leads.data.leads.map((l) => `<div class="card"><div class="row"><div><b>${esc(l.name)}</b><p class="muted"><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a> · ${esc(l.source || '')}</p></div>${statusChip(l.status)}</div></div>`).join('') || '<p class="muted">No leads yet.</p>');
    const el = $('sales-list'); el.innerHTML = html;
    el.querySelectorAll('[data-book]').forEach((b) => { b.onclick = () => bookUnit(inv.find((u) => String(u.id) === b.dataset.book)); });
    el.querySelectorAll('[data-bk]').forEach((b) => { b.onclick = () => bookingDetail(b.dataset.bk); });
  } catch (e) { $('sales-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ---------- Init extras ----------
document.addEventListener('DOMContentLoaded', () => {
  $('bell-icon').innerHTML = icon('bell');
  $('btn-help').innerHTML = icon('help');
  $('btn-bell').onclick = () => navigate('notifications');
  $('btn-help').onclick = () => navigate('help');
  $('menu-password').onclick = () => { $('user-menu').style.display = 'none'; navigate('password'); };
  if (location.hash === '#drive=ok' || location.hash === '#storage') { currentPage = 'storage'; if (location.hash === '#drive=ok') setTimeout(() => toast('Google Drive connected'), 800); history.replaceState(null, '', location.pathname); }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// ---------- Login (password or emailed code) ----------
function renderLogin() {
  document.body.classList.add('guest');
  document.title = 'Sign in — NirmaanCRM';
  $('app-main').innerHTML = `
    <div class="login-card">
      <div class="brand"><div class="logo-mark">N</div></div>
      <h1>Welcome back</h1>
      <p class="sub">Sign in to NirmaanCRM</p>
      <div class="field"><label for="login-email">Email</label><input type="email" id="login-email" autocomplete="username" placeholder="you@yourcompany.in"></div>
      <div id="login-pw-block">
        <div class="field"><label for="login-password">Password</label><div class="password-input"><input type="password" id="login-password" autocomplete="current-password"><button type="button" id="login-toggle">Show</button></div></div>
        <div class="error" id="login-error" style="display:none;"></div>
        <button class="btn btn-primary btn-full" id="login-btn">Sign in</button>
      </div>
      <div id="login-otp-block" style="display:none;margin-top:12px">
        <button class="btn btn-full" id="otp-send">Email me a login code instead</button>
        <div id="otp-enter" style="display:none;margin-top:12px"><div class="field"><label for="otp-code">6-digit code from your email</label><input id="otp-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><button class="btn btn-primary btn-full" id="otp-verify">Sign in with code</button></div>
      </div>
      <p class="help" style="text-align:center;margin-top:18px">First time? Use the temporary password you were given. You will then choose your own.</p>
      <p class="help" style="text-align:center"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
    </div>`;
  const err = (m) => { const e = $('login-error'); e.textContent = m; e.style.display = 'block'; };
  $('login-toggle').onclick = () => { const i = $('login-password'); i.type = i.type === 'password' ? 'text' : 'password'; };
  const go = async () => {
    $('login-error').style.display = 'none';
    try { await api('/api/auth/login', { method: 'POST', body: { email: $('login-email').value.trim(), password: $('login-password').value } }); await loadUser(); }
    catch (e) { err(e.message); }
  };
  $('login-btn').onclick = go;
  $('login-password').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  api('/api/auth/methods').then((m) => { if (m.data.otp) $('login-otp-block').style.display = 'block'; }).catch(() => {});
  $('otp-send').onclick = async () => {
    const email = $('login-email').value.trim();
    if (!email) { err('Type your email first.'); return; }
    try { const r = await api('/api/auth/otp/send', { method: 'POST', body: { email } }); toast(r.data.message, 6000); $('otp-enter').style.display = 'block'; $('otp-code').focus(); $('login-error').style.display = 'none'; }
    catch (e) { err(e.message); }
  };
  $('otp-verify').onclick = async () => {
    try { await api('/api/auth/otp/verify', { method: 'POST', body: { email: $('login-email').value.trim(), code: $('otp-code').value.trim() } }); await loadUser(); }
    catch (e) { err(e.message); }
  };
}

// ---------- Storage (Google Drive) ----------
function renderStorage(main) {
  main.innerHTML = `<h1>Storage</h1>
    <div class="card" id="drv-card" style="max-width:640px">Loading...</div>
    <div class="card" style="max-width:640px"><h2>Where new files go</h2>
      <label class="check"><input type="radio" name="sd" value="gdrive" id="sd-gdrive"> Google Drive (recommended, big files)</label>
      <label class="check" style="margin-top:8px"><input type="radio" name="sd" value="d1" id="sd-d1"> Database (small files only, max 1.5 MB)</label></div>`;
  $('sd-gdrive').onchange = () => saveDriver('gdrive'); $('sd-d1').onchange = () => saveDriver('d1');
  loadStorageStatus();
}

async function saveDriver(driver) {
  if (await act(api('/api/storage/driver', { method: 'POST', body: { driver } }), 'Saved')) loadStorageStatus();
}

async function loadStorageStatus() {
  const card = $('drv-card'); if (!card) return;
  try {
    const d = (await api('/api/storage/status')).data;
    $('sd-gdrive').checked = d.driver === 'gdrive'; $('sd-d1').checked = d.driver === 'd1';
    const gb = (n) => (n / 1073741824).toFixed(1);
    if (d.gdriveStatus === 'connected') {
      card.innerHTML = `<div class="row"><div><h2>Google Drive</h2><p class="muted">Connected as <b>${esc(d.accountEmail || 'your Google account')}</b></p></div>${chip('Connected', 'good')}</div>
        ${d.quota ? `<p style="margin-top:10px">Account storage: <b>${gb(d.quota.usage)} GB</b> of ${gb(d.quota.limit)} GB (${d.quota.percent}%)</p>` : '<p class="muted" style="margin-top:10px">Storage meter unavailable.</p>'}
        <div class="row-btns"><button class="btn btn-primary" id="drv-test">Test upload</button><button class="btn" id="drv-off" style="color:#dc2626">Disconnect</button></div><div id="drv-result"></div>`;
      $('drv-test').onclick = async () => {
        $('drv-result').innerHTML = '<p class="muted">Testing...</p>';
        try { const r = await api('/api/storage/test', { method: 'POST' }); $('drv-result').innerHTML = `<p style="color:#15803d"><b>Works.</b> ${esc(r.data.steps.join(' → '))}</p>`; }
        catch (e) { $('drv-result').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
      };
      $('drv-off').onclick = async () => { if (confirm('Disconnect Google Drive? Files stay in Drive, but the CRM cannot open them until you reconnect.') && await act(api('/api/storage/google/disconnect', { method: 'POST' }), 'Disconnected')) loadStorageStatus(); };
    } else {
      const re = d.gdriveStatus === 'needs_reconnect';
      card.innerHTML = `<div class="row"><div><h2>Google Drive</h2><p class="muted">${re ? 'Google asked us to sign in again.' : 'Not connected. New files are saved in the database (max 1.5 MB each).'}</p></div>${chip(re ? 'Reconnect needed' : 'Not connected', re ? 'bad' : '')}</div>
        <p class="help">You will be sent to Google to sign in with the account that should hold the files, then brought back here. The CRM only sees files it creates itself.</p>
        <div class="row-btns"><button class="btn btn-primary" id="drv-on">${re ? 'Reconnect' : 'Connect'} Google Drive</button></div><div id="drv-result"></div>`;
      $('drv-on').onclick = async () => {
        $('drv-on').disabled = true;
        try { const r = await api('/api/storage/google/start', { method: 'POST' }); location.href = r.data.authUrl; }
        catch (e) { $('drv-on').disabled = false; $('drv-result').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
      };
    }
  } catch (e) { card.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ---------- Email settings ----------
function renderEmailSettings(main) {
  main.innerHTML = '<h1>Email settings</h1><div id="email-box">Loading...</div><h3 style="margin-top:24px">Recent emails</h3><div id="email-log"></div>';
  loadEmailSettings();
}

async function loadEmailSettings() {
  try {
    const s = (await api('/api/email/settings')).data;
    const presets = { custom: ['', 465, 'ssl'], gmail: ['smtp.gmail.com', 465, 'ssl'], zoho: ['smtp.zoho.in', 465, 'ssl'], hostinger: ['smtp.hostinger.com', 465, 'ssl'], outlook: ['smtp.office365.com', 587, 'starttls'] };
    $('email-box').innerHTML = `
      <p class="help">Emails go from your own company address. Gmail, Zoho and Outlook need an <b>app password</b>, not your normal one. The password is stored encrypted.</p>
      <div class="field"><label>Provider preset</label><select id="em-preset">${Object.keys(presets).map((k) => `<option value="${k}">${k === 'custom' ? 'Custom / other' : k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></div>
      <div class="field"><label>Send using</label><select id="em-provider"><option value="smtp"${s.provider === 'smtp' ? ' selected' : ''}>My own mail server (SMTP)</option><option value="brevo_api"${s.provider === 'brevo_api' ? ' selected' : ''}>Brevo (API key)</option></select></div>
      <div class="field"><label>Mail server</label><input id="em-host" value="${esc(s.host)}" placeholder="smtp.yourcompany.in"></div>
      <div class="field"><label>Port</label><input id="em-port" inputmode="numeric" value="${esc(s.port)}"></div>
      <div class="field"><label>Security</label><select id="em-sec"><option value="ssl"${s.security === 'ssl' ? ' selected' : ''}>SSL/TLS (port 465, recommended)</option><option value="starttls"${s.security === 'starttls' ? ' selected' : ''}>STARTTLS (port 587)</option></select></div>
      <div class="field"><label>Username</label><input id="em-user" value="${esc(s.username)}" autocomplete="off"></div>
      <div class="field"><label>Password ${s.password_set ? '(saved — leave blank to keep)' : ''}</label><input id="em-pass" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Brevo API key ${s.brevo_key_set ? '(saved — leave blank to keep)' : ''}</label><input id="em-brevo" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Sender name</label><input id="em-fname" value="${esc(s.from_name)}"></div>
      <div class="field"><label>Sender address</label><input id="em-from" type="email" value="${esc(s.from_email)}" placeholder="crm@yourcompany.in"></div>
      <div class="row-btns"><button class="btn btn-primary" id="em-save">Save</button><button class="btn" id="em-test">Send test email to me</button><button class="btn" id="em-digest">Send morning report now</button></div>
      <p class="help">Login by emailed code is <b>${s.otp_enabled ? 'ON' : 'OFF'}</b>. It switches on after a successful test email.</p>`;
    $('em-preset').onchange = () => { const p = presets[$('em-preset').value]; if (p[0]) { $('em-host').value = p[0]; $('em-port').value = p[1]; $('em-sec').value = p[2]; } };
    const body = () => ({ provider: $('em-provider').value, host: $('em-host').value, port: $('em-port').value, security: $('em-sec').value, username: $('em-user').value, password: $('em-pass').value, brevo_key: $('em-brevo').value, from_name: $('em-fname').value, from_email: $('em-from').value });
    $('em-save').onclick = async () => { if (await act(api('/api/email/settings', { method: 'POST', body: body() }), 'Saved. Now send a test email.')) loadEmailSettings(); };
    $('em-test').onclick = async () => {
      if (!await act(api('/api/email/settings', { method: 'POST', body: body() }))) return;
      toast('Sending...');
      const r = await act(api('/api/email/test', { method: 'POST' }));
      if (r) { r.data.sent ? toast(`Test email sent to ${r.data.to}`, 6000) : alert('Could not send: ' + r.data.error); loadEmailSettings(); }
    };
    $('em-digest').onclick = async () => { const r = await act(api('/api/email/digest-now', { method: 'POST' })); if (r) { r.data.sent ? toast('Sent to your email') : alert('Could not send: ' + r.data.error); loadEmailLog(); } };
    loadEmailLog();
  } catch (e) { $('email-box').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function loadEmailLog() {
  try {
    const rows = (await api('/api/email/log')).data.emails;
    $('email-log').innerHTML = rows.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.subject)}</b><p class="muted">To ${esc(m.to_email)} · ${esc(dateIST(m.created_at))}</p>${m.error ? `<p style="color:#dc2626">${esc(m.error)}</p>` : ''}</div>${statusChip(m.status === 'sent' ? 'done' : m.status === 'failed' ? 'rejected' : 'draft').replace(/>[^<]*</, '>' + esc(m.status) + '<')}</div></div>`).join('') || '<p class="muted">Nothing sent yet.</p>';
  } catch (e) { /* ignore */ }
}
