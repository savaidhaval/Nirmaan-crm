// pages11.js — sales completeness (WP-11 to WP-14): receipts waiting for approval, credit/debit notes, co-applicants, cost sheets, handover and home loans.

const SALES_MONEY = ['owner', 'pm', 'accounts'];
const SALES_APPROVERS = ['owner', 'pm'];
const SALES_WORKERS = ['owner', 'pm', 'sales'];

// ---------- Booking from an approved cost sheet ----------
bookUnit = async function (unit) {
  let sheets = [];
  try { sheets = (await api('/api/sales/cost-sheets?unit_id=' + unit.id)).data.sheets.filter((s) => s.status === 'approved' && !s.booking_id); } catch (e) { /* no access to sheets: type the price */ }
  const fields = [{ name: 'customer_name', label: 'Customer name', required: true }, { name: 'phone', label: 'Mobile' }, { name: 'email', label: 'Email', type: 'email' },
    ...(sheets.length ? [{ name: 'cost_sheet_id', label: 'Price from an approved cost sheet', type: 'select', options: [['', 'No, I will type the price'], ...sheets.map((s) => [s.id, `Version ${s.version} · ${moneyP(s.agreement_value_paise)}${s.lead_name ? ' · ' + s.lead_name : ''}`])], help: 'If you pick one, the price below is ignored.' }] : []),
    { name: 'agreed_price_paise', label: 'Agreed price (₹)', type: 'money', value: ((unit.price_paise + (unit.floor_rise_paise || 0)) / 100) }, { name: 'token_paise', label: 'Token received (₹)', type: 'money' }];
  const v = await openForm({ title: `Book ${unit.wing ? unit.wing + '-' : ''}${unit.unit_no}`, intro: 'Payment demands are created from the project payment plan, to the paisa.', fields });
  if (!v) return;
  const body = { unit_id: unit.id, ...v };
  if (v.cost_sheet_id) { body.cost_sheet_id = Number(v.cost_sheet_id); const s = sheets.find((x) => x.id === body.cost_sheet_id); if (s && s.lead_id) body.lead_id = s.lead_id; } else delete body.cost_sheet_id;
  const r = await act(api('/api/sales/bookings', { method: 'POST', body }), 'Booked');
  if (r) { if (r.data.warning) alert(r.data.warning); loadSales(); }
};

// ---------- Cost sheets, from the flat card ----------
const CS_TONE = { approved: 'good', pending_approval: 'warn', draft: '', rejected: 'bad', superseded: '' };

const _unitDrillWP13 = unitDrill;
unitDrill = async function (u) {
  await _unitDrillWP13(u);
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov) return;
  const row = ov.querySelector('.row-btns'); if (!row || !isRole('owner', 'pm', 'sales', 'accounts')) return;
  const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Cost sheets (priced offers)';
  b.onclick = () => costSheetsModal(u); row.appendChild(b);
};

