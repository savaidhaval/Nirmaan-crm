// pages2.js — brochure library, people (HR), branding & letterhead, site photos, project archive,
// owner checklist, and Hindi/Marathi for every screen. Loaded after pages.js (later definitions win).

Object.assign(ICONS, {
  brochures: 'M4 4h12a2 2 0 012 2v14l-4-2-4 2-4-2-2 1V6a2 2 0 012-2zM8 9h6M8 13h6',
  people: ICONS.users,
});
Object.assign(ROUTE_TITLES, { brochures: 'Brochures', people: 'People' });
Object.assign(PAGES, { brochures: renderBrochures, people: renderPeople, branding: renderBranding });

// ---------- openForm: multiple files ----------
// (pages.js openForm returns a single File for type 'file'; 'files' returns an array)
const _origOpenForm = openForm;
openForm = function (opts) {
  // A form opened while a project is picked starts on that project.
  const withScope = (f) => (f.name === 'project_id' && f.type === 'select' && f.value === undefined && scopeProject && (f.options || []).some((o) => String(o[0]) === String(scopeProject)) ? { ...f, value: scopeProject } : f);
  const multi = (opts.fields || []).filter((f) => f.type === 'files');
  const fields = (opts.fields || []).map((f) => withScope(f.type === 'files' ? { ...f, type: 'file', _multi: true } : f));
  const p = _origOpenForm({ ...opts, fields });
  if (multi.length) {
    // enable multi-select on the freshly rendered inputs; the submit hook below collects every file
    setTimeout(() => { for (const f of multi) { const el = document.getElementById('f_' + f.name); if (el) { el.multiple = true; el.accept = f.accept || ''; } } }, 0);
  }
  return p;
};
// Capture all selected files at submit time (the original handler only keeps the first).
document.addEventListener('submit', (e) => {
  const form = e.target; if (!form || form.id !== 'modal-form') return;
  const inputs = form.querySelectorAll('input[type=file][multiple]');
  window.__lastFiles = {};
  inputs.forEach((i) => { window.__lastFiles[i.id.replace('f_', '')] = Array.from(i.files); });
}, true);

// ---------- IndexedDB queue for photos ----------
const PHOTO_DB = 'nirmaan-photos';
function photoDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('no idb')); return; }
    const r = indexedDB.open(PHOTO_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const idbDo = (mode, fn) => photoDb().then((db) => new Promise((res, rej) => { const tx = db.transaction('photos', mode); const out = fn(tx.objectStore('photos')); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); tx.onerror = () => rej(tx.error); }));
const queuePhoto = (rec) => idbDo('readwrite', (s) => s.add(rec));
const allPhotos = () => photoDb().then((db) => new Promise((res, rej) => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); })).catch(() => []);
const dropPhoto = (id) => idbDo('readwrite', (s) => s.delete(id)).catch(() => {});

const UMAP = 'nirmaan.uuidmap';
const readMap = () => { try { return JSON.parse(localStorage.getItem(UMAP) || '{}'); } catch (e) { return {}; } };
const saveMapEntry = (uuid, id) => { const m = readMap(); m[uuid] = id; try { localStorage.setItem(UMAP, JSON.stringify(m)); } catch (e) { /* ignore */ } };

async function uploadPhoto(rec, serverId) {
  const fd = new FormData();
  fd.append('file', rec.blob, rec.name || 'photo.jpg');
  fd.append('title', rec.title || 'Site photo'); fd.append('category', 'photo'); fd.append('module', 'site');
  fd.append('entity', rec.entity); fd.append('entity_id', String(serverId)); fd.append('project_id', String(rec.projectId)); fd.append('audience', 'internal');
  await api('/api/files/upload', { method: 'POST', body: fd });
}

// Replaces pages.js syncQueue: sends queued posts, remembers server ids, then sends queued photos.
syncQueue = async function () {
  if (syncing || !currentUser) return;
  syncing = true;
  try {
    const q = readQueue(); const keep = [];
    for (const item of q) {
      try { const r = await api(item.url, { method: 'POST', body: item.body }); if (r.data && r.data.id) saveMapEntry(item.body.client_uuid, r.data.id); }
      catch (e) { if (e instanceof TypeError || !navigator.onLine) keep.push(item); }
    }
    writeQueue(keep);
    const map = readMap();
    for (const rec of await allPhotos()) {
      const id = map[rec.uuid];
      if (!id) continue;
      try { await uploadPhoto(rec, id); await dropPhoto(rec.id); }
      catch (e) { if (!(e instanceof TypeError || !navigator.onLine)) await dropPhoto(rec.id); }
    }
    if (q.length && !keep.length) toast('Offline items sent');
  } finally { syncing = false; }
};

// ---------- Site: reports/snags with photos, snag workflow ----------
async function filePhotos(kind, uuid, projectId, files, serverId) {
  for (const f of files) {
    const blob = await compressFile(f);
    const rec = { uuid, entity: kind, projectId, blob, name: f.name, title: 'Site photo' };
    if (serverId) { try { await uploadPhoto(rec, serverId); continue; } catch (e) { if (!(e instanceof TypeError || !navigator.onLine)) { toast(e.message, 5000); continue; } } }
    try { await queuePhoto(rec); } catch (e) { toast('Could not keep the photo on this phone.', 5000); }
  }
}

newDpr = async function () {
  const v = await openForm({ title: t("Today's work report"), submit: t('Save'), fields: [
    { name: 'project_id', label: t('Project'), type: 'select', options: await projectOptions() },
    { name: 'report_date', label: t('Date'), type: 'date', value: today() },
    { name: 'work_summary', label: t('What work happened today?'), type: 'textarea', required: true },
    { name: 'labour_count', label: t('Labour on site'), type: 'number' }, { name: 'issues', label: t('Problems / delays'), type: 'textarea' },
    { name: 'photos', label: 'Photos', type: 'files', accept: 'image/*', help: 'Optional. Kept on the phone until sent.' }] });
  if (!v) return;
  const files = (window.__lastFiles && window.__lastFiles.photos) || [];
  delete v.photos;
  v.project_id = Number(v.project_id); v.client_uuid = crypto.randomUUID();
  const r = await postOrQueue('/api/site/dprs', v, t('Report saved'));
  if (r) { if (files.length) await filePhotos('site_dprs', v.client_uuid, v.project_id, files, r.data && r.data.id); if (r.data && r.data.id) saveMapEntry(v.client_uuid, r.data.id); renderSite($('app-main')); }
};

