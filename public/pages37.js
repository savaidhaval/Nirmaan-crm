// pages37.js — Module 4, step 1: Collections screen (follow-up ladder, inflow forecast, buyer TDS to verify, bank follow-ups).
Object.assign(ICONS, { collections: 'M4 6h16M4 12h10M4 18h6M18 14l3 3-3 3M21 17h-8' });
Object.assign(ROUTE_TITLES, { collections: 'Collections' });
Object.assign(PAGES, { collections: renderCollections });

const _sidebarItems37 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems37(role).map(([g, items]) => [g, [...items]]);
  if (['owner', 'pm', 'accounts', 'sales'].includes(role)) {
    const item = { label: 'Collections', route: 'collections', icon: 'collections' };
    let done = false;
    for (const [, items] of groups) { const i = items.findIndex((x) => x.route === 'demandletters'); if (i >= 0) { items.splice(i + 1, 0, item); done = true; break; } }
    if (!done) groups[groups.length - 1][1].push(item);
  }
  return groups;
};

let colTab = 'ladder';
async function renderCollections(main) {
  const money = ['owner', 'pm', 'accounts'].includes(currentUser.role);
  const tabs = [['ladder', 'Follow up'], ...(money ? [['forecast', 'Next 90 days'], ['tds', 'Buyer TDS'], ['bank', 'Bank follow-ups']] : [])];
  if (!tabs.some(([k]) => k === colTab)) colTab = 'ladder';
  main.innerHTML = `<h1>Collections</h1><div class="row-btns">${tabs.map(([k, l]) => `<button class="btn small${colTab === k ? ' btn-primary' : ''}" data-ct="${k}">${l}</button>`).join('')}</div><div id="col-out">Loading...</div>`;
  main.querySelectorAll('[data-ct]').forEach((b) => { b.onclick = () => { colTab = b.dataset.ct; renderCollections(main); }; });
  const out = $('col-out');
  const pid = scopeProject || 0; const q = pid ? '?project_id=' + pid : '';
  try {
    if (colTab === 'ladder') await colLadder(out, q);
    else if (colTab === 'forecast') await colForecast(out, q);
    else if (colTab === 'tds') await colTds(out, q);
    else await colBank(out);
  } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function colLadder(out, q) {
  const d = (await api('/api/sales/collections-ladder' + q)).data;
  const unit = (r) => `${r.wing ? r.wing + '-' : ''}${r.unit_no}`;
  const msg = {
    soon: (r) => `Dear ${r.customer_name}, a gentle reminder: your instalment "${r.label}" of ${moneyP(r.due_paise)} for flat ${unit(r)} (${r.project}) falls due on ${r.due_date}. Please arrange the payment. Thank you.`,
    late: (r) => `Dear ${r.customer_name}, your instalment "${r.label}" of ${moneyP(r.due_paise)} for flat ${unit(r)} (${r.project}) was due on ${r.due_date} and is ${r.days_late} day${r.days_late === 1 ? '' : 's'} overdue. Please pay at the earliest.`,
    late15: (r) => `Dear ${r.customer_name}, your instalment "${r.label}" of ${moneyP(r.due_paise)} for flat ${unit(r)} (${r.project}) has been overdue since ${r.due_date} (${r.days_late} days). Interest as per the RERA rules is accruing${r.interest_paise ? ' (' + moneyP(r.interest_paise) + ' so far)' : ''}. Please pay at once or call us.`,
  };
  const sect = (key, title, tone, rows) => `<h3>${title} (${rows.length})</h3>${rows.map((r) => `<div class="card"><div class="row"><div><b>${esc(r.customer_name)}</b> · ${esc(unit(r))}<p class="muted">${esc(r.label)} · ${moneyP(r.due_paise)} · due ${esc(r.due_date)}${r.days_late > 0 ? ' · ' + r.days_late + ' days late' : ''}${r.interest_paise ? ' · interest so far ' + moneyP(r.interest_paise) : ''}</p></div>${chip(key === 'soon' ? 'due soon' : key === 'late' ? 'overdue' : 'overdue 15+ days', tone)}</div>
      <div class="row-btns">${r.phone ? `<a class="btn small btn-primary" target="_blank" rel="noopener" href="${waLink(r.phone, msg[key](r))}">WhatsApp</a><a class="btn small" href="tel:${esc(r.phone)}">Call</a>` : ''}</div></div>`).join('') || '<div class="empty-state"><p>Nothing here.</p></div>'}`;
  out.innerHTML = `<p class="help">Three steps, no uncomfortable calls: a nudge ${d.days_soon} days before the due date, a reminder once it is overdue, and an interest notice after ${d.days_interest} days. Each button opens your own WhatsApp with the message ready; you tap Send. Confirm the interest wording with your advocate.</p>${sect('soon', `Due in the next ${d.days_soon} days`, 'warn', d.soon)}${sect('late', 'Overdue', 'bad', d.late)}${sect('late15', `Overdue ${d.days_interest}+ days`, 'bad', d.late15)}`;
}

async function colForecast(out, q) {
  const d = (await api('/api/reports/collections-forecast' + q)).data;
  out.innerHTML = `<p class="help">What buyers are due to pay, by due date. Stages not yet certified have no date. Home-loan money is shown separately because banks pay on their own dates.</p>
    <div class="card"><div class="kv">${d.windows.map((w) => `<span>${esc(w.label)} (${w.count} demand${w.count === 1 ? '' : 's'})</span><b>${moneyP(w.paise)}</b>`).join('')}${d.later_paise ? `<span>Later than 90 days</span><b>${moneyP(d.later_paise)}</b>` : ''}<span>Stages not yet certified (${d.undated_count})</span><b>${moneyP(d.undated_paise)}</b><span>Home loans sanctioned, not yet paid</span><b>${moneyP(d.loans_pending_paise)}</b></div></div><p class="help">${esc(d.note)}</p>`;
}

async function colTds(out, q) {
  const d = (await api('/api/sales/tds-credits' + q)).data;
  out.innerHTML = `<p class="help">On flats of ₹50 lakh and above the buyer deducts 1% (s.194-IA) and pays it to the Government with Form 26QB. That part counts as received only after you verify the challan here. Possession cannot be given while any is unverified. Confirm the rules with your CA.</p>
    <p><b>${d.credits.length}</b> waiting · <b>${moneyP(d.total_paise)}</b></p>${d.credits.map((c) => `<div class="card"><div class="row"><div><b>${esc(c.customer_name)}</b> · ${esc((c.wing ? c.wing + '-' : '') + c.unit_no)}<p class="muted">${moneyP(c.amount_paise)} · receipt ${esc(c.receipt_no || '')} · ${esc(dateIST(c.created_at))}</p></div></div>
      ${['owner', 'accounts'].includes(currentUser.role) ? `<button class="btn small btn-primary" data-tv="${c.id}">Verify the challan</button>` : ''}</div>`).join('') || '<div class="empty-state"><p>No buyer TDS is waiting.</p></div>'}`;
  out.querySelectorAll('[data-tv]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Verify the buyer\'s TDS', intro: 'Enter the Form 26QB acknowledgement number from the buyer\'s challan, and the date they paid it.', fields: [{ name: 'challan_no', label: 'Form 26QB acknowledgement number', required: true }, { name: 'paid_on', label: 'Paid on', type: 'date', value: today(), required: true }, { name: 'form16b', label: 'Copy of the challan or Form 16B (optional)', type: 'file' }] });
    if (!v) return;
    const body = { challan_no: v.challan_no, paid_on: v.paid_on };
    if (v.form16b) { const fd = new FormData(); fd.append('file', await compressFile(v.form16b), v.form16b.name); fd.append('title', 'TDS challan ' + v.challan_no); fd.append('category', 'agreement'); fd.append('module', 'sales'); fd.append('project_id', String(scopeProject || 0)); fd.append('audience', 'internal'); const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return; body.form16b_doc_id = up.data.id; }
    if (await act(api(`/api/sales/tds-credits/${b.dataset.tv}/verify`, { method: 'POST', body }), 'Verified')) colTds(out, q);
  }; });
}

