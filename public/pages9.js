// pages9.js — WP-8 Stores, WP-10 Petty cash, WP-9 Documents with expiry (vendors and contractors).

const isRole = (...r) => r.includes(currentUser.role);
const qtyText = (q) => String(Math.round(Number(q) * 1000) / 1000);

// ======================= WP-8 STORES =======================
// Store items for the PO form. [] when there are none or the role cannot see the store.
async function stockItemOptions() {
  try {
    const items = (await api('/api/stores/items')).data.items;
    return items.length ? [['', 'Not a stock item'], ...items.map((i) => [i.id, `${i.name}${i.unit ? ' (' + i.unit + ')' : ''}`])] : [];
  } catch (e) { return []; }
}

// Stock list per project, remembered on the phone so the "issue" form works with no signal.
async function stockList(pid) {
  const key = 'nirmaan.stock.' + pid;
  try {
    const d = (await api(`/api/stores/stock?project_id=${pid}`)).data.stock;
    try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { /* storage blocked */ }
    return d;
  } catch (e) {
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c; } catch (e2) { /* ignore */ }
    throw e;
  }
}

async function renderStores(main) {
  const projects = await projectOptions();
  if (!projects.length) { main.innerHTML = '<h1>Store</h1><div class="card"><p>No projects yet.</p></div>'; return; }
  const mgr = isRole('owner', 'pm', 'purchase');
  main.innerHTML = `<h1>Store</h1><div class="field"><label>Project</label><select id="stk-project">${projects.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
    <div class="grid"><button class="btn btn-primary btn-full" id="stk-issue">📤 Issue to work</button>
    <button class="btn btn-full" id="stk-receive">📥 Stock received</button><button class="btn btn-full" id="stk-adjust">⚖ Stock count differs</button>${mgr ? '<button class="btn btn-full" id="stk-item">➕ New item</button><button class="btn btn-full" id="stk-transfer">🚚 Send to another site</button>' : ''}</div><div id="stk-body">Loading...</div>`;
  const pid = () => Number($('stk-project').value);
  $('stk-project').onchange = () => loadStores(pid());
  $('stk-issue').onclick = () => storeIssue(pid());
  $('stk-adjust').onclick = () => storeAdjust(pid());
  $('stk-receive').onclick = () => storeReceive(pid());
  if (mgr) { $('stk-item').onclick = async () => { const v = await openForm({ title: 'New store item', fields: [{ name: 'name', label: 'Item (e.g. Cement)', required: true }, { name: 'unit', label: 'Unit (bags, kg, nos…)' }, { name: 'category', label: 'Category' }] }); if (v && await act(api('/api/stores/items', { method: 'POST', body: v }), 'Item added')) loadStores(pid()); };
    $('stk-transfer').onclick = () => storeTransfer(pid(), projects); }
  loadStores(pid());
}

