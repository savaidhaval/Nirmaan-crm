// pages12.js — WP-15 RERA designated-account tracker, WP-19 site-visit feedback and check-in.

// ======================= WP-15 RERA ACCOUNT =======================
async function renderRera(main) {
  const projects = await projectOptions();
  if (!projects.length) { main.innerHTML = '<h1>RERA account</h1><div class="card"><p>No projects yet.</p></div>'; return; }
  main.innerHTML = `<h1>RERA account</h1><p class="help">Money buyers have paid, the share that should be in the project's designated account, and what has actually been deposited and withdrawn.</p>
    <div class="field"><label>Project</label><select id="rera-project">${projects.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div><div id="rera-body">Loading...</div>`;
  const pid = () => Number($('rera-project').value);
  $('rera-project').onchange = () => loadRera(pid());
  loadRera(pid());
}

async function loadRera(pid) {
  const body = $('rera-body'); if (!body) return;
  try {
    const [s, e] = await Promise.all([api(`/api/rera/summary?project_id=${pid}`), api(`/api/rera/entries?project_id=${pid}`)]);
    const d = s.data, canC = isRole('owner', 'accounts'), canX = isRole('owner', 'accounts', 'viewer');
    const pct = (d.pct_bp / 100).toFixed(d.pct_bp % 100 ? 1 : 0);
    body.innerHTML = `<div class="card"><p class="muted">Buyers have paid <b>${moneyP(d.realised_paise)}</b>. At ${pct}%, about <b>${moneyP(d.required_paise)}</b> should be in the designated account.</p>
      <p style="font-size:1.3em"><b>Deposited ${moneyP(d.deposited_paise)}</b></p>
      <p>${d.gap_paise > 0 ? chip('Still to deposit ' + moneyP(d.gap_paise), 'bad') : chip('Fully deposited', 'good')}</p>
      <p>Withdrawn: <b>${moneyP(d.withdrawn_paise)}</b><br>Balance in the account: <b>${moneyP(d.balance_paise)}</b></p>
      <p class="muted">For comparison: project cost recorded in the CRM ${moneyP(d.cost_incurred_paise)}; deposited amount in proportion to ${d.percent_complete}% completion ${moneyP(d.completion_estimate_paise)}.</p>
      <p class="muted">${esc(d.note)}</p></div>
      <div class="row-btns">${canC ? '<button class="btn btn-primary" id="rera-dep">+ Deposit</button><button class="btn" id="rera-wd">+ Withdrawal</button>' : ''}${canX ? `<a class="btn" href="/api/rera/entries?project_id=${pid}&csv=1">Statement for the CA (CSV)</a>` : ''}</div>
      <h3>Entries</h3>${e.data.entries.map((x) => `<div class="card" style="${x.reversed_at ? 'opacity:.6' : ''}"><div class="row"><div><b>${x.kind === 'deposit' ? '+' : '−'}${moneyP(x.amount_paise)}</b> · ${x.kind === 'deposit' ? 'deposit' : 'withdrawal'}<p class="muted">${esc(x.entry_date)}${x.ref_no ? ' · ' + esc(x.ref_no) : ''}${x.cert_ref ? ' · certificate ' + esc(x.cert_ref) : (x.kind === 'withdrawal' && !x.reversed_at ? ' · no certificate recorded' : '')}${x.note ? ' · ' + esc(x.note) : ''}</p></div>${x.reversed_at ? chip('Reversed', '') : ''}</div>
        ${canC && !x.reversed_at ? `<button class="btn small" data-rev="${x.id}">Reverse</button>` : ''}${x.reversal_note ? `<p class="muted">Reversed: ${esc(x.reversal_note)}</p>` : ''}</div>`).join('') || '<p class="muted">No deposits or withdrawals recorded yet. Record them from the bank statement.</p>'}`;
    const add = (kind) => async () => {
      const f = [{ name: 'amount_paise', label: kind === 'deposit' ? 'Amount deposited (₹)' : 'Amount withdrawn (₹)', type: 'money', required: true }, { name: 'entry_date', label: 'Date', type: 'date', value: today() }, { name: 'ref_no', label: 'Bank reference' }];
      if (kind === 'withdrawal') f.push({ name: 'cert_ref', label: 'Certificate reference (CA / engineer / architect)', help: 'Keep the certificate on file. A withdrawal without one is flagged.' });
      f.push({ name: 'note', label: 'Note' });
      const v = await openForm({ title: kind === 'deposit' ? 'Record a deposit' : 'Record a withdrawal', fields: f });
      if (!v) return;
      const r = await act(api('/api/rera/entries', { method: 'POST', body: { project_id: pid, kind, ...v } }), 'Recorded');
      if (r) { if (r.data.warnings && r.data.warnings.length) alert('Recorded. Please note:\n\n' + r.data.warnings.join('\n\n')); loadRera(pid); }
    };
    if ($('rera-dep')) { $('rera-dep').onclick = add('deposit'); $('rera-wd').onclick = add('withdrawal'); }
    body.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Reverse entry', fields: [{ name: 'reason', label: 'Why?', required: true }] }); if (v && await act(api(`/api/rera/entries/${b.dataset.rev}/reverse`, { method: 'POST', body: v }), 'Reversed')) loadRera(pid); }; });
  } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// ======================= WP-19 VISIT FEEDBACK AND CHECK-IN =======================
const VISIT_STEPS = [['', 'Not decided'], ['call_back', 'Call back'], ['second_visit', 'Second visit'], ['send_cost_sheet', 'Send a cost sheet'], ['ready_to_book', 'Ready to book'], ['not_interested', 'Not interested']];

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }), () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

