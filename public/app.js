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
