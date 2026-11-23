// pages24.js — controls: milestones (ready → certified → undo), variations and joint measurements on work orders, held vendor bills.

// ======================= milestones =======================
const MS_CHIP = { pending: ['Not reached', ''], ready: ['Waiting to certify', 'warn'], done: ['Certified', 'good'], on_hold: ['On hold', 'bad'] };
function msActions(m, canE) {
  const pm = ['owner', 'pm'].includes(currentUser.role);
  const chipH = chip(...(MS_CHIP[m.status] || [m.status, '']));
  if (m.status === 'done') return `<div style="text-align:right">${chipH}${pm ? `<br><button class="btn small" data-msundo="${m.id}">Undo</button>` : ''}</div>`;
  if (pm) return `<div style="text-align:right">${m.status === 'ready' ? chipH + '<br>' : ''}<button class="btn small btn-primary" data-mscert="${m.id}">Certify</button></div>`;
  if (canE && m.status !== 'ready') return `<button class="btn small btn-primary" data-msready="${m.id}">Reached today</button>`;
  return chipH;
}
async function msUpload(file, projectId, title) {
  const fd = new FormData(); fd.append('file', typeof compressFile === 'function' ? await compressFile(file) : file, file.name);
  fd.append('title', title); fd.append('category', 'certificate'); fd.append('module', 'site'); fd.append('project_id', String(projectId)); fd.append('audience', 'internal');
  const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); return up ? up.data.id : null;
}
function msBind(el, list) {
  const byId = Object.fromEntries(list.map((m) => [String(m.id), m]));
  el.querySelectorAll('[data-msready]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Stage reached', intro: 'The PM checks it and records the architect\'s certificate. Buyers are asked to pay only after that.', fields: [
      { name: 'actual_date', label: 'Date reached', type: 'date', value: today(), required: true }, { name: 'note', label: 'Note (optional)' }] });
    if (!v) return;
    const r = await postOrQueue(`/api/site/milestones/${b.dataset.msready}/ready`, v, 'Sent to the PM to certify');
    if (r) loadSite();
  }; });
  el.querySelectorAll('[data-mscert]').forEach((b) => { b.onclick = async () => {
    const m = byId[b.dataset.mscert];
    const v = await openForm({ title: `Certify: ${m.name}${m.wing ? ' · ' + m.wing : ''}`, intro: 'This releases the matching payment demands to buyers.', fields: [
      { name: 'actual_date', label: 'Date the stage was reached', type: 'date', value: m.ready_at || today(), required: true },
      { name: 'cert_ref', label: "Architect's certificate (number and date)", required: true },
      { name: 'file', label: 'Certificate (photo or PDF, optional)', type: 'file' }] });
    if (!v) return;
    const body = { actual_date: v.actual_date, cert_ref: v.cert_ref };
    if (v.file) { const id = await msUpload(v.file, m.project_id, `Stage certificate: ${m.name}`); if (!id) return; body.cert_doc_id = id; }
    const path = `/api/site/milestones/${m.id}/certify`;
    let r = null;
    try { r = await api(path, { method: 'POST', body }); }
    catch (e) {
      if (e.data && e.data.code === 'cc' && currentUser.role === 'owner' && /written reason/.test(e.message)) {
        const o = await openForm({ title: 'No CC for this work', intro: e.message, fields: [{ name: 'override_note', label: 'Why go ahead (for example: work done before the CRM was used)?', type: 'textarea', required: true }] });
        if (o) r = await act(api(path, { method: 'POST', body: { ...body, ...o } }));
      } else toast(e.message, 9000);
    }
    if (r) { toast(r.data.demands_ready ? `Certified. ${r.data.demands_ready} payment demand(s) are now ready for buyers.` : 'Certified', 6000); loadSite(); }
  }; });
  el.querySelectorAll('[data-msundo]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Undo certification', intro: 'Demands not yet sent go back to waiting. Demands already sent and unpaid are put on hold.', fields: [{ name: 'reason', label: 'Why?', type: 'textarea', required: true }] });
    if (!v) return;
    const r = await act(api(`/api/site/milestones/${b.dataset.msundo}/undo`, { method: 'POST', body: v }));
    if (r) { toast(`Undone. ${r.data.demands_back_to_waiting} demand(s) back to waiting, ${r.data.demands_on_hold} on hold.`, 7000); loadSite(); }
  }; });
}
newMilestone = async function () {
  const v = await openForm({ title: 'Add milestone', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'name', label: 'Milestone', required: true, placeholder: '5th slab' }, { name: 'wing', label: 'Wing', help: 'Needed when the project has more than one wing.' },
    { name: 'all_wings', type: 'checkbox', checkLabel: 'This stage is the same for all wings' },
    { name: 'floor', label: 'Floor it reaches (0 = plinth; leave empty if not floor work)', type: 'number', help: 'Checked against the CC "up to floor" in Approvals.' },
    { name: 'milestone_key', label: 'Payment stage key', placeholder: 'slab5', help: 'Payment-plan stages with the same key become due when this is certified.' },
    { name: 'planned_date', label: 'Expected date', type: 'date' }] });
  if (!v) return;
  v.project_id = Number(v.project_id); if (v.floor === '') delete v.floor;
  if (await act(api('/api/site/milestones', { method: 'POST', body: v }), 'Milestone added')) loadSite();
};