// Marking a visit done: three taps of feedback, plus an optional check-in. A missing location never blocks saving.
async function visitDoneFlow(visitId) {
  let o = { objections: [] }; try { o = (await api('/api/sales/visit-options')).data; } catch (e) { /* use defaults */ }
  const v = await openForm({ title: 'How did the visit go?', fields: [
    { name: 'interest', label: 'How interested are they?', type: 'select', options: [['hot', 'Hot: likely to book'], ['warm', 'Warm: interested'], ['cold', 'Cold: not very interested']], value: 'warm' },
    { name: 'objection', label: 'Main objection', type: 'select', options: [['', 'None'], ...o.objections.map((x) => [x, x])] },
    { name: 'next_step', label: 'Next step', type: 'select', options: VISIT_STEPS },
    { name: 'feedback', label: 'Notes', type: 'textarea' },
    ...(navigator.geolocation ? [{ name: 'checkin', type: 'checkbox', label: 'Check in', checkLabel: 'Also record that I am at the site now (asks your phone for its location)' }] : [])] });
  if (!v) return false;
  const r = await act(api(`/api/sales/visits/${visitId}/status`, { method: 'POST', body: { status: 'done', feedback: v.feedback || '', interest: v.interest, objection: v.objection || undefined, next_step: v.next_step || undefined } }), 'Visit saved');
  if (!r) return false;
  if (v.checkin) {
    toast('Getting your location…', 4000);
    const pos = await getPosition();
    if (!pos) toast('Could not get your location. The visit was saved without it.', 6000);
    else { const c = await act(api(`/api/sales/visits/${visitId}/checkin`, { method: 'POST', body: pos })); if (c) toast(c.data.warning || (c.data.project_has_location ? 'Checked in at the site.' : 'Checked in. The project has no location set yet.'), 7000); }
  }
  return true;
}

async function setProjectLocation(projectId) {
  if (!navigator.geolocation) { toast('This phone cannot share its location.'); return; }
  if (!confirm('Stand at the site and use this phone\'s current location as the project location?')) return;
  toast('Getting your location…', 4000);
  const pos = await getPosition();
  if (!pos) { toast('Could not get the location. Allow location access and try again.', 6000); return; }
  if (await act(api(`/api/projects/${projectId}/location`, { method: 'POST', body: { lat: pos.lat, lng: pos.lng } }), 'Site location saved')) { if (typeof getProjects === 'function') await getProjects(true); loadProjects(); }
}
