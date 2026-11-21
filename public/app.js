// app.js — NirmaanCRM frontend application router
// Handles client-side routing, API calls, and page rendering.

let currentUser = null;
let currentPage = 'home';

// ---------- Auth helpers ----------
// api() lives in ui.js
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  currentUser = null;
  renderLogin();
}

// ---------- Render ----------
function navigate(route) {
  currentPage = route;
  renderApp();
}

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
    if (!document.getElementById('val-money-in')) return; // user moved to another screen
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
    const g = document.getElementById('dashboard-grid');
    if (g) g.innerHTML = '<div class="error">Error loading dashboard: ' + esc(e.message) + '</div>';
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
// Shared links screen lives in pages.js

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
