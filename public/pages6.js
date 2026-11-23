// pages6.js — WP-4 procurement addendum screens: indents, items on RFQs, per-line quotes, material received by line, part payments, vendor statement.

// A small editor for "item, quantity, unit" rows. Resolves to [{description, qty, unit}] or null.
function itemsEditor({ title, intro, extra = [], first = 3, submit = 'Save' }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    const row = (i) => `<div class="field" data-row style="display:grid;grid-template-columns:1fr 80px 70px;gap:6px">
      <input data-d placeholder="Item (e.g. cement bags)" aria-label="Item ${i}"><input data-q type="text" inputmode="decimal" placeholder="Qty" aria-label="Quantity ${i}"><input data-u placeholder="Unit" aria-label="Unit ${i}"></div>`;
    const ex = extra.map((f) => `<div class="field"><label for="ie_${f.name}">${esc(f.label)}</label>${f.type === 'select'
      ? `<select id="ie_${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`
      : `<input id="ie_${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}">`}</div>`).join('');
    ov.innerHTML = `<div class="modal"><h2>${esc(title)}</h2>${intro ? `<p class="help">${esc(intro)}</p>` : ''}${ex}<div id="ie-rows">${Array.from({ length: first }, (_, i) => row(i + 1)).join('')}</div>
      <button class="btn btn-full" id="ie-more" type="button">+ Add another item</button><div class="error" id="ie-err" style="display:none"></div>
      <div class="modal-actions"><button class="btn" id="ie-cancel" type="button">Cancel</button><button class="btn btn-primary" id="ie-ok" type="button">${esc(submit)}</button></div></div>`;
    document.body.appendChild(ov);
    const close = (v) => { ov.remove(); resolve(v); };
    $('ie-cancel').onclick = () => close(null);
    $('ie-more').onclick = () => { $('ie-rows').insertAdjacentHTML('beforeend', row($('ie-rows').children.length + 1)); };
    $('ie-ok').onclick = () => {
      const items = [...ov.querySelectorAll('[data-row]')].map((r) => ({ description: r.querySelector('[data-d]').value.trim(), qty: Number(r.querySelector('[data-q]').value), unit: r.querySelector('[data-u]').value.trim() }))
        .filter((i) => i.description || i.qty);
      const bad = items.find((i) => !i.description || !(i.qty > 0));
      if (!items.length || bad) { const e = $('ie-err'); e.textContent = 'Each item needs a name and a quantity.'; e.style.display = 'block'; return; }
      const out = { items }; extra.forEach((f) => { out[f.name] = $('ie_' + f.name).value; });
      close(out);
    };
    ov.querySelector('[data-d]').focus();
  });
}

// ---------- Indents ----------
async function newIndent() {
  const projects = await projectOptions();
  const v = await itemsEditor({ title: 'Ask for material', intro: 'List what the site needs. The project manager approves, then Purchase gets quotes.', submit: 'Send request',
    extra: [{ name: 'project_id', label: 'Project', type: 'select', options: projects }, { name: 'needed_by', label: 'Needed by', type: 'date' }, { name: 'wing', label: 'Wing (if it is for one floor)' }, { name: 'floor', label: 'Highest floor this is for (0 = plinth; leave empty if not floor work)', type: 'number' }, { name: 'note', label: 'Note (optional)' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await postOrQueue('/api/procurement/indents', v, 'Request sent')) loadProcurement();
}

function indentsHtml(list) {
  const open = (list || []).filter((i) => ['submitted', 'approved'].includes(i.status));
  const canA = userCanClient('procurement', 'A'), canConvert = currentUser.role !== 'site' && userCanClient('procurement', 'C');
  if (!open.length) return '';
  return '<h3>Material requests (indents)</h3>' + open.map((i) => `<div class="card"><div class="row"><div><b>${esc(i.indent_no)}</b><p class="muted">${i.item_count} item${i.item_count === 1 ? '' : 's'}${i.requested_by_name ? ' · ' + esc(i.requested_by_name) : ''}${i.needed_by ? ' · needed ' + esc(i.needed_by) : ''}</p></div>${statusChip(i.status)}</div>
    <div class="row-btns"><button class="btn small" data-ind-view="${i.id}">View</button>${i.status === 'submitted' && canA ? `<button class="btn small btn-primary" data-ind="approve" data-id="${i.id}">Approve</button><button class="btn small" data-ind="reject" data-id="${i.id}">Reject</button>` : ''}${i.status === 'approved' && canConvert ? `<button class="btn small btn-primary" data-ind="convert" data-id="${i.id}">Make RFQ</button>` : ''}</div></div>`).join('');
}

function wireIndents(el) {
  el.querySelectorAll('[data-ind-view]').forEach((b) => { b.onclick = async () => {
    const d = (await api(`/api/procurement/indents/${b.dataset.indView}`)).data;
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal"><h2>${esc(d.indent.indent_no)}</h2>${d.indent.note ? `<p>${esc(d.indent.note)}</p>` : ''}${d.items.map((i) => `<p>${esc(i.description)} — <b>${esc(i.qty)} ${esc(i.unit || '')}</b></p>`).join('')}<div class="modal-actions"><button class="btn btn-primary" id="iv-close">Close</button></div></div>`;
    document.body.appendChild(ov); $('iv-close').onclick = () => ov.remove();
  }; });
  el.querySelectorAll('[data-ind]').forEach((b) => { b.onclick = async () => {
    const act1 = b.dataset.ind; let body = {};
    if (act1 === 'reject') { const v = await openForm({ title: 'Reject request', fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }] }); if (!v) return; body = v; }
    const r = await act(api(`/api/procurement/indents/${b.dataset.id}/${act1}`, { method: 'POST', body }), act1 === 'convert' ? 'RFQ created' : 'Done');
    if (r) loadProcurement();
  }; });
}

