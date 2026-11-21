// app.js — NirmaanCRM frontend application router
// Handles client-side routing, API calls, and page rendering.

let currentUser = null;
let currentPage = 'home';

// ---------- Auth helpers ----------
// api() lives in ui.js
async function loadUser() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.data.user;
    renderApp();
  } catch (e) {
    currentUser = null;
    renderLogin();
  }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  currentUser = null;
  renderLogin();
}

// ---------- Render ----------
function renderApp() {
  const main = document.getElementById('app-main');
  const nav = document.getElementById('bottom-nav');
  const tradeName = document.getElementById('topbar-trade-name');
  const projectPicker = document.getElementById('topbar-project-picker');
  const notifyCount = document.getElementById('notify-count');

  if (!currentUser) {
    renderLogin();
    return;
  }

  // Topbar
  if (tradeName) tradeName.textContent = currentUser.name;
  if (notifyCount) notifyCount.textContent = '0';

  // Role-based bottom nav
  const role = currentUser.role;
  if (nav) {
    nav.innerHTML = '';
    const items = getBottomNavItems(role);
    items.forEach((item) => {
      const a = document.createElement('a');
      a.className = 'nav-item';
      a.href = '#';
      a.textContent = item.label;
      a.onclick = (e) => { e.preventDefault(); navigate(item.route); };
      nav.appendChild(a);
    });
  }

  // Render current page
  if (currentPage === 'home') renderHome(main);
  else if (currentPage === 'projects') renderProjects(main);
  else if (currentPage === 'users') renderUsers(main);
  else if (currentPage === 'documents') renderDocuments(main);
  else if (currentPage === 'settings') renderSettings(main);
  else if (currentPage === 'approvals') renderApprovals(main);
  else if (currentPage === 'drawings') renderDrawings(main);
  else if (currentPage === 'site') renderSite(main);
  else if (currentPage === 'procurement') renderProcurement(main);
  else if (currentPage === 'sales') renderSales(main);
  else if (currentPage === 'dashboard') renderDashboard(main);
  else renderHome(main);
}

function getBottomNavItems(role) {
  const maps = {
    owner: [{ label: 'Home', route: 'dashboard' }, { label: 'Projects', route: 'projects' }, { label: 'Sales', route: 'sales' }, { label: 'More', route: 'settings' }, { label: 'Storage', route: 'storage' }],
    pm: [{ label: 'Home', route: 'home' }, { label: 'Site', route: 'site' }, { label: 'Approvals', route: 'approvals' }, { label: 'More', route: 'settings' }],
    site: [{ label: 'Home', route: 'home' }, { label: 'Drawings', route: 'drawings' }, { label: 'Site', route: 'site' }, { label: 'More', route: 'settings' }],
    sales: [{ label: 'Home', route: 'home' }, { label: 'Leads', route: 'sales' }, { label: 'Visits', route: 'site' }, { label: 'More', route: 'settings' }],
    accounts: [{ label: 'Home', route: 'home' }, { label: 'Reports', route: 'home' }, { label: 'More', route: 'settings' }],
    purchase: [{ label: 'Home', route: 'home' }, { label: 'Procurement', route: 'procurement' }, { label: 'More', route: 'settings' }],
    hr: [{ label: 'Home', route: 'home' }, { label: 'More', route: 'settings' }],
    viewer: [{ label: 'Home', route: 'home' }, { label: 'Reports', route: 'home' }, { label: 'More', route: 'settings' }],
  };
  return maps[role] || maps.owner;
}

function navigate(route) {
  currentPage = route;
  renderApp();
}

function renderLogin() {
  document.getElementById('app-main').innerHTML = `
    <div class="login-card" style="max-width:420px;margin:40px auto;padding:24px;background:#f9fafb;border-radius:12px;">
      <div class="brand" style="justify-content:center;margin-bottom:20px;">
        <div class="trade-name" style="font-size:20px;">NirmaanCRM</div>
      </div>
      <h1>Sign In</h1>
      <div class="field"><label>Email</label><input type="email" id="login-email" placeholder="you@yourcompany.in"></div>
      <div class="field"><label>Password</label><div class="password-input"><input type="password" id="login-password" placeholder="••••••••••"><button type="button" id="login-toggle">Show</button></div></div>
      <div class="error" id="login-error" style="display:none;"></div>
      <button class="btn btn-primary btn-full" id="login-btn">Sign In</button>
      <p class="help" style="margin-top:16px;">First time? Use your temporary password. You'll choose your own password at first login.</p>
    </div>
  `;
  document.getElementById('login-toggle').onclick = () => {
    const inp = document.getElementById('login-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
  document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    err.style.display = 'none';
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      await loadUser();
    } catch (e) {
      err.textContent = e.message;
      err.style.display = 'block';
    }
  };
}

