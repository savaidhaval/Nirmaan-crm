// pages25.js — Quality: pour cards (approved before the pour), cube tests at 7 and 28 days, NCRs. Also the structured daily report form.

const QA = { tab: 'pours', pid: null, meta: null };
const POUR_CHIP = { requested: ['Waiting for PM', 'warn'], approved: ['Approved to pour', 'info'], poured: ['Poured', 'good'], cancelled: ['Cancelled', ''] };
async function qaMeta() { if (!QA.meta) QA.meta = (await api('/api/qa/meta')).data; return QA.meta; }
const qaPm = () => ['owner', 'pm'].includes(currentUser.role);
const qaCanAdd = () => ['owner', 'pm', 'site'].includes(currentUser.role);
async function qaUpload(file, pid, title) {
  const fd = new FormData(); fd.append('file', typeof compressFile === 'function' ? await compressFile(file) : file, file.name);
  fd.append('title', title); fd.append('category', 'quality'); fd.append('module', 'site'); fd.append('project_id', String(pid)); fd.append('audience', 'internal');
  const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); return up ? up.data.id : null;
}

async function renderQuality(main) {
  const projects = await projectOptions();
  if (!projects.length) { main.innerHTML = '<h1>Quality</h1><div class="empty-state"><p>No projects yet.</p></div>'; return; }
  if (!QA.pid || !projects.some(([v]) => String(v) === String(QA.pid))) QA.pid = scopeProject && projects.some(([v]) => String(v) === String(scopeProject)) ? scopeProject : projects[0][0];
  main.innerHTML = `<h1>Quality</h1><p class="help">Pour cards are checked and approved before concrete goes in. Cube results are entered from the lab report; a failed cube opens an NCR by itself.</p>
    <div class="field"><label>Project</label><select id="qa-p">${projects.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(QA.pid) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="row-btns">${[['pours', 'Pour cards'], ['cubes', 'Cube tests'], ['ncrs', 'NCRs']].map(([k, l]) => `<button class="btn small ${QA.tab === k ? 'btn-primary' : ''}" data-qtab="${k}">${l}</button>`).join('')}</div><div id="qa-body">Loading...</div>`;
  $('qa-p').onchange = () => { QA.pid = Number($('qa-p').value); qaLoad(); };
  main.querySelectorAll('[data-qtab]').forEach((b) => { b.onclick = () => { QA.tab = b.dataset.qtab; renderQuality(main); }; });
  qaLoad();
}
async function qaLoad() {
  const el = $('qa-body'); if (!el) return;
  try { await ({ pours: qaPours, cubes: qaCubes, ncrs: qaNcrs })[QA.tab](el); } catch (e) { el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
const qaWhere = (p) => `${p.element} ${esc(p.grade)}${p.wing ? ' · wing ' + esc(p.wing) : ''}${p.floor != null ? ' · floor ' + esc(p.floor) : ''}${p.location ? ' · ' + esc(p.location) : ''}`;

// ---------- pour cards ----------
async function qaPours(el) {
  const [d, m] = await Promise.all([api(`/api/qa/pours?project_id=${QA.pid}`), qaMeta()]);
  const pours = d.data.pours;
  el.innerHTML = `${qaCanAdd() ? '<button class="btn btn-primary btn-full" id="qa-new">+ Pour card</button>' : ''}
    ${pours.map((p) => { const open = Object.entries(p.checklist || {}).filter(([, v]) => !v).length; return `<div class="card"><div class="row"><div><b style="text-transform:capitalize">${qaWhere(p)}</b>
      <p class="muted">${esc(p.qty_cum)} cum${p.planned_date ? ' · planned ' + esc(p.planned_date) : ''}${p.poured_on ? ' · poured ' + esc(p.poured_on) + ' (' + esc(p.poured_qty_cum) + ' cum)' : ''}${p.drawing_ref ? ' · ' + esc(p.drawing_ref) : ''}</p>
      <p class="muted">Asked by ${esc(p.requested_by_name || '')}${p.approved_by_name ? ' · approved by ' + esc(p.approved_by_name) : ''}${p.status === 'requested' && open ? ` · ${open} check(s) not ticked` : ''}</p>
      ${p.cubes.length ? `<p class="muted">${p.cubes.map((c) => `${c.age_days}-day: ${c.status === 'pending' ? 'due ' + esc(c.due_date) : esc(c.result_mpa) + ' N/mm² ' + (c.status === 'pass' ? '✓' : '✗ FAIL')}`).join(' · ')}</p>` : ''}</div>${chip(...(POUR_CHIP[p.status] || [p.status, '']))}</div>
      <div class="row-btns">${p.status === 'requested' && qaPm() && (p.requested_by !== currentUser.id || currentUser.role === 'owner') ? `<button class="btn small btn-primary" data-pap="${p.id}">Check and approve</button>` : ''}
      ${p.status === 'approved' && qaCanAdd() ? `<button class="btn small btn-primary" data-pdone="${p.id}">Poured</button>` : ''}${['requested', 'approved'].includes(p.status) && qaPm() ? `<button class="btn small" data-pcan="${p.id}">Cancel</button>` : ''}
      ${p.photo_doc_id ? `<a class="btn small" href="/api/files/download/${p.photo_doc_id}">Photo</a>` : ''}${waBtn(`Pour card (${(POUR_CHIP[p.status] || [p.status])[0]}): ${p.element} ${p.grade}, ${p.qty_cum} cum${p.wing ? ', wing ' + p.wing : ''}${p.floor != null ? ', floor ' + p.floor : ''}${p.planned_date ? ', planned ' + p.planned_date : ''}.`, 'quality')}</div></div>`; }).join('') || '<div class="empty-state"><p>No pour cards yet.</p></div>'}`;
  if ($('qa-new')) $('qa-new').onclick = async () => {
    const v = await openForm({ title: 'Pour card', intro: 'Tick what is checked. The PM checks the rest and approves before the pour.', fields: [
      { name: 'element', label: 'What is being poured', type: 'select', options: m.elements.map((x) => [x, x[0].toUpperCase() + x.slice(1)]) },
      { name: 'wing', label: 'Wing' }, { name: 'floor', label: 'Floor (0 = plinth)', type: 'number' }, { name: 'location', label: 'Grid / bay' },
      { name: 'grade', label: 'Concrete grade', value: 'M25', required: true }, { name: 'qty_cum', label: 'Quantity (cubic metres)', type: 'number', required: true },
      { name: 'planned_date', label: 'Planned pour date', type: 'date', value: today() }, { name: 'drawing_ref', label: 'Drawing and revision (IFC)' }, { name: 'rmc_supplier', label: 'RMC supplier' },
      { name: 'checks', label: 'Checks done', type: 'multi', options: m.checklist.map((c, i) => [i, c]) }, { name: 'file', label: 'Photo (optional)', type: 'file' }] });
    if (!v) return;
    const body = { project_id: QA.pid, element: v.element, wing: v.wing, floor: v.floor, location: v.location, grade: v.grade, qty_cum: v.qty_cum, planned_date: v.planned_date, drawing_ref: v.drawing_ref, rmc_supplier: v.rmc_supplier,
      checklist: Object.fromEntries(m.checklist.map((c, i) => [c, (v.checks || []).includes(i)])), client_uuid: crypto.randomUUID() };
    if (v.file) { const id = await qaUpload(v.file, QA.pid, 'Pour card photo'); if (!id) return; body.photo_doc_id = id; }
    const r = await postOrQueue('/api/qa/pours', body, 'Pour card sent to the PM');
    if (r) qaLoad();
  };
  el.querySelectorAll('[data-pap]').forEach((b) => { b.onclick = async () => {
    const p = pours.find((x) => String(x.id) === b.dataset.pap); const items = Object.keys(p.checklist || {});
    const v = await openForm({ title: `Approve pour: ${p.element} ${p.grade}`, intro: 'Every check must be ticked before concrete goes in.', fields: [
      { name: 'checks', label: 'Checked', type: 'multi', value: items.map((k, i) => (p.checklist[k] ? i : -1)).filter((i) => i >= 0), options: items.map((k, i) => [i, k]) }] });
    if (!v) return;
    const body = { checklist: Object.fromEntries(items.map((k, i) => [k, (v.checks || []).includes(i)])) };
    try { if (await api(`/api/qa/pours/${p.id}/approve`, { method: 'POST', body })) { toast('Approved to pour'); qaLoad(); } }
    catch (e) {
      if (e.data && e.data.code === 'cc' && currentUser.role === 'owner' && /written reason/.test(e.message)) { const o = await openForm({ title: 'No CC for this floor', intro: e.message, fields: [{ name: 'override_note', label: 'Why go ahead?', type: 'textarea', required: true }] }); if (o && await act(api(`/api/qa/pours/${p.id}/approve`, { method: 'POST', body: { ...body, ...o } }), 'Approved to pour')) qaLoad(); }
      else toast(e.message, 9000);
    }
  }; });
  el.querySelectorAll('[data-pdone]').forEach((b) => { b.onclick = async () => {
    const p = pours.find((x) => String(x.id) === b.dataset.pdone);
    const v = await openForm({ title: 'Concrete poured', intro: 'The 7-day and 28-day cube tests are set up with their due dates.', fields: [
      { name: 'poured_on', label: 'Poured on', type: 'date', value: today(), required: true }, { name: 'poured_qty_cum', label: 'Quantity poured (cum)', type: 'number', value: p.qty_cum }, { name: 'rmc_tickets', label: 'RMC delivery ticket numbers' }] });
    if (!v) return;
    const r = await postOrQueue(`/api/qa/pours/${p.id}/poured`, v, 'Pour recorded');
    if (r && r.data && r.data.cube_7_due) toast(`Recorded. Cubes due ${r.data.cube_7_due} (7-day, ${r.data.required_7_mpa} N/mm²) and ${r.data.cube_28_due} (28-day, ${r.data.required_28_mpa} N/mm²).`, 8000);
    if (r) qaLoad();
  }; });
  el.querySelectorAll('[data-pcan]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Cancel pour card', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (v && await act(api(`/api/qa/pours/${b.dataset.pcan}/cancel`, { method: 'POST', body: v }), 'Cancelled')) qaLoad(); }; });
}

