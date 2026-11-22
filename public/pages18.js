// pages18.js — WP-17: export vouchers for Tally (export only). The browser builds the XML file; nothing is posted to Tally from here.

const _sidebarItems18 = sidebarItems;
sidebarItems = function (role) {
  const groups = _sidebarItems18(role).map((g) => [g[0], g[1].slice()]);
  if (['owner', 'accounts', 'viewer'].includes(role)) {
    const g = groups.find((x) => x[0] === 'Money') || groups.find((x) => x[0] === 'Admin') || groups.find((x) => x[0] === null);
    if (g) g[1].push({ label: 'Tally export', route: 'tally', icon: 'tally' });
  }
  return groups;
};

const TALLY_KINDS = [['receipts', 'Receipts from customers'], ['credit_notes', 'Credit and debit notes'], ['purchase_bills', 'Purchase bills (vendors)'], ['vendor_payments', 'Vendor payments'], ['ra_bills', 'Contractor running bills'], ['contractor_payments', 'Contractor payments'], ['petty', 'Petty cash expenses']];
const xmlEsc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// paise to a decimal string with integer maths only, so the file matches the CRM to the paisa
const tallyAmt = (p, negative) => `${negative ? '-' : ''}${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;

function tallyXml(vouchers, company) {
  const msgs = vouchers.map((v) => {
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${xmlEsc(v.vtype)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${v.date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>${xmlEsc(v.vtype)}</VOUCHERTYPENAME>${v.number ? `<VOUCHERNUMBER>${xmlEsc(v.number)}</VOUCHERNUMBER>` : ''}<NARRATION>${xmlEsc(v.narration)}</NARRATION>${v.party ? `<PARTYLEDGERNAME>${xmlEsc(v.party)}</PARTYLEDGERNAME>` : ''}<EFFECTIVEDATE>${v.date.replace(/-/g, '')}</EFFECTIVEDATE>`
      + v.entries.map((e) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${e.dr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${tallyAmt(e.paise, e.dr)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('') + '</VOUCHER></TALLYMESSAGE>';
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${company ? `<SVCURRENTCOMPANY>${xmlEsc(company)}</SVCURRENTCOMPANY>` : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>\n${msgs}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

let TALLY = { vouchers: null };

async function renderTally(main) {
  const canMap = isRole('owner', 'accounts');
  const m = (await api('/api/tally/map')).data, map = m.map || {};
  const first = today().substring(0, 8) + '01';
  main.innerHTML = `<h1>Tally export</h1><div class="card" style="border-left:4px solid var(--s4)"><b>Not yet checked with your Tally.</b><p class="muted">The file follows Tally's standard import format, but it has not been imported into your accountant's Tally yet. Import a small file (one day) into a test company first, and tell your accountant which ledger names to create. The CRM only exports. It does no accounting.</p></div>
    <div class="card"><h3>1. Choose what to export</h3><div class="grid"><div class="field"><label>What</label><select id="ty-kind">${TALLY_KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div><div class="field"><label>From</label><input type="date" id="ty-from" value="${first}"></div><div class="field"><label>To</label><input type="date" id="ty-to" value="${today()}"></div></div>
      <button class="btn btn-primary" id="ty-check">Check the vouchers</button><div id="ty-result"></div></div>
    <div class="card"><h3>2. Ledger names</h3>${canMap ? `<p class="muted">Type the ledger names exactly as they are in Tally. A voucher that needs a name you have not typed is held back and listed, never exported half-done.</p><div class="grid">
      ${Object.entries(m.labels).map(([k, l]) => `<div class="field"><label>${esc(l)}</label><input data-map="${k}" value="${esc(map[k] || '')}"></div>`).join('')}<div class="field"><label>Company name in Tally (optional)</label><input id="ty-company" value="${esc(map.company || '')}"></div></div>
      <div class="field"><label class="check"><input type="checkbox" id="ty-auto"${map.auto_party !== false ? ' checked' : ''}> Use the customer / vendor / contractor name as the ledger name when I have not listed one below</label></div>
      <div class="field"><label>Ledger for a particular party (one per line: Name = Ledger name)</label><textarea id="ty-parties" rows="4">${esc(Object.entries(map.parties || {}).map(([k, v]) => `${k} = ${v}`).join('\n'))}</textarea></div><button class="btn" id="ty-save">Save ledger names</button>`
      : `<p class="muted">Only Accounts and the Owner change the ledger names.</p>`}</div>
    <div class="card"><h3>Earlier exports</h3><div id="ty-log">Loading...</div></div>`;
  loadTallyLog();
  if (canMap) $('ty-save').onclick = async () => {
    const body = { auto_party: $('ty-auto').checked, company: $('ty-company').value, parties: {} };
    main.querySelectorAll('[data-map]').forEach((i) => { body[i.dataset.map] = i.value; });
    $('ty-parties').value.split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) body.parties[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
    await act(api('/api/tally/map', { method: 'POST', body }), 'Ledger names saved');
  };
  $('ty-check').onclick = async () => {
    const kind = $('ty-kind').value, from = $('ty-from').value, to = $('ty-to').value, box = $('ty-result'); const all = [];
    box.innerHTML = '<p class="muted">Reading…</p>';
    try {
      for (let page = 1; page <= 40; page++) {
        const r = (await api(`/api/tally/vouchers?kind=${kind}&from=${from}&to=${to}&page=${page}`)).data; all.push(...r.vouchers);
        box.innerHTML = `<p class="muted">Reading… ${all.length} so far</p>`; if (!r.has_more) { TALLY.company = r.company; break; }
        if (page === 40) { box.innerHTML = '<div class="error">That is more than 2,000 vouchers. Choose a shorter date range.</div>'; return; }
      }
    } catch (err) { box.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
    const ok2 = all.filter((v) => !v.issues.length), held = all.filter((v) => v.issues.length);
    TALLY = { kind, from, to, ok: ok2, held, company: TALLY.company };
    const total = ok2.reduce((s, v) => s + v.total_paise, 0);
    const reasons = {}; held.forEach((v) => v.issues.forEach((i) => { reasons[i] = (reasons[i] || 0) + 1; }));
    box.innerHTML = `<div class="stat-row"><div class="stat"><b>${ok2.length}</b><span>ready to export</span></div><div class="stat"><b>${held.length}</b><span>held back</span></div><div class="stat"><b>${moneyP(total)}</b><span>total of the ready vouchers</span></div></div>
      ${held.length ? `<div class="card" style="border-left:4px solid var(--s8)"><b>Held back (not exported):</b>${Object.entries(reasons).map(([r, n]) => `<p>${chip(n + ' voucher(s)', 'bad')} ${esc(r)}</p>`).join('')}<p class="muted">Fix the ledger names above, then check again.</p></div>` : ''}
      ${ok2.length ? '<button class="btn btn-primary" id="ty-dl">Download the Tally file (XML)</button>' : '<p class="muted">Nothing to export for these dates.</p>'}`;
    if ($('ty-dl')) $('ty-dl').onclick = async () => {
      if (held.length && !confirm(`${held.length} voucher(s) are held back and will NOT be in the file. Download the ${ok2.length} ready ones?`)) return;
      const blob = new Blob([tallyXml(ok2, TALLY.company)], { type: 'application/xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tally-${kind}-${from}-to-${to}.xml`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await api('/api/tally/log', { method: 'POST', body: { kind, from, to, count: ok2.length, skipped: held.length, total_paise: total } }).catch(() => {}); loadTallyLog();
    };
  };
}

async function loadTallyLog() {
  const box = $('ty-log'); if (!box) return;
  try { const l = (await api('/api/tally/log')).data.log; box.innerHTML = l.map((x) => `<p class="muted"><b>${esc(dateIST(x.created_at))}</b> · ${esc((TALLY_KINDS.find((k) => k[0] === x.kind) || [0, x.kind])[1])} · ${esc(x.from_date)} to ${esc(x.to_date)} · ${x.voucher_count} vouchers${x.skipped_count ? ` (${x.skipped_count} held back)` : ''} · ${moneyP(x.total_paise)} · ${esc(x.by_name || '')}</p>`).join('') || '<p class="muted">Nothing exported yet.</p>'; }
  catch (e) { box.innerHTML = ''; }
}

PAGES.tally = (m) => renderTally(m);
Object.assign(ROUTE_TITLES, { tally: 'Tally export' });
Object.assign(ICONS, { tally: 'M12 3v12M7 10l5 5 5-5M4 21h16' });