newSnag = async function () {
  const v = await openForm({ title: t('Raise a snag'), submit: t('Save'), fields: [
    { name: 'project_id', label: t('Project'), type: 'select', options: await projectOptions() },
    { name: 'title', label: t('What is wrong?'), required: true }, { name: 'location', label: t('Where (wing / floor)') },
    { name: 'severity', label: t('How serious?'), type: 'select', options: [['low', t('Low')], ['medium', t('Medium')], ['high', t('High')]], value: 'medium' },
    { name: 'photos', label: 'Photos', type: 'files', accept: 'image/*' }] });
  if (!v) return;
  const files = (window.__lastFiles && window.__lastFiles.photos) || [];
  delete v.photos;
  v.project_id = Number(v.project_id); v.client_uuid = crypto.randomUUID();
  const r = await postOrQueue('/api/site/snags', v, t('Snag raised'));
  if (r) { if (files.length) await filePhotos('site_snags', v.client_uuid, v.project_id, files, r.data && r.data.id); if (r.data && r.data.id) saveMapEntry(v.client_uuid, r.data.id); renderSite($('app-main')); }
};

async function showPhotos(entity, id) {
  const d = (await api(`/api/attachments?entity=${entity}&entity_id=${id}`)).data.files;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Photos</h2>${d.length ? `<div class="photo-grid">${d.map((f) => `<a href="/api/files/download/${f.id}" target="_blank" rel="noopener"><img src="/api/files/download/${f.id}" alt="${esc(f.title)}" loading="lazy"></a>`).join('')}</div>` : '<p class="muted">No photos.</p>'}<div class="modal-actions"><button class="btn btn-primary" id="ph-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('ph-close').onclick = () => ov.remove();
}

loadSite = async function () {
  if (!$('site-list')) return;
  try {
    const [dprs, snags, ms] = await Promise.all([api('/api/site/dprs'), api('/api/site/snags'), api('/api/site/milestones')]);
    const canE = userCanClient('site', 'C'); const canV = ['owner', 'pm'].includes(currentUser.role);
    let html = `<h3>${esc(t('Milestones'))}</h3>` + (ms.data.milestones.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.name)}</b>${m.wing ? ' · ' + esc(m.wing) : ''}<p class="muted">Planned ${esc(m.planned_date || '—')}${m.actual_date ? ' · Done ' + esc(String(m.actual_date).substring(0, 10)) : ''}</p></div>${m.status === 'done' ? statusChip('done') : (canE ? `<button class="btn small" data-done="${m.id}">${esc(t('Done today'))}</button>` : statusChip('pending'))}</div></div>`).join('') || '<p class="muted">No milestones yet.</p>');
    html += `<h3>${esc(t('Recent reports'))}</h3>` + (dprs.data.dprs.map((d) => `<div class="card"><div class="row"><div><b>${esc(d.report_date)}</b> · ${esc(d.labour_count || 0)} labour</div><button class="btn small" data-ph="site_dprs:${d.id}">Photos</button></div><p>${esc(d.work_summary)}</p></div>`).join('') || '<p class="muted">No reports yet.</p>');
    html += `<h3>${esc(t('Snags'))}</h3>` + (snags.data.snags.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.title)}</b><p class="muted">${esc(s.location || '')}</p></div><div>${chip(s.severity, s.severity === 'high' ? 'bad' : s.severity === 'medium' ? 'warn' : '')} ${statusChip(s.status)}</div></div>
      <div class="row-btns"><button class="btn small" data-ph="site_snags:${s.id}">Photos</button>${s.status === 'open' && canE ? `<button class="btn small" data-snag="fixed" data-id="${s.id}">Mark fixed</button>` : ''}${s.status === 'fixed' && canV ? `<button class="btn small btn-primary" data-snag="verified" data-id="${s.id}">Verify fix</button><button class="btn small" data-snag="open" data-id="${s.id}">Reopen</button>` : ''}</div></div>`).join('') || '<p class="muted">No open snags.</p>');
    const el = $('site-list'); if (!el) return; el.innerHTML = html;
    el.querySelectorAll('[data-done]').forEach((b) => {
      b.onclick = async () => {
        const v = await openForm({ title: 'Milestone done', fields: [{ name: 'actual_date', label: 'Date completed', type: 'date', value: today() }] });
        if (!v) return;
        const r = await act(api(`/api/site/milestones/${b.dataset.done}/done`, { method: 'POST', body: v }));
        if (r) { toast(r.data.demands_ready ? `Done. ${r.data.demands_ready} customer payment demand(s) are now ready.` : 'Marked done'); loadSite(); }
      };
    });
    el.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => { const [en, id] = b.dataset.ph.split(':'); showPhotos(en, id); }; });
    el.querySelectorAll('[data-snag]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/site/snags/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.snag } }), 'Updated')) loadSite(); }; });
  } catch (e) {
    const el = $('site-list');
    if (el) el.innerHTML = `<div class="error">${esc(e instanceof TypeError ? 'You are offline. Reports you file now are saved on this phone and sent later.' : e.message)}</div>`;
  }
};

// ---------- Brochure library ----------
const BROCHURE_CATS = [['brochure', 'Brochure'], ['price_list', 'Price list'], ['floor_plan', 'Floor plan'], ['rera_certificate', 'RERA certificate'], ['sample_flat', 'Sample flat'], ['other', 'Other']];
const catLabel = (c) => (BROCHURE_CATS.find((x) => x[0] === c) || [0, c])[1];

function renderBrochures(main) {
  const mgr = ['owner', 'pm'].includes(currentUser.role);
  main.innerHTML = `<h1>Brochures</h1><p class="help">${mgr ? 'Upload once, tick “can be shared with customers”, then sales can send it. Uploading again with the same title makes a new version; the old one is kept.' : 'Customer-ready files. Tap Send to give a customer a private link.'}</p>
    ${mgr ? '<div class="row-btns" style="margin-bottom:14px"><button class="btn btn-primary" id="br-up">⬆ Upload</button><button class="btn" id="br-link">🔗 Add link</button></div>' : ''}<div id="brochures-list">Loading...</div>`;
  if (mgr) { $('br-up').onclick = () => uploadBrochure(); $('br-link').onclick = () => uploadBrochure(null, true); }
  loadBrochures();
}