// ---------- Pages ----------
function renderHome(main) {
  main.innerHTML = `
    <div class="home">
      <h1>Welcome, ${currentUser.name}</h1>
      <p class="subtitle">Role: ${currentUser.role}</p>
      <div class="empty-state">
        <p>Select a module from the bottom navigation to get started.</p>
      </div>
    </div>
  `;
}

function renderProjects(main) {
  main.innerHTML = `
    <div class="main">
      <h1>Projects</h1>
      <div class="field" style="margin-bottom:16px;">
        <button class="btn btn-primary" id="btn-new-project">+ New Project</button>
      </div>
      <div id="projects-list">Loading...</div>
    </div>
  `;
  loadProjects();
}

async function loadProjects() {
  try {
    const data = await api('/api/projects');
    const list = document.getElementById('projects-list');
    if (data.data.projects.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No projects yet. Click + New Project to create one.</p></div>';
      return;
    }
    list.innerHTML = data.data.projects.map((p) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 4px 0;">${p.name}</h2>
            <p style="margin:0;color:#6b7280;font-size:16px;">${p.code} · ${p.city}</p>
          </div>
          <span class="status-chip">${p.status}</span>
        </div>
        <p style="margin:8px 0 0 0;color:#6b7280;">${p.address || ''}</p>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('projects-list').innerHTML = '<div class="error">Error loading projects: ' + e.message + '</div>';
  }
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-new-project') {
    const name = prompt('Project name:');
    const code = prompt('Project code (e.g. SHIV-A):');
    if (name && code) {
      api('/api/projects', { method: 'POST', body: { name, code } }).then(() => {
        renderProjects(document.getElementById('app-main'));
      }).catch((err) => alert('Error: ' + err.message));
    }
  }
});