// ======================= work orders: joint measurements =======================
const ST_CHIP = { pending: ['To approve', 'warn'], approved: ['Approved', 'good'], rejected: ['Rejected', 'bad'] };
async function woMeasurements(woId, w) {
  const d = (await api(`/api/contractors/work-orders/${woId}/measurements`)).data;
  const pm = ['owner', 'pm'].includes(currentUser.role);
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Measurements · ${esc(w.wo_no)}</h2><p class="help">Measured on site with the contractor's person. Only approved quantities can be billed.</p>
    <button class="btn btn-primary btn-full" id="me-new">+ Record a measurement</button>
    ${d.measurements.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.item)}</b>: ${esc(m.qty)} ${esc(m.unit || '')}<p class="muted">${esc(m.location)} · with ${esc(m.contractor_rep || '')} · by ${esc(m.measured_by_name || '')} · ${esc(String(m.created_at).slice(0, 10))}</p>
      ${[m.nos, m.length_m, m.width_m, m.depth_m].some((x) => x != null) ? `<p class="muted">${[['nos', m.nos], ['L', m.length_m], ['W', m.width_m], ['D', m.depth_m]].filter(([, x]) => x != null).map(([k, x]) => `${k} ${x}`).join(' × ')}</p>` : ''}${m.decision_note ? `<p class="muted">${esc(m.decision_note)}</p>` : ''}</div>${chip(...ST_CHIP[m.status])}</div>
      ${m.photo_doc_id ? `<a class="btn small" href="/api/files/download/${m.photo_doc_id}">Photo</a>` : ''}${m.status === 'pending' && pm && (m.measured_by !== currentUser.id || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-me="approve" data-id="${m.id}">Approve</button><button class="btn small" data-me="reject" data-id="${m.id}">Reject</button>` : ''}</div>`).join('') || '<div class="empty-state"><p>No measurements yet.</p></div>'}
    <div class="modal-actions"><button class="btn" id="me-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  const again = () => { ov.remove(); woMeasurements(woId, w); };
  ov.querySelector('#me-x').onclick = () => { ov.remove(); woDetail(woId); };
  ov.querySelector('#me-new').onclick = async () => {
    const v = await openForm({ title: 'Joint measurement', intro: 'Give the quantity, or the sizes and it is worked out.', fields: [
      { name: 'wo_item_id', label: 'Item', type: 'select', options: d.items.map((i) => [i.id, `${i.description} (${i.unit || 'units'})`]) },
      { name: 'location', label: 'Where (wing / floor / grid)', required: true, placeholder: 'A wing, 5th slab, grid C3-C6' },
      { name: 'nos', label: 'Number of', type: 'number' }, { name: 'length_m', label: 'Length (m)', type: 'number' }, { name: 'width_m', label: 'Width (m)', type: 'number' }, { name: 'depth_m', label: 'Depth / height (m)', type: 'number' },
      { name: 'qty', label: 'Or the quantity directly', type: 'number' },
      { name: 'contractor_rep', label: "Contractor's person who measured with you", required: true }, { name: 'file', label: 'Photo (optional)', type: 'file' }, { name: 'note', label: 'Note' }] });
    if (!v) return;
    const body = { ...v, wo_item_id: Number(v.wo_item_id), client_uuid: crypto.randomUUID() }; delete body.file;
    if (v.file) { const id = await msUpload(v.file, w.project_id, `Measurement ${w.wo_no}`); if (!id) return; body.photo_doc_id = id; }
    const r = await act(api(`/api/contractors/work-orders/${woId}/measurements`, { method: 'POST', body }));
    if (r) { toast(`Recorded: ${r.data.qty}. Waiting for approval.`); again(); }
  };
  ov.querySelectorAll('[data-me]').forEach((b) => { b.onclick = async () => {
    let body = {};
    if (b.dataset.me === 'reject') { const v = await openForm({ title: 'Reject measurement', fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }] }); if (!v) return; body = v; }
    if (await act(api(`/api/contractors/measurements/${b.dataset.id}/${b.dataset.me}`, { method: 'POST', body }), 'Done')) again();
  }; });
}