async function loadBrochures() {
  try {
    const items = (await api('/api/brochures')).data.items;
    const mgr = ['owner', 'pm'].includes(currentUser.role);
    const el = $('brochures-list'); if (!el) return;
    el.innerHTML = items.map((b) => `<div class="card"><div class="row"><div><b>${esc(b.title)}</b> <span class="muted">v${esc(b.version)}</span><p class="muted">${esc(b.project || '')} · ${esc(catLabel(b.category))}${b.language ? ' · ' + esc(b.language) : ''}</p></div>${b.audience === 'customer' ? chip('Customer-ready', 'good') : chip('Internal', 'warn')}</div>
      <div class="row-btns">${b.audience === 'customer' && userCanClient('share', 'C') ? `<button class="btn small btn-primary" data-send="${b.id}">Send to customer</button>` : ''}${mgr ? `<button class="btn small" data-newver="${b.id}">New version</button>${b.versions > 1 ? `<button class="btn small" data-old="${b.id}">Older versions (${b.versions - 1})</button>` : ''}` : ''}
      ${b.kind === 'link' ? `<a class="btn small" href="${esc(b.external_url)}" target="_blank" rel="noopener noreferrer">Open</a>` : `<a class="btn small" href="/api/files/download/${b.id}">Download</a>`}</div></div>`).join('') || '<div class="empty-state"><p>No brochures yet.</p></div>';
    el.querySelectorAll('[data-send]').forEach((b) => { b.onclick = () => shareDoc(b.dataset.send); });
    el.querySelectorAll('[data-newver]').forEach((b) => { b.onclick = () => uploadBrochure(items.find((x) => String(x.id) === b.dataset.newver)); });
    el.querySelectorAll('[data-old]').forEach((b) => { b.onclick = () => brochureVersions(items.find((x) => String(x.id) === b.dataset.old)); });
  } catch (e) { const el = $('brochures-list'); if (el) el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function uploadBrochure(existing, asLink) {
  const projects = await projectOptions();
  const v = await openForm({ title: existing ? `New version of “${existing.title}”` : (asLink ? 'Add brochure link' : 'Upload brochure'), intro: asLink ? 'Paste a Drive / Dropbox link.' : 'PDF or image. Photos shrink automatically.', fields: [
    ...(asLink ? [{ name: 'external_url', label: 'Link (https://…)', type: 'url', required: true }] : [{ name: 'file', label: 'File', type: 'file', required: true }]),
    { name: 'title', label: 'Title', required: true, value: existing ? existing.title : '' },
    { name: 'project_id', label: 'Project', type: 'select', options: projects, value: existing ? existing.project_id : undefined },
    { name: 'category', label: 'Type', type: 'select', options: BROCHURE_CATS, value: existing ? existing.category : 'brochure' },
    { name: 'language', label: 'Language', type: 'select', options: [['', '—'], ['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']], value: existing ? existing.language || '' : '' },
    { name: 'audience', label: 'Who may see it', type: 'select', options: [['internal', 'Our team only (e.g. internal price list)'], ['customer', 'Can be shared with customers']], value: existing ? existing.audience : 'internal' }] });
  if (!v) return;
  const series = existing ? existing.series_key : `${v.category}:${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  if (asLink) {
    if (await act(api('/api/brochures/link', { method: 'POST', body: { ...v, project_id: Number(v.project_id), series_key: series } }), 'Saved')) loadBrochures();
    return;
  }
  const file = await compressFile(v.file);
  const fd = new FormData();
  fd.append('file', file, v.file.name); fd.append('title', v.title); fd.append('category', v.category); fd.append('module', 'brochure');
  fd.append('project_id', v.project_id); fd.append('audience', v.audience); fd.append('series_key', series); if (v.language) fd.append('language', v.language);
  if (await act(api('/api/files/upload', { method: 'POST', body: fd }), existing ? 'New version saved' : 'Uploaded')) loadBrochures();
}

async function brochureVersions(b) {
  const d = (await api(`/api/brochures/versions?project_id=${b.project_id}&series_key=${encodeURIComponent(b.series_key)}`)).data.versions;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(b.title)} — versions</h2>${d.map((x) => `<div class="card"><div class="row"><div><b>Version ${esc(x.version)}</b> ${x.is_latest ? chip('Current', 'good') : ''}<p class="muted">${esc(dateIST(x.created_at))}</p></div>${x.kind === 'link' ? `<a class="btn small" href="${esc(x.external_url)}" target="_blank" rel="noopener noreferrer">Open</a>` : `<a class="btn small" href="/api/files/download/${x.id}">Download</a>`}</div></div>`).join('')}<div class="modal-actions"><button class="btn btn-primary" id="bv-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('bv-close').onclick = () => ov.remove();
}

// ---------- People (HR) ----------
let peopleTab = 'staff';
function renderPeople(main) {
  main.innerHTML = `<h1>People</h1><div class="tabs" id="ppl-tabs">${[['staff', 'Staff'], ['positions', 'Open positions'], ['interviews', 'Interviews']].map(([k, l]) => `<button class="tab${peopleTab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="people-list">Loading...</div>`;
  main.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { peopleTab = b.dataset.tab; renderPeople(main); }; });
  ({ staff: loadStaff, positions: loadPositions, interviews: loadInterviews })[peopleTab]();
}

async function loadStaff() {
  const mgr = ['owner', 'hr'].includes(currentUser.role);
  const staff = (await api('/api/people/staff')).data.staff;
  const el = $('people-list'); if (!el) return;
  el.innerHTML = (mgr ? '<div class="row-btns" style="grid-column:1/-1"><button class="btn btn-primary" id="st-add">+ Add staff</button></div>' : '') + (staff.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.name)}</b><p class="muted">${esc(s.role_title || '')}${s.department ? ' · ' + esc(s.department) : ''}</p>${s.phone ? `<p class="muted"><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></p>` : ''}</div>${s.active ? chip('Active', 'good') : chip('Left', 'bad')}</div>${mgr ? `<div class="row-btns"><button class="btn small" data-tog="${s.id}" data-act="${s.active ? 0 : 1}">${s.active ? 'Mark as left' : 'Mark as active'}</button></div>` : ''}</div>`).join('') || '<div class="empty-state"><p>No staff yet.</p></div>');
  if (mgr) {
    $('st-add').onclick = async () => {
      const v = await openForm({ title: 'Add staff', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'role_title', label: 'Job title' }, { name: 'department', label: 'Department' }, { name: 'phone', label: 'Mobile', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'joined_on', label: 'Joined on', type: 'date', value: today() }, { name: 'employment', label: 'Type', type: 'select', options: [['staff', 'Staff'], ['contract', 'Contract'], ['daily', 'Daily wage']] }] });
      if (v && await act(api('/api/people/staff', { method: 'POST', body: v }), 'Added')) loadStaff();
    };
    el.querySelectorAll('[data-tog]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/people/staff/${b.dataset.tog}`, { method: 'PUT', body: { active: b.dataset.act === '1' } }), 'Updated')) loadStaff(); }; });
  }
}

