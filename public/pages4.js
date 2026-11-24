// pages4.js — executive layer: interactive stacking plan, charts (custom SVG), booking controls, audit filters.
// Loaded after pages3.js.

Object.assign(ICONS, {
  stacking: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
});
Object.assign(ROUTE_TITLES, { stacking: 'Stacking plan', reports: 'Reports' });
Object.assign(PAGES, { stacking: renderStacking, reports: renderReports, audit: (m) => renderAudit(m) });

// --- navigation: add Stacking plan + Reports where the role may use them
const _sidebarItems = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems(role).map(([g, items]) => [g, [...items]]);
  const add = (label, route, icon, after) => {
    for (const [, items] of groups) { const i = items.findIndex((x) => x.route === after); if (i >= 0) { items.splice(i + 1, 0, { label, route, icon }); return; } }
    groups[groups.length - 1][1].push({ label, route, icon });   // role has no anchor item: append to its last group
  };
  if (['owner', 'pm', 'sales', 'accounts'].includes(role)) add('Stacking plan', 'stacking', 'stacking', 'sales');
  if (['owner', 'pm', 'accounts', 'viewer'].includes(role)) add('Reports', 'reports', 'reports', ['owner', 'pm', 'accounts'].includes(role) ? 'stacking' : 'sales');
  return groups;
};
const _bottomNav = getBottomNavItems;
getBottomNavItems = function (role) {
  const items = _bottomNav(role);
  if (role === 'owner') { const i = items.findIndex((x) => x.route === 'sales'); if (i >= 0) items.splice(i + 1, 1, { label: 'Stacking', route: 'stacking', icon: 'stacking' }); }
  return items;
};