async function loadStores(pid) {
  const body = $('stk-body'); if (!body) return;
  try {
    const [stock, moves] = await Promise.all([stockList(pid), api(`/api/stores/moves?project_id=${pid}`).catch(() => ({ data: { moves: [] } }))]);
    const mgr = isRole('owner', 'pm', 'purchase'), canA = isRole('owner', 'pm');
    const pending = moves.data.moves.filter((m) => m.status === 'pending');
    let html = pending.length && canA ? '<h3>Waiting for approval</h3>' + pending.map((m) => `<div class="card"><b>${esc(m.item)}</b> · ${m.kind === 'receipt' ? 'received' : 'count differs'}: ${m.qty > 0 ? '+' : ''}${qtyText(m.qty)} ${esc(m.unit || '')}<p class="muted">${esc(m.note || '')} · ${esc(m.by_name || '')}</p><div class="row-btns"><button class="btn small btn-primary" data-mv="approve" data-id="${m.id}">Approve</button><button class="btn small" data-mv="reject" data-id="${m.id}">Reject</button></div></div>`).join('') : '';
    html += '<h3>Stock on hand</h3>' + (stock.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.name)}</b><p class="muted">${esc(s.category || '')}${s.reorder_level ? ` · reorder at ${qtyText(s.reorder_level)}` : ''}</p></div><div style="text-align:right"><b style="font-size:1.3em">${qtyText(s.qty)}</b> ${esc(s.unit || '')}<br>${s.low ? chip('Low', 'bad') : ''}</div></div>${mgr ? `<button class="btn small" data-reorder="${s.item_id}" data-name="${esc(s.name)}" data-lvl="${s.reorder_level}">Set reorder level</button>` : ''}</div>`).join('')
      || '<div class="card"><p>No items yet.</p><p class="muted">Add items. Material received against a purchase order that is tied to an item goes into the store by itself.</p></div>');
    const KIND = { receipt: 'Received', issue: 'Issued', transfer_out: 'Sent out', transfer_in: 'Received from site', adjust: 'Count adjusted' };
    html += '<h3>Recent movements</h3>' + (moves.data.moves.filter((m) => m.status !== 'pending').slice(0, 25).map((m) => `<p class="muted">${esc(String(m.created_at).substring(0, 10))} · ${esc(KIND[m.kind] || m.kind)} · ${esc(m.item)} · <b>${m.kind === 'issue' || m.kind === 'transfer_out' ? '−' : m.kind === 'adjust' && m.qty > 0 ? '+' : m.kind === 'adjust' ? '' : '+'}${qtyText(m.qty)}</b> ${esc(m.unit || '')}${m.where_used ? ' · ' + esc(m.where_used) : ''}${m.status === 'rejected' ? ' · rejected' : ''}</p>`).join('') || '<p class="muted">Nothing yet.</p>');
    html += `<p><a class="btn small" href="/api/stores/stock?project_id=${pid}&csv=1">Stock CSV</a> <a class="btn small" href="/api/stores/moves?project_id=${pid}&csv=1">Movements CSV</a></p>`;
    body.innerHTML = html;
    body.querySelectorAll('[data-mv]').forEach((b) => { b.onclick = async () => {
      let bodyJ = {};
      if (b.dataset.mv === 'reject') { const v = await openForm({ title: 'Reject adjustment', fields: [{ name: 'note', label: 'Why?', type: 'textarea' }] }); if (!v) return; bodyJ = v; }
      if (await act(api(`/api/stores/moves/${b.dataset.id}/${b.dataset.mv}`, { method: 'POST', body: bodyJ }), 'Done')) loadStores(pid);
    }; });
    body.querySelectorAll('[data-reorder]').forEach((b) => { b.onclick = async () => {
      const v = await openForm({ title: `Reorder level: ${b.dataset.name}`, intro: 'You are told when the stock falls to this level.', fields: [{ name: 'reorder_level', label: 'Reorder when at or below', type: 'number', value: b.dataset.lvl }] });
      if (v && await act(api('/api/stores/reorder', { method: 'POST', body: { project_id: pid, item_id: Number(b.dataset.reorder), reorder_level: Number(v.reorder_level) || 0 } }), 'Saved')) loadStores(pid);
    }; });
  } catch (e) { body.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function storeIssue(pid) {
  let stock;
  try { stock = await stockList(pid); } catch (e) { toast(e.message); return; }
  const items = stock.filter((s) => s.qty > 0);
  if (!items.length) { toast('Nothing in the store to issue'); return; }
  let wos = []; try { wos = (await api(`/api/stores/work-orders?project_id=${pid}`)).data.work_orders; } catch (e) { /* offline: no work-order pick */ }
  const v = await openForm({ title: 'Issue to work', intro: 'Works without signal. It is sent when you are online again.', fields: [
    { name: 'item_id', label: 'Item', type: 'select', options: items.map((s) => [s.item_id, `${s.name} (${qtyText(s.qty)} ${s.unit || ''} in store)`]) },
    { name: 'qty', label: 'How much', type: 'number', required: true },
    ...(wos.length ? [{ name: 'wo_id', label: "Given to a contractor's work order? (free-issue material)", type: 'select', options: [['', 'No, used by us'], ...wos.map((w) => [w.id, `${w.wo_no} · ${w.contractor}`])], help: 'Counted in the material check for that contractor.' }] : []),
    { name: 'where_used', label: 'Where used (e.g. Slab 3, Wing B)' }] });
  if (!v) return;
  if (await postOrQueue('/api/stores/issue', { project_id: pid, item_id: Number(v.item_id), qty: v.qty, where_used: v.where_used, wo_id: v.wo_id ? Number(v.wo_id) : undefined }, 'Issued')) loadStores(pid);
}

// Stock that came in without a purchase order: opening stock, bought for cash, returned from work.
async function storeReceive(pid) {
  const stock = await stockList(pid).catch(() => []);
  if (!stock.length) { toast(isRole('owner', 'pm', 'purchase') ? 'Add the item first with "New item"' : 'Ask Purchase to add the item first'); return; }
  const mgr = isRole('owner', 'pm', 'purchase');
  const v = await openForm({ title: 'Stock received', intro: mgr ? 'For material that came without a purchase order. Material received against a PO is added by itself.' : 'For material that came without a purchase order. A manager approves it before the count changes.', fields: [
    { name: 'item_id', label: 'Item', type: 'select', options: stock.map((s) => [s.item_id, `${s.name} (${qtyText(s.qty)} ${s.unit || ''} in store now)`]) },
    { name: 'qty', label: 'How much came in', type: 'number', required: true },
    { name: 'note', label: 'Where from?', type: 'select', options: [['Opening stock', 'Opening stock (already at site)'], ['Bought for cash', 'Bought for cash'], ['Returned from work', 'Returned from work'], ['Other', 'Other']] },
    { name: 'detail', label: 'Details (bill no., supplier, etc.)' }] });
  if (!v) return;
  if (await postOrQueue('/api/stores/receive', { project_id: pid, item_id: Number(v.item_id), qty: v.qty, note: [v.note, v.detail].filter(Boolean).join(': ') }, mgr ? 'Added to store' : 'Sent for approval')) loadStores(pid);
}

async function storeAdjust(pid) {
  const stock = await stockList(pid).catch(() => []);
  if (!stock.length) { toast('No items yet'); return; }
  const v = await openForm({ title: 'Stock count differs', intro: 'Type the difference: a minus for stock that is missing, a plus for extra. A manager has to approve it.', fields: [
    { name: 'item_id', label: 'Item', type: 'select', options: stock.map((s) => [s.item_id, `${s.name} (${qtyText(s.qty)} in store)`]) },
    { name: 'qty', label: 'Difference (e.g. -5)', type: 'number', required: true }, { name: 'reason', label: 'Why?', type: 'textarea', required: true }] });
  if (v && await postOrQueue('/api/stores/adjust', { project_id: pid, item_id: Number(v.item_id), qty: v.qty, reason: v.reason }, 'Sent for approval')) loadStores(pid);
}

async function storeTransfer(pid, projects) {
  const stock = (await stockList(pid).catch(() => [])).filter((s) => s.qty > 0);
  const others = projects.filter(([v]) => Number(v) !== pid);
  if (!stock.length || !others.length) { toast('Nothing to send, or no other project'); return; }
  const v = await openForm({ title: 'Send to another site', fields: [
    { name: 'item_id', label: 'Item', type: 'select', options: stock.map((s) => [s.item_id, `${s.name} (${qtyText(s.qty)} ${s.unit || ''})`]) },
    { name: 'qty', label: 'How much', type: 'number', required: true }, { name: 'to_project_id', label: 'Send to', type: 'select', options: others }, { name: 'note', label: 'Note' }] });
  if (v && await act(api('/api/stores/transfer', { method: 'POST', body: { project_id: pid, to_project_id: Number(v.to_project_id), item_id: Number(v.item_id), qty: v.qty, note: v.note } }), 'Sent')) loadStores(pid);
}

// ======================= WP-10 PETTY CASH =======================
const PTY_TONE = { approved: 'good', submitted: 'warn', rejected: 'bad', cancelled: '' };
const PTY_WORD = { approved: 'Approved', submitted: 'Waiting for approval', rejected: 'Rejected', cancelled: 'Cancelled' };

async function renderPetty(main) {
  main.innerHTML = '<h1>Petty cash</h1><div id="pty-body">Loading...</div>';
  loadPetty();
}

async function loadPetty() {
  const body = $('pty-body'); if (!body) return;
  try {
    const mgr = isRole('owner', 'pm', 'accounts'), canA = isRole('owner', 'pm');
    const [funds, pending] = await Promise.all([api('/api/petty/funds'), canA ? api('/api/petty/pending') : { data: { entries: [] } }]);
    let html = mgr && isRole('owner', 'pm', 'accounts') ? '<button class="btn btn-full" id="pty-open">➕ Open a petty-cash fund</button>' : '';
    if (pending.data.entries.length) html += '<h3>Waiting for your approval</h3>' + pending.data.entries.map((e) => `<div class="card"><div class="row"><div><b>${moneyP(e.amount_paise)}</b> · ${esc(e.kind === 'return' ? 'cash returned' : (e.category || 'expense'))}<p class="muted">${esc(e.by_name || '')} · ${esc(e.project)} · ${esc(e.entry_date)}${e.narration ? ' · ' + esc(e.narration) : ''}</p></div></div>
      <div class="row-btns"><button class="btn small" data-pty-photos="${e.id}">Bill photo</button>${(e.created_by !== currentUser.id || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-pty="approve" data-id="${e.id}">Approve</button><button class="btn small" data-pty="reject" data-id="${e.id}">Reject</button>` : '<span class="muted">Another approver is needed</span>'}</div></div>`).join('');
    html += '<h3>' + (isRole('site') ? 'My fund' : 'Funds') + '</h3>' + (funds.data.funds.map((f) => `<div class="card clickable" data-fund="${f.id}"><div class="row"><div><b>${esc(f.project)}</b><p class="muted">${esc(f.custodian || '')}</p></div><div style="text-align:right"><b style="font-size:1.4em">${moneyP(f.balance_paise)}</b>${f.low ? '<br>' + chip('Running low', 'bad') : ''}${f.pending_paise ? `<br><span class="muted">${moneyP(f.pending_paise)} waiting</span>` : ''}</div></div></div>`).join('')
      || '<div class="card"><p>No petty-cash fund yet.</p><p class="muted">' + (mgr ? 'Open one for the person who keeps cash at the site.' : 'Ask Accounts or the Owner to open one for you.') + '</p></div>');
    body.innerHTML = html;
    if ($('pty-open')) $('pty-open').onclick = openFund;
    body.querySelectorAll('[data-fund]').forEach((c) => { c.onclick = () => fundDetail(c.dataset.fund); });
    body.querySelectorAll('[data-pty-photos]').forEach((b) => { b.onclick = () => showPhotos('pty_entries', Number(b.dataset.ptyPhotos)); });
    body.querySelectorAll('[data-pty]').forEach((b) => { b.onclick = async () => {
      let bj = {};
      if (b.dataset.pty === 'reject') { const v = await openForm({ title: 'Reject', fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }] }); if (!v) return; bj = v; }
      const r = await act(api(`/api/petty/entries/${b.dataset.id}/${b.dataset.pty}`, { method: 'POST', body: bj }), 'Done');
      if (r) { if (r.data && r.data.low_balance) toast('The fund is running low. Accounts has been told.', 6000); loadPetty(); }
    }; });
  } catch (e) { body.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function openFund() {
  const [projects, who] = [await projectOptions(), (await api('/api/petty/custodians')).data.users];
  const v = await openForm({ title: 'Open a petty-cash fund', fields: [{ name: 'project_id', label: 'Project', type: 'select', options: projects },
    { name: 'custodian_user_id', label: 'Who keeps the cash', type: 'select', options: who.map((u) => [u.id, `${u.name} (${u.role})`]) }, { name: 'opening_paise', label: 'Cash handed over now (₹)', type: 'money' }] });
  if (v && await act(api('/api/petty/funds', { method: 'POST', body: { project_id: Number(v.project_id), custodian_user_id: Number(v.custodian_user_id), opening_paise: v.opening_paise || 0 } }), 'Fund opened')) loadPetty();
}

async function fundDetail(id) {
  const d = (await api(`/api/petty/funds/${id}`)).data, f = d.fund;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const mayTopUp = isRole('owner', 'accounts'), maySpend = f.custodian_user_id === currentUser.id || isRole('owner', 'pm');
  ov.innerHTML = `<div class="modal"><h2>${esc(f.project)}</h2><p>${esc(f.custodian || '')}</p><p style="font-size:1.6em"><b>${moneyP(f.balance_paise)}</b> <span class="muted" style="font-size:.6em">in hand</span></p>${f.pending_paise ? `<p class="muted">${moneyP(f.pending_paise)} waiting for approval</p>` : ''}
    <div class="row-btns">${maySpend ? '<button class="btn btn-primary" id="pf-exp">+ Expense</button><button class="btn" id="pf-ret">Return cash</button>' : ''}${mayTopUp ? '<button class="btn" id="pf-top">Add cash</button>' : ''}<a class="btn" href="/api/petty/funds/${f.id}?csv=1">Statement CSV</a></div>
    ${d.categories.length ? '<h3>Spent, by type</h3>' + d.categories.map((c) => `<p>${esc(c.category)}: <b>${moneyP(c.total)}</b></p>`).join('') : ''}
    <h3>Entries</h3>${d.entries.map((e) => `<div class="card"><div class="row"><div><b>${e.kind === 'top_up' ? '+' : '−'}${moneyP(e.amount_paise)}</b> · ${esc(e.kind === 'top_up' ? 'cash added' : e.kind === 'return' ? 'cash returned' : (e.category || 'expense'))}<p class="muted">${esc(e.entry_date)}${e.narration ? ' · ' + esc(e.narration) : ''}${e.decision_note ? ' · ' + esc(e.decision_note) : ''}</p></div>${chip(PTY_WORD[e.status] || e.status, PTY_TONE[e.status])}</div>
      <div class="row-btns"><button class="btn small" data-ph="${e.id}">Bill photo</button>${['submitted'].includes(e.status) ? `<button class="btn small" data-cx="${e.id}">Cancel</button>` : ''}</div></div>`).join('') || '<p class="muted">No entries yet.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="pf-x">Close</button></div></div>`;
  document.body.appendChild(ov); $('pf-x').onclick = () => { ov.remove(); loadPetty(); };
  const entry = async (kind) => {
    const fields = kind === 'top_up' ? [{ name: 'amount_paise', label: 'Cash added (₹)', type: 'money', required: true }, { name: 'narration', label: 'Note' }]
      : [{ name: 'amount_paise', label: kind === 'return' ? 'Cash returned (₹)' : 'Amount spent (₹)', type: 'money', required: true },
        ...(kind === 'expense' ? [{ name: 'category', label: 'What for (tea, transport, repairs…)', required: true }] : []), { name: 'narration', label: 'Note' },
        { name: 'photos', label: 'Photo of the bill', type: 'files', accept: 'image/*', help: 'Optional. Kept on the phone until sent.' }];
    const v = await openForm({ title: kind === 'top_up' ? 'Add cash' : kind === 'return' ? 'Return cash' : 'New expense', fields });
    if (!v) return;
    const files = (window.__lastFiles && window.__lastFiles.photos) || []; delete v.photos;
    const uuid = crypto.randomUUID();
    const r = await postOrQueue('/api/petty/entries', { fund_id: f.id, kind, ...v, client_uuid: uuid }, kind === 'top_up' ? 'Cash added' : 'Sent for approval');
    if (r) { if (files.length) await filePhotos('pty_entries', uuid, f.project_id, files, r.data && r.data.id); if (r.data && r.data.id) saveMapEntry(uuid, r.data.id); ov.remove(); fundDetail(id); }
  };
  if ($('pf-exp')) $('pf-exp').onclick = () => entry('expense');
  if ($('pf-ret')) $('pf-ret').onclick = () => entry('return');
  if ($('pf-top')) $('pf-top').onclick = () => entry('top_up');
  ov.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => showPhotos('pty_entries', Number(b.dataset.ph)); });
  ov.querySelectorAll('[data-cx]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Cancel entry', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (v && await act(api(`/api/petty/entries/${b.dataset.cx}/cancel`, { method: 'POST', body: v }), 'Cancelled')) { ov.remove(); fundDetail(id); } }; });
}

