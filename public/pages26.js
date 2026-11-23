// pages26.js — "Send on WhatsApp" buttons, high-contrast mode for sunlight, safety line on daily reports.

// ======================= WhatsApp =======================
// Opens WhatsApp with a ready message and a link back into the app (people still need to sign in to see it; nothing private is attached).
const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 00-8.600 15.100L2 22l5-1.300A10 10 0 1012 2zm0 18.200a8.200 8.200 0 01-4.200-1.200l-.300-.200-3 .800.800-2.900-.200-.300A8.200 8.200 0 1112 20.200zm4.500-6.100c-.200-.100-1.500-.700-1.700-.800s-.400-.100-.600.100-.700.800-.800 1-.300.200-.500.100a6.700 6.700 0 01-3.300-2.900c-.300-.400.300-.400.700-1.300.100-.200 0-.300 0-.400l-.800-1.900c-.200-.500-.400-.400-.600-.400h-.500a1 1 0 00-.700.300 3 3 0 00-.900 2.200 5.200 5.200 0 001.100 2.700 11.800 11.800 0 004.500 4c1.700.700 2.300.800 3.200.600a2.700 2.700 0 001.800-1.300 2.200 2.200 0 00.200-1.300c-.100-.100-.200-.200-.500-.300z"/></svg>';
function waBtn(text, route) {
  return `<button type="button" class="btn small wa-btn" data-wa="${esc(text)}" data-wa-route="${esc(route || '')}" aria-label="Send on WhatsApp">${WA_ICON}<span>WhatsApp</span></button>`;
}
function waOpen(text, route) {
  const link = `${location.origin}/${route ? '#' + route : ''}`;
  const msg = `${text}\n${link}`.slice(0, 1500);
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-wa]'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); waOpen(b.dataset.wa, b.dataset.waRoute);
}, true);
const projName = (id) => { try { return ((projectCache || []).find((p) => p.id === id) || {}).name || ''; } catch (e) { return ''; } };
function dprWaText(d) {
  return `Daily report ${projName(d.project_id) ? projName(d.project_id) + ' ' : ''}${d.report_date}: ${d.work_summary}. Labour ${d.labour_count || 0}.${d.weather ? ' Weather: ' + d.weather + '.' : ''}${d.hours_lost ? ' Hours lost: ' + d.hours_lost + (d.lost_reason ? ' (' + d.lost_reason + ')' : '') + '.' : ''}${d.incident_kind && d.incident_kind !== 'none' ? ' SAFETY: ' + d.incident_kind.replace('_', ' ') + '.' : ''}`;
}

// ======================= safety line on a daily report card =======================
const INCIDENT_LABEL = { near_miss: 'Near miss', injury: 'Injury', dangerous: 'Dangerous occurrence' };
function dprSafetyLine(d) {
  let checks = null; try { checks = d.safety_checks ? JSON.parse(d.safety_checks) : null; } catch (e) { checks = null; }
  const parts = [];
  if (checks) { const all = Object.keys(checks).length, done = Object.values(checks).filter(Boolean).length; parts.push(chip(`Safety ${done}/${all}`, done === all ? 'good' : 'warn')); const miss = Object.keys(checks).filter((k) => !checks[k]); if (miss.length) parts.push(`<span class="muted">Not done: ${esc(miss.join(', '))}</span>`); }
  if (d.incident_kind && d.incident_kind !== 'none') parts.push(chip(INCIDENT_LABEL[d.incident_kind] || d.incident_kind, 'bad') + (d.safety_incident ? ` <span>${esc(d.safety_incident)}</span>` : ''));
  return parts.length ? `<p>${parts.join(' ')}</p>` : '';
}

// ======================= high contrast (sunlight) =======================
// On by default for site engineers; anyone can switch it from the account menu. Kept on this phone only.
const HC_KEY = 'nirmaan.contrast';
const hcPref = () => { try { return localStorage.getItem(HC_KEY); } catch (e) { return null; } };
function hcOn() { const p = hcPref(); return p ? p === 'on' : !!(currentUser && currentUser.role === 'site'); }
function hcApply() {
  document.body.classList.toggle('hc', hcOn());
  const mi = document.getElementById('menu-contrast'); if (mi) mi.textContent = hcOn() ? 'High contrast: on' : 'High contrast (sunlight): off';
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta && hcOn()) meta.setAttribute('content', '#000000');
}
function hcMenu() {
  const menu = document.getElementById('user-menu'); if (!menu || document.getElementById('menu-contrast')) return;
  const m = document.createElement('div'); m.className = 'menu-item'; m.id = 'menu-contrast'; m.setAttribute('role', 'button');
  m.onclick = () => { try { localStorage.setItem(HC_KEY, hcOn() ? 'off' : 'on'); } catch (e) { /* storage blocked */ } menu.style.display = 'none'; hcApply(); toast(hcOn() ? 'High contrast on' : 'High contrast off'); };
  const out = document.getElementById('menu-logout'); menu.insertBefore(m, out || null);
}
const _renderApp26 = renderApp;
renderApp = function () { _renderApp26.apply(this, arguments); try { hcMenu(); hcApply(); } catch (e) { /* never block the screen */ } };
