// pages3.js — lead timeline & follow-ups, visits, channel partners, funnel report, global search,
// approval/consultant alerts on the home screens. Loaded after pages2.js.

ICONS.search = 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3';

// ---------- Lead detail: timeline, call logging, visits ----------
const LEAD_STATUS = [['new', 'New'], ['contacted', 'Contacted'], ['interested', 'Interested'], ['visit_scheduled', 'Visit scheduled'], ['visited', 'Visited'], ['negotiating', 'Negotiating'], ['booked', 'Booked'], ['lost', 'Lost']];
const waLink = (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, '').replace(/^0+/, '').replace(/^(\d{10})$/, '91$1')}${text ? '?text=' + encodeURIComponent(text) : ''}`;
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

async function leadDetail(id) {
  const d = (await api('/api/sales/leads/' + id)).data;
  const l = d.lead;
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><div class="row"><div><h2>${esc(l.name)}</h2><p class="muted">${esc(l.config_pref || '')} ${l.next_followup_at ? '· next follow-up ' + esc(String(l.next_followup_at).replace('T', ' ').substring(0, 16)) : ''}</p></div>${statusChip(l.status)}</div>
    <div class="row-btns"><a class="btn small btn-primary" href="tel:${esc(l.phone)}">📞 Call</a><a class="btn small" href="${waLink(l.phone, 'Hello ' + l.name + ', thank you for your interest. ')}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn small" id="ld-log">Log a call / note</button><button class="btn small" id="ld-visit">Schedule visit</button></div>
    ${d.visits.filter((v) => v.status === 'scheduled').map((v) => `<div class="card" style="margin-top:12px"><b>Visit ${esc(String(v.visit_at).replace('T', ' ').substring(0, 16))}</b><div class="row-btns"><button class="btn small" data-vs="done" data-id="${v.id}">Visited</button><button class="btn small" data-vs="no_show" data-id="${v.id}">No-show</button><button class="btn small" data-vs="cancelled" data-id="${v.id}">Cancel</button></div></div>`).join('')}
    <h3>Timeline</h3>${d.activities.map((a) => `<p>• <b>${esc(a.type)}</b>${a.outcome ? ' (' + esc(a.outcome) + ')' : ''} ${a.note ? '— ' + esc(a.note) : ''} <span class="muted">${esc(a.by_name || '')} · ${esc(dateIST(a.created_at))}</span></p>`).join('') || '<p class="muted">Nothing logged yet.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="ld-close">Close</button></div></div>`;
  document.body.appendChild(ov);
  const reopen = () => { ov.remove(); leadDetail(id); if ($('sales-list')) loadSales(); };
  $('ld-close').onclick = () => { ov.remove(); if ($('sales-list')) loadSales(); };
  $('ld-log').onclick = async () => {
    const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(11, 0, 0, 0);
    const v = await openForm({ title: 'Log a call / note', intro: 'After a call, always set when to follow up next.', fields: [
      { name: 'type', label: 'What', type: 'select', options: [['call', 'Call'], ['whatsapp', 'WhatsApp'], ['note', 'Note']] },
      { name: 'outcome', label: 'Outcome', type: 'select', options: [['', '—'], ['reached', 'Spoke to them'], ['no_answer', 'No answer'], ['callback', 'Asked for a call back'], ['not_interested', 'Not interested']] },
      { name: 'note', label: 'Notes', type: 'textarea' },
      { name: 'status', label: 'Move lead to', type: 'select', options: [['', 'Keep as is'], ...LEAD_STATUS], value: '' },
      { name: 'next_followup_at', label: 'Next follow-up', type: 'datetime-local', value: toLocalInput(tomorrow), help: 'Required for calls.' }] });
    if (!v) return;
    if (!v.status) delete v.status;
    if (await act(api(`/api/sales/leads/${id}/activity`, { method: 'POST', body: v }), 'Saved')) reopen();
  };
  $('ld-visit').onclick = async () => {
    const t = new Date(Date.now() + 86400000); t.setHours(11, 0, 0, 0);
    const v = await openForm({ title: 'Schedule a site visit', fields: [{ name: 'visit_at', label: 'When', type: 'datetime-local', value: toLocalInput(t), required: true }] });
    if (v && await act(api(`/api/sales/leads/${id}/visit`, { method: 'POST', body: v }), 'Visit scheduled')) reopen();
  };
  ov.querySelectorAll('[data-vs]').forEach((b) => {
    b.onclick = async () => {
      const v = b.dataset.vs === 'cancelled' ? {} : await openForm({ title: 'Visit feedback', fields: [{ name: 'feedback', label: 'How did it go?', type: 'textarea' }] });
      if (v && await act(api(`/api/sales/visits/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.vs, feedback: v.feedback || '' } }), 'Saved')) reopen();
    };
  });
}

// ---------- Sales screen extras: follow-ups strip, partners, funnel ----------
async function decorateSales(el) {
  const mgr = ['owner', 'pm', 'accounts'].includes(currentUser.role);
  try {
    const f = (await api('/api/sales/followups')).data;
    if (f.followups.length || f.visits.length) {
      el.insertAdjacentHTML('afterbegin', `<h3>Today</h3><div class="card" style="border-color:#f59e0b;background:#fffbeb">
        ${f.followups.map((x) => `<p style="margin:4px 0"><a href="#" data-fu="${x.id}"><b>${esc(x.name)}</b></a> — follow up ${esc(String(x.next_followup_at).replace('T', ' ').substring(0, 16))} · <a href="tel:${esc(x.phone)}">call</a></p>`).join('')}
        ${f.visits.map((x) => `<p style="margin:4px 0">🏠 <a href="#" data-fu="${x.lead_id}"><b>${esc(x.name)}</b></a> — visit ${esc(String(x.visit_at).replace('T', ' ').substring(0, 16))}</p>`).join('')}</div>`);
      el.querySelectorAll('[data-fu]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); leadDetail(a.dataset.fu); }; });
    }
  } catch (e) { /* roles without access */ }
  if (!mgr) return;
  try {
    const [fun, par] = await Promise.all([api('/api/reports/funnel'), api('/api/sales/partners')]);
    const total = fun.data.status.reduce((t, s) => t + s.n, 0);
    let html = `<h3>Lead funnel</h3><div class="card"><div class="row-btns" style="margin:0">${LEAD_STATUS.map(([k, l]) => `<span class="chip">${esc(l)}: <b>${(fun.data.status.find((s) => s.status === k) || { n: 0 }).n}</b></span>`).join('')}</div>
      <p class="muted" style="margin-top:10px">${total} leads · average first response ${fun.data.avg_first_response_hours == null ? '—' : fun.data.avg_first_response_hours + ' hours'}</p>
      ${fun.data.source.map((s) => `<p style="margin:2px 0">${esc(s.source || 'other')}: ${s.n} leads, ${s.booked || 0} booked</p>`).join('')}</div>`;
    html += `<h3>Channel partners</h3><div class="row-btns" style="margin:0 0 10px"><button class="btn small" id="pt-add">+ Add partner</button></div>` + (par.data.partners.map((p) => {
      const payable = p.earned_paise - p.paid_paise;
      return `<div class="card"><div class="row"><div><b>${esc(p.firm)}</b><p class="muted">${esc(p.contact || '')} ${esc(p.phone || '')}${p.brokerage_default_bp ? ' · default ' + (p.brokerage_default_bp / 100) + '%' : ''}</p></div><div style="text-align:right"><div>Payable <b>${moneyP(Math.max(payable, 0))}</b></div><div class="muted">earned ${moneyP(p.earned_paise)} · paid ${moneyP(p.paid_paise)}</div></div></div>${userCanClient('sales', 'A') ? `<div class="row-btns"><button class="btn small" data-pay="${p.id}">Record payment</button></div>` : ''}</div>`;
    }).join('') || '<p class="muted">No partners yet.</p>');
    el.insertAdjacentHTML('beforeend', html);
    $('pt-add').onclick = async () => {
      const v = await openForm({ title: 'Add channel partner', fields: [{ name: 'firm', label: 'Firm', required: true }, { name: 'contact', label: 'Contact person' }, { name: 'phone', label: 'Mobile', type: 'tel' }, { name: 'rera_no', label: 'RERA number' }, { name: 'brokerage_default_bp', label: 'Default brokerage (%)', type: 'number' }] });
      if (!v) return; if (v.brokerage_default_bp !== undefined && v.brokerage_default_bp !== '') v.brokerage_default_bp = Math.round(Number(v.brokerage_default_bp) * 100);
      if (await act(api('/api/sales/partners', { method: 'POST', body: v }), 'Partner added')) loadSales();
    };
    el.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = async () => {
      const v = await openForm({ title: 'Brokerage payment', fields: [{ name: 'amount_paise', label: 'Amount (₹)', type: 'money', required: true }, { name: 'tds_paise', label: 'TDS deducted (₹)', type: 'money' }, { name: 'paid_on', label: 'Paid on', type: 'date', value: today() }, { name: 'ref_no', label: 'Reference' }] });
      if (v && await act(api(`/api/sales/partners/${b.dataset.pay}/payments`, { method: 'POST', body: v }), 'Recorded')) loadSales();
    }; });
  } catch (e) { /* hidden for roles without access */ }
}

// booking form: optional channel partner + brokerage
bookUnit = async function (unit) {
  let partners = []; try { partners = (await api('/api/sales/partners')).data.partners; } catch (e) { /* not allowed */ }
  const v = await openForm({ title: `Book ${unit.wing ? unit.wing + '-' : ''}${unit.unit_no}`, intro: 'Payment demands are created from the project payment plan, to the paisa.', fields: [
    { name: 'customer_name', label: 'Customer name', required: true }, { name: 'phone', label: 'Mobile' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'pan', label: 'Customer PAN', help: 'Stored encrypted.' },
    { name: 'agreed_price_paise', label: 'Agreed price (₹)', type: 'money', value: ((unit.price_paise + (unit.floor_rise_paise || 0)) / 100) }, { name: 'token_paise', label: 'Token received (₹)', type: 'money' },
    ...(partners.length ? [{ name: 'channel_partner_id', label: 'Channel partner', type: 'select', options: [['', 'Direct (no partner)'], ...partners.map((p) => [p.id, p.firm])] }, { name: 'brokerage_pct', label: 'Brokerage % (blank = partner default)', type: 'number' }] : [])] });
  if (!v) return;
  if (v.channel_partner_id) { v.channel_partner_id = Number(v.channel_partner_id); if (v.brokerage_pct !== undefined && v.brokerage_pct !== '') v.brokerage_bp = Math.round(Number(v.brokerage_pct) * 100); } else { delete v.channel_partner_id; }
  delete v.brokerage_pct;
  const r = await act(api('/api/sales/bookings', { method: 'POST', body: { unit_id: unit.id, ...v } }), 'Booked');
  if (r) { if (r.data.warning) alert(r.data.warning); loadSales(); }
};

// ---------- Home alerts: expiring approvals, unanswered queries, drawings awaited, follow-ups ----------
const _loadDashboard = loadDashboard;
loadDashboard = async function () {
  await _loadDashboard();
  const grid = $('dashboard-grid'); if (!grid) return;
  try {
    const d = (await api('/api/dashboard')).data;
    const alerts = [
      [d.approvalsExpiring, 'approvals expiring within 30 days', 'approvals', 'warn'], [d.staleQueries, 'approval queries unanswered 5+ days', 'approvals', 'bad'],
      [d.waitingConsultant, 'drawings still waiting from the consultant', 'drawings', 'warn'], [d.followupsDue, 'lead follow-ups due', 'sales', 'info'],
    ].filter((a) => a[0] > 0);
    if (!alerts.length || $('home-alerts')) return;
    grid.insertAdjacentHTML('beforebegin', `<div id="home-alerts" class="card" style="margin-bottom:16px"><b>Needs attention</b><div class="row-btns">${alerts.map(([n, l, r]) => `<button class="btn small" data-go="${r}"><b>${n}</b>&nbsp;${esc(l)}</button>`).join('')}</div></div>`);
    $('home-alerts').querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
  } catch (e) { /* no access */ }
};

// PM home = the same dashboard (tiles + alerts)
const _renderHome = renderHome;
renderHome = PAGES.home = function (main) {
  if (currentUser.role === 'pm') { renderDashboard(main); return; }
  _renderHome(main);
};

// ---------- Notifications: tap to open the right screen ----------
const _renderNotifications = renderNotifications;
renderNotifications = PAGES.notifications = function (main) {
  _renderNotifications(main);
  const go = (link) => { const r = String(link || '').split(/[#:]/)[0]; return { approvals: 'approvals', lead: 'sales', drawings: 'drawings', procurement: 'procurement', site: 'site', storage: 'storage' }[r]; };
  setTimeout(() => {
    api('/api/notifications').then((d) => {
      const cards = document.querySelectorAll('#notif-list .card');
      d.data.notifications.forEach((n, i) => { const r = go(n.link); if (r && cards[i]) { cards[i].classList.add('clickable'); cards[i].onclick = () => navigate(r); } });
    }).catch(() => {});
  }, 400);
};

// ---------- Global search ----------
document.addEventListener('DOMContentLoaded', () => {
  const b = $('btn-search'); if (!b) return;
  b.innerHTML = icon('search');
  b.onclick = () => {
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal"><div class="field"><input id="gs-q" type="search" placeholder="Search projects, drawings, leads, vendors, POs, documents…" autocomplete="off" style="width:100%"></div><div id="gs-out" class="muted">Type at least 2 letters.</div><div class="modal-actions"><button class="btn" id="gs-close">Close</button></div></div>`;
    document.body.appendChild(ov); $('gs-q').focus();
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc2); }; const esc2 = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc2); $('gs-close').onclick = close;
    let t; $('gs-q').oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = $('gs-q').value.trim(); const out = $('gs-out'); if (!out) return;
        if (q.length < 2) { out.textContent = 'Type at least 2 letters.'; return; }
        try {
          const r = (await api('/api/search?q=' + encodeURIComponent(q))).data.results;
          out.innerHTML = r.length ? r.map((x, i) => `<div class="card clickable" data-i="${i}" style="margin:6px 0"><span class="chip">${esc(x.kind)}</span> <b>${esc(x.title)}</b> <span class="muted">${esc(x.sub || '')}</span></div>`).join('') : 'Nothing found.';
          out.querySelectorAll('[data-i]').forEach((c) => { c.onclick = () => { const x = r[Number(c.dataset.i)]; close(); navigate(x.route); }; });
        } catch (e) { out.textContent = e.message; }
      }, 250);
    };
  };
});