// ======================= WP-9 DOCUMENTS WITH EXPIRY =======================
const DOC_TONE = { valid: 'good', no_expiry: '', expiring: 'warn', expired: 'bad', replaced: '' };
const DOC_WORD = { valid: 'Valid', no_expiry: 'No expiry', expiring: 'Expiring soon', expired: 'Expired', replaced: 'Replaced' };

// Documents block for one vendor or contractor. Opened from the vendor ledger and the contractor ledger.
async function partyDocsModal(type, id) {
  const d = (await api(`/api/partydocs?party_type=${type}&party_id=${id}`)).data.docs;
  const canE = isRole('owner', 'pm', 'purchase', 'accounts');
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const card = (x) => `<div class="card" style="${x.state === 'replaced' ? 'opacity:.6' : ''}"><div class="row"><div><b>${esc(x.doc_type)}</b><p class="muted">${x.valid_till ? 'Valid till ' + esc(x.valid_till) + (x.days_left != null && x.state !== 'replaced' ? (x.days_left < 0 ? ` (${-x.days_left} days ago)` : ` (${x.days_left} days left)`) : '') : 'No expiry date'}${x.note ? ' · ' + esc(x.note) : ''}</p></div>${chip(DOC_WORD[x.state], DOC_TONE[x.state])}</div>
      <div class="row-btns">${x.document_id ? `<a class="btn small" href="/api/files/download/${x.document_id}" target="_blank" rel="noopener">Open file</a>` : ''}${canE && x.current ? `<button class="btn small btn-primary" data-renew="${x.id}" data-type="${esc(x.doc_type)}" data-kind="${esc(x.kind)}">Replace with new copy</button>${currentUser.role === 'owner' ? `<button class="btn small" data-rm="${x.id}">Remove</button>` : ''}` : ''}</div></div>`;
  const contracts = d.filter((x) => x.kind === 'contract'), others = d.filter((x) => x.kind !== 'contract');
  ov.innerHTML = `<div class="modal"><h2>Contracts and documents</h2>${canE ? '<button class="btn btn-primary btn-full" id="pd-add-c">+ Upload a contract</button><button class="btn btn-full" id="pd-add">+ Add another document</button>' : ''}
    <h3>Contracts</h3>${contracts.map(card).join('') || '<p class="muted">No contract uploaded yet.</p>'}
    <h3>Other documents</h3>${others.map(card).join('') || '<p class="muted">Licences, insurance, registrations and anything else you want to keep an eye on.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="pd-x">Close</button></div></div>`;
  document.body.appendChild(ov); $('pd-x').onclick = () => ov.remove();
  const addDoc = async (docType, replacesId, kind) => {
    const v = await openForm({ title: replacesId ? 'New copy' : kind === 'contract' ? 'Upload a contract' : 'Add a document', intro: kind === 'contract' ? 'Name the contract (for example: Supply contract, Architect agreement). Add its end date to be reminded before it runs out. For a big scanned contract, connect Google Drive under Storage.' : 'Type what the document is. You are reminded before it expires.', fields: [
      { name: 'doc_type', label: kind === 'contract' ? 'Contract name' : 'What is it? (e.g. GST certificate, insurance)', required: true, value: docType || '' }, { name: 'valid_till', label: kind === 'contract' ? 'Contract ends on (leave empty if open-ended)' : 'Valid till (leave empty if it never expires)', type: 'date' },
      { name: 'reminder_days', label: 'Remind me this many days before', type: 'number', value: 30 }, { name: 'file', label: 'File (photo or PDF)', type: 'file' }] });
    if (!v) return;
    let documentId = null;
    if (v.file) {
      const fd = new FormData(); fd.append('file', v.file); fd.append('title', `${v.doc_type} (${type})`); fd.append('category', 'party_doc'); fd.append('module', 'procurement'); fd.append('audience', 'internal');
      const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return; documentId = up.data.id;
    }
    const body = { party_type: type, party_id: Number(id), doc_type: v.doc_type, valid_till: v.valid_till || null, reminder_days: v.reminder_days === '' ? 30 : v.reminder_days, document_id: documentId, kind: kind || 'document' };
    if (replacesId) body.replaces_id = Number(replacesId);
    if (await act(api('/api/partydocs', { method: 'POST', body }), replacesId ? 'Replaced. Reminders start again from the new date.' : 'Document added')) { ov.remove(); partyDocsModal(type, id); }
  };
  if ($('pd-add')) $('pd-add').onclick = () => addDoc('', null, 'document');
  if ($('pd-add-c')) $('pd-add-c').onclick = () => addDoc('', null, 'contract');
  ov.querySelectorAll('[data-renew]').forEach((b) => { b.onclick = () => addDoc(b.dataset.type, b.dataset.renew, b.dataset.kind); });
  ov.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { if (confirm('Remove this document from the list?') && await act(api(`/api/partydocs/${b.dataset.rm}?party_type=${type}`, { method: 'DELETE' }), 'Removed')) { ov.remove(); partyDocsModal(type, id); } }; });
}

