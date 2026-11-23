// pages27.js — voice notes, milestone dates and holds, PAAA and vacating, debit notes, material check, work-order item links, BOQ, drawing on pour cards.

// ======================= voice notes =======================
// Record on the phone; sent like a photo (kept on the phone when offline). Plays inside the app.
const voiceOk = () => !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
function voiceWidget(host) {
  const st = { rec: null, chunks: [], blob: null, stream: null };
  host.innerHTML = voiceOk() ? `<div class="row-btns"><button type="button" class="btn small" data-vrec>🎤 Record a voice note</button><span class="muted" data-vstate></span></div><audio data-vplay controls hidden style="width:100%"></audio>` : '';
  const btn = host.querySelector('[data-vrec]'); if (!btn) return st;
  const state = host.querySelector('[data-vstate]'), play = host.querySelector('[data-vplay]');
  let t0 = 0, timer = null;
  btn.onclick = async () => {
    if (st.rec && st.rec.state === 'recording') { st.rec.stop(); return; }
    try { st.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast('The microphone is blocked. Allow it in the browser settings.', 6000); return; }
    const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    st.chunks = []; st.rec = new MediaRecorder(st.stream, type ? { mimeType: type } : undefined);
    st.rec.ondataavailable = (e) => { if (e.data.size) st.chunks.push(e.data); };
    st.rec.onstop = () => {
      clearInterval(timer); st.stream.getTracks().forEach((t) => t.stop());
      const base = (st.rec.mimeType || type || 'audio/webm').split(';')[0];
      st.blob = new File(st.chunks, `voice-${Date.now()}.${base.includes('mp4') ? 'm4a' : base.includes('ogg') ? 'ogg' : 'webm'}`, { type: base });
      play.src = URL.createObjectURL(st.blob); play.hidden = false; btn.textContent = '🎤 Record again'; state.textContent = `${Math.round((Date.now() - t0) / 1000)} s recorded`;
    };
    st.rec.start(); t0 = Date.now(); btn.textContent = '⏹ Stop'; state.textContent = 'Recording…';
    timer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); state.textContent = `Recording… ${s} s`; if (s >= 120) st.rec.stop(); }, 500);   // two minutes at most
  };
  return st;
}
// openForm field type 'voice': gives back the recorded File (or '')
const _openForm27 = openForm;
openForm = function (opts) {
  const voices = (opts.fields || []).filter((f) => f.type === 'voice');
  if (!voices.length || !voiceOk()) return _openForm27({ ...opts, fields: (opts.fields || []).filter((f) => f.type !== 'voice') });
  const fields = opts.fields.map((f) => (f.type === 'voice' ? { ...f, type: 'text', value: '' } : f));
  const widgets = {};
  setTimeout(() => voices.forEach((f) => { const el = document.getElementById('f_' + f.name); if (!el) return; el.type = 'hidden'; const box = document.createElement('div'); el.after(box); widgets[f.name] = voiceWidget(box); }), 0);
  return _openForm27({ ...opts, fields }).then((v) => { if (v) voices.forEach((f) => { v[f.name] = (widgets[f.name] && widgets[f.name].blob) || ''; }); return v; });
};
// the attachments list plays voice notes and shows photos
showPhotos = async function (entity, id) {
  const d = (await api(`/api/attachments?entity=${entity}&entity_id=${id}`)).data.files;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const pics = d.filter((f) => /^image\//.test(f.mime || '')), voice = d.filter((f) => /^audio\//.test(f.mime || ''));
  ov.innerHTML = `<div class="modal"><h2>Photos and voice notes</h2>${voice.map((f) => `<p><audio controls preload="none" src="/api/files/download/${f.id}?inline=1" style="width:100%"></audio></p>`).join('')}
    ${pics.length ? `<div class="photo-grid">${pics.map((f) => `<a href="/api/files/download/${f.id}"><img src="/api/files/download/${f.id}?inline=1" alt="${esc(f.title)}" loading="lazy"></a>`).join('')}</div>` : (voice.length ? '' : '<p class="muted">Nothing attached.</p>')}
    <div class="modal-actions"><button class="btn btn-primary" id="ph-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('ph-close').onclick = () => ov.remove();
};
// daily report: a voice note next to the photos
const _newDpr27 = newDpr;
newDpr = async function () {
  await _newDpr27();
  const photos = document.getElementById('dpr-photos'); if (!photos || !voiceOk()) return;
  const box = document.createElement('div'); box.className = 'field'; box.innerHTML = '<label>Voice note (optional)</label><div id="dpr-voice"></div>';
  photos.closest('.field').after(box); const st = voiceWidget(box.querySelector('#dpr-voice'));
  const input = photos; const orig = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
  // hand the recording to the existing photo sending (works offline too)
  Object.defineProperty(input, 'files', { get() { const f = [...orig.get.call(input)]; if (st.blob) f.push(st.blob); return f; } });
};
// snag form: add a voice note
newSnag = async function () {
  const v = await openForm({ title: 'Raise a snag', submit: 'Save', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'title', label: 'What is wrong?', required: true }, { name: 'location', label: 'Where (wing / floor)' },
    { name: 'severity', label: 'How serious?', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], value: 'medium' },
    { name: 'photos', label: 'Photos', type: 'files', accept: 'image/*' }, { name: 'voice', label: 'Voice note (optional)', type: 'voice' }] });
  if (!v) return;
  const files = [...((window.__lastFiles && window.__lastFiles.photos) || [])]; if (v.voice) files.push(v.voice);
  delete v.photos; delete v.voice;
  v.project_id = Number(v.project_id); v.client_uuid = crypto.randomUUID();
  const r = await postOrQueue('/api/site/snags', v, 'Snag raised');
  if (r) { if (files.length) await filePhotos('site_snags', v.client_uuid, v.project_id, files, r.data && r.data.id); if (r.data && r.data.id) saveMapEntry(v.client_uuid, r.data.id); renderSite($('app-main')); }
};

// ======================= milestone dates and holds =======================
const SLIP_REASONS = [['monsoon', 'Monsoon / rain'], ['approvals', 'Approvals'], ['contractor', 'Contractor'], ['material', 'Material'], ['funds', 'Funds'], ['design', 'Design change'], ['other', 'Other']];
function msSlip(m) {
  if (!m.baseline_date) return '';
  const days = m.planned_date ? Math.round((Date.parse(m.planned_date) - Date.parse(m.baseline_date)) / 86400000) : 0;
  return `<p class="muted">Baseline ${esc(m.baseline_date)}${days ? ` · ${days > 0 ? chip(days + ' days late', 'bad') : chip(-days + ' days early', 'good')}` : ''}${m.status !== 'done' && ['owner', 'pm'].includes(currentUser.role) ? ` <button class="btn small" data-msre="${m.id}" data-date="${esc(m.planned_date || '')}">Change date</button>` : ''} <button class="btn small" data-mshist="${m.id}">Date history</button></p>`;
}
document.addEventListener('click', async (e) => {
  const re = e.target.closest && e.target.closest('[data-msre]'); const hi = e.target.closest && e.target.closest('[data-mshist]');
  if (re) {
    e.preventDefault();
    const v = await openForm({ title: 'Change the expected date', intro: 'The baseline stays as it was; every change is kept with its reason.', fields: [
      { name: 'planned_date', label: 'New expected date', type: 'date', value: re.dataset.date, required: true }, { name: 'reason', label: 'Why', type: 'select', options: SLIP_REASONS }, { name: 'note', label: 'Note' }] });
    if (v && await act(api(`/api/site/milestones/${re.dataset.msre}/reschedule`, { method: 'POST', body: v }), 'Date changed')) loadSite();
  } else if (hi) {
    e.preventDefault();
    const rows = (await api(`/api/site/milestones/${hi.dataset.mshist}/changes`)).data.changes;
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal"><h2>Date history</h2>${rows.map((r) => `<p>${esc(r.old_date || '—')} → <b>${esc(r.new_date)}</b> · ${esc((SLIP_REASONS.find((x) => x[0] === r.reason) || [0, r.reason])[1])}${r.note ? ' · ' + esc(r.note) : ''}<br><span class="muted">${esc(r.by_name || '')}, ${esc(String(r.changed_at).slice(0, 10))}</span></p>`).join('') || '<p class="muted">No changes.</p>'}<div class="modal-actions"><button class="btn" id="mh-x">Close</button></div></div>`;
    document.body.appendChild(ov); ov.querySelector('#mh-x').onclick = () => ov.remove();
  }
});
// Site screen: "Fix today's dates as the baseline" for the PM
const _loadSite27 = loadSite;
loadSite = async function () {
  await _loadSite27();
  const el = $('site-list'); if (!el || !['owner', 'pm'].includes(currentUser.role) || el.querySelector('#ms-baseline')) return;
  const h = [...el.querySelectorAll('h3')][0]; if (!h) return;
  h.insertAdjacentHTML('afterend', '<p><button class="btn small" id="ms-baseline">Fix the expected dates as the baseline</button></p>');
  $('ms-baseline').onclick = async () => {
    const opts = await projectOptions();
    const v = await openForm({ title: 'Baseline', intro: 'Copies each milestone\'s expected date as its baseline (only where none is set). Later changes then show as days late.', fields: [{ name: 'project_id', label: 'Project', type: 'select', options: opts }] });
    if (!v) return; const r = await act(api(`/api/projects/${v.project_id}/baseline`, { method: 'POST' })); if (r) { toast(`${r.data.fixed} milestone date(s) fixed as the baseline`); loadSite(); }
  };
};
// Project quick view: holds
const _projectQuick27 = projectQuick;
projectQuick = async function (id) {
  await _projectQuick27(id);
  const main = $('app-main'); const h1 = main.querySelector('h3'); if (!h1) return;
  let holds = []; try { holds = (await api(`/api/projects/${id}/holds`)).data.holds; } catch (e) { return; }
  const open = holds.filter((x) => !x.released_at), pm = ['owner', 'pm'].includes(currentUser.role);
  h1.insertAdjacentHTML('beforebegin', `<div id="pq-holds">${open.map((x) => `<div class="card task-row late"><div class="row"><div><b>${x.wing ? 'Wing ' + esc(x.wing) : 'Whole project'} on hold</b><p class="muted">${esc(x.reason)} · since ${esc(String(x.held_at).slice(0, 10))} · no certifying, pouring or booking there</p></div>${pm ? `<button class="btn small" data-hrel="${x.id}">Release</button>` : ''}</div></div>`).join('')}
    ${pm ? '<button class="btn small" id="pq-hold">Put a wing on hold</button>' : ''}</div>`);
  if ($('pq-hold')) $('pq-hold').onclick = async () => {
    const v = await openForm({ title: 'Put on hold', intro: 'Stops certifying milestones, approving pours and booking flats in that wing until released.', fields: [{ name: 'wing', label: 'Wing (leave empty for the whole project)' }, { name: 'reason', label: 'Why?', required: true, placeholder: 'Redesign of floors 8-12, stay order, dispute...' }] });
    if (v && await act(api(`/api/projects/${id}/holds`, { method: 'POST', body: v }), 'On hold')) projectQuick(id);
  };
  main.querySelectorAll('[data-hrel]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Release the hold', fields: [{ name: 'note', label: 'Why can work go on?', required: true }] }); if (v && await act(api(`/api/holds/${b.dataset.hrel}/release`, { method: 'POST', body: v }), 'Released')) projectQuick(id); }; });
};