function renderUsers(main) {
  main.innerHTML = '<h1>Users</h1><div id="users-list">Loading...</div>';
  loadUsers();
}
async function loadUsers() {
  try {
    const data = await api('/api/users');
    const list = document.getElementById('users-list');
    list.innerHTML = data.data.users.map((u) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <h2 style="margin:0 0 4px 0;">${u.name}</h2>
        <p style="margin:0;color:#6b7280;font-size:16px;">${u.role} · ${u.email}</p>
        <p style="margin:8px 0 0 0;color:#6b7280;">${u.active ? 'Active' : 'Deactivated'}</p>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('users-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

function renderDocuments(main) {
  main.innerHTML = '<h1>Documents</h1><div id="docs-list">Loading...</div>';
  loadDocuments();
}
async function loadDocuments() {
  try {
    const data = await api('/api/documents');
    document.getElementById('docs-list').innerHTML = data.data.documents.length > 0
      ? data.data.documents.map((d) => `<div class="card" style="padding:16px;margin-bottom:12px;"><h3>${d.title}</h3><p>${d.category} · ${d.store || '—'}</p></div>`).join('')
      : '<div class="empty-state"><p>No documents yet.</p></div>';
  } catch (e) {
    document.getElementById('docs-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

function renderSettings(main) {
  main.innerHTML = '<h1>Settings</h1><div id="settings-list">Loading...</div>';
  loadSettings();
}
async function loadSettings() {
  try {
    const data = await api('/api/settings');
    const s = data.data.settings;
    document.getElementById('settings-list').innerHTML = Object.entries(s).map(([k, v]) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <h3 style="margin:0 0 4px 0;">${k}</h3>
        <p style="margin:0;color:#6b7280;">${typeof v === 'string' && v.startsWith('enc:') ? '[encrypted]' : JSON.stringify(v)}</p>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('settings-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

// ---------- Storage settings (Google Drive) ----------
function renderStorage(main) {
  main.innerHTML = `
    <h1>Storage — Google Drive</h1>
    <div class="field" style="margin-bottom:16px;">
      <label>Storage Driver</label>
      <div style="margin-top:8px;">
        <label style="margin-right:16px;"><input type="radio" name="storage-driver" value="gdrive" id="sd-gdrive"> Google Drive (Mode G)</label>
        <label style="margin-right:16px;"><input type="radio" name="storage-driver" value="d1" id="sd-d1"> Database (Mode B)</label>
      </div>
    </div>
    <div id="gdrive-status" style="margin-bottom:16px;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;display:none;">
      <h3 style="margin:0 0 8px 0;">Google Drive Connection</h3>
      <p id="gdrive-account" style="margin:0 0 8px 0;color:#6b7280;"></p>
      <div id="gdrive-quota" style="margin:8px 0;font-size:16px;"></div>
      <div style="margin-top:12px;">
        <button class="btn btn-primary" id="btn-connect-gdrive" style="margin-right:8px;">Connect Google Drive</button>
        <button class="btn" id="btn-disconnect-gdrive">Disconnect</button>
      </div>
      <p id="gdrive-message" style="margin-top:8px;font-size:16px;"></p>
    </div>
    <div id="gdrive-needs-attention" style="margin-bottom:16px;padding:16px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;display:none;">
      <h3 style="margin:0 0 8px 0;">⚠ Files Needing Attention</h3>
      <div id="gdrive-attention-list"></div>
    </div>
  `;

  loadStorageStatus();

  document.getElementById('sd-gdrive').onchange = () => saveDriver('gdrive');
  document.getElementById('sd-d1').onchange = () => saveDriver('d1');
  document.getElementById('btn-connect-gdrive').onclick = connectGDrive;
  document.getElementById('btn-disconnect-gdrive').onclick = disconnectGDrive;
}

async function loadStorageStatus() {
  try {
    const data = await api('/api/storage/status');
    const d = data.data;
    document.getElementById('sd-gdrive').checked = d.driver === 'gdrive';
    document.getElementById('sd-d1').checked = d.driver === 'd1';

    const statusBox = document.getElementById('gdrive-status');
    const attentionBox = document.getElementById('gdrive-needs-attention');

    if (d.gdriveStatus === 'connected') {
      statusBox.style.display = 'block';
      document.getElementById('gdrive-account').textContent = `Connected as: ${d.accountEmail}`;
      document.getElementById('btn-connect-gdrive').style.display = 'none';
      document.getElementById('btn-disconnect-gdrive').style.display = 'inline-block';
      if (d.quota) {
        const pct = d.quota.percent;
        const gbUsed = (d.quota.usage / 1024 / 1024 / 1024).toFixed(1);
        const gbLimit = (d.quota.limit / 1024 / 1024 / 1024).toFixed(1);
        const warnClass = pct >= d.warnPercent ? 'color:#dc2626;font-weight:600;' : 'color:#15803d;';
        document.getElementById('gdrive-quota').innerHTML = `
          Storage: <span style="${warnClass}">${gbUsed} GB of ${gbLimit} GB (${pct}%)</span>
          ${pct >= d.warnPercent ? ' — approaching limit!' : ''}
        `;
      }
      document.getElementById('gdrive-message').textContent = 'Google Drive is connected and working.';
      document.getElementById('gdrive-message').style.color = '#15803d';
    } else if (d.gdriveStatus === 'needs_reconnect') {
      statusBox.style.display = 'block';
      document.getElementById('gdrive-account').textContent = 'Google Drive needs to be reconnected.';
      document.getElementById('btn-connect-gdrive').style.display = 'inline-block';
      document.getElementById('btn-disconnect-gdrive').style.display = 'none';
      document.getElementById('gdrive-message').textContent = 'Click Connect to re-authorize Google Drive.';
      document.getElementById('gdrive-message').style.color = '#dc2626';
    } else {
      document.getElementById('gdrive-message').textContent = 'Google Drive is not connected. Files are stored in the database.';
      document.getElementById('gdrive-message').style.color = '#6b7280';
    }
  } catch (e) {
    console.error('Storage status error:', e);
  }
}

async function saveDriver(driver) {
  try {
    await api('/api/storage/driver', { method: 'POST', body: { driver } });
    loadStorageStatus();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function connectGDrive() {
  try {
    const data = await api('/api/storage/google/start', { method: 'POST' });
    window.location.href = data.data.authUrl;
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function disconnectGDrive() {
  if (!confirm("Disconnect Google Drive? Files will remain in Drive but the CRM won't be able to access them until you reconnect.")) return;
  try {
    await api('/api/storage/google/disconnect', { method: 'POST' });
    loadStorageStatus();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ---------- Update routing to include storage page ----------
const origRenderApp = renderApp;
renderApp = function() {
  if (currentPage === 'storage') { renderStorage(document.getElementById('app-main')); return; }
  if (currentPage === 'branding') { renderBranding(document.getElementById('app-main')); return; }
  if (currentPage === 'sharelinks') { renderShareLinks(document.getElementById('app-main')); return; }
  origRenderApp();
};

// Update bottom nav to include branding

function renderApprovals(main) {
  main.innerHTML = `
    <h1>Approvals & Compliance</h1>
    <div class="field" style="margin-bottom:16px;">
      <button class="btn btn-primary" id="btn-new-approval">+ New Approval Item</button>
    </div>
    <div id="approvals-list">Loading...</div>
  `;
  loadApprovals();
}

async function loadApprovals() {
  try {
    const data = await api('/api/approvals');
    const list = document.getElementById('approvals-list');
    if (data.data.items.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No approval items yet. Click + New Approval Item to add one.</p></div>';
      return;
    }
    list.innerHTML = data.data.items.map((a) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 4px 0;">${a.name}</h2>
            <p style="margin:0;color:#6b7280;font-size:16px;">${a.authority || '—'} · ${a.category || 'approval'}</p>
          </div>
          <span style="background:#e5e7eb;color:#111;padding:4px 10px;border-radius:20px;font-size:16px;">${a.status}</span>
        </div>
        <p style="margin:8px 0 0 0;color:#6b7280;">Valid till: ${a.valid_till || '—'} · Reminder: ${a.reminder_days || 30} days</p>
        <button class="btn" style="margin-top:8px;font-size:16px;padding:8px 16px;">View Timeline</button>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('approvals-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}
function renderDrawings(main) {
  main.innerHTML = `
    <h1>Drawings & Design Register</h1>
    <div class="field" style="margin-bottom:16px;">
      <button class="btn btn-primary" id="btn-new-drawing">+ New Drawing</button>
    </div>
    <div id="drawings-list">Loading...</div>
  `;
  loadDrawings();
}

async function loadDrawings() {
  try {
    const data = await api('/api/drawings');
    const list = document.getElementById('drawings-list');
    if (data.data.drawings.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No drawings yet. Click + New Drawing to add one.</p></div>';
      return;
    }
    list.innerHTML = data.data.drawings.map((d) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 4px 0;">${d.code}</h2>
            <p style="margin:0;color:#6b7280;font-size:16px;">${d.title} · ${d.discipline}</p>
          </div>
          <span style="background:#e5e7eb;color:#111;padding:4px 10px;border-radius:20px;font-size:16px;">Zone: ${d.zone || '—'}</span>
        </div>
        <p style="margin:8px 0 0 0;color:#6b7280;">Current IFC: ${d.current_ifc_rev || 'None yet'}</p>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('drawings-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}
function renderSite(main) {
  main.innerHTML = `
    <h1>Site Work</h1>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
      <button class="btn btn-primary btn-full" id="btn-new-dpr">📷 Today's Work Report</button>
      <button class="btn btn-full" id="btn-new-snag">⚠ Raise Snag</button>
      <button class="btn btn-full" id="btn-milestones">📐 Milestones</button>
    </div>
    <div id="site-list">Loading...</div>
  `;
  loadSite();
}

async function loadSite() {
  try {
    const [dprs, snags] = await Promise.all([
      api('/api/site/dprs'),
      api('/api/site/snags'),
    ]);
    const list = document.getElementById('site-list');
    let html = '<h3 style="margin:16px 0 8px 0;">Recent DPRs</h3>';
    if (dprs.data.dprs.length === 0) html += '<p style="color:#6b7280;">No DPRs yet.</p>';
    else html += dprs.data.dprs.map((d) => `
      <div class="card" style="padding:12px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;">
        <strong>${d.report_date}</strong> · ${d.labour_count || 0} labour · ${d.work_summary}
      </div>
    `).join('');
    html += '<h3 style="margin:16px 0 8px 0;">Open Snags</h3>';
    if (snags.data.snags.length === 0) html += '<p style="color:#6b7280;">No open snags.</p>';
    else html += snags.data.snags.map((s) => `
      <div class="card" style="padding:12px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;">
        <strong>${s.title}</strong> · ${s.severity} · ${s.status}
      </div>
    `).join('');
    list.innerHTML = html;
  } catch (e) {
    document.getElementById('site-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-new-dpr') {
    const projectId = prompt('Project ID:');
    const reportDate = prompt('Date (YYYY-MM-DD):');
    const workSummary = prompt('What work happened today?');
    if (projectId && reportDate && workSummary) {
      api('/api/site/dprs', { method: 'POST', body: { project_id: Number(projectId), report_date: reportDate, work_summary } })
        .then(() => { alert('DPR saved!'); renderSite(document.getElementById('app-main')); })
        .catch((err) => alert('Error: ' + err.message));
    }
  }
  if (e.target && e.target.id === 'btn-new-approval') {
    const name = prompt('Approval item name:');
    const authority = prompt('Authority (e.g. MCGM):');
    const projectId = prompt('Project ID:');
    if (name && projectId) {
      api('/api/approvals', { method: 'POST', body: { name, authority, project_id: Number(projectId) } })
        .then(() => { alert('Created!'); renderApprovals(document.getElementById('app-main')); })
        .catch((err) => alert('Error: ' + err.message));
    }
  }
  if (e.target && e.target.id === 'btn-new-drawing') {
    const code = prompt('Drawing code (e.g. STR-A-501):');
    const title = prompt('Drawing title:');
    const projectId = prompt('Project ID:');
    if (code && title && projectId) {
      api('/api/drawings', { method: 'POST', body: { code, title, project_id: Number(projectId) } })
        .then(() => { alert('Created!'); renderDrawings(document.getElementById('app-main')); })
        .catch((err) => alert('Error: ' + err.message));
    }
  }
});
function renderProcurement(main) {
  main.innerHTML = `
    <h1>Procurement</h1>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
      <button class="btn btn-primary btn-full" id="btn-new-vendor">🛒 New Vendor</button>
      <button class="btn btn-full" id="btn-new-rfq">📋 New RFQ</button>
      <button class="btn btn-full" id="btn-new-po">📄 New PO</button>
    </div>
    <div id="procurement-list">Loading...</div>
  `;
  loadProcurement();
}

async function loadProcurement() {
  try {
    const [vendors, pos] = await Promise.all([
      api('/api/procurement/vendors'),
      api('/api/procurement/pos'),
    ]);
    const list = document.getElementById('procurement-list');
    let html = '<h3 style="margin:16px 0 8px 0;">Vendors</h3>';
    if (vendors.data.vendors.length === 0) html += '<p style="color:#6b7280;">No vendors yet.</p>';
    else html += vendors.data.vendors.map((v) => `
      <div class="card" style="padding:12px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;">
        <strong>${v.name}</strong> · ${v.category || '—'} · ${v.phone || '—'}
      </div>
    `).join('');
    html += '<h3 style="margin:16px 0 8px 0;">Purchase Orders</h3>';
    if (pos.data.pos.length === 0) html += '<p style="color:#6b7280;">No POs yet.</p>';
    else html += pos.data.pos.map((p) => `
      <div class="card" style="padding:12px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;">
        <strong>${p.po_no}</strong> · ${p.vendor} · ${moneyP(p.total_paise)} · ${p.status}
      </div>
    `).join('');
    list.innerHTML = html;
  } catch (e) {
    document.getElementById('procurement-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

function renderSales(main) {
  main.innerHTML = `
    <h1>Sales CRM</h1>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
      <button class="btn btn-primary btn-full" id="btn-new-lead">🤝 New Lead</button>
      <button class="btn btn-full" id="btn-inventory">🏠 Inventory</button>
    </div>
    <div id="sales-list">Loading...</div>
  `;
  loadSales();
}

async function loadSales() {
  try {
    const data = await api('/api/sales/leads');
    const list = document.getElementById('sales-list');
    if (data.data.leads.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No leads yet. Click + New Lead to add one.</p></div>';
      return;
    }
    list.innerHTML = data.data.leads.map((l) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 4px 0;">${l.name}</h2>
            <p style="margin:0;color:#6b7280;font-size:16px;">${l.phone} · ${l.source}</p>
          </div>
          <span style="background:#e5e7eb;color:#111;padding:4px 10px;border-radius:20px;font-size:16px;">${l.status}</span>
        </div>
        <p style="margin:8px 0 0 0;color:#6b7280;">Next follow-up: ${l.next_followup_at || '—'}</p>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('sales-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

function renderDashboard(main) {
  main.innerHTML = `
    <h1>Owner Dashboard</h1>
    <div class="dashboard-grid" id="dashboard-grid">
      <div class="dashboard-tile" id="tile-money-in">
        <div class="tile-label">Money In — This Month</div>
        <div class="tile-value" id="val-money-in">₹0</div>
      </div>
      <div class="dashboard-tile" id="tile-overdue">
        <div class="tile-label">Overdue Receivables</div>
        <div class="tile-value" id="val-overdue">₹0</div>
        <div class="tile-sub" id="sub-overdue">0 customers</div>
      </div>
      <div class="dashboard-tile" id="tile-bills">
        <div class="tile-label">Bills Due ≤7 Days</div>
        <div class="tile-value" id="val-bills">₹0</div>
        <div class="tile-sub" id="sub-bills">0 bills</div>
      </div>
      <div class="dashboard-tile" id="tile-pos">
        <div class="tile-label">POs Pending Your Approval</div>
        <div class="tile-value" id="val-pos">0</div>
      </div>
      <div class="dashboard-tile" id="tile-dpr">
        <div class="tile-label">Reports Filed Yesterday</div>
        <div class="tile-value" id="val-dpr">0</div>
      </div>
      <div class="dashboard-tile" id="tile-snags">
        <div class="tile-label">Open High Snags</div>
        <div class="tile-value" id="val-snags">0</div>
      </div>
      <div class="dashboard-tile" id="tile-leads">
        <div class="tile-label">New Leads This Week</div>
        <div class="tile-value" id="val-leads">0</div>
      </div>
    </div>
  `;
  loadDashboard();
}

async function loadDashboard() {
  try {
    const data = await api('/api/dashboard');
    const d = data.data;
    document.getElementById('val-money-in').textContent = moneyP(d.moneyIn);
    document.getElementById('val-overdue').textContent = moneyP(d.overdueReceivables.total);
    document.getElementById('sub-overdue').textContent = d.overdueReceivables.cnt + ' customers';
    document.getElementById('val-bills').textContent = moneyP(d.billsDue.total);
    document.getElementById('sub-bills').textContent = d.billsDue.cnt + ' bills';
    document.getElementById('val-pos').textContent = d.posPending;
    document.getElementById('val-dpr').textContent = d.dprsYesterday;
    document.getElementById('val-snags').textContent = d.highSnags;
    document.getElementById('val-leads').textContent = d.newLeads;
  } catch (e) {
    document.getElementById('dashboard-grid').innerHTML = '<div class="error">Error loading dashboard: ' + e.message + '</div>';
  }
}

// ---------- Branding settings ----------
function renderBranding(main) {
  main.innerHTML = `
    <h1>Company Branding</h1>
    <div class="field">
      <label>Legal Name</label>
      <input type="text" id="brand-legal-name" placeholder="Legal company name">
    </div>
    <div class="field">
      <label>Trade Name (shown in app)</label>
      <input type="text" id="brand-trade-name" placeholder="e.g. Shivneri Group">
    </div>
    <div class="field">
      <label>Tagline</label>
      <input type="text" id="brand-tagline">
    </div>
    <div class="field">
      <label>Address</label>
      <input type="text" id="brand-address">
    </div>
    <div class="field">
      <label>Phone</label>
      <input type="tel" id="brand-phone">
    </div>
    <div class="field">
      <label>Email</label>
      <input type="email" id="brand-email">
    </div>
    <div class="field">
      <label>GSTIN</label>
      <input type="text" id="brand-gstin">
    </div>
    <div class="field">
      <label>Primary Colour</label>
      <input type="color" id="brand-colour-primary" value="#1d4ed8">
    </div>
    <div class="field" style="margin-bottom:16px;">
      <button class="btn btn-primary btn-full" id="btn-save-branding">Save Branding</button>
    </div>
    <div class="field">
      <label>Logo Upload (PNG/JPG, max ~300 KB)</label>
      <input type="file" id="brand-logo-file" accept="image/png,image/jpeg,image/webp">
    </div>
    <div class="field" style="margin-bottom:16px;">
      <button class="btn btn-primary btn-full" id="btn-upload-logo">Upload Logo</button>
    </div>
    <div id="branding-result"></div>
    <img id="branding-logo-preview" src="" style="max-width:200px;margin-top:16px;display:none;">
  `;

  loadBranding();

  document.getElementById('btn-save-branding').onclick = async () => {
    const body = {
      legal_name: document.getElementById('brand-legal-name').value,
      trade_name: document.getElementById('brand-trade-name').value,
      tagline: document.getElementById('brand-tagline').value,
      address: document.getElementById('brand-address').value,
      phone: document.getElementById('brand-phone').value,
      email: document.getElementById('brand-email').value,
      gstin: document.getElementById('brand-gstin').value,
      colour_primary: document.getElementById('brand-colour-primary').value,
    };
    try {
      await api('/api/branding', { method: 'POST', body });
      document.getElementById('branding-result').innerHTML = '<p style="color:#15803d;">Branding saved!</p>';
      document.getElementById('branding-logo-preview').style.display = 'block';
      document.getElementById('branding-logo-preview').src = '/brand/logo.png?t=' + Date.now();
    } catch (e) {
      document.getElementById('branding-result').innerHTML = '<p style="color:#dc2626;">Error: ' + e.message + '</p>';
    }
  };

  document.getElementById('btn-upload-logo').onclick = async () => {
    const fileInput = document.getElementById('brand-logo-file');
    const file = fileInput.files[0];
    if (!file) return alert('Choose a file first.');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', 'Company Logo');
    formData.append('category', 'branding');
    formData.append('series_key', 'brand:logo');
    formData.append('audience', 'internal');
    formData.append('project_id', '');
    try {
      const res = await api('/api/files/upload', { method: 'POST', body: formData, headers: {} });
      document.getElementById('branding-result').innerHTML = '<p style="color:#15803d;">Logo uploaded!</p>';
      document.getElementById('branding-logo-preview').src = '/brand/logo.png?t=' + Date.now();
      document.getElementById('branding-logo-preview').style.display = 'block';
    } catch (e) {
      document.getElementById('branding-result').innerHTML = '<p style="color:#dc2626;">Error: ' + e.message + '</p>';
    }
  };
}

async function loadBranding() {
  try {
    const data = await api('/api/branding');
    const b = data.data.branding;
    if (b) {
      document.getElementById('brand-legal-name').value = b.legal_name || '';
      document.getElementById('brand-trade-name').value = b.trade_name || '';
      document.getElementById('brand-tagline').value = b.tagline || '';
      document.getElementById('brand-address').value = b.address || '';
      document.getElementById('brand-phone').value = b.phone || '';
      document.getElementById('brand-email').value = b.email || '';
      document.getElementById('brand-gstin').value = b.gstin || '';
      document.getElementById('brand-colour-primary').value = b.colour_primary || '#1d4ed8';
    }
  } catch (e) {}
}

// ---------- Share links ----------
function renderShareLinks(main) {
  main.innerHTML = `
    <h1>Shared Links</h1>
    <div id="share-links-list">Loading...</div>
  `;
  loadShareLinks();
}

async function loadShareLinks() {
  try {
    const data = await api('/api/share-links');
    const list = document.getElementById('share-links-list');
    if (data.data.links.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No shared links yet.</p></div>';
      return;
    }
    list.innerHTML = data.data.links.map((l) => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <h3 style="margin:0 0 4px 0;">${l.title}</h3>
        <p style="margin:0;color:#6b7280;font-size:16px;">Expires: ${new Date(l.expires_at).toLocaleDateString('en-IN')} · Views: ${l.view_count}</p>
        <p style="margin:8px 0 0 0;word-break:break-all;">${location.origin}/s/${l.token_hash.substring(0,8)}...</p>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('share-links-list').innerHTML = '<div class="error">Error: ' + e.message + '</div>';
  }
}

// Update bottom nav to include branding
const origGetBottomNavItems = getBottomNavItems;
getBottomNavItems = function(role) {
  const items = origGetBottomNavItems(role);
  if (role === 'owner') {
    // Add branding after home
    items.splice(1, 0, { label: 'Branding', route: 'branding' });
  }
  return items;
};

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  const btnUserMenu = document.getElementById('btn-user-menu');
  const userMenu = document.getElementById('user-menu');
  const btnLogout = document.getElementById('menu-logout');

  if (btnUserMenu) {
    btnUserMenu.onclick = () => {
      userMenu.style.display = userMenu.style.display === 'block' ? 'none' : 'block';
    };
  }
  if (btnLogout) {
    btnLogout.onclick = () => { logout(); };
  }

  document.addEventListener('click', (e) => {
    if (btnUserMenu && userMenu && !btnUserMenu.contains(e.target) && !userMenu.contains(e.target)) {
      userMenu.style.display = 'none';
    }
  });

  loadUser();
});