// ======================= PROFESSIONALS =======================
async function renderProfessionals(main) {
  const canC = isRole('owner', 'pm', 'purchase', 'accounts');
  main.innerHTML = `<h1>Professionals</h1><p class="help">Architects, engineers, advocates, CAs and other consultants. Keep each one's contracts and documents here.</p>
    ${canC ? '<button class="btn btn-primary btn-full" id="pf-new">+ Add a professional</button>' : ''}<div class="field"><input id="pf-q" placeholder="Search by name, profession or firm"></div><div id="pf-list">Loading...</div>`;
  if (canC) $('pf-new').onclick = () => professionalForm(null);
  let t = null; $('pf-q').oninput = () => { clearTimeout(t); t = setTimeout(loadProfessionals, 300); };
  loadProfessionals();
}

async function loadProfessionals() {
  const box = $('pf-list'); if (!box) return;
  try {
    const q = encodeURIComponent(($('pf-q') || {}).value || '');
    const list = (await api(`/api/professionals?q=${q}`)).data.professionals;
    const canE = isRole('owner', 'pm', 'purchase', 'accounts');
    box.innerHTML = list.map((p) => `<div class="card"><div class="row"><div><b>${esc(p.name)}</b><p class="muted">${esc(p.profession || '')}${p.firm ? ' · ' + esc(p.firm) : ''}${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}${p.pan_masked ? ' · PAN ' + esc(p.pan_masked) : ''}</p></div>${p.active ? '' : chip('Inactive')}</div>
      <div class="row-btns"><button class="btn small btn-primary" data-pdocs="${p.id}">Contracts &amp; documents</button>${canE ? `<button class="btn small" data-pedit="${p.id}">Edit</button>` : ''}</div></div>`).join('') || '<div class="card"><p>No professionals yet.</p><p class="muted">Add your architect, structural engineer, advocate and others.</p></div>';
    box.querySelectorAll('[data-pdocs]').forEach((b) => { b.onclick = () => partyDocsModal('professional', Number(b.dataset.pdocs)); });
    box.querySelectorAll('[data-pedit]').forEach((b) => { b.onclick = () => professionalForm(list.find((p) => p.id === Number(b.dataset.pedit))); });
  } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function professionalForm(p) {
  const v = await openForm({ title: p ? 'Edit professional' : 'Add a professional', fields: [
    { name: 'name', label: 'Name', required: true, value: p ? p.name : '' }, { name: 'profession', label: 'Profession (Architect, Structural engineer, Advocate, CA…)', value: p ? p.profession : '' },
    { name: 'firm', label: 'Firm', value: p ? p.firm : '' }, { name: 'phone', label: 'Phone', value: p ? p.phone : '' }, { name: 'email', label: 'Email', value: p ? p.email : '' },
    { name: 'gstin', label: 'GSTIN', value: p ? p.gstin : '' }, { name: 'pan', label: p && p.has_pan ? 'PAN (leave empty to keep the saved one)' : 'PAN (kept private)' }, { name: 'notes', label: 'Notes', type: 'textarea', value: p ? p.notes : '' }] });
  if (!v) return;
  const ok = p ? await act(api(`/api/professionals/${p.id}`, { method: 'PUT', body: v }), 'Saved') : await act(api('/api/professionals', { method: 'POST', body: v }), 'Added');
  if (ok) loadProfessionals();
}
