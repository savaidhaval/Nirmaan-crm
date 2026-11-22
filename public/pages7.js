// pages7.js — WP-5 Contractors: contractors, work orders, RA bills, advance and retention ledger.

const CON_MONEY_ROLES = ['owner', 'accounts'];

async function renderContractors(main) {
  main.innerHTML = '<h1>Contractors</h1><div id="con-body">Loading...</div>';
  let on = false;
  try { on = (await api('/api/contractors/status')).data.enabled; } catch (e) { $('con-body').innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (!on) {
    $('con-body').innerHTML = `<div class="card"><p>The Contractors module is switched off.</p><p class="muted">${currentUser.role === 'owner' ? 'Turn it on in More → Settings → “Contractors module”.' : 'Ask the Owner to switch it on.'}</p></div>`;
    return;
  }
  const site = currentUser.role === 'site';
  const canC = !site && userCanClient('contractors', 'C');
  $('con-body').innerHTML = `${canC ? `<div class="grid"><button class="btn btn-primary btn-full" id="con-wo">📄 New work order</button><button class="btn btn-full" id="con-new">👷 New contractor</button><button class="btn btn-full" id="con-rep">⬇ Report (CSV)</button></div>` : ''}<div id="con-list">Loading...</div>`;
  if (canC) { $('con-wo').onclick = newWorkOrder; $('con-new').onclick = newContractor; $('con-rep').onclick = () => { window.location.href = '/api/contractors/reports/summary?csv=1'; }; }
  loadContractors();
}

async function newContractor() {
  const v = await openForm({ title: 'New contractor', fields: [{ name: 'name', label: 'Contractor / firm name', required: true }, { name: 'trade', label: 'Trade (civil, plumbing, tiling…)' }, { name: 'phone', label: 'Phone' }, { name: 'gstin', label: 'GSTIN (if any)' }, { name: 'pan', label: 'PAN (kept private)' }] });
  if (v && await act(api('/api/contractors/contractors', { method: 'POST', body: v }), 'Contractor added')) loadContractors();
}

async function loadContractors() {
  try {
    const site = currentUser.role === 'site';
    const [wos, cons] = await Promise.all([api('/api/contractors/work-orders'), api('/api/contractors/contractors')]);
    let html = '<h3>Work orders</h3>' + (wos.data.work_orders.map((w) => `<div class="card clickable" data-wo="${w.id}"><div class="row"><div><b>${esc(w.wo_no)}</b> · ${esc(w.contractor)}<p class="muted">${esc(w.project)}${site ? '' : ' · ' + moneyP(w.value_paise)}</p></div>${statusChip(w.status)}</div></div>`).join('') || '<p class="muted">No work orders yet.</p>');
    html += '<h3>Contractors</h3>' + (cons.data.contractors.map((c) => `<div class="card ${site ? '' : 'clickable'}" data-con="${c.id}"><div class="row"><div><b>${esc(c.name)}</b><p class="muted">${esc(c.trade || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.pan_masked ? ' · PAN ' + esc(c.pan_masked) : ''}</p></div>${c.active ? '' : chip('Inactive')}</div></div>`).join('') || '<p class="muted">No contractors yet. Add one to start.</p>');
    const el = $('con-list'); el.innerHTML = html;
    el.querySelectorAll('[data-wo]').forEach((b) => { b.onclick = () => woDetail(b.dataset.wo); });
    if (!site) el.querySelectorAll('[data-con]').forEach((b) => { b.onclick = () => contractorLedger(b.dataset.con); });
  } catch (e) { $('con-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// Rows of item / qty / unit / rate. Resolves to items or null.
function woItemsEditor(intro) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    const row = () => '<div class="field" data-row style="display:grid;grid-template-columns:1fr 70px 60px 90px;gap:6px"><input data-d placeholder="Work item" aria-label="Work item"><input data-q inputmode="decimal" placeholder="Qty" aria-label="Quantity"><input data-u placeholder="Unit" aria-label="Unit"><input data-r inputmode="decimal" placeholder="Rate ₹" aria-label="Rate"></div>';
    ov.innerHTML = `<div class="modal"><h2>Work items</h2><p class="help">${esc(intro)}</p><div id="wi-rows">${row()}${row()}${row()}</div><button class="btn btn-full" id="wi-more" type="button">+ Add another item</button><div class="error" id="wi-err" style="display:none"></div>
      <div class="modal-actions"><button class="btn" id="wi-cancel" type="button">Cancel</button><button class="btn btn-primary" id="wi-ok" type="button">Done</button></div></div>`;
    document.body.appendChild(ov);
    const close = (v) => { ov.remove(); resolve(v); };
    $('wi-cancel').onclick = () => close(null);
    $('wi-more').onclick = () => $('wi-rows').insertAdjacentHTML('beforeend', row());
    $('wi-ok').onclick = () => {
      const items = [...ov.querySelectorAll('[data-row]')].map((r) => ({ description: r.querySelector('[data-d]').value.trim(), qty: Number(r.querySelector('[data-q]').value), unit: r.querySelector('[data-u]').value.trim(), rate_paise: rupeesToPaise(r.querySelector('[data-r]').value) }))
        .filter((i) => i.description || i.qty || i.rate_paise);
      if (!items.length || items.some((i) => !i.description || !(i.qty > 0) || !(i.rate_paise > 0))) { const e = $('wi-err'); e.textContent = 'Each item needs a name, quantity and rate.'; e.style.display = 'block'; return; }
      close(items);
    };
  });
}

async function newWorkOrder() {
  const cons = (await api('/api/contractors/contractors')).data.contractors.filter((c) => c.active);
  if (!cons.length) { toast('Add a contractor first'); return; }
  const v = await openForm({ title: 'New work order', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'contractor_id', label: 'Contractor', type: 'select', options: cons.map((c) => [c.id, c.name + (c.trade ? ' · ' + c.trade : '')]) },
    { name: 'scope', label: 'Scope of work', type: 'textarea', required: true },
    { name: 'basis', label: 'Paid on', type: 'select', options: [['lump_sum', 'Lump sum'], ['item_rate', 'Item rates'], ['measured', 'Measured quantities']] },
    { name: 'value_paise', label: 'Lump-sum value (₹) — leave blank if you list items next', type: 'money' },
    { name: 'retention', label: 'Retention held back (%)', type: 'number', value: 5, help: 'Usually 5%. Set per work order.' },
    { name: 'advance_paise', label: 'Advance agreed (₹)', type: 'money' }] });
  if (!v) return;
  let items = [];
  if (v.basis !== 'lump_sum' || !v.value_paise) { items = await woItemsEditor('List each item with quantity and rate. The value is added up for you.'); if (!items) return; }
  const body = { project_id: Number(v.project_id), contractor_id: Number(v.contractor_id), scope: v.scope, basis: v.basis, value_paise: v.value_paise || 0, retention_bp: Math.round((Number(v.retention) || 0) * 100), advance_paise: v.advance_paise || 0, items };
  const r = await act(api('/api/contractors/work-orders', { method: 'POST', body }), 'Work order drafted');
  if (r) { loadContractors(); woDetail(r.data.id); }
}