// ======================= redevelopment: PAAA and vacating =======================
const _rdMembers27 = rdMembers;
rdMembers = async function (pane) {
  await _rdMembers27(pane);
  let v = null; try { v = (await api(`/api/redev/societies/${RD.soc}/vacating`)).data; } catch (e) { /* role without access */ }
  if (v) pane.insertAdjacentHTML('afterbegin', `<div class="card"><b>Vacating</b><p>PAAA registered ${v.paaa} of ${v.total} · vacated ${v.vacated} · keys ${v.keys} · utilities off ${v.utilities}</p>${v.ready_for_demolition ? chip('Ready for demolition', 'good') : chip('Not ready for demolition', 'warn')}</div>`);
  if (!isRole('owner', 'pm')) return;
  pane.querySelectorAll('[data-terms]').forEach((b) => { if (!b.parentElement.querySelector(`[data-vac="${b.dataset.terms}"]`)) b.insertAdjacentHTML('afterend', `<button class="btn small" data-vac="${b.dataset.terms}">PAAA &amp; vacating</button>`); });
  pane.querySelectorAll('[data-vac]').forEach((b) => { b.onclick = async () => {
    const list = (await api(`/api/redev/societies/${RD.soc}/members?page=${RD.page}&q=${encodeURIComponent(RD.q)}&status=${RD.st}`)).data.members; const m = list.find((x) => String(x.id) === b.dataset.vac) || {};
    const f = await openForm({ title: `PAAA and vacating · ${m.member_name || ''}`, intro: 'Transit rent starts only from the month the flat is vacated.', fields: [
      { name: 'paaa_reg_no', label: 'PAAA registration number', value: m.paaa_reg_no || '' }, { name: 'paaa_reg_date', label: 'Registered on', type: 'date', value: m.paaa_reg_date || '' }, { name: 'file', label: 'Registered PAAA copy (optional)', type: 'file' },
      { name: 'vacated_on', label: 'Flat vacated on', type: 'date', value: m.vacated_on || '' }, { name: 'keys_received', type: 'checkbox', checkLabel: 'Keys handed to us', value: !!m.keys_received }, { name: 'utilities_disconnected', type: 'checkbox', checkLabel: 'Electricity, water and gas disconnected', value: !!m.utilities_disconnected }] });
    if (!f) return;
    const body = { paaa_reg_no: f.paaa_reg_no, paaa_reg_date: f.paaa_reg_date, vacated_on: f.vacated_on, keys_received: f.keys_received, utilities_disconnected: f.utilities_disconnected };
    if (f.file) { const id = await rdUpload(f.file, 'PAAA ' + (m.unit_label || '')); if (!id) return; body.paaa_doc_id = id; }
    if (await act(api(`/api/redev/members/${b.dataset.vac}/vacate`, { method: 'PUT', body }), 'Saved')) rdMembers(pane);
  }; });
};

