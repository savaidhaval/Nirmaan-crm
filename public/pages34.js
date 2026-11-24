// pages34.js — Module 2, step 2: Reception check-in (buyer confirms on their own phone), Token holds (Accounts clears), Site updates (one-tap WhatsApp).
Object.assign(ICONS, { pricing: 'M4 7h16M4 12h16M4 17h10M18 15v4M16 17h4', reception: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', tokens: 'M12 3v18M17 7H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6', updates: 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5' });
Object.assign(ROUTE_TITLES, { pricing: 'Price list', reception: 'Reception check-in', tokens: 'Token holds', updates: 'Site updates' });
Object.assign(PAGES, { pricing: renderPricing, reception: renderReception, tokens: renderTokens, updates: renderUpdates });

const _sidebarItems34 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems34(role).map(([g, items]) => [g, [...items]]);
  const add = (label, route, after) => {
    for (const [, items] of groups) { const i = items.findIndex((x) => x.route === after); if (i >= 0) { items.splice(i + 1, 0, { label, route, icon: route }); return; } }
    groups[groups.length - 1][1].push({ label, route, icon: route });
  };
  if (['owner', 'pm', 'sales'].includes(role)) { add('Reception check-in', 'reception', 'sales'); add('Site updates', 'updates', 'reception'); }
  if (['owner', 'pm'].includes(role)) add('Price list', 'pricing', 'stacking');
  if (['owner', 'pm', 'accounts'].includes(role)) add('Token holds', 'tokens', ['owner', 'pm', 'sales'].includes(role) ? 'reception' : 'sales');
  return groups;
};

