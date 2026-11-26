// pages14.js — WP-16: send many demand letters at once (email), or print them as one sheet.

const _sidebarItems14 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems14(role).map((g) => [g[0], g[1].slice()]);
  if (['owner', 'pm', 'accounts', 'sales'].includes(role)) {
    const g = groups.find((x) => x[0] === 'Money') || groups.find((x) => x[0] === null);
    if (g) g[1].push({ label: 'Demand letters', route: 'demandletters', icon: 'demandletters' });
  }
  return groups;
};

async function renderDemandLetters(main) {
  const projects = await projectOptions();
  main.innerHTML = `<h1>Demand letters</h1><p class="help">Payment demands that are ready to go out. Tick the ones you want, then send them all by email in one go, or print them as one sheet.</p>
    <div class="field"><label>Project</label><select id="dl-project"><option value="0">All projects</option>${projects.map(([v, l]) => `<option value="${esc(v)}"${pickedProject(v)}>${esc(l)}</option>`).join('')}</select></div><div id="dl-body">Loading...</div>`;
  $('dl-project').onchange = () => loadDemandLetters();
  loadDemandLetters();
}

const dlFlat = (x) => (x.wing ? x.wing + '-' : '') + x.unit_no;

async function loadDemandLetters(selected) {
  const body = $('dl-body'); if (!body) return;
  try {
    const pid = Number($('dl-project').value) || 0;
    const r = (await api('/api/sales/ready-demands' + (pid ? `?project_id=${pid}` : ''))).data, list = r.demands;
    const canSend = isRole('owner', 'pm', 'sales', 'accounts');
    const pre = selected || new Set(list.filter((x) => x.has_email && !x.sent_at).map((x) => x.id).slice(0, r.max_per_run));
    body.innerHTML = list.length ? `
      <div class="card"><p class="muted">Emails sent today: <b>${r.sent_today}</b> of a daily limit of <b>${r.daily_limit}</b> (change it in Settings).</p>
        <div class="row-btns"><button class="btn small" id="dl-all">Tick all not yet sent</button><button class="btn small" id="dl-none">Untick all</button></div></div>
      ${list.map((x) => `<label class="card" style="display:flex;gap:12px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="dl-cb" value="${x.id}" style="width:24px;height:24px;margin-top:4px"${pre.has(x.id) ? ' checked' : ''}>
        <div style="flex:1"><b>${esc(x.customer_name)}</b> · ${esc(x.project_name)} ${esc(dlFlat(x))}<p class="muted">${esc(x.label)} · due ${esc(x.due_date || 'on demand')} · <b>${moneyP(x.due_paise)}</b></p>
        ${x.sent_at ? chip('Sent ' + dateIST(x.sent_at).substring(0, 10), 'good') : ''} ${x.has_email ? '' : `${chip('No email address', 'warn')} <button class="btn small" data-em="${x.booking_id}">Add email</button>`} ${x.demand_no ? `<span class="muted">${esc(x.demand_no)}</span>` : ''}</div></label>`).join('')}
      <div class="card" style="position:sticky;bottom:64px"><p id="dl-count" class="muted"></p><div class="row-btns">
        ${canSend ? '<button class="btn btn-primary" id="dl-send">Send selected by email</button>' : ''}<button class="btn" id="dl-preview">Preview first letter</button><span id="dl-print"></span></div></div>
      <div id="dl-result"></div>` : '<div class="empty-state"><p>No demands are ready right now. They appear here when a construction stage is marked done.</p></div>';
    if (!list.length) return;
    const ticked = () => [...body.querySelectorAll('.dl-cb')].filter((c) => c.checked).map((c) => Number(c.value));
    const refresh = () => {
      const t = ticked(); const n = t.length, noMail = list.filter((x) => t.includes(x.id) && !x.has_email).length, resent = list.filter((x) => t.includes(x.id) && x.sent_at).length;
      $('dl-count').textContent = `${n} ticked${noMail ? ` · ${noMail} have no email (they will be skipped)` : ''}${resent ? ` · ${resent} already sent before` : ''}${n > r.max_per_run ? ` · too many: send at most ${r.max_per_run} at a time` : ''}`;
      const chunks = []; for (let i = 0; i < t.length; i += r.max_print) chunks.push(t.slice(i, i + r.max_print));
      $('dl-print').innerHTML = chunks.map((c, i) => `<a class="btn" target="_blank" rel="noopener" href="/print.html?k=demandbatch&ids=${c.join(',')}">Print ${chunks.length > 1 ? 'sheet ' + (i + 1) + ' of ' + chunks.length : 'as one sheet'}</a>`).join('');
    };
    body.querySelectorAll('.dl-cb').forEach((c) => { c.onchange = refresh; });
    body.querySelectorAll('[data-em]').forEach((b) => { b.onclick = async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const v = await openForm({ title: 'Customer email', fields: [{ name: 'email', label: 'Email address', type: 'email', required: true }] });
      if (v && await act(api(`/api/sales/bookings/${b.dataset.em}/email`, { method: 'POST', body: { email: v.email } }), 'Email saved')) loadDemandLetters(new Set(ticked()));
    }; });
    $('dl-all').onclick = () => { body.querySelectorAll('.dl-cb').forEach((c, i) => { c.checked = !list[i].sent_at && list[i].has_email; }); refresh(); };
    $('dl-none').onclick = () => { body.querySelectorAll('.dl-cb').forEach((c) => { c.checked = false; }); refresh(); };
    $('dl-preview').onclick = () => { const t = ticked(); if (!t.length) { toast('Tick a demand first.'); return; } window.open(`/print.html?k=demand&id=${t[0]}`, '_blank', 'noopener'); };
    if ($('dl-send')) $('dl-send').onclick = async () => {
      const t = ticked(); if (!t.length) { toast('Tick at least one demand.'); return; }
      if (!confirm(`Email ${t.length} demand letter(s) to the customers now? Each customer gets the letter in the email and a link to a printable copy.`)) return;
      const s = await act(api('/api/sales/bulk-demands', { method: 'POST', body: { demand_ids: t } })); if (!s) return;
      if (s.data.skipped.length) toast(`${s.data.skipped.length} left out: ${s.data.skipped[0].reason}`, 6000);
      runBulk(s.data.run_id);
    };
    refresh();
  } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// Keep asking the server for the next few letters until the run is finished (each request sends only a few: free-plan limit).