async function colBank(out) {
  const d = (await api('/api/sales/bank-followups')).data;
  out.innerHTML = `<p class="help">Demands on flats with a home loan, still unpaid ${d.days} days after the due date, while the bank has sanctioned money it has not paid. Write to the bank's relationship manager first; if there is no answer, to the project coordinator.</p>${d.followups.map((r) => {
    const body = `Dear ${r.rm_name || 'Sir/Madam'}, please release the ${r.bank} loan instalment for ${r.customer_name}, flat ${r.wing ? r.wing + '-' : ''}${r.unit_no} (${r.project}). Demand "${r.label}" of ${moneyP(r.due_paise)} fell due on ${r.due_date} and is ${r.days_late} days overdue. The demand letter and progress photos are attached.`;
    return `<div class="card"><div class="row"><div><b>${esc(r.customer_name)}</b> · ${esc((r.wing ? r.wing + '-' : '') + r.unit_no)}<p class="muted">${esc(r.bank)} · sanctioned ${moneyP(r.sanction_paise)}, paid ${moneyP(r.disbursed_paise)}<br>${esc(r.label)} · ${moneyP(r.due_paise)} · ${r.days_late} days late</p><p class="muted">RM: ${esc(r.rm_name || 'not entered')}${r.rm_phone ? ' · ' + esc(r.rm_phone) : ''}</p></div></div>
      <div class="row-btns">${r.rm_email ? `<a class="btn small btn-primary" href="mailto:${esc(r.rm_email)}?subject=${encodeURIComponent('Loan disbursement: ' + r.customer_name)}&body=${encodeURIComponent(body)}">Email the RM</a>` : ''}${r.coordinator_email ? `<a class="btn small" href="mailto:${esc(r.coordinator_email)}?subject=${encodeURIComponent('Escalation, loan disbursement: ' + r.customer_name)}&body=${encodeURIComponent(body)}">Escalate to the coordinator</a>` : ''}${r.rm_phone ? `<a class="btn small" target="_blank" rel="noopener" href="${waLink(r.rm_phone, body)}">WhatsApp the RM</a>` : ''}</div></div>`;
  }).join('') || '<div class="empty-state"><p>No bank-funded demand is late.</p></div>'}`;
}