// ---------- Material received, by PO line ----------
async function receiveMaterial(poId) {
  let d = null;
  try { d = (await api(`/api/procurement/pos/${poId}/lines`)).data; } catch (e) { /* offline: fall back to the note form below */ }
  if (!d || !d.items.length) {
    const v = await openForm({ title: 'Material received', fields: [
      { name: 'received_on', label: 'Date', type: 'date', value: today() }, { name: 'challan_no', label: 'Challan / delivery note no.' },
      { name: 'qty_note', label: 'What came? (quantity, condition)', type: 'textarea', required: true }, { name: 'full', type: 'checkbox', label: 'Complete', checkLabel: 'This completes the order (nothing more is due)' }] });
    if (v && await postOrQueue(`/api/procurement/pos/${poId}/grn`, v, 'Receipt recorded')) loadProcurement();
    return;
  }
  // Lines not yet tied to a store item get a picker, so what arrives is counted in the store.
  const stockOpts = d.items.some((i) => !i.stock_item_id) && typeof stockItemOptions === 'function' ? await stockItemOptions() : [];
  const v = await openForm({ title: `Material received · ${d.po.po_no}`, intro: 'Type how much arrived today for each item. Leave blank if nothing came.', fields: [
    { name: 'received_on', label: 'Date', type: 'date', value: today() }, { name: 'challan_no', label: 'Challan / delivery note no.' },
    ...d.items.flatMap((i) => [{ name: 'q' + i.id, label: `${i.description} (${i.unit || 'units'})`, type: 'number', placeholder: `${Math.max(0, i.ordered - i.received)} still due of ${i.ordered}` },
      ...(!i.stock_item_id && stockOpts.length ? [{ name: 's' + i.id, label: `Add "${i.description}" to the store as`, type: 'select', options: stockOpts, help: 'Pick the store item so the store count goes up.' }] : [])]),
    { name: 'qty_note', label: 'Condition / remarks' }] });
  if (!v) return;
  const lines = d.items.filter((i) => Number(v['q' + i.id]) > 0).map((i) => ({ po_item_id: i.id, qty_received: Number(v['q' + i.id]), stock_item_id: Number(v['s' + i.id]) || undefined }));
  if (!lines.length) { toast('Enter a quantity for at least one item'); return; }
  // More than ordered (beyond the small tolerance) needs the PM or the Owner, with a reason.
  const over = d.items.find((i) => Number(v['q' + i.id]) > (i.ordered - i.received) * 1.03 + 1e-9);
  let excess_note;
  if (over) {
    if (!['owner', 'pm'].includes(currentUser.role)) { toast(`More than ordered for "${over.description}". Receive what was ordered, and ask the PM to accept the extra.`, 8000); return; }
    const x = await openForm({ title: 'More than ordered', intro: `"${over.description}": more than the PO quantity. Accept the extra?`, fields: [{ name: 'n', label: 'Why accept it?', type: 'textarea', required: true }] });
    if (!x) return; excess_note = x.n;
  }
  const r = await postOrQueue(`/api/procurement/pos/${poId}/grn-lines`, { received_on: v.received_on, challan_no: v.challan_no, qty_note: v.qty_note, lines, excess_note }, 'Receipt recorded');
  if (r) loadProcurement();
}

