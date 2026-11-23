// pages23.js — project details and quick view, AutoDCR link, approval steps and file movement, tasks with a person in charge,
// documents viewed in the app, the phone's section bar, PO charges and terms, and the "tick several" form field.

// ======================= form field: tick several =======================
const _openForm23 = openForm;
openForm = function (opts) {
  const multis = (opts.fields || []).filter((f) => f.type === 'multi');
  const fields = (opts.fields || []).map((f) => (f.type === 'multi' ? { ...f, type: 'text', value: JSON.stringify((f.value || []).map(String)) } : f));
  const p = _openForm23({ ...opts, fields });
  if (multis.length) setTimeout(() => multis.forEach(mountMulti), 0);
  return p.then((v) => { if (v) multis.forEach((f) => { try { v[f.name] = JSON.parse(v[f.name] || '[]').map(Number); } catch (e) { v[f.name] = []; } }); return v; });
};
function mountMulti(f) {
  const el = document.getElementById('f_' + f.name); if (!el) return;
  el.type = 'hidden';
  let sel; try { sel = new Set(JSON.parse(el.value || '[]')); } catch (e) { sel = new Set(); }
  const box = document.createElement('div'); box.className = 'multi-box';
  box.innerHTML = `${f.options.length > 8 ? '<input type="search" class="multi-q" placeholder="Search by name or flat" aria-label="Search">' : ''}
    <div class="row-btns"><button type="button" class="btn small" data-mall>Tick all</button><button type="button" class="btn small" data-mnone>Clear</button><span class="muted multi-n"></span></div>
    <div class="multi-list">${f.options.map(([v, l]) => `<label class="check multi-item"><input type="checkbox" value="${esc(v)}"${sel.has(String(v)) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
  el.after(box);
  const sync = () => { const ids = [...box.querySelectorAll('.multi-list input:checked')].map((i) => i.value); el.value = JSON.stringify(ids); box.querySelector('.multi-n').textContent = `${ids.length} ticked`; };
  box.addEventListener('change', sync);
  const q = box.querySelector('.multi-q');
  if (q) { q.oninput = () => { const s = q.value.toLowerCase(); box.querySelectorAll('.multi-item').forEach((x) => { x.style.display = x.textContent.toLowerCase().includes(s) ? '' : 'none'; }); }; q.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); }; }
  box.querySelector('[data-mall]').onclick = () => { box.querySelectorAll('.multi-item').forEach((x) => { if (x.style.display !== 'none') x.querySelector('input').checked = true; }); sync(); };
  box.querySelector('[data-mnone]').onclick = () => { box.querySelectorAll('.multi-list input').forEach((i) => { i.checked = false; }); sync(); };
  sync();
}

