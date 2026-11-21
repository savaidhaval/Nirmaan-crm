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
  if (!projectCache || force) projectCache = (await api('/api/projects')).data.projects;
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
    ov.innerHTML = `<div class="modal"><h2>${esc(title)}</h2>${intro ? `<p class="help">${esc(intro)}</p>` : ''}<form id="modal-form">${rows}<div class="error" id="modal-error" style="display:none"></div><div class="modal-actions"><button type="button" class="btn" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-primary">${esc(submit)}</button></div></form></div>`;
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
          const er = $('modal-error'); er.textContent = `Please fill in: ${f.label}`; er.style.display = 'block'; el.focus(); return;
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

// ---------- Navigation ----------
function getBottomNavItems(role) {
  const home = { label: 'Home', route: 'home' };
  const more = { label: 'More', route: 'more' };
  const maps = {
    owner: [{ label: 'Home', route: 'dashboard' }, { label: 'Projects', route: 'projects' }, { label: 'Approvals', route: 'approvals' }, { label: 'Sales', route: 'sales' }, more],
    pm: [home, { label: 'Site', route: 'site' }, { label: 'Approvals', route: 'approvals' }, { label: 'Drawings', route: 'drawings' }, more],
    site: [home, { label: 'Drawings', route: 'drawings' }, { label: 'Site', route: 'site' }, more],
    sales: [home, { label: 'Sales', route: 'sales' }, more],
    accounts: [home, { label: 'Sales', route: 'sales' }, { label: 'Procurement', route: 'procurement' }, more],
    purchase: [home, { label: 'Procurement', route: 'procurement' }, { label: 'Drawings', route: 'drawings' }, more],
    hr: [home, more],
    viewer: [home, { label: 'Projects', route: 'projects' }, more],
  };
  return maps[role] || maps.viewer;
}

const PAGES = {
  home: renderHome, dashboard: renderDashboard, projects: renderProjects, users: renderUsers, documents: renderDocuments,
  settings: renderSettings, approvals: renderApprovals, drawings: renderDrawings, site: renderSite, procurement: renderProcurement,
  sales: renderSales, storage: renderStorage, branding: renderBranding, sharelinks: renderShareLinks, more: renderMore,
  audit: renderAudit, notifications: renderNotifications, help: renderHelp, password: renderChangePassword, email: renderEmailSettings,
};

function renderApp() {
  const main = $('app-main');
  if (!currentUser) { renderLogin(); return; }
  const tradeName = $('topbar-trade-name');
  if (tradeName) tradeName.textContent = currentUser.name;
  const nav = $('bottom-nav');
  if (nav) {
    nav.innerHTML = '';
    getBottomNavItems(currentUser.role).forEach((item) => {
      const a = document.createElement('a');
      a.className = 'nav-item' + (item.route === currentPage ? ' active' : '');
      a.href = '#';
      a.textContent = item.label;
      a.onclick = (e) => { e.preventDefault(); navigate(item.route); };
      nav.appendChild(a);
    });
  }
  (PAGES[currentPage] || renderHome)(main);
}

async function loadUser() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.data.user;
    if (data.data.must_change_password) { renderChangePassword($('app-main'), true); return; }
    renderApp();
    refreshBell();
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
  $('bottom-nav').innerHTML = '';
  main.innerHTML = `
    <div class="login-card" style="max-width:460px;margin:24px auto;padding:24px;">
      <h1>${forced ? 'Choose your own password' : 'Change password'}</h1>
      <p class="help">${forced ? 'You are using a temporary password. ' : ''}Use at least 10 characters.</p>
      <div class="field"><label>${forced ? 'Temporary password' : 'Current password'}</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div class="field"><label>New password</label><input type="password" id="pw-new" autocomplete="new-password"></div>
      <div class="field"><label>New password again</label><input type="password" id="pw-new2" autocomplete="new-password"></div>
      <div class="error" id="pw-err" style="display:none"></div>
      <button class="btn btn-primary btn-full" id="pw-save">Save password</button>
    </div>`;
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
function renderHome(main) {
  if (currentUser.role === 'owner') { renderDashboard(main); return; }
  const tiles = {
    site: [['📷', "Today's work report", 'site'], ['📐', 'Latest drawings', 'drawings'], ['⚠', 'Raise a snag', 'site']],
    pm: [['📷', 'Site reports', 'site'], ['✅', 'Approvals', 'approvals'], ['📐', 'Drawings', 'drawings']],
    sales: [['🤝', 'Leads', 'sales']],
    accounts: [['💰', 'Sales & receipts', 'sales'], ['🛒', 'Purchase orders', 'procurement']],
    purchase: [['🛒', 'Procurement', 'procurement'], ['📐', 'Drawings', 'drawings']],
    hr: [], viewer: [['🏗', 'Projects', 'projects']],
  }[currentUser.role] || [];
  main.innerHTML = `<h1>Hello, ${esc(currentUser.name)}</h1><p class="help">${esc(currentUser.role)}</p>
    <div class="grid">${tiles.map(([i, l, r]) => `<button class="btn btn-full tile-btn" data-go="${r}"><span style="font-size:28px">${i}</span><br>${esc(l)}</button>`).join('') || '<div class="empty-state"><p>Nothing here yet.</p></div>'}</div>`;
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
}

