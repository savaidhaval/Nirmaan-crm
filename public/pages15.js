// pages15.js — Redevelopment: societies, members and the consent meter (WP-1), rehab flats, transit rent, corpus (WP-2), meetings (WP-3).

const _sidebarItems15 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems15(role).map((g) => [g[0], g[1].slice()]);
  if (['owner', 'pm', 'accounts', 'viewer'].includes(role)) {
    const g = groups.find((x) => x[0] === 'Work') || groups.find((x) => x[0] === null);
    if (g) g[1].push({ label: 'Redevelopment', route: 'redevelopment', icon: 'redevelopment' });
  }
  return groups;
};

const RD_NOTE = 'Record only. Confirm the required majority and every procedure with your advocate.';
const rdPct = (bp) => (bp / 100).toFixed(bp % 100 ? 1 : 0);
const rdMeter = (c, title) => `<div class="card"><p style="font-size:1.2em"><b>${c.consented} of ${c.total} ${c.basis === 'area' ? 'by carpet area' : 'members'} = ${rdPct(c.pct_bp)}%</b></p>
  ${CH.meter(c.pct_bp, 10000, { text: `Threshold ${rdPct(c.threshold_bp)}%: ${c.reached ? 'reached' : 'not reached'}` })}<p>${c.reached ? chip('Threshold reached', 'good') : chip('Not reached yet', 'warn')} <span class="muted">${c.declined} declined · ${c.pending} pending</span></p></div>`;
const rdState = (s) => s ? chip(s, { paid: 'good', due: 'info', overdue: 'bad', partial: 'warn' }[s]) : chip('not scheduled', '');
let RD = { soc: null, tab: 'members', page: 1, q: '', st: '' };

async function renderRedevelopment(main) {
  RD = { soc: null, tab: 'members', page: 1, q: '', st: '' };
  main.innerHTML = '<h1>Redevelopment</h1><div id="rd-body">Loading...</div>';
  rdList();
}

