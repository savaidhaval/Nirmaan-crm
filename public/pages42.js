// pages42.js — Module 5, step 2: floor-plan library, possession notice, buyer links (inspection, handover time, baseline), fit-out NOC,
// handover slots, complaint QR, debit note, society formation, common-area costs and the society statement, handover binder. Loaded after pages41.js.

// ---------- floor-plan library ----------
async function planLibrary(pid) {
  const d = (await act(api('/api/plans?project_id=' + pid)))?.data; if (!d) return;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const draw = () => { ov.querySelector('.modal').innerHTML = `<h2>Floor-plan library</h2><p class="help">One plan picture for each flat type. A snag raised inside a flat of that type opens the plan by itself, so you only tap the spot.</p>
    ${d.plans.length ? d.plans.map((p) => `<div class="row" style="margin:6px 0"><div><b>${esc(p.unit_type)}</b> <span class="muted">${esc(p.label || '')}</span></div><div><a class="btn small" target="_blank" rel="noopener" href="/api/files/download/${p.doc_id}">View</a> ${['owner', 'pm'].includes(currentUser.role) ? `<button class="btn small" data-rm="${p.id}">Remove</button>` : ''}</div></div>`).join('') : '<p class="muted">No plans yet.</p>'}
    <div class="modal-actions"><button class="btn" id="pl-add">Add or replace a plan</button><button class="btn btn-primary" id="pl-close">Close</button></div>`;
    ov.querySelector('#pl-close').onclick = () => ov.remove();
    ov.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { if (await act(api('/api/plans/' + b.dataset.rm, { method: 'DELETE' }), 'Removed')) { d.plans = d.plans.filter((x) => x.id !== Number(b.dataset.rm)); draw(); } }; });
    ov.querySelector('#pl-add').onclick = async () => {
      const v = await openForm({ title: 'Add a floor plan', fields: [{ name: 'unit_type', label: 'Flat type', type: 'select', options: (d.unit_types.length ? d.unit_types : ['1BHK', '2BHK', '3BHK']).map((t) => [t, t]) }, { name: 'file', label: 'Plan picture', type: 'file', required: true }] });
      if (!v) return; const doc = await uploadDoc41(v.file, pid, 'Floor plan ' + v.unit_type, { category: 'drawing', module: 'site' }); if (!doc) return;
      if (await act(api('/api/plans', { method: 'POST', body: { project_id: pid, unit_type: v.unit_type, doc_id: doc } }), 'Saved')) { const f = (await api('/api/plans?project_id=' + pid)).data; d.plans = f.plans; draw(); }
    };
  };
  ov.innerHTML = '<div class="modal"></div>'; document.body.appendChild(ov); draw();
}

// a snag inside a flat takes the plan from the library
const _snagAssign42 = snagAssign;
snagAssign = async function (s) {
  if (s.unit_id && !s.plan_doc_id) {
    try { const r = (await api('/api/plans/for-unit?unit_id=' + s.unit_id)).data; if (r.doc_id) s = { ...s, plan_doc_id: r.doc_id }; } catch (e) { /* no library plan */ }
  }
  return _snagAssign42(s);
};
const _renderSnags42 = renderSnags;
renderSnags = async function (main) {
  await _renderSnags42(main);
  const pid = scopeProject || await proj41(); if (!pid || main.querySelector('#sn-lib') || !userCanClient('site', 'E')) return;
  const h1 = main.querySelector('h1'); if (h1) h1.insertAdjacentHTML('afterend', '<p><button class="btn small" id="sn-lib">Floor-plan library</button></p>');
  const b = main.querySelector('#sn-lib'); if (b) b.onclick = () => planLibrary(pid);
};
PAGES.snags = (m) => renderSnags(m);

