// pages32.js — Module 5 screens: Possession & handover (every booked flat and where its handover stands) and Snags (all snags in one place).
// The flat's own handover checklist, dues and possession letter stay in the booking; this list opens it.
const PS = { stage: 'all', snag: 'open' };
const _sidebarItems32 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems32(role).map((g) => [g[0], g[1].slice()]);
  const has = (r) => groups.some((g) => g[1].some((i) => i.route === r));
  const add = [];
  if (['owner', 'pm', 'sales', 'accounts', 'viewer'].includes(role) && !has('possession')) add.push({ label: 'Possession & handover', route: 'possession', icon: 'possession' });
  if (['owner', 'pm', 'site', 'viewer'].includes(role) && !has('snags')) add.push({ label: 'Snags', route: 'snags', icon: 'snags' });
  if (add.length) groups.push(['Module 5', add]);   // pages31.js moves them under "5. Possession & Society"
  return groups;
};
PAGES.possession = (m) => renderPossession(m);
PAGES.snags = (m) => renderSnags(m);
Object.assign(ROUTE_TITLES, { possession: 'Possession & handover', snags: 'Snags' });
Object.assign(ICONS, { possession: 'M8 15a4 4 0 110-8 4 4 0 010 8zM11 11h10M18 11v3M21 11v3M4 21h16', snags: 'M12 3l10 18H2zM12 10v5M12 18h.01' });

async function renderPossession(main) {
  main.innerHTML = '<h1>Possession &amp; handover</h1><p class="muted">Loading…</p>';
  let d; try { d = (await api('/api/possession')).data; } catch (e) { main.innerHTML = `<h1>Possession &amp; handover</h1><div class="error">${esc(e.message)}</div>`; return; }
  const scoped = (typeof scopeProject !== 'undefined' && scopeProject) ? d.flats.filter((f) => f.project_id === scopeProject) : d.flats;
  const cnt = { not_started: 0, in_progress: 0, handed_over: 0 }; scoped.forEach((f) => { cnt[f.stage]++; });
  const tabs = [['all', 'All', scoped.length], ['in_progress', 'In progress', cnt.in_progress], ['not_started', 'Not started', cnt.not_started], ['handed_over', 'Handed over', cnt.handed_over]];
  const list = scoped.filter((f) => PS.stage === 'all' || f.stage === PS.stage);
  const chipFor = { not_started: chip('Not started', ''), in_progress: chip('In progress', 'warn'), handed_over: chip('Handed over', 'good') };
  main.innerHTML = `<h1>Possession &amp; handover</h1><p class="help">Every booked flat and where its handover stands. Tap a flat to open its checklist, dues and possession letter.</p>
    <div class="row-btns">${tabs.map(([k, l, n]) => `<button class="btn small${PS.stage === k ? ' btn-primary' : ''}" data-ps="${k}">${l} (${n})</button>`).join('')}</div>
    ${list.length ? list.map((f) => `<div class="card"><div class="row"><div><b>${esc((f.wing ? f.wing + '-' : '') + f.unit_no)}</b>${f.customer_name ? ' · ' + esc(f.customer_name) : ''}<p class="muted">${esc(f.project)}${f.possession_given_on ? ' · handed over ' + esc(f.possession_given_on) : f.possession_offered_on ? ' · offered ' + esc(f.possession_offered_on) : ''}</p>
      <p class="muted">${f.stage === 'not_started' ? (f.agreement_date ? 'Ready to open the handover' : 'Agreement not registered yet') : `${f.open_items} checklist item(s) open`} · ${f.open_snags} snag(s) open</p></div><div>${chipFor[f.stage]}</div></div>
      <div class="row-btns"><button class="btn small btn-primary" data-open="${f.booking_id}">Open</button></div></div>`).join('') : '<div class="empty-state"><p>No flats here.</p><button class="btn btn-primary" id="ps-sales">Go to Sales</button></div>'}`;
  if ($('ps-sales')) $('ps-sales').onclick = () => navigate('sales');
  main.querySelectorAll('[data-ps]').forEach((b) => { b.onclick = () => { PS.stage = b.dataset.ps; renderPossession(main); }; });
  main.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => bookingDetail(Number(b.dataset.open)); });
}

async function renderSnags(main) {
  main.innerHTML = '<h1>Snags</h1><p class="muted">Loading…</p>';
  let all; try { all = (await api('/api/site/snags')).data.snags; } catch (e) { main.innerHTML = `<h1>Snags</h1><div class="error">${esc(e instanceof TypeError ? 'You are offline.' : e.message)}</div>`; return; }
  if (typeof scopeProject !== 'undefined' && scopeProject) all = all.filter((s) => s.project_id === scopeProject);
  const cnt = { open: 0, fixed: 0, verified: 0 }; all.forEach((s) => { if (cnt[s.status] != null) cnt[s.status]++; });
  const list = all.filter((s) => PS.snag === 'all' || s.status === PS.snag);
  const canE = userCanClient('site', 'C'), canV = ['owner', 'pm'].includes(currentUser.role);
  main.innerHTML = `<h1>Snags</h1><p class="help">Defects found on site or inside a flat. A site engineer marks one fixed; the PM or Owner verifies the fix.</p>
    ${canE ? '<button class="btn btn-primary btn-full" id="sn-new">Raise a snag</button>' : ''}
    <div class="row-btns">${[['open', 'Open'], ['fixed', 'Fixed'], ['verified', 'Verified'], ['all', 'All']].map(([k, l]) => `<button class="btn small${PS.snag === k ? ' btn-primary' : ''}" data-sn="${k}">${l}${k === 'all' ? ` (${all.length})` : ` (${cnt[k]})`}</button>`).join('')}</div>
    ${list.length ? list.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.title)}</b><p class="muted">${esc([s.wing, s.location].filter(Boolean).join(' · '))}${s.unit_id ? ' · inside a flat' : ''}</p></div><div>${chip(s.severity, s.severity === 'high' ? 'bad' : s.severity === 'medium' ? 'warn' : '')} ${statusChip(s.status)}</div></div>
      <div class="row-btns"><button class="btn small" data-ph="site_snags:${s.id}">Photos</button>${typeof waBtn === 'function' ? waBtn(`Snag (${s.severity}): ${s.title}${s.location ? ' at ' + s.location : ''}. Status: ${s.status}.`, 'site') : ''}${s.status === 'open' && canE ? `<button class="btn small" data-snag="fixed" data-id="${s.id}">Mark fixed</button>` : ''}${s.status === 'fixed' && canV ? `<button class="btn small btn-primary" data-snag="verified" data-id="${s.id}">Verify fix</button><button class="btn small" data-snag="open" data-id="${s.id}">Reopen</button>` : ''}</div></div>`).join('') : '<div class="empty-state"><p>No snags here.</p>' + (canE ? '<button class="btn btn-primary" id="sn-new2">Raise a snag</button>' : '') + '</div>'}`;
  const again = () => renderSnags(main);
  ['sn-new', 'sn-new2'].forEach((id) => { if ($(id)) $(id).onclick = async () => { await newSnag(); again(); }; });
  main.querySelectorAll('[data-sn]').forEach((b) => { b.onclick = () => { PS.snag = b.dataset.sn; again(); }; });
  main.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => { const [en, id] = b.dataset.ph.split(':'); showPhotos(en, id); }; });
  main.querySelectorAll('[data-snag]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/site/snags/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.snag } }), 'Updated')) again(); }; });
}
