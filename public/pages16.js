// pages16.js — WP-18: bank-statement CSV import and matching. The CSV is read in the browser; only credit lines are sent.

const _sidebarItems16 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems16(role).map((g) => [g[0], g[1].slice()]);
  if (['owner', 'accounts'].includes(role)) {
    const g = groups.find((x) => x[0] === 'Money') || groups.find((x) => x[0] === null);
    if (g) g[1].push({ label: 'Bank statement', route: 'bank', icon: 'bank' });
  }
  return groups;
};

// ---- CSV reading (quotes, commas, semicolons or tabs) ----
function bankParseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || ''; const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row); }
  return rows;
}
const BANK_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function bankDate(s, fmt) {
  s = String(s || '').trim(); let d, m, y;
  if (fmt === 'yyyy-mm-dd') { const x = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s); if (!x) return null; [y, m, d] = [x[1], x[2], x[3]]; }
  else if (fmt === 'dd-mmm-yy') { const x = /^(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/,]*(\d{2,4})/.exec(s); if (!x || !BANK_MONTHS[x[2].toLowerCase()]) return null; [d, m, y] = [x[1], BANK_MONTHS[x[2].toLowerCase()], x[3]]; }
  else { const x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s); if (!x) return null; [d, m, y] = [x[1], x[2], x[3]]; }
  y = String(y); if (y.length === 2) y = '20' + y; d = Number(d); m = Number(m);
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && Number(y) >= 2000)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const bankAmount = (s) => { const t = String(s || '').replace(/[₹,\s]|Rs\.?|INR|Cr$/gi, ''); if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return 0; return Math.round(parseFloat(t) * 100); };

let BANK = { rows: null, name: '' };

async function renderBank(main) {
  main.innerHTML = `<h1>Bank statement</h1><p class="help">Upload your bank's CSV. The CRM suggests which customer demand each credit pays. You confirm, and a normal receipt is made. Only credit lines are used and account numbers are never kept.</p>
    <div class="card"><div class="field"><label>Statement file (CSV)</label><input type="file" id="bk-file" accept=".csv,text/csv,.txt"></div><div id="bk-map"></div></div><div id="bk-review"></div>`;
  $('bk-file').onchange = async () => {
    const f = $('bk-file').files[0]; if (!f) return;
    BANK = { rows: bankParseCsv(await f.text()), name: f.name }; bankMapping();
  };
  bankReview();
}