async function loadPositions() {
  const mgr = ['owner', 'hr'].includes(currentUser.role);
  const pos = (await api('/api/people/hiring')).data.positions;
  const el = $('people-list'); if (!el) return;
  el.innerHTML = (mgr ? '<div class="row-btns" style="grid-column:1/-1"><button class="btn btn-primary" id="po-add">+ Open a position</button></div>' : '') + (pos.map((p) => `<div class="card clickable" data-pos="${p.id}"><div class="row"><div><b>${esc(p.position)}</b><p class="muted">${esc(p.project || 'Company')} · ${esc(p.candidates)} candidate${p.candidates === 1 ? '' : 's'}</p></div>${statusChip(p.status === 'filled' ? 'done' : 'open').replace(/>[^<]*</, '>' + esc(p.status) + '<')}</div></div>`).join('') || '<div class="empty-state"><p>No open positions.</p></div>');
  if (mgr) $('po-add').onclick = async () => {
    const v = await openForm({ title: 'Open a position', fields: [{ name: 'position', label: 'Position', required: true }, { name: 'project_id', label: 'Project', type: 'select', options: [['', 'Company-wide'], ...(await projectOptions())] }, { name: 'notes', label: 'Notes', type: 'textarea' }] });
    if (v && await act(api('/api/people/hiring', { method: 'POST', body: v }), 'Position opened')) loadPositions();
  };
  el.querySelectorAll('[data-pos]').forEach((c) => { c.onclick = () => candidatesModal(pos.find((x) => String(x.id) === c.dataset.pos)); });
}