async function costSheetsModal(u) {
  let sheets; try { sheets = (await api('/api/sales/cost-sheets?unit_id=' + u.id)).data.sheets; } catch (e) { toast(e.message); return; }
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Cost sheets · ${esc(u.wing ? u.wing + '-' : '')}${esc(u.unit_no)}</h2><p class="muted">Rate card ${moneyP(u.list_paise)}. A booking can take its price from an approved sheet.</p>
    ${isRole(...SALES_WORKERS) ? '<button class="btn btn-primary btn-full" id="cs-quick">Quick cost sheet from the price list</button><button class="btn btn-full" id="cs-new" style="margin-top:8px">+ New cost sheet (type everything)</button>' : ''}
    ${sheets.map((s) => `<div class="card"><div class="row"><div><b>Version ${s.version}${s.lead_name ? ' · ' + esc(s.lead_name) : ''}</b><p class="muted">Agreement ${moneyP(s.agreement_value_paise)} · total with taxes ${moneyP(s.total_paise)}${s.below_list_paise ? `<br><b>${moneyP(s.below_list_paise)} below the rate card</b>` : ''}${s.below_msp ? `<br><b style="color:#b91c1c">Below the minimum selling price (${moneyP(s.msp_paise)}): Owner approval PIN needed</b>` : ''}</p></div>${chip(String(s.status).replace(/_/g, ' '), CS_TONE[s.status])}</div>
      <div class="row-btns"><button class="btn small" data-csp="${s.id}">Print / save as PDF</button><button class="btn small" data-csw="${s.id}">Send on WhatsApp</button>${['draft', 'rejected'].includes(s.status) && (s.created_by === currentUser.id || isRole('owner')) ? `<button class="btn small btn-primary" data-css="${s.id}">Send for approval</button>` : ''}
      ${s.status === 'pending_approval' && isRole(...SALES_APPROVERS) && (s.created_by !== currentUser.id || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-csa="approve" data-id="${s.id}" data-msp="${s.below_msp ? 1 : 0}">Approve</button><button class="btn small" data-csa="reject" data-id="${s.id}">Reject</button>` : ''}</div></div>`).join('') || '<p class="muted">No cost sheet yet.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="cs-x">Close</button></div></div>`;
  document.body.appendChild(ov); $('cs-x').onclick = () => ov.remove();
  const again = () => { ov.remove(); costSheetsModal(u); };
  ov.querySelectorAll('[data-csw]').forEach((x) => { x.onclick = async () => {
    const s = sheets.find((y) => String(y.id) === x.dataset.csw); let phone = '';
    if (s.lead_id) { try { phone = (await api('/api/sales/leads/' + s.lead_id)).data.lead.phone; } catch (e) { /* not your lead */ } }
    const stamp = new Date(Date.now() + 19800000).toISOString().replace('T', ' ').substring(0, 16) + ' IST';
    const text = `Cost sheet ${u.wing ? u.wing + '-' : ''}${u.unit_no} (version ${s.version}, ${stamp})\nAgreement value: ${moneyP(s.agreement_value_paise)}\nGST: ${moneyP(s.gst_paise)}\nStamp duty: ${moneyP(s.stamp_duty_paise)}\nRegistration: ${moneyP(s.registration_paise)}\nTotal: ${moneyP(s.total_paise)}\nThis is an estimate and may change. Taxes and duties are as per the rates in force.`;
    window.open(phone ? waLink(phone, text) : 'https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }; });
  ov.querySelectorAll('[data-csp]').forEach((x) => { x.onclick = () => openPrint('costsheet', x.dataset.csp); });
  ov.querySelectorAll('[data-css]').forEach((x) => { x.onclick = async () => { if (await act(api(`/api/sales/cost-sheets/${x.dataset.css}/submit`, { method: 'POST' }), 'Sent for approval')) again(); }; });
  ov.querySelectorAll('[data-csa]').forEach((x) => { x.onclick = async () => {
    let body = {}; if (x.dataset.csa === 'reject') { const v = await openForm({ title: 'Reject cost sheet', fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }] }); if (!v) return; body = v; }
    if (x.dataset.csa === 'approve' && x.dataset.msp === '1') { const v = await openForm({ title: 'Approve below the minimum price', intro: 'This price is under the minimum selling price. Only the Owner can approve it, with the approval PIN.', fields: [{ name: 'pin', label: 'Approval PIN (6 digits)', type: 'password', required: true }] }); if (!v) return; body = { pin: v.pin }; }
    if (await act(api(`/api/sales/cost-sheets/${x.dataset.id}/${x.dataset.csa}`, { method: 'POST', body }), 'Done')) again();
  }; });
  if ($('cs-quick')) $('cs-quick').onclick = async () => {
    let leads = []; try { leads = (await api('/api/sales/leads')).data.leads.filter((l) => !['booked', 'lost'].includes(l.status)); } catch (e) { /* ignore */ }
    const v = await openForm({ title: 'Quick cost sheet', intro: 'The rate, floor rise, location charges, club and development charges come from the price list. Taxes come from Settings. You can send it for approval after.', fields: [
      { name: 'lead_id', label: 'For which lead', type: 'select', options: [['', 'Not tied to a lead'], ...leads.map((l) => [l.id, l.name])] }, { name: 'parking', label: 'Car parking slots', type: 'number', value: 1 }] });
    if (!v) return;
    let q; try { q = (await api(`/api/sales/units/${u.id}/quote?parking=${Number(v.parking) || 0}`)).data; } catch (e) { toast(e.message); return; }
    if (await act(api('/api/sales/cost-sheets', { method: 'POST', body: { unit_id: u.id, lead_id: v.lead_id ? Number(v.lead_id) : null, area_basis: 'rera_carpet', base_rate_paise_per_sqft: q.base_rate_paise_per_sqft, lines: q.lines, note: 'From the price list' } }), 'Cost sheet made as a draft')) again();
  };
  if ($('cs-new')) $('cs-new').onclick = async () => {
    let leads = []; try { leads = (await api('/api/sales/leads')).data.leads.filter((l) => !['booked', 'lost'].includes(l.status)); } catch (e) { /* ignore */ }
    const v = await openForm({ title: 'New cost sheet', intro: 'Rates for GST, stamp duty and registration come from Settings. Change them here if this offer differs. Confirm rates with your CA or advocate.', fields: [
      { name: 'lead_id', label: 'For which lead', type: 'select', options: [['', 'Not tied to a lead'], ...leads.map((l) => [l.id, l.name])] },
      { name: 'area_basis', label: 'Price on', type: 'select', options: [['rera_carpet', 'RERA carpet area'], ['carpet', 'Carpet area']] },
      { name: 'rate', label: 'Rate per sq ft (₹)', type: 'money', required: true },
      { name: 'lines', label: 'Extra charges and discounts (one per line: name | amount; a minus sign before the amount makes it a discount)', type: 'textarea', placeholder: 'Parking | 500000\nFestival offer | -300000' },
      { name: 'gst_pct', label: 'GST % (blank = Settings)', type: 'number' }, { name: 'stamp_pct', label: 'Stamp duty % (blank = Settings)', type: 'number' }, { name: 'registration', label: 'Registration fee ₹ (blank = from Settings)', type: 'money' }, { name: 'note', label: 'Note' }] });
    if (!v) return;
    const lines = String(v.lines || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [label, amt] = l.split('|').map((x) => x.trim()); const neg = /^-/.test(amt || ''); return { label, kind: neg ? 'discount' : 'addition', amount_paise: rupeesToPaise(String(amt || '').replace(/^[+-]/, '')) }; });
    const body = { unit_id: u.id, lead_id: v.lead_id ? Number(v.lead_id) : null, area_basis: v.area_basis, base_rate_paise_per_sqft: v.rate, lines, note: v.note };
    if (v.gst_pct !== '') body.gst_bp = Math.round(Number(v.gst_pct) * 100); if (v.stamp_pct !== '') body.stamp_duty_bp = Math.round(Number(v.stamp_pct) * 100); if (v.registration) body.registration_paise = v.registration;
    if (await act(api('/api/sales/cost-sheets', { method: 'POST', body }), 'Cost sheet made as a draft')) again();
  };
}

// ---------- Booking detail: approvals, notes, co-applicants, loans, handover ----------
const _bookingDetailWP11 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetailWP11(id);
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov) return;
  const money = SALES_MONEY.includes(currentUser.role), sellers = ['owner', 'pm', 'accounts', 'sales'].includes(currentUser.role);
  let d; try { d = (await api('/api/sales/bookings/' + id)).data; } catch (e) { return; }
  const safe = (p, dflt) => p.catch(() => ({ data: dflt }));
  const [rq, adj, parties, ho] = await Promise.all([money ? safe(api(`/api/sales/receipt-requests?booking_id=${id}`), { requests: [] }) : { data: { requests: [] } }, money ? safe(api(`/api/sales/bookings/${id}/adjustments`), { adjustments: [] }) : { data: { adjustments: [] } },
    safe(api(`/api/sales/bookings/${id}/parties`), { parties: [] }), safe(api(`/api/sales/bookings/${id}/handover`), { handover: null, items: [], loans: [], snags: [], can_open: false })]);
  const box = document.createElement('div'); const H = ho.data;
  const adjTone = { approved: 'good', pending: 'warn', rejected: 'bad', reversed: '' };
  box.innerHTML = `
    ${rq.data.requests.length ? `<h3>Receipts waiting for approval</h3>${rq.data.requests.map((r) => `<div class="card"><div class="row"><div><b>${moneyP(r.amount_paise)}</b>${r.tds_paise ? ' + TDS ' + moneyP(r.tds_paise) : ''} · ${esc(r.mode || '')} ${esc(r.ref_no || '')}<p class="muted">Recorded by ${esc(r.requested_by_name || '')}</p></div>${chip('Waiting', 'warn')}</div>
      ${SALES_APPROVERS.includes(currentUser.role) && (r.requested_by !== currentUser.id || currentUser.role === 'owner') ? `<div class="row-btns"><button class="btn small btn-primary" data-rq="approve" data-id="${r.id}">Approve</button><button class="btn small" data-rq="reject" data-id="${r.id}">Reject</button></div>` : ''}</div>`).join('')}` : ''}
    ${money ? `<h3>Credit and debit notes</h3>${adj.data.adjustments.map((a) => `<div class="card"><div class="row"><div><b>${esc(a.adj_no || String(a.kind).replace('_', ' '))}</b> · ${a.kind === 'debit_note' ? '+' : '−'}${moneyP(a.amount_paise + a.gst_paise)}<p class="muted">${esc(a.demand_label)} · ${esc(a.reason)}</p></div>${chip(a.status, adjTone[a.status])}</div>
      <div class="row-btns">${a.status === 'pending' && SALES_APPROVERS.includes(currentUser.role) && (a.created_by !== currentUser.id || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-adj="approve" data-id="${a.id}">Approve</button><button class="btn small" data-adj="reject" data-id="${a.id}">Reject</button>` : ''}
      ${a.status === 'approved' && SALES_APPROVERS.includes(currentUser.role) ? `<button class="btn small" data-adj="reverse" data-id="${a.id}">Reverse</button>` : ''}${a.adj_no ? `<button class="btn small" data-adjp="${a.id}">Print</button>` : ''}</div></div>`).join('') || '<p class="muted">None.</p>'}
      <div class="row-btns"><button class="btn small" id="adj-new">+ Credit / debit note</button></div>` : ''}
    <h3>Co-applicants</h3>${parties.data.parties.map((p) => `<div class="card"><div class="row"><div><b>${esc(p.name)}</b>${p.relation ? ' · ' + esc(p.relation) : ''}<p class="muted">${(p.share_bp / 100).toFixed(0)}% share${p.phone ? ' · ' + esc(p.phone) : ''}${p.pan_masked ? ' · PAN ' + esc(p.pan_masked) : ''}${p.aadhaar_masked ? ' · ' + esc(p.aadhaar_masked) : ''}</p></div>${sellers && currentUser.role === 'owner' ? `<button class="btn small" data-pdel="${p.id}">Remove</button>` : ''}</div></div>`).join('') || '<p class="muted">Only the main applicant.</p>'}
    ${sellers ? '<div class="row-btns"><button class="btn small" id="party-new">+ Add co-applicant</button></div>' : ''}
    <h3>Home loan</h3>${H.loans.map((l) => `<div class="card"><b>${esc(l.bank)}</b><p class="muted">Sanctioned ${moneyP(l.sanction_paise)}${l.sanction_date ? ' on ' + esc(l.sanction_date) : ''} · disbursed ${moneyP(l.disbursed_paise)}</p>${sellers ? `<button class="btn small" data-loan="${l.id}" data-san="${l.sanction_paise}" data-dis="${l.disbursed_paise}">Update disbursed</button>` : ''}</div>`).join('') || '<p class="muted">No loan recorded.</p>'}
    ${sellers ? '<div class="row-btns"><button class="btn small" id="loan-new">+ Add home loan</button></div>' : ''}
    <h3>Handover and possession</h3>${renderHandover(H, d)}`;
  ov.querySelector('.modal-actions').before(box);
  const again = () => { ov.remove(); bookingDetail(id); };
  const call = async (path, method, body, msg) => { const r = await act(api(path, { method, body: body || {} }), msg); if (r) again(); return r; };
  box.querySelectorAll('[data-rq]').forEach((b) => { b.onclick = async () => {
    let body = {}; if (b.dataset.rq === 'reject') { const v = await openForm({ title: 'Reject receipt', fields: [{ name: 'note', label: 'Why?', required: true }] }); if (!v) return; body = v; }
    const r = await act(api(`/api/sales/receipt-requests/${b.dataset.id}/${b.dataset.rq}`, { method: 'POST', body }), b.dataset.rq === 'approve' ? 'Receipt approved' : 'Rejected'); if (r) again();
  }; });
  box.querySelectorAll('[data-adj]').forEach((b) => { b.onclick = async () => {
    let body = {}; const k = b.dataset.adj;
    if (k === 'reject') { const v = await openForm({ title: 'Reject note', fields: [{ name: 'note', label: 'Why?', required: true }] }); if (!v) return; body = v; }
    if (k === 'reverse') { const v = await openForm({ title: 'Reverse note', intro: 'The payment stage goes back to what it was.', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (!v) return; body = v; }
    await call(`/api/sales/adjustments/${b.dataset.id}/${k}`, 'POST', body, 'Done');
  }; });
  box.querySelectorAll('[data-adjp]').forEach((b) => { b.onclick = () => openPrint('creditnote', b.dataset.adjp); });
  if ($('adj-new')) $('adj-new').onclick = async () => {
    const v = await openForm({ title: 'Credit / debit note', intro: 'A credit note lowers what the customer owes for a stage; a debit note adds to it. A manager has to approve it.', fields: [
      { name: 'demand_id', label: 'Payment stage', type: 'select', options: d.demands.map((x) => [x.id, `${x.label} (${moneyP(x.amount_paise)})`]) },
      { name: 'kind', label: 'Type', type: 'select', options: [['credit_note', 'Credit note (reduce)'], ['debit_note', 'Debit note (add)'], ['adjustment', 'Adjustment (reduce)']] },
      { name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true }, { name: 'gst_paise', label: 'GST on it (₹)', type: 'money' }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }] });
    if (v) await call(`/api/sales/bookings/${id}/adjustments`, 'POST', { ...v, demand_id: Number(v.demand_id), gst_paise: v.gst_paise || 0 }, 'Sent for approval');
  };
  if ($('party-new')) $('party-new').onclick = async () => {
    const v = await openForm({ title: 'Add co-applicant', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'relation', label: 'Relation (spouse, parent…)' }, { name: 'phone', label: 'Mobile' }, { name: 'share', label: 'Share (%)', type: 'number', value: 0 },
      { name: 'pan', label: 'PAN (kept private)' }, { name: 'aadhaar', label: 'Aadhaar (only the last 4 digits are kept)' }] });
    if (v) await call(`/api/sales/bookings/${id}/parties`, 'POST', { ...v, share_bp: Math.round((Number(v.share) || 0) * 100) }, 'Co-applicant added');
  };
  box.querySelectorAll('[data-pdel]').forEach((b) => { b.onclick = async () => { if (confirm('Remove this co-applicant?')) await call(`/api/sales/parties/${b.dataset.pdel}`, 'DELETE', null, 'Removed'); }; });
  if ($('loan-new')) $('loan-new').onclick = async () => {
    const v = await openForm({ title: 'Home loan', fields: [{ name: 'bank', label: 'Bank', required: true }, { name: 'sanction_paise', label: 'Sanctioned (₹)', type: 'money' }, { name: 'sanction_date', label: 'Sanction date', type: 'date' }, { name: 'disbursed_paise', label: 'Disbursed so far (₹)', type: 'money' }, { name: 'rm_name', label: 'Bank relationship manager' }, { name: 'rm_email', label: 'Relationship manager email', type: 'email' }, { name: 'rm_phone', label: 'Relationship manager mobile', type: 'tel' }, { name: 'coordinator_email', label: 'Bank project coordinator email (for escalation)', type: 'email' }] });
    if (v) await call(`/api/sales/bookings/${id}/loans`, 'POST', { ...v, sanction_paise: v.sanction_paise || 0, disbursed_paise: v.disbursed_paise || 0 }, 'Loan recorded');
  };
  box.querySelectorAll('[data-loan]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Update disbursement', fields: [{ name: 'disbursed_paise', label: 'Disbursed in total (₹)', type: 'money', value: (Number(b.dataset.dis) / 100).toFixed(2) }] });
    if (v) await call(`/api/sales/loans/${b.dataset.loan}`, 'POST', { disbursed_paise: v.disbursed_paise || 0 }, 'Updated');
  }; });
  // handover actions
  if ($('ho-open')) $('ho-open').onclick = () => call(`/api/sales/bookings/${id}/handover`, 'POST', {}, 'Handover opened');
  box.querySelectorAll('[data-hoi]').forEach((c) => { c.onchange = async () => { const r = await act(api(`/api/sales/handover-items/${c.dataset.hoi}`, { method: 'POST', body: { done: c.checked } })); if (!r) c.checked = !c.checked; }; });
  if ($('ho-details')) $('ho-details').onclick = async () => {
    const v = await openForm({ title: 'Possession details', fields: [{ name: 'possession_offered_on', label: 'Possession offered on', type: 'date', value: H.handover.possession_offered_on || '' }, { name: 'oc_reference', label: 'OC / occupation certificate reference', value: H.handover.oc_reference || '' }, { name: 'notes', label: 'Notes', type: 'textarea', value: H.handover.notes || '' }] });
    if (v) await call(`/api/sales/bookings/${id}/handover/details`, 'POST', { possession_offered_on: v.possession_offered_on || undefined, oc_reference: v.oc_reference, notes: v.notes }, 'Saved');
  };
  if ($('ho-snag')) $('ho-snag').onclick = async () => {
    const v = await openForm({ title: 'Snag in this flat', fields: [{ name: 'title', label: 'What is wrong?', required: true }, { name: 'location', label: 'Where in the flat' }, { name: 'severity', label: 'How serious?', type: 'select', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], value: 'medium' }] });
    if (v) await call('/api/site/snags', 'POST', { project_id: d.booking.project_id, unit_id: d.booking.unit_id, ...v }, 'Snag raised');
  };
  if ($('ho-done')) $('ho-done').onclick = async () => {
    if (!confirm('Mark this flat as handed over to the customer?')) return;
    const path = `/api/sales/bookings/${id}/handover/complete`;
    let r = null;
    try { r = await api(path, { method: 'POST' }); }
    catch (e) {
      // dues, snags or checklist still open: the PM (snags) or the Owner (dues) may go ahead with a written reason; no OC is a hard stop
      if (e.data && e.data.code === 'reason') { const v = await openForm({ title: 'Hand over anyway?', intro: e.message, fields: [{ name: 'override_note', label: 'Why go ahead now?', type: 'textarea', required: true }] }); if (v) r = await act(api(path, { method: 'POST', body: v })); }
      else toast(e.message, 8000);
    }
    if (r) { toast('Handed over'); again(); }
  };
};

function renderHandover(H, d) {
  const sellers = SALES_WORKERS.includes(currentUser.role);
  if (!H.handover) return d.booking.status === 'cancelled' ? '<p class="muted">Booking cancelled.</p>' : (sellers ? (H.can_open ? '<button class="btn small btn-primary" id="ho-open">Open handover checklist</button>' : '<p class="muted">Record the agreement date first (Agreement / registration dates), then the handover can be opened.</p>') : '<p class="muted">Not started.</p>');
  const h = H.handover, done = h.status === 'handed_over';
  return `<p>${done ? chip('Handed over on ' + (h.possession_given_on || ''), 'good') : chip('In progress', 'warn')}${h.possession_offered_on ? ` Possession offered ${esc(h.possession_offered_on)}.` : ''}${h.oc_reference ? ` OC ${esc(h.oc_reference)}.` : ''}</p>
    ${H.template_is_starter && !done ? '<p class="muted">Starter checklist: edit it in Settings to match your process, and confirm with your advocate. It is not a complete legal list.</p>' : ''}
    ${H.items.map((i) => `<label class="check" style="display:block;margin:6px 0"><input type="checkbox" data-hoi="${i.id}"${i.done ? ' checked' : ''}${done || !sellers ? ' disabled' : ''}> ${esc(i.label)}${i.done_on ? ` <span class="muted">(${esc(i.done_on)})</span>` : ''}</label>`).join('')}
    <p><b>Snags in this flat:</b> ${H.snags.length ? H.snags.map((s) => `${esc(s.title)} (${esc(s.status)})`).join('; ') : 'none'}</p>
    <div class="row-btns">${!done && sellers ? '<button class="btn small" id="ho-details">Possession details</button>' : ''}${!done && isRole('owner', 'pm') ? '<button class="btn small" id="ho-snag">+ Snag in this flat</button>' : ''}${!done && isRole('owner', 'pm') ? '<button class="btn small btn-primary" id="ho-done">Mark handed over</button>' : ''}</div>${!done && !isRole('owner', 'pm') ? '<p class="muted">The PM or the Owner gives possession, after the OC is approved.</p>' : ''}`;
}

// ---------- Sales page: receipts waiting, and the reports ----------
const _loadSalesWP11 = loadSales;
loadSales = async function () {
  await _loadSalesWP11();
  const el = $('sales-list'); if (!el || !SALES_MONEY.includes(currentUser.role)) return;
  let reqs = []; try { reqs = (await api('/api/sales/receipt-requests')).data.requests; } catch (e) { /* ignore */ }
  const top = document.createElement('div');
  top.innerHTML = `${reqs.length ? `<h3>Receipts waiting for approval (${reqs.length})</h3>${reqs.map((r) => `<div class="card clickable" data-rqbk="${r.booking_id}"><div class="row"><div><b>${moneyP(r.amount_paise)}</b> · ${esc(r.customer_name)} · ${esc(r.wing || '')}-${esc(r.unit_no)}<p class="muted">${esc(r.mode || '')} ${esc(r.ref_no || '')} · by ${esc(r.requested_by_name || '')}</p></div>${chip('Waiting', 'warn')}</div></div>`).join('')}` : ''}
    <div class="row-btns" style="margin:8px 0"><button class="btn small" id="rp-num">Numbering check</button><a class="btn small" href="/api/sales/reports/discounts?csv=1">Discounts given (CSV)</a><a class="btn small" href="/api/sales/reports/handovers?csv=1">Pending handovers (CSV)</a></div>`;
  el.prepend(top);
  top.querySelectorAll('[data-rqbk]').forEach((c) => { c.onclick = () => bookingDetail(c.dataset.rqbk); });
  $('rp-num').onclick = async () => {
    const v = await openForm({ title: 'Numbering check', intro: 'Lists every receipt, demand letter and credit note number issued this year and any numbers that are missing.', fields: [{ name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() }], submit: 'Download CSV' });
    if (v) window.location.href = `/api/sales/reports/numbering?project_id=${v.project_id}&csv=1`;
  };
};

// ---------- Minimum selling price (MSP): Owner only, from the flat card ----------
const _unitDrillMSP = unitDrill;
unitDrill = async function (u) {
  await _unitDrillMSP(u);
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || currentUser.role !== 'owner' || u.state === 'rehab' || u.state === 'landowner' || u.booking_id) return;
  const kv = ov.querySelector('.kv'); if (kv && u.msp_paise) kv.insertAdjacentHTML('beforeend', `<span>Minimum selling price</span><b>${moneyP(u.msp_paise)}</b>`);
  const row = ov.querySelector('.row-btns'); if (!row) return;
  if (u.state !== 'rehab') { const tg = document.createElement('button'); tg.className = 'btn small'; tg.textContent = 'Location tags (PLC)'; tg.onclick = async () => { const v = await openForm({ title: 'Location tags', intro: 'Words like garden, corner, road-facing, separated by commas. Each tag can carry a location charge in the Price list.', fields: [{ name: 'tags', label: 'Tags', value: u.plc_tags || '' }] }); if (v && await act(api(`/api/sales/inventory/${u.id}/tags`, { method: 'POST', body: v }), 'Saved')) { ov.remove(); } }; row.appendChild(tg); }
  const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Minimum price (MSP)';
  b.onclick = async () => {
    const v = await openForm({ title: 'Minimum selling price', intro: 'The lowest agreement value allowed for this flat. A cost sheet or booking below it needs your approval PIN. Leave blank to remove.', fields: [{ name: 'msp_paise', label: 'Minimum agreement value (₹)', type: 'money', value: u.msp_paise ? u.msp_paise / 100 : '' }, { name: 'reason', label: 'Reason', required: true }] });
    if (v && await act(api('/api/sales/msp', { method: 'POST', body: { unit_id: u.id, msp_paise: v.msp_paise === '' ? null : v.msp_paise, reason: v.reason } }), 'Saved')) { ov.remove(); loadStacking(); }
  };
  row.appendChild(b);
};