async function rdList() {
  const body = $('rd-body'); if (!body) return;
  try {
    const list = (await api('/api/redev/societies')).data.societies, canAdd = isRole('owner', 'pm');
    body.innerHTML = `<p class="help">Societies and their members. The meter shows how many have given consent. ${esc(RD_NOTE)}</p>
      ${canAdd ? '<button class="btn btn-primary btn-full" id="rd-new">+ New society</button>' : ''}
      ${list.map((s) => `<div class="card" data-soc="${s.id}" style="cursor:pointer"><h3>${esc(s.name)}</h3><p class="muted">${esc(s.project_name)} · ${s.total} members</p>
        ${CH.meter(s.pct_bp, 10000, { text: `${s.consented} of ${s.total} = ${rdPct(s.pct_bp)}% (need ${rdPct(s.consent_threshold_bp)}%)` })}<p>${s.total ? (s.reached ? chip('Threshold reached', 'good') : chip('Not reached yet', 'warn')) : chip('No members yet', '')}</p></div>`).join('') || '<div class="empty-state"><p>No society added yet. Add one to start recording consent.</p></div>'}
      <div class="row-btns"><a class="btn small" href="/api/redev/report?csv=1">Consent report (Excel)</a></div>`;
    body.querySelectorAll('[data-soc]').forEach((c) => { c.onclick = () => rdOpen(Number(c.dataset.soc)); });
    if ($('rd-new')) $('rd-new').onclick = async () => {
      const projects = (await getProjects()).filter((p) => p.type === 'redevelopment');
      if (!projects.length) { toast('First set a project\'s type to Redevelopment in Projects.', 6000); return; }
      const v = await openForm({ title: 'New society', fields: [{ name: 'project_id', label: 'Project', type: 'select', options: projects.map((p) => [p.id, p.name]) }, { name: 'name', label: 'Society name', required: true }, { name: 'registration_no', label: 'Registration number' }, { name: 'address', label: 'Address' },
        { name: 'consent_threshold_pct', label: 'Consent needed (%)', type: 'number', value: 51, help: RD_NOTE }, { name: 'count_basis', label: 'Count by', type: 'select', options: [['members', 'Number of members'], ['area', 'Carpet area']] }] });
      if (v && await act(api('/api/redev/societies', { method: 'POST', body: v }), 'Society added')) rdList();
    };
  } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

async function rdOpen(id) { RD.soc = id; RD.tab = 'members'; RD.page = 1; RD.q = ''; RD.st = ''; rdDetail(); }

async function rdDetail() {
  const body = $('rd-body'); if (!body) return;
  try {
    const d = (await api(`/api/redev/societies/${RD.soc}`)).data; RD.d = d;
    const tabs = [['members', 'Members'], ['followup', 'Follow-up & log'], ['rehab', 'Rehab flats'], ['rent', 'Transit rent'], ['corpus', 'Corpus'], ['meetings', 'Meetings']];
    body.innerHTML = `<button class="btn small" id="rd-back">← All societies</button><h2>${esc(d.society.name)}</h2><p class="muted">${esc(d.society.project_name)}${d.society.registration_no ? ' · ' + esc(d.society.registration_no) : ''}</p>
      <div id="rd-meter">${rdMeter(d.consent)}</div><p class="muted">${esc(d.legal_note)}</p>
      ${isRole('owner', 'pm') ? '<button class="btn small" id="rd-edit">Change threshold or counting</button>' : ''}
      <div class="row-btns" id="rd-tabs">${tabs.map(([k, l]) => `<button class="btn small ${RD.tab === k ? 'btn-primary' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="rd-pane">Loading...</div>`;
    $('rd-back').onclick = () => { RD.soc = null; rdList(); };
    body.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { RD.tab = b.dataset.tab; RD.page = 1; rdDetail(); }; });
    if ($('rd-edit')) $('rd-edit').onclick = async () => {
      const s = d.society; const v = await openForm({ title: 'Consent rule', intro: RD_NOTE, fields: [{ name: 'consent_threshold_pct', label: 'Consent needed (%)', type: 'number', value: s.consent_threshold_bp / 100 }, { name: 'count_basis', label: 'Count by', type: 'select', value: s.count_basis, options: [['members', 'Number of members'], ['area', 'Carpet area']] }] });
      if (v && await act(api(`/api/redev/societies/${s.id}`, { method: 'PUT', body: v }), 'Saved')) rdDetail();
    };
    ({ members: rdMembers, followup: rdFollowup, rehab: rdRehab, rent: rdRent, corpus: rdCorpus, meetings: rdMeetings })[RD.tab]($('rd-pane'));
  } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

async function rdRefreshMeter() { const d = (await api(`/api/redev/societies/${RD.soc}`)).data; RD.d = d; if ($('rd-meter')) $('rd-meter').innerHTML = rdMeter(d.consent); }