// ======================= work orders: debit notes, material check, item links =======================
const DN_REASONS = [['rework', 'Rework'], ['wastage', 'Wastage'], ['damage', 'Damage'], ['penalty', 'Penalty / delay'], ['excess_material', 'Excess material'], ['other', 'Other']];
async function woDebitNotes(woId, w, prefill) {
  const d = (await api(`/api/contractors/work-orders/${woId}/debit-notes`)).data;
  const canC = ['owner', 'pm', 'purchase'].includes(currentUser.role), canA = ['owner', 'pm'].includes(currentUser.role);
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Debit notes · ${esc(w.wo_no)}</h2><p class="help">Approved debit notes are deducted from the next RA bill by themselves.</p>
    ${canC ? '<button class="btn btn-primary btn-full" id="dn-new">+ Debit note</button>' : ''}
    ${d.debit_notes.map((x) => `<div class="card"><div class="row"><div><b>${esc((DN_REASONS.find((r) => r[0] === x.reason) || [0, x.reason])[1])}: ${moneyP(x.amount_paise)}</b><p>${esc(x.description)}</p>
      <p class="muted">${x.qty != null ? `${esc(x.qty)} ${esc(x.unit || '')} @ ${moneyP(x.rate_paise)} · ` : ''}by ${esc(x.created_by_name || '')}${x.ra_no ? ' · deducted on RA ' + esc(x.ra_no) : ''}${x.decision_note ? ' · ' + esc(x.decision_note) : ''}</p></div>${chip(x.status, { pending: 'warn', approved: 'info', recovered: 'good', rejected: 'bad' }[x.status])}</div>
      ${x.status === 'pending' && canA && (x.created_by !== currentUser.id || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-dn="approve" data-id="${x.id}">Approve</button><button class="btn small" data-dn="reject" data-id="${x.id}">Reject</button>` : ''}
      ${x.photo_doc_id ? `<a class="btn small" href="/api/files/download/${x.photo_doc_id}">Photo</a>` : ''}</div>`).join('') || '<div class="empty-state"><p>No debit notes.</p></div>'}
    <div class="modal-actions"><button class="btn" id="dn-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  const again = () => { ov.remove(); woDebitNotes(woId, w); };
  ov.querySelector('#dn-x').onclick = () => { ov.remove(); woDetail(woId); };
  const add = async (pre = {}) => {
    const v = await openForm({ title: 'Debit note', fields: [
      { name: 'reason', label: 'For', type: 'select', options: DN_REASONS, value: pre.reason || 'rework' }, { name: 'description', label: 'What for?', required: true, value: pre.description || '' },
      { name: 'qty', label: 'Quantity (optional)', type: 'number', value: pre.qty ?? '' }, { name: 'unit', label: 'Unit', value: pre.unit || '' }, { name: 'rate', label: 'Rate (₹)', type: 'money' },
      { name: 'amount', label: 'Or the amount (₹)', type: 'money' }, { name: 'file', label: 'Photo (optional)', type: 'file' }] });
    if (!v) return;
    const body = { reason: v.reason, description: v.description, qty: v.qty, unit: v.unit, rate_paise: v.rate || '', amount_paise: v.amount || undefined };
    if (v.file) { const id = await qaUpload(v.file, w.project_id, 'Debit note photo'); if (!id) return; body.photo_doc_id = id; }
    const r = await act(api(`/api/contractors/work-orders/${woId}/debit-notes`, { method: 'POST', body })); if (r) { toast(`Debit note of ${moneyP(r.data.amount_paise)} sent for approval`); again(); }
  };
  if (ov.querySelector('#dn-new')) ov.querySelector('#dn-new').onclick = () => add();
  ov.querySelectorAll('[data-dn]').forEach((b) => { b.onclick = async () => { let body = {}; if (b.dataset.dn === 'reject') { const v = await openForm({ title: 'Reject', fields: [{ name: 'note', label: 'Why?', required: true }] }); if (!v) return; body = v; } if (await act(api(`/api/contractors/debit-notes/${b.dataset.id}/${b.dataset.dn}`, { method: 'POST', body }), 'Done')) again(); }; });
  if (prefill) add(prefill);
}
async function woReconciliation(woId, w) {
  const d = (await api(`/api/contractors/work-orders/${woId}/reconciliation`)).data;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Material check · ${esc(w.wo_no)}</h2><p class="help">${esc(d.note)}</p>
    ${d.rows.map((r) => `<div class="card${r.excess > 0 ? ' task-row late' : ''}"><b>${esc(r.name || 'Store item ' + r.stock_item_id)}</b>
      <p>Issued <b>${esc(r.issued)}</b> ${esc(r.unit || '')} · should have used ${esc(r.theoretical)} · allowed with wastage ${esc(r.allowed)}</p>
      ${r.from.length ? `<p class="muted">${r.from.map(esc).join('<br>')}</p>` : '<p class="muted">No item of this work order is linked to it yet (Item links).</p>'}
      ${r.excess > 0 ? `${chip(`Excess ${r.excess} ${r.unit || ''}`, 'bad')} ${['owner', 'pm', 'purchase'].includes(currentUser.role) ? `<button class="btn small btn-primary" data-dnx="${r.stock_item_id}">Charge it (debit note)</button>` : ''}` : chip('Within limits', 'good')}</div>`).join('')
      || '<div class="empty-state"><p>Nothing to check yet. Link work-order items to the store item they use (Item links), and issue material to this work order from the Store.</p></div>'}
    <div class="modal-actions"><button class="btn" id="rc-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#rc-x').onclick = () => { ov.remove(); woDetail(woId); };
  ov.querySelectorAll('[data-dnx]').forEach((b) => { b.onclick = () => { const r = d.rows.find((x) => String(x.stock_item_id) === b.dataset.dnx); ov.remove(); woDebitNotes(woId, w, { reason: 'excess_material', description: `Excess ${r.name || 'material'} beyond allowed wastage`, qty: r.excess, unit: r.unit }); }; });
}
async function woItemLinks(woId, w, d) {
  const items = d.items || [];
  if (!items.length) { toast('This work order has no item list (lump sum).'); return; }
  const [boq, drw, stock] = await Promise.all([api(`/api/budget/boq?project_id=${w.project_id}`).then((x) => x.data.items).catch(() => []), api('/api/drawings').then((x) => x.data.drawings.filter((g) => g.project_id === w.project_id)).catch(() => []), stockItemOptions()]);
  let pick = items.length === 1 ? items[0] : null;
  if (!pick) { const c = await openForm({ title: 'Which item?', fields: [{ name: 'i', label: 'Item', type: 'select', options: items.map((x) => [x.id, x.description]) }] }); if (!c) return; pick = items.find((x) => String(x.id) === String(c.i)); }
  if (!pick) return;
  const v = await openForm({ title: `Links · ${pick.description}`, intro: 'Used for the BOQ report, the drawing-revised alert and the material check.', fields: [
    { name: 'boq_item_id', label: 'BOQ item', type: 'select', value: pick.boq_item_id || '', options: [['', 'None'], ...boq.map((b) => [b.id, `${b.code ? b.code + ' · ' : ''}${b.description} (${b.unit || ''})`])] },
    { name: 'drawing_id', label: 'Built from drawing', type: 'select', value: pick.drawing_id || '', options: [['', 'None'], ...drw.map((g) => [g.id, `${g.code} · ${g.title}${g.current_ifc_rev ? ' (' + g.current_ifc_rev + ')' : ''}`])] },
    { name: 'stock_item_id', label: 'Free-issue material it uses', type: 'select', value: pick.stock_item_id || '', options: stock.length ? stock.map(([a, l]) => [a, a === '' ? 'None' : l]) : [['', 'None']] },
    { name: 'consumption_per_unit', label: `Material per ${pick.unit || 'unit'} of work`, type: 'number', value: pick.consumption_per_unit ?? '', help: 'e.g. 6.5 bags of cement per cum; 80 kg of steel per cum' },
    { name: 'wastage_pct', label: 'Allowed wastage (%)', type: 'number', value: pick.wastage_bp != null ? pick.wastage_bp / 100 : '' }] });
  if (!v) return;
  const body = { boq_item_id: v.boq_item_id, drawing_id: v.drawing_id, stock_item_id: v.stock_item_id, consumption_per_unit: v.consumption_per_unit, wastage_bp: v.wastage_pct === '' ? '' : Math.round(Number(v.wastage_pct) * 100) };
  if (await act(api(`/api/contractors/wo-items/${pick.id}/links`, { method: 'PUT', body }), 'Saved')) woDetail(woId);
}

// ======================= BOQ page =======================
async function renderBoq(main) {
  const projects = await projectOptions();
  if (!projects.length) { main.innerHTML = '<h1>BOQ</h1><div class="empty-state"><p>No projects yet.</p></div>'; return; }
  main.innerHTML = `<h1>BOQ</h1><p class="help">Bill of quantities under each budget head. Work orders and POs linked to an item show how much is committed, measured and billed against it.</p>
    <div class="field"><label>Project</label><select id="boq-p">${projects.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div><div id="boq-body">Loading...</div>`;
  const load = async () => {
    const pid = Number($('boq-p').value), el = $('boq-body');
    try {
      const [items, heads] = await Promise.all([api(`/api/budget/boq?project_id=${pid}`).then((x) => x.data.items), api(`/api/budget/heads?project_id=${pid}`).then((x) => (x.data.heads || []).filter((h) => !h.project_id || h.project_id === pid)).catch(() => [])]);
      const canC = isRole('owner', 'pm', 'accounts', 'purchase');
      const groups = {}; for (const b of items) (groups[b.head_code + ' · ' + b.head_name] = groups[b.head_code + ' · ' + b.head_name] || []).push(b);
      el.innerHTML = `${canC && heads.length ? '<div class="row-btns"><button class="btn btn-primary" id="boq-add">+ BOQ item</button><button class="btn" id="boq-paste">Paste a list</button></div>' : ''}${!heads.length ? '<div class="empty-state"><p>Add budget heads first (Budget).</p></div>' : ''}
        <p><a class="btn small" href="/api/budget/boq?project_id=${pid}&csv=1">Download (Excel)</a></p>
        ${Object.entries(groups).map(([g, list]) => `<h3>${esc(g)}</h3>${list.map((b) => `<div class="card${b.over_qty ? ' task-row late' : ''}"><div class="row"><div><b>${b.code ? esc(b.code) + ' · ' : ''}${esc(b.description)}</b>
          <p class="muted">BOQ ${esc(b.qty)} ${esc(b.unit || '')} @ ${moneyP(b.rate_paise)} = ${moneyP(b.amount_paise)}</p>
          <p>Committed ${esc(+b.committed_qty.toFixed(3))} · measured ${esc(+b.measured_qty.toFixed(3))} · billed ${esc(+b.billed_qty.toFixed(3))} ${esc(b.unit || '')}</p></div>${b.over_qty ? chip('Over BOQ', 'bad') : chip(b.pct_used + '%', b.pct_used > 90 ? 'warn' : '')}</div>
          ${typeof CH !== 'undefined' ? CH.meter(b.committed_qty, b.qty, {}) : ''}${canC ? `<button class="btn small" data-boqe="${b.id}">Change</button>` : ''}</div>`).join('')}`).join('') || (heads.length ? '<div class="empty-state"><p>No BOQ items yet.</p></div>' : '')}`;
      const headOpts = heads.map((h) => [h.id, `${h.code} · ${h.name}`]);
      if ($('boq-add')) $('boq-add').onclick = async () => {
        const v = await openForm({ title: 'BOQ item', fields: [{ name: 'head_id', label: 'Budget head', type: 'select', options: headOpts }, { name: 'code', label: 'Item code' }, { name: 'description', label: 'Item', required: true }, { name: 'unit', label: 'Unit' }, { name: 'qty', label: 'Quantity', type: 'number', required: true }, { name: 'rate', label: 'Rate (₹)', type: 'money', required: true }] });
        if (v && await act(api('/api/budget/boq', { method: 'POST', body: { project_id: pid, head_id: Number(v.head_id), code: v.code, description: v.description, unit: v.unit, qty: v.qty, rate_paise: v.rate } }), 'Added')) load();
      };
      if ($('boq-paste')) $('boq-paste').onclick = async () => {
        const v = await openForm({ title: 'Paste BOQ lines', intro: 'One per line: code, item, unit, quantity, rate (₹). Copy the columns from Excel and paste. Up to 200 lines.', fields: [{ name: 'head_id', label: 'Budget head', type: 'select', options: headOpts }, { name: 'csv', label: 'Lines', type: 'textarea', required: true, placeholder: 'C-01, RCC M25 in slabs, cum, 850, 7200' }] });
        if (!v) return;
        const lines = v.csv.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const c = l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim().replace(/^"|"$/g, '')); return { code: c[0], description: c[1], unit: c[2], qty: Number(String(c[3]).replace(/,/g, '')), rate_paise: rupeesToPaise(c[4]) }; });
        const r = await act(api('/api/budget/boq', { method: 'POST', body: { project_id: pid, head_id: Number(v.head_id), lines } })); if (r) { toast(`${r.data.added} BOQ items added`); load(); }
      };
      el.querySelectorAll('[data-boqe]').forEach((b) => { b.onclick = async () => {
        const it = items.find((x) => String(x.id) === b.dataset.boqe);
        const v = await openForm({ title: 'Change BOQ item', fields: [{ name: 'qty', label: 'Quantity', type: 'number', value: it.qty }, { name: 'rate', label: 'Rate (₹)', type: 'money', value: it.rate_paise / 100 }, { name: 'reason', label: 'Why?', required: true, placeholder: 'Revised drawing, client change...' }] });
        if (v && await act(api(`/api/budget/boq/${it.id}`, { method: 'PUT', body: { qty: v.qty, rate_paise: v.rate, reason: v.reason } }), 'Saved')) load();
      }; });
    } catch (e) { el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  $('boq-p').onchange = load; load();
}
PAGES.boq = (m) => renderBoq(m);
Object.assign(ROUTE_TITLES, { boq: 'BOQ' });
Object.assign(ICONS, { boq: 'M4 4h16v16H4zM4 9h16M4 14h16M10 4v16' });
const _sidebarItems27 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems27(role);
  if (['owner', 'pm', 'accounts', 'purchase', 'viewer'].includes(role) && !groups.some(([, items]) => items.some((i) => i.route === 'boq'))) {
    const g = groups.find((x) => x[0] === 'Money') || groups.find((x) => x[0] === null);
    if (g) { const at = g[1].findIndex((i) => i.route === 'budget'); g[1].splice(at >= 0 ? at + 1 : g[1].length, 0, { label: 'BOQ', route: 'boq', icon: 'boq' }); }
  }
  return groups;
};

// ======================= pour card: pick the drawing =======================
const _qaPours27 = qaPours;
qaPours = async function (el) {
  await _qaPours27(el);
  const btn = el.querySelector('#qa-new'); if (!btn) return;
  btn.onclick = async () => {
    const m = await qaMeta();
    const drw = await api('/api/drawings').then((x) => x.data.drawings.filter((g) => g.project_id === Number(QA.pid) && g.current_ifc_rev)).catch(() => []);
    const v = await openForm({ title: 'Pour card', intro: 'Tick what is checked. The PM checks the rest and approves before the pour.', fields: [
      { name: 'element', label: 'What is being poured', type: 'select', options: m.elements.map((x) => [x, x[0].toUpperCase() + x.slice(1)]) },
      { name: 'wing', label: 'Wing' }, { name: 'floor', label: 'Floor (0 = plinth)', type: 'number' }, { name: 'location', label: 'Grid / bay' },
      { name: 'grade', label: 'Concrete grade', value: 'M25', required: true }, { name: 'qty_cum', label: 'Quantity (cubic metres)', type: 'number', required: true },
      { name: 'planned_date', label: 'Planned pour date', type: 'date', value: today() },
      ...(drw.length ? [{ name: 'drawing_id', label: 'Drawing (issued for construction)', type: 'select', options: [['', 'Not listed'], ...drw.map((g) => [g.id, `${g.code} ${g.current_ifc_rev} · ${g.title}`])] }] : [{ name: 'drawing_ref', label: 'Drawing and revision (IFC)' }]),
      { name: 'rmc_supplier', label: 'RMC supplier' },
      { name: 'checks', label: 'Checks done', type: 'multi', options: m.checklist.map((c, i) => [i, c]) }, { name: 'file', label: 'Photo (optional)', type: 'file' }] });
    if (!v) return;
    const body = { project_id: QA.pid, element: v.element, wing: v.wing, floor: v.floor, location: v.location, grade: v.grade, qty_cum: v.qty_cum, planned_date: v.planned_date, drawing_id: v.drawing_id ? Number(v.drawing_id) : undefined, drawing_ref: v.drawing_ref, rmc_supplier: v.rmc_supplier,
      checklist: Object.fromEntries(m.checklist.map((c, i) => [c, (v.checks || []).includes(i)])), client_uuid: crypto.randomUUID() };
    if (v.file) { const id = await qaUpload(v.file, QA.pid, 'Pour card photo'); if (!id) return; body.photo_doc_id = id; }
    if (await postOrQueue('/api/qa/pours', body, 'Pour card sent to the PM')) qaLoad();
  };
};
