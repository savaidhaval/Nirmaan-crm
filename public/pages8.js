// pages8.js — WP-7 Budget: heads per project, committed / billed / paid / balance, and the POs and work orders behind each head.

const BUDGET_TONE = { ok: 'good', near: 'warn', over: 'bad', unset: '' };

// Budget-head choices for the PO and work order forms. [] when the project has none (the field is then left out).
async function budgetHeadOptions() {
  try {
    const heads = (await api('/api/budget/heads')).data.heads;
    if (!heads.length) return [];
    return [['', 'Not tagged'], ...heads.map((h) => [h.id, `${h.project} · ${h.code} ${h.name}`])];
  } catch (e) { return []; }   // roles without budget access simply do not get the field
}

async function renderBudget(main) {
  const writer = ['owner', 'pm'].includes(currentUser.role);
  const projects = await projectOptions();
  if (!projects.length) { main.innerHTML = '<h1>Budget</h1><div class="card"><p>No projects yet.</p></div>'; return; }
  main.innerHTML = `<h1>Budget</h1><div class="field"><label>Project</label><select id="bud-project">${projects.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
    ${writer ? '<button class="btn btn-primary btn-full" id="bud-add">+ Add a budget head</button>' : ''}<div id="bud-body">Loading...</div>`;
  const pid = () => Number($('bud-project').value);
  $('bud-project').onchange = () => loadBudget(pid(), writer);
  if (writer) $('bud-add').onclick = async () => {
    const v = await openForm({ title: 'New budget head', intro: 'A head is a type of cost, like Steel or Cement. Set how much you plan to spend on it.', fields: [
      { name: 'code', label: 'Short code (e.g. ST)', required: true }, { name: 'name', label: 'Name (e.g. Steel)', required: true }, { name: 'budget_paise', label: 'Budget (₹)', type: 'money', required: true }] });
    if (v && await act(api('/api/budget/heads', { method: 'POST', body: { ...v, project_id: pid() } }), 'Budget head added')) loadBudget(pid(), writer);
  };
  loadBudget(pid(), writer);
}

async function loadBudget(pid, writer) {
  const body = $('bud-body'); if (!body) return;
  try {
    const d = (await api(`/api/budget/overview?project_id=${pid}`)).data;
    const pct = (r) => (r.pct_used_bp == null ? '—' : (r.pct_used_bp / 100).toFixed(1) + '%');
    let html = `<p class="muted">Figures are ${d.gst_basis === 'inclusive' ? 'including' : 'excluding'} GST. Committed = approved purchase orders and work orders. Please confirm the GST treatment with your CA.</p>`;
    html += d.rows.map((r) => `<div class="card clickable" data-head="${r.id}"><div class="row"><div><b>${esc(r.code)} · ${esc(r.name)}</b><p class="muted">Budget ${moneyP(r.budget_paise)}</p></div>${chip(r.level_text, BUDGET_TONE[r.level])}</div>
      <div style="height:10px;background:#e5e7eb;border-radius:6px;margin:6px 0"><div style="height:10px;border-radius:6px;width:${Math.min(100, (r.pct_used_bp || 0) / 100)}%;background:${r.level === 'over' ? '#dc2626' : r.level === 'near' ? '#d97706' : '#16a34a'}"></div></div>
      <p><b>${moneyP(r.committed_paise)}</b> committed (${pct(r)})<br><span class="muted">Billed ${moneyP(r.billed_paise)} · Paid ${moneyP(r.paid_paise)}</span><br>${r.balance_paise < 0 ? `<b style="color:#991b1b">Over by ${moneyP(-r.balance_paise)}</b>` : `Balance <b>${moneyP(r.balance_paise)}</b>`}</p></div>`).join('')
      || '<div class="card"><p>No budget heads yet.</p><p class="muted">Add one (for example Steel or Cement) and tag purchase orders and work orders to it.</p></div>';
    if (d.untagged.committed_paise || d.untagged.billed_paise) html += `<div class="card"><b>Not tagged to a head</b><p class="muted">Committed ${moneyP(d.untagged.committed_paise)} · billed ${moneyP(d.untagged.billed_paise)} · paid ${moneyP(d.untagged.paid_paise)}</p></div>`;
    if (d.rows.length) html += `<div class="card"><b>Total</b><p>Budget ${moneyP(d.total.budget)} · committed ${moneyP(d.total.committed)} · billed ${moneyP(d.total.billed)} · paid ${moneyP(d.total.paid)}</p></div><p><a class="btn small" href="/api/budget/overview?project_id=${pid}&csv=1">Download CSV</a></p>`;
    body.innerHTML = html;
    body.querySelectorAll('[data-head]').forEach((c) => { c.onclick = () => budgetHeadDetail(c.dataset.head, writer, pid); });
  } catch (e) { body.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function budgetHeadDetail(id, writer, pid) {
  const d = (await api(`/api/budget/heads/${id}/detail`)).data;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(d.head.code)} · ${esc(d.head.name)}</h2><p>Budget <b>${moneyP(d.head.budget_paise)}</b></p>
    <h3>Purchase orders</h3>${d.pos.map((p) => `<p>${esc(p.po_no)} · ${esc(p.vendor)} · ${moneyP(p.amount_paise)} ${statusChip(p.status)}</p>`).join('') || '<p class="muted">None tagged yet.</p>'}
    <h3>Work orders</h3>${d.work_orders.map((w) => `<p>${esc(w.wo_no)} · ${esc(w.contractor)} · ${moneyP(w.value_paise)} ${statusChip(w.status)}</p>`).join('') || '<p class="muted">None tagged yet.</p>'}
    <div class="modal-actions">${writer ? '<button class="btn" id="bh-edit">Change budget</button><button class="btn" id="bh-del">Remove head</button>' : ''}<button class="btn btn-primary" id="bh-x">Close</button></div></div>`;
  document.body.appendChild(ov); $('bh-x').onclick = () => ov.remove();
  if ($('bh-edit')) $('bh-edit').onclick = async () => {
    const v = await openForm({ title: 'Change budget', fields: [{ name: 'name', label: 'Name', value: d.head.name, required: true }, { name: 'budget_paise', label: 'Budget (₹)', type: 'money', value: (d.head.budget_paise / 100).toFixed(2), required: true }] });
    if (v && await act(api(`/api/budget/heads/${id}`, { method: 'PUT', body: v }), 'Budget updated')) { ov.remove(); loadBudget(pid, writer); }
  };
  if ($('bh-del')) $('bh-del').onclick = async () => { if (confirm('Remove this head?') && await act(api(`/api/budget/heads/${id}`, { method: 'DELETE' }), 'Head removed')) { ov.remove(); loadBudget(pid, writer); } };
}
