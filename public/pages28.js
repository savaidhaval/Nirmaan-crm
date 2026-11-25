// pages28.js — Settings in categories; Business Development (where new projects come from); project life cycle on the project page.

// ======================= Settings, grouped =======================
Object.assign(SETTING_LABELS, {
  'bd.vacate_to_plinth_months': ['Usual months from vacating to plinth CC (6 to 8 is usual; used for the target date)', 'number'],
  'bd.completion_months': ['Usual months from plinth CC to completion / OC (36 is usual; used for the target date)', 'number'],
  'bd.steps_79a': ['79A process steps for a society (separate them with ; ). Leave empty for the built-in list. Confirm the steps with your advocate', 'text'],
});
// [category, short note, test(key)] in the order shown. The first match wins; anything else falls into "Files, AI and other".
const SETTING_GROUPS = [
  ['Business development', 'New projects, feasibility and project time targets', (k) => /^(bd|fea)\./.test(k)],
  ['Approvals and RERA', 'Officer titles, RERA account and withdrawal certificates', (k) => /^(apr|rera)\./.test(k)],
  ['Taxes and stamp duty', 'Confirm every rate with your CA before changing it', (k) => /^tax\./.test(k) || ['con.gst_bp', 'con.tds_bp', 'budget.gst_basis'].includes(k)],
  ['Sales and customers', 'Discounts, holds, demand letters, receipts, handover', (k) => /^(sales|demand|interest|share|brochure)\./.test(k)],
  ['Purchase and store', 'Purchase order limits and tolerance on material received', (k) => /^(po|pro)\./.test(k)],
  ['Contractors', 'Work orders, RA bills, variations, retention', (k) => /^con\./.test(k)],
  ['Site, drawings and quality', 'Daily report, pour card, cube tests, drawing reminders', (k) => /^(dpr|qa|drawing)\./.test(k)],
  ['Redevelopment', 'Society members and transit rent', (k) => /^red\./.test(k)],
  ['Money and banking', 'Petty cash and bank statements', (k) => /^(petty|bank)\./.test(k)],
  ['Access and security', 'Who may see what, second Owner, two-step sign-in', (k) => /^(access|security)\./.test(k)],
  ['Files, AI and other', 'Upload size, AI assistant and everything else', () => true],
];
function settingInput(k, kind, v) {
  if (kind === 'basis') return `<select data-key="${k}" data-kind="${kind}"><option value="exclusive"${v !== 'inclusive' ? ' selected' : ''}>Without GST</option><option value="inclusive"${v === 'inclusive' ? ' selected' : ''}>With GST</option></select>`;
  if (kind === 'onoff') { const on = ON_BY_DEFAULT.includes(k) ? v !== 'off' : v === 'on'; return `<select data-key="${k}" data-kind="${kind}"><option value="off"${!on ? ' selected' : ''}>Off</option><option value="on"${on ? ' selected' : ''}>On</option></select>`; }
  const shown = kind === 'money' ? ((Number(v) || 0) / 100) : (v == null ? '' : v);
  if (kind === 'text') return `<textarea data-key="${k}" data-kind="${kind}" rows="2">${esc(shown)}</textarea>`;
  return `<input data-key="${k}" data-kind="${kind}" inputmode="decimal" value="${esc(shown)}">`;
}
renderSettings = PAGES.settings = function (main) {
  main.innerHTML = `<h1>Settings</h1><p class="help">Grouped by area. Tap a group to open it. Only what you change is saved.</p>
    <div class="field"><label for="set-q">Find a setting</label><input id="set-q" placeholder="e.g. GST, discount, retention"></div><div id="settings-list">Loading...</div>`;
  api('/api/settings').then((d) => {
    const s = d.data.settings; const placed = new Set();
    const groups = SETTING_GROUPS.map(([name, note, test]) => {
      const keys = Object.keys(SETTING_LABELS).filter((k) => !placed.has(k) && test(k)); keys.forEach((k) => placed.add(k));
      return [name, note, keys];
    }).filter((g) => g[2].length);
    $('settings-list').innerHTML = groups.map(([name, note, keys], i) => `<details class="card set-group"${i === 0 ? ' open' : ''}><summary><b>${esc(name)}</b> <span class="muted">(${keys.length})</span><p class="muted" style="margin:2px 0 0">${esc(note)}</p></summary>
      ${keys.map((k) => { const [label, kind] = SETTING_LABELS[k]; return `<div class="field" data-label="${esc(label.toLowerCase())}"><label>${esc(label)}</label>${settingInput(k, kind, s[k])}</div>`; }).join('')}</details>`).join('')
      + '<button class="btn btn-primary" id="settings-save">Save settings</button>';
    const before = {}; $('settings-list').querySelectorAll('[data-key]').forEach((el) => { before[el.dataset.key] = el.value; });
    $('set-q').oninput = () => {
      const q = $('set-q').value.trim().toLowerCase();
      $('settings-list').querySelectorAll('.set-group').forEach((g) => {
        let any = false; g.querySelectorAll('.field').forEach((f) => { const hit = !q || f.dataset.label.includes(q); f.style.display = hit ? '' : 'none'; any = any || hit; });
        g.style.display = any ? '' : 'none'; if (q && any) g.open = true;
      });
    };
    $('settings-save').onclick = async () => {
      let n = 0;
      for (const el of $('settings-list').querySelectorAll('[data-key]')) {
        if (el.value === before[el.dataset.key]) continue;
        let v = el.value;
        if (el.dataset.kind === 'money') v = rupeesToPaise(v); else if (el.dataset.kind === 'number') v = Number(v);
        const ok = await act(api('/api/settings/' + encodeURIComponent(el.dataset.key), { method: 'POST', body: { value: v } }));
        if (!ok) return;
        before[el.dataset.key] = el.value; n++;
      }
      toast(n ? `Settings saved (${n} changed)` : 'Nothing was changed');
    };
  }).catch((e) => { $('settings-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
};

// ======================= Business Development =======================
const BD_STAGE_LABEL = { identified: 'Identified', follow_up: 'Follow-ups', feasibility: 'Feasibility study', process_79a: '79A process', da_signed: 'DA signed', da_registered: 'DA registered' };
const BD_STAGES = Object.keys(BD_STAGE_LABEL);
const BD_KINDS = [['society', 'Housing society (redevelopment)'], ['land', 'Land / plot'], ['jv', 'Joint venture'], ['other', 'Other']];
const BD_STATE = { status: 'open' };
const bdCan = (a) => ({ C: ['owner', 'pm'], E: ['owner', 'pm'], A: ['owner', 'pm'] }[a] || []).includes(currentUser.role);
const todayStr = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
async function bdUpload(file, title) {
  const fd = new FormData(); fd.append('file', typeof compressFile === 'function' ? await compressFile(file) : file, file.name);
  fd.append('title', title); fd.append('category', 'business_development'); fd.append('module', 'bd'); fd.append('audience', 'internal');
  const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); return up ? up.data.id : null;
}
const BD_HELP = `<details class="card"><summary><b>How this works</b></summary>
  <p>Every new project starts here. Add the society or land as an <b>opportunity</b>, then:</p>
  <p>1. <b>Follow-ups</b>: record each call or meeting and the next date (you get a reminder that day).<br>2. <b>Feasibility study</b>: attach the report and the cost and revenue figures.<br>
  3. <b>79A process</b> (societies only): tick each step as the society completes it.<br>4. <b>The paper that starts the project</b>: for a society, its appointment letter (after the 79A process); for land, the registered sale deed. A JV or other deal starts when its development agreement is registered.<br>
  5. <b>Open as project</b>: creates the project with its approvals list (CFO NOC, concessions, IOD, CC, OC...), the feasibility study and the society. The development agreement can be recorded before or after.</p>
  <p class="muted">Usual times: vacating to plinth CC 6 to 8 months; plinth CC to completion 36 months. Change them in Settings → Business development.</p></details>`;

async function renderBd(main) {
  main.innerHTML = `<div class="row"><h1>Business Development</h1>${bdCan('C') ? '<button class="btn btn-primary" id="bd-new">+ New opportunity</button>' : ''}</div>${BD_HELP}
    <div class="field"><label for="bd-status">Show</label><select id="bd-status"><option value="open">Open deals</option><option value="won">Won (became projects)</option><option value="lost">Lost</option><option value="dropped">Dropped</option></select></div>
    <div id="bd-list">Loading...</div>`;
  $('bd-status').value = BD_STATE.status;
  $('bd-status').onchange = () => { BD_STATE.status = $('bd-status').value; bdList(); };
  if ($('bd-new')) $('bd-new').onclick = bdNew;
  bdList();
}
async function bdList() {
  const box = $('bd-list'); if (!box) return;
  try {
    const d = (await api('/api/bd/opportunities?status=' + BD_STATE.status)).data; const list = d.opportunities;
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>${BD_STATE.status === 'open' ? 'No open deals yet. Add the first society or land you are talking to.' : 'Nothing here.'}</p>${BD_STATE.status === 'open' && bdCan('C') ? '<button class="btn btn-primary" id="bd-new2">+ New opportunity</button>' : ''}</div>`;
      if ($('bd-new2')) $('bd-new2').onclick = bdNew; return;
    }
    const today = todayStr();
    const due = list.filter((o) => o.status === 'open' && o.next_followup && o.next_followup <= today);
    const card = (o) => `<div class="card task-row${o.followup_late ? ' late' : ''}" data-bd="${o.id}" role="button" tabindex="0"><div class="row"><div><b>${esc(o.name)}</b>
      <p class="muted">${esc((BD_KINDS.find((k) => k[0] === o.kind) || [0, o.kind])[1])}${o.owner_name ? ' · ' + esc(o.owner_name) : ''}${o.members_count ? ' · ' + o.members_count + ' members' : ''}</p>
      <p>${o.next_followup ? chip('Follow up ' + o.next_followup, o.next_followup < today ? 'bad' : o.next_followup === today ? 'warn' : 'info') + ' ' : ''}${o.study_version ? chip('Study v' + o.study_version, 'good') + ' ' : ''}${o.kind === 'society' && o.steps_done ? chip(`79A ${o.steps_done}/${d.steps_total}`, o.steps_done >= d.steps_total ? 'good' : 'warn') + ' ' : ''}${o.project_name ? chip('Project: ' + o.project_name, 'good') : ''}${o.lost_reason ? `<span class="muted">${esc(o.lost_reason)}</span>` : ''}</p></div>
      <span class="muted">${esc(BD_STAGE_LABEL[o.stage] || o.stage)}</span></div></div>`;
    box.innerHTML = (due.length ? `<h3>Follow-ups due (${due.length})</h3>${due.map(card).join('')}` : '')
      + (BD_STATE.status === 'open'
        ? BD_STAGES.slice().reverse().map((st) => { const l = list.filter((o) => o.stage === st); return l.length ? `<h3>${esc(BD_STAGE_LABEL[st])} (${l.length})</h3>${l.map(card).join('')}` : ''; }).join('')
        : list.map(card).join(''));
    box.querySelectorAll('[data-bd]').forEach((c) => { c.onclick = () => bdDetail(Number(c.dataset.bd)); c.onkeydown = (e) => { if (e.key === 'Enter') bdDetail(Number(c.dataset.bd)); }; });
  } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
async function bdPeople() { try { return (await api('/api/bd/meta')).data; } catch (e) { return { people: [], steps_79a: [] }; } }
async function bdNew() {
  const meta = await bdPeople();
  const v = await openForm({ title: 'New opportunity', intro: 'A society or plot you are talking to. You can fill the rest later.', fields: [
    { name: 'name', label: 'Name (society or land)', required: true, placeholder: 'Shanti Niketan CHS, Andheri West' },
    { name: 'kind', label: 'Type', type: 'select', options: BD_KINDS },
    { name: 'address', label: 'Address' }, { name: 'ward', label: 'Ward', placeholder: 'K/W' },
    { name: 'members_count', label: 'Number of members / flats', type: 'number' }, { name: 'plot_area_sqm', label: 'Plot area (sq m)', type: 'number' },
    { name: 'contact_name', label: 'Contact person (secretary / owner)' }, { name: 'contact_phone', label: 'Contact mobile', type: 'tel' },
    { name: 'source', label: 'How it came to us', placeholder: 'Broker, member, PMC, tender notice...' },
    { name: 'owner_user_id', label: 'Our person in charge', type: 'select', options: [['', 'Me'], ...meta.people.map((p) => [p.id, p.name])] },
    { name: 'next_followup', label: 'First follow-up on', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea' },
  ] });
  if (!v) return;
  const r = await act(api('/api/bd/opportunities', { method: 'POST', body: v }), 'Opportunity added');
  if (r) bdDetail(r.data.id);
}

async function bdDetail(id) {
  const main = $('app-main'); main.innerHTML = '<p>Loading...</p>';
  let d; try { d = (await api('/api/bd/opportunities/' + id)).data; } catch (e) { main.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  const o = d.opportunity, open = o.status === 'open', at = BD_STAGES.indexOf(o.stage), society = o.kind === 'society';
  const stepsDone = d.steps.filter((x) => x.done_on).length;
  const fact = (l, v) => (v || v === 0 ? `<div class="fact"><span class="muted">${esc(l)}</span><b>${v}</b></div>` : '');
  const stages = BD_STAGES.filter((s) => society || s !== 'process_79a');
  // A society starts with its appointment letter after the 79A process; land when it is bought; a JV or other deal when its DA is registered.
  const paperDeal = society || o.kind === 'land', hasPaper = !!o.start_paper_doc_id;
  const nextAction = !open ? '' : paperDeal
    ? (society && stepsDone < d.steps.length ? (!d.studies.length ? (d.followups.length ? 'study' : 'followup') : 'steps') : !hasPaper ? 'paper' : 'convert')
    : o.stage === 'da_registered' ? 'convert' : o.stage === 'da_signed' ? 'registered' : !d.studies.length ? (d.followups.length ? 'study' : 'followup') : 'signed';
  const BTN = { followup: ['bd-fu', 'Add follow-up'], study: ['bd-study', 'Add feasibility study'], steps: ['bd-steps-go', 'Tick 79A steps'], signed: ['bd-signed', 'DA signed'], registered: ['bd-reg', 'DA registered'], convert: ['bd-convert', 'Open as project'],
    paper: ['bd-paper', society ? 'Record the appointment letter' : 'Record the land purchase'] };
  const daNext = !open ? '' : o.stage === 'da_registered' ? '' : o.stage === 'da_signed' ? 'registered' : (d.studies.length ? 'signed' : '');   // optional for a society or land deal
  const btn = (k, primary) => (bdCan(k === 'followup' || k === 'study' ? 'C' : 'A') ? `<button class="btn${primary ? ' btn-primary' : ''}" id="${BTN[k][0]}">${BTN[k][1]}</button>` : '');
  main.innerHTML = `<button class="btn small" id="bd-back">← All deals</button>
    <h1 style="margin-bottom:2px">${esc(o.name)}</h1>
    <p class="muted">${esc((BD_KINDS.find((k) => k[0] === o.kind) || [0, o.kind])[1])}${o.owner_name ? ' · in charge: ' + esc(o.owner_name) : ''} · ${open ? chip(BD_STAGE_LABEL[o.stage], 'info') : chip(o.status === 'won' ? 'Won' : o.status === 'lost' ? 'Lost' : 'Dropped', o.status === 'won' ? 'good' : 'bad')}</p>
    <div class="card"><div class="bd-steps" style="display:flex;flex-wrap:wrap;gap:6px">${stages.map((s) => { const i = BD_STAGES.indexOf(s); const past = i < at || (o.stage === 'da_registered' && i === at); return chip((past ? '✓ ' : '') + BD_STAGE_LABEL[s], past ? 'good' : i === at ? 'info' : ''); }).join(' ')}</div></div>
    ${o.project_id ? `<div class="card"><b>This deal is now a project.</b> <button class="btn small btn-primary" id="bd-open-project">Open the project</button></div>` : ''}
    ${o.override_note ? `<div class="card task-row late"><b>DA signed with 79A steps open</b><p class="muted">${esc(o.override_note)}</p></div>` : ''}
    ${open ? `<div class="row-btns" style="margin:12px 0">${nextAction ? btn(nextAction, true) : ''}${['followup', 'study', ...(paperDeal ? [hasPaper && nextAction !== 'paper' ? 'paper' : '', daNext] : [])].filter((k) => k && k !== nextAction).map((k) => btn(k)).join('')}${bdCan('E') ? '<button class="btn" id="bd-edit">Edit details</button><button class="btn" id="bd-close">Lost / dropped</button>' : ''}</div>` : ''}
    <h3>Details</h3><div class="card facts">${fact('Address', esc(o.address || ''))}${fact('Ward', esc(o.ward || ''))}${fact('Members / flats', o.members_count)}${fact('Plot area', o.plot_area_sqm ? o.plot_area_sqm + ' sq m' : '')}
      ${fact('Contact', o.contact_name || o.contact_phone ? `${esc(o.contact_name || '')} ${o.contact_phone ? `<a href="tel:${esc(o.contact_phone)}">${esc(o.contact_phone)}</a>` : ''}` : '')}${fact('Source', esc(o.source || ''))}
      ${fact('Next follow-up', esc(o.next_followup || ''))}${fact('DA signed', o.da_signed_on ? `${esc(o.da_signed_on)}${o.da_doc_id ? ` <a class="btn small" href="/api/files/download/${o.da_doc_id}?inline=1" target="_blank" rel="noopener">View</a>` : ''}` : '')}
      ${fact(society ? 'Appointment letter' : 'Land bought (sale deed)', o.start_paper_on ? `${esc(o.start_paper_ref || '')} dated ${esc(o.start_paper_on)}${o.start_paper_doc_id ? ` <a class="btn small" href="/api/files/download/${o.start_paper_doc_id}?inline=1" target="_blank" rel="noopener">View</a>` : ''}` : '')}
      ${fact('DA registered', o.da_registered_on ? `${esc(o.da_reg_no || '')} on ${esc(o.da_registered_on)}` : '')}${fact('Notes', esc(o.notes || ''))}${fact('Why closed', esc(o.lost_reason || ''))}</div>
    ${society ? `<h3 id="bd-79a">79A process (${stepsDone} of ${d.steps.length})</h3><p class="help">Steps the society takes to pick a developer. Confirm the exact procedure with your advocate.</p>
      ${d.steps.map((x, i) => `<div class="card"><div class="row"><div><b>${i + 1}. ${esc(x.step)}</b>${x.done_on ? `<p>${chip('Done ' + x.done_on, 'good')}${x.note ? ' <span class="muted">' + esc(x.note) + '</span>' : ''}${x.document_id ? ` <a class="btn small" href="/api/files/download/${x.document_id}?inline=1" target="_blank" rel="noopener">View paper</a>` : ''}</p>` : '<p class="muted">Not done yet</p>'}</div>
        ${open && bdCan('E') ? `<button class="btn small${x.done_on ? '' : ' btn-primary'}" data-step="${i}">${x.done_on ? 'Change' : 'Mark done'}</button>` : ''}</div></div>`).join('')}` : ''}
    <h3>Feasibility studies</h3>${d.studies.length ? d.studies.map((s) => `<div class="card"><b>v${s.version} · ${esc(s.title || 'Feasibility study')}</b> <span class="muted">${esc(s.study_date || '')}</span>
      <p>${s.est_cost_paise != null ? 'Cost ' + moneyP(s.est_cost_paise) : ''}${s.est_revenue_paise != null ? ' · Revenue ' + moneyP(s.est_revenue_paise) : ''}${s.est_cost_paise != null && s.est_revenue_paise != null ? ' · Surplus <b>' + moneyP(s.est_revenue_paise - s.est_cost_paise) + '</b>' : ''}${s.saleable_sqft ? ' · ' + Number(s.saleable_sqft).toLocaleString('en-IN') + ' sq ft saleable' : ''}${s.completion_months ? ' · ' + s.completion_months + ' months' : ''}</p>
      ${s.notes ? `<p class="muted">${esc(s.notes)}</p>` : ''}${s.document_id ? `<a class="btn small" href="/api/files/download/${s.document_id}?inline=1" target="_blank" rel="noopener">View report</a>` : ''}</div>`).join('') : '<p class="muted">No study yet.</p>'}
    <h3>Follow-ups</h3>${d.followups.length ? d.followups.map((f) => `<div class="card"><b>${esc(f.on_date)}</b> · ${esc(f.kind || '')} <span class="muted">${esc(f.by_name || '')}</span><p>${esc(f.note)}</p>${f.next_date ? `<p class="muted">Next: ${esc(f.next_date)}</p>` : ''}</div>`).join('') : '<p class="muted">No follow-ups recorded yet.</p>'}`;
  $('bd-back').onclick = () => renderBd(main);
  if ($('bd-open-project')) $('bd-open-project').onclick = () => { navigate('projects'); setTimeout(() => projectQuick(o.project_id), 50); };
  const again = () => bdDetail(id);
  const on = (el, fn) => { if ($(el)) $(el).onclick = fn; };
  on('bd-fu', async () => {
    const v = await openForm({ title: 'Follow-up', fields: [{ name: 'on_date', label: 'Date', type: 'date', value: todayStr() }, { name: 'kind', label: 'How', type: 'select', options: [['call', 'Phone call'], ['meeting', 'Meeting'], ['site_visit', 'Site visit'], ['email', 'Email / letter'], ['other', 'Other']] },
      { name: 'note', label: 'What was discussed', type: 'textarea', required: true }, { name: 'next_date', label: 'Next follow-up on (you get a reminder)', type: 'date' }] });
    if (v && await act(api(`/api/bd/opportunities/${id}/followups`, { method: 'POST', body: v }), 'Follow-up saved')) again();
  });
  on('bd-study', async () => {
    const v = await openForm({ title: 'Feasibility study', intro: 'Attach the report, or at least enter the estimated cost. Each new study becomes the next version.', fields: [
      { name: 'title', label: 'Title', value: 'Feasibility study' }, { name: 'study_date', label: 'Study date', type: 'date', value: todayStr() }, { name: 'file', label: 'Report (PDF or Excel)', type: 'file' },
      { name: 'est_cost_paise', label: 'Estimated total cost (₹)', type: 'money' }, { name: 'est_revenue_paise', label: 'Estimated sales revenue (₹)', type: 'money' },
      { name: 'saleable_sqft', label: 'Saleable area (sq ft)', type: 'number' }, { name: 'completion_months', label: 'Months to complete', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' }] });
    if (!v) return;
    const body = { ...v }; delete body.file;
    if (v.file) { body.document_id = await bdUpload(v.file, `${o.name} feasibility`); if (!body.document_id) return; }
    if (!v.file && (v.est_cost_paise === '' || v.est_cost_paise == null || Number.isNaN(v.est_cost_paise))) body.est_cost_paise = null;
    if (await act(api(`/api/bd/opportunities/${id}/studies`, { method: 'POST', body }), 'Study saved')) again();
  });
  on('bd-steps-go', () => { const h = $('bd-79a'); if (h) h.scrollIntoView({ behavior: 'smooth' }); });
  main.querySelectorAll('[data-step]').forEach((b) => { b.onclick = async () => {
    const x = d.steps[Number(b.dataset.step)];
    const v = await openForm({ title: '79A step', intro: x.step, fields: [{ name: 'done_on', label: 'Done on (leave empty to mark not done)', type: 'date', value: x.done_on || todayStr() }, { name: 'note', label: 'Note (e.g. resolution number)', value: x.note || '' }, { name: 'file', label: 'Paper (minutes, letter) — optional', type: 'file' }] });
    if (!v) return;
    const body = { step: x.step, done_on: v.done_on, note: v.note };
    if (v.file) { body.document_id = await bdUpload(v.file, `${o.name} — ${x.step}`.slice(0, 150)); if (!body.document_id) return; }
    if (await act(api(`/api/bd/opportunities/${id}/steps`, { method: 'POST', body }), 'Saved')) again();
  }; });
  on('bd-signed', async () => {
    const open79 = d.steps.filter((x) => !x.done_on).length;
    const fields = [{ name: 'da_signed_on', label: 'Signed on', type: 'date', required: true, value: todayStr() }, { name: 'file', label: 'Signed development agreement', type: 'file', required: true }];
    if (society && open79 && currentUser.role === 'owner') fields.push({ name: 'override_note', label: `${open79} of the 79A steps are not ticked. Why go ahead? (Owner only)`, type: 'textarea' });
    const v = await openForm({ title: 'Development agreement signed', intro: society && open79 ? `${open79} 79A step(s) are not ticked yet.` : '', fields });
    if (!v) return;
    const doc = await bdUpload(v.file, `${o.name} development agreement`); if (!doc) return;
    if (await act(api(`/api/bd/opportunities/${id}/da`, { method: 'POST', body: { action: 'signed', da_signed_on: v.da_signed_on, da_doc_id: doc, override_note: v.override_note || '' } }), 'DA signed')) again();
  });
  on('bd-reg', async () => {
    const v = await openForm({ title: 'Development agreement registered', fields: [{ name: 'da_reg_no', label: 'Registration number', required: true }, { name: 'da_registered_on', label: 'Registered on', type: 'date', required: true, value: todayStr() }] });
    if (v && await act(api(`/api/bd/opportunities/${id}/da`, { method: 'POST', body: { action: 'registered', ...v } }), 'DA registered')) again();
  });
  on('bd-paper', async () => {
    const v = await openForm({ title: society ? "Society's appointment letter" : 'Land purchase', intro: society ? 'The letter the society gives us after the 79A process (preferred developer / appointment). The project can be opened once it is recorded.' : 'The registered sale deed (or its Index-II). The project can be opened once it is recorded.', fields: [
      { name: 'on', label: society ? 'Date on the letter' : 'Sale deed registered on', type: 'date', required: true, value: todayStr() },
      { name: 'ref', label: society ? 'Letter number / reference' : 'Registration number', required: true },
      { name: 'file', label: society ? 'Scanned letter' : 'Scanned sale deed or Index-II', type: 'file', required: true }] });
    if (!v) return;
    const doc = await bdUpload(v.file, `${o.name} ${society ? 'appointment letter' : 'sale deed'}`); if (!doc) return;
    if (await act(api(`/api/bd/opportunities/${id}/start-paper`, { method: 'POST', body: { on: v.on, ref: v.ref, doc_id: doc } }), 'Saved')) again();
  });
  on('bd-convert', async () => {
    const v = await openForm({ title: 'Open as a project', intro: 'Creates the project with the approvals list (CFO NOC, concessions, IOD, CC, OC...), the site milestones up to plinth, the latest feasibility study' + (society ? ' and the society.' : '.'), fields: [
      { name: 'name', label: 'Project name', value: o.name, required: true }, { name: 'code', label: 'Short code (used in PO numbers)', required: true, placeholder: 'SHANTI' },
      { name: 'has_basement', type: 'checkbox', checkLabel: 'The building has a basement' }] });
    if (!v) return;
    const r = await act(api(`/api/bd/opportunities/${id}/convert`, { method: 'POST', body: v }), 'Project opened');
    if (r) { try { projectCache = null; } catch (e) { /* cache name differs */ } navigate('projects'); setTimeout(() => projectQuick(r.data.project_id), 50); }
  });
  on('bd-edit', async () => {
    const meta = await bdPeople();
    const v = await openForm({ title: 'Edit details', fields: [
      { name: 'owner_user_id', label: 'Our person in charge', type: 'select', value: o.owner_user_id || '', options: meta.people.map((p) => [p.id, p.name]) },
      { name: 'next_followup', label: 'Next follow-up', type: 'date', value: o.next_followup || '' },
      { name: 'contact_name', label: 'Contact person', value: o.contact_name || '' }, { name: 'contact_phone', label: 'Contact mobile', type: 'tel', value: o.contact_phone || '' },
      { name: 'address', label: 'Address', value: o.address || '' }, { name: 'ward', label: 'Ward', value: o.ward || '' },
      { name: 'members_count', label: 'Members / flats', type: 'number', value: o.members_count == null ? '' : o.members_count }, { name: 'plot_area_sqm', label: 'Plot area (sq m)', type: 'number', value: o.plot_area_sqm == null ? '' : o.plot_area_sqm },
      { name: 'source', label: 'Source', value: o.source || '' }, { name: 'notes', label: 'Notes', type: 'textarea', value: o.notes || '' }] });
    if (v && await act(api(`/api/bd/opportunities/${id}/edit`, { method: 'POST', body: v }), 'Saved')) again();
  });
  on('bd-close', async () => {
    const v = await openForm({ title: 'Close this deal', fields: [{ name: 'status', label: 'Result', type: 'select', options: [['lost', 'Lost (went to another developer)'], ['dropped', 'Dropped (we walked away)']] }, { name: 'reason', label: 'Why', type: 'textarea', required: true }] });
    if (v && await act(api(`/api/bd/opportunities/${id}/close`, { method: 'POST', body: v }), 'Closed')) again();
  });
}
PAGES.bd = (m) => renderBd(m);
Object.assign(ROUTE_TITLES, { bd: 'Business Development' });
Object.assign(ICONS, { bd: 'M3 12l4-4 4 3 6-6M14 5h3v3M4 20h16M6 20v-4M11 20v-6M16 20v-8' });
if (typeof NAV_GROUPS !== 'undefined' && !NAV_GROUPS[0][2].includes('bd')) NAV_GROUPS[0][2].unshift('bd');
const _sidebarItems28 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems28(role);
  if (['owner', 'pm', 'accounts', 'viewer'].includes(role) && !groups.some(([, items]) => items.some((i) => i.route === 'bd'))) {
    const item = { label: 'Business Development', route: 'bd', icon: 'bd' };
    const g = groups.find((x) => x[0] === 'Projects');
    if (g) g[1].unshift(item); else groups.splice(1, 0, ['Projects', [item]]);
  }
  return groups;
};

// ======================= Project life cycle (on the project page) =======================
function lcRow(pid, x, isNext, can) {
  const state = x.done ? chip('✓ ' + (x.on || 'Done'), 'good') : x.missing ? `<span class="muted">${['paaa', 'vacating'].includes(x.key) ? 'No members listed yet (Redevelopment)' : x.phase === 'Construction' && x.key !== 'further_cc' ? 'No site milestone yet' : 'Not in the approvals list'}</span>` : x.late ? chip('Late', 'bad') : isNext ? chip('Next', 'info') : '<span class="muted">Waiting</span>';
  const target = x.target ? `<p class="muted">Target ${esc(x.target)} (${esc(x.target_note || '')})</p>` : '';
  return `<div class="lc-step${x.done ? ' done' : ''}${isNext ? ' next' : ''}"><div class="row"><div><b>${esc(x.label)}</b>${x.detail ? ` <span class="muted">${esc(x.detail)}</span>` : ''}${x.note && !x.done ? `<p class="muted">${esc(x.note)}</p>` : ''}${target}</div>
    <div class="row-btns">${state}${x.manual && can ? ` <button class="btn small" data-lc="${x.key}">${x.done ? 'Change' : 'Mark done'}</button>` : ''}</div></div></div>`;
}
async function lifecycleSection(pid, host) {
  let d; try { d = (await api(`/api/projects/${pid}/lifecycle`)).data; } catch (e) { return; }
  const can = isRole('owner', 'pm');
  const phases = [...new Set(d.steps.map((x) => x.phase))];
  const done = d.steps.filter((x) => x.done).length;
  host.innerHTML = `<details class="card" id="pq-life" open><summary><b>Project life cycle</b> <span class="muted">${done} of ${d.steps.length} done${d.deal ? ' · from Business Development' : ''}</span></summary>
    ${phases.map((ph) => `<p class="lc-phase">${esc(ph)}</p>${d.steps.filter((x) => x.phase === ph).map((x) => lcRow(pid, x, x.key === d.next, can)).join('')}`).join('')}
    <p class="muted">Approvals come from Approvals, PAAA and vacating from Redevelopment, construction stages from Site. Targets: ${d.settings.vacate_to_plinth_months} months vacating → plinth CC, ${d.settings.completion_months} months plinth CC → OC (Settings → Business development).</p></details>`;
  host.querySelectorAll('[data-lc]').forEach((b) => { b.onclick = async () => {
    const x = d.steps.find((s) => s.key === b.dataset.lc);
    const fields = [{ name: 'done_on', label: 'Done on (leave empty to clear)', type: 'date', value: x.on || todayStr() }, { name: 'note', label: 'Note', value: x.done ? (x.detail || '') : '' }];
    const v = await openForm({ title: x.label, fields }); if (!v) return;
    let r = await api(`/api/projects/${pid}/lifecycle/${x.key}`, { method: 'POST', body: v }).catch((e) => e);
    if (r instanceof Error && /vacated/.test(r.message) && currentUser.role === 'owner') {
      const o = await openForm({ title: 'Not everyone has vacated', intro: r.message, fields: [{ name: 'override_note', label: 'Why go ahead?', type: 'textarea', required: true }] });
      if (!o) return; r = await act(api(`/api/projects/${pid}/lifecycle/${x.key}`, { method: 'POST', body: { ...v, ...o } }));
      if (!r) return;
    } else if (r instanceof Error) { toast(r.message, 6000); return; }
    toast('Saved'); lifecycleSection(pid, host);
  }; });
}
const _projectQuick28 = projectQuick;
projectQuick = async function (id) {
  await _projectQuick28(id);
  const main = $('app-main'); const anchor = main.querySelector('h3'); if (!anchor || $('pq-life-host')) return;
  const host = document.createElement('div'); host.id = 'pq-life-host'; anchor.parentNode.insertBefore(host, main.querySelector('#pq-holds') || anchor);
  lifecycleSection(id, host);
};
