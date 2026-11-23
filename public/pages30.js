// pages30.js — Module 1 step 3: the monthly bank file for transit rent, and the Site board
// (site readiness %, gate QR code, latest approvals and drawings for an inspector, Monday follow-ups for consultants).

// ---------- bank details and the monthly bank file (rent tab) ----------
function m1Csv(rows) { return rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n'); }
function m1Download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function m1BankFile(d) {
  const rows = [['Sr No', 'Beneficiary name', 'Account number', 'IFSC', 'Amount (Rs)', 'Payment mode', 'Narration', 'Reference']];
  d.lines.forEach((l) => rows.push([l.n, l.holder, l.account, l.ifsc, (l.amount_paise / 100).toFixed(2), l.mode, l.narration, 'B' + d.batch.id]));
  m1Download(`transit-rent-${(d.society || 'society').replace(/[^A-Za-z0-9]+/g, '-')}-${d.batch.period}-batch${d.batch.id}.csv`, m1Csv(rows));
}
function m1ReceiptsBox(receipts) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal"><h2>Paid. Tell the members</h2><p class="help">Tap WhatsApp next to a name to open a ready message. Nothing is sent until you press send in WhatsApp.</p>
    ${receipts.map((r, i) => `<div class="card"><div class="row"><div><b>${esc(r.member_name)}</b><p class="muted">${esc(r.unit)}</p></div><a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(r.text)}">WhatsApp</a></div></div>`).join('') || '<p class="muted">No lines.</p>'}
    <div class="modal-actions"><button class="btn btn-primary" id="rcp-close" type="button">Done</button></div></div>`;
  document.body.appendChild(ov); $('rcp-close').onclick = () => ov.remove();
}

const _rdRent30 = rdRent;
rdRent = async function (pane, month) {
  await _rdRent30(pane, month);
  if (!isRole('owner', 'accounts')) return;
  const again = () => rdRent(pane, month);
  let batches = [], bank = [];
  try { batches = (await api(`/api/redev/societies/${RD.soc}/payout-batches`)).data.batches; bank = (await api(`/api/redev/societies/${RD.soc}/bank-status`)).data.members; } catch (e) { return; }
  const hasBank = new Map(bank.map((b) => [b.id, b]));
  const stat = { generated: chip('Waiting for payment', 'warn'), paid: chip('Paid', 'good'), cancelled: chip('Cancelled', 'bad') };
  pane.insertAdjacentHTML('afterbegin', `<div class="card"><b>Monthly bank file</b><p class="muted">One file for the unpaid rent of every member who has bank details. The months go into the file once, so nobody is paid twice.</p>
    <div class="field"><label>Pay everything unpaid up to</label><input type="month" id="bf-month" value="${esc(month || new Date(Date.now() + 19800000).toISOString().slice(0, 7))}"></div>
    <button class="btn btn-primary" id="bf-make">Make the bank file</button></div>
    ${batches.map((b) => `<div class="card"><div class="row"><div><b>Batch ${b.id} · up to ${esc(b.period)}</b><p class="muted">${b.line_count} member(s) · ${moneyP(b.total_paise)} · ${esc(dateIST(b.created_at))} ${stat[b.status] || ''}</p>${b.status === 'paid' ? `<p class="muted">Paid ${esc(b.paid_on || '')} · ${esc((b.mode || '').toUpperCase())} · ref ${esc(b.bank_ref || '')}</p>` : ''}</div></div>
      ${b.status === 'generated' ? `<div class="row-btns"><button class="btn small" data-bf-dl="${b.id}">Download again</button><button class="btn small btn-primary" data-bf-paid="${b.id}">Mark paid</button><button class="btn small" data-bf-x="${b.id}">Cancel</button></div>` : ''}</div>`).join('')}`);
  $('bf-make').onclick = async () => {
    const r = await act(api(`/api/redev/societies/${RD.soc}/payout-batches`, { method: 'POST', body: { month: $('bf-month').value } }));
    if (!r) return;
    m1BankFile(r.data);
    toast(`Bank file made: ${r.data.lines.length} member(s)${r.data.more_members ? `; ${r.data.more_members} more are left for the next file` : ''}${r.data.skipped.length ? `. No bank details for ${r.data.skipped.length}: ${r.data.skipped.slice(0, 3).join(', ')}` : ''}`, 9000);
    again();
  };
  pane.querySelectorAll('[data-bf-dl]').forEach((b) => { b.onclick = async () => { const r = await act(api(`/api/redev/payout-batches/${b.dataset.bfDl}`)); if (r) m1BankFile({ ...r.data, society: r.data.society }); }; });
  pane.querySelectorAll('[data-bf-paid]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Mark the bank file paid', intro: 'Do this only after the bank has made the payments.', fields: [
      { name: 'paid_on', label: 'Paid on', type: 'date', value: new Date(Date.now() + 19800000).toISOString().slice(0, 10), required: true }, { name: 'mode', label: 'How', type: 'select', options: [['neft', 'NEFT'], ['rtgs', 'RTGS'], ['cheque', 'Cheque'], ['upi', 'UPI']] },
      { name: 'bank_ref', label: 'Bank batch or reference number', required: true }] });
    if (!v) return; const r = await act(api(`/api/redev/payout-batches/${b.dataset.bfPaid}/paid`, { method: 'POST', body: v }), 'Recorded');
    if (r) { m1ReceiptsBox(r.data.receipts); again(); }
  }; });
  pane.querySelectorAll('[data-bf-x]').forEach((b) => { b.onclick = async () => {
    const v = await openForm({ title: 'Cancel this bank file', intro: 'The months go back to unpaid.', fields: [{ name: 'note', label: 'Why?', required: true }] });
    if (v && await act(api(`/api/redev/payout-batches/${b.dataset.bfX}/cancel`, { method: 'POST', body: v }), 'Cancelled')) again();
  }; });
  // bank details button on every member row
  pane.querySelectorAll('[data-hist]').forEach((b) => {
    const id = Number(b.dataset.hist); if (b.parentElement.querySelector(`[data-bank="${id}"]`)) return;
    const h = hasBank.get(id);
    b.insertAdjacentHTML('afterend', `<button class="btn small" data-bank="${id}">${h ? 'Bank details ✓' : 'Bank details'}</button>`);
  });
  pane.querySelectorAll('[data-bank]').forEach((b) => { b.onclick = async () => {
    const h = hasBank.get(Number(b.dataset.bank)) || {};
    const v = await openForm({ title: 'Bank details', intro: h.bank_acct_last4 ? `On file: ${h.bank_holder || ''}, account ending ${h.bank_acct_last4}, ${h.bank_ifsc || ''}. Leave the account number empty to keep it.` : 'Where this member\'s rent is paid. The account number is kept scrambled and only its last 4 digits are shown.', fields: [
      { name: 'holder', label: 'Account holder name', value: h.bank_holder || '', required: !h.bank_holder }, { name: 'account', label: 'Account number', inputmode: 'numeric' }, { name: 'ifsc', label: 'IFSC code', value: h.bank_ifsc || '', placeholder: 'HDFC0001234' }] });
    if (v && await act(api(`/api/redev/members/${b.dataset.bank}/bank`, { method: 'PUT', body: v }), 'Saved')) again();
  }; });
};

// ---------- Site board ----------
const SB = { pid: null };
const _sidebarItems30 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems30(role).map((g) => [g[0], g[1].slice()]);
  if (['owner', 'pm', 'site', 'viewer'].includes(role)) { const g = groups.find((x) => x[0] === 'Projects'); if (g && !g[1].some((i) => i.route === 'siteboard')) g[1].push({ label: 'Site board', route: 'siteboard', icon: 'siteboard' }); }
  return groups;
};
PAGES.siteboard = (m) => renderSiteBoard(m);
Object.assign(ROUTE_TITLES, { siteboard: 'Site board' });
Object.assign(ICONS, { siteboard: 'M4 4h16v16H4zM8 8h3v3H8zM13 8h3M13 11h3M8 15h8' });
// the gate QR opens the site board for that project (staff log in as usual)
window.addEventListener('load', () => { const m = (location.hash || '').match(/^#inspection-(\d+)$/); if (m) { SB.pid = Number(m[1]); setScopeProject(SB.pid); try { sessionStorage.setItem('nirmaan.welcomed', '1'); } catch (e) { /* ignore */ } const t0 = setInterval(() => { if (typeof currentUser !== 'undefined' && currentUser) { clearInterval(t0); navigate('siteboard'); } }, 300); setTimeout(() => clearInterval(t0), 8000); } });

async function renderSiteBoard(main) {
  const projects = await getProjects();
  if (!SB.pid || !projects.some((p) => p.id === SB.pid)) SB.pid = (typeof scopeProject !== 'undefined' && scopeProject) || (projects[0] && projects[0].id) || null;
  if (!SB.pid) { main.innerHTML = '<h1>Site board</h1><div class="empty-state"><p>No project yet.</p></div>'; return; }
  main.innerHTML = `<h1>Site board</h1><div class="field"><label>Project</label><select id="sb-proj">${projects.map((p) => `<option value="${p.id}"${p.id === SB.pid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div><div id="sb-body"><p class="muted">Loading…</p></div>`;
  $('sb-proj').onchange = () => { SB.pid = Number($('sb-proj').value); renderSiteBoard(main); };
  const pid = SB.pid; const soft = (p, d) => p.catch(() => d);
  const [rd, ins, con] = await Promise.all([soft(api(`/api/projects/${pid}/readiness`), null), soft(api(`/api/projects/${pid}/inspection`), null), soft(api(`/api/projects/${pid}/consultant-summary`), null)]);
  const body = $('sb-body'); if (!body) return;
  const gateUrl = `${location.origin}/#inspection-${pid}`;
  let html = '';
  if (rd) {
    const c = rd.data; const tone = c.pct >= 90 ? '#16a34a' : c.pct >= 60 ? '#d97706' : '#dc2626';
    html += `<div class="card"><b>Site readiness</b><div style="height:18px;background:#e5e7eb;border-radius:9px;margin:10px 0;overflow:hidden"><div style="height:100%;width:${c.pct}%;background:${tone}"></div></div><p><b>${esc(c.headline)}</b></p>
      ${c.checks.map((k) => `<div class="row"><div>${esc(k.label)}</div><div>${k.done} of ${k.total} ${k.pct === 100 ? chip('Done', 'good') : chip(k.pct + '%', 'warn')}</div></div>`).join('')}<p class="help">${esc(c.how)}</p></div>`;
  }
  html += `<div class="card"><b>Gate board for inspectors</b><p class="muted">Print this once and put it at the site gate. Your site engineer scans it with the site tablet or phone, signs in, and sees the latest approvals and drawings below.</p>
    <div style="text-align:center;margin:10px 0">${typeof qrSvg === 'function' ? qrSvg(gateUrl, 220) : ''}</div><p class="muted" style="word-break:break-all;text-align:center">${esc(gateUrl)}</p>
    <div class="row-btns"><button class="btn small btn-primary" id="sb-print">Print the gate board</button><button class="btn small" id="sb-copy">Copy the link</button></div></div>`;
  if (ins) {
    const a = ins.data.approvals;
    html += `<h3>Approvals on file</h3>${a.length ? a.map((i) => `<div class="card"><div class="row"><div><b class="caps">${esc(i.name)}</b>${i.expired ? ' ' + chip('Expired', 'bad') : ''}<p class="muted">${i.letter_no ? 'Letter ' + esc(i.letter_no) : ''}${i.letter_date ? ' · dated ' + esc(String(i.letter_date).slice(0, 10)) : ''}${i.valid_till ? ' · valid till ' + esc(String(i.valid_till).slice(0, 10)) : ''}${i.cc_upto_floor != null ? ' · up to floor ' + esc(i.cc_upto_floor) : ''}</p></div>${i.letter_doc_id ? `<a class="btn small" target="_blank" rel="noopener" href="/api/files/download/${i.letter_doc_id}">Open letter</a>` : '<span class="muted">No file</span>'}</div></div>`).join('') : '<div class="empty-state"><p>No approved approvals yet.</p></div>'}
      <h3>Drawings issued for construction</h3>${ins.data.drawings.length ? ins.data.drawings.map((d) => `<div class="card"><div class="row"><div><b>${esc(d.code)}</b> · ${esc(d.title)}<p class="muted">${esc(d.discipline || '')} · rev ${esc(d.rev_no)}</p></div>${d.document_id ? `<a class="btn small" target="_blank" rel="noopener" href="/api/files/download/${d.document_id}">Open</a>` : ''}</div></div>`).join('') : '<p class="muted">None issued yet.</p>'}`;
  }
  if (con && isRole('owner', 'pm')) {
    html += `<h3>Monday follow-ups</h3><p class="help">One message per consultant listing what is pending. Tap WhatsApp, pick the person, and send. Nothing goes out by itself.</p>${con.data.groups.length ? con.data.groups.map((g, i) => `<div class="card"><div class="row"><div><b>${esc(g.consultant)}</b><p class="muted">${g.count} pending${g.late ? ` · ${g.late} late` : ''}</p></div><a class="btn small btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(g.text)}">WhatsApp</a></div><p class="muted" style="white-space:pre-line">${esc(g.items.slice(0, 4).map((x) => x.name).join(', '))}${g.items.length > 4 ? '…' : ''}</p></div>`).join('') : '<div class="empty-state"><p>Nothing is pending with consultants.</p></div>'}
      ${con.data.drawings_text ? `<div class="card"><b>Drawings waiting for a consultant</b><p class="muted">${esc(con.data.drawings_text)}</p><a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Pending drawings for review: ' + con.data.drawings_waiting.map((d) => d.code).join(', '))}">WhatsApp</a></div>` : ''}`;
  }
  body.innerHTML = html;
  const copy = $('sb-copy'); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(gateUrl); toast('Link copied'); } catch (e) { toast(gateUrl, 6000); } };
  const pr = $('sb-print'); if (pr) pr.onclick = () => {
    const name = (projects.find((p) => p.id === pid) || {}).name || '';
    const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.', 4000);
    w.document.write(`<!doctype html><title>Gate board</title><body style="font-family:sans-serif;text-align:center;padding:30px"><h1 style="font-size:34px">${esc(name)}</h1><h2>Inspection board</h2><div style="margin:20px auto;width:420px">${qrSvg(gateUrl, 420)}</div><p style="font-size:20px">Site staff: scan to see the latest approvals and drawings.<br>Sign in with your own login.</p><p style="color:#555;word-break:break-all">${esc(gateUrl)}</p><script>onload=()=>print()<\/script></body>`); w.document.close();
  };
}