const CAND_STATUS = [['new', 'New'], ['screened', 'Screened'], ['interview', 'Interview'], ['offered', 'Offered'], ['hired', 'Hired'], ['rejected', 'Rejected']];
async function candidatesModal(pos) {
  const mgr = ['owner', 'hr'].includes(currentUser.role);
  const cands = (await api(`/api/people/hiring/${pos.id}/candidates`)).data.candidates;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(pos.position)}</h2>${cands.map((c) => `<div class="card"><div class="row"><div><b>${esc(c.name)}</b><p class="muted">${esc(c.phone || '')}${c.interview_on ? ' · interview ' + esc(String(c.interview_on).substring(0, 16).replace('T', ' ')) : ''}</p></div>${statusChip(c.status === 'hired' ? 'done' : c.status === 'rejected' ? 'rejected' : 'open').replace(/>[^<]*</, '>' + esc(c.status) + '<')}</div>
    ${mgr ? `<div class="row-btns"><select data-cs="${c.id}">${CAND_STATUS.map(([k, l]) => `<option value="${k}"${k === c.status ? ' selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}</div>`).join('') || '<p class="muted">No candidates yet.</p>'}
    <div class="modal-actions">${mgr ? '<button class="btn" id="cd-add">+ Candidate</button>' : ''}<button class="btn btn-primary" id="cd-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('cd-close').onclick = () => { ov.remove(); loadPositions(); };
  if ($('cd-add')) $('cd-add').onclick = async () => {
    const v = await openForm({ title: 'Add candidate', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Mobile', type: 'tel' }, { name: 'note', label: 'Note', type: 'textarea' }] });
    if (v && await act(api(`/api/people/hiring/${pos.id}/candidates`, { method: 'POST', body: v }), 'Added')) { ov.remove(); candidatesModal(pos); }
  };
  ov.querySelectorAll('[data-cs]').forEach((sel) => {
    sel.onchange = async () => {
      const body = { status: sel.value };
      if (sel.value === 'interview') { const v = await openForm({ title: 'Interview time', fields: [{ name: 'interview_on', label: 'When', type: 'datetime-local', required: true }] }); if (!v) return; body.interview_on = v.interview_on; }
      const r = await act(api(`/api/people/candidates/${sel.dataset.cs}/status`, { method: 'POST', body }), 'Updated');
      if (r) { if (r.data.converted) toast('Hired — added to Staff'); ov.remove(); candidatesModal(pos); }
    };
  });
}

async function loadInterviews() {
  const rows = (await api('/api/people/interviews')).data.interviews;
  const el = $('people-list'); if (!el) return;
  el.innerHTML = rows.map((c) => `<div class="card"><b>${esc(c.name)}</b> — ${esc(c.position)}<p class="muted">${esc(String(c.interview_on).substring(0, 16).replace('T', ' '))}${c.phone ? ' · ' : ''}${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</p></div>`).join('') || '<div class="empty-state"><p>No interviews scheduled.</p></div>';
}

// ---------- Projects: archive / restore ----------
loadProjects = async function () {
  try {
    const projects = await getProjects(true);
    const list = $('projects-list'); if (!list) return;
    const mgr = ['owner', 'pm'].includes(currentUser.role); const owner = currentUser.role === 'owner';
    let brands = []; try { brands = (await api('/api/brands')).data.brands; } catch (e) { /* roles without branding access */ }
    const bname = (id) => (brands.find((b) => b.id === id) || {}).name;
    list.innerHTML = (projects.map((p) => `<div class="card"><div class="row"><div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.code)} · ${esc(p.city || '')}${p.type === 'redevelopment' ? ' · Redevelopment' : ''}${brands.length > 1 && bname(p.brand_id) ? ' · ' + esc(bname(p.brand_id)) : ''}</p></div>${statusChip(p.status)}</div>
      ${p.address ? `<p class="muted">${esc(p.address)}</p>` : ''}
      ${mgr ? `<div class="row-btns"><button class="btn small" data-tpl="${p.id}" data-redev="${p.type === 'redevelopment' ? 1 : 0}">Load Mumbai approvals checklist</button>${owner && brands.length > 1 ? `<button class="btn small" data-brand="${p.id}">Change brand</button>` : ''}${owner ? `<button class="btn small" data-arch="${p.id}" data-name="${esc(p.name)}">Archive</button>` : ''}</div>` : ''}</div>`).join('') || '<div class="empty-state"><p>No projects yet.</p></div>');
    list.querySelectorAll('[data-tpl]').forEach((b) => { b.onclick = async () => { const r = await act(api('/api/approvals/load-template', { method: 'POST', body: { project_id: Number(b.dataset.tpl), redevelopment: b.dataset.redev === '1' } })); if (r) { toast(`Added ${r.data.count} checklist items`); navigate('approvals'); } }; });
    list.querySelectorAll('[data-brand]').forEach((b) => { b.onclick = async () => {
      const proj = projects.find((x) => String(x.id) === b.dataset.brand);
      const v = await openForm({ title: `Brand for ${proj.name}`, intro: 'Letters, receipts and POs for this project use this brand.', fields: [{ name: 'brand_id', label: 'Brand', type: 'select', options: brands.map((x) => [x.id, x.name]), value: proj.brand_id }] });
      if (v && await act(api(`/api/projects/${proj.id}`, { method: 'PUT', body: { brand_id: Number(v.brand_id) } }), 'Brand changed')) { projectCache = null; brandsLoaded = false; renderProjects($('app-main')); }
    }; });
    list.querySelectorAll('[data-arch]').forEach((b) => { b.onclick = async () => { if (!confirm(`Archive “${b.dataset.name}”? It disappears from every screen and its Drive folder moves to _archive. You can restore it.`)) return; const r = await act(api(`/api/projects/${b.dataset.arch}/archive`, { method: 'POST' })); if (r) { toast(r.data.note, 6000); projectCache = null; brandsLoaded = false; renderProjects($('app-main')); } }; });
    if (owner) {
      const arch = (await api('/api/projects-archived')).data.projects;
      if (arch.length) {
        list.insertAdjacentHTML('beforeend', `<h3>Archived</h3>${arch.map((p) => `<div class="card"><div class="row"><div><b>${esc(p.name)}</b><p class="muted">${esc(p.code)}</p></div><button class="btn small" data-rest="${p.id}">Restore</button></div></div>`).join('')}`);
        list.querySelectorAll('[data-rest]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/projects/${b.dataset.rest}/restore`, { method: 'POST' }), 'Restored')) { projectCache = null; brandsLoaded = false; renderProjects($('app-main')); } }; });
      }
    }
  } catch (e) { const l = $('projects-list'); if (l) l.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
};

// ---------- Sales: email a demand letter ----------
const _bookingDetail = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail(id);
  const overlays = document.querySelectorAll('.modal-overlay'); const ov = overlays[overlays.length - 1]; if (!ov) return;
  ov.querySelectorAll('[data-pdem]').forEach((b) => {
    if (!userCanClient('sales', 'E')) return;
    const mail = document.createElement('button'); mail.className = 'btn small'; mail.textContent = 'Email to customer';
    mail.onclick = async () => {
      const v = await openForm({ title: 'Email demand letter', intro: 'Leave the address blank to use the one on the booking.', fields: [{ name: 'to', label: 'Customer email', type: 'email' }] });
      if (!v) return;
      const r = await act(api(`/api/sales/demands/${b.dataset.pdem}/email`, { method: 'POST', body: v }));
      if (r) r.data.sent ? toast('Sent') : alert('Could not send: ' + r.data.error);
    };
    b.after(mail);
  });
};

// ---------- Branding & letterhead ----------
function svgToPng(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const w = 600; const h = Math.max(1, Math.round(w * ((img.height || 100) / (img.width || 100)))); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url); c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the SVG.'))), 'image/png'); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that SVG.')); };
    img.src = url;
  });
}
const contrastOnWhite = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 21; const c = [0, 2, 4].map((i) => { const v = parseInt(m[1].substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05); };

const PICS = [['logo', 'Logo', 'Shown in the app and on letters'], ['signature', 'Signature', 'Printed only on issued documents. Never shown publicly.'], ['stamp', 'Company stamp', 'Printed only on issued documents. Never shown publicly.'],
  ['letterhead', 'Full-page letterhead', 'Used when style is “Full-page image”'], ['header', 'Header band', 'Used when style is “Header + footer bands”'], ['footer', 'Footer band', 'Used when style is “Header + footer bands”']];

let brandSel = 0;
async function renderBranding(main) {
  const owner = currentUser.role === 'owner'; const canEdit = owner;
  main.innerHTML = `<h1>Branding & letterhead</h1><div id="brandbar" class="brandbar"></div><div id="branding-form" class="stack">Loading...</div>`;
  let brands = [];
  try { brands = (await api('/api/brands')).data.brands; } catch (e) { $('branding-form').innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (!brands.some((b) => b.id === brandSel)) brandSel = (brands.find((b) => b.is_default) || brands[0] || { id: 1 }).id;
  const cur = brands.find((b) => b.id === brandSel) || {};
  if (!$('brandbar')) return; // moved to another screen while loading
  $('brandbar').innerHTML = `${brands.length > 1 || owner ? `<label for="brand-sel"><b>Brand</b></label><select id="brand-sel">${brands.map((b) => `<option value="${b.id}"${b.id === brandSel ? ' selected' : ''}>${esc(b.name)}${b.is_default ? ' (default)' : ''} — ${b.projects} project${b.projects === 1 ? '' : 's'}</option>`).join('')}</select>` : ''}
    ${owner ? '<button class="btn small" id="brand-new">+ New brand</button><button class="btn small" id="brand-rename">Rename</button>' + (cur.is_default ? '' : '<button class="btn small" id="brand-default">Make default</button><button class="btn small" id="brand-del" style="color:#dc2626">Remove</button>') : ''}`;
  if ($('brand-sel')) $('brand-sel').onchange = () => { brandSel = Number($('brand-sel').value); renderBranding(main); };
  if (owner) {
    $('brand-new').onclick = async () => { const v = await openForm({ title: 'New brand', intro: 'A brand has its own company details, bank, signature, stamp and letterhead. Assign projects to it under Projects → Change brand.', fields: [{ name: 'name', label: 'Brand name', required: true }] }); if (v) { const r = await act(api('/api/brands', { method: 'POST', body: v }), 'Brand added'); if (r) { brandSel = r.data.id; brandsLoaded = false; renderBranding(main); } } };
    $('brand-rename').onclick = async () => { const v = await openForm({ title: 'Rename brand', fields: [{ name: 'name', label: 'Brand name', value: cur.name, required: true }] }); if (v && await act(api(`/api/brands/${brandSel}`, { method: 'PUT', body: v }), 'Renamed')) { brandsLoaded = false; renderBranding(main); } };
    if ($('brand-default')) $('brand-default').onclick = async () => { if (await act(api(`/api/brands/${brandSel}`, { method: 'PUT', body: { is_default: true } }), 'Default brand changed')) { brandChrome = null; await loadBrandChrome(); paintChrome(); renderBranding(main); } };
    if ($('brand-del')) $('brand-del').onclick = async () => { if (confirm(`Remove brand “${cur.name}”?`) && await act(api(`/api/brands/${brandSel}`, { method: 'DELETE' }), 'Removed')) { brandSel = 0; brandsLoaded = false; renderBranding(main); } };
  }
  api(`/api/branding?brand_id=${brandSel}`).then((r) => {
    if (!$('branding-form')) return;
    const b = r.data.branding || {};
    const f = (id, label, val, type = 'text', help = '') => `<div class="field"><label for="b-${id}">${label}</label><input id="b-${id}" type="${type}" value="${esc(val == null ? '' : val)}"${canEdit ? '' : ' disabled'}>${help ? `<p class="help">${help}</p>` : ''}</div>`;
    $('branding-form').innerHTML = `
      <div class="card"><h2>1. Company</h2>${f('legal_name', 'Legal name', b.legal_name)}${f('trade_name', 'Name shown in the app', b.trade_name)}${f('tagline', 'Tagline', b.tagline)}${f('address', 'Address', b.address)}${f('phone', 'Phone', b.phone, 'tel')}${f('email', 'Email', b.email, 'email')}${f('website', 'Website', b.website)}</div>
      <div class="card"><h2>2. Registrations</h2>${f('gstin', 'GSTIN', b.gstin)}${f('cin_or_llpin', 'CIN / LLPIN', b.cin_or_llpin)}${f('promoter_rera_ref', 'Promoter RERA reference', b.promoter_rera_ref)}
        ${owner ? f('pan', 'PAN' + (b.pan_masked ? ` (saved ${b.pan_masked})` : ''), '', 'text', 'Stored encrypted. Only the Owner can see it. Leave blank to keep.') : ''}</div>
      <div class="card"><h2>3. Bank (printed on demand letters)</h2>${f('bank_account_name', 'Account name', b.bank_account_name)}${f('bank_name', 'Bank', b.bank_name)}${f('bank_branch', 'Branch', b.bank_branch)}${f('bank_ifsc', 'IFSC', b.bank_ifsc)}
        ${owner ? f('bank_account', 'Account number' + (b.bank_account_masked ? ` (saved ${b.bank_account_masked})` : ''), '', 'text', 'Stored encrypted; never printed. Leave blank to keep.') : ''}</div>
      <div class="card"><h2>4. Signature block & footer</h2>${f('signatory_name', 'Signatory name', b.signatory_name)}${f('signatory_title', 'Title', b.signatory_title)}${f('footer_text', 'Footer line on letters', b.footer_text)}${f('wa_intro_text', 'WhatsApp intro text', b.wa_intro_text)}</div>
      <div class="card"><h2>5. Look</h2>
        <div class="field"><label for="b-colour_primary">Main colour</label><input id="b-colour_primary" type="color" value="${esc(b.colour_primary || '#1d4ed8')}"${canEdit ? '' : ' disabled'}><p class="help" id="b-contrast"></p></div>
        <div class="field"><label for="b-letterhead_mode">Letter style</label><select id="b-letterhead_mode"${canEdit ? '' : ' disabled'}><option value="generated">Generated header (no artwork needed)</option><option value="bands">Header + footer bands (images)</option><option value="image">Full-page image (pre-designed letterhead)</option></select></div>
        ${f('margin_top_mm', 'Top margin (mm)', b.margin_top_mm || 45, 'number', 'Space left clear for your artwork on image styles.')}${f('margin_bottom_mm', 'Bottom margin (mm)', b.margin_bottom_mm || 30, 'number')}${f('margin_side_mm', 'Side margin (mm)', b.margin_side_mm || 20, 'number')}</div>
      ${canEdit ? '<div class="row-btns"><button class="btn btn-primary" id="b-save">Save</button><a class="btn" href="/print.html?k=sample&brand=${brandSel}" target="_blank" rel="noopener">How your letters will look</a></div>' : ''}
      <div class="card"><h2>6. Pictures</h2><p class="help">PNG, JPG or SVG (SVG is converted to PNG here). Signature and stamp are only ever shown to signed-in staff.</p>
        ${PICS.map(([k, l, h]) => `<div class="row" style="margin:12px 0"><div><b>${l}</b>${(b.pictures || []).includes(k) ? ' ' + chip('Uploaded', 'good') : ''}<p class="muted">${h}</p></div>${canEdit ? `<label class="btn small" style="cursor:pointer">Choose<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-pic="${k}" hidden></label>` : ''}</div>`).join('')}</div>`;
    $('b-letterhead_mode').value = b.letterhead_mode || 'generated';
    const showContrast = () => { const c = contrastOnWhite($('b-colour_primary').value); $('b-contrast').textContent = c < 4.5 ? `Contrast against white is ${c.toFixed(1)}:1 — below 4.5:1, small text may be hard to read. Pick a darker shade.` : `Contrast ${c.toFixed(1)}:1 — good.`; };
    $('b-colour_primary').oninput = showContrast; showContrast();
    if (canEdit) {
      $('b-save').onclick = async () => {
        const g = (id) => { const e = $('b-' + id); return e ? e.value : undefined; };
        const body = { brand_id: brandSel }; for (const k of ['legal_name', 'trade_name', 'tagline', 'address', 'phone', 'email', 'website', 'gstin', 'cin_or_llpin', 'promoter_rera_ref', 'pan', 'bank_account_name', 'bank_name', 'bank_branch', 'bank_ifsc', 'bank_account', 'signatory_name', 'signatory_title', 'footer_text', 'wa_intro_text', 'colour_primary', 'letterhead_mode', 'margin_top_mm', 'margin_bottom_mm', 'margin_side_mm']) { const v = g(k); if (v !== undefined) body[k] = v; }
        if (await act(api('/api/branding', { method: 'POST', body }), 'Saved')) { brandChrome = null; await loadBrandChrome(); paintChrome(); renderBranding($('app-main')); }
      };
      main.querySelectorAll('[data-pic]').forEach((inp) => {
        inp.onchange = async () => {
          let file = inp.files[0]; if (!file) return;
          try {
            if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) file = new File([await svgToPng(file)], file.name.replace(/\.svg$/i, '.png'), { type: 'image/png' });
            else file = await compressFile(file, 1800, 0.9);
            if (file.size > 1400000) { toast('That picture is too big (max about 1.4 MB). Use a smaller one.', 5000); return; }
            const fd = new FormData(); fd.append('file', file, file.name || inp.dataset.pic + '.png'); fd.append('title', inp.dataset.pic); fd.append('series_key', `brand:${brandSel}:${inp.dataset.pic}`); fd.append('category', 'brand');
            if (await act(api('/api/files/upload', { method: 'POST', body: fd }), 'Picture saved')) { brandChrome = null; renderBranding($('app-main')); }
          } catch (e) { toast(e.message, 5000); }
        };
      });
    }
  }).catch((e) => { if ($('branding-form')) $('branding-form').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}

// ---------- Owner: "Finish setting up" checklist ----------
const _renderDashboard = renderDashboard;
renderDashboard = PAGES.dashboard = function (main) {
  _renderDashboard(main);
  if (currentUser.role !== 'owner') return;
  Promise.all([api('/api/branding'), api('/api/projects'), api('/api/storage/status'), api('/api/email/settings'), api('/api/users')]).then(([br, pr, st, em, us]) => {
    const steps = [
      ['Add your company details', !!(br.data.branding && br.data.branding.legal_name), 'branding'],
      ['Create your first project', pr.data.projects.length > 0, 'projects'],
      ['Connect Google Drive', st.data.gdriveStatus === 'connected', 'storage'],
      ['Set up email', !!em.data.password_set || !!em.data.brevo_key_set, 'email'],
      ['Add your team', us.data.users.length > 1, 'users'],
    ];
    const todo = steps.filter((s) => !s[1]); if (!todo.length || !$('dashboard-grid')) return;
    $('dashboard-grid').insertAdjacentHTML('beforebegin', `<div class="card" style="border-color:var(--brand);background:var(--brand-soft);margin-bottom:16px"><b>Finish setting up (${steps.length - todo.length} of ${steps.length} done)</b><div class="row-btns">${steps.map(([l, ok, r]) => ok ? `<span class="chip" style="background:#dcfce7;color:#166534;text-transform:none">✓ ${esc(l)}</span>` : `<button class="btn small" data-go="${r}">${esc(l)}</button>`).join('')}</div></div>`);
    main.querySelectorAll('.card [data-go]').forEach((el) => { el.onclick = () => navigate(el.dataset.go); });
  }).catch(() => {});
};

// ---------- Hindi / Marathi for every screen ----------
const EXTRA_I18N = {
  hi: { 'Projects': 'प्रोजेक्ट', '+ New project': '+ नया प्रोजेक्ट', 'Approvals & Compliance': 'मंज़ूरियाँ और अनुपालन', 'Drawings': 'ड्रॉइंग', 'Procurement': 'खरीद', 'Sales': 'बिक्री', 'Documents': 'दस्तावेज़', 'Brochures': 'ब्रोशर', 'People': 'लोग', 'Users & access': 'यूज़र और एक्सेस', 'Branding': 'ब्रांडिंग', 'Shared links': 'शेयर लिंक', 'Audit log': 'ऑडिट लॉग', 'Storage': 'स्टोरेज', 'Email': 'ईमेल', 'Settings': 'सेटिंग', 'Work': 'काम', 'Money': 'पैसा', 'Admin': 'एडमिन', 'Setup': 'सेटअप',
    'Money in — this month': 'इस महीने की आमदनी', 'Overdue receivables': 'बकाया वसूली', 'Bills due in 7 days': '7 दिन में देय बिल', 'POs waiting for approval': 'मंज़ूरी के इंतज़ार में PO', 'Site reports yesterday': 'कल की साइट रिपोर्ट', 'Open high-severity snags': 'खुली गंभीर समस्याएँ', 'New leads this week': 'इस हफ़्ते के नए लीड',
    'Purchase orders': 'खरीद आदेश', 'Bills': 'बिल', 'RFQs': 'कोटेशन अनुरोध', 'Vendors': 'विक्रेता', 'Flats': 'फ़्लैट', 'Bookings': 'बुकिंग', 'Leads': 'लीड', '🤝 New lead': '🤝 नया लीड', '🏠 Add flat': '🏠 फ़्लैट जोड़ें', '📊 Payment plan': '📊 भुगतान योजना', '📄 New purchase order': '📄 नया खरीद आदेश', '🛒 New vendor': '🛒 नया विक्रेता', '📋 New RFQ': '📋 नया कोटेशन अनुरोध',
    'Send for approval': 'मंज़ूरी के लिए भेजें', 'Approve': 'मंज़ूर करें', 'Reject': 'अस्वीकार करें', 'Print': 'प्रिंट', 'Material received': 'माल प्राप्त', 'Add bill': 'बिल जोड़ें', 'Mark paid': 'भुगतान हुआ', 'Download': 'डाउनलोड', 'Open': 'खोलें', 'Close': 'बंद करें', 'Edit': 'बदलें', 'Add': 'जोड़ें', 'Delete': 'हटाएँ', 'Back': 'वापस', 'Yes': 'हाँ', 'No': 'नहीं', 'Loading...': 'लोड हो रहा है...',
    'Welcome back': 'वापसी पर स्वागत है', 'Sign in': 'साइन इन', 'Email': 'ईमेल', 'Password': 'पासवर्ड', 'Show': 'दिखाएँ', 'Save password': 'पासवर्ड सेव करें', 'Choose your own password': 'अपना पासवर्ड चुनें', 'New password': 'नया पासवर्ड',
    'Add item': 'आइटम जोड़ें', '+ Add item': '+ आइटम जोड़ें', 'Applied': 'आवेदन किया', 'Not started': 'शुरू नहीं हुआ', 'Approved': 'मंज़ूर', 'Rejected': 'अस्वीकृत', 'Expired': 'समाप्त', 'Timeline': 'समयरेखा', 'Mark applied': 'आवेदन किया', 'Query received': 'प्रश्न आया',
    'Notifications': 'सूचनाएँ', 'No notifications.': 'कोई सूचना नहीं।', 'Nothing here yet.': 'अभी कुछ नहीं।', 'Active': 'सक्रिय', 'Deactivated': 'निष्क्रिय', 'Reset password': 'पासवर्ड रीसेट', 'Deactivate': 'निष्क्रिय करें', 'Reactivate': 'फिर चालू करें', '+ Add person': '+ व्यक्ति जोड़ें', 'Log everyone out': 'सबको लॉग आउट करें',
    'Staff': 'स्टाफ़', 'Open positions': 'खुले पद', 'Interviews': 'इंटरव्यू', 'Candidates': 'उम्मीदवार', 'Upload': 'अपलोड', 'New version': 'नया संस्करण', 'Send to customer': 'ग्राहक को भेजें', 'Archive': 'आर्काइव', 'Restore': 'वापस लाएँ', 'Archived': 'आर्काइव किए गए',
    'Mark fixed': 'ठीक हुआ', 'Verify fix': 'सुधार जाँचें', 'Photos': 'फ़ोटो', 'Material': 'सामग्री', 'Total': 'कुल', 'Status': 'स्थिति', 'Help': 'सहायता' },
  mr: { 'Projects': 'प्रकल्प', '+ New project': '+ नवीन प्रकल्प', 'Approvals & Compliance': 'मंजुरी आणि अनुपालन', 'Drawings': 'ड्रॉइंग्ज', 'Procurement': 'खरेदी', 'Sales': 'विक्री', 'Documents': 'कागदपत्रे', 'Brochures': 'ब्रोशर', 'People': 'माणसे', 'Users & access': 'वापरकर्ते आणि प्रवेश', 'Branding': 'ब्रँडिंग', 'Shared links': 'शेअर लिंक', 'Audit log': 'ऑडिट लॉग', 'Storage': 'साठवण', 'Email': 'ईमेल', 'Settings': 'सेटिंग्ज', 'Work': 'काम', 'Money': 'पैसा', 'Admin': 'प्रशासन', 'Setup': 'सेटअप',
    'Money in — this month': 'या महिन्यातील जमा', 'Overdue receivables': 'थकबाकी वसुली', 'Bills due in 7 days': '7 दिवसांत देय बिले', 'POs waiting for approval': 'मंजुरीच्या प्रतीक्षेतील PO', 'Site reports yesterday': 'कालचे साइट अहवाल', 'Open high-severity snags': 'उघड्या गंभीर अडचणी', 'New leads this week': 'या आठवड्यातील नवे लीड',
    'Purchase orders': 'खरेदी आदेश', 'Bills': 'बिले', 'RFQs': 'दरपत्रक विनंत्या', 'Vendors': 'पुरवठादार', 'Flats': 'सदनिका', 'Bookings': 'बुकिंग', 'Leads': 'लीड', '🤝 New lead': '🤝 नवीन लीड', '🏠 Add flat': '🏠 सदनिका जोडा', '📊 Payment plan': '📊 पेमेंट योजना', '📄 New purchase order': '📄 नवीन खरेदी आदेश', '🛒 New vendor': '🛒 नवीन पुरवठादार', '📋 New RFQ': '📋 नवीन दरपत्रक विनंती',
    'Send for approval': 'मंजुरीसाठी पाठवा', 'Approve': 'मंजूर करा', 'Reject': 'नाकारा', 'Print': 'प्रिंट', 'Material received': 'माल मिळाला', 'Add bill': 'बिल जोडा', 'Mark paid': 'दिले म्हणून नोंदवा', 'Download': 'डाउनलोड', 'Open': 'उघडा', 'Close': 'बंद करा', 'Edit': 'बदला', 'Add': 'जोडा', 'Delete': 'काढा', 'Back': 'मागे', 'Yes': 'होय', 'No': 'नाही', 'Loading...': 'लोड होत आहे...',
    'Welcome back': 'पुन्हा स्वागत', 'Sign in': 'साइन इन', 'Email': 'ईमेल', 'Password': 'पासवर्ड', 'Show': 'दाखवा', 'Save password': 'पासवर्ड जतन करा', 'Choose your own password': 'आपला स्वतःचा पासवर्ड निवडा', 'New password': 'नवीन पासवर्ड',
    'Add item': 'बाब जोडा', '+ Add item': '+ बाब जोडा', 'Applied': 'अर्ज केला', 'Not started': 'सुरू नाही', 'Approved': 'मंजूर', 'Rejected': 'नाकारले', 'Expired': 'मुदत संपली', 'Timeline': 'कालरेषा', 'Mark applied': 'अर्ज केला', 'Query received': 'प्रश्न आला',
    'Notifications': 'सूचना', 'No notifications.': 'सूचना नाहीत.', 'Nothing here yet.': 'अजून काही नाही.', 'Active': 'सक्रिय', 'Deactivated': 'निष्क्रिय', 'Reset password': 'पासवर्ड रीसेट', 'Deactivate': 'निष्क्रिय करा', 'Reactivate': 'पुन्हा सुरू करा', '+ Add person': '+ व्यक्ती जोडा', 'Log everyone out': 'सर्वांना लॉग आउट करा',
    'Staff': 'कर्मचारी', 'Open positions': 'रिक्त पदे', 'Interviews': 'मुलाखती', 'Candidates': 'उमेदवार', 'Upload': 'अपलोड', 'New version': 'नवी आवृत्ती', 'Send to customer': 'ग्राहकाला पाठवा', 'Archive': 'संग्रहित करा', 'Restore': 'परत आणा', 'Archived': 'संग्रहित',
    'Mark fixed': 'दुरुस्त झाले', 'Verify fix': 'दुरुस्ती तपासा', 'Photos': 'फोटो', 'Material': 'साहित्य', 'Total': 'एकूण', 'Status': 'स्थिती', 'Help': 'मदत' },
};
for (const lang of ['hi', 'mr']) Object.assign(I18N[lang], EXTRA_I18N[lang]);

function translateTree(root) {
  const lang = currentUser && currentUser.lang;
  if (!lang || lang === 'en' || !I18N[lang]) return;
  const dict = I18N[lang];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue; const key = raw.trim();
    if (key && dict[key] && !/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName)) n.nodeValue = raw.replace(key, dict[key]);
  }
  if (root.querySelectorAll) root.querySelectorAll('[placeholder],[title]').forEach((el) => { for (const a of ['placeholder', 'title']) { const v = el.getAttribute(a); if (v && dict[v]) el.setAttribute(a, dict[v]); } });
}
new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) translateTree(n); else if (n.nodeType === 3 && n.parentNode) translateTree(n.parentNode); }); }).observe(document.body, { childList: true, subtree: true });