// ---------- booking: possession notice, buyer links, fit-out ----------
const waText42 = (kind, d, url) => ({ inspection: `Dear ${d.customer}, please inspect your flat ${d.flat} and sign the joint inspection report here: ${url}`, slot: `Dear ${d.customer}, your flat ${d.flat} is ready for handover. Please choose a time to collect your keys: ${url}`, baseline: `Dear ${d.customer}, please confirm the condition photographs of your flat ${d.flat} here: ${url}` }[kind]);
const _bookingDetail42 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail42(id);
  if (!['owner', 'pm', 'accounts', 'sales'].includes(currentUser.role)) return;
  const ov = [...document.querySelectorAll('.modal-overlay')].pop(); if (!ov || ov.querySelector('#fo-box')) return;
  const modal = ov.querySelector('.modal'); if (!modal) return;
  let bk; try { bk = (await api('/api/sales/bookings/' + id)).data.booking; } catch (e) { return; }
  const box = document.createElement('div'); box.className = 'card'; box.id = 'fo-box'; box.innerHTML = '<b>Handover steps</b><p class="muted">Loading…</p>';
  const anchor = modal.querySelector('#nd-box'); modal.insertBefore(box, anchor ? anchor.nextSibling : modal.querySelector('.modal-actions'));
  const draw = async () => {
    let f; try { f = (await api(`/api/sales/bookings/${id}/fitout`)).data; } catch (e) { box.remove(); return; }
    const ho = f.handover; if (!ho) { box.innerHTML = '<b>Handover steps</b><p class="muted">Open the handover first (Possession &amp; handover).</p>'; return; }
    const done = ho.status === 'handed_over', mgr = ['owner', 'pm'].includes(currentUser.role), money = ['owner', 'pm', 'accounts'].includes(currentUser.role);
    box.innerHTML = `<b>Handover steps</b>
      <p class="muted">Possession notice: ${ho.notice_on ? 'issued ' + esc(ho.notice_on) + ', pay by ' + esc(ho.notice_due_on) : 'not issued'} · Joint inspection: ${ho.inspection_on ? 'signed ' + esc(ho.inspection_on) + ' by ' + esc(ho.inspection_name) : 'not done'} · Handover time: ${f.slot ? esc(f.slot.slot_on) + ' ' + esc(f.slot.start_time) : 'not chosen'}</p>
      <div class="row-btns">${money && !done ? '<button class="btn small" data-pn="1">' + (ho.notice_on ? 'Re-issue possession notice' : 'Issue possession notice') + '</button>' : ''}${ho.notice_on ? '<button class="btn small" data-pnp="1">Print notice</button>' : ''}</div>
      ${!done ? `<div class="row-btns" style="margin-top:6px"><button class="btn small" data-hv="inspection">Joint inspection link</button><button class="btn small" data-hv="slot">Handover time link</button></div>` : ''}
      <hr><b>After possession: fit-out</b>
      <p class="muted">Baseline photos: ${f.photos.length}${ho.baseline_signed_on ? ' · signed by ' + esc(ho.baseline_signed_name) + ' on ' + esc(String(ho.baseline_signed_on).slice(0, 10)) : ' · buyer has not signed'} · Fit-out deposit: due ${moneyP(f.deposit.due)}, held ${moneyP(f.deposit.received - f.deposit.refunded)}</p>
      <div class="row-btns"><button class="btn small" data-bl="photo">Add baseline photo</button><button class="btn small" data-hv="baseline">Baseline sign-off link</button>${done && mgr && !f.noc ? '<button class="btn small btn-primary" data-noc="1">Issue fit-out NOC</button>' : ''}${f.noc ? `<button class="btn small btn-primary" data-nocp="1">${esc(f.noc.noc_no)} ${f.noc.status === 'revoked' ? '(revoked)' : ''} Print</button>` : ''}${f.noc && f.noc.status === 'issued' && currentUser.role === 'owner' ? '<button class="btn small" data-nocr="1">Revoke NOC</button>' : ''}</div>`;
    const pn = box.querySelector('[data-pn]');
    if (pn) pn.onclick = async () => { const v = await openForm({ title: 'Possession notice', intro: 'The notice lists the final instalment and the corpus, maintenance and share money you have set for this flat.', fields: [{ name: 'pay_by', label: 'Pay by (date)', type: 'date', value: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }] }); if (v && await act(api(`/api/sales/bookings/${id}/possession-notice`, { method: 'POST', body: v }), 'Issued')) { draw(); openPrint('possnotice', id); } };
    const pp = box.querySelector('[data-pnp]'); if (pp) pp.onclick = () => openPrint('possnotice', id);
    box.querySelectorAll('[data-hv]').forEach((b) => { b.onclick = async () => {
      const kind = b.dataset.hv;
      const v = await openForm({ title: 'Send to the buyer', intro: 'The link works for a few days. Choose how to send it.', fields: [{ name: 'how', label: 'Send by', type: 'select', options: [['wa', 'WhatsApp'], ['mail', bk.email ? 'Email (' + bk.email + ')' : 'Email (no address on file)'], ['copy', 'Copy the link']] }], submit: 'Go' });
      if (!v) return;
      const r = await act(api(`/api/sales/bookings/${id}/hv-link`, { method: 'POST', body: { kind, send_email: v.how === 'mail' } }), v.how === 'mail' ? '' : ''); if (!r) return;
      const d = { customer: String(bk.customer_name).split(' ')[0], flat: (bk.wing ? bk.wing + '-' : '') + bk.unit_no };
      if (v.how === 'wa') window.open(waLink(bk.phone, waText42(kind, d, r.data.url)), '_blank', 'noopener');
      else if (v.how === 'copy') copyText(r.data.url);
      else toast(r.data.emailed ? 'Emailed' : 'The email could not be sent. Check Email settings.', 5000);
    }; });
    const bl = box.querySelector('[data-bl]'); if (bl) bl.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = async () => { if (!inp.files[0]) return; if (await uploadDoc41(inp.files[0], bk.project_id, 'Baseline photo', { category: 'other', module: 'sales', entity: 'sal_handover', entity_id: ho.id })) { toast('Photo added', 3000); draw(); } }; inp.click(); };
    const noc = box.querySelector('[data-noc]'); if (noc) noc.onclick = async () => { const v = await openForm({ title: 'Fit-out NOC', intro: 'Allowed once the fit-out deposit is received and the buyer has signed the baseline.', fields: [{ name: 'valid_till', label: 'Valid till (optional)', type: 'date' }, { name: 'note', label: 'Conditions (optional)' }] }); if (v && await act(api(`/api/sales/bookings/${id}/fitout-noc`, { method: 'POST', body: v }), 'Issued')) { draw(); openPrint('fitoutnoc', id); } };
    const np = box.querySelector('[data-nocp]'); if (np) np.onclick = () => openPrint('fitoutnoc', id);
    const nr = box.querySelector('[data-nocr]'); if (nr) nr.onclick = async () => { const v = await openForm({ title: 'Revoke the NOC', fields: [{ name: 'reason', label: 'Why', required: true }] }); if (v && await act(api(`/api/sales/bookings/${id}/fitout-noc/revoke`, { method: 'POST', body: v }), 'Revoked')) draw(); };
  };
  draw();
};