// ---------- Payments ----------
async function payBill(billId, balance) {
  const v = await openForm({ title: 'Record payment', intro: `Still due: ${moneyP(balance)}. You can pay in parts.`, fields: [
    { name: 'amount_paise', label: 'Amount paid (₹)', type: 'money', required: true, value: (balance / 100).toFixed(2) },
    { name: 'paid_on', label: 'Paid on', type: 'date', value: today() },
    { name: 'mode', label: 'How', type: 'select', options: [['neft', 'NEFT / RTGS'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['cash', 'Cash']] },
    { name: 'ref_no', label: 'Reference / cheque no.' }] });
  if (v && await act(api(`/api/procurement/bills/${billId}/payments`, { method: 'POST', body: v }), 'Payment recorded')) loadProcurement();
}

async function vendorLedger(id) {
  const d = (await api(`/api/procurement/vendors/${id}/statement`)).data;
  const canRev = ['owner', 'accounts'].includes(currentUser.role);
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Vendor ledger</h2><p><b>Balance payable: ${moneyP(d.payable_paise)}</b></p>
    ${d.bills.map((b) => `<div class="card"><div class="row"><div><b>${esc(b.bill_no || '—')}</b><p class="muted">Bill ${moneyP(b.amount_paise)}${b.tds_paise ? ' − TDS ' + moneyP(b.tds_paise) : ''} · paid ${moneyP(b.paid_paise)} · <b>due ${moneyP(b.balance_paise)}</b></p></div>${statusChip(b.status)}</div>
      ${d.payments.filter((p) => p.bill_id === b.id).map((p) => `<p class="muted">${esc(p.paid_on)} · ${moneyP(p.amount_paise)} ${esc(p.mode || '')} ${esc(p.ref_no || '')}${canRev ? ` <button class="btn small" data-rev="${p.id}">Reverse</button>` : ''}</p>`).join('')}</div>`).join('') || '<p class="muted">No bills yet.</p>'}
    <div class="modal-actions"><button class="btn" id="vl-docs">Documents</button><button class="btn btn-primary" id="vl-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('vl-close').onclick = () => ov.remove(); $('vl-docs').onclick = () => partyDocsModal('vendor', id);
  ov.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Reverse payment', fields: [{ name: 'reason', label: 'Why is it being reversed?', type: 'textarea', required: true }] });
    if (v && await act(api(`/api/procurement/payments/${b.dataset.rev}/reverse`, { method: 'POST', body: v }), 'Payment reversed')) { ov.remove(); vendorLedger(id); loadProcurement(); }
  }; });
}