// ---------- cube tests ----------
async function qaCubes(el) {
  const pours = (await api(`/api/qa/pours?project_id=${QA.pid}`)).data.pours;
  const cubes = pours.flatMap((p) => p.cubes.map((c) => ({ ...c, pour: p }))).sort((a, b) => (a.status === 'pending') === (b.status === 'pending') ? (a.due_date < b.due_date ? -1 : 1) : (a.status === 'pending' ? -1 : 1));
  const t0 = today();
  el.innerHTML = cubes.map((c) => `<div class="card${c.status === 'fail' ? ' task-row late' : ''}"><div class="row"><div><b>${c.age_days}-day cube</b> · <span style="text-transform:capitalize">${qaWhere(c.pour)}</span>
      <p class="muted">Poured ${esc(c.pour.poured_on || '')} · due ${esc(c.due_date)} · must reach ${esc(c.required_mpa)} N/mm²${c.result_mpa != null ? ` · result <b>${esc(c.result_mpa)}</b>${c.lab ? ' (' + esc(c.lab) + ')' : ''}` : ''}</p></div>
      ${c.status === 'pending' ? (c.due_date < t0 ? chip('Overdue', 'bad') : c.due_date === t0 ? chip('Due today', 'warn') : chip('Waiting', '')) : chip(c.status === 'pass' ? 'Pass' : 'FAIL', c.status === 'pass' ? 'good' : 'bad')}</div>
      ${c.status === 'pending' && qaCanAdd() && c.due_date <= t0 ? `<button class="btn small btn-primary" data-cres="${c.id}">Enter result</button>` : ''}${c.report_doc_id ? `<a class="btn small" href="/api/files/download/${c.report_doc_id}">Lab report</a>` : ''}${c.status === 'fail' || (c.status === 'pending' && c.due_date <= t0) ? waBtn(`${c.age_days}-day cube ${c.status === 'fail' ? 'FAILED (' + c.result_mpa + ' against ' + c.required_mpa + ' N/mm²)' : 'test due ' + c.due_date}: ${c.pour.element} ${c.pour.grade}${c.pour.wing ? ', wing ' + c.pour.wing : ''}${c.pour.floor != null ? ', floor ' + c.pour.floor : ''}.`, 'quality') : ''}</div>`).join('')
    || '<div class="empty-state"><p>No cube tests yet. They appear when a pour is recorded.</p></div>';
  el.querySelectorAll('[data-cres]').forEach((b) => { b.onclick = async () => {
    const c = cubes.find((x) => String(x.id) === b.dataset.cres);
    const v = await openForm({ title: `${c.age_days}-day cube result`, intro: `Must reach ${c.required_mpa} N/mm².`, fields: [
      { name: 'result_mpa', label: 'Average strength of the set (N/mm²)', type: 'number', required: true }, { name: 'tested_on', label: 'Tested on', type: 'date', value: today() },
      { name: 'lab', label: 'Lab' }, { name: 'file', label: 'Lab report (optional)', type: 'file' }] });
    if (!v) return;
    const body = { result_mpa: v.result_mpa, tested_on: v.tested_on, lab: v.lab };
    if (v.file) { const id = await qaUpload(v.file, QA.pid, `Cube report ${c.age_days}-day`); if (!id) return; body.report_doc_id = id; }
    const r = await postOrQueue(`/api/qa/cubes/${c.id}/result`, body, 'Result saved');
    if (r && r.data && r.data.status === 'fail') toast(`FAILED. An NCR is open.${c.age_days === 28 ? ' Certifying this floor is stopped until it is closed.' : ''}`, 9000);
    if (r) qaLoad();
  }; });
}