// ---------- handover slots (Possession & handover screen) ----------
const _renderPossession42 = renderPossession;
renderPossession = async function (main) {
  await _renderPossession42(main);
  const pid = scopeProject || await proj41(); if (!pid || main.querySelector('#hs-open') || !['owner', 'pm', 'sales'].includes(currentUser.role)) return;
  const h1 = main.querySelector('h1'); if (h1) h1.insertAdjacentHTML('afterend', '<p><button class="btn small" id="hs-open">Handover time slots</button></p>');
  main.querySelector('#hs-open').onclick = async () => {
    const ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.innerHTML = '<div class="modal"></div>'; document.body.appendChild(ov);
    const draw = async () => {
      const d = (await act(api('/api/sales/slots?project_id=' + pid)))?.data; if (!d) { ov.remove(); return; }
      const days = {}; d.slots.forEach((s) => { (days[s.slot_on] = days[s.slot_on] || []).push(s); });
      ov.querySelector('.modal').innerHTML = `<h2>Handover time slots</h2><p class="help">Add the times you will hand over keys. A buyer whose six no-dues points are green picks one from a link.</p>
        ${Object.entries(days).map(([day, ss]) => `<h3>${esc(day)}</h3>${ss.map((s) => `<p style="margin:3px 0">${esc(s.start_time)}–${esc(s.end_time)} ${s.booking_id ? '· <b>' + esc(s.flat) + '</b> ' + esc(s.customer_name) : chip('free', 'good') + ` <button class="btn small" data-del="${s.id}">Remove</button>`}</p>`).join('')}`).join('') || '<p class="muted">No slots yet.</p>'}
        <div class="modal-actions"><button class="btn" id="hs-add">Add a day</button><button class="btn btn-primary" id="hs-close">Close</button></div>`;
      ov.querySelector('#hs-close').onclick = () => ov.remove();
      ov.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (await act(api('/api/sales/slots/' + b.dataset.del, { method: 'DELETE' }))) draw(); }; });
      ov.querySelector('#hs-add').onclick = async () => { const v = await openForm({ title: 'Add slots for a day', fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'start', label: 'From (24-hour, e.g. 10:00)', value: '10:00', required: true }, { name: 'end', label: 'Until (e.g. 16:00)', value: '16:00', required: true }, { name: 'minutes', label: 'Minutes for each buyer', type: 'number', value: 45 }] }); if (v && await act(api('/api/sales/slots', { method: 'POST', body: { ...v, project_id: pid } }), 'Added')) draw(); };
    };
    draw();
  };
};
PAGES.possession = (m) => renderPossession(m);

