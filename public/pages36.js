// pages36.js — Module 3, step 3: daily report location stamp and Owner override, receipts waiting for a gate photo.
Object.assign(ICONS, { gatephotos: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 100-8 4 4 0 000 8z' });
Object.assign(ROUTE_TITLES, { gatephotos: 'Receipts needing a photo' });
Object.assign(PAGES, { gatephotos: renderGatePhotos });

const _sidebarItems36 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems36(role).map(([g, items]) => [g, [...items]]);
  if (['owner', 'pm', 'purchase', 'site', 'accounts'].includes(role)) {
    const item = { label: 'Receipts needing a photo', route: 'gatephotos', icon: 'gatephotos' };
    let done = false;
    for (const [, items] of groups) { const i = items.findIndex((x) => x.route === 'procurement'); if (i >= 0) { items.splice(i + 1, 0, item); done = true; break; } }
    if (!done) groups[groups.length - 1][1].push(item);
  }
  return groups;
};

// ---------- Daily report: stamp where it was filed from, and let the Owner go past the CC floor with a reason ----------
const _postOrQueue36 = postOrQueue;
postOrQueue = async function (url, body, okMsg) {
  if (url !== '/api/site/dprs') return _postOrQueue36(url, body, okMsg);
  body.client_uuid = body.client_uuid || crypto.randomUUID();
  if (body.lat == null) {
    try { const pos = await new Promise((ok, no) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(ok, no, { timeout: 4000, maximumAge: 60000 }) : no()); body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; body.accuracy_m = pos.coords.accuracy; } catch (e) { /* location is optional */ }
  }
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await api(url, { method: 'POST', body });
      if (r && !(r.data && r.data.queued) && okMsg) toast(okMsg);
      if (r && r.data && r.data.warning) toast(r.data.warning, 9000);
      return r;
    } catch (e) {
      if (e.data && e.data.code === 'cc' && currentUser.role === 'owner') {
        const x = await openForm({ title: 'Go ahead anyway?', intro: e.message, fields: [{ name: 'why', label: 'Your reason (at least 10 letters)', required: true }] });
        if (!x) return null;
        body.override_note = x.why; continue;
      }
      toast(e.message, 7000); return null;
    }
  }
  return null;
};

// ---------- Receipts waiting for their gate photo ----------
async function renderGatePhotos(main) {
  main.innerHTML = '<h1>Receipts needing a photo</h1><p class="help">Each receipt below came in without its gate photo (truck number plate, material and challan together). The supplier\'s bill stays on hold until the photo is added. Tap Add photo and take it from your phone.</p><div id="gp-out">Loading...</div>';
  const load = async () => {
    try {
      const rows = (await api('/api/procurement/grns-without-photo')).data.receipts;
      $('gp-out').innerHTML = rows.map((r) => `<div class="card"><div class="row"><div><b>${esc(r.po_no)} · challan ${esc(r.challan_no || '—')}</b><p class="muted">${esc(r.vendor || '')} · ${esc(r.received_on)}${r.truck_no ? ' · truck ' + esc(r.truck_no) : ''}</p></div></div><button class="btn small btn-primary" data-gp="${r.id}" data-pr="${r.project_id}">Add photo</button></div>`).join('') || '<div class="empty-state"><p>Every receipt has its photo.</p></div>';
      $('gp-out').querySelectorAll('[data-gp]').forEach((b) => { b.onclick = async () => {
        const v = await openForm({ title: 'Gate photo', fields: [{ name: 'photo', label: 'Photo of the truck number plate, material and challan', type: 'file', required: true }] }); if (!v) return;
        const fd = new FormData(); fd.append('file', await compressFile(v.photo), v.photo.name); fd.append('title', 'Gate photo receipt ' + b.dataset.gp); fd.append('category', 'other'); fd.append('module', 'procurement'); fd.append('project_id', b.dataset.pr); fd.append('audience', 'internal');
        const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return;
        if (await act(api(`/api/procurement/grns/${b.dataset.gp}/photo`, { method: 'POST', body: { document_id: up.data.id } }), 'Photo added')) load();
      }; });
    } catch (e) { $('gp-out').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  load();
}