// ---------- NCRs ----------
async function qaNcrs(el) {
  const rows = (await api(`/api/qa/ncrs?project_id=${QA.pid}`)).data.ncrs;
  const SRC = { cube7: '7-day cube', cube28: '28-day cube', site: 'Raised on site' };
  el.innerHTML = `${qaCanAdd() ? '<button class="btn btn-primary btn-full" id="ncr-new">+ NCR</button>' : ''}
    ${rows.map((n) => `<div class="card${n.status === 'open' ? ' task-row late' : ''}"><div class="row"><div><b>${esc(n.title)}</b>
      <p class="muted">${esc(SRC[n.source] || n.source)}${n.wing ? ' · wing ' + esc(n.wing) : ''}${n.floor != null ? ' · floor ' + esc(n.floor) : ''} · in charge: ${esc(n.assigned_name || 'not set')}${n.due_date ? ' · by ' + esc(n.due_date) : ''}</p>
      ${n.details ? `<p class="muted">${esc(n.details)}</p>` : ''}${n.correction ? `<p>Correction: ${esc(n.correction)} <span class="muted">(${esc(n.closed_by_name || '')}, ${esc(String(n.closed_at || '').slice(0, 10))})</span></p>` : ''}</div>${chip(n.status === 'open' ? 'Open' : 'Closed', n.status === 'open' ? 'bad' : 'good')}</div>
      <div class="row-btns">${n.status === 'open' && qaPm() ? `<button class="btn small" data-assign="ncr:${n.id}" data-uid="${n.assigned_to || ''}" data-due="${esc(n.due_date || '')}">Set in charge</button><button class="btn small btn-primary" data-ncl="${n.id}">Close</button>` : ''}
      ${n.photo_doc_id ? `<a class="btn small" href="/api/files/download/${n.photo_doc_id}">Photo</a>` : ''}${n.closing_doc_id ? `<a class="btn small" href="/api/files/download/${n.closing_doc_id}">Closing proof</a>` : ''}${waBtn(`NCR (${n.status}): ${n.title}${n.wing ? ', wing ' + n.wing : ''}${n.floor != null ? ', floor ' + n.floor : ''}. In charge: ${n.assigned_name || 'not set'}${n.due_date ? ', by ' + n.due_date : ''}.`, 'quality')}</div></div>`).join('') || '<div class="empty-state"><p>No NCRs.</p></div>'}`;
  if ($('ncr-new')) $('ncr-new').onclick = async () => {
    const ch = typeof ppChoices === 'function' ? await ppChoices() : { people: [] };
    const v = await openForm({ title: 'Non-conformance (NCR)', fields: [
      { name: 'title', label: 'What is wrong?', required: true }, { name: 'details', label: 'Details', type: 'textarea' }, { name: 'wing', label: 'Wing' }, { name: 'floor', label: 'Floor', type: 'number' },
      { name: 'assigned_to', label: 'Person in charge', type: 'select', options: [['', 'Pick a person'], ...ch.people.map((p) => [p.id, p.name])] }, { name: 'due_date', label: 'Correct by', type: 'date' }, { name: 'file', label: 'Photo', type: 'file' }] });
    if (!v) return;
    const body = { project_id: QA.pid, title: v.title, details: v.details, wing: v.wing, floor: v.floor, assigned_to: v.assigned_to ? Number(v.assigned_to) : undefined, due_date: v.due_date || undefined, client_uuid: crypto.randomUUID() };
    if (v.file) { const id = await qaUpload(v.file, QA.pid, 'NCR photo'); if (!id) return; body.photo_doc_id = id; }
    if (await postOrQueue('/api/qa/ncrs', body, 'NCR raised')) qaLoad();
  };
  el.querySelectorAll('[data-ncl]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Close NCR', fields: [{ name: 'correction', label: 'What was done to correct it?', type: 'textarea', required: true, placeholder: 'Core test passed / member strengthened / recast...' }, { name: 'file', label: 'Proof (test report, photo)', type: 'file' }] });
    if (!v) return;
    const body = { correction: v.correction };
    if (v.file) { const id = await qaUpload(v.file, QA.pid, 'NCR closing proof'); if (!id) return; body.closing_doc_id = id; }
    if (await act(api(`/api/qa/ncrs/${b.dataset.ncl}/close`, { method: 'POST', body }), 'NCR closed')) qaLoad();
  }; });
}