// ---------- defect helpdesk: complaint QR, debit note ----------
const _renderDlp42 = renderDlp;
renderDlp = async function (main) {
  await _renderDlp42(main);
  const pid = scopeProject || await proj41(); if (!pid) return;
  if (!main.querySelector('#dlp-qr')) { const h1 = main.querySelector('h1'); if (h1) h1.insertAdjacentHTML('afterend', '<p><button class="btn small" id="dlp-qr">Complaint QR for residents</button></p>'); }
  const q = main.querySelector('#dlp-qr');
  if (q) q.onclick = async () => {
    const d = (await act(api('/api/dlp/qr-link?project_id=' + pid)))?.data; if (!d) return;
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal" style="text-align:center"><h2>Report a problem: ${esc(d.project)}</h2><div style="display:inline-block">${qrSvg(d.url, 260)}</div><p>Scan to report a problem</p><p class="muted" style="word-break:break-all">${esc(d.url)}</p>${d.email ? `<p>or email <b>${esc(d.email)}</b>${d.phone ? ' · call ' + esc(d.phone) : ''}</p>` : ''}${d.live ? '' : '<p class="error">The form is switched off until Turnstile is set up (same as the enquiry form).</p>'}<div class="modal-actions"><button class="btn" id="qr-copy">Copy link</button><button class="btn" id="qr-print">Print poster</button><button class="btn btn-primary" id="qr-close">Close</button></div></div>`;
    document.body.appendChild(ov); ov.querySelector('#qr-close').onclick = () => ov.remove(); ov.querySelector('#qr-copy').onclick = () => copyText(d.url); ov.querySelector('#qr-print').onclick = () => window.print();
  };
  main.querySelectorAll('[data-bcc]').forEach(() => { /* handled by step 1 */ });
  // a numbered debit note once the back-charge is confirmed
  const list = (await api('/api/dlp/tickets?project_id=' + pid).catch(() => null))?.data?.tickets || [];
  main.querySelectorAll('.card').forEach((card) => {
    const t = list.find((x) => card.textContent.includes(x.title) && x.backcharge_status === 'cleared' && x.debit_no); if (!t || card.querySelector('[data-dn]')) return;
    const row = card.querySelector('.row-btns'); if (row) row.insertAdjacentHTML('beforeend', `<button class="btn small btn-primary" data-dn="${t.id}">Debit note ${esc(t.debit_no)}</button>`);
    card.querySelector('[data-dn]').onclick = () => openPrint('dlpdebit', t.id);
  });
};
PAGES.dlp = (m) => renderDlp(m);