// ---------- members ----------
async function rdMembers(pane) {
  const canE = isRole('owner', 'pm');
  const r = (await api(`/api/redev/societies/${RD.soc}/members?page=${RD.page}&q=${encodeURIComponent(RD.q)}&status=${RD.st}`)).data;
  const pages = Math.max(1, Math.ceil(r.total / r.page_size));
  pane.innerHTML = `<div class="grid"><div class="field"><label>Search flat or name</label><input id="rd-q" value="${esc(RD.q)}"></div><div class="field"><label>Show</label><select id="rd-st"><option value="">Everyone</option><option value="pending">Pending</option><option value="consented">Consented</option><option value="declined">Declined</option></select></div></div>
    ${canE ? '<div class="row-btns"><button class="btn btn-primary" id="rd-add">+ Add member</button><button class="btn" id="rd-paste">Paste a list</button></div>' : ''}
    ${r.members.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.member_name)}</b> · ${esc((m.wing ? m.wing + '-' : '') + m.unit_label)}<p class="muted">${esc(m.member_type)}${m.carpet_sqft ? ' · ' + m.carpet_sqft + ' sq ft' : ''}${m.phone ? ' · ' + esc(m.phone) : ''}</p></div>${chip(m.consent_status, { consented: 'good', declined: 'bad', pending: 'warn' }[m.consent_status])}</div>
      ${canE ? `<div class="row-btns">${['consented', 'declined', 'pending'].map((s) => `<button class="btn small ${m.consent_status === s ? 'btn-primary' : ''}" data-cs="${m.id}:${s}">${s === 'consented' ? 'Consented' : s === 'declined' ? 'Declined' : 'Pending'}</button>`).join('')}
        ${RD.d.checklist.length ? `<button class="btn small" data-docs="${m.id}">Documents</button>` : ''}<button class="btn small" data-rm="${m.id}">Remove</button></div>` : ''}</div>`).join('') || '<div class="empty-state"><p>No members yet. Add one, or paste a list.</p></div>'}
    <div class="row-btns"><button class="btn small" id="rd-prev"${RD.page <= 1 ? ' disabled' : ''}>← Previous</button><span class="muted">Page ${r.page} of ${pages} · ${r.total} members</span><button class="btn small" id="rd-next"${RD.page >= pages ? ' disabled' : ''}>Next →</button></div>`;
  $('rd-st').value = RD.st;
  $('rd-q').onchange = () => { RD.q = $('rd-q').value; RD.page = 1; rdMembers(pane); };
  $('rd-st').onchange = () => { RD.st = $('rd-st').value; RD.page = 1; rdMembers(pane); };
  $('rd-prev').onclick = () => { RD.page--; rdMembers(pane); }; $('rd-next').onclick = () => { RD.page++; rdMembers(pane); };
  pane.querySelectorAll('[data-cs]').forEach((b) => { b.onclick = async () => {
    const [id, st] = b.dataset.cs.split(':'); let note = '';
    if (st === 'declined') { const v = await openForm({ title: 'Why declined? (optional)', fields: [{ name: 'note', label: 'Reason', type: 'textarea' }] }); if (!v) return; note = v.note; }
    const res = await act(api(`/api/redev/members/${id}/consent`, { method: 'POST', body: { status: st, note } }));
    if (res) { if (res.data.crossed === 'reached') toast('Consent threshold reached. The Owner and PM have been told.', 6000); else if (res.data.crossed === 'dropped_below') toast('Consent has dropped below the threshold.', 6000); await rdRefreshMeter(); rdMembers(pane); }
  }; });
  pane.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Remove member', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (v && await act(api(`/api/redev/members/${b.dataset.rm}/remove`, { method: 'POST', body: v }), 'Removed')) { await rdRefreshMeter(); rdMembers(pane); } }; });
  pane.querySelectorAll('[data-docs]').forEach((b) => { b.onclick = () => rdDocs(Number(b.dataset.docs)); });
  const mf = (v) => [{ name: 'wing', label: 'Wing', value: v.wing || '' }, { name: 'unit_label', label: 'Flat', required: true }, { name: 'member_name', label: 'Member name', required: true }, { name: 'phone', label: 'Mobile number' },
    { name: 'member_type', label: 'Type', type: 'select', options: [['owner', 'Owner'], ['tenant', 'Tenant'], ['commercial', 'Commercial'], ['other', 'Other']] }, { name: 'carpet_sqft', label: 'Carpet area (sq ft)', type: 'number' }];
  if ($('rd-add')) $('rd-add').onclick = async () => { const v = await openForm({ title: 'Add member', fields: mf({}) }); if (v && await act(api(`/api/redev/societies/${RD.soc}/members`, { method: 'POST', body: { ...v, client_uuid: crypto.randomUUID() } }), 'Member added')) { await rdRefreshMeter(); rdMembers(pane); } };
  if ($('rd-paste')) $('rd-paste').onclick = async () => {
    const v = await openForm({ title: 'Paste a list', intro: 'One member per line: wing, flat, name, mobile, type, carpet sq ft. Up to 200 lines. Do not include Aadhaar numbers.', fields: [{ name: 'csv', label: 'List', type: 'textarea', required: true, placeholder: 'A, 101, Mr Patil, 9820012345, owner, 450' }] });
    if (!v) return;
    const rows = v.csv.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const c = l.split(',').map((x) => x.trim()); return { wing: c[0], unit_label: c[1], member_name: c[2], phone: c[3] || '', member_type: (c[4] || 'owner').toLowerCase(), carpet_sqft: c[5] || '' }; });
    const res = await act(api(`/api/redev/societies/${RD.soc}/members/import`, { method: 'POST', body: { rows } }));
    if (res) { toast(`${res.data.added} added${res.data.skipped_duplicates ? `, ${res.data.skipped_duplicates} already there` : ''}`, 5000); await rdRefreshMeter(); rdMembers(pane); }
  };
}

async function rdDocs(memberId) {
  const items = (await api(`/api/redev/members/${memberId}/docs`)).data.items;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Member documents</h2>${items.map((i, n) => `<div class="card"><b>${esc(i.key)}</b> ${chip(i.status.replace('_', ' '), i.status === 'received' ? 'good' : '')}${i.file_title ? `<p class="muted">${esc(i.file_title)}</p>` : ''}
    <div class="row-btns"><button class="btn small" data-up="${n}">Upload file</button><button class="btn small" data-mk="${n}:received">Mark received</button><button class="btn small" data-mk="${n}:not_needed">Not needed</button></div></div>`).join('')}<div class="modal-actions"><button class="btn" id="dc-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#dc-close').onclick = () => ov.remove();
  ov.querySelectorAll('[data-mk]').forEach((b) => { b.onclick = async () => { const [n, st] = b.dataset.mk.split(':'); if (await act(api(`/api/redev/members/${memberId}/docs`, { method: 'POST', body: { item_key: items[n].key, status: st } }), 'Saved')) { ov.remove(); rdDocs(memberId); } }; });
  ov.querySelectorAll('[data-up]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Upload', fields: [{ name: 'file', label: 'File', type: 'file', required: true }] }); if (!v) return;
    const id = await rdUpload(v.file, items[b.dataset.up].key); if (!id) return;
    if (await act(api(`/api/redev/members/${memberId}/docs`, { method: 'POST', body: { item_key: items[b.dataset.up].key, status: 'received', document_id: id } }), 'File saved')) { ov.remove(); rdDocs(memberId); }
  }; });
}
async function rdUpload(file, title) {
  const proj = RD.d.society.project_id; const fd = new FormData(); fd.append('file', await compressFile(file), file.name); fd.append('title', title); fd.append('category', 'society'); fd.append('module', 'redevelopment'); fd.append('project_id', String(proj)); fd.append('audience', 'internal');
  const r = await act(api('/api/files/upload', { method: 'POST', body: fd })); return r ? r.data.id : null;
}

// ---------- follow-up and log ----------
async function rdFollowup(pane) {
  const [p, l] = await Promise.all([api(`/api/redev/societies/${RD.soc}/pending`), api(`/api/redev/societies/${RD.soc}/consent-log`)]);
  pane.innerHTML = `<h3>Still to follow up (${p.data.members.length})</h3><div class="row-btns"><a class="btn small" href="/api/redev/societies/${RD.soc}/pending?csv=1">Download (Excel)</a></div>
    ${p.data.members.map((m) => `<p>${chip(m.consent_status, m.consent_status === 'declined' ? 'bad' : 'warn')} <b>${esc(m.member_name)}</b> ${esc((m.wing ? m.wing + '-' : '') + m.unit_label)}${m.phone ? ' · ' + esc(m.phone) : ''}</p>`).join('') || '<p class="muted">Everyone has consented.</p>'}
    <h3>Consent log</h3>${l.data.events.map((e) => `<p class="muted"><b>${esc(dateIST(e.created_at))}</b> · ${esc(e.member_name)} (${esc(e.unit_label)}): ${esc(e.from_status || '')} → ${esc(e.to_status)} by ${esc(e.by_name || '')}${e.note ? ' · ' + esc(e.note) : ''}</p>`).join('') || '<p class="muted">No changes recorded yet.</p>'}`;
}

// ---------- rehab flats ----------
async function rdRehab(pane) {
  const r = (await api(`/api/redev/societies/${RD.soc}/rehab`)).data, canE = isRole('owner', 'pm');
  pane.innerHTML = `<p class="help">Each member's entitlement and the rehab flat given to them. Rehab flats are added in Sales inventory with the type "rehab" and can never be sold.</p><p class="muted">${r.free_units.length} rehab flat(s) still free.</p>
    ${r.members.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.member_name)}</b> · ${esc((m.wing ? m.wing + '-' : '') + m.unit_label)}<p class="muted">Entitlement ${m.entitlement_sqft || '—'} sq ft · ${m.inv_unit ? 'Flat ' + esc((m.inv_wing ? m.inv_wing + '-' : '') + m.inv_unit) : 'no flat yet'}</p></div>${chip(m.status || 'not set', m.status === 'allotted' || m.status === 'possessed' ? 'good' : '')}</div>${canE ? `<button class="btn small" data-rh="${m.member_id}">Set</button>` : ''}</div>`).join('') || '<p class="muted">Add members first.</p>'}`;
  pane.querySelectorAll('[data-rh]').forEach((b) => { b.onclick = async () => {
    const m = r.members.find((x) => x.member_id === Number(b.dataset.rh));
    const v = await openForm({ title: 'Rehab flat for ' + m.member_name, fields: [{ name: 'entitlement_sqft', label: 'Entitlement (sq ft)', type: 'number', value: m.entitlement_sqft || '' }, { name: 'inventory_id', label: 'Flat', type: 'select', options: [['', '— keep as is —'], ...r.free_units.map((u) => [u.id, `${u.wing ? u.wing + '-' : ''}${u.unit_no} (${u.carpet_sqft || '?'} sq ft)`])] },
      { name: 'status', label: 'Status', type: 'select', value: m.status || 'proposed', options: [['proposed', 'Proposed'], ['allotted', 'Allotted'], ['possessed', 'Possessed'], ['cancelled', 'Cancelled']] }] });
    if (v && await act(api(`/api/redev/members/${m.member_id}/rehab`, { method: 'POST', body: { ...v, inventory_id: v.inventory_id || undefined } }), 'Saved')) rdRehab(pane);
  }; });
}