newProject = async function () {
  let brands = []; try { brands = (await api('/api/brands')).data.brands; } catch (e) { /* ignore */ }
  const v = await openForm({
    title: 'New project',
    fields: [
      { name: 'name', label: 'Project name', required: true },
      { name: 'code', label: 'Short code', required: true, placeholder: 'e.g. SHIV-A', help: 'Used in PO numbers. Must be unique.' },
      ...(brands.length > 1 && currentUser.role === 'owner' ? [{ name: 'brand_id', label: 'Brand', type: 'select', options: brands.map((b) => [b.id, b.name + (b.is_default ? ' (default)' : '')]) }] : []),
      { name: 'address', label: 'Address' }, { name: 'ward', label: 'MCGM ward' }, { name: 'city', label: 'City', value: 'Mumbai' },
      { name: 'type', label: 'Type', type: 'select', options: [['new_build', 'New build'], ['redevelopment', 'Redevelopment']] },
      { name: 'rera_no', label: 'MahaRERA number' },
    ],
  });
  if (!v) return;
  if (v.brand_id) v.brand_id = Number(v.brand_id);
  const r = await act(api('/api/projects', { method: 'POST', body: v }), 'Project created');
  if (r) { projectCache = null; brandsLoaded = false; renderProjects($('app-main')); }
};
