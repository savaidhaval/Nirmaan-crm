// pages13.js — profile and display picture, daily line, team and thank-yous, work report, feasibility studies, insights charts.

const avatarUrl = (u) => `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatar_v || '')}`;
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
// Picture if the person has one, otherwise their initials.
const photoHtml = (u, cls = '') => `<div class="pf-photo ${cls}">${u.has_avatar ? `<img src="${esc(avatarUrl(u))}" alt="">` : esc(initials(u.name))}</div>`;

// ---- top bar picture, and a menu entry for the profile ----
const _renderApp13 = renderApp;
renderApp = function () {
  _renderApp13.apply(this, arguments);
  paintAvatar();
};
function paintAvatar() {
  const a = $('avatar'); if (!a || !currentUser) return;
  a.innerHTML = currentUser.has_avatar ? `<img src="${esc(avatarUrl(currentUser))}" alt="">` : esc(initials(currentUser.name));
  const mp = $('menu-profile'); if (mp) mp.onclick = () => { $('user-menu').style.display = 'none'; navigate('profile'); };
  const sub = $('um-role'); if (sub && currentUser.position) sub.textContent = `${currentUser.position} · ${currentUser.email}`;
}

// ---- the line for today, on every person's home screen ----
async function quoteBanner() {
  let q = null; try { q = (await api('/api/me/quote')).data; } catch (e) { return ''; }
  const hr = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
  const hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="quote-banner">${photoHtml(currentUser, 'sm')}<div><div class="qhi">${hi}, ${esc(currentUser.name.split(' ')[0])}</div><div class="qtext">“${esc(q.quote)}”</div></div></div>`;
}
function withBanner(render) {
  return async (main) => {
    render(main);
    const html = await quoteBanner();
    if (html && main.isConnected) main.insertAdjacentHTML('afterbegin', html);
  };
}

// ---- nav: "You" group, feasibility, insights ----
const _sidebarItems13 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems13(role).map((g) => [g[0], g[1].slice()]);
  const I = (label, route) => ({ label, route, icon: route });
  const money = groups.find((g) => g[0] === 'Money') || groups.find((g) => g[0] === 'Admin');
  if (['owner', 'pm', 'accounts', 'viewer'].includes(role) && money) money[1].push(I('Feasibility', 'feasibility'));
  if (['owner', 'pm'].includes(role)) groups.splice(1, 0, ['Insights', [I('Insights', 'insights')]]);
  groups.push(['You', [I('My profile', 'profile'), I('Team', 'team'), I('My work report', 'workreport')]]);
  return groups;
};

// ======================= PROFILE =======================
async function shrinkPicture(file) {
  // A phone photo can be several MB. Make it a small square (256 px) so it uploads fast on 4G.
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return blob ? new File([blob], 'me.jpg', { type: 'image/jpeg' }) : file;
}

async function refreshMe() {
  currentUser = (await api('/api/auth/me')).data.user; paintAvatar();
}

async function renderProfile(main) {
  const u = currentUser;
  let q = null; try { q = (await api('/api/me/quote')).data; } catch (e) { /* optional */ }
  main.innerHTML = `<h1>My profile</h1>
    <div class="card"><div class="pf-head">${photoHtml(u)}<div><h2>${esc(u.name)}</h2><p class="muted">${esc(u.position || 'Add your position')} · ${esc(u.role)}</p>
      <div class="row-btns" style="margin:0"><button class="btn small" id="pf-photo">${u.has_avatar ? 'Change picture' : 'Add a picture'}</button>${u.has_avatar ? '<button class="btn small" id="pf-nophoto">Remove picture</button>' : ''}<input type="file" id="pf-file" accept="image/*" hidden></div></div></div></div>
    ${q ? `<div class="card" style="border-left:4px solid var(--s4)"><p class="muted">Your line for today</p><p style="font-size:1.1rem;font-weight:600">“${esc(q.quote)}”</p></div>` : ''}
    <div class="card"><h3>About me</h3>
      <div class="field"><label>Full name</label><input id="pf-name" value="${esc(u.name)}"></div>
      <div class="field"><label>Mobile number</label><input id="pf-phone" inputmode="tel" value="${esc((u.phone || '').replace(/^\+91/, ''))}" placeholder="10-digit number"></div>
      <div class="field"><label>Position in the company</label><input id="pf-position" value="${esc(u.position || '')}" placeholder="e.g. Senior Site Engineer"></div>
      <div class="field"><label>A few words about you</label><textarea id="pf-about" rows="3" placeholder="What you work on, what you enjoy">${esc(u.about || '')}</textarea></div>
      <button class="btn btn-primary btn-full" id="pf-save">Save</button></div>
    <div class="row-btns"><button class="btn" data-go="workreport">My work report</button><button class="btn" data-go="team">Team</button><button class="btn" data-go="password">Change password</button></div>`;
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
  $('pf-save').onclick = async () => {
    if (await act(api('/api/me/profile', { method: 'PUT', body: { name: $('pf-name').value, phone: $('pf-phone').value, position: $('pf-position').value, about: $('pf-about').value } }), 'Profile saved')) { await refreshMe(); renderProfile(main); }
  };
  $('pf-photo').onclick = () => $('pf-file').click();
  $('pf-file').onchange = async () => {
    const f = $('pf-file').files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', await shrinkPicture(f));
    if (await act(api('/api/me/avatar', { method: 'POST', body: fd }), 'Picture saved')) { await refreshMe(); renderProfile(main); }
  };
  if ($('pf-nophoto')) $('pf-nophoto').onclick = async () => { if (await act(api('/api/me/avatar', { method: 'DELETE' }), 'Picture removed')) { await refreshMe(); renderProfile(main); } };
}

// ======================= TEAM + THANK-YOUS =======================
async function renderTeam(main) {
  main.innerHTML = '<h1>Team</h1><p class="help">Say thank you to a colleague. They get a notification, and it shows here for everyone.</p><div id="team-body">Loading...</div>';
  try {
    const [t, k] = await Promise.all([api('/api/team'), api('/api/kudos')]);
    const team = t.data.team;
    $('team-body').innerHTML = `<div class="team-grid">${team.map((p) => `<div class="card team-card">${photoHtml(p, 'sm')}<div style="flex:1;min-width:0"><div class="nm">${esc(p.name)}</div><div class="ps">${esc(p.position || p.role)}${p.phone ? ' · ' + esc(p.phone) : ''}</div>${p.kudos_30d ? `<div class="ps">♥ ${p.kudos_30d} thank-you${p.kudos_30d > 1 ? 's' : ''} this month</div>` : ''}</div>
      ${p.id !== currentUser.id ? `<button class="btn small" data-thx="${p.id}">Thank</button>` : ''}</div>`).join('')}</div>
      <h3>Thank-you wall</h3>${k.data.kudos.map((x) => `<div class="card kudo"><b>${esc(x.from_name)}</b> thanked <b>${esc(x.to_name)}</b><p>“${esc(x.message)}”</p><p class="muted">${esc(dateIST(x.created_at))}</p></div>`).join('') || '<p class="muted">No thank-yous yet. Be the first.</p>'}`;
    main.querySelectorAll('[data-thx]').forEach((b) => { b.onclick = async () => {
      const who = team.find((p) => p.id === Number(b.dataset.thx));
      const v = await openForm({ title: 'Thank ' + who.name, fields: [{ name: 'message', label: 'What would you like to thank them for?', type: 'textarea', required: true, placeholder: 'e.g. Thanks for clearing my drawing query so quickly' }], submit: 'Send thank-you' });
      if (v && await act(api('/api/kudos', { method: 'POST', body: { to_user: who.id, message: v.message } }), 'Thank-you sent')) renderTeam(main);
    }; });
  } catch (err) { $('team-body').innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// ======================= WORK REPORT =======================
function workReportHtml(r) {
  const dayLbl = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<div class="stat-row"><div class="stat"><b>${r.total}</b><span>actions recorded</span></div><div class="stat"><b>${r.active_days}</b><span>active days</span></div>${r.highlights.slice(0, 4).map((h) => `<div class="stat"><b>${h.n}</b><span>${esc(h.label)}</span></div>`).join('')}</div>
    ${CH.columns(r.days.map((d) => ({ label: dayLbl(d.date), value: d.count })), { title: 'Work done each day (number of actions)' })}
    ${r.areas.length ? CH.hbars(r.areas.map((a) => ({ label: a.label, value: a.n })), { title: 'Where the time went' }) : ''}
    ${r.highlights.length ? `<h3>What was done</h3>${CH.hbars(r.highlights.map((h) => ({ label: h.label, value: h.n })), { color: 2 })}` : '<p class="muted">No recorded work in this period.</p>'}
    ${r.recent && r.recent.length ? `<h3>Latest entries</h3>${r.recent.map((x) => `<p class="muted"><b>${esc(x.at)}</b> · ${esc(x.summary)}</p>`).join('')}` : ''}`;
}