// ---------- transit rent ----------
async function rdRent(pane, month) {
  const canC = isRole('owner', 'accounts'); month = month || (new Date(Date.now() + 19800000).toISOString().substring(0, 7));
  const g = (await api(`/api/redev/societies/${RD.soc}/transit?month=${month}`)).data;
  pane.innerHTML = `<div class="field"><label>Month</label><input type="month" id="rn-month" value="${esc(month)}"></div>
    <p class="muted">Due ${moneyP(g.totals.due_paise)} · received ${moneyP(g.totals.paid_paise)}${g.members_without_term ? ` · ${g.members_without_term} member(s) have no rent set` : ''}</p>
    <div class="row-btns"><a class="btn small" href="/api/redev/reports/rent_due?csv=1">Rent due this month (Excel)</a><a class="btn small" href="/api/redev/reports/overdue?csv=1">Overdue (Excel)</a><a class="btn small" href="/api/redev/reports/guarantees?csv=1">Guarantees expiring (Excel)</a></div>
    ${g.rows.map((r) => `<div class="card"><div class="row"><div><b>${esc(r.member_name)}</b> · ${esc((r.wing ? r.wing + '-' : '') + r.unit_label)}<p class="muted">${r.schedule_id ? `${moneyP(r.due_paise)} due on ${esc(r.due_on)} · received ${moneyP(r.paid_paise)}` : 'No rent scheduled for this month'}${r.bg_expiry ? ` · guarantee ${esc(r.bg_ref || '')} till ${esc(r.bg_expiry)}` : ''}</p></div>${rdState(r.state)}</div>
      <div class="row-btns">${canC && r.schedule_id && r.state !== 'paid' ? `<button class="btn small btn-primary" data-pay="${r.schedule_id}:${r.due_paise - r.paid_paise}">Record payment</button>` : ''}<button class="btn small" data-hist="${r.member_id}">All months</button>${canC ? `<button class="btn small" data-term="${r.member_id}">Rent terms</button>` : ''}</div></div>`).join('') || '<div class="empty-state"><p>No rent set for any member yet.</p></div>'}
    ${canC ? '<h3>Set rent for a member</h3><div class="field"><select id="rn-pick"><option value="">Choose a member…</option></select></div>' : ''}`;
  $('rn-month').onchange = () => rdRent(pane, $('rn-month').value);
  if (canC) { const all = (await api(`/api/redev/societies/${RD.soc}/members?page=1`)).data; $('rn-pick').innerHTML += all.members.map((m) => `<option value="${m.id}">${esc((m.wing ? m.wing + '-' : '') + m.unit_label)} · ${esc(m.member_name)}</option>`).join(''); $('rn-pick').onchange = () => { if ($('rn-pick').value) rdTerm(Number($('rn-pick').value), pane, month); }; }
  pane.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = async () => {
    const [id, left] = b.dataset.pay.split(':');
    const v = await openForm({ title: 'Record rent received', fields: [{ name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true, value: Number(left) / 100 }, { name: 'paid_on', label: 'Date', type: 'date', value: today() }, { name: 'mode', label: 'How', type: 'select', options: [['cheque', 'Cheque'], ['neft', 'NEFT'], ['upi', 'UPI'], ['cash', 'Cash']] }, { name: 'ref_no', label: 'Cheque or reference number' }] });
    if (v && await act(api(`/api/redev/transit/${id}/pay`, { method: 'POST', body: { ...v, client_uuid: crypto.randomUUID() } }), 'Recorded')) rdRent(pane, month);
  }; });
  pane.querySelectorAll('[data-term]').forEach((b) => { b.onclick = () => rdTerm(Number(b.dataset.term), pane, month); });
  pane.querySelectorAll('[data-hist]').forEach((b) => { b.onclick = () => rdHistory(Number(b.dataset.hist), pane, month); });
}

