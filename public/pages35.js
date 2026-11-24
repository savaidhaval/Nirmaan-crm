// pages35.js — Module 3, step 2: slab sign-offs (Site Engineer + RCC consultant report), cost-to-complete meter.
Object.assign(ICONS, { costmeter: 'M4 20V10M10 20V4M16 20v-7M22 20H2' });
Object.assign(ROUTE_TITLES, { costmeter: 'Cost to complete' });
Object.assign(PAGES, { costmeter: renderCostMeter });

const _sidebarItems35 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems35(role).map(([g, items]) => [g, [...items]]);
  if (['owner', 'pm', 'accounts'].includes(role)) {
    const item = { label: 'Cost to complete', route: 'costmeter', icon: 'costmeter' };
    let done = false;
    for (const [, items] of groups) { const i = items.findIndex((x) => x.route === 'budget'); if (i >= 0) { items.splice(i + 1, 0, item); done = true; break; } }
    if (!done) groups[groups.length - 1][1].push(item);
  }
  return groups;
};

// ---------- Sign-offs on a stage that releases buyer demand letters ----------
async function msSignoffs(m) {
  const load = async () => (await api(`/api/site/milestones/${m.id}/signoffs`)).data;
  let d; try { d = await load(); } catch (e) { toast(e.message); return; }
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  const row = (kind, title, help) => {
    const s = d.signoffs.find((x) => x.kind === kind);
    const state = !s ? chip('Not uploaded', 'warn') : (kind === 'rcc_consultant' && !s.confirmed_at ? chip('Waiting for the Owner', 'warn') : chip(kind === 'rcc_consultant' ? 'Confirmed' : 'Done', 'good'));
    return `<div class="card"><div class="row"><div><b>${esc(title)}</b><p class="muted">${esc(help)}</p>${s ? `<p class="muted">Uploaded by ${esc(s.uploaded_by_name || '')} · ${esc(dateIST(s.uploaded_at))}${s.confirmed_by_name ? ' · confirmed by ' + esc(s.confirmed_by_name) : ''}${s.note ? '<br>' + esc(s.note) : ''}</p>` : ''}</div>${state}</div>
      <div class="row-btns">${s ? `<a class="btn small" target="_blank" rel="noopener" href="/api/files/download/${s.document_id}">See it</a>` : ''}${m.status !== 'done' ? `<button class="btn small btn-primary" data-up="${kind}">${s ? 'Upload a new one' : 'Upload'}</button>` : ''}${kind === 'rcc_consultant' && s && !s.confirmed_at && currentUser.role === 'owner' ? `<button class="btn small btn-primary" data-conf="${s.id}">Confirm</button>` : ''}</div></div>`;
  };
  ov.innerHTML = `<div class="modal"><h2>Sign-offs · ${esc(m.name)}${m.wing ? ' · ' + esc(m.wing) : ''}</h2><p class="muted">${d.needed ? 'Buyers are asked to pay for this stage, so it can be certified only after both sign-offs.' : 'Sign-offs are optional for this stage.'}</p>
    ${row('site_engineer', 'Site Engineer sign-off', 'A photo of the stage with the signed checklist.')}${row('rcc_consultant', 'RCC consultant\'s inspection report', 'The consultant signs on site. Anyone on the team can photograph and upload it; the Owner confirms it.')}
    <div class="modal-actions"><button class="btn btn-primary" id="so-x">Close</button></div></div>`;
  document.body.appendChild(ov); $('so-x').onclick = () => ov.remove();
  const again = () => { ov.remove(); msSignoffs(m); };
  ov.querySelectorAll('[data-up]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Upload', fields: [{ name: 'file', label: 'Photo or scan', type: 'file', required: true }, { name: 'note', label: 'Note (optional)' }] }); if (!v) return;
    const fd = new FormData(); fd.append('file', await compressFile(v.file), v.file.name); fd.append('title', (b.dataset.up === 'rcc_consultant' ? 'RCC report ' : 'Site sign-off ') + m.name); fd.append('category', 'certificate'); fd.append('module', 'site'); fd.append('project_id', String(m.project_id)); fd.append('audience', 'internal');
    const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return;
    if (await act(api(`/api/site/milestones/${m.id}/signoffs`, { method: 'POST', body: { kind: b.dataset.up, document_id: up.data.id, note: v.note } }), 'Saved')) again();
  }; });
  ov.querySelectorAll('[data-conf]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/site/signoffs/${b.dataset.conf}/confirm`, { method: 'POST' }), 'Confirmed')) again(); }; });
}