async function runBulk(runId) {
  const box = $('dl-result'); if (!box) return;
  if ($('dl-send')) $('dl-send').disabled = true;
  let stop = false;
  for (let guard = 0; guard < 60 && !stop; guard++) {
    let r;
    try { r = (await api(`/api/sales/bulk-demands/${runId}/process`, { method: 'POST' })).data; } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)} Open this screen again and press "Continue sending".</div>`; break; }
    const c = r.counts, total = c.queued + c.sent + c.failed + c.skipped;
    box.innerHTML = `<div class="card"><h3>Sending…</h3>${CH.meter(c.sent + c.failed + c.skipped, total, { text: `${c.sent + c.failed + c.skipped} of ${total}` })}<p class="muted">Please keep this screen open.</p></div>`;
    if (r.paused === 'daily_limit') { box.insertAdjacentHTML('afterbegin', `<div class="error">Today's email limit (${r.daily_limit}) is reached. The rest will wait. Press "Continue sending" tomorrow.</div>`); stop = true; }
    if (r.done) stop = true;
  }
  await showRun(runId);
  if ($('dl-send')) $('dl-send').disabled = false;
}

async function showRun(runId) {
  const box = $('dl-result'); if (!box) return;
  const d = (await api(`/api/sales/bulk-demands/${runId}`)).data, c = d.counts, bad = d.items.filter((i) => i.status === 'failed' || i.status === 'skipped');
  box.innerHTML = `<div class="card"><h3>Result</h3><div class="stat-row"><div class="stat"><b>${c.sent}</b><span>Sent</span></div><div class="stat"><b>${c.failed}</b><span>Failed</span></div><div class="stat"><b>${c.skipped}</b><span>Skipped</span></div><div class="stat"><b>${c.queued}</b><span>Waiting</span></div></div>
    ${bad.map((i) => `<p>${chip(i.status === 'failed' ? 'Failed' : 'Skipped', i.status === 'failed' ? 'bad' : 'warn')} <b>${esc(i.customer_name)}</b> ${esc(dlFlat(i))}: ${esc(i.error || '')}</p>`).join('')}
    <div class="row-btns">${c.failed ? '<button class="btn btn-primary" id="dl-retry">Retry the failed ones</button>' : ''}${c.queued ? '<button class="btn btn-primary" id="dl-cont">Continue sending</button>' : ''}<a class="btn" href="/api/sales/bulk-demands/${runId}?csv=1">Download list (Excel)</a></div></div>`;
  if ($('dl-retry')) $('dl-retry').onclick = async () => { if (await act(api(`/api/sales/bulk-demands/${runId}/retry`, { method: 'POST' }))) runBulk(runId); };
  if ($('dl-cont')) $('dl-cont').onclick = () => runBulk(runId);
}

PAGES.demandletters = (m) => renderDemandLetters(m);
Object.assign(ROUTE_TITLES, { demandletters: 'Demand letters' });
Object.assign(ICONS, { demandletters: 'M4 6h16v12H4zM4 7l8 6 8-6' });