// ---------- Reception ----------
let recPoll = null;
async function renderReception(main) {
  clearInterval(recPoll);
  main.innerHTML = `<h1>Reception check-in</h1><p class="help">1. Type the buyer's name and mobile number (and the broker, if one came with them). 2. Show the QR to the buyer. 3. The buyer scans it with their own phone and taps Yes or No. A broker is locked to the buyer only after that Yes. No login and no SMS are needed.</p>
    <div class="card" id="rc-form"></div><div id="rc-live"></div><h2>Today</h2><div id="rc-list">Loading...</div>`;
  const projects = await getProjects().catch(() => []);
  let partners = []; try { partners = (await api('/api/sales/partner-names')).data.partners; } catch (e) { /* ignore */ }
  const pid = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : (projects[0] || {}).id;
  if (!pid) { $('rc-form').innerHTML = '<p>Create a project first.</p>'; return; }
  $('rc-form').innerHTML = `<label>Buyer's name<input id="rc-name" style="width:100%;min-height:48px;padding:0 14px;border:0;border-radius:14px;background:#f0f0f3;margin:6px 0 12px"></label>
    <label>Buyer's mobile number<input id="rc-phone" type="tel" inputmode="numeric" style="width:100%;min-height:48px;padding:0 14px;border:0;border-radius:14px;background:#f0f0f3;margin:6px 0 12px"></label>
    <label>Came with a broker?<select id="rc-partner" style="width:100%;min-height:48px;padding:0 14px;border:0;border-radius:14px;background:#f0f0f3;margin:6px 0 12px"><option value="">No, walked in alone</option>${partners.map((p) => `<option value="${p.id}">${esc(p.firm)}</option>`).join('')}</select></label>
    <button class="btn btn-primary btn-full" id="rc-go">Show QR for the buyer</button>`;
  $('rc-go').onclick = async () => {
    const body = { project_id: pid, name: $('rc-name').value, phone: $('rc-phone').value, partner_id: $('rc-partner').value ? Number($('rc-partner').value) : undefined };
    const r = await act(api('/api/sales/checkins', { method: 'POST', body })); if (!r) return;
    const c = r.data, url = location.origin + c.link;
    $('rc-live').innerHTML = `<div class="card" style="text-align:center"><h2>Buyer: scan this</h2>${c.returning ? `<p><b>Returning buyer</b>: first registered ${esc(c.returning.on)} as ${esc(c.returning.name)}.</p>` : ''}${c.conflict ? `<p class="error">${esc(c.conflict)}</p>` : ''}
      <p>${c.partner_firm ? 'They will be asked: did you come with <b>' + esc(c.partner_firm) + '</b>?' : 'They will be asked to confirm their visit.'}</p><div style="max-width:280px;margin:0 auto">${qrSvg(url, 280)}</div>
      <p class="muted">Valid for ${c.minutes} minutes. Or send the link: <a href="${waLink($('rc-phone').value, 'Please confirm your visit: ' + url)}" target="_blank" rel="noopener">WhatsApp it</a></p><p id="rc-state"><b>Waiting for the buyer...</b></p></div>`;
    $('rc-name').value = ''; $('rc-phone').value = '';
    clearInterval(recPoll);
    recPoll = setInterval(async () => {
      if (!$('rc-state')) { clearInterval(recPoll); return; }
      try { const row = (await api('/api/sales/checkins')).data.checkins.find((x) => x.id === c.id); if (row && row.status !== 'pending') { $('rc-state').innerHTML = row.status === 'confirmed' ? '<b style="color:#166534">Confirmed by the buyer.</b>' : '<b>The buyer said they came on their own.</b>'; clearInterval(recPoll); loadRecList(); } } catch (e) { /* retry */ }
    }, 4000);
    loadRecList();
  };
  loadRecList();
}
async function loadRecList() {
  const el = $('rc-list'); if (!el) return;
  try {
    const rows = (await api('/api/sales/checkins')).data.checkins;
    el.innerHTML = rows.map((r) => `<div class="card"><div class="row"><div><b>${esc(r.name)}</b><p class="muted">${esc(dateIST(r.created_at))}${r.firm ? ' · broker ' + esc(r.firm) : ''}${r.conflict_note ? '<br>' + esc(r.conflict_note) : ''}</p></div>${chip(r.status === 'pending' ? (r.expires_at < new Date().toISOString().replace('T', ' ').substring(0, 19) ? 'expired' : 'waiting') : r.status === 'confirmed' ? 'confirmed with broker' : 'came alone', r.status === 'confirmed' ? 'good' : r.status === 'pending' ? 'warn' : '')}</div></div>`).join('') || '<div class="empty-state"><p>No check-ins today.</p></div>';
  } catch (e) { el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ---------- Token holds (Accounts) ----------
async function renderTokens(main) {
  main.innerHTML = '<h1>Token holds</h1><p class="help">A salesperson blocked a flat and entered the token details. Check the bank, then tap Cleared (the flat stays blocked for the booking) or Not received (the flat goes back on sale). If you do nothing, it goes back on sale after 48 hours.</p><div id="tk-list">Loading...</div>';
  const load = async () => {
    try {
      const rows = (await api('/api/sales/token-holds')).data.tokens;
      $('tk-list').innerHTML = rows.map((t) => `<div class="card"><div class="row"><div><b>${esc(t.wing ? t.wing + '-' : '')}${esc(t.unit_no)} · ${moneyP(t.amount_paise)}</b><p class="muted">${esc(String(t.mode).toUpperCase())} ref <b>${esc(t.ref_no)}</b>${t.proof_doc_id ? ` · <a href="/api/files/download/${t.proof_doc_id}" target="_blank" rel="noopener">see the photo</a>` : ''}<br>${esc(t.lead_name || '')} · by ${esc(t.holder || '')}<br>Goes back on sale ${esc(dateIST(t.blocked_till))}</p></div></div>
        <div class="row-btns"><button class="btn small btn-primary" data-ok="${t.id}">Cleared</button><button class="btn small" data-no="${t.id}">Not received</button></div></div>`).join('') || '<div class="empty-state"><p>No tokens waiting.</p></div>';
      $('tk-list').querySelectorAll('[data-ok]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/sales/token-holds/${b.dataset.ok}/clear`, { method: 'POST' }), 'Token cleared')) load(); }; });
      $('tk-list').querySelectorAll('[data-no]').forEach((b) => { b.onclick = async () => { const v = await openForm({ title: 'Token not received', fields: [{ name: 'note', label: 'Why?', required: true }] }); if (v && await act(api(`/api/sales/token-holds/${b.dataset.no}/reject`, { method: 'POST', body: v }), 'The flat is back on sale')) load(); }; });
    } catch (e) { $('tk-list').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  load();
}

// ---------- Site updates: one-tap WhatsApp to warm buyers ----------
async function renderUpdates(main) {
  main.innerHTML = '<h1>Site updates</h1><p class="help">After a building stage is certified, send the news to buyers who liked a flat but have not booked. Each button opens your own WhatsApp with the message ready; you tap Send. Only buyers who agreed to be contacted are listed.</p><div id="up-out">Loading...</div>';
  const projects = await getProjects().catch(() => []);
  const pid = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : (projects[0] || {}).id;
  if (!pid) { $('up-out').innerHTML = '<p>Create a project first.</p>'; return; }
  try {
    const d = (await api('/api/sales/reengage?project_id=' + pid)).data;
    if (!d.milestones.length) { $('up-out').innerHTML = '<div class="empty-state"><p>No building stage was certified in the last 30 days.</p></div>'; return; }
    const msgFor = (l, m) => `Hello ${l.name}, good news from ${d.project.name}: "${m.name}"${m.wing ? ' (Wing ' + m.wing + ')' : ''} was completed on ${m.actual_date}.${d.project.rera_no ? ' MahaRERA: ' + d.project.rera_no + '.' : ''} We would be happy to show you the progress. Please reply to plan a visit.`;
    $('up-out').innerHTML = `<label>Stage<select id="up-ms" style="width:100%;min-height:48px;padding:0 14px;border:0;border-radius:14px;background:#f0f0f3;margin:6px 0 12px">${d.milestones.map((m, i) => `<option value="${i}">${esc(m.name)}${m.wing ? ' · wing ' + esc(m.wing) : ''} · ${esc(m.actual_date)}</option>`).join('')}</select></label><div id="up-leads"></div>`;
    const paint = () => { const m = d.milestones[Number($('up-ms').value)]; $('up-leads').innerHTML = d.leads.map((l) => `<div class="card"><div class="row"><div><b>${esc(l.name)}</b><p class="muted">${esc(l.phone)}</p></div><a class="btn small btn-primary" target="_blank" rel="noopener" href="${waLink(l.phone, msgFor(l, m))}">WhatsApp</a></div></div>`).join('') || '<div class="empty-state"><p>No warm buyers with consent yet. Mark visit feedback as Warm to see them here.</p></div>'; };
    $('up-ms').onchange = paint; paint();
  } catch (e) { $('up-out').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ---------- Price list (pricing matrix) ----------
async function renderPricing(main) {
  main.innerHTML = '<h1>Price list</h1><p class="help">One place for the rate the whole team quotes from: base rate per RERA carpet sq ft, floor rise, location charges (PLC), parking, club and development charges. Cost sheets then fill themselves from it. The Owner changes it; every change is recorded with a reason. Confirm the figures with your CA.</p><div id="pm-out">Loading...</div>';
  const projects = await getProjects().catch(() => []);
  const pid = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : (projects[0] || {}).id;
  if (!pid) { $('pm-out').innerHTML = '<p>Create a project first.</p>'; return; }
  const owner = currentUser.role === 'owner';
  const load = async () => {
    try {
      const d = (await api('/api/sales/price-matrix?project_id=' + pid)).data, m = d.matrix;
      $('pm-out').innerHTML = (m ? `<div class="card"><div class="kv"><span>Base rate</span><b>${moneyP(m.base_rate_paise)} / sq ft</b><span>Floor rise</span><b>${moneyP(m.rise_paise_per_floor)} / sq ft per floor, from floor ${m.rise_from_floor}</b><span>Car parking</span><b>${moneyP(m.parking_paise)} each</b><span>Club membership</span><b>${moneyP(m.club_paise)}</b><span>Development charges</span><b>${moneyP(m.dev_paise)}</b></div></div>
        <h3>Location charges (PLC)</h3>${d.plc.map((r) => `<p>• <b>${esc(r.label)}</b> for flats tagged <b>${esc(r.tag)}</b>: ${moneyP(r.amount_paise)}${r.kind === 'per_sqft' ? ' / sq ft' : ' per flat'}</p>`).join('') || '<p class="muted">None.</p>'}`
        : '<div class="empty-state"><p>No price list for this project yet.</p></div>')
        + (owner ? `<div class="row-btns"><button class="btn btn-primary" id="pm-edit">${m ? 'Change the price list' : 'Set the price list'}</button>${m ? '<button class="btn" id="pm-apply">Write it into the rate card of unbooked flats</button>' : ''}</div>` : '');
      if (!owner) return;
      $('pm-edit').onclick = async () => {
        const v = await openForm({ title: 'Price list', intro: 'Amounts in rupees. Floor rise is per sq ft for each floor from the floor you name upward. Tag flats (for example garden, corner) from the flat card on the Stacking plan.', fields: [
          { name: 'base_rate_paise', label: 'Base rate per sq ft (₹)', type: 'money', required: true, value: m ? m.base_rate_paise / 100 : '' }, { name: 'rise_paise_per_floor', label: 'Floor rise per sq ft per floor (₹)', type: 'money', value: m ? m.rise_paise_per_floor / 100 : '' }, { name: 'rise_from_floor', label: 'Floor rise starts from floor', type: 'number', value: m ? m.rise_from_floor : 1 },
          { name: 'parking_paise', label: 'Car parking, each (₹)', type: 'money', value: m ? m.parking_paise / 100 : '' }, { name: 'club_paise', label: 'Club membership (₹)', type: 'money', value: m ? m.club_paise / 100 : '' }, { name: 'dev_paise', label: 'Development charges (₹)', type: 'money', value: m ? m.dev_paise / 100 : '' },
          { name: 'plc', label: 'Location charges, one per line: tag | name | per_sqft or flat | amount', type: 'textarea', placeholder: 'garden | Garden view | per_sqft | 15000\ncorner | Corner flat | flat | 500000', value: d.plc.map((r) => `${r.tag} | ${r.label} | ${r.kind} | ${r.amount_paise / 100}`).join('\n') },
          { name: 'reason', label: 'Reason for the change', required: true }] });
        if (!v) return;
        const plc = String(v.plc || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [tag, label, kind, amt] = l.split('|').map((x) => x.trim()); return { tag, label, kind: kind === 'flat' ? 'flat' : 'per_sqft', amount_paise: rupeesToPaise(amt || '') }; });
        if (await act(api('/api/sales/price-matrix', { method: 'POST', body: { project_id: pid, ...v, rise_from_floor: Number(v.rise_from_floor) || 1, plc } }), 'Saved')) load();
      };
      if ($('pm-apply')) $('pm-apply').onclick = async () => { const v = await openForm({ title: 'Write into the rate card', intro: 'Sets the price and floor rise of every flat that is not booked, from the price list. Booked flats are never changed.', fields: [{ name: 'reason', label: 'Reason', required: true }] }); if (v) { const r = await act(api('/api/sales/price-matrix/apply', { method: 'POST', body: { project_id: pid, reason: v.reason } })); if (r) toast(r.data.changed + ' flats updated'); } };
    } catch (e) { $('pm-out').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  load();
}

// ---------- Owner override: a call the server refused for the CC floor or the BOQ cap can be repeated by the Owner with a written reason ----------
async function postWithOwnerOverride(path, body, okMsg) {
  for (let tries = 0; tries < 3; tries++) {
    try { const r = await api(path, { method: 'POST', body }); if (okMsg) toast(okMsg); return r; }
    catch (e) {
      const code = e.data && e.data.code;
      if (['cc', 'boq_cap', 'backdate_reason'].includes(code) && currentUser.role === 'owner') {
        const x = await openForm({ title: 'Go ahead anyway?', intro: e.message, fields: [{ name: 'why', label: 'Your reason (at least 10 letters)', required: true }] });
        if (!x) return null;
        body[{ cc: 'override_note', boq_cap: 'boq_override_note', backdate_reason: 'backdate_reason' }[code]] = x.why; continue;
      }
      toast(e.message, 7000); return null;
    }
  }
  return null;
}