// ---------- Cost-to-complete ----------
async function renderCostMeter(main) {
  main.innerHTML = '<h1>Cost to complete</h1><p class="help">What has been spent against the budget, how much of the building is physically done, and what the project would cost at that pace. Completion is the lower of the certified stages and the PM\'s own figure; a wing counts as complete only when both say 100%.</p><div id="cm-out">Loading...</div>';
  const projects = await getProjects().catch(() => []);
  const pid = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : (projects[0] || {}).id;
  if (!pid) { $('cm-out').innerHTML = '<p>Create a project first.</p>'; return; }
  const pct = (bp) => bp == null ? '—' : (bp / 100).toFixed(bp % 100 ? 1 : 0) + '%';
  const load = async () => {
    try {
      const d = (await api('/api/budget/cost-to-complete?project_id=' + pid)).data;
      const canSet = ['owner', 'pm'].includes(currentUser.role);
      $('cm-out').innerHTML = `<div class="card"><div class="kv"><span>Budget</span><b>${moneyP(d.budget_paise)}</b><span>Spent so far</span><b>${moneyP(d.spent_paise)}${d.spent_pct_bp != null ? ' (' + pct(d.spent_pct_bp) + ' of budget)' : ''}</b><span>Physically complete</span><b>${pct(d.completion_pct_bp)}${d.all_complete ? ' · every wing confirmed complete' : ''}</b>
        <span>At this pace the project costs</span><b>${d.projected_total_paise != null ? moneyP(d.projected_total_paise) : 'not enough progress to say'}</b>${d.projected_over_paise ? `<span>Over budget by</span><b style="color:#b91c1c">${moneyP(d.projected_over_paise)}</b>` : ''}</div>
        ${typeof CH !== 'undefined' && d.completion_pct_bp != null && d.spent_pct_bp != null ? `<p class="muted">Spent ${pct(d.spent_pct_bp)} · done ${pct(d.completion_pct_bp)}</p>` : ''}</div>
        <h3>By wing</h3>${d.wings.map((w) => `<div class="card"><div class="row"><div><b>${esc(w.wing || 'Whole building')}</b><p class="muted">Certified stages ${pct(w.milestone_pct_bp)} · PM's figure ${pct(w.pm_pct_bp)}${w.pm_updated_at ? ' (' + esc(dateIST(w.pm_updated_at)) + ')' : ''}</p></div>${w.complete ? chip('Complete', 'good') : chip('Using ' + pct(w.used_pct_bp), '')}</div>${canSet ? `<button class="btn small" data-wp="${esc(w.wing)}">Enter completion</button>` : ''}</div>`).join('')}
        <p class="help">${esc(d.note)}</p>`;
      $('cm-out').querySelectorAll('[data-wp]').forEach((b) => { b.onclick = async () => {
        const v = await openForm({ title: 'Physical completion: ' + (b.dataset.wp || 'whole building'), fields: [{ name: 'pct', label: 'Completed so far (%)', type: 'number', required: true }, { name: 'note', label: 'Note (optional)' }] });
        if (v && await act(api('/api/site/wing-progress', { method: 'POST', body: { project_id: pid, wing: b.dataset.wp, pct: Number(v.pct), note: v.note } }), 'Saved')) load();
      }; });
    } catch (e) { $('cm-out').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  load();
}
