// routes/tally.js — WP-17: voucher data for Tally import. EXPORT ONLY.
// The Worker returns pages of vouchers (50 at a time) with the ledger names filled from the mapping and a list of problems per voucher
// (a ledger name not set, or a voucher that does not balance). The BROWSER turns the clean ones into the XML file, so the Worker does no XML work.
// Format fidelity is UNTESTED until the accountant imports a sample file into their own Tally.

const PAGE = 50;
const KINDS = ['receipts', 'vendor_payments', 'contractor_payments', 'petty', 'purchase_bills', 'ra_bills', 'credit_notes'];
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const LABELS = {
  bank: 'Bank ledger', cash: 'Cash ledger', interest_income: 'Interest income ledger', sales_income: 'Flat sales income ledger', gst_output: 'GST output ledger', gst_input: 'GST input ledger',
  tds_receivable: 'TDS receivable ledger', tds_payable: 'TDS payable ledger', retention_payable: 'Retention payable ledger', advance_recovery: 'Contractor advance ledger', other_deductions: 'Other deductions ledger',
  purchases: 'Purchases / materials ledger', contract_expense: 'Contractor works expense ledger', petty_cash: 'Petty cash ledger', petty_expense: 'Petty cash expense ledger',
};
const MAP_KEYS = Object.keys(LABELS);