async function rdTerm(memberId, pane, month) {
  const t = (await api(`/api/redev/members/${memberId}/transit`)).data.term || {};
  const v = await openForm({ title: 'Transit rent terms', intro: 'Rent for the next 12 months is scheduled automatically.', fields: [
    { name: 'monthly_rent_paise', label: 'Monthly rent (₹)', type: 'money', required: true, value: t.monthly_rent_paise ? t.monthly_rent_paise / 100 : '' }, { name: 'start_date', label: 'First rent month (any date in it)', type: 'date', required: true, value: t.start_date || today() },
    { name: 'end_date', label: 'Last date (optional)', type: 'date', value: t.end_date || '' }, { name: 'deposit_paise', label: 'Deposit (₹)', type: 'money', value: t.deposit_paise ? t.deposit_paise / 100 : '' },
    { name: 'bg_ref', label: 'Bank guarantee number', value: t.bg_ref || '' }, { name: 'bg_amount_paise', label: 'Guarantee amount (₹)', type: 'money', value: t.bg_amount_paise ? t.bg_amount_paise / 100 : '' }, { name: 'bg_expiry', label: 'Guarantee expires on', type: 'date', value: t.bg_expiry || '' }] });
  if (!v) return;
  ['end_date', 'bg_expiry', 'bg_ref', 'bg_amount_paise', 'deposit_paise'].forEach((k) => { if (v[k] === '') delete v[k]; });
  const r = await act(api(`/api/redev/members/${memberId}/transit-term`, { method: 'POST', body: v }), 'Saved');
  if (r) { toast(`${r.data.months_scheduled} months scheduled`); rdRent(pane, month); }
}