// ======================= work orders: variations =======================
async function woVariations(woId, w, wd) {
  const d = (await api(`/api/contractors/work-orders/${woId}/variations`)).data;
  const canC = ['owner', 'pm', 'purchase'].includes(currentUser.role), canA = ['owner', 'pm'].includes(currentUser.role);
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Variations · ${esc(w.wo_no)}</h2><p class="help">Extra quantity or new items beyond the work order. Nothing beyond the order can be billed until a variation is approved. Above ${moneyP(d.owner_limit_paise)} the Owner approves.</p>
    ${canC ? '<button class="btn btn-primary btn-full" id="va-new">+ Raise a variation</button>' : ''}
    ${d.variations.map((v) => `<div class="card"><div class="row"><div><b>${esc(v.description)}</b>${v.item ? ` <span class="muted">(extra on ${esc(v.item)})</span>` : ''}<p>${v.qty ? `${esc(v.qty)} ${esc(v.unit || '')} @ ${moneyP(v.rate_paise)} = ` : ''}<b>${moneyP(v.amount_paise)}</b></p>
      <p class="muted">${esc(v.reason)}${v.drawing_ref ? ' · ' + esc(v.drawing_ref) : ''} · by ${esc(v.created_by_name || '')}${v.approved_by_name ? ' · decided by ' + esc(v.approved_by_name) : ''}${v.decision_note ? ': ' + esc(v.decision_note) : ''}</p></div>${chip(...ST_CHIP[v.status])}</div>
      ${v.status === 'pending' && canA && (v.created_by !== currentUser.id || currentUser.role === 'owner') && (v.amount_paise <= d.owner_limit_paise || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-va="approve" data-id="${v.id}">Approve</button><button class="btn small" data-va="reject" data-id="${v.id}">Reject</button>` : ''}</div>`).join('') || '<div class="empty-state"><p>No variations.</p></div>'}
    <div class="modal-actions"><button class="btn" id="va-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  const again = () => { ov.remove(); woVariations(woId, w, wd); };
  ov.querySelector('#va-x').onclick = () => { ov.remove(); woDetail(woId); };
  if (ov.querySelector('#va-new')) ov.querySelector('#va-new').onclick = async () => {
    const items = wd.items || [];
    const v = await openForm({ title: 'Raise a variation', fields: [
      ...(items.length ? [{ name: 'wo_item_id', label: 'What', type: 'select', options: [['', 'A new item'], ...items.map((i) => [i.id, `More of: ${i.description} (${i.unit || 'units'})`])] }] : []),
      { name: 'description', label: 'Description (for a new item)' }, { name: 'qty', label: 'Quantity', type: 'number' }, { name: 'unit', label: 'Unit (new item)' },
      { name: 'rate', label: 'Rate (₹, new item)', type: 'money' }, ...(items.length ? [] : [{ name: 'amount', label: 'Amount of the extra work (₹)', type: 'money' }]),
      { name: 'reason', label: 'Why is it needed?', type: 'textarea', required: true, placeholder: 'Site instruction, drawing revision, client change...' }, { name: 'drawing_ref', label: 'Drawing / instruction reference' }] });
    if (!v) return;
    const body = { wo_item_id: v.wo_item_id ? Number(v.wo_item_id) : undefined, description: v.description, qty: v.qty, unit: v.unit, rate_paise: v.rate || undefined, amount_paise: v.amount || undefined, reason: v.reason, drawing_ref: v.drawing_ref };
    const r = await act(api(`/api/contractors/work-orders/${woId}/variations`, { method: 'POST', body }));
    if (r) { toast(`Variation of ${moneyP(r.data.amount_paise)} sent for approval${r.data.needs_owner ? ' (to the Owner)' : ''}.`, 6000); again(); }
  };
  ov.querySelectorAll('[data-va]').forEach((b) => { b.onclick = async () => {
    let body = {};
    if (b.dataset.va === 'reject') { const v = await openForm({ title: 'Reject variation', fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }] }); if (!v) return; body = v; }
    if (await act(api(`/api/contractors/variations/${b.dataset.id}/${b.dataset.va}`, { method: 'POST', body }), 'Done')) again();
  }; });
}

// ======================= vendor bills on hold =======================
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-billrel]'); if (!b) return;
  e.preventDefault();
  const v = await openForm({ title: 'Release the bill', intro: 'It was held because it did not match the PO and what was received. Release it only if it is right.', fields: [{ name: 'note', label: 'Why is it right?', type: 'textarea', required: true }] });
  if (v && await act(api(`/api/procurement/bills/${b.dataset.billrel}/release`, { method: 'POST', body: v }), 'Released for payment')) loadProcurement();
});

// ======================= approvals: what kind it is and what must come first =======================
const _approvalDetail24 = approvalDetail;
approvalDetail = async function (id) {
  await _approvalDetail24(id);
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov) return;
  const modal = ov.querySelector('.modal'); const box = document.createElement('div'); modal.insertBefore(box, modal.querySelector('h3'));
  const paint = async () => {
    const d = (await api(`/api/approvals/${id}/steps`)).data, a = d.item;
    box.innerHTML = `<div class="card"><p><b>Type:</b> ${esc(a.gate ? d.gate_labels[a.gate] : 'Other')}${a.wing ? ' · wing ' + esc(a.wing) : ''}</p>
      <p><b>Must come first:</b> ${d.depends_on.length ? d.depends_on.map((x) => `${esc(x.name)} ${x.status === 'approved' ? chip('approved', 'good') : chip(x.status.replace('_', ' '), 'warn')}`).join(', ') : 'nothing'}</p>
      ${userCanClient('approvals', 'E') ? '<button class="btn small" id="ap-gate">Change type or order</button>' : ''}</div>`;
    const btn = box.querySelector('#ap-gate'); if (!btn) return;
    btn.onclick = async () => {
      const v = await openForm({ title: 'Type and order', intro: 'The type lets the system stop work, sales and possession until the right approval is in place.', fields: [
        { name: 'gate_key', label: 'This approval is', type: 'select', value: a.gate_key || a.gate || '', options: [['', 'Other'], ...Object.entries(d.gate_labels)] },
        { name: 'wing', label: 'Only for wing (leave empty for the whole project)', value: a.wing || '' },
        { name: 'depends_on', label: 'Approvals that must be approved first', type: 'multi', value: d.depends_on.map((x) => x.id), options: d.others.map((o) => [o.id, o.name]) }] });
      if (v && await act(api(`/api/approvals/${id}/gate`, { method: 'PUT', body: v }), 'Saved')) paint();
    };
  };
  paint().catch(() => {});
};