export function registerTally(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, setSetting } = h;
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);
  const loadMap = async (env) => { try { let m = await getSetting(env, 'tally.ledger_map'); if (typeof m === 'string') m = JSON.parse(m || '{}'); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; } };

  router.get('/api/tally/map', async (req, env) => withAuth(req, env, 'tally', 'V', async (req, env) => {
    try { const m = await loadMap(env); return json({ ok: true, data: { map: m, labels: LABELS, kinds: KINDS } }); } catch (e) { return serverError(e, 'tally-map'); }
  }));
  router.post('/api/tally/map', async (req, env) => withAuth(req, env, 'tally', 'C', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({})); const out = { auto_party: b.auto_party !== false, company: String(b.company || '').trim().slice(0, 100), parties: {} };
      for (const k of MAP_KEYS) out[k] = String(b[k] || '').trim().slice(0, 100);
      const parties = b.parties && typeof b.parties === 'object' ? b.parties : {};
      let n = 0; for (const [name, led] of Object.entries(parties)) { if (n++ >= 300) break; const k = String(name).trim().slice(0, 150), v = String(led || '').trim().slice(0, 100); if (k && v) out.parties[k] = v; }
      await setSetting(env, 'tally.ledger_map', JSON.stringify(out), req.user.user_id);
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'update', 'tally_map', 0, 'Changed the Tally ledger names', ?)").bind(req.user.user_id, nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'tally-map-save'); }
  }));

  // Build one voucher from its parts and check it: every ledger named, debits equal credits.
  function voucher(map, v) {
    const issues = []; const entries = []; let partyLedger = '';
    const need = (key) => { const l = map[key]; if (!l) { issues.push(`${LABELS[key]} is not set`); return `(${LABELS[key]})`; } return l; };
    const party = (name) => { const l = (map.parties && map.parties[name]) || (map.auto_party !== false && name ? name : ''); if (!l) { issues.push(`No ledger for "${name}"`); return `(${name})`; } partyLedger = l; return l; };
    v.build({ need, party, dr: (ledger, paise) => paise > 0 && entries.push({ ledger, paise, dr: true }), cr: (ledger, paise) => paise > 0 && entries.push({ ledger, paise, dr: false }) });
    const dr = entries.filter((e) => e.dr).reduce((s, e) => s + e.paise, 0), cr = entries.filter((e) => !e.dr).reduce((s, e) => s + e.paise, 0);
    if (dr !== cr) issues.push(`Does not balance (debits ${(dr / 100).toFixed(2)}, credits ${(cr / 100).toFixed(2)}). Check the record.`);
    if (!entries.length) issues.push('Nothing to post');
    return { key: v.key, kind: v.kind, vtype: v.vtype, date: v.date, number: v.number || '', narration: String(v.narration || '').slice(0, 250), party: partyLedger, project: v.project || '', entries, total_paise: dr, issues };
  }
  const bankOrCash = (mode, need) => (mode === 'cash' ? need('cash') : need('bank'));
  const day = (s) => String(s || '').substring(0, 10);

  const SQL = {
    receipts: (ph) => `SELECT r.id, r.receipt_no, r.received_on AS d, r.amount_paise, r.tds_paise, r.mode, r.ref_no, r.kind AS rkind, b.customer_name AS who, pr.name AS project FROM sal_receipts r JOIN sal_bookings b ON b.id = r.booking_id JOIN projects pr ON pr.id = b.project_id
      WHERE r.reversed_at IS NULL AND r.received_on BETWEEN ?2 AND ?3 AND b.project_id IN (SELECT value FROM json_each(?1)) ORDER BY r.received_on, r.id LIMIT ${PAGE + 1} OFFSET ?4`,
    vendor_payments: () => `SELECT p.id, p.paid_on AS d, p.amount_paise, p.tds_paise, p.mode, p.ref_no, b.bill_no, v.name AS who, pr.name AS project FROM pro_payments p JOIN pro_bills b ON b.id = p.bill_id JOIN pro_vendors v ON v.id = b.vendor_id LEFT JOIN projects pr ON pr.id = b.project_id
      WHERE p.reversed_at IS NULL AND p.paid_on BETWEEN ?2 AND ?3 AND (b.project_id IS NULL OR b.project_id IN (SELECT value FROM json_each(?1))) ORDER BY p.paid_on, p.id LIMIT ${PAGE + 1} OFFSET ?4`,
    contractor_payments: () => `SELECT p.id, p.paid_on AS d, p.amount_paise, p.mode, p.ref_no, p.kind AS pkind, w.wo_no, c.name AS who, pr.name AS project FROM con_payments p JOIN con_work_orders w ON w.id = p.wo_id JOIN con_contractors c ON c.id = w.contractor_id JOIN projects pr ON pr.id = w.project_id
      WHERE p.reversed_at IS NULL AND p.paid_on BETWEEN ?2 AND ?3 AND w.project_id IN (SELECT value FROM json_each(?1)) ORDER BY p.paid_on, p.id LIMIT ${PAGE + 1} OFFSET ?4`,
    petty: () => `SELECT e.id, e.entry_date AS d, e.amount_paise, e.category, e.narration, pr.name AS project FROM pty_entries e JOIN pty_funds f ON f.id = e.fund_id JOIN projects pr ON pr.id = f.project_id
      WHERE e.kind = 'expense' AND e.status = 'approved' AND e.entry_date BETWEEN ?2 AND ?3 AND f.project_id IN (SELECT value FROM json_each(?1)) ORDER BY e.entry_date, e.id LIMIT ${PAGE + 1} OFFSET ?4`,
    purchase_bills: () => `SELECT b.id, substr(b.created_at, 1, 10) AS d, b.bill_no, b.amount_paise, b.taxable_paise, b.gst_paise, b.tds_paise, v.name AS who, pr.name AS project FROM pro_bills b JOIN pro_vendors v ON v.id = b.vendor_id LEFT JOIN projects pr ON pr.id = b.project_id
      WHERE b.status NOT IN ('rejected', 'cancelled') AND substr(b.created_at, 1, 10) BETWEEN ?2 AND ?3 AND (b.project_id IS NULL OR b.project_id IN (SELECT value FROM json_each(?1))) ORDER BY b.created_at, b.id LIMIT ${PAGE + 1} OFFSET ?4`,
    ra_bills: () => `SELECT r.id, substr(COALESCE(r.approved_at, r.created_at), 1, 10) AS d, r.ra_no, w.wo_no, r.gross_paise, r.retention_paise, r.advance_recovery_paise, r.other_deductions_paise, r.gst_paise, r.tds_paise, r.net_paise, c.name AS who, pr.name AS project
      FROM con_ra_bills r JOIN con_work_orders w ON w.id = r.wo_id JOIN con_contractors c ON c.id = w.contractor_id JOIN projects pr ON pr.id = w.project_id
      WHERE r.status IN ('approved', 'part_paid', 'paid') AND substr(COALESCE(r.approved_at, r.created_at), 1, 10) BETWEEN ?2 AND ?3 AND w.project_id IN (SELECT value FROM json_each(?1)) ORDER BY d, r.id LIMIT ${PAGE + 1} OFFSET ?4`,
    credit_notes: () => `SELECT a.id, a.adj_no, a.kind AS akind, a.reason, substr(COALESCE(a.approved_at, a.created_at), 1, 10) AS d, a.amount_paise, a.gst_paise, b.customer_name AS who, pr.name AS project FROM sal_adjustments a JOIN sal_bookings b ON b.id = a.booking_id JOIN projects pr ON pr.id = b.project_id
      WHERE a.status = 'approved' AND a.kind IN ('credit_note', 'debit_note') AND substr(COALESCE(a.approved_at, a.created_at), 1, 10) BETWEEN ?2 AND ?3 AND b.project_id IN (SELECT value FROM json_each(?1)) ORDER BY d, a.id LIMIT ${PAGE + 1} OFFSET ?4`,
  };

  const BUILD = {
    receipts: (map, r) => voucher(map, { key: 'receipt:' + r.id, kind: 'receipts', vtype: 'Receipt', date: r.d, number: r.receipt_no, project: r.project, narration: `${r.rkind === 'interest' ? 'Interest' : 'Receipt'} from ${r.who}${r.ref_no ? ', ref ' + r.ref_no : ''}`,
      build: ({ need, party, dr, cr }) => { dr(bankOrCash(r.mode, need), r.amount_paise); if (r.tds_paise > 0) dr(need('tds_receivable'), r.tds_paise); cr(r.rkind === 'interest' ? need('interest_income') : party(r.who), r.amount_paise + r.tds_paise); } }),
    vendor_payments: (map, r) => voucher(map, { key: 'vpay:' + r.id, kind: 'vendor_payments', vtype: 'Payment', date: r.d, number: r.ref_no, project: r.project, narration: `Payment to ${r.who}${r.bill_no ? ' against bill ' + r.bill_no : ''}`,
      build: ({ need, party, dr, cr }) => { dr(party(r.who), r.amount_paise + (r.tds_paise || 0)); cr(bankOrCash(r.mode, need), r.amount_paise); if (r.tds_paise > 0) cr(need('tds_payable'), r.tds_paise); } }),
    contractor_payments: (map, r) => voucher(map, { key: 'cpay:' + r.id, kind: 'contractor_payments', vtype: 'Payment', date: r.d, number: r.ref_no, project: r.project, narration: `Payment to ${r.who}, work order ${r.wo_no}${r.pkind && r.pkind !== 'ra' ? ' (' + r.pkind + ')' : ''}`,
      build: ({ need, party, dr, cr }) => { dr(party(r.who), r.amount_paise); cr(bankOrCash(r.mode, need), r.amount_paise); } }),
    petty: (map, r) => voucher(map, { key: 'petty:' + r.id, kind: 'petty', vtype: 'Payment', date: r.d, number: '', project: r.project, narration: `Petty cash: ${r.category || ''} ${r.narration || ''}`.trim(),
      build: ({ need, dr, cr }) => { dr(need('petty_expense'), r.amount_paise); cr(need('petty_cash'), r.amount_paise); } }),
    purchase_bills: (map, r) => voucher(map, { key: 'bill:' + r.id, kind: 'purchase_bills', vtype: 'Purchase', date: r.d, number: r.bill_no, project: r.project, narration: `Purchase bill ${r.bill_no || r.id} from ${r.who}`,
      build: ({ need, party, dr, cr }) => { const gst = r.gst_paise || 0, taxable = r.taxable_paise != null ? r.taxable_paise : r.amount_paise - gst; dr(need('purchases'), taxable); if (gst > 0) dr(need('gst_input'), gst); cr(party(r.who), r.amount_paise - (r.tds_paise || 0)); if (r.tds_paise > 0) cr(need('tds_payable'), r.tds_paise); } }),
    ra_bills: (map, r) => voucher(map, { key: 'ra:' + r.id, kind: 'ra_bills', vtype: 'Purchase', date: r.d, number: `${r.wo_no}/RA${r.ra_no}`, project: r.project, narration: `Running bill ${r.ra_no}, work order ${r.wo_no}, ${r.who}`,
      build: ({ need, party, dr, cr }) => { dr(need('contract_expense'), r.gross_paise); if (r.gst_paise > 0) dr(need('gst_input'), r.gst_paise); cr(party(r.who), r.net_paise); if (r.retention_paise > 0) cr(need('retention_payable'), r.retention_paise); if (r.tds_paise > 0) cr(need('tds_payable'), r.tds_paise); if (r.advance_recovery_paise > 0) cr(need('advance_recovery'), r.advance_recovery_paise); if (r.other_deductions_paise > 0) cr(need('other_deductions'), r.other_deductions_paise); } }),
    credit_notes: (map, r) => voucher(map, { key: 'adj:' + r.id, kind: 'credit_notes', vtype: r.akind === 'debit_note' ? 'Debit Note' : 'Credit Note', date: r.d, number: r.adj_no, project: r.project, narration: `${r.akind === 'debit_note' ? 'Debit' : 'Credit'} note to ${r.who}: ${r.reason}`,
      build: ({ need, party, dr, cr }) => { const total = r.amount_paise + (r.gst_paise || 0); if (r.akind === 'debit_note') { dr(party(r.who), total); cr(need('sales_income'), r.amount_paise); if (r.gst_paise > 0) cr(need('gst_output'), r.gst_paise); } else { dr(need('sales_income'), r.amount_paise); if (r.gst_paise > 0) dr(need('gst_output'), r.gst_paise); cr(party(r.who), total); } } }),
  };

  router.get('/api/tally/vouchers', async (req, env) => withAuth(req, env, 'tally', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const kind = q.get('kind'), from = q.get('from'), to = q.get('to'), page = Math.max(1, Number(q.get('page')) || 1);
      if (!KINDS.includes(kind)) return bad('Pick what to export.'); if (!dateOk(from) || !dateOk(to) || from > to) return bad('Pick the dates: from must not be after to.');
      const ids = await visibleProjectIds(env, req.user); if (!ids.length) return json({ ok: true, data: { vouchers: [], has_more: false, page } });
      const map = await loadMap(env);
      const rows = (await env.DB.prepare(SQL[kind]()).bind(JSON.stringify(ids), from, to, (page - 1) * PAGE).all()).results;
      const has_more = rows.length > PAGE; const vouchers = rows.slice(0, PAGE).map((r) => BUILD[kind](map, r));
      return json({ ok: true, data: { vouchers, has_more, page, company: map.company || '' } });
    } catch (e) { return serverError(e, 'tally-vouchers'); }
  }));

  // The browser tells us what it exported (for the log). Totals are the browser's, shown next to the CSV registers.
  router.post('/api/tally/log', async (req, env) => withAuth(req, env, 'tally', 'X', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({}));
      if (!KINDS.includes(b.kind) || !dateOk(b.from) || !dateOk(b.to)) return bad('Nothing to log.');
      await env.DB.prepare('INSERT INTO tally_export_log (kind, from_date, to_date, voucher_count, skipped_count, total_paise, exported_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(b.kind, b.from, b.to, Math.max(0, Math.round(Number(b.count) || 0)), Math.max(0, Math.round(Number(b.skipped) || 0)), Math.max(0, Math.round(Number(b.total_paise) || 0)), req.user.user_id, nowStr()).run();
      await env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, 'export', 'tally', 0, ?, ?)").bind(req.user.user_id, `Tally export: ${b.kind} ${b.from} to ${b.to}, ${Math.round(Number(b.count) || 0)} vouchers`, nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'tally-log'); }
  }));
  router.get('/api/tally/log', async (req, env) => withAuth(req, env, 'tally', 'V', async (req, env) => {
    try { return json({ ok: true, data: { log: (await env.DB.prepare('SELECT l.*, u.name AS by_name FROM tally_export_log l LEFT JOIN users u ON u.id = l.exported_by ORDER BY l.id DESC LIMIT 50').all()).results } }); } catch (e) { return serverError(e, 'tally-log-list'); }
  }));
}