async function rdHistory(memberId, pane, month) {
  const d = (await api(`/api/redev/members/${memberId}/transit`)).data, canC = isRole('owner', 'accounts');
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>${esc(d.member.member_name)}: rent</h2>${d.months.map((m) => `<p>${rdState(m.state)} <b>${esc(m.period)}</b> · ${moneyP(m.due_paise)} · received ${moneyP(m.paid_paise)}</p>`).join('') || '<p class="muted">No rent scheduled.</p>'}
    <h3>Payments</h3>${d.payments.map((p) => `<div class="card" style="${p.reversed_at ? 'opacity:.6' : ''}"><b>${moneyP(p.amount_paise)}</b> for ${esc(p.period)} · ${esc(p.paid_on)} · ${esc(p.mode || '')} ${esc(p.ref_no || '')}${p.reversed_at ? `<p class="muted">Reversed: ${esc(p.reversal_note)}</p>` : (canC ? `<button class="btn small" data-rev="${p.id}">Reverse</button>` : '')}</div>`).join('') || '<p class="muted">No payments yet.</p>'}
    <div class="modal-actions"><button class="btn" id="hs-close">Close</button></div></div>`;
  document.body.appendChild(ov); ov.querySelector('#hs-close').onclick = () => ov.remove();
  ov.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Reverse payment', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (v && await act(api(`/api/redev/transit-payments/${b.dataset.rev}/reverse`, { method: 'POST', body: v }), 'Reversed')) { ov.remove(); rdRent(pane, month); } }; });
}

// ---------- corpus ----------
async function rdCorpus(pane) {
  const c = (await api(`/api/redev/societies/${RD.soc}/corpus`)).data, canC = isRole('owner', 'accounts');
  pane.innerHTML = `<p class="muted">Corpus due ${moneyP(c.due_paise)} · received ${moneyP(c.paid_paise)}</p>${canC ? '<button class="btn btn-primary" id="cp-add">+ Add corpus item</button>' : ''} <a class="btn small" href="/api/redev/reports/corpus?csv=1">Report (Excel)</a>
    ${c.entries.map((e) => `<div class="card" style="${e.reversed_at ? 'opacity:.6' : ''}"><div class="row"><div><b>${esc(e.label)}</b> · ${moneyP(e.amount_paise)}<p class="muted">${esc(e.member_name)} (${esc(e.unit_label)})${e.due_on ? ' · due ' + esc(e.due_on) : ''}${e.paid_on ? ' · paid ' + esc(e.paid_on) + ' ' + esc(e.ref_no || '') : ''}</p></div>${e.reversed_at ? chip('Reversed', '') : e.paid_on ? chip('Paid', 'good') : chip('Due', 'warn')}</div>
      ${e.reversal_note ? `<p class="muted">Reversed: ${esc(e.reversal_note)}</p>` : ''}${canC && !e.reversed_at ? `<div class="row-btns">${e.paid_on ? '' : `<button class="btn small" data-cpay="${e.id}">Mark paid</button>`}<button class="btn small" data-crev="${e.id}">Reverse</button></div>` : ''}</div>`).join('') || '<p class="muted">No corpus items yet.</p>'}`;
  if ($('cp-add')) $('cp-add').onclick = async () => {
    const ms = (await api(`/api/redev/societies/${RD.soc}/members?page=1`)).data.members;
    const v = await openForm({ title: 'Corpus item', fields: [{ name: 'member_id', label: 'Member', type: 'select', options: ms.map((m) => [m.id, `${m.wing ? m.wing + '-' : ''}${m.unit_label} · ${m.member_name}`]) }, { name: 'label', label: 'What is it for?', required: true }, { name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true }, { name: 'due_on', label: 'Due on', type: 'date' }] });
    if (v && await act(api(`/api/redev/members/${v.member_id}/corpus`, { method: 'POST', body: v }), 'Added')) rdCorpus(pane);
  };
  pane.querySelectorAll('[data-cpay]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Mark paid', fields: [{ name: 'paid_on', label: 'Date', type: 'date', value: today() }, { name: 'ref_no', label: 'Reference' }] }); if (v && await act(api(`/api/redev/corpus/${b.dataset.cpay}/pay`, { method: 'POST', body: v }), 'Saved')) rdCorpus(pane); }; });
  pane.querySelectorAll('[data-crev]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Reverse', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (v && await act(api(`/api/redev/corpus/${b.dataset.crev}/reverse`, { method: 'POST', body: v }), 'Reversed')) rdCorpus(pane); }; });
}

// ---------- meetings ----------
async function rdMeetings(pane) {
  const r = (await api(`/api/redev/societies/${RD.soc}/meetings`)).data, canC = isRole('owner', 'pm');
  pane.innerHTML = `<p class="help">${esc(r.note)}</p>${canC ? '<button class="btn btn-primary btn-full" id="mt-new">+ New meeting</button>' : ''}<a class="btn small" href="/api/redev/societies/${RD.soc}/meetings?csv=1">Download (Excel)</a>
    ${r.meetings.map((m) => `<div class="card"><div class="row"><div><b>${esc(m.held_on)}</b> · ${esc(m.kind.replace('_', ' '))}${m.attendees_count != null ? ` · ${m.attendees_count} present` : ''}<p>${esc(m.agenda || '')}</p>${m.resolution_text ? `<p class="muted">Resolution: ${esc(m.resolution_text)}</p>` : ''}</div>${m.resolution_text ? chip(m.resolution_passed ? 'Passed' : 'Not passed', m.resolution_passed ? 'good' : 'warn') : ''}</div>
      ${m.minutes_document_id ? `<a class="btn small" href="/api/files/download/${m.minutes_document_id}">Minutes: ${esc(m.minutes_title || 'file')}</a>` : ''}
      ${m.next_action ? `<p>${m.next_action_done ? chip('Done', 'good') : chip('Open', 'warn')} Next: ${esc(m.next_action)}${m.next_action_due ? ' by ' + esc(m.next_action_due) : ''}</p>${canC && !m.next_action_done ? `<button class="btn small" data-md="${m.id}">Mark done</button>` : ''}` : ''}</div>`).join('') || '<div class="empty-state"><p>No meetings recorded yet.</p></div>'}`;
  if ($('mt-new')) $('mt-new').onclick = async () => {
    const v = await openForm({ title: 'New meeting', intro: RD_NOTE, fields: [{ name: 'kind', label: 'Kind', type: 'select', options: [['general_body', 'General body'], ['committee', 'Committee'], ['other', 'Other']] }, { name: 'held_on', label: 'Date held', type: 'date', required: true, value: today() }, { name: 'agenda', label: 'Agenda', type: 'textarea' }, { name: 'attendees_count', label: 'Members present', type: 'number' },
      { name: 'resolution_text', label: 'Resolution (if any)', type: 'textarea' }, { name: 'resolution_passed', label: 'Resolution', type: 'checkbox', checkLabel: 'It was passed' }, { name: 'file', label: 'Minutes file', type: 'file' }, { name: 'next_action', label: 'Next action' }, { name: 'next_action_due', label: 'Do it by', type: 'date' }] });
    if (!v) return; const body = { ...v }; delete body.file;
    if (v.file) { const id = await rdUpload(v.file, 'Minutes ' + v.held_on); if (!id) return; body.minutes_document_id = id; }
    ['next_action_due', 'attendees_count'].forEach((k) => { if (body[k] === '') delete body[k]; });
    if (await act(api(`/api/redev/societies/${RD.soc}/meetings`, { method: 'POST', body }), 'Meeting saved')) rdMeetings(pane);
  };
  pane.querySelectorAll('[data-md]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/redev/meetings/${b.dataset.md}`, { method: 'PUT', body: { next_action_done: true } }), 'Done')) rdMeetings(pane); }; });
}

PAGES.redevelopment = (m) => renderRedevelopment(m);
Object.assign(ROUTE_TITLES, { redevelopment: 'Redevelopment' });
Object.assign(ICONS, { redevelopment: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 11h2M13 11h2' });