// ---------- RFQ with items and per-line quotes ----------
async function rfqDetail(id) {
  const [lines, old] = await Promise.all([api(`/api/procurement/rfqs/${id}/lines`), api(`/api/procurement/rfqs/${id}/quotes`)]);
  const d = lines.data, last = old.data.last_paid;
  const canC = userCanClient('procurement', 'C') && currentUser.role !== 'site';
  const fastest = d.quotes.filter((q) => q.delivery_days != null).length ? Math.min(...d.quotes.filter((q) => q.delivery_days != null).map((q) => q.delivery_days)) : null;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(d.rfq.title)}</h2>
    ${d.items.length ? '<h3>Items</h3>' + d.items.map((i) => `<p>${esc(i.description)} — <b>${esc(i.qty)} ${esc(i.unit || '')}</b></p>`).join('') : '<p class="muted">No item list yet. Add items to compare quotes line by line.</p>'}
    <p class="muted">${d.quotes.length} quote${d.quotes.length === 1 ? '' : 's'} received${d.quotes.length < 3 ? ' — get at least 3 if you can' : ''}.${last ? ` Last paid: ${moneyP(last.rate_paise)}/${esc(last.unit || 'unit')} (${esc(last.po_no)}).` : ''}</p>
    ${d.quotes.map((q) => `<div class="card"><div class="row"><div><b>${esc(q.vendor)}</b> ${q.selected ? chip('Chosen', 'good') : ''}<p class="muted">${moneyP(q.amount_paise)}${q.delivery_days != null ? ' · ' + esc(q.delivery_days) + ' days' : ''}</p>
      ${q.rates.length ? q.rates.map((r) => { const it = d.items.find((x) => x.id === r.rfq_item_id); return it ? `<p class="muted">${esc(it.description)}: ${moneyP(r.rate_paise)}</p>` : ''; }).join('') : ''}</div>
      <div>${q.lowest ? chip('Lowest total', 'good') : ''} ${q.delivery_days != null && q.delivery_days === fastest ? chip('Fastest', 'info') : ''}</div></div>
      ${userCanClient('procurement', 'E') && !q.selected ? `<button class="btn small" data-sel="${q.id}">Choose this quote</button>` : ''}</div>`).join('')}
    <div class="modal-actions">${canC && !d.quotes.length ? '<button class="btn" id="rq-items">Edit items</button>' : ''}${canC ? '<button class="btn" id="rq-add">Add quote</button>' : ''}<button class="btn btn-primary" id="rq-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('rq-close').onclick = () => ov.remove();
  ov.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/procurement/quotes/${b.dataset.sel}/select`, { method: 'POST' }), 'Quote chosen')) { ov.remove(); rfqDetail(id); loadProcurement(); } }; });
  if ($('rq-items')) $('rq-items').onclick = async () => {
    const v = await itemsEditor({ title: 'RFQ items', first: Math.max(3, d.items.length) });
    if (v && await act(api(`/api/procurement/rfqs/${id}/items`, { method: 'POST', body: { items: v.items } }), 'Items saved')) { ov.remove(); rfqDetail(id); }
  };
  if ($('rq-add')) $('rq-add').onclick = async () => {
    const vendors = (await api('/api/procurement/vendors')).data.vendors;
    const vopt = { name: 'vendor_id', label: 'Vendor', type: 'select', options: vendors.map((x) => [x.id, x.name]) };
    if (d.items.length) {
      const v = await openForm({ title: 'Add quote', intro: 'Enter the rate per unit for each item. The total is worked out for you.', fields: [vopt,
        ...d.items.map((i) => ({ name: 'r' + i.id, label: `${i.description} — rate per ${i.unit || 'unit'} (₹)`, type: 'money', required: true })),
        { name: 'delivery_days', label: 'Delivery in (days)', type: 'number' }, { name: 'terms', label: 'Terms', type: 'textarea' }] });
      if (!v) return;
      const rates = {}; d.items.forEach((i) => { rates[i.id] = v['r' + i.id]; });
      if (await act(api(`/api/procurement/rfqs/${id}/line-quote`, { method: 'POST', body: { vendor_id: Number(v.vendor_id), rates, delivery_days: v.delivery_days === '' ? null : v.delivery_days, terms: v.terms } }), 'Quote added')) { ov.remove(); rfqDetail(id); }
      return;
    }
    const v = await openForm({ title: 'Add quote', fields: [vopt, { name: 'rate_paise', label: 'Rate per unit (₹)', type: 'money' }, { name: 'amount_paise', label: 'Total (₹)', type: 'money', required: true }, { name: 'delivery_days', label: 'Delivery in (days)', type: 'number' }, { name: 'terms', label: 'Terms', type: 'textarea' }] });
    if (v && await act(api(`/api/procurement/rfqs/${id}/quotes`, { method: 'POST', body: { ...v, vendor_id: Number(v.vendor_id) } }), 'Quote added')) { ov.remove(); rfqDetail(id); }
  };
}