// ======================= see a file without downloading it =======================
async function openViewer(docId) {
  let m;
  try { m = (await api(`/api/files/download/${docId}?meta=1`)).data; } catch (e) { toast(e.message); return; }
  const src = `/api/files/download/${docId}?inline=1`, dl = `/api/files/download/${docId}`;
  if (!m.viewable) { toast('This kind of file opens in its own app. Downloading it.'); location.href = dl; return; }
  const ov = document.createElement('div'); ov.className = 'modal-overlay viewer-overlay';
  const android = /Android/i.test(navigator.userAgent);
  const body = m.kind === 'image' ? `<img src="${src}" alt="${esc(m.title)}" class="viewer-img">`
    : m.kind === 'pdf' && android ? `<div class="empty-state"><p>Phones show PDFs in their own viewer.</p><a class="btn btn-primary" href="${src}" target="_blank" rel="noopener">Open the PDF</a></div>`
      : `<iframe src="${src}" class="viewer-frame" title="${esc(m.title)}"></iframe>`;
  ov.innerHTML = `<div class="modal viewer-modal"><div class="row"><h2 style="margin:0;word-break:break-word">${esc(m.title)}</h2><button class="btn small" id="vw-close" aria-label="Close">Close</button></div>
    <div class="viewer-body">${body}</div>
    <div class="row-btns"><a class="btn small" href="${src}" target="_blank" rel="noopener">Full screen</a><a class="btn small" href="${dl}">Download</a></div></div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.querySelector('#vw-close').onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}
// Every "open file" link in the app opens the viewer instead of downloading.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="/api/files/download/"]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.closest('.viewer-modal')) return;
  const id = (a.getAttribute('href').match(/download\/(\d+)(?:$|\?)/) || [])[1]; if (!id) return;
  e.preventDefault(); openViewer(Number(id));
}, true);

// ======================= phone: the pages of this section in a sliding bar =======================
function paintSubNav() {
  const main = $('app-main'); if (!main || !currentUser) return;
  let bar = $('sub-nav');
  const g = sidebarItems(currentUser.role).find(([name, items]) => name && items.some((i) => i.route === currentPage));
  if (!g || g[1].length < 2) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('nav'); bar.id = 'sub-nav'; bar.className = 'sub-nav'; bar.setAttribute('aria-label', `${g[0]} pages`); main.parentNode.insertBefore(bar, main); }
  bar.innerHTML = g[1].map((i) => `<a href="#" class="sub-link${i.route === currentPage ? ' active' : ''}" data-route="${i.route}"${i.route === currentPage ? ' aria-current="page"' : ''}>${esc(t(i.label))}</a>`).join('');
  bar.querySelectorAll('[data-route]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.route); }; });
  const on = bar.querySelector('.active'); if (on) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.clientWidth) / 2;
}
const _renderApp23 = renderApp;
renderApp = function () { _renderApp23.apply(this, arguments); try { paintSubNav(); } catch (e) { /* never block the screen */ } };

// ======================= shared: people and choices =======================
let PP_CH = null;
async function ppChoices() { if (!PP_CH) PP_CH = (await api('/api/projects-meta/choices')).data; return PP_CH; }
const peopleOpts = (ch, blank = 'Pick a person') => [['', blank], ...ch.people.map((p) => [p.id, `${p.name}${p.position ? ' · ' + p.position : ''}`])];
const desigOpts = (ch, blank = 'Pick') => [['', blank], ...ch.designations.map((d) => [d, d])];
const isMgr23 = () => ['owner', 'pm'].includes(currentUser.role);
const KIND_LABEL = { approval: 'Approval', step: 'Approval step', milestone: 'Milestone', snag: 'Snag', meeting: 'Meeting action', ncr: 'NCR (quality)' };

// Set the person in charge and the expected date on any task.
async function assignTask(kind, id, uid, due) {
  const ch = await ppChoices();
  const v = await openForm({ title: 'Person in charge', intro: 'Who makes sure this gets done, and by when.', fields: [
    { name: 'assigned_to', label: 'Person in charge', type: 'select', options: peopleOpts(ch), value: uid || '', required: true },
    { name: 'due', label: 'Expected completion date', type: 'date', value: due || '', required: true }] });
  if (!v) return false;
  return !!(await act(api('/api/tasks/assign', { method: 'POST', body: { kind, id: Number(id), assigned_to: Number(v.assigned_to), due: v.due } }), 'Saved'));
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-assign]'); if (!b) return;
  e.preventDefault(); const [kind, id] = b.dataset.assign.split(':');
  if (await assignTask(kind, id, b.dataset.uid, b.dataset.due)) { const r = PAGES[currentPage]; if (r) r($('app-main')); }
});

function taskRows(tasks, mgr) {
  if (!tasks.length) return '<div class="empty-state"><p>Nothing open right now.</p></div>';
  return tasks.map((t) => `<div class="card task-row${t.late ? ' late' : ''}"><div class="row"><div><span class="muted">${esc(KIND_LABEL[t.kind] || t.kind)}</span><br><b class="${t.kind === 'approval' || t.kind === 'step' ? 'caps' : ''}">${esc(t.title || '')}</b>
    <p class="muted">In charge: <b>${esc(t.in_charge || 'not set')}</b> · Expected: ${esc(t.due || 'not set')}${t.detail && (t.kind === 'step' || t.kind === 'approval') ? ' · with ' + esc(t.detail) : ''}</p></div>${t.late ? chip('Late', 'bad') : (t.in_charge && t.due ? '' : chip('Needs a person and date', 'warn'))}</div>
    <div class="row-btns">${mgr || (t.kind === 'snag' && currentUser.role !== 'viewer') ? `<button class="btn small" data-assign="${t.kind}:${t.id}" data-uid="${t.user_id || ''}" data-due="${esc(t.due || '')}">Set in charge</button>` : ''}${typeof waBtn === 'function' ? waBtn(`${KIND_LABEL[t.kind] || t.kind}: ${t.title || ''}. In charge: ${t.in_charge || 'not set'}. Expected: ${t.due || 'not set'}${t.late ? ' (LATE)' : ''}.`, 'tasks') : ''}</div></div>`).join('');
}

// ======================= Tasks page =======================
async function renderTasks(main) {
  main.innerHTML = `<h1>Tasks</h1><p class="help">Open work across your projects, each with the person in charge and the expected date.</p>
    <div class="grid"><div class="field"><label>Project</label><select id="tk-p"><option value="">All my projects</option>${(await projectOptions()).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label>Show</label><select id="tk-m"><option value="">Everyone's</option><option value="1">Only mine</option></select></div></div><div id="tasks-body">Loading...</div>`;
  const load = async () => {
    const el = $('tasks-body'); if (!el) return;
    try {
      const qs = new URLSearchParams(); if ($('tk-p').value) qs.set('project_id', $('tk-p').value); if ($('tk-m').value) qs.set('mine', '1');
      const tasks = (await api('/api/tasks?' + qs)).data.tasks;
      el.innerHTML = taskRows(tasks, isMgr23());
    } catch (e) { el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  $('tk-p').onchange = load; $('tk-m').onchange = load; load();
}
PAGES.tasks = (m) => renderTasks(m);
Object.assign(ROUTE_TITLES, { tasks: 'Tasks' });
Object.assign(ICONS, { tasks: 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9' });
const _sidebarItems23 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems23(role);
  if (role !== 'viewer' && !groups.some(([, items]) => items.some((i) => i.route === 'tasks'))) {
    const g = groups.find((x) => x[0] === 'Projects') || groups.find((x) => x[0] === null);
    if (g) { const at = g[1].findIndex((i) => i.route === 'projects'); g[1].splice(at >= 0 ? at + 1 : g[1].length, 0, { label: 'Tasks', route: 'tasks', icon: 'tasks' }); }
  }
  return groups;
};

// ======================= Projects: new project with its details =======================
const sqmToSqft = (x) => Math.round(x * 10.7639);
function profileFields(ch, p = {}) {
  let others = []; try { others = JSON.parse(p.other_authorities || '[]'); } catch (e) { others = []; }
  const oIdx = (name) => ch.other_authorities.indexOf(name);
  return [
    { name: 'members_count', label: 'Number of members', type: 'number', value: p.members_count ?? '', help: 'Society members or existing occupants.' },
    { name: 'plot_area_sqm', label: 'Plot area (sq m)', type: 'number', value: p.plot_area_sqm ?? '', help: '1 sq m = 10.764 sq ft' },
    { name: 'ward', label: 'Ward', value: p.ward || '', placeholder: 'e.g. K/West' },
    { name: 'planning_authority', label: 'Planning authority', type: 'select', value: p.planning_authority || '', options: [['', 'Pick'], ...ch.planning_authorities.map((x) => [x, x])] },
    { name: 'other_authorities', label: 'Other approval authorities involved', type: 'multi', value: others.map(oIdx).filter((i) => i >= 0), options: ch.other_authorities.map((x, i) => [i, x]) },
    { name: 'cts_no', label: 'CTS / survey / plot number', value: p.cts_no || '' },
    { name: 'village', label: 'Village', value: p.village || '' },
    { name: 'property_card_details', label: 'Property card: what it says', type: 'textarea', value: p.property_card_details || '', placeholder: 'Holder, area, tenure, any remarks' },
    { name: 'property_card_file', label: 'Property card copy (optional)', type: 'file' },
    { name: 'conveyance_details', label: 'Conveyance deed details', type: 'textarea', value: p.conveyance_details || '', placeholder: 'Registration number, date, parties' },
    { name: 'conveyance_file', label: 'Conveyance deed copy (optional)', type: 'file' },
    { name: 'maps_url', label: 'Site location: Google Maps link', value: p.maps_url || '', placeholder: 'https://maps.app.goo.gl/…', help: 'In Google Maps: press on the site, tap Share, then Copy link, and paste it here.' },
    { name: 'extra_info', label: 'Other important information', type: 'textarea', value: p.extra_info || '' },
  ];
}
async function saveProfile(pid, v, ch) {
  const up = async (file, title) => {
    if (!file) return undefined;
    const fd = new FormData(); fd.append('file', typeof compressFile === 'function' ? await compressFile(file) : file, file.name); fd.append('title', title); fd.append('category', 'legal'); fd.append('module', 'projects'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
    const r = await act(api('/api/files/upload', { method: 'POST', body: fd })); return r ? r.data.id : undefined;
  };
  const body = { members_count: v.members_count, plot_area_sqm: v.plot_area_sqm, ward: v.ward, planning_authority: v.planning_authority, other_authorities: (v.other_authorities || []).map((i) => ch.other_authorities[i]).filter(Boolean),
    cts_no: v.cts_no, village: v.village, property_card_details: v.property_card_details, conveyance_details: v.conveyance_details, extra_info: v.extra_info };
  if (v.maps_url) body.maps_url = v.maps_url;
  const pc = await up(v.property_card_file, 'Property card'); if (pc) body.property_card_doc_id = pc;
  const cd = await up(v.conveyance_file, 'Conveyance deed'); if (cd) body.conveyance_doc_id = cd;
  const r = await act(api(`/api/projects/${pid}/profile`, { method: 'PUT', body }));
  if (r && v.maps_url && r.data.location_found === false) toast('Saved. The map link did not show the exact spot, so site check-ins will not measure distance. Use a link to a dropped pin.', 7000);
  return !!r;
}
newProject = async function () {
  let brands = []; try { brands = (await api('/api/brands')).data.brands; } catch (e) { /* ignore */ }
  const ch = await ppChoices();
  const v = await openForm({ title: 'New project', intro: 'The basics first, then the details. You can fill in the details later too.', fields: [
    { name: 'name', label: 'Project name', required: true },
    { name: 'code', label: 'Short code', required: true, placeholder: 'e.g. SHIV-A', help: 'Used in PO numbers. Must be unique.' },
    ...(brands.length > 1 && currentUser.role === 'owner' ? [{ name: 'brand_id', label: 'Brand', type: 'select', options: brands.map((b) => [b.id, b.name + (b.is_default ? ' (default)' : '')]) }] : []),
    { name: 'type', label: 'Type', type: 'select', options: [['redevelopment', 'Redevelopment'], ['new_build', 'New build']] },
    { name: 'address', label: 'Address' }, { name: 'city', label: 'City', value: 'Mumbai' }, { name: 'rera_no', label: 'MahaRERA number' },
    ...profileFields(ch)] });
  if (!v) return;
  const base = { name: v.name, code: v.code, type: v.type, address: v.address, city: v.city, rera_no: v.rera_no, ward: v.ward };
  if (v.brand_id) base.brand_id = Number(v.brand_id);
  const r = await act(api('/api/projects', { method: 'POST', body: base }));
  if (!r) return;
  await saveProfile(r.data.id, v, ch);
  toast('Project created'); projectCache = null; brandsLoaded = false; renderProjects($('app-main'));
};
async function editProfile(p) {
  const ch = await ppChoices();
  const v = await openForm({ title: `Details: ${p.name}`, fields: profileFields(ch, p) });
  if (v && await saveProfile(p.id, v, ch)) { projectCache = null; return true; }
  return false;
}

// Project list: tap a project for the quick view; site location only by Google Maps link.
const _loadProjects23 = loadProjects;
loadProjects = async function () {
  await _loadProjects23();
  const list = $('projects-list'); if (!list) return;
  const projects = await getProjects();
  const cards = [...list.querySelectorAll(':scope > .card')].slice(0, projects.length);
  cards.forEach((c, i) => {
    const p = projects[i]; if (!p) return;
    const loc = c.querySelector('[data-loc]'); if (loc) loc.remove();
    let btns = c.querySelector('.row-btns'); if (!btns) { btns = document.createElement('div'); btns.className = 'row-btns'; c.appendChild(btns); }
    btns.insertAdjacentHTML('afterbegin', `<button class="btn small btn-primary" data-pq="${p.id}">Open</button>${p.maps_url ? `<a class="btn small" href="${esc(p.maps_url)}" target="_blank" rel="noopener noreferrer">Map</a>` : ''}${isMgr23() ? `<button class="btn small" data-pe="${p.id}">Details</button>` : ''}`);
    c.classList.add('clickable');
    c.addEventListener('click', (e) => { if (e.target.closest('button,a')) return; projectQuick(p.id); });
  });
  list.querySelectorAll('[data-pq]').forEach((b) => { b.onclick = () => projectQuick(Number(b.dataset.pq)); });
  list.querySelectorAll('[data-pe]').forEach((b) => { b.onclick = async () => { const p = projects.find((x) => x.id === Number(b.dataset.pe)); if (p && await editProfile(p)) loadProjects(); }; });
};

async function projectQuick(id) {
  const main = $('app-main');
  main.innerHTML = '<p>Loading...</p>';
  try {
    const d = (await api(`/api/projects/${id}/overview`)).data, p = d.project;
    let others = []; try { others = JSON.parse(p.other_authorities || '[]'); } catch (e) { others = []; }
    const fact = (l, v) => (v || v === 0 ? `<div class="fact"><span class="muted">${esc(l)}</span><b>${v}</b></div>` : '');
    const a = d.approvals;
    main.innerHTML = `<button class="btn small" id="pq-back">← All projects</button>
      <div class="row"><div><h1 style="margin-bottom:2px">${esc(p.name)}</h1><p class="muted">${esc(p.code)} · ${p.type === 'redevelopment' ? 'Redevelopment' : 'New build'}${p.address ? ' · ' + esc(p.address) : ''}</p></div>${statusChip(p.status)}</div>
      <div class="row-btns">${p.maps_url ? `<a class="btn btn-primary" href="${esc(p.maps_url)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>` : ''}${p.autodcr_url ? `<a class="btn" href="${esc(p.autodcr_url)}" target="_blank" rel="noopener noreferrer">AutoDCR</a>` : ''}${isMgr23() ? '<button class="btn" id="pq-edit">Edit details</button>' : ''}</div>
      <h3>Where it stands</h3>
      <div class="dashboard-grid">
        <div class="card"><span class="muted">Work done</span><p style="font-size:1.6em;margin:4px 0"><b>${p.percent_complete || 0}%</b></p>${CH.meter(p.percent_complete || 0, 100, {})}</div>
        <div class="card"><span class="muted">Approvals</span><p style="font-size:1.6em;margin:4px 0"><b>${a.approved} of ${a.total}</b></p><p class="muted">${a.in_progress} in progress${a.query ? ` · ${a.query} with a query` : ''}</p></div>
        ${d.society ? `<div class="card"><span class="muted">Society: ${esc(d.society.name)}</span><p style="font-size:1.6em;margin:4px 0"><b>${d.society.consented} of ${d.society.members}</b></p><p class="muted">members have consented</p></div>` : ''}
        ${d.sales && d.sales.units ? `<div class="card"><span class="muted">Flats</span><p style="font-size:1.6em;margin:4px 0"><b>${d.sales.sold} of ${d.sales.units}</b></p><p class="muted">booked</p></div>` : ''}
      </div>
      ${a.current.length ? `<h3>Approvals moving now</h3>${a.current.map((x) => `<div class="card"><b class="caps">${esc(x.name)}</b> ${statusChip(x.status)}<p class="muted">File with: <b>${esc(x.holder_designation || 'not recorded')}</b>${x.next_designation ? ' → next: ' + esc(x.next_designation) : ''}</p><p class="muted">In charge: ${esc(x.in_charge || 'not set')} · Expected: ${esc(x.target_date || 'not set')}</p></div>`).join('')}` : ''}
      <h3>Ongoing tasks</h3><div id="pq-tasks">${taskRows(d.tasks, isMgr23())}</div>
      <h3>Project details</h3><div class="card facts">
        ${fact('Number of members', p.members_count)}${fact('Plot area', p.plot_area_sqm ? `${p.plot_area_sqm} sq m (${sqmToSqft(p.plot_area_sqm).toLocaleString('en-IN')} sq ft)` : '')}
        ${fact('Ward', esc(p.ward || ''))}${fact('Planning authority', esc(p.planning_authority || ''))}${fact('Other authorities', esc(others.join(', ')))}
        ${fact('CTS / survey no.', esc(p.cts_no || ''))}${fact('Village', esc(p.village || ''))}${fact('MahaRERA no.', esc(p.rera_no || ''))}
        ${fact('Property card', p.property_card_details || p.property_card_doc_id ? `${esc(p.property_card_details || '')}${p.property_card_doc_id ? ` <a class="btn small" href="/api/files/download/${p.property_card_doc_id}">View copy</a>` : ''}` : '')}
        ${fact('Conveyance deed', p.conveyance_details || p.conveyance_doc_id ? `${esc(p.conveyance_details || '')}${p.conveyance_doc_id ? ` <a class="btn small" href="/api/files/download/${p.conveyance_doc_id}">View copy</a>` : ''}` : '')}
        ${fact('Other information', esc(p.extra_info || ''))}
        ${!p.members_count && !p.plot_area_sqm && !p.planning_authority ? `<div class="empty-state"><p>No details yet.</p>${isMgr23() ? '<button class="btn btn-primary" id="pq-edit2">Add the details</button>' : ''}</div>` : ''}</div>`;
    $('pq-back').onclick = () => renderProjects(main);
    const edit = async () => { if (await editProfile(p)) projectQuick(id); };
    if ($('pq-edit')) $('pq-edit').onclick = edit; if ($('pq-edit2')) $('pq-edit2').onclick = edit;
    main.querySelectorAll('[data-assign]').forEach((b) => { b.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); const [k, i] = b.dataset.assign.split(':'); assignTask(k, i, b.dataset.uid, b.dataset.due).then((ok) => { if (ok) projectQuick(id); }); }, true); });
    window.scrollTo(0, 0);
  } catch (e) { main.innerHTML = `<button class="btn small" id="pq-back">← All projects</button><div class="error">${esc(e.message)}</div>`; $('pq-back').onclick = () => renderProjects(main); }
}

// ======================= Approvals: capital letters, AutoDCR, file movement, steps =======================
renderApprovals = function (main) {
  const canC = isMgr23();
  main.innerHTML = `<h1>Approvals &amp; Compliance</h1><p class="help">Dates are reminders only. Confirm deadlines with your architect and CA.</p>
    <div class="field"><label>Project</label><select id="apr-p"></select></div><div id="apr-dcr"></div>
    ${canC ? '<button class="btn btn-primary" id="apr-new" style="margin-bottom:16px">+ Add approval</button>' : ''}<div id="approvals-list">Loading...</div>`;
  projectOptions().then((opts) => {
    const sel = $('apr-p'); if (!sel) return;
    sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    if (scopeProject && opts.some((o) => String(o[0]) === String(scopeProject))) sel.value = scopeProject;
    sel.onchange = () => loadApprovals();
    loadApprovals();
  });
  if (canC) $('apr-new').onclick = newApproval;
};
PAGES.approvals = (m) => renderApprovals(m);

newApproval = async function () {
  const ch = await ppChoices();
  const v = await openForm({ title: 'New approval', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions(), value: $('apr-p') ? $('apr-p').value : undefined },
    { name: 'name', label: 'Approval (written in capitals)', required: true, placeholder: 'e.g. IOD' }, { name: 'authority', label: 'Authority (e.g. MCGM)' },
    { name: 'category', label: 'Type', type: 'select', options: CAT_ORDER },
    { name: 'owner_user_id', label: 'Person in charge', type: 'select', options: peopleOpts(ch), required: true },
    { name: 'target_date', label: 'Expected completion date', type: 'date', required: true },
    { name: 'valid_till', label: 'Valid till (if it expires)', type: 'date' }, { name: 'notes', label: 'Documents needed / notes', type: 'textarea' }] });
  if (!v) return;
  v.project_id = Number(v.project_id); v.owner_user_id = Number(v.owner_user_id); v.name = v.name.toUpperCase(); if (!v.valid_till) delete v.valid_till;
  if (await act(api('/api/approvals', { method: 'POST', body: v }), 'Added')) loadApprovals();
};

async function paintAutoDcr(pid) {
  const el = $('apr-dcr'); if (!el) return;
  try {
    const d = (await api(`/api/projects/${pid}/autodcr`)).data; const owner = currentUser.role === 'owner';
    el.innerHTML = `<div class="card"><div class="row"><div><b>AutoDCR</b><p class="muted">${d.autodcr_url ? `Set ${esc(String(d.autodcr_set_at || '').slice(0, 10))}${d.set_by_name ? ' by ' + esc(d.set_by_name) : ''}. It cannot be removed.` : (owner ? 'Add the link to this project on AutoDCR.' : 'The Owner has not added the link yet.')}</p></div>
      ${d.autodcr_url ? `<a class="btn btn-primary" href="${esc(d.autodcr_url)}" target="_blank" rel="noopener noreferrer">Open AutoDCR</a>` : ''}</div>
      ${owner ? `<div class="row-btns"><button class="btn small" id="dcr-set">${d.autodcr_url ? 'Correct the link' : 'Add the link'}</button>${d.history.length > 1 ? '<button class="btn small" id="dcr-hist">Earlier links</button>' : ''}</div>` : ''}</div>`;
    if ($('dcr-set')) $('dcr-set').onclick = async () => {
      const v = await openForm({ title: d.autodcr_url ? 'Correct the AutoDCR link' : 'AutoDCR link', intro: 'Once added, the link stays. You can correct it; the old link is kept in the history.', fields: [
        { name: 'url', label: 'AutoDCR link', required: true, value: d.autodcr_url || '', placeholder: 'https://…' }, ...(d.autodcr_url ? [{ name: 'reason', label: 'Why is it being corrected?', required: true }] : [])] });
      if (v && await act(api(`/api/projects/${pid}/autodcr`, { method: 'POST', body: v }), 'Saved')) paintAutoDcr(pid);
    };
    if ($('dcr-hist')) $('dcr-hist').onclick = () => {
      const ov = document.createElement('div'); ov.className = 'modal-overlay';
      ov.innerHTML = `<div class="modal"><h2>AutoDCR link history</h2>${d.history.map((h) => `<div class="card"><p style="word-break:break-all">${esc(h.url)}</p><p class="muted">${esc(String(h.set_at).slice(0, 16))} · ${esc(h.set_by_name || '')} · ${esc(h.reason || '')}</p></div>`).join('')}<div class="modal-actions"><button class="btn" id="dh-close">Close</button></div></div>`;
      document.body.appendChild(ov); ov.querySelector('#dh-close').onclick = () => ov.remove();
    };
  } catch (e) { el.innerHTML = ''; }
}

loadApprovals = async function () {
  const list = $('approvals-list'); if (!list) return;
  try {
    const pid = $('apr-p') && $('apr-p').value ? Number($('apr-p').value) : 0;
    if (pid) paintAutoDcr(pid);
    const items = (await api('/api/approvals')).data.items.filter((a) => !pid || a.project_id === pid);
    if (!items.length) { list.innerHTML = `<div class="empty-state"><p>No approvals yet for this project.</p>${isMgr23() ? '<button class="btn btn-primary" id="apr-tpl">Load the Mumbai approvals checklist</button>' : ''}</div>`;
      if ($('apr-tpl')) $('apr-tpl').onclick = async () => { const p = (await getProjects()).find((x) => x.id === pid); const r = await act(api('/api/approvals/load-template', { method: 'POST', body: { project_id: pid, redevelopment: p && p.type === 'redevelopment' } })); if (r) { toast(`Added ${r.data.count} approvals`); loadApprovals(); } };
      return; }
    const soon = items.filter((a) => a.valid_till && a.status === 'approved' && (new Date(a.valid_till) - new Date(today())) / 86400000 <= 30);
    let html = soon.length ? `<div class="card" style="border-color:#f59e0b;background:#fffbeb"><b>${soon.length} approval${soon.length > 1 ? 's' : ''} expiring within 30 days</b></div>` : '';
    const todayS = today();
    for (const [cat, label] of CAT_ORDER) {
      const group = items.filter((a) => (a.category || 'approval') === cat);
      if (!group.length) continue;
      html += `<h3>${label}</h3>` + group.map((a) => `<div class="card clickable" data-id="${a.id}"><div class="row"><div><b class="caps">${esc(a.name)}</b><p class="muted">${esc(a.authority || '')}</p></div>${statusChip(a.status)}</div>
        ${a.holder_designation ? `<p class="muted">File with: <b>${esc(a.holder_designation)}</b>${a.next_designation ? ' → next: ' + esc(a.next_designation) : ''}</p>` : ''}
        ${!['approved', 'na'].includes(a.status) ? `<p class="muted">In charge: ${esc(a.owner_name || 'not set')} · Expected: ${esc(a.target_date || 'not set')} ${a.target_date && a.target_date < todayS ? chip('Late', 'bad') : ''}</p>` : ''}
        ${a.steps_total ? `<p class="muted">Steps: ${a.steps_done} of ${a.steps_total} done</p>` : ''}<div>${daysLeft(a.valid_till)}</div></div>`).join('');
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-id]').forEach((c) => { c.onclick = () => approvalDetail(Number(c.dataset.id)); });
  } catch (e) { list.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
};

const _approvalDetail23 = approvalDetail;
const STEP_ST = { pending: ['Not started', ''], in_progress: ['In progress', 'info'], done: ['Done', 'good'], na: ['Not needed', ''] };
approvalDetail = async function (id) {
  await _approvalDetail23(id);
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov) return;
  const modal = ov.querySelector('.modal'); const h2 = modal.querySelector('h2'); if (h2) h2.classList.add('caps');
  const holder = document.createElement('div'); modal.insertBefore(holder, modal.querySelector('h3'));
  const canE = userCanClient('approvals', 'E'), canC = canE;
  const paint = async () => {
    const d = (await api(`/api/approvals/${id}/steps`)).data, a = d.item;
    holder.innerHTML = `<div class="card"><p><b>File is with:</b> ${esc(a.holder_designation || 'not recorded')}${a.holder_name ? ' (' + esc(a.holder_name) + ')' : ''}</p>
      <p><b>Goes next to:</b> ${esc(a.next_designation || 'not recorded')}${a.next_name ? ' (' + esc(a.next_name) + ')' : ''}</p>
      <p class="muted">Our person in charge: ${esc(a.owner_name || 'not set')} · Expected: ${esc(a.target_date || 'not set')}</p>
      ${canE ? '<button class="btn small btn-primary" id="ap-file">File moved / update</button>' : ''}</div>
      <h3>Steps</h3>${d.steps.map((s) => `<div class="card"><div class="row"><div><b class="caps">${esc(s.title)}</b><p class="muted">Responsible: ${esc(s.responsible_designation || '—')}${s.responsible_name ? ' (' + esc(s.responsible_name) + ')' : ''}</p>
        <p class="muted">Our person: ${esc(s.assigned_name || 'not set')} · Expected: ${esc(s.target_date || 'not set')}${s.done_on ? ' · Done ' + esc(s.done_on) : ''}</p></div>${chip(STEP_ST[s.status][0], STEP_ST[s.status][1])}</div>
        ${canE ? `<div class="row-btns">${s.status !== 'in_progress' && s.status !== 'done' ? `<button class="btn small" data-ss="${s.id}:in_progress">Started</button>` : ''}${s.status !== 'done' ? `<button class="btn small btn-primary" data-ss="${s.id}:done">Done</button>` : ''}${s.status === 'pending' ? `<button class="btn small" data-ss="${s.id}:na">Not needed</button>` : ''}<button class="btn small" data-se="${s.id}">Edit</button></div>` : ''}</div>`).join('') || '<p class="muted">No steps yet.</p>'}
      ${canC ? `<div class="row-btns"><button class="btn small" id="ap-step">+ Add step</button>${d.has_template && !d.steps.length ? '<button class="btn small btn-primary" id="ap-tpl">Add the usual steps</button>' : ''}</div>` : ''}`;
    const ch = await ppChoices();
    if ($('ap-file')) $('ap-file').onclick = async () => {
      const v = await openForm({ title: 'Where is the file?', fields: [
        { name: 'holder_designation', label: 'Officer now holding the file', type: 'select', options: desigOpts(ch), value: a.holder_designation || '' }, { name: 'holder_name', label: 'Officer name (optional)', value: a.holder_name || '' },
        { name: 'next_designation', label: 'It goes next to', type: 'select', options: desigOpts(ch), value: a.next_designation || '' }, { name: 'next_name', label: 'Name (optional)', value: a.next_name || '' },
        { name: 'owner_user_id', label: 'Our person in charge', type: 'select', options: peopleOpts(ch), value: a.owner_user_id || '' }, { name: 'target_date', label: 'Expected completion date', type: 'date', value: a.target_date || '' }] });
      if (v && await act(api(`/api/approvals/${id}/file`, { method: 'PUT', body: { ...v, owner_user_id: v.owner_user_id ? Number(v.owner_user_id) : null } }), 'Saved')) { paint(); loadApprovals(); }
    };
    const stepForm = async (s = {}) => openForm({ title: s.id ? 'Edit step' : 'New step', fields: [
      { name: 'title', label: 'Step', required: true, value: s.title || '' },
      { name: 'responsible_designation', label: 'Officer responsible', type: 'select', options: desigOpts(ch), value: s.responsible_designation || '' }, { name: 'responsible_name', label: 'Officer name (optional)', value: s.responsible_name || '' },
      { name: 'assigned_to', label: 'Our person in charge', type: 'select', options: peopleOpts(ch), value: s.assigned_to || '', required: true },
      { name: 'target_date', label: 'Expected completion date', type: 'date', value: s.target_date || '', required: true }, ...(s.id ? [{ name: 'note', label: 'Note', value: s.note || '' }] : [])] });
    if ($('ap-step')) $('ap-step').onclick = async () => { const v = await stepForm(); if (v && await act(api(`/api/approvals/${id}/steps`, { method: 'POST', body: { ...v, assigned_to: Number(v.assigned_to) } }), 'Step added')) { paint(); loadApprovals(); } };
    if ($('ap-tpl')) $('ap-tpl').onclick = async () => { const r = await act(api(`/api/approvals/${id}/steps`, { method: 'POST', body: { template: true } })); if (r) { toast(`${r.data.count} steps added. Set the person in charge and date on each.`, 5000); paint(); loadApprovals(); } };
    holder.querySelectorAll('[data-ss]').forEach((b) => { b.onclick = async () => { const [sid, st] = b.dataset.ss.split(':'); if (await act(api(`/api/approval-steps/${sid}`, { method: 'PUT', body: { status: st } }), 'Saved')) { paint(); loadApprovals(); } }; });
    holder.querySelectorAll('[data-se]').forEach((b) => { b.onclick = async () => { const s = d.steps.find((x) => String(x.id) === b.dataset.se); const v = await stepForm(s); if (v && await act(api(`/api/approval-steps/${s.id}`, { method: 'PUT', body: { ...v, assigned_to: Number(v.assigned_to) } }), 'Saved')) { paint(); loadApprovals(); } }; });
  };
  paint().catch((e) => { holder.innerHTML = `<div class="error">${esc(e.message)}</div>`; });
};

// ======================= Site: in-charge on new milestones; snags get a date =======================
// (Milestone cards show "Set in charge"; the button is handled by the shared [data-assign] listener above.)

// ======================= Purchase orders: charges and terms =======================
const PO_CATS = [['', 'Pick'], ['cement', 'Cement'], ['steel', 'Steel'], ['rmc', 'Ready-mix concrete (RMC)'], ['sand_aggregate', 'Sand / aggregate'], ['blocks_bricks', 'Blocks / bricks'], ['electrical', 'Electrical'], ['plumbing', 'Plumbing'], ['tiles', 'Tiles'], ['paint', 'Paint'], ['hardware', 'Hardware'], ['other', 'Other']];
// Extra lines a PO for each kind of material usually carries.
const PO_CAT_FIELDS = {
  cement: [['Brand', 'e.g. UltraTech'], ['Grade', 'OPC 53 / PPC'], ['Bag weight', '50 kg'], ['Manufacturing date not older than', 'e.g. 30 days'], ['Test certificate', 'Required with each lot']],
  steel: [['Brand / make', 'e.g. TATA Tiscon'], ['Grade', 'Fe 500D'], ['Diameters and weights', '8 mm: 2 MT, 12 mm: 5 MT…'], ['Weighment basis', 'Actual weighbridge / theoretical'], ['Mill test certificate', 'Required with each lot']],
  rmc: [['Grade', 'e.g. M25'], ['Slump', 'e.g. 100–120 mm'], ['Pump charges', 'Included / extra'], ['Cube testing', 'Supplier / our lab'], ['Minimum order per pour', 'e.g. 6 cu m']],
  sand_aggregate: [['Material', 'Crushed sand / 20 mm / 10 mm'], ['Measurement basis', 'Brass / tonne'], ['Royalty', 'Included / extra'], ['Silt content limit', 'e.g. under 8%']],
  blocks_bricks: [['Type', 'AAC / fly ash / red brick'], ['Size', 'e.g. 600 x 200 x 150 mm'], ['Breakage allowed', 'e.g. 2%'], ['Strength', 'e.g. 3.5 N/sq mm']],
  electrical: [['Brand / make', ''], ['Specification / model', ''], ['ISI / standard', 'IS mark required']],
  plumbing: [['Brand / make', ''], ['Specification / class', 'e.g. CPVC SDR 11'], ['Pressure rating', '']],
  tiles: [['Brand / make', ''], ['Size and finish', 'e.g. 600 x 600 vitrified glossy'], ['Batch / shade', 'Same batch for each flat'], ['Breakage allowed', 'e.g. 2%']],
  paint: [['Brand / make', ''], ['Product and shade', ''], ['Coverage per litre', '']],
  hardware: [['Brand / make', ''], ['Specification', '']],
  other: [['Specification', '']],
};
async function poTermsForm(po, items) {
  const cat = po.material_category || '';
  let det = {}; try { det = JSON.parse(po.category_details || '{}') || {}; } catch (e) { det = {}; }
  const pick = cat ? cat : (await openForm({ title: 'What material is this PO for?', fields: [{ name: 'c', label: 'Material', type: 'select', options: PO_CATS.slice(1) }] }) || {}).c;
  if (!pick) return null;
  const rs = (p) => (p ? p / 100 : '');
  const extra = PO_CAT_FIELDS[pick] || [];
  const v = await openForm({ title: `Charges and terms · ${po.po_no || 'new PO'}`, intro: 'Material lines stay as they are. Totals are worked out again with these charges.', fields: [
    { name: 'material_category', label: 'Material', type: 'select', options: PO_CATS.slice(1), value: pick },
    ...extra.map(([l, ph], i) => ({ name: 'x' + i, label: l, value: det[l] || '', placeholder: ph })),
    { name: 'transport_paise', label: 'Transportation (₹)', type: 'money', value: rs(po.transport_paise) },
    { name: 'loading_paise', label: 'Loading / unloading (₹)', type: 'money', value: rs(po.loading_paise) },
    { name: 'packing_paise', label: 'Packing and forwarding (₹)', type: 'money', value: rs(po.packing_paise) },
    { name: 'insurance_paise', label: 'Transit insurance (₹)', type: 'money', value: rs(po.insurance_paise) },
    { name: 'other_charges_label', label: 'Any other charge: what is it?', value: po.other_charges_label || '' }, { name: 'other_charges_paise', label: 'Other charge (₹)', type: 'money', value: rs(po.other_charges_paise) },
    { name: 'charges_gst_bp', label: 'GST on these charges', type: 'select', value: po.charges_gst_bp == null ? '' : po.charges_gst_bp, options: [['', 'Same as the material'], ['1800', '18%'], ['1200', '12%'], ['500', '5%'], ['0', 'None']], help: 'Confirm the rate with your CA.' },
    { name: 'price_basis', label: 'Price basis', type: 'select', value: po.price_basis || 'Delivered at site', options: [['Delivered at site', 'Delivered at site'], ['Ex-works (we arrange transport)', 'Ex-works (we arrange transport)'], ['Ex-godown', 'Ex-godown']] },
    { name: 'delivery_date', label: 'Deliver by', type: 'date', value: po.delivery_date || '' },
    { name: 'delivery_address', label: 'Deliver to', value: po.delivery_address || '', placeholder: 'Site address, gate, contact' },
    { name: 'payment_terms', label: 'Payment terms', value: po.payment_terms || '', placeholder: 'e.g. 30 days after delivery and bill' },
    { name: 'warranty', label: 'Warranty / guarantee', value: po.warranty || '' },
    { name: 'penalty_clause', label: 'Penalty for late delivery or poor quality', value: po.penalty_clause || '', placeholder: 'e.g. 0.5% per day, up to 5%' }] });
  if (!v) return null;
  const details = {}; extra.forEach(([l], i) => { if (v['x' + i]) details[l] = v['x' + i]; delete v['x' + i]; });
  v.category_details = details; if (!v.delivery_date) v.delivery_date = '';
  return v;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-poterms]'); if (!b) return;
  e.preventDefault();
  const d = (await api(`/api/print/po/${b.dataset.poterms}`)).data;
  const v = await poTermsForm(d.po, d.items); if (!v) return;
  const r = await act(api(`/api/procurement/pos/${d.po.id}/terms`, { method: 'PUT', body: v }));
  if (r) { toast(`Saved. New total ${moneyP(r.data.total_paise)}`, 5000); loadProcurement(); }
});

// New PO: add the HSN code and point to the charges.
newPo = async function () {
  const vendors = (await api('/api/procurement/vendors')).data.vendors;
  if (!vendors.length) { toast('Add a vendor first'); return; }
  const heads = await budgetHeadOptions();
  const stockItems = await stockItemOptions();
  const v = await openForm({ title: 'New purchase order', intro: 'One material line here. Add transport, loading and the terms with "Charges & terms" on the draft.', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((x) => [x.id, x.name]) },
    { name: 'material_category', label: 'Material', type: 'select', options: PO_CATS },
    { name: 'description', label: 'Item', required: true }, { name: 'hsn', label: 'HSN code (optional)' }, { name: 'qty', label: 'Quantity', type: 'number', required: true }, { name: 'unit', label: 'Unit' },
    { name: 'rate', label: 'Rate per unit (₹)', type: 'money', required: true },
    { name: 'gst_bp', label: 'GST', type: 'select', options: [['1800', '18%'], ['2800', '28%'], ['1200', '12%'], ['500', '5%'], ['0', 'None']], help: 'Confirm the rate with your CA.' },
    { name: 'transport_paise', label: 'Transportation (₹)', type: 'money' },
    { name: 'delivery_date', label: 'Deliver by', type: 'date' }, { name: 'payment_terms', label: 'Payment terms', placeholder: 'e.g. 30 days after delivery and bill' },
    { name: 'terms', label: 'Other terms', type: 'textarea' },
    ...(heads.length ? [{ name: 'budget_head_id', label: 'Budget head', type: 'select', options: heads, help: 'Which cost this belongs to. Used to watch the budget.' }] : []),
    ...(stockItems.length ? [{ name: 'stock_item_id', label: 'Goes into the store as', type: 'select', options: stockItems, help: 'Pick the store item so what you receive is added to stock.' }] : [])] });
  if (!v) return;
  const body = { project_id: Number(v.project_id), vendor_id: Number(v.vendor_id), gst_bp: Number(v.gst_bp), terms: v.terms, budget_head_id: v.budget_head_id ? Number(v.budget_head_id) : null, stock_item_id: v.stock_item_id ? Number(v.stock_item_id) : null,
    material_category: v.material_category || undefined, transport_paise: v.transport_paise || undefined, delivery_date: v.delivery_date || undefined, payment_terms: v.payment_terms || undefined,
    items: [{ description: v.description, hsn: v.hsn, qty: v.qty, unit: v.unit, rate_paise: v.rate }] };
  if (await act(api('/api/procurement/pos', { method: 'POST', body }), 'PO created as draft. Add charges and terms, then send it for approval.')) loadProcurement();
};
