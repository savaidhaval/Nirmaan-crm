// pages21.js — WP-20: drill-down lines on the home screen (grouped under the tiles they belong to) and the CSV reports pack.

const TONE_DOT = { good: 'var(--success)', warn: '#ff9500', bad: 'var(--danger)', '': '#8e8e93' };
async function attentionCard() {
  let g; try { g = (await api('/api/dashboard/extras')).data.groups; } catch (e) { return ''; }
  if (!g || !g.length) return '';
  return `<div class="card" id="dash-extras"><h2 style="margin-bottom:6px">Needs your attention</h2><div class="grid" style="margin:0">${g.map((grp) => `<div><h3 style="margin-top:10px">${esc(grp.tile)}</h3>${grp.lines.map((l) => `<a href="#" data-xgo="${esc(l.route)}" style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--border);color:var(--text);text-decoration:none;font-size:.95rem"><span style="width:8px;height:8px;border-radius:50%;margin-top:8px;flex:none;background:${TONE_DOT[l.tone] || TONE_DOT['']}"></span><span style="flex:1">${esc(l.label)}</span>${l.value ? `<b>${esc(l.value)}</b>` : ''}</a>`).join('')}</div>`).join('')}</div></div>`;
}
function withAttention(render, roles) {
  return async (main) => {
    render(main);
    if (!roles.includes(currentUser.role)) return;
    const html = await attentionCard(); if (!html || !main.isConnected || main.querySelector('#dash-extras')) return;
    const grid = main.querySelector('#dashboard-grid');
    if (grid) grid.insertAdjacentHTML('afterend', html); else main.insertAdjacentHTML('beforeend', html);
    main.querySelectorAll('[data-xgo]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.xgo); }; });
  };
}
PAGES.dashboard = withAttention(PAGES.dashboard, ['owner']);
PAGES.home = withAttention(PAGES.home, ['pm', 'accounts', 'viewer']);

// reports pack on the Insights page (Owner and PM) and on the Reports page
const REPORT_ROLES = ['owner', 'pm', 'accounts'];
async function reportsCard() {
  let r; try { r = (await api('/api/reports/pack')).data.reports; } catch (e) { return ''; }
  const extra = [['/api/redev/report?csv=1', 'Consent by society'], ['/api/redev/reports/rent_due?csv=1', 'Transit rent due this month'], ['/api/redev/reports/overdue?csv=1', 'Transit rent overdue']];
  return `<div class="card"><h2>Download for Excel</h2><p class="muted">Every report opens in Excel with the exact rupee amounts.</p><div class="row-btns">${r.map((x) => `<a class="btn small" href="/api/reports/pack/${x.key}">${esc(x.label)}</a>`).join('')}${extra.map(([h, l]) => `<a class="btn small" href="${h}">${l}</a>`).join('')}</div></div>`;
}
for (const key of ['insights', 'reports']) {
  const prev = PAGES[key]; if (!prev) continue;
  PAGES[key] = async (main) => { await prev(main); if (!REPORT_ROLES.includes(currentUser.role) || !main.isConnected) return; const html = await reportsCard(); if (html && main.isConnected) main.insertAdjacentHTML('beforeend', html); };
}