// ---------- society handover vault: formation, costs and statement, binder ----------
const _renderChsVault42 = renderChsVault;
renderChsVault = async function (main) {
  await _renderChsVault42(main);
  const pid = await proj41(); if (!pid) return;
  const edit = ['owner', 'pm'].includes(currentUser.role), money = ['owner', 'pm', 'accounts'].includes(currentUser.role);
  const wrap = document.createElement('div'); wrap.id = 'chs-more'; main.appendChild(wrap);
  const draw = async () => {
    let so, ex, st = null;
    try { so = (await api('/api/chs/society?project_id=' + pid)).data; } catch (e) { wrap.innerHTML = ''; return; }
    if (money) { try { ex = (await api('/api/chs/expenses?project_id=' + pid)).data; st = (await api('/api/chs/statement?project_id=' + pid)).data; } catch (e) { /* not allowed */ } }
    const s = so.society;
    wrap.innerHTML = `<h3>Society formation</h3><div class="card"><p>${chip(s.stage, s.stage === 'registered' ? 'good' : 'warn')} <b>${esc(s.society_name || 'Society name not entered')}</b></p>
      <p class="muted">${s.registration_no ? 'Registration ' + esc(s.registration_no) + ' on ' + esc(s.registered_on || '') : 'Not registered yet'} · Share certificates: ${s.share_cert_count || 0}${s.shares_issued_on ? ' (issued ' + esc(s.shares_issued_on) + ')' : ''} · ${s.conveyance_on ? 'Conveyance ' + esc(s.conveyance_on) + ' (' + esc(s.conveyance_ref || '') + ')' : 'Conveyance not done'}</p>
      <p class="muted">Committee: ${so.committee.length ? so.committee.map((c) => `${esc(c.role)} ${esc(c.name)}${edit ? ` <a href="#" data-cmr="${c.id}">remove</a>` : ''}`).join(' · ') : 'not entered'}</p>
      ${edit ? '<div class="row-btns"><button class="btn small" id="so-edit">Update the society</button><button class="btn small" id="so-cm">Add a committee member</button></div>' : ''}</div>
      ${money ? `<h3>Common-area costs and the society statement</h3><div class="card">${st ? `<p>Advance maintenance collected <b>${moneyP(st.maintenance_collected_paise)}</b> · Costs certified by the CA <b>${moneyP(st.certified_paise)}</b> · <b>Balance to hand over ${moneyP(st.balance_to_hand_over_paise)}</b></p>${st.uncertified_paise ? `<p class="muted">${moneyP(st.uncertified_paise)} of costs are not yet certified and are not deducted.</p>` : ''}<p class="muted">Corpus held for the society: ${moneyP(st.corpus_held_paise)} · Share money: ${moneyP(st.share_money_paise)}</p>` : ''}
        ${ex ? ex.expenses.slice(0, 12).map((x) => `<p style="margin:4px 0" class="${x.reversed_at ? 'muted' : ''}">${esc(x.spent_on)} · ${esc(ex.heads[x.head] || x.head)} · ${moneyP(x.amount_paise)} · bill ${esc(x.bill_no)} ${x.reversed_at ? chip('reversed', '') : x.certified_on ? chip('certified by ' + x.certified_by_name, 'good') : (['owner', 'accounts'].includes(currentUser.role) ? `<button class="btn small" data-cert="${x.id}">CA certified</button>` : chip('not certified', 'warn'))}${currentUser.role === 'owner' && !x.reversed_at ? ` <button class="btn small" data-xr="${x.id}">Reverse</button>` : ''}</p>`).join('') : ''}
        <div class="row-btns"><button class="btn small" id="ex-add">Enter a cost</button><button class="btn small" id="ex-print">Print statement</button><a class="btn small" href="/api/chs/statement?project_id=${pid}&csv=1" download>Download (CSV)</a></div></div>` : ''}
      <h3>Handover binder</h3><div class="card"><p class="muted">One download with every file in the vault, an index page with links, and the society ledger.</p><button class="btn small btn-primary" id="binder">Download the binder (ZIP)</button><span id="binder-msg" class="muted"></span></div>`;
    const sel = (id) => wrap.querySelector(id);
    if (sel('#so-edit')) sel('#so-edit').onclick = async () => {
      const v = await openForm({ title: 'Society', fields: [{ name: 'society_name', label: 'Society name', value: s.society_name || '' }, { name: 'stage', label: 'Stage', type: 'select', value: s.stage, options: [['proposed', 'Proposed'], ['provisional', 'Provisional'], ['registered', 'Registered']] }, { name: 'registration_no', label: 'Registration number', value: s.registration_no || '' }, { name: 'registered_on', label: 'Registered on', type: 'date', value: s.registered_on || '' }, { name: 'share_cert_count', label: 'Share certificates issued', type: 'number', value: s.share_cert_count || 0 }, { name: 'shares_issued_on', label: 'Share certificates date', type: 'date', value: s.shares_issued_on || '' }, { name: 'conveyance_on', label: 'Conveyance deed date (after registration)', type: 'date', value: s.conveyance_on || '' }, { name: 'conveyance_ref', label: 'Conveyance deed registration reference', value: s.conveyance_ref || '' }, { name: 'notes', label: 'Notes', type: 'textarea', value: s.notes || '' }] });
      if (v && await act(api('/api/chs/society', { method: 'PUT', body: { ...v, project_id: pid } }), 'Saved')) draw(); };
    if (sel('#so-cm')) sel('#so-cm').onclick = async () => { const v = await openForm({ title: 'Committee member', fields: [{ name: 'role', label: 'Role', type: 'select', options: [['chairman', 'Chairman'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer'], ['member', 'Member']] }, { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Mobile' }, { name: 'since', label: 'Since', type: 'date' }] }); if (v && await act(api('/api/chs/committee', { method: 'POST', body: { ...v, project_id: pid } }), 'Added')) draw(); };
    wrap.querySelectorAll('[data-cmr]').forEach((a) => { a.onclick = async (e) => { e.preventDefault(); if (await act(api('/api/chs/committee/' + a.dataset.cmr, { method: 'DELETE' }), 'Removed')) draw(); }; });
    if (sel('#ex-add')) sel('#ex-add').onclick = async () => { const v = await openForm({ title: 'Common-area cost', intro: 'A cost you paid during the period before the society took over.', fields: [{ name: 'head', label: 'For', type: 'select', options: Object.entries(ex ? ex.heads : {}) }, { name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true }, { name: 'bill_no', label: 'Bill / voucher number', required: true }, { name: 'paid_to', label: 'Paid to' }, { name: 'spent_on', label: 'Date', type: 'date', value: new Date().toISOString().slice(0, 10) }] }); if (v && await act(api('/api/chs/expenses', { method: 'POST', body: { ...v, project_id: pid } }), 'Saved')) draw(); };
    if (sel('#ex-print')) sel('#ex-print').onclick = () => openPrint('chsstatement', pid);
    wrap.querySelectorAll('[data-cert]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Certified by the CA', fields: [{ name: 'certified_by_name', label: "CA's name", required: true }] }); if (v && await act(api(`/api/chs/expenses/${b.dataset.cert}/certify`, { method: 'POST', body: v }), 'Recorded')) draw(); }; });
    wrap.querySelectorAll('[data-xr]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Reverse this cost', fields: [{ name: 'reason', label: 'Why', required: true }] }); if (v && await act(api(`/api/chs/expenses/${b.dataset.xr}/reverse`, { method: 'POST', body: v }), 'Reversed')) draw(); }; });
    sel('#binder').onclick = () => handoverBinder(pid, sel('#binder-msg'));
  };
  draw();
};
PAGES.chsvault = (m) => renderChsVault(m);