PAGES.quality = (m) => renderQuality(m);
Object.assign(ROUTE_TITLES, { quality: 'Quality' });
Object.assign(ICONS, { quality: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.500-3 7.500-7 9-4-1.500-7-4.500-7-9V6z' });
const _sidebarItems25 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems25(role);
  if (['owner', 'pm', 'site', 'viewer'].includes(role) && !groups.some(([, items]) => items.some((i) => i.route === 'quality'))) {
    const g = groups.find((x) => x[0] === 'Projects') || groups.find((x) => x[0] === null);
    if (g) { const at = g[1].findIndex((i) => i.route === 'site'); g[1].splice(at >= 0 ? at + 1 : g[1].length, 0, { label: 'Quality', route: 'quality', icon: 'quality' }); }
  }
  return groups;
};

// ======================= structured daily report =======================
newDpr = async function () {
  const projects = await projectOptions(); const m = await qaMeta().catch(() => ({ activities: [] }));
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const line = () => `<div class="card dpr-line" style="padding:10px"><div class="grid2"><div class="field"><label>Activity</label><select data-w="activity"><option value="">Pick</option>${m.activities.map((a) => `<option>${esc(a)}</option>`).join('')}</select></div>
    <div class="field"><label>Wing</label><input data-w="wing"></div><div class="field"><label>Floor</label><input data-w="floor" type="number" step="any" inputmode="decimal"></div>
    <div class="field"><label>How much</label><input data-w="qty" type="number" step="any" inputmode="decimal"></div><div class="field"><label>Unit</label><select data-w="unit"><option></option>${['cum', 'sqm', 'rmt', 'MT', 'nos', '%'].map((u) => `<option>${u}</option>`).join('')}</select></div></div></div>`;
  ov.innerHTML = `<div class="modal"><h2>Today's work report</h2><form id="dpr-form">
    <div class="field"><label>Project</label><select id="dpr-project">${projects.map(([v, l]) => `<option value="${esc(v)}"${pickedProject(v)}>${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label>Date</label><input id="dpr-date" type="date" value="${today()}"></div>
    <h3>Work done</h3><div id="dpr-lines">${line()}</div><button type="button" class="btn small" id="dpr-addline">+ Another activity</button>
    <div class="field"><label>Anything else (optional)</label><textarea id="dpr-summary" rows="2"></textarea></div>
    <div class="field"><label>Weather</label><div class="row-btns" id="dpr-weather">${['Clear', 'Cloudy', 'Rain'].map((w) => `<button type="button" class="btn small" data-wx="${w}">${w}</button>`).join('')}</div></div>
    <div class="grid2"><div class="field"><label>Hours lost</label><input id="dpr-lost" type="number" step="any" inputmode="decimal" placeholder="0"></div>
    <div class="field"><label>Because of</label><select id="dpr-lostwhy"><option value="">—</option>${[['rain', 'Rain'], ['material', 'Material'], ['labour', 'Labour'], ['power', 'Power'], ['approvals', 'Approvals'], ['other', 'Other']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div></div>
    <h3>Safety today</h3><div class="multi-box" id="dpr-safety">${(m.safety || []).map((c, i) => `<label class="check multi-item"><input type="checkbox" data-sf="${i}"> ${esc(c)}</label>`).join('')}</div>
    <div class="field"><label>Any incident?</label><div class="row-btns" id="dpr-inc">${[['none', 'None'], ['near_miss', 'Near miss'], ['injury', 'Injury'], ['dangerous', 'Dangerous occurrence']].map(([v, l]) => `<button type="button" class="btn small${v === 'none' ? ' btn-primary' : ''}" data-inc="${v}">${l}</button>`).join('')}</div></div>
    <div class="field" id="dpr-incbox" hidden><label>What happened? (who, where, what was done)</label><textarea id="dpr-incident" rows="2"></textarea></div>
    <div class="field"><label>Labour on site</label><div id="dpr-labour"></div></div>
    <div class="field"><label>Problems / delays</label><textarea id="dpr-issues" rows="2"></textarea></div>
    <div class="field"><label>Photos</label><input id="dpr-photos" type="file" accept="image/*" multiple><p class="help">Optional. Kept on the phone until sent.</p></div>
    <div class="error" id="dpr-err" style="display:none"></div>
    <div class="modal-actions"><button type="button" class="btn" id="dpr-cancel">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></form></div>`;
  document.body.appendChild(ov);
  let weather = '';
  ov.querySelectorAll('[data-wx]').forEach((b) => { b.onclick = () => { weather = b.dataset.wx; ov.querySelectorAll('[data-wx]').forEach((x) => x.classList.toggle('btn-primary', x === b)); if (weather === 'Rain' && !$('dpr-lostwhy').value) $('dpr-lostwhy').value = 'rain'; }; });
  $('dpr-addline').onclick = () => $('dpr-lines').insertAdjacentHTML('beforeend', line());
  let incident = 'none';
  ov.querySelectorAll('[data-inc]').forEach((b) => { b.onclick = () => { incident = b.dataset.inc; ov.querySelectorAll('[data-inc]').forEach((x) => x.classList.toggle('btn-primary', x === b)); $('dpr-incbox').hidden = incident === 'none'; }; });
  let contractors = [];
  const stepper = (c, n) => `<div class="row" style="align-items:center;gap:8px;margin-bottom:8px" data-con="${c.id}" data-trade="${esc(c.trade || '')}"><div style="flex:1"><b>${esc(c.name)}</b>${c.trade ? `<div class="muted">${esc(c.trade)}</div>` : ''}</div>
    <button type="button" class="btn" data-step="-1" aria-label="Fewer" style="min-width:48px">−</button><input data-n inputmode="numeric" value="${n}" style="width:64px;text-align:center" aria-label="Headcount"><button type="button" class="btn" data-step="1" aria-label="More" style="min-width:48px">+</button></div>`;
  const draw = async () => {
    const pid = Number($('dpr-project').value); const box = $('dpr-labour');
    const d = await dprLabourSetup(pid); contractors = d.contractors;
    if (!contractors.length) { box.innerHTML = '<input id="dpr-total" type="text" inputmode="numeric" placeholder="0">'; return; }
    const last = Object.fromEntries((d.last || []).map((x) => [x.contractor_id, x.headcount]));
    box.innerHTML = contractors.map((c) => stepper(c, last[c.id] || 0)).join('') + '<p class="help">Numbers are copied from the last report. Change what is different today.</p>';
    box.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => { const inp = b.parentElement.querySelector('[data-n]'); inp.value = Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.step)); }; });
  };
  $('dpr-project').onchange = draw; await draw();
  $('dpr-cancel').onclick = () => ov.remove();
  $('dpr-form').onsubmit = async (e) => {
    e.preventDefault();
    const work = [...ov.querySelectorAll('.dpr-line')].map((l) => Object.fromEntries([...l.querySelectorAll('[data-w]')].map((i) => [i.dataset.w, i.value.trim()]))).filter((w) => w.activity);
    const summary = $('dpr-summary').value.trim();
    if (!work.length && !summary) { const er = $('dpr-err'); er.textContent = 'Pick at least one activity (or write what happened).'; er.style.display = 'block'; return; }
    if (incident !== 'none' && !$('dpr-incident').value.trim()) { const er = $('dpr-err'); er.textContent = 'Describe the incident: who, where, what was done.'; er.style.display = 'block'; return; }
    const safety = Object.fromEntries((m.safety || []).map((c, i) => [c, !!(ov.querySelector(`[data-sf="${i}"]`) || {}).checked]));
    const v = { project_id: Number($('dpr-project').value), report_date: $('dpr-date').value, work_summary: summary, work, weather, hours_lost: $('dpr-lost').value, lost_reason: $('dpr-lostwhy').value, issues: $('dpr-issues').value.trim(), safety, incident_kind: incident, safety_incident: incident !== 'none' ? $('dpr-incident').value.trim() : '', client_uuid: crypto.randomUUID() };
    if (contractors.length) v.labour = [...$('dpr-labour').querySelectorAll('[data-con]')].map((r) => ({ contractor_id: Number(r.dataset.con), trade: r.dataset.trade, headcount: Number(r.querySelector('[data-n]').value) || 0 })).filter((x) => x.headcount > 0);
    else v.labour_count = Number(($('dpr-total') || {}).value) || 0;
    const files = [...$('dpr-photos').files];
    ov.remove();
    const r = await postOrQueue('/api/site/dprs', v, 'Report saved');
    if (r) { if (files.length) await filePhotos('site_dprs', v.client_uuid, v.project_id, files, r.data && r.data.id); if (r.data && r.data.id) saveMapEntry(v.client_uuid, r.data.id); renderSite($('app-main')); }
  };
};