async function bankMapping() {
  const rows = BANK.rows; if (!rows || rows.length < 2) { $('bk-map').innerHTML = '<div class="error">That file looks empty. Export the statement as CSV from your bank and try again.</div>'; return; }
  const profiles = (await api('/api/bank/profiles')).data.profiles;
  const head = rows[0]; const opt = (sel, none) => `${none ? '<option value="-1">— none —</option>' : ''}${head.map((h, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${i + 1}: ${esc(String(h).slice(0, 30))}</option>`).join('')}`;
  const guess = (re, d) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : d; };
  $('bk-map').innerHTML = `<p class="muted">${rows.length} lines in the file. Tell me which column is which.</p>
    ${profiles.length ? `<div class="field"><label>Saved bank format</label><select id="bk-prof"><option value="">— choose —</option>${profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>` : ''}
    <div class="grid"><div class="field"><label>Date</label><select id="bk-date">${opt(guess(/date/i, 0))}</select></div><div class="field"><label>Narration / description</label><select id="bk-narr">${opt(guess(/narr|desc|particular/i, 1))}</select></div>
    <div class="field"><label>Credit / deposit amount</label><select id="bk-credit">${opt(guess(/credit|deposit|cr\b/i, 3))}</select></div><div class="field"><label>Reference / cheque or UTR no.</label><select id="bk-ref">${opt(guess(/ref|chq|cheque|utr/i, -1), true)}</select></div>
    <div class="field"><label>Date looks like</label><select id="bk-fmt"><option value="dd/mm/yyyy">02/11/2026 (day first)</option><option value="yyyy-mm-dd">2026-11-02</option><option value="dd-mmm-yy">02-Nov-26</option></select></div><div class="field"><label>Header lines to skip</label><input type="number" id="bk-skip" value="1" min="0" max="50"></div></div>
    <p class="muted">First lines of your file:</p><div style="overflow:auto;font-size:.8em"><table>${rows.slice(0, 4).map((r) => `<tr>${r.slice(0, 8).map((c) => `<td>${esc(String(c).slice(0, 25))}</td>`).join('')}</tr>`).join('')}</table></div>
    <div class="row-btns"><button class="btn btn-primary" id="bk-go">Read the credits and import</button><button class="btn" id="bk-save">Save this bank format</button></div><div id="bk-msg"></div>`;
  const mapping = () => ({ date: Number($('bk-date').value), narration: Number($('bk-narr').value), credit: Number($('bk-credit').value), reference: $('bk-ref').value, format: $('bk-fmt').value, skip: Number($('bk-skip').value) });
  if ($('bk-prof')) $('bk-prof').onchange = () => { const p = profiles.find((x) => String(x.id) === $('bk-prof').value); if (!p) return; const m = p.mapping; $('bk-date').value = m.date; $('bk-narr').value = m.narration; $('bk-credit').value = m.credit; $('bk-ref').value = m.reference; $('bk-fmt').value = m.format; $('bk-skip').value = m.skip; };
  $('bk-save').onclick = async () => { const v = await openForm({ title: 'Save this bank format', fields: [{ name: 'name', label: 'Name (for example HDFC current account)', required: true }] }); if (v) await act(api('/api/bank/profiles', { method: 'POST', body: { name: v.name, mapping: mapping() } }), 'Saved'); };
  $('bk-go').onclick = async () => {
    const m = mapping(); const lines = []; const seen = new Map(); let skippedDebits = 0, bad = 0;
    rows.slice(m.skip).forEach((r) => { const date = bankDate(r[m.date], m.format), credit = bankAmount(r[m.credit]); if (!credit || credit < 0) { skippedDebits++; return; } if (!date) { bad++; return; }
      const ref = m.reference !== '-1' ? String(r[Number(m.reference)] || '').trim() : ''; const key = `${date}|${credit}|${ref}|${r[m.narration]}`; const n = (seen.get(key) || 0) + 1; seen.set(key, n);
      lines.push({ date, narration: r[m.narration] || '', credit_paise: credit, reference: ref, seq: n }); });
    if (!lines.length) { $('bk-msg').innerHTML = `<div class="error">No credit lines could be read. Check the date format and the credit column.</div>`; return; }
    if (bad) { $('bk-msg').innerHTML = `<div class="error">${bad} line(s) have a date that could not be read. Check "Date looks like".</div>`; return; }
    if (lines.length > 500) { $('bk-msg').innerHTML = `<div class="error">This file has ${lines.length} credit lines. Import at most 500 at a time: export a shorter date range.</div>`; return; }
    let batch = null, added = 0, dup = 0, sug = 0;
    for (let i = 0; i < lines.length; i += 100) {
      const r = await act(api('/api/bank/imports', { method: 'POST', body: { filename: BANK.name, batch_id: batch, rows: lines.slice(i, i + 100) } })); if (!r) return;
      batch = r.data.batch_id; added += r.data.added; dup += r.data.duplicates; sug += r.data.suggested; $('bk-msg').innerHTML = `<p class="muted">Importing… ${Math.min(i + 100, lines.length)} of ${lines.length}</p>`;
    }
    $('bk-msg').innerHTML = `<p>${chip(added + ' new', 'good')} ${dup ? chip(dup + ' already imported before', '') : ''} ${chip(sug + ' with a suggestion', 'info')} <span class="muted">${skippedDebits} debit/blank line(s) ignored</span></p>`;
    bankReview();
  };
}

async function bankReview() {
  const box = $('bk-review'); if (!box) return;
  try {
    const d = (await api('/api/bank/rows?status=')).data;
    const open = d.rows.filter((r) => r.status === 'suggested' || r.status === 'unmatched');
    box.innerHTML = `<h3>To review</h3><p class="muted">${d.counts.suggested} suggested · ${d.counts.unmatched} not matched · ${d.counts.confirmed} confirmed · ${d.counts.ignored} ignored</p>
      <div class="row-btns"><a class="btn small" href="/api/bank/report">Unmatched credits (Excel)</a></div>
      ${open.map((r) => `<div class="card"><div class="row"><div><b>${moneyP(r.credit_paise)}</b> · ${esc(r.txn_date)}<p class="muted">${esc(r.narration || '')}${r.reference ? ' · ' + esc(r.reference) : ''}</p></div>${r.status === 'suggested' ? chip('Suggested', 'info') : chip('Not matched', 'warn')}</div>
        ${r.matched_demand_id ? `<p><b>${esc(r.customer_name)}</b> · ${esc(r.project_name)} ${esc((r.wing ? r.wing + '-' : '') + r.unit_no)}<br><span class="muted">${esc(r.demand_label)} · due ${moneyP(r.demand_due)}</span></p>` : ''}${r.suggestion_note ? `<p class="muted">${esc(r.suggestion_note)}</p>` : ''}
        <div class="row-btns">${r.matched_demand_id ? `<button class="btn btn-primary small" data-bc="${r.id}">Confirm and make the receipt</button>` : ''}<button class="btn small" data-bf="${r.id}">Choose a customer</button><button class="btn small" data-bi="${r.id}">Ignore</button></div></div>`).join('') || '<div class="empty-state"><p>Nothing waiting. Upload a statement above.</p></div>'}`;
    const find = (id) => open.find((x) => x.id === Number(id));
    box.querySelectorAll('[data-bi]').forEach((b) => { b.onclick = async () => { if (await act(api(`/api/bank/rows/${b.dataset.bi}/ignore`, { method: 'POST' }), 'Ignored')) bankReview(); }; });
    box.querySelectorAll('[data-bc]').forEach((b) => { b.onclick = () => bankConfirm(find(b.dataset.bc), find(b.dataset.bc).matched_booking_id, find(b.dataset.bc).matched_demand_id); });
    box.querySelectorAll('[data-bf]').forEach((b) => { b.onclick = async () => {
      const r = find(b.dataset.bf); const v = await openForm({ title: 'Find the customer', fields: [{ name: 'q', label: 'Customer name or flat number', required: true }] }); if (!v) return;
      const found = (await api('/api/bank/demands?q=' + encodeURIComponent(v.q))).data.demands; if (!found.length) { toast('No open demand found for that.'); return; }
      const pick = await openForm({ title: 'Which demand does ' + moneyP(r.credit_paise) + ' pay?', fields: [{ name: 'd', label: 'Demand', type: 'select', options: found.map((x) => [x.id, `${x.customer_name} · ${x.project_name} ${x.wing ? x.wing + '-' : ''}${x.unit_no} · ${x.label} · due ${moneyP(x.due)}`]) }] }); if (!pick) return;
      const dm = found.find((x) => x.id === Number(pick.d)); bankConfirm(r, dm.booking_id, dm.id);
    }; });
  } catch (err) { box.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// Make the normal receipt first (numbering, approval limit and duplicate checks all apply), then link the bank line to it.
async function bankConfirm(r, bookingId, demandId) {
  const ref = r.reference || 'BNK' + r.id;
  let res;
  try { res = await api(`/api/sales/bookings/${bookingId}/receipts`, { method: 'POST', body: { amount_paise: r.credit_paise, mode: 'bank', ref_no: ref, demand_id: demandId, received_on: r.txn_date, note: 'From bank statement' } }); }
  catch (e) { if (!/already exists/.test(e.message)) { toast(e.message, 6000); return; } }
  const c = await act(api(`/api/bank/rows/${r.id}/confirm`, { method: 'POST', body: { booking_id: bookingId, demand_id: demandId, ref_no: ref } }));
  if (c) { toast(res && res.data.pending ? 'Sent for approval by a second person. The bank line is linked to it.' : 'Receipt made and linked.', 5000); bankReview(); }
}

PAGES.bank = (m) => renderBank(m);
Object.assign(ROUTE_TITLES, { bank: 'Bank statement' });
Object.assign(ICONS, { bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18' });