// ---------- SVG helpers ----------
const SV = {
  bars(data, { w = 560, h = 190, keys, colors, fmt = (v) => moneyP(v) }) {
    const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => d[k] || 0)));
    const gw = (w - 40) / Math.max(data.length, 1); const bw = Math.max(6, Math.min(26, gw / (keys.length + 1)));
    const y = (v) => h - 28 - ((h - 50) * v) / max;
    let g = '';
    [0, 0.5, 1].forEach((f) => { const yy = y(max * f); g += `<line x1="36" x2="${w}" y1="${yy}" y2="${yy}" stroke="#e2e8f0" stroke-dasharray="3 3"/><text x="32" y="${yy + 4}" text-anchor="end" font-size="10" fill="#64748b">${esc(shortMoney(max * f))}</text>`; });
    data.forEach((d, i) => {
      const x0 = 40 + i * gw + (gw - bw * keys.length - 3 * (keys.length - 1)) / 2;
      keys.forEach((k, j) => { const v = d[k] || 0; const bh = Math.max((h - 28) - y(v), v ? 2 : 0); g += `<rect class="bar" x="${x0 + j * (bw + 3)}" y="${h - 28 - bh}" width="${bw}" height="${bh}" rx="4" fill="${colors[j]}"><title>${esc(d.label)} — ${esc(keys[j])}: ${esc(fmt(v))}</title></rect>`; });
      g += `<text x="${40 + i * gw + gw / 2}" y="${h - 10}" text-anchor="middle" font-size="10" fill="#64748b">${esc(d.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img">${g}</svg>`;
  },
  donut(parts, { size = 150, label = '' }) {
    const total = parts.reduce((t, p) => t + p.value, 0) || 1; const r = 56; const c = 2 * Math.PI * r; let off = 0;
    const segs = parts.filter((p) => p.value > 0).map((p) => { const len = (p.value / total) * c; const s = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"><title>${esc(p.label)}: ${p.value}</title></circle>`; off += len; return s; }).join('');
    return `<svg viewBox="0 0 150 150" width="${size}" height="${size}" class="chart" role="img"><circle cx="75" cy="75" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="22"/>${segs}<text x="75" y="72" text-anchor="middle" font-size="22" font-weight="800" fill="#0f172a">${total === 1 && !parts.some((p) => p.value) ? 0 : total}</text><text x="75" y="90" text-anchor="middle" font-size="10" fill="#64748b">${esc(label)}</text></svg>`;
  },
  hbar(pct, color) { return `<div class="hbar"><div style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></div></div>`; },
  building() {
    return `<svg viewBox="0 0 220 150" width="190" class="illus" aria-hidden="true"><defs><linearGradient id="bg1" x1="0" x2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".18"/><stop offset="1" stop-color="var(--brand)" stop-opacity=".05"/></linearGradient></defs>
      <rect x="0" y="118" width="220" height="3" rx="1.5" fill="#cbd5e1"/><rect x="28" y="40" width="64" height="78" rx="4" fill="url(#bg1)" stroke="var(--brand)" stroke-width="2"/><rect x="104" y="18" width="70" height="100" rx="4" fill="url(#bg1)" stroke="var(--brand)" stroke-width="2"/>
      ${[0, 1, 2, 3].map((r) => [0, 1].map((c) => `<rect x="${38 + c * 28}" y="${50 + r * 17}" width="14" height="9" rx="2" fill="var(--brand)" opacity="${0.25 + ((r + c) % 3) * 0.2}"/>`).join('')).join('')}
      ${[0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => `<rect x="${113 + c * 20}" y="${28 + r * 17}" width="12" height="9" rx="2" fill="var(--brand)" opacity="${0.25 + ((r * 2 + c) % 3) * 0.2}"/>`).join('')).join('')}
      <rect x="132" y="100" width="14" height="18" rx="2" fill="var(--brand)"/><circle cx="190" cy="104" r="10" fill="#bbf7d0"/><rect x="188" y="110" width="4" height="8" fill="#86efac"/></svg>`;
  },
};
function shortMoney(p) { const r = Number(p) / 100; if (r >= 1e7) return (r / 1e7).toFixed(1) + 'Cr'; if (r >= 1e5) return (r / 1e5).toFixed(1) + 'L'; if (r >= 1e3) return (r / 1e3).toFixed(0) + 'k'; return String(Math.round(r)); }
const emptyIllus = (msg) => `<div class="empty-state">${SV.building()}<p>${esc(msg)}</p></div>`;

// ---------- Stacking plan ----------
const STACK = { available: ['Available', '#dcfce7', '#166534'], token_locked: ['Token locked', '#fef3c7', '#92400e'], booked: ['Booked', '#dbeafe', '#1e40af'], registered: ['Registered', '#e9d5ff', '#6b21a8'], possessed: ['Handed over', '#ccfbf1', '#115e59'], rehab: ['Rehab', '#e5e7eb', '#374151'], landowner: ['Landowner', '#e0e7ff', '#3730a3'], not_open: ['Not open yet (above CC)', '#f3f4f6', '#6b7280'] };
let stackProject = 0;

async function renderStacking(main) {
  main.innerHTML = `<h1>Stacking plan</h1><div class="brandbar"><select id="stk-proj"></select><button class="btn small" id="stk-add">+ Add flat</button></div><div id="stacking-out">Loading...</div>`;
  const projects = await getProjects().catch(() => []);
  if (!projects.length) { $('stacking-out').innerHTML = emptyIllus('Create a project first.'); return; }
  if (!projects.some((p) => p.id === stackProject)) stackProject = scopeProject && projects.some((p) => p.id === scopeProject) ? scopeProject : projects[0].id;
  $('stk-proj').innerHTML = projects.map((p) => `<option value="${p.id}"${p.id === stackProject ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('stk-proj').onchange = () => { stackProject = Number($('stk-proj').value); loadStacking(); };
  const canAdd = ['owner', 'pm'].includes(currentUser.role);
  if (canAdd) $('stk-add').onclick = newUnit; else $('stk-add').hidden = true;
  loadStacking();
}

// Live countdown on held (yellow) flats. Server times are UTC; the timer stops when the plan is no longer on screen.
let stkTimer = null;
function tickHoldTimers(root) {
  clearInterval(stkTimer);
  const paint = () => {
    if (!document.body.contains(root)) { clearInterval(stkTimer); return; }
    root.querySelectorAll('[data-till]').forEach((s) => { const ms = Date.parse(String(s.dataset.till).replace(' ', 'T') + 'Z') - Date.now(); s.textContent = ms <= 0 ? 'expiring' : Math.floor(ms / 3600000) + 'h ' + String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0') + 'm'; });
  };
  paint(); stkTimer = setInterval(paint, 30000);
}

async function loadStacking() {
  const out = $('stacking-out'); if (!out) return;
  try {
    const d = (await api('/api/reports/stacking?project_id=' + stackProject)).data;
    if (!d.units.length) { out.innerHTML = emptyIllus('No flats yet. Add flats to see the stacking plan.'); return; }
    const wings = [...new Set(d.units.map((u) => u.wing))].sort();
    const legend = Object.entries(STACK).map(([k, [l, bg, fg]]) => `<span class="chip" style="background:${bg};color:${fg};text-transform:none">${l}: <b>${d.counts[k] || 0}</b></span>`).join(' ');
    const sold = (d.counts.booked || 0) + (d.counts.registered || 0); const forSale = d.units.filter((u) => u.state !== 'rehab' && u.state !== 'landowner').length;
    let html = `<div class="card stk-top"><div>${SV.donut(Object.entries(STACK).map(([k, [l, , fg]]) => ({ label: l, value: d.counts[k] || 0, color: fg })), { label: 'flats' })}</div>
      <div><div class="row-btns" style="margin:0 0 8px">${legend}</div><p style="margin:4px 0"><b>${forSale ? Math.round((sold / forSale) * 100) : 0}%</b> of saleable flats sold · list value ${moneyP(d.total_list_value_paise)}${['owner', 'pm', 'accounts', 'sales'].includes(currentUser.role) ? ` · sold ${moneyP(d.sold_value_paise)}` : ''}</p><p class="muted">Tap a flat for details, hold or book.</p></div></div>`;
    for (const w of wings) {
      const us = d.units.filter((u) => u.wing === w);
      const floors = [...new Set(us.map((u) => u.floor))].sort((a, b) => (b ?? -1) - (a ?? -1));
      html += `<h3>${w ? 'Wing ' + esc(w) : 'Flats'}</h3><div class="stk">${floors.map((f) => `<div class="stk-row"><div class="stk-floor">${f == null ? '—' : esc(f)}</div><div class="stk-cells">${us.filter((u) => u.floor === f).map((u) => { const [l, bg, fg] = STACK[u.state]; return `<button class="stk-cell" data-u="${u.id}" style="background:${bg};color:${fg}" title="${esc(l)}"><b>${esc(u.unit_no)}</b><span>${esc(u.type || '')}</span>${u.state === 'token_locked' && u.blocked_till ? `<span class="stk-timer" data-till="${esc(u.blocked_till)}"></span>` : ''}</button>`; }).join('')}</div></div>`).join('')}</div>`;
    }
    out.innerHTML = html;
    out.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => unitDrill(d.units.find((u) => String(u.id) === b.dataset.u)); });
    tickHoldTimers(out);
  } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

async function unitDrill(u) {
  const [l, bg, fg] = STACK[u.state];
  const mgr = ['owner', 'pm'].includes(currentUser.role); const canSell = ['owner', 'pm', 'sales'].includes(currentUser.role);
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><div class="row"><div><h2>${esc(u.wing ? u.wing + '-' : '')}${esc(u.unit_no)}</h2><p class="muted">Floor ${esc(u.floor ?? '—')} · ${esc(u.type || '')}</p></div><span class="chip" style="background:${bg};color:${fg};text-transform:none">${l}</span></div>
    <div class="kv"><span>Rate-card price</span><b>${moneyP(u.list_paise)}</b>${u.rate_sqft_paise ? `<span>Rate on RERA carpet</span><b>${moneyP(u.rate_sqft_paise)} / sq ft</b>` : ''}${u.rera_carpet_sqft ? `<span>RERA carpet</span><b>${esc(u.rera_carpet_sqft)} sq ft</b>` : ''}${u.carpet_sqft ? `<span>Carpet</span><b>${esc(u.carpet_sqft)} sq ft</b>` : ''}
    ${u.customer ? `<span>Buyer</span><b>${esc(u.customer)}</b>` : ''}${u.agreed_paise ? `<span>Agreed price</span><b>${moneyP(u.agreed_paise)}</b>` : ''}${u.holder ? `<span>Held by</span><b>${esc(u.holder)}${u.holder_lead ? ' for ' + esc(u.holder_lead) : ''} until ${esc(String(u.blocked_till).substring(0, 16))}</b>` : ''}</div>
    <div class="row-btns">
      ${u.state === 'available' && canSell ? '<button class="btn small btn-primary" id="ud-hold">Block with token</button><button class="btn small" id="ud-book">Book</button>' : ''}
      ${u.state === 'token_locked' && canSell ? '<button class="btn small btn-primary" id="ud-book">Convert to booking</button><button class="btn small" id="ud-rel">Release</button>' : ''}${u.state === 'token_locked' && mgr ? '<button class="btn small" id="ud-ext">Extend 24h</button>' : ''}
      ${u.booking_id ? '<button class="btn small btn-primary" id="ud-bk">Open booking</button>' : ''}
      <button class="btn small" id="ud-cs">Cost sheet</button>${mgr && !u.booking_id && u.state !== 'rehab' && u.state !== 'landowner' ? '<button class="btn small" id="ud-price">Change price</button>' : ''}</div>
    <div class="modal-actions"><button class="btn btn-primary" id="ud-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  const done = () => { ov.remove(); loadStacking(); };
  $('ud-close').onclick = () => ov.remove();
  if ($('ud-hold')) $('ud-hold').onclick = async () => {
    let leads = []; try { leads = (await api('/api/sales/leads')).data.leads.filter((x) => !['booked', 'lost'].includes(x.status)); } catch (e) { /* ignore */ }
    if (!leads.length) { toast('Add a lead first, then hold a flat for them.'); return; }
    const v = await openForm({ title: 'Block this flat for a lead', intro: 'Enter how the token was paid. Accounts must confirm it reached the bank within 48 hours, or the flat goes back on sale. Once confirmed it stays yours for a few days to complete the booking.', fields: [{ name: 'lead_id', label: 'Lead', type: 'select', options: leads.map((x) => [x.id, `${x.name} · ${x.phone}`]) },
      { name: 'token_mode', label: 'Token paid by', type: 'select', options: [['upi', 'UPI'], ['neft', 'NEFT / RTGS'], ['cheque', 'Cheque']] }, { name: 'token_ref', label: 'UTR number or cheque number', required: !mgr }, { name: 'token_amount_paise', label: 'Token amount (₹)', type: 'money', required: !mgr }, { name: 'proof', label: 'Photo of the UTR screen or the cheque (optional, helps Accounts)', type: 'file' }] });
    if (v) { const body = { lead_id: Number(v.lead_id) }; if (v.token_ref) { body.token_mode = v.token_mode; body.token_ref = v.token_ref; body.token_amount_paise = v.token_amount_paise; }
      if (v.proof) { const fd = new FormData(); fd.append('file', await compressFile(v.proof), v.proof.name); fd.append('title', 'Token proof ' + (u.unit_no || '')); fd.append('category', 'kyc'); fd.append('module', 'sales'); fd.append('project_id', String(stackProject)); fd.append('audience', 'internal'); const up = await act(api('/api/files/upload', { method: 'POST', body: fd })); if (!up) return; body.proof_doc_id = up.data.id; }
      if (await act(api(`/api/sales/inventory/${u.id}/hold`, { method: 'POST', body }), 'Blocked. Accounts will confirm the token.')) done(); }
  };
  if ($('ud-rel')) $('ud-rel').onclick = async () => { if (await act(api(`/api/sales/inventory/${u.id}/release`, { method: 'POST' }), 'Released')) done(); };
  if ($('ud-ext')) $('ud-ext').onclick = async () => { const v = await openForm({ title: 'Extend hold', fields: [{ name: 'reason', label: 'Reason', required: true }] }); if (v && await act(api(`/api/sales/inventory/${u.id}/extend`, { method: 'POST', body: v }), 'Extended 24h')) done(); };
  if ($('ud-book')) $('ud-book').onclick = () => { ov.remove(); bookUnit({ id: u.id, wing: u.wing, unit_no: u.unit_no, price_paise: u.list_paise, floor_rise_paise: 0, status: u.state }).then(loadStacking); };
  if ($('ud-bk')) $('ud-bk').onclick = () => { ov.remove(); bookingDetail(u.booking_id); };
  $('ud-cs').onclick = () => costSheet(u.list_paise, u.rera_carpet_sqft);
  if ($('ud-price')) $('ud-price').onclick = async () => {
    const v = await openForm({ title: 'Change rate-card price', intro: 'Price changes are recorded in the audit log.', fields: [{ name: 'price_paise', label: 'New price (₹)', type: 'money', required: true }, { name: 'reason', label: 'Reason', required: true }] });
    if (v && await act(api(`/api/sales/inventory/${u.id}`, { method: 'PUT', body: v }), 'Price updated')) done();
  };
}

async function costSheet(price, rera) {
  const v = await openForm({ title: 'Cost sheet', fields: [{ name: 'agreed_price_paise', label: 'Agreement value (₹)', type: 'money', value: (price || 0) / 100, required: true }, { name: 'other_charges_paise', label: 'Parking / other charges (₹)', type: 'money' }, { name: 'buyer', label: 'Buyer', type: 'select', options: [['', 'Any'], ['woman', 'Woman (concession if configured)']] }], submit: 'Calculate' });
  if (!v) return;
  const r = await act(api('/api/sales/cost-sheet', { method: 'POST', body: { ...v, rera_carpet_sqft: rera } })); if (!r) return;
  const c = r.data;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Cost sheet</h2><div class="kv"><span>Agreement value</span><b>${moneyP(c.agreement_value_paise)}</b><span>Stamp duty (${c.rates.stamp_bp / 100}%)</span><b>${moneyP(c.stamp_duty_paise)}</b><span>Metro cess (${c.rates.metro_bp / 100}%)</span><b>${moneyP(c.metro_cess_paise)}</b>
    <span>Registration</span><b>${moneyP(c.registration_paise)}</b><span>GST (${c.rates.gst_bp / 100}%)</span><b>${moneyP(c.gst_paise)}</b><span><b>Total outflow</b></span><b>${moneyP(c.total_buyer_outflow_paise)}</b>${c.rate_per_sqft_rera_paise ? `<span>Rate on RERA carpet</span><b>${moneyP(c.rate_per_sqft_rera_paise)} / sq ft</b>` : ''}</div>
    <p class="help">${esc(c.note)}</p><div class="modal-actions"><button class="btn" id="cs-print">Print</button><button class="btn btn-primary" id="cs-close">Close</button></div></div>`;
  document.body.appendChild(ov); $('cs-close').onclick = () => ov.remove(); $('cs-print').onclick = () => window.print();
}

// ---------- Reports ----------
let reportTab = 'cashflow';
function renderReports(main) {
  const money = ['owner', 'pm', 'accounts'].includes(currentUser.role);
  const tabs = [...(money ? [['cashflow', 'Cash flow & escrow'], ['aging', 'Receivables aging'], ['marketing', 'Marketing & partners']] : []), ['velocity', 'Sales velocity & discounts']];
  if (!tabs.some((t) => t[0] === reportTab)) reportTab = tabs[0][0];
  main.innerHTML = `<h1>Reports</h1><div class="tabs">${tabs.map(([k, l]) => `<button class="tab${reportTab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="report-out">Loading...</div>`;
  main.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { reportTab = b.dataset.tab; renderReports(main); }; });
  ({ cashflow: repCashflow, aging: repAging, marketing: repMarketing, velocity: repVelocity })[reportTab]().catch((e) => { const o = $('report-out'); if (o) o.innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}
const monthLabel = (m) => { const [y, mo] = m.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1] + ' ' + y.slice(2); };

async function repCashflow() {
  const d = (await api('/api/reports/cashflow')).data; const o = $('report-out'); if (!o) return;
  const e = d.escrow; const pct = e.designated_pct;
  o.innerHTML = `<div class="grid2"><div class="card"><h2>Scheduled vs collected</h2><p class="muted">Demands falling due each month against money actually received.</p>${d.months.length ? SV.bars(d.months.map((m) => ({ ...m, label: monthLabel(m.month) })), { keys: ['due', 'collected'], colors: ['#94a3b8', 'var(--brand)'] }) + '<div class="legend"><span><i style="background:#94a3b8"></i>Due</span><span><i style="background:var(--brand)"></i>Collected</span></div>' : emptyIllus('No demands or receipts yet.')}
      <p class="muted">Still scheduled for future milestones: <b>${moneyP(d.unscheduled_future_paise)}</b></p></div>
    <div class="card"><h2>RERA designated account (70%)</h2>${pct === null ? '<p class="muted">No receipts yet.</p>' : `<div class="ring">${SV.donut([{ label: 'Designated', value: e.designated_paise, color: '#16a34a' }, { label: 'Other account', value: e.other_paise, color: '#dc2626' }], { label: 'collected' })}<div><p><b style="font-size:1.6rem;color:${e.compliant ? '#15803d' : '#dc2626'}">${pct}%</b> deposited in the designated account</p><p class="muted">Required: at least ${e.required_pct}%</p>
      ${e.compliant ? '<span class="chip" style="background:#dcfce7;color:#166534">On track</span>' : `<span class="chip" style="background:#fee2e2;color:#991b1b">Short by ${moneyP(e.shortfall_paise)}</span>`}</div></div>
      <div class="kv"><span>Collected</span><b>${moneyP(e.collected_paise)}</b><span>In designated account</span><b>${moneyP(e.designated_paise)}</b><span>Outside it</span><b>${moneyP(e.other_paise)}</b></div>`}<p class="help">${esc(e.note)}</p></div></div>`;
}

async function repAging() {
  const d = (await api('/api/reports/aging')).data; const o = $('report-out'); if (!o) return;
  const tot = d.buckets.reduce((t, b) => t + b.amount_paise, 0) || 1; const cols = ['#16a34a', '#eab308', '#f97316', '#ef4444', '#991b1b'];
  o.innerHTML = `<div class="card"><h2>Receivables aging</h2><p class="muted">Money due from customers, by how long it is overdue.</p>${d.buckets.map((b, i) => `<div class="agerow"><span>${esc(b.label)}</span>${SV.hbar((b.amount_paise / tot) * 100, cols[i])}<b>${moneyP(b.amount_paise)}</b><span class="muted">${b.count}</span></div>`).join('')}
    <p class="muted" style="margin-top:10px">Scheduled for future milestones: <b>${moneyP(d.scheduled_paise)}</b> across ${d.scheduled_count} demands</p></div>
    <div class="card"><h2>Biggest overdue</h2>${d.top.map((t) => `<div class="row" style="margin:6px 0"><div><b>${esc(t.customer)}</b> <span class="muted">${esc(t.flat)} · ${esc(t.label)}</span></div><div style="text-align:right"><b>${moneyP(t.open_paise)}</b><div class="muted">${t.days} days</div></div></div>`).join('') || '<p class="muted">Nothing overdue.</p>'}</div>`;
}

async function repMarketing() {
  const [d, sp] = await Promise.all([api('/api/reports/marketing'), api('/api/marketing/spend')]); const o = $('report-out'); if (!o) return;
  const canAdd = ['owner', 'accounts'].includes(currentUser.role);
  o.innerHTML = `<div class="card"><div class="row"><h2>Cost per lead, visit and booking</h2>${canAdd ? '<button class="btn small" id="mk-add">+ Marketing spend</button>' : ''}</div><div class="tbl"><table><tr><th>Source</th><th class="r">Leads</th><th class="r">Visits</th><th class="r">Bookings</th><th class="r">Spend</th><th class="r">Per lead</th><th class="r">Per visit</th><th class="r">Per booking</th></tr>
    ${d.data.sources.map((s) => `<tr><td>${esc(s.source)}</td><td class="r">${s.leads}</td><td class="r">${s.visits}</td><td class="r">${s.bookings}</td><td class="r">${s.spend_paise ? moneyP(s.spend_paise) : '—'}</td><td class="r">${s.cost_per_lead_paise ? moneyP(s.cost_per_lead_paise) : '—'}</td><td class="r">${s.cost_per_visit_paise ? moneyP(s.cost_per_visit_paise) : '—'}</td><td class="r">${s.cost_per_booking_paise ? moneyP(s.cost_per_booking_paise) : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No leads yet.</td></tr>'}</table></div>
    <p class="help">Enter what you spent on each source every month; costs per lead, visit and booking are worked out from it.</p></div>
    <div class="card"><h2>Channel partners</h2><div class="tbl"><table><tr><th>Partner</th><th class="r">Leads</th><th class="r">Bookings</th><th class="r">Booked value</th><th class="r">Brokerage</th><th class="r">Net realisation</th></tr>
    ${d.data.partners.map((p) => `<tr><td>${esc(p.firm)}</td><td class="r">${p.leads}</td><td class="r">${p.bookings}</td><td class="r">${moneyP(p.value_paise)}</td><td class="r">${moneyP(p.brokerage_paise)}</td><td class="r">${moneyP(p.net_realisation_paise)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No partners yet.</td></tr>'}</table></div></div>`;
  if (canAdd) $('mk-add').onclick = async () => {
    const v = await openForm({ title: 'Marketing spend', fields: [{ name: 'source', label: 'Source (meta, 99acres, magicbricks, housing, google…)', required: true }, { name: 'month', label: 'Month', type: 'month', value: new Date().toISOString().slice(0, 7), required: true }, { name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true }, { name: 'project_id', label: 'Project', type: 'select', options: [['', 'All projects'], ...(await projectOptions())] }, { name: 'note', label: 'Note' }] });
    if (!v) return; if (!v.project_id) delete v.project_id; else v.project_id = Number(v.project_id);
    if (await act(api('/api/marketing/spend', { method: 'POST', body: v }), 'Saved')) repMarketing();
  };
}

async function repVelocity() {
  const d = (await api('/api/reports/velocity')).data; const o = $('report-out'); if (!o) return;
  const rowFor = (r) => `<div class="agerow"><span>${esc(r.key)}</span>${SV.hbar(r.absorption_pct, 'var(--brand)')}<b>${r.absorption_pct}%</b><span class="muted">${r.sold}/${r.total}${r.realisation_pct != null ? ' · ' + r.realisation_pct + '% of rate card' : ''}</span></div>`;
  o.innerHTML = `<div class="grid2"><div class="card"><h2>Absorption by configuration</h2>${d.by_type.map(rowFor).join('') || '<p class="muted">No flats.</p>'}</div><div class="card"><h2>Absorption by floor band</h2>${d.by_floor.map(rowFor).join('') || '<p class="muted">No flats.</p>'}</div></div>
    <div class="card"><h2>Bookings per month</h2>${d.monthly.length ? SV.bars(d.monthly.map((m) => ({ label: monthLabel(m.m), bookings: m.n })), { keys: ['bookings'], colors: ['var(--brand)'], fmt: (v) => String(v) }) : '<p class="muted">No bookings yet.</p>'}</div>
    <div class="card"><h2>Discount leakage</h2><p class="muted">Bookings below the rate card. Total given away: <b>${moneyP(d.total_discount_paise)}</b>. Sales reps may give up to ${d.approved_limit_bp / 100}%.</p>
      ${d.leakage.map((l) => `<div class="row" style="margin:8px 0"><div><b>${esc(l.customer_name)}</b> <span class="muted">${esc(l.wing || '')}-${esc(l.unit_no)}</span><div class="muted">${esc(l.discount_reason || 'No reason recorded')}${l.approver ? ' · approved by ' + esc(l.approver) : ''}</div></div><div style="text-align:right"><b>${(l.discount_bp / 100).toFixed(2)}%</b><div>${l.over_limit ? chip('Above rep limit', 'warn') : chip('Within limit', 'good')}</div></div></div>`).join('') || '<p class="muted">No discounted bookings.</p>'}</div>`;
}

// ---------- Booking detail: control buttons, receipt numbers, refunds ----------
const _bookingDetail2 = bookingDetail;
bookingDetail = async function (id) {
  await _bookingDetail2(id);
  const overlays = document.querySelectorAll('.modal-overlay'); const ov = overlays[overlays.length - 1]; if (!ov) return;
  let d; try { d = (await api('/api/sales/bookings/' + id)).data; } catch (e) { return; }
  const b = d.booking; const mgr = ['owner', 'pm'].includes(currentUser.role); const money = ['owner', 'pm', 'accounts'].includes(currentUser.role);
  let refunds = []; if (money) { try { refunds = (await api(`/api/sales/bookings/${id}/refunds`)).data.refunds; } catch (e) { /* ignore */ } }
  const box = document.createElement('div');
  box.innerHTML = `<h3>Price & controls</h3><div class="kv"><span>Rate card</span><b>${moneyP(b.list_price_paise || b.agreed_price_paise)}</b><span>Agreed</span><b>${moneyP(b.agreed_price_paise)}</b>${b.discount_reason ? `<span>Discount reason</span><b>${esc(b.discount_reason)}</b>` : ''}${b.registration_date ? `<span>Registered</span><b>${esc(b.registration_date)}</b>` : ''}</div>
    <div class="row-btns">${mgr && b.status !== 'cancelled' ? '<button class="btn small" data-bc="reg">Agreement / registration dates</button><button class="btn small" data-bc="transfer">Transfer to another flat</button>' : ''}<button class="btn small" data-bc="cost">Cost sheet</button></div>
    ${refunds.length ? `<h3>Refunds</h3>${refunds.map((r) => `<div class="card"><div class="row"><div><b>${moneyP(r.amount_paise)}</b> <span class="muted">forfeit ${moneyP(r.forfeited_paise)} · ${esc(r.reason || '')}</span></div>${statusChip(r.status === 'paid' ? 'done' : r.status === 'rejected' ? 'rejected' : 'open').replace(/>[^<]*</, '>' + esc(r.status) + '<')}</div>
      <div class="row-btns">${r.status === 'requested' && currentUser.role === 'owner' ? `<button class="btn small btn-primary" data-rf="approve" data-id="${r.id}">Approve</button><button class="btn small" data-rf="reject" data-id="${r.id}">Reject</button>` : ''}${r.status === 'approved' && ['owner', 'accounts'].includes(currentUser.role) ? `<button class="btn small btn-primary" data-rf="pay" data-id="${r.id}">Mark paid</button>` : ''}</div></div>`).join('')}` : ''}
    ${b.status === 'cancelled' && mgr ? '<div class="row-btns"><button class="btn small" data-bc="refund">Request a refund</button></div>' : ''}`;
  const actions = ov.querySelector('.modal-actions'); actions.before(box);
  const again = () => { ov.remove(); bookingDetail(id); };
  box.querySelectorAll('[data-bc]').forEach((x) => {
    x.onclick = async () => {
      const k = x.dataset.bc;
      if (k === 'cost') costSheet(b.list_price_paise || b.agreed_price_paise);
      else if (k === 'reg') { const v = await openForm({ title: 'Agreement / registration', fields: [{ name: 'agreement_date', label: 'Agreement for sale signed on', type: 'date' }, { name: 'registration_date', label: 'Registered on', type: 'date' }] }); if (v) { if (!v.agreement_date) delete v.agreement_date; if (!v.registration_date) delete v.registration_date; if (await act(api(`/api/sales/bookings/${id}/registration`, { method: 'POST', body: v }), 'Saved')) again(); } }
      else if (k === 'transfer') {
        const inv = (await api('/api/sales/inventory?project_id=' + b.project_id)).data.inventory.filter((u) => u.status === 'available' && u.category === 'sale');
        if (!inv.length) { toast('No available flats to move to.'); return; }
        const v = await openForm({ title: 'Transfer booking', intro: 'Price and payment demands stay as they are.', fields: [{ name: 'to_unit_id', label: 'New flat', type: 'select', options: inv.map((u) => [u.id, `${u.wing ? u.wing + '-' : ''}${u.unit_no} · ${moneyP(u.price_paise)}`]) }, { name: 'reason', label: 'Reason', required: true }] });
        if (v && await act(api(`/api/sales/bookings/${id}/transfer`, { method: 'POST', body: { to_unit_id: Number(v.to_unit_id), reason: v.reason } }), 'Transferred')) again();
      } else if (k === 'refund') {
        const v = await openForm({ title: 'Request a refund', intro: 'Forfeiture cannot exceed 10% of the agreed price. The Owner approves; Accounts pays.', fields: [{ name: 'amount_paise', label: 'Refund (₹)', type: 'money', required: true }, { name: 'forfeited_paise', label: 'Forfeited (₹)', type: 'money' }, { name: 'reason', label: 'Reason', required: true }] });
        if (v && await act(api(`/api/sales/bookings/${id}/refund`, { method: 'POST', body: v }), 'Refund requested')) again();
      }
    };
  });
  box.querySelectorAll('[data-rf]').forEach((x) => {
    x.onclick = async () => {
      let body = {};
      if (x.dataset.rf === 'pay') { const v = await openForm({ title: 'Mark refund paid', fields: [{ name: 'ref_no', label: 'Payment reference', required: true }, { name: 'paid_on', label: 'Paid on', type: 'date', value: today() }] }); if (!v) return; body = v; }
      if (await act(api(`/api/sales/refunds/${x.dataset.id}/${x.dataset.rf}`, { method: 'POST', body }), 'Done')) again();
    };
  });
  // receipt numbers + reversal
  const money2 = ['owner'].includes(currentUser.role);
  ov.querySelectorAll('[data-prcp]').forEach((pb) => {
    const r = d.receipts.find((x) => String(x.id) === pb.dataset.prcp); if (!r) return;
    const tag = document.createElement('span'); tag.className = 'muted'; tag.textContent = ` ${r.receipt_no || ''}${r.reversed_at ? ' (reversed)' : ''} `; pb.before(tag);
    if (money2 && !r.reversed_at) { const rb = document.createElement('button'); rb.className = 'btn small'; rb.textContent = 'Reverse'; rb.style.color = '#dc2626'; rb.onclick = async () => { const v = await openForm({ title: 'Reverse receipt', intro: 'Use this when a cheque bounces or a receipt was entered wrongly. It stays in the log.', fields: [{ name: 'reason', label: 'Reason', required: true }] }); if (v && await act(api(`/api/sales/receipts/${r.id}/reverse`, { method: 'POST', body: v }), 'Reversed')) again(); }; pb.after(rb); }
  });
};

// new flat: category
const _newUnit = newUnit;
newUnit = async function () {
  const v = await openForm({ title: 'Add flat to inventory', fields: [
    { name: 'project_id', label: 'Project', type: 'select', options: await projectOptions() },
    { name: 'wing', label: 'Wing / tower' }, { name: 'floor', label: 'Floor', type: 'number' }, { name: 'unit_no', label: 'Flat number', required: true },
    { name: 'type', label: 'Type (1BHK, 2BHK, Jodi…)' }, { name: 'category', label: 'Kind', type: 'select', options: [['sale', 'Free sale'], ['rehab', 'Rehab (existing members)'], ['landowner', 'Landowner / partner share']] },
    { name: 'carpet_sqft', label: 'Carpet area (sq ft)', type: 'number' }, { name: 'rera_carpet_sqft', label: 'RERA carpet area (sq ft)', type: 'number', help: 'Sale is priced on RERA carpet area.' },
    { name: 'price_paise', label: 'Rate-card price (₹)', type: 'money' }, { name: 'floor_rise_paise', label: 'Floor-rise / PLC (₹)', type: 'money' }] });
  if (!v) return;
  v.project_id = Number(v.project_id);
  if (await act(api('/api/sales/inventory', { method: 'POST', body: v }), 'Flat added')) { if ($('sales-list')) loadSales(); if ($('stacking-out')) loadStacking(); }
};

// ---------- Audit log with filters ----------
renderAudit = PAGES.audit = function (main) {
  main.innerHTML = `<h1>Audit log</h1><div class="brandbar"><input id="au-q" type="search" placeholder="Search text…" style="min-height:42px;padding:4px 12px;border:1px solid var(--border);border-radius:10px;font:inherit">
    <select id="au-a"><option value="">All actions</option>${['price_change', 'plan_change', 'phone_change', 'reassign', 'hold', 'hold_expired', 'cancel', 'reverse', 'refund_request', 'refund_approve', 'refund_paid', 'transfer', 'registration', 'create', 'deactivate', 'archive'].map((a) => `<option>${a}</option>`).join('')}</select></div>
    <p class="help">Append-only: entries cannot be edited or deleted, even by the app.</p><div id="audit-list">Loading...</div>`;
  const load = async () => {
    const q = new URLSearchParams(); if ($('au-q').value) q.set('q', $('au-q').value); if ($('au-a').value) q.set('action', $('au-a').value);
    try { const rows = (await api('/api/audit?' + q)).data.audit; const el = $('audit-list'); if (el) el.innerHTML = rows.map((a) => `<div class="card"><b>${esc(a.name || 'System')}</b> <span class="chip" style="text-transform:none">${esc(a.action)}</span> ${esc(a.summary)}<p class="muted">${esc(dateIST(a.created_at))}</p></div>`).join('') || emptyIllus('Nothing matches.'); } catch (e) { const el = $('audit-list'); if (el) el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  let t; $('au-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); }; $('au-a').onchange = load; load();
};

// ---------- Settings: new controls ----------
// These switches are ON until someone sets them to Off (nothing is stored for them until then).
const ON_BY_DEFAULT = ['site.dual_signoff', 'con.gst_hold', 'pro.grn_gate', 'sales.lock_above_cc', 'sales.hold_needs_token', 'sales.broker_needs_confirmation'];
Object.assign(SETTING_LABELS, {
  'sales.max_discount_bp': ['Discount a sales rep may give (basis points; 100 = 1%)', 'number'], 'sales.pm_max_discount_bp': ['Discount a PM may give (basis points)', 'number'], 'sales.max_holds_per_user': ['Flats one rep may hold at a time', 'number'],
  'site.dual_signoff': ['A stage that releases buyer demands needs the Site Engineer sign-off and the RCC report confirmed by the Owner', 'onoff'], 'con.gst_hold': ['Hold the GST part of a contractor RA bill until Accounts confirm the contractor filed GST returns', 'onoff'],
  'stk.wastage_defaults': ['Usual allowed wastage by material, in basis points, as word=number; word=number (the first word found in the store item name is used; a work-order line\'s own figure wins)', 'text'], 'site.dpr_radius_m': ['Metres from the project location beyond which a daily report is flagged as filed from elsewhere', 'number'],
  'pro.grn_gate': ['Material receipt: challan compulsory and used once, bill held until the gate photo is on file', 'onoff'], 'stk.wastage_alert_bp': ['Alert when material issued is more than the measured work needs by (basis points; 250 = 2.5%)', 'number'],
  'sales.sla_minutes': ['Minutes to call a new lead before it moves to the next executive (0 = off; checked every 15 minutes)', 'number'], 'sales.rehold_block_hours': ['Hours a closer cannot re-block a flat they released or let lapse', 'number'],
  'sales.lock_above_cc': ['Do not sell flats above the approved CC floor', 'onoff'], 'sales.hold_needs_token': ['Salespeople must enter token details to block a flat', 'onoff'], 'sales.broker_needs_confirmation': ['A broker counts only if the buyer confirmed them at reception', 'onoff'],
  'sales.source_lock_days': ['Days a broker keeps a buyer after the buyer confirms (45 or 60)', 'number'], 'sales.token_cleared_hold_days': ['Days a flat stays blocked after Accounts clears the token', 'number'],
  'sales.brochure_url': ['Brochure link sent in the WhatsApp welcome message', 'text'], 'sales.map_url': ['Site office map link (blank = project location)', 'text'],
  'tax.stamp_duty_bp': ['Stamp duty (basis points; 500 = 5%)', 'number'], 'tax.metro_cess_bp': ['Metro cess (basis points)', 'number'], 'tax.women_concession_bp': ['Stamp duty concession for women (basis points)', 'number'],
  'tax.registration_bp': ['Registration fee (basis points)', 'number'], 'tax.registration_cap_paise': ['Registration fee cap (paise; 3000000 = ₹30,000)', 'number'], 'tax.gst_bp': ['GST on under-construction flats (basis points)', 'number'],
});

// ---------- Executive dashboard: sales snapshot with charts ----------
const _renderDashboard4 = renderDashboard;
renderDashboard = PAGES.dashboard = function (main) {
  _renderDashboard4(main);
  if (!['owner', 'pm', 'accounts'].includes(currentUser.role)) return;
  Promise.all([api('/api/reports/cashflow'), getProjects().catch(() => [])]).then(async ([cf, projects]) => {
    const g = $('dashboard-grid'); if (!g || $('snapshot')) return;
    const pid = scopeProject || (projects[0] && projects[0].id);
    let st = null; if (pid) { try { st = (await api('/api/reports/stacking?project_id=' + pid)).data; } catch (e) { /* no access */ } }
    const e = cf.data.escrow;
    g.insertAdjacentHTML('afterend', `<div id="snapshot" class="grid2" style="margin-top:16px">
      <div class="card"><h2>Collections</h2>${cf.data.months.length ? SV.bars(cf.data.months.slice(-6).map((m) => ({ ...m, label: monthLabel(m.month) })), { keys: ['due', 'collected'], colors: ['#94a3b8', 'var(--brand)'], h: 170 }) : emptyIllus('Collections will show here.')}
        ${e.designated_pct != null ? `<p class="muted">RERA account: <b style="color:${e.compliant ? '#15803d' : '#dc2626'}">${e.designated_pct}%</b> of collections deposited (need 70%)</p>` : ''}</div>
      <div class="card"><h2>Inventory</h2>${st ? `<div class="ring">${SV.donut(Object.entries(STACK).map(([k, [l, , fg]]) => ({ label: l, value: st.counts[k] || 0, color: fg })), { label: 'flats' })}<div>${Object.entries(STACK).map(([k, [l, , fg]]) => `<div class="muted"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${fg};margin-right:6px"></i>${l}: <b>${st.counts[k] || 0}</b></div>`).join('')}<div class="row-btns"><button class="btn small" data-go="stacking">Open stacking plan</button></div></div></div>` : emptyIllus('Add flats to see inventory.')}</div></div>`);
    $('snapshot').querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
  }).catch(() => {});
};