function renderMore(main) {
  const o = currentUser.role === 'owner';
  const items = [
    ['Documents', 'documents', true], ['Notifications', 'notifications', true],
    ['Users & access', 'users', o], ['Audit log', 'audit', o || currentUser.role === 'pm'],
    ['Branding & letterhead', 'branding', ['owner', 'pm', 'sales', 'accounts'].includes(currentUser.role)],
    ['Shared links', 'sharelinks', ['owner', 'pm'].includes(currentUser.role)],
    ['Storage (Google Drive)', 'storage', o], ['Email settings', 'email', o], ['Settings', 'settings', o],
    ['Help', 'help', true], ['Change password', 'password', true],
  ].filter((x) => x[2]);
  main.innerHTML = `<h1>More</h1>${items.map(([l, r]) => `<button class="btn btn-full" style="margin-bottom:10px;text-align:left" data-go="${r}">${esc(l)}</button>`).join('')}
    <button class="btn btn-full" style="margin-top:12px;color:#dc2626" id="more-logout">Log out</button>`;
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
  main.innerHTML = `<h1>Site work</h1><div class="grid">
    <button class="btn btn-primary btn-full" id="s-dpr">📷 Today's work report</button>
    <button class="btn btn-full" id="s-snag">⚠ Raise a snag</button>
    ${userCanClient('site', 'C') && currentUser.role !== 'site' ? '<button class="btn btn-full" id="s-ms">📐 Add milestone</button>' : ''}</div><div id="site-list">Loading...</div>`;
  $('s-dpr').onclick = newDpr; $('s-snag').onclick = newSnag;
  if ($('s-ms')) $('s-ms').onclick = newMilestone;
  loadSite();
}

async function newDpr() {
  const v = await openForm({ title: "Today's work report", fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'report_date', label: 'Date', type: 'date', value: today() },
    { name: 'work_summary', label: 'What work happened today?', type: 'textarea', required: true },
    { name: 'labour_count', label: 'Labour on site', type: 'number' }, { name: 'issues', label: 'Problems / delays', type: 'textarea' }] });
  if (!v) return;
  v.project_id = Number(v.project_id); v.client_uuid = crypto.randomUUID();
  if (await act(api('/api/site/dprs', { method: 'POST', body: v }), 'Report saved')) loadSite();
}