async function renderWorkReport(main) {
  const iso = (d) => new Date(Date.now() + 19800000 + d * 86400000).toISOString().slice(0, 10);
  let users = [];
  if (['owner', 'pm'].includes(currentUser.role)) { try { users = (await api('/api/team')).data.team; } catch (e) { /* own only */ } }
  main.innerHTML = `<h1>${users.length ? 'Work report' : 'My work report'}</h1><p class="help">Everything recorded under your name in the CRM, shown as charts. Print it or download it for a review meeting.</p>
    <div class="card"><div class="grid">${users.length ? `<div class="field"><label>Person</label><select id="wr-user">${users.map((u) => `<option value="${u.id}"${u.id === currentUser.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>From</label><input type="date" id="wr-from" value="${iso(-29)}"></div><div class="field"><label>To</label><input type="date" id="wr-to" value="${iso(0)}"></div></div>
    <div class="row-btns"><button class="btn small" data-wr="7">Last 7 days</button><button class="btn small" data-wr="30">Last 30 days</button><button class="btn small" data-wr="90">Last 3 months</button></div></div>
    <div id="wr-body">Loading...</div><div class="row-btns" id="wr-actions"></div>`;
  const uid = () => ($('wr-user') ? Number($('wr-user').value) : currentUser.id);
  const qs = (extra = '') => `user_id=${uid()}&from=${$('wr-from').value}&to=${$('wr-to').value}${extra}`;
  const load = async () => {
    try { const r = (await api('/api/reports/work?' + qs())).data;
      $('wr-body').innerHTML = `<div class="card"><h2>${esc(r.person.name)}${r.person.position ? ` <span class="muted" style="font-size:.7em">${esc(r.person.position)}</span>` : ''}</h2><p class="muted">${esc(r.from)} to ${esc(r.to)}</p>${workReportHtml(r)}</div>`;
      $('wr-actions').innerHTML = `<a class="btn btn-primary" href="/print.html?k=workreport&id=${uid()}&from=${r.from}&to=${r.to}" target="_blank" rel="noopener">Print / save as PDF</a><a class="btn" href="/api/reports/work?${qs('&csv=1')}">Download for Excel</a>`;
    } catch (err) { $('wr-body').innerHTML = `<div class="error">${esc(err.message)}</div>`; }
  };
  main.querySelectorAll('[data-wr]').forEach((b) => { b.onclick = () => { $('wr-from').value = iso(-(Number(b.dataset.wr) - 1)); $('wr-to').value = iso(0); load(); }; });
  ['wr-from', 'wr-to', 'wr-user'].forEach((id) => { if ($(id)) $(id).onchange = load; });
  load();
}

// ======================= FEASIBILITY =======================
async function renderFeasibility(main) {
  const projects = await projectOptions();
  if (!projects.length) { main.innerHTML = '<h1>Feasibility</h1><div class="card"><p>No projects yet.</p></div>'; return; }
  main.innerHTML = `<h1>Feasibility study</h1><p class="help">Keep every version of a project's feasibility study. Add a new version whenever the figures are reviewed: version 1 is never overwritten.</p>
    <div class="field"><label>Project</label><select id="fea-project">${projects.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div><div id="fea-body">Loading...</div>`;
  $('fea-project').onchange = () => loadFeasibility(Number($('fea-project').value));
  loadFeasibility(Number($('fea-project').value));
}

async function loadFeasibility(pid) {
  const body = $('fea-body'); if (!body) return;
  try {
    const list = (await api(`/api/feasibility?project_id=${pid}`)).data.versions, canAdd = isRole('owner', 'pm');
    const asc = list.slice().reverse();
    const money = (p) => p == null ? '—' : moneyP(p);
    body.innerHTML = `${canAdd ? '<button class="btn btn-primary btn-full" id="fea-new">+ Add a new version</button>' : ''}
      ${asc.length >= 2 ? `<div class="card">${CH.grouped(asc.map((v) => ({ label: 'v' + v.version, values: [v.est_cost_paise, v.est_revenue_paise] })), ['Estimated cost', 'Estimated revenue'], { title: 'How the estimate has changed', fmt: CH.rupees })}
        ${asc.filter((v) => v.margin_pct != null).length >= 2 ? CH.line(asc.filter((v) => v.margin_pct != null).map((v) => ({ label: 'v' + v.version, value: v.margin_pct })), { title: 'Margin over versions', suffix: '%' }) : ''}</div>` : ''}
      ${list.map((v) => `<div class="card fea-ver ${v.is_latest ? 'latest' : ''}"><div class="row"><div><b>Version ${v.version}</b> ${v.is_latest ? chip('Latest', 'good') : ''}<h3 style="margin:4px 0">${esc(v.title || 'Feasibility study')}</h3>
        <p class="muted">${esc(v.study_date || dateIST(v.created_at))} · added by ${esc(v.by_name || '')}</p></div></div>
        <div class="stat-row"><div class="stat"><b>${money(v.est_cost_paise)}</b><span>Estimated cost</span></div><div class="stat"><b>${money(v.est_revenue_paise)}</b><span>Estimated revenue</span></div>
        <div class="stat"><b>${v.margin_pct != null ? v.margin_pct + '%' : '—'}</b><span>Margin ${v.margin_paise != null ? '(' + moneyP(v.margin_paise) + ')' : ''}</span></div>
        ${v.saleable_sqft ? `<div class="stat"><b>${Number(v.saleable_sqft).toLocaleString('en-IN')}</b><span>Saleable sq ft</span></div>` : ''}${v.completion_months ? `<div class="stat"><b>${v.completion_months}</b><span>Months to complete</span></div>` : ''}</div>
        ${v.notes ? `<p>${esc(v.notes)}</p>` : ''}${v.document_id ? `<a class="btn small" href="/api/files/download/${v.document_id}">Download study${v.file_title ? ': ' + esc(v.file_title) : ''}</a>` : '<p class="muted">No file attached.</p>'}</div>`).join('') || '<div class="empty-state"><p>No feasibility study saved for this project yet.</p></div>'}`;
    if ($('fea-new')) $('fea-new').onclick = async () => {
      const last = list[0];
      const v = await openForm({ title: last ? `New version (version ${last.version + 1})` : 'First feasibility study (version 1)', fields: [
        { name: 'title', label: 'Title', value: last ? '' : 'Initial feasibility study', required: true },
        { name: 'file', label: 'Study file (PDF or Excel)', type: 'file' },
        { name: 'study_date', label: 'Date of the study', type: 'date', value: today() },
        { name: 'est_cost_paise', label: 'Estimated total cost (₹)', type: 'money', value: last && last.est_cost_paise ? last.est_cost_paise / 100 : '' },
        { name: 'est_revenue_paise', label: 'Estimated total revenue (₹)', type: 'money', value: last && last.est_revenue_paise ? last.est_revenue_paise / 100 : '' },
        { name: 'saleable_sqft', label: 'Saleable area (sq ft)', type: 'number', value: last ? last.saleable_sqft || '' : '' },
        { name: 'completion_months', label: 'Months to complete', type: 'number', value: last ? last.completion_months || '' : '' },
        { name: 'notes', label: 'What changed since the last version?', type: 'textarea' }] });
      if (!v) return;
      let documentId;
      if (v.file) {
        const fd = new FormData(); fd.append('file', await compressFile(v.file), v.file.name); fd.append('title', `Feasibility: ${v.title}`); fd.append('category', 'feasibility'); fd.append('module', 'projects'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
        const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return; documentId = up.data.id;
      }
      const body2 = { project_id: pid, title: v.title, notes: v.notes || '', document_id: documentId };
      ['study_date', 'est_cost_paise', 'est_revenue_paise', 'saleable_sqft', 'completion_months'].forEach((k) => { if (v[k] !== '' && v[k] != null) body2[k] = v[k]; });
      if (await act(api('/api/feasibility', { method: 'POST', body: body2 }), 'New version saved')) loadFeasibility(pid);
    };
  } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// ======================= INSIGHTS (Owner and PM) =======================
async function renderInsights(main) {
  main.innerHTML = '<h1>Insights</h1><p class="help">The business at a glance, as charts. Tap "Show as table" under any chart for the exact numbers.</p><div id="ins-body">Loading...</div>';
  const out = [];
  const [fn, rc, bg] = await Promise.all([api('/api/reports/funnel').catch(() => null), api('/api/reports/receivables').catch(() => null), api('/api/dashboard').catch(() => null)]);
  if (fn) {
    const L = { new: 'New', contacted: 'Contacted', visit_scheduled: 'Visit planned', visited: 'Visited', negotiating: 'Negotiating', booked: 'Booked', lost: 'Lost' };
    out.push(`<div class="card"><h2>Sales leads</h2>${CH.hbars(fn.data.status.map((s) => ({ label: L[s.status] || String(s.status).replace(/_/g, ' '), value: s.n })), { title: 'Leads by stage' })}
      ${fn.data.source.length ? CH.donut(fn.data.source.map((s) => ({ label: String(s.source || 'other').replace(/_/g, ' '), value: s.n })), { title: 'Where leads come from' }) : ''}
      ${fn.data.visit_to_booking.visited ? `<p class="muted">Of ${fn.data.visit_to_booking.visited} leads who visited the site, ${fn.data.visit_to_booking.booked} booked (${fn.data.visit_to_booking.pct}%).</p>` : ''}</div>`);
  }
  if (rc && rc.data.rows.length) {
    const rows = rc.data.rows, collected = rows.reduce((s, r) => s + r.collected, 0), balance = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
    out.push(`<div class="card"><h2>Money from buyers</h2>${CH.donut([{ label: 'Collected', value: collected }, { label: 'Still to collect', value: balance }], { title: 'Collected vs still to collect', fmt: CH.rupees })}
      ${CH.hbars(rows.filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 8).map((r) => ({ label: r.customer_name, value: r.balance, text: CH.rupees(r.balance) })), { title: 'Largest balances to collect', color: 1 })}</div>`);
  }
  $('ins-body').innerHTML = out.join('') || '<div class="empty-state"><p>Charts will appear here as data is added.</p></div>';
}

// ---- register pages, banners ----
Object.assign(PAGES, { profile: (m) => renderProfile(m), team: (m) => renderTeam(m), workreport: (m) => renderWorkReport(m), feasibility: (m) => renderFeasibility(m), insights: (m) => renderInsights(m) });
PAGES.home = withBanner(renderHome); PAGES.dashboard = withBanner(renderDashboard);
Object.assign(ROUTE_TITLES, { profile: 'My profile', team: 'Team', workreport: 'Work report', feasibility: 'Feasibility', insights: 'Insights' });
Object.assign(ICONS, { profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', team: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M17 5a3 3 0 010 6M22 20a6 6 0 00-4-5.6', workreport: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4', feasibility: 'M4 20V10M10 20V4M16 20v-7M22 20H2', insights: 'M3 3v18h18M7 15l4-5 3 3 5-7' });