// The binder is built in the browser (free plan): every vault file, an index.html with links, and the ledger as CSV.
async function handoverBinder(pid, msgEl) {
  const say = (t) => { if (msgEl) msgEl.textContent = ' ' + t; };
  try {
    const v = (await api('/api/chs/vault?project_id=' + pid)).data; const enc = new TextEncoder(); const files = []; const used = new Set(); const rows = [];
    let n = 0; for (const it of v.items) {
      if (!it.document_id) { rows.push(`<tr><td>${esc(it.label)}</td><td><b>NOT UPLOADED</b></td><td></td></tr>`); continue; }
      say(`Fetching ${++n} of ${v.items.filter((x) => x.document_id).length}…`);
      const r = await fetch('/api/files/download/' + it.document_id, { credentials: 'include' }); if (!r.ok) { rows.push(`<tr><td>${esc(it.label)}</td><td>could not be fetched</td><td></td></tr>`); continue; }
      const ct = r.headers.get('content-type') || ''; const ext = /pdf/.test(ct) ? '.pdf' : /png/.test(ct) ? '.png' : /jpe?g/.test(ct) ? '.jpg' : /wordprocessing/.test(ct) ? '.docx' : /spreadsheet/.test(ct) ? '.xlsx' : '';
      let name = (String(n).padStart(2, '0') + ' ' + it.label).replace(/[^\w\- .()]/g, '_').slice(0, 80) + ext; while (used.has(name)) name = '_' + name; used.add(name);
      files.push({ name: 'files/' + name, data: new Uint8Array(await r.arrayBuffer()) });
      rows.push(`<tr><td>${esc(it.label)}</td><td><a href="files/${encodeURIComponent(name)}">${esc(name)}</a></td><td>${it.ack_on ? 'Acknowledged by ' + esc(it.ack_by_name) + ' on ' + esc(it.ack_on) : 'Not acknowledged'}${it.valid_till ? ' · valid till ' + esc(it.valid_till) : ''}</td></tr>`);
    }
    let so = null; try { so = (await api('/api/chs/society?project_id=' + pid)).data; } catch (e) { /* ignore */ }
    try { const r = await fetch(`/api/sales/possession-funds-report?project_id=${pid}&csv=1`, { credentials: 'include' }); if (r.ok) files.push({ name: 'society-money-ledger.csv', data: new Uint8Array(await r.arrayBuffer()) }); } catch (e) { /* ignore */ }
    try { const r = await fetch(`/api/chs/statement?project_id=${pid}&csv=1`, { credentials: 'include' }); if (r.ok) files.push({ name: 'society-statement.csv', data: new Uint8Array(await r.arrayBuffer()) }); } catch (e) { /* ignore */ }
    const index = `<!doctype html><meta charset="utf-8"><title>Society handover binder</title><body style="font-family:sans-serif;max-width:900px;margin:24px auto"><h1>Society handover binder</h1><p>${esc(so && so.society.society_name || '')} ${so && so.society.registration_no ? '· Registration ' + esc(so.society.registration_no) : ''}<br>Prepared on ${new Date().toLocaleDateString('en-IN')}</p><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%"><tr><th>Item</th><th>File</th><th>Status</th></tr>${rows.join('')}</table><p><a href="society-money-ledger.csv">Society money ledger</a> · <a href="society-statement.csv">Society statement</a></p></body>`;
    files.unshift({ name: 'index.html', data: enc.encode(index) });
    const zip = DocxLib.zipStore(files); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = 'society-handover-binder.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    say('Downloaded.');
  } catch (e) { say(''); toast(e.message || 'The binder could not be made.', 6000); }
}