async function newSnag() {
  const v = await openForm({ title: 'Raise a snag', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'title', label: 'What is wrong?', required: true }, { name: 'location', label: 'Where (wing / floor)' },
    { name: 'severity', label: 'How serious?', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], value: 'medium' }] });
  if (!v) return;
  v.project_id = Number(v.project_id); v.client_uuid = crypto.randomUUID();
  if (await act(api('/api/site/snags', { method: 'POST', body: v }), 'Snag raised')) loadSite();
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
  try {
    const [dprs, snags, ms] = await Promise.all([api('/api/site/dprs'), api('/api/site/snags'), api('/api/site/milestones')]);
    let html = '<h3>Milestones</h3>' + (ms.data.milestones.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.name)}</b>${m.wing ? ' · ' + esc(m.wing) : ''}<p class="muted">Planned ${esc(m.planned_date || '—')}${m.actual_date ? ' · Done ' + esc(String(m.actual_date).substring(0, 10)) : ''}</p></div>${m.status === 'done' ? statusChip('done') : (userCanClient('site', 'C') ? `<button class="btn small" data-done="${m.id}">Done today</button>` : statusChip('pending'))}</div></div>`).join('') || '<p class="muted">No milestones yet.</p>');
    html += '<h3>Recent reports</h3>' + (dprs.data.dprs.map((d) => `<div class="card"><b>${esc(d.report_date)}</b> · ${esc(d.labour_count || 0)} labour<p>${esc(d.work_summary)}</p></div>`).join('') || '<p class="muted">No reports yet.</p>');
    html += '<h3>Snags</h3>' + (snags.data.snags.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.title)}</b><p class="muted">${esc(s.location || '')}</p></div><div>${chip(s.severity, s.severity === 'high' ? 'bad' : s.severity === 'medium' ? 'warn' : '')} ${statusChip(s.status)}</div></div></div>`).join('') || '<p class="muted">No open snags.</p>');
    $('site-list').innerHTML = html;
    $('site-list').querySelectorAll('[data-done]').forEach((b) => {
      b.onclick = async () => {
        const v = await openForm({ title: 'Milestone done', fields: [{ name: 'actual_date', label: 'Date completed', type: 'date', value: today() }] });
        if (!v) return;
        const r = await act(api(`/api/site/milestones/${b.dataset.done}/done`, { method: 'POST', body: v }));
        if (r) { toast(r.data.demands_ready ? `Done. ${r.data.demands_ready} customer payment demand(s) are now ready.` : 'Marked done'); loadSite(); }
      };
    });
  } catch (e) { $('site-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
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

async function loadProcurement() {
  try {
    const [vendors, pos, rfqs] = await Promise.all([api('/api/procurement/vendors'), api('/api/procurement/pos'), api('/api/procurement/rfqs')]);
    const canA = userCanClient('procurement', 'A');
    let html = '<h3>Purchase orders</h3>' + (pos.data.pos.map((p) => `<div class="card"><div class="row"><div><b>${esc(p.po_no)}</b><p class="muted">Total ${moneyP(p.total_paise)}</p></div>${statusChip(p.status)}</div>
      <div class="row-btns">${p.status === 'draft' ? `<button class="btn small" data-po="submit" data-id="${p.id}">Send for approval</button>` : ''}${p.status === 'pending_approval' && canA ? `<button class="btn small btn-primary" data-po="approve" data-id="${p.id}">Approve</button><button class="btn small" data-po="reject" data-id="${p.id}">Reject</button>` : ''}</div></div>`).join('') || '<p class="muted">No purchase orders yet.</p>');
    html += '<h3>RFQs</h3>' + (rfqs.data.rfqs.map((r) => `<div class="card"><b>${esc(r.title)}</b> ${statusChip(r.status)}</div>`).join('') || '<p class="muted">No RFQs.</p>');
    html += '<h3>Vendors</h3>' + (vendors.data.vendors.map((v) => `<div class="card"><b>${esc(v.name)}</b><p class="muted">${esc(v.category || '')}${v.phone ? ' · ' : ''}${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}</p></div>`).join('') || '<p class="muted">No vendors yet.</p>');
    $('procurement-list').innerHTML = html;
    $('procurement-list').querySelectorAll('[data-po]').forEach((b) => {
      b.onclick = async () => { if (await act(api(`/api/procurement/pos/${b.dataset.id}/${b.dataset.po}`, { method: 'POST' }), 'Done')) loadProcurement(); };
    });
  } catch (e) { $('procurement-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
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
    <h3>Demands</h3>${d.demands.map((x) => `<div class="card"><div class="row"><div><b>${esc(x.label)}</b><p class="muted">${moneyP(x.amount_paise)} + GST ${moneyP(x.gst_paise)}${x.due_date ? ' · due ' + esc(x.due_date) : ''}</p></div>${statusChip(x.status)}</div>${['ready', 'partial', 'scheduled'].includes(x.status) && userCanClient('sales', 'E') ? `<button class="btn small" data-rcpt="${x.id}">Record receipt</button>` : ''}</div>`).join('')}
    <h3>Receipts</h3>${d.receipts.map((r) => `<p>${esc(r.received_on)} · ${moneyP(r.amount_paise)}${r.tds_paise ? ' + TDS ' + moneyP(r.tds_paise) : ''} · ${esc(r.mode || '')}</p>`).join('') || '<p class="muted">None yet.</p>'}
    <div class="modal-actions">${d.booking.status !== 'cancelled' && userCanClient('sales', 'A') ? '<button class="btn" id="bk-cancel" style="color:#dc2626">Cancel booking</button>' : ''}<button class="btn btn-primary" id="bk-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  $('bk-close').onclick = () => ov.remove();
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
    const inv = (await Promise.all(projects.map((p) => api('/api/sales/inventory?project_id=' + p.id).then((r) => r.data.inventory.map((u) => ({ ...u, project: p.name }))).catch(() => [])))).flat();
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
  const bell = $('notify-count');
  if (bell) { bell.style.cursor = 'pointer'; bell.onclick = () => navigate('notifications'); }
  const bellBtn = document.querySelector('.top-right .icon-btn[title="Notifications"]');
  if (bellBtn) bellBtn.onclick = () => navigate('notifications');
  const helpBtn = document.querySelector('.top-right .icon-btn[title="Help"]');
  if (helpBtn) helpBtn.onclick = () => navigate('help');
  const logo = document.querySelector('img.logo');
  if (logo) logo.addEventListener('error', () => { logo.style.display = 'none'; });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// ---------- Login (password or emailed code) ----------
function renderLogin() {
  $('bottom-nav').innerHTML = '';
  $('app-main').innerHTML = `
    <div class="login-card" style="max-width:420px;margin:40px auto;padding:24px;background:#f9fafb;border-radius:12px;">
      <h1>Sign in</h1>
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
      <p class="help" style="margin-top:16px">First time? Use the temporary password you were given. You will then choose your own.</p>
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
