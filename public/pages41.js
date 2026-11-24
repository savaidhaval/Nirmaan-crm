// pages41.js — Module 5, step 1: snag pins and work orders, the six-point no-dues panel and possession funds on a booking,
// the defect-liability helpdesk, and the society (CHS) handover vault. Loaded after pages40.js.
Object.assign(ICONS, { dlp: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4', vault: 'M4 5h16v14H4zM8 9h8M8 13h5' });
Object.assign(ROUTE_TITLES, { dlp: 'Defect helpdesk', chsvault: 'Society handover vault' });
Object.assign(PAGES, { dlp: (m) => renderDlp(m), chsvault: (m) => renderChsVault(m) });

const _sidebarItems41 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems41(role).map((g) => [g[0], g[1].slice()]);
  const has = (r) => groups.some((g) => g[1].some((i) => i.route === r));
  const add = [];
  if (['owner', 'pm', 'site', 'accounts', 'viewer'].includes(role) && !has('dlp')) add.push({ label: 'Defect helpdesk', route: 'dlp', icon: 'dlp' });
  if (['owner', 'pm', 'accounts', 'viewer'].includes(role) && !has('chsvault')) add.push({ label: 'Society handover vault', route: 'chsvault', icon: 'vault' });
  if (add.length) { const g = groups.find((x) => x[0] === '5. Possession & Society'); if (g) g[1].push(...add); else groups.push(['5. Possession & Society', add]); }
  return groups;
};

const proj41 = async () => { const ps = await getProjects(); return scopeProject && ps.some((p) => p.id === scopeProject) ? scopeProject : (ps[0] || {}).id; };
async function uploadDoc41(file, projectId, title, extra) {
  const fd = new FormData(); fd.append('file', typeof compressFile === 'function' && /^image\//.test(file.type) ? await compressFile(file) : file, file.name);
  fd.append('project_id', String(projectId)); fd.append('title', title); fd.append('category', (extra && extra.category) || 'other'); fd.append('module', (extra && extra.module) || 'projects'); fd.append('audience', 'internal');
  if (extra && extra.entity) { fd.append('entity', extra.entity); fd.append('entity_id', String(extra.entity_id)); }
  const r = await act(api('/api/files/upload', { method: 'POST', body: fd })); return r ? r.data.id : null;
}

// ---------- a floor plan you tap to place a pin ----------
function pinOnPlan(docId, cur) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal"><h2>Tap the spot</h2><p class="help">Tap where the defect is on the plan.</p><div style="position:relative;display:inline-block;max-width:100%"><img id="pin-img" src="/api/files/download/${docId}" alt="Floor plan" style="max-width:100%;display:block;border:1px solid #cbd5e1"><span id="pin-dot" style="position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 2px #dc2626;display:none"></span></div>
      <div class="modal-actions"><button class="btn" id="pin-cancel">Cancel</button><button class="btn btn-primary" id="pin-ok" disabled>Use this spot</button></div></div>`;
    document.body.appendChild(ov);
    let pos = cur && cur.x != null ? cur : null; const dot = ov.querySelector('#pin-dot'), img = ov.querySelector('#pin-img');
    const show = () => { if (!pos) return; dot.style.display = 'block'; dot.style.left = pos.x / 10 + '%'; dot.style.top = pos.y / 10 + '%'; ov.querySelector('#pin-ok').disabled = false; };
    img.onload = show; show();
    img.onclick = (e) => { const r = img.getBoundingClientRect(); pos = { x: Math.max(0, Math.min(1000, Math.round(((e.clientX - r.left) / r.width) * 1000))), y: Math.max(0, Math.min(1000, Math.round(((e.clientY - r.top) / r.height) * 1000))) }; show(); };
    ov.querySelector('#pin-cancel').onclick = () => { ov.remove(); resolve(null); };
    ov.querySelector('#pin-ok').onclick = () => { ov.remove(); resolve(pos); };
  });
}

async function snagAssign(s) {
  let wos = []; try { wos = (await api('/api/contractors/work-orders')).data.work_orders.filter((w) => w.project_id === s.project_id && w.status === 'approved'); } catch (e) { /* not allowed */ }
  const v = await openForm({ title: 'Snag: contractor and spot', intro: 'The contractor named here cannot get their retention until this snag is verified fixed. Add the floor plan to pin the exact spot.', submit: 'Save', fields: [
    { name: 'wo_id', label: 'Contractor work order', type: 'select', value: s.wo_id || '', options: [['', 'Not assigned'], ...wos.map((w) => [w.id, `${w.wo_no} · ${w.contractor}${w.trade ? ' (' + w.trade + ')' : ''}`])] },
    { name: 'category', label: 'Kind of defect', type: 'select', value: s.category || '', options: [['', '—'], ['civil', 'Civil'], ['flooring', 'Flooring'], ['doors_windows', 'Doors / windows'], ['plumbing', 'Plumbing'], ['electrical', 'Electrical'], ['painting', 'Painting'], ['other', 'Other']] },
    { name: 'plan', label: 'Floor plan picture (optional)', type: 'file', help: s.plan_doc_id ? 'A plan is already attached. Pick a file only to replace it.' : 'A photo or picture of the flat plan.' }] });
  if (!v) return false;
  const body = { wo_id: v.wo_id ? Number(v.wo_id) : null, category: v.category || null };
  let plan = s.plan_doc_id;
  if (v.plan) { plan = await uploadDoc41(v.plan, s.project_id, 'Floor plan', { category: 'drawing', module: 'site' }); if (!plan) return false; body.plan_doc_id = plan; }
  if (plan) { const pos = await pinOnPlan(plan, s.pin_x != null ? { x: s.pin_x, y: s.pin_y } : null); if (pos) { body.pin_x = pos.x; body.pin_y = pos.y; } }
  return !!(await act(api(`/api/site/snags/${s.id}/assign`, { method: 'POST', body }), 'Saved'));
}

const _renderSnags41 = renderSnags;
renderSnags = async function (main) {
  await _renderSnags41(main);
  let all; try { all = (await api('/api/site/snags')).data.snags; } catch (e) { return; }
  main.querySelectorAll('[data-ph^="site_snags:"]').forEach((b) => {
    const id = Number(b.dataset.ph.split(':')[1]); const s = all.find((x) => x.id === id); if (!s || b.parentElement.querySelector('[data-sa]')) return;
    const canE = userCanClient('site', 'E');
    if (canE && s.status !== 'verified') b.insertAdjacentHTML('afterend', `<button class="btn small" data-sa="${id}">${s.wo_id ? 'Contractor ✓' : 'Contractor / spot'}</button>${s.wo_id && s.status === 'open' ? `<button class="btn small" data-af="${id}">After photo</button>` : ''}`);
    if (s.pin_x != null && s.plan_doc_id) b.insertAdjacentHTML('afterend', `<button class="btn small" data-sp="${id}">See spot</button>`);
  });
  main.querySelectorAll('[data-sa]').forEach((b) => { b.onclick = async () => { const s = all.find((x) => x.id === Number(b.dataset.sa)); if (await snagAssign(s)) renderSnags(main); }; });
  main.querySelectorAll('[data-sp]').forEach((b) => { b.onclick = () => { const s = all.find((x) => x.id === Number(b.dataset.sp)); pinOnPlan(s.plan_doc_id, { x: s.pin_x, y: s.pin_y }); }; });
  main.querySelectorAll('[data-af]').forEach((b) => { b.onclick = () => {
    const s = all.find((x) => x.id === Number(b.dataset.af)); const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = async () => { if (inp.files[0] && await uploadDoc41(inp.files[0], s.project_id, 'After photo', { category: 'other', module: 'site', entity: 'site_snags', entity_id: s.id })) toast('After photo added. You can mark it fixed now.', 5000); };
    inp.click(); }; });
};
PAGES.snags = (m) => renderSnags(m);

// ---------- booking: possession panel (six no-dues points, funds, certificate) ----------
const _bookingDetail41 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail41(id);
  if (!['owner', 'pm', 'accounts', 'sales'].includes(currentUser.role)) return;
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || ov.querySelector('#nd-box')) return;
  const modal = ov.querySelector('.modal'); if (!modal) return;
  const box = document.createElement('div'); box.className = 'card'; box.id = 'nd-box'; box.innerHTML = '<b>Possession: six no-dues points</b><p class="muted">Loading…</p>';
  modal.insertBefore(box, modal.querySelector('.modal-actions'));
  const draw = async () => {
    let d; try { d = (await api(`/api/sales/bookings/${id}/no-dues`)).data; } catch (e) { box.remove(); return; }
    const money = ['owner', 'pm', 'accounts'].includes(currentUser.role), acct = ['owner', 'accounts'].includes(currentUser.role);
    box.innerHTML = `<b>Possession: six no-dues points</b> ${d.all_green ? chip('All green', 'good') : chip('Not clear', 'warn')}${d.strict ? '' : ' <span class="muted">(shown as a guide; the Owner can make it a hard lock in Settings)</span>'}
      ${d.points.map((p) => `<p style="margin:4px 0">${p.ok ? '✅' : '⛔'} <b>${esc(p.label)}</b><br><span class="muted">${esc(p.detail)}</span></p>`).join('')}
      <div class="row-btns">${money ? '<button class="btn small" data-pf="due">Set corpus / maintenance due</button>' : ''}${acct ? '<button class="btn small" data-pf="received">Record money received</button>' : ''}<button class="btn small" data-pfl="1">Funds list</button><button class="btn small" data-hd="letter_doc_id">Upload possession letter</button><button class="btn small" data-hd="indemnity_doc_id">Upload indemnity / undertaking</button>${d.handover_status === 'handed_over' ? '<button class="btn small btn-primary" data-cert="1">Possession certificate</button>' : ''}</div>`;
    const heads = Object.entries({ corpus: 'Society corpus fund', maintenance: 'Advance maintenance', share_money: 'Society share money', fitout_deposit: 'Fit-out deposit (refundable)' });
    box.querySelectorAll('[data-pf]').forEach((b) => { b.onclick = async () => {
      const kind = b.dataset.pf; const v = await openForm({ title: kind === 'due' ? 'Amount due from the buyer' : 'Money received', fields: [{ name: 'head', label: 'For', type: 'select', options: heads }, { name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true }, ...(kind === 'received' ? [{ name: 'ref_no', label: 'Cheque / UTR / receipt no.', required: true }] : []), { name: 'on_date', label: 'Date', type: 'date', value: new Date().toISOString().slice(0, 10) }] });
      if (v && await act(api(`/api/sales/bookings/${id}/possession-funds`, { method: 'POST', body: { ...v, kind } }), 'Saved')) draw(); }; });
    box.querySelector('[data-pfl]').onclick = async () => {
      const f = (await act(api(`/api/sales/bookings/${id}/possession-funds`))); if (!f) return;
      alert(Object.values(f.data.heads).map((h) => `${h.label}: due ${moneyP(h.due)}, received ${moneyP(h.received)}${h.refunded ? ', refunded ' + moneyP(h.refunded) : ''}, held ${moneyP(h.held)}`).join('\n'));
    };
    box.querySelectorAll('[data-hd]').forEach((b) => { b.onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,image/*';
      inp.onchange = async () => { if (!inp.files[0]) return; const bk = (await api('/api/sales/bookings/' + id)).data.booking;
        const docId = await uploadDoc41(inp.files[0], bk.project_id, b.dataset.hd === 'letter_doc_id' ? 'Signed possession letter' : 'Indemnity / fit-out undertaking', { category: 'agreement', module: 'sales' });
        if (docId && await act(api(`/api/sales/bookings/${id}/handover/docs`, { method: 'POST', body: { [b.dataset.hd]: docId } }), 'Saved')) draw(); };
      inp.click(); }; });
    const c = box.querySelector('[data-cert]'); if (c) c.onclick = () => openPrint('possession', id);
  };
  draw();
};

// ---------- defect helpdesk ----------
let DLP_TAB = 'open';
async function renderDlp(main) {
  main.innerHTML = '<h1>Defect helpdesk</h1><p class="muted">Loading…</p>';
  const pid = scopeProject || '';
  let d; try { d = (await api('/api/dlp/tickets' + (pid ? '?project_id=' + pid : ''))).data; } catch (e) { main.innerHTML = `<h1>Defect helpdesk</h1><div class="error">${esc(e.message)}</div>`; return; }
  const live = (t) => ['open', 'assigned'].includes(t.status);
  const list = d.tickets.filter((t) => DLP_TAB === 'all' || (DLP_TAB === 'open' ? live(t) : DLP_TAB === 'fixed' ? t.status === 'fixed' : ['verified', 'rejected'].includes(t.status)));
  const canC = userCanClient('site', 'C'), pmOwner = ['owner', 'pm'].includes(currentUser.role), money = ['owner', 'pm', 'accounts'].includes(currentUser.role);
  main.innerHTML = `<h1>Defect helpdesk</h1><p class="help">Complaints from residents during the five-year defect liability period. Give each to the contractor's work order; if they ignore it past the time limit, an outside vendor repairs it and the cost is held against their retention.</p>
    ${canC ? '<button class="btn btn-primary btn-full" id="dlp-new">Log a defect</button>' : ''}
    <p>${chip(d.counts.open + ' open', d.counts.open ? 'warn' : 'good')} ${d.counts.overdue ? chip(d.counts.overdue + ' past the time limit', 'bad') : ''}</p>
    <div class="row-btns">${[['open', 'Open'], ['fixed', 'Fixed'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button class="btn small${DLP_TAB === k ? ' btn-primary' : ''}" data-dt="${k}">${l}</button>`).join('')}</div>
    ${list.length ? list.map((t) => `<div class="card"><div class="row"><div><b>${esc(t.title)}</b><p class="muted">${esc(t.project)}${t.flat ? ' · ' + esc(t.flat) : ''} · ${esc(t.category)} · raised ${esc(t.raised_on)}${t.raised_by_name ? ' by ' + esc(t.raised_by_name) : ''}</p>
      <p class="muted">${t.contractor ? 'Contractor: ' + esc(t.contractor) + ' (' + esc(t.wo_no) + ')' : 'Not given to a contractor yet'}${live(t) ? ' · due by ' + esc(t.sla_due_on) : ''}${t.backcharge_status ? ' · back-charge ' + moneyP(t.backcharge_paise) + ' (' + esc(t.backcharge_status) + ', ' + esc(t.repair_vendor || '') + ')' : ''}</p></div><div>${statusChip(t.status)}${t.overdue ? ' ' + chip('late', 'bad') : ''}</div></div>
      <div class="row-btns">${live(t) && pmOwner || (live(t) && currentUser.role === 'site') ? `<button class="btn small" data-as="${t.id}">${t.wo_id ? 'Change contractor' : 'Give to contractor'}</button>` : ''}${live(t) ? `<button class="btn small" data-st="${t.id}:fixed">Mark fixed</button>` : ''}${t.status === 'fixed' && pmOwner ? `<button class="btn small btn-primary" data-st="${t.id}:verified">Verify fix</button><button class="btn small" data-st="${t.id}:open">Send back</button>` : ''}${live(t) && pmOwner ? `<button class="btn small" data-st="${t.id}:rejected">Reject</button>` : ''}
        ${t.overdue && t.wo_id && !t.backcharge_status && money ? `<button class="btn small" data-bc="${t.id}">Repair by outside vendor (back-charge)</button>` : ''}${t.backcharge_status === 'pending' && ['owner', 'accounts'].includes(currentUser.role) ? `<button class="btn small btn-primary" data-bcc="${t.id}">Confirm back-charge</button>` : ''}</div></div>`).join('') : '<div class="card"><p class="muted">Nothing here.</p></div>'}`;
  const again = () => renderDlp(main);
  main.querySelectorAll('[data-dt]').forEach((b) => { b.onclick = () => { DLP_TAB = b.dataset.dt; again(); }; });
  const nw = $('dlp-new');
  if (nw) nw.onclick = async () => {
    const ps = await getProjects(); const p0 = pid || (ps[0] || {}).id;
    const v = await openForm({ title: 'Log a defect', fields: [{ name: 'project_id', label: 'Project', type: 'select', value: p0, options: ps.map((p) => [p.id, p.name]) }, { name: 'unit_no', label: 'Flat number (e.g. A-402)' }, { name: 'title', label: 'What is wrong', required: true }, { name: 'category', label: 'Kind', type: 'select', options: [['plumbing', 'Plumbing'], ['electrical', 'Electrical'], ['seepage', 'Seepage'], ['civil', 'Civil'], ['finishing', 'Finishing'], ['other', 'Other']] }, { name: 'detail', label: 'Details', type: 'textarea' }, { name: 'raised_by_name', label: 'Resident name' }, { name: 'raised_via', label: 'Came by', type: 'select', options: [['staff', 'Told us in person'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['email', 'Email']] }] });
    if (!v) return;
    const body = { ...v, project_id: Number(v.project_id), client_uuid: crypto.randomUUID() };
    if (v.unit_no) { const inv = (await api('/api/sales/inventory?project_id=' + body.project_id)).data.inventory; const u = inv.find((x) => ((x.wing ? x.wing + '-' : '') + x.unit_no).toLowerCase() === v.unit_no.trim().toLowerCase() || String(x.unit_no).toLowerCase() === v.unit_no.trim().toLowerCase()); if (!u) { toast('That flat number was not found in this project.', 5000); return; } body.unit_id = u.id; }
    const r = await act(api('/api/dlp/tickets', { method: 'POST', body }), 'Logged'); if (r) { if (r.data.warning) toast(r.data.warning, 9000); again(); }
  };
  main.querySelectorAll('[data-as]').forEach((b) => { b.onclick = async () => {
    const t = d.tickets.find((x) => x.id === Number(b.dataset.as));
    const wos = (await api('/api/contractors/work-orders')).data.work_orders.filter((w) => w.project_id === t.project_id && w.status === 'approved');
    if (!wos.length) { toast('No approved work order in this project.', 5000); return; }
    const v = await openForm({ title: 'Give to a contractor', fields: [{ name: 'wo_id', label: 'Work order', type: 'select', options: wos.map((w) => [w.id, `${w.wo_no} · ${w.contractor}${w.trade ? ' (' + w.trade + ')' : ''}`]) }] });
    if (v && await act(api(`/api/dlp/tickets/${t.id}/assign`, { method: 'POST', body: { wo_id: Number(v.wo_id) } }), 'Given')) again(); }; });
  main.querySelectorAll('[data-st]').forEach((b) => { b.onclick = async () => {
    const [id, status] = b.dataset.st.split(':'); const body = { status };
    if (status === 'rejected') { const v = await openForm({ title: 'Reject this ticket', fields: [{ name: 'reject_reason', label: 'Why', required: true }] }); if (!v) return; body.reject_reason = v.reject_reason; }
    if (await act(api(`/api/dlp/tickets/${id}/status`, { method: 'POST', body }), 'Updated')) again(); }; });
  main.querySelectorAll('[data-bc]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Repair by an outside vendor', intro: 'The cost is held against this contractor\'s retention.', fields: [{ name: 'repair_vendor', label: 'Vendor name', required: true }, { name: 'amount_paise', label: 'Repair cost (₹)', type: 'money', required: true }, { name: 'note', label: 'Note' }] });
    if (v && await act(api(`/api/dlp/tickets/${b.dataset.bc}/backcharge`, { method: 'POST', body: v }), 'Held against retention')) again(); }; });
  main.querySelectorAll('[data-bcc]').forEach((b) => { b.onclick = async () => { if (confirm('The repair bill is in. Deduct this amount from the contractor\'s retention?') && await act(api(`/api/dlp/tickets/${b.dataset.bcc}/backcharge/clear`, { method: 'POST', body: {} }), 'Deducted')) again(); }; });
}

// ---------- society handover vault ----------
async function renderChsVault(main) {
  main.innerHTML = '<h1>Society handover vault</h1><p class="muted">Loading…</p>';
  const pid = await proj41(); if (!pid) { main.innerHTML = '<h1>Society handover vault</h1><div class="card"><p>Create a project first.</p></div>'; return; }
  let d; try { d = (await api('/api/chs/vault?project_id=' + pid)).data; } catch (e) { main.innerHTML = `<h1>Society handover vault</h1><div class="error">${esc(e.message)}</div>`; return; }
  const edit = ['owner', 'pm'].includes(currentUser.role);
  main.innerHTML = `<h1>Society handover vault</h1><p class="help">Every statutory paper and equipment warranty the society needs. The project cannot be marked completed until each one is uploaded and the society secretary has acknowledged it.</p>
    <p>${d.complete ? chip('Complete', 'good') : chip(`${d.progress.uploaded} of ${d.progress.required} uploaded · ${d.progress.acknowledged} acknowledged`, 'warn')}</p>
    ${d.empty ? (edit ? '<button class="btn btn-primary btn-full" id="cv-load">Load the standard checklist</button>' : '<div class="card"><p class="muted">The checklist has not been set up yet.</p></div>') : ''}
    ${d.items.map((it) => `<div class="card"><div class="row"><div><b>${esc(it.label)}</b>${it.required ? '' : ' <span class="muted">(optional)</span>'}<p class="muted">${it.document_id ? 'File: ' + esc(it.doc_title || 'attached') + ' · ' + esc(it.uploaded_on || '') : 'Not uploaded'}${it.valid_till ? ' · valid till ' + esc(it.valid_till) : ''}${it.ack_on ? ' · acknowledged by ' + esc(it.ack_by_name) + ' on ' + esc(it.ack_on) : ''}</p></div><div>${it.ack_on ? chip('Acknowledged', 'good') : it.document_id ? chip('Uploaded', 'info') : chip('Missing', 'bad')}</div></div>
      ${edit ? `<div class="row-btns"><button class="btn small" data-up="${it.id}">${it.document_id ? 'Replace file' : 'Upload file'}</button>${it.document_id ? `<a class="btn small" target="_blank" rel="noopener" href="/api/files/download/${it.document_id}">Open</a>` : ''}${it.document_id && !it.ack_on ? `<button class="btn small btn-primary" data-ack="${it.id}">Secretary acknowledged</button>` : ''}${it.kind === 'amc' ? `<button class="btn small" data-vt="${it.id}">Warranty / AMC till</button>` : ''}</div>` : ''}</div>`).join('')}
    ${edit && !d.empty ? '<button class="btn" id="cv-add">Add an item</button>' : ''}
    <h3>Society money ledger</h3><p class="muted">Corpus, advance maintenance and share money collected from buyers, flat by flat. Give this to the society's auditor.</p><a class="btn" href="/api/sales/possession-funds-report?project_id=${pid}&csv=1" download>Download (Excel / CSV)</a>`;
  const again = () => renderChsVault(main);
  if ($('cv-load')) $('cv-load').onclick = async () => { if (await act(api('/api/chs/vault/load-defaults', { method: 'POST', body: { project_id: pid } }), 'Loaded')) again(); };
  if ($('cv-add')) $('cv-add').onclick = async () => { const v = await openForm({ title: 'Add an item', fields: [{ name: 'label', label: 'Document or equipment', required: true }, { name: 'kind', label: 'Kind', type: 'select', options: [['document', 'Document'], ['amc', 'Equipment warranty / AMC']] }] }); if (v && await act(api('/api/chs/vault', { method: 'POST', body: { ...v, project_id: pid } }), 'Added')) again(); };
  main.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,image/*,.doc,.docx,.xls,.xlsx';
    inp.onchange = async () => { if (!inp.files[0]) return; const it = d.items.find((x) => x.id === Number(b.dataset.up)); const docId = await uploadDoc41(inp.files[0], pid, it.label, { category: 'other', module: 'projects' }); if (docId && await act(api('/api/chs/vault/' + it.id, { method: 'PUT', body: { document_id: docId } }), 'Uploaded')) again(); };
    inp.click(); }; });
  main.querySelectorAll('[data-ack]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Secretary acknowledged', fields: [{ name: 'ack_by_name', label: 'Name of the society secretary', required: true }] }); if (v && await act(api(`/api/chs/vault/${b.dataset.ack}/ack`, { method: 'POST', body: v }), 'Recorded')) again(); }; });
  main.querySelectorAll('[data-vt]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Valid till', fields: [{ name: 'valid_till', label: 'Date', type: 'date', required: true }] }); if (v && await act(api('/api/chs/vault/' + b.dataset.vt, { method: 'PUT', body: v }), 'Saved')) again(); }; });
}