async function woDetail(id) {
  const d = (await api(`/api/contractors/work-orders/${id}`)).data;
  const w = d.work_order, site = currentUser.role === 'site', money = CON_MONEY_ROLES.includes(currentUser.role);
  const canA = userCanClient('contractors', 'A'), canC = !site && userCanClient('contractors', 'C');
  const b = d.balances || {};
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const raHtml = (d.ra_bills || []).map((r) => `<div class="card"><div class="row"><div><b>RA ${r.ra_no}</b> ${statusChip(r.status)}<p class="muted">Gross ${moneyP(r.gross_paise)} − retention ${moneyP(r.retention_paise)}${r.advance_recovery_paise ? ' − advance ' + moneyP(r.advance_recovery_paise) : ''}${r.other_deductions_paise ? ' − other ' + moneyP(r.other_deductions_paise) : ''}${r.gst_paise ? ' + GST ' + moneyP(r.gst_paise) : ''}${r.tds_paise ? ' − TDS ' + moneyP(r.tds_paise) : ''}</p>
      <p><b>Net ${moneyP(r.net_paise)}</b>${r.paid_paise ? ` · paid ${moneyP(r.paid_paise)} · due ${moneyP(r.net_paise - r.paid_paise)}` : ''}</p></div></div>
    <div class="row-btns"><button class="btn small" data-ra-print="${r.id}">Print</button>${r.status === 'draft' && canA ? `<button class="btn small btn-primary" data-ra="check" data-id="${r.id}">Check</button>` : ''}${r.status === 'checked' && canA ? `<button class="btn small btn-primary" data-ra="approve" data-id="${r.id}">Approve</button>` : ''}${['draft', 'checked'].includes(r.status) && canA ? `<button class="btn small" data-ra="cancel" data-id="${r.id}">Cancel</button>` : ''}${['approved', 'part_paid'].includes(r.status) && money ? `<button class="btn small btn-primary" data-ra-pay="${r.id}" data-due="${r.net_paise - r.paid_paise}">Record payment</button>` : ''}</div></div>`).join('');
  ov.innerHTML = `<div class="modal"><h2>${esc(w.wo_no)}</h2><p>${esc(w.contractor)}${w.trade ? ' · ' + esc(w.trade) : ''} ${statusChip(w.status)}</p><p class="muted">${esc(w.scope || '')}</p>
    ${site ? '' : `<p><b>Value ${moneyP(w.value_paise)}</b> · retention ${(w.retention_bp / 100).toFixed(1)}% · advance agreed ${moneyP(w.advance_paise)}</p>
    <p class="muted">Advance paid ${moneyP(b.advance_paid || 0)}, recovered ${moneyP(b.advance_recovered || 0)} → <b>outstanding ${moneyP(b.advance_outstanding || 0)}</b><br>Retention held: <b>${moneyP(b.retention_held || 0)}</b></p>`}
    ${(d.items || []).length ? '<h3>Items</h3>' + d.items.map((i) => `<p>${esc(i.description)} — ${esc(i.qty)} ${esc(i.unit || '')} @ ${moneyP(i.rate_paise)} <span class="muted">(billed ${esc(i.billed_qty)})</span></p>`).join('') : ''}
    ${site ? '' : '<h3>RA bills</h3>' + (raHtml || '<p class="muted">No RA bills yet.</p>')}
    <div class="row-btns">${!site && ['draft', 'rejected'].includes(w.status) && canC ? '<button class="btn" id="wo-submit">Send for approval</button>' : ''}${w.status === 'pending_approval' && canA ? '<button class="btn btn-primary" id="wo-approve">Approve</button><button class="btn" id="wo-reject">Reject</button>' : ''}
    ${w.status === 'approved' && canC ? '<button class="btn btn-primary" id="wo-ra">+ New RA bill</button>' : ''}${w.status === 'approved' && money ? '<button class="btn" id="wo-adv">Pay advance</button><button class="btn" id="wo-ret">Release retention</button>' : ''}${w.status === 'approved' && canA ? '<button class="btn" id="wo-close">Close work order</button>' : ''}${!site ? '<button class="btn" id="wo-print">Print</button>' : ''}</div>
    <div class="modal-actions"><button class="btn btn-primary" id="wo-x">Close</button></div></div>`;
  document.body.appendChild(ov);
  const again = () => { ov.remove(); loadContractors(); woDetail(id); };
  $('wo-x').onclick = () => { ov.remove(); loadContractors(); };
  const post = async (path, body, msg) => { if (await act(api(path, { method: 'POST', body: body || {} }), msg)) again(); };
  const on = (i, fn) => { if ($(i)) $(i).onclick = fn; };
  on('wo-print', () => window.open(`/print.html?k=wo&id=${id}`, '_blank', 'noopener'));
  on('wo-submit', () => post(`/api/contractors/work-orders/${id}/submit`, {}, 'Sent for approval'));
  on('wo-approve', () => post(`/api/contractors/work-orders/${id}/approve`, {}, 'Approved'));
  on('wo-reject', async () => { const v = await openForm({ title: 'Reject work order', fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }] }); if (v) post(`/api/contractors/work-orders/${id}/reject`, v, 'Rejected'); });
  on('wo-close', () => { if (confirm('Close this work order? No more bills can be raised.')) post(`/api/contractors/work-orders/${id}/close`, {}, 'Closed'); });
  on('wo-ra', () => { ov.remove(); newRaBill(id, d); });
  const payForm = async (title, path, dflt) => {
    const v = await openForm({ title, fields: [{ name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true, value: dflt ? (dflt / 100).toFixed(2) : '' }, { name: 'paid_on', label: 'Paid on', type: 'date', value: today() },
      { name: 'mode', label: 'How', type: 'select', options: [['neft', 'NEFT / RTGS'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash']] }, { name: 'ref_no', label: 'Reference / cheque no.' }] });
    if (v) post(path, v, 'Recorded');
  };
  on('wo-adv', () => payForm('Pay advance', `/api/contractors/work-orders/${id}/advance`, Math.max(0, w.advance_paise - (b.advance_paid || 0))));
  on('wo-ret', () => payForm('Release retention', `/api/contractors/work-orders/${id}/release-retention`, b.retention_held || 0));
  ov.querySelectorAll('[data-ra-print]').forEach((x) => { x.onclick = () => window.open(`/print.html?k=ra&id=${x.dataset.raPrint}`, '_blank', 'noopener'); });
  ov.querySelectorAll('[data-ra]').forEach((x) => { x.onclick = async () => {
    let body = {};
    if (x.dataset.ra === 'cancel') { const v = await openForm({ title: 'Cancel RA bill', fields: [{ name: 'reason', label: 'Why?', type: 'textarea', required: true }] }); if (!v) return; body = v; }
    post(`/api/contractors/ra-bills/${x.dataset.id}/${x.dataset.ra}`, body, 'Done');
  }; });
  ov.querySelectorAll('[data-ra-pay]').forEach((x) => { x.onclick = () => payForm('Record payment', `/api/contractors/ra-bills/${x.dataset.raPay}/payments`, Number(x.dataset.due)); });
}

async function newRaBill(woId, d) {
  const items = d.items || [], w = d.work_order;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>New RA bill · ${esc(w.wo_no)}</h2><p class="help">Enter the work done up to this bill. Retention is held back automatically (${(w.retention_bp / 100).toFixed(1)}%).</p>
    <div class="field"><label>From</label><input id="ra-from" type="date"></div><div class="field"><label>To</label><input id="ra-to" type="date" value="${today()}"></div>
    ${items.length ? items.map((i) => `<div class="field"><label>${esc(i.description)} — quantity done this bill (${esc(i.unit || 'units')}); ordered ${esc(i.qty)}, billed so far ${esc(i.billed_qty)}</label><input data-line="${i.id}" inputmode="decimal"></div>`).join('')
      : '<div class="field"><label>Value of work done this bill (₹)</label><input id="ra-gross" inputmode="decimal"></div>'}
    <div class="field"><label>Advance to recover (₹) — outstanding ${moneyP((d.balances || {}).advance_outstanding || 0)}</label><input id="ra-rec" inputmode="decimal"></div>
    <div class="field"><label>Other deductions (₹)</label><input id="ra-oth" inputmode="decimal"></div><div class="field"><label>Payment due on</label><input id="ra-due" type="date"></div>
    <div class="error" id="ra-err" style="display:none"></div><div class="modal-actions"><button class="btn" id="ra-cancel" type="button">Cancel</button><button class="btn btn-primary" id="ra-ok" type="button">Save RA bill</button></div></div>`;
  document.body.appendChild(ov);
  $('ra-cancel').onclick = () => { ov.remove(); woDetail(w.id); };
  $('ra-ok').onclick = async () => {
    const body = { period_from: $('ra-from').value || null, period_to: $('ra-to').value || null, due_date: $('ra-due').value || null, advance_recovery_paise: rupeesToPaise($('ra-rec').value) || 0, other_deductions_paise: rupeesToPaise($('ra-oth').value) || 0 };
    if (items.length) body.lines = [...ov.querySelectorAll('[data-line]')].filter((x) => Number(x.value) > 0).map((x) => ({ wo_item_id: Number(x.dataset.line), qty: Number(x.value) }));
    else body.gross_paise = rupeesToPaise($('ra-gross').value) || 0;
    const send = async () => {
      try { return await api(`/api/contractors/work-orders/${w.id}/ra-bills`, { method: 'POST', body }); }
      catch (e) {
        if (e.data && e.data.code === 'over_limit' && confirm(`${e.data.warnings.join('\n')}\n\nSave anyway?`)) { body.confirm_over = true; return send(); }
        const er = $('ra-err'); er.textContent = e.message; er.style.display = 'block'; return null;
      }
    };
    const r = await send();
    if (r) { toast(`RA ${r.data.ra_no} saved: net ${moneyP(r.data.net_paise)}`, 5000); ov.remove(); loadContractors(); woDetail(w.id); }
  };
}

async function contractorLedger(id) {
  const d = (await api(`/api/contractors/contractors/${id}/ledger`)).data, t = d.totals || {};
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const LABEL = { advance: 'Advance paid', advance_recovery: 'Advance recovered', retention_held: 'Retention held', retention_released: 'Retention released', payment: 'Paid on bill' };
  ov.innerHTML = `<div class="modal"><h2>Contractor ledger</h2>
    <p><b>Payable now: ${moneyP(t.payable || 0)}</b><br><span class="muted">Billed (approved) ${moneyP(t.billed_net || 0)} − paid ${moneyP(t.paid_on_bills || 0)}</span></p>
    <p>Advance outstanding: <b>${moneyP(t.advance_outstanding || 0)}</b><br>Retention held: <b>${moneyP(t.retention_held || 0)}</b></p>
    ${d.entries.map((e) => `<p class="muted">${esc(String(e.created_at).substring(0, 10))} · ${esc(e.wo_no)} · ${esc(LABEL[e.kind] || e.kind)} · ${e.amount_paise < 0 ? '−' : ''}${moneyP(Math.abs(e.amount_paise))}</p>`).join('') || '<p class="muted">No entries yet.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="cl-x">Close</button></div></div>`;
  document.body.appendChild(ov); $('cl-x').onclick = () => ov.remove();
}
