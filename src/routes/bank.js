// routes/bank.js — WP-18: bank-statement CSV import and matching.
// The browser parses the CSV and sends only credit lines, 100 at a time (500 in all per import). The server stores them,
// suggests which open demand each one pays (by amount and by the customer's name in the narration) and never creates money records itself:
// "Confirm" in the screen posts a normal receipt through the existing receipt route (numbering and second-person approval still apply),
// then asks this module to link the line to that receipt. Account numbers are never stored: long digit runs in narrations are masked.

const MAX_PER_IMPORT = 500, PAGE = 100;
const dateOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const rupees = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN');
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'shree', 'miss', 'mess', 'the', 'and', 'ltd', 'pvt', 'neft', 'rtgs', 'imps', 'upi', 'cheque']);
// 9 or more digits in a row look like an account or card number: keep only the last 4 (a UTR/reference is kept separately in its own field)
const scrub = (s) => String(s || '').replace(/\d{9,}/g, (m) => 'X' + m.slice(-4)).replace(/\s+/g, ' ').trim().slice(0, 200);
const tokensOf = (name) => String(name || '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3 && !HONORIFICS.has(t));

export async function bankSweep(env, getSetting) {
  const days = Math.max(7, Math.round(Number(await getSetting(env, 'bank.keep_days')) || 90));
  await env.DB.batch([
    // lines nobody matched are removed; lines already turned into receipts keep their link but lose the narration text
    env.DB.prepare("DELETE FROM bank_import_rows WHERE status IN ('unmatched', 'suggested', 'ignored') AND created_at < datetime('now', '-' || ?1 || ' days')").bind(days),
    env.DB.prepare("UPDATE bank_import_rows SET narration = '' WHERE status = 'confirmed' AND narration != '' AND created_at < datetime('now', '-' || ?1 || ' days')").bind(days),
  ]);
}

export function registerBank(router, h) {
  const { withAuth, json, serverError, visibleProjectIds, nowStr, getSetting, csvBom } = h;
  const audit = (env, user, action, entity, id, summary) => env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.user_id, action, entity, id || 0, String(summary).slice(0, 300), nowStr());
  const bad = (m, s = 400) => json({ ok: false, error: m }, s);

  router.get('/api/bank/profiles', async (req, env) => withAuth(req, env, 'bank', 'V', async (req, env) => {
    try { return json({ ok: true, data: { profiles: (await env.DB.prepare('SELECT id, name, mapping_json FROM bank_profiles ORDER BY name LIMIT 50').all()).results.map((p) => ({ id: p.id, name: p.name, mapping: JSON.parse(p.mapping_json) })) } }); }
    catch (e) { return serverError(e, 'bank-profiles'); }
  }));
  router.post('/api/bank/profiles', async (req, env) => withAuth(req, env, 'bank', 'C', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({})); const name = String(b.name || '').trim().slice(0, 60); const m = b.mapping || {};
      if (!name) return bad('Give this bank format a name.');
      const mapping = { date: Number(m.date), narration: Number(m.narration), credit: Number(m.credit), reference: m.reference === '' || m.reference == null ? -1 : Number(m.reference), format: String(m.format || 'dd/mm/yyyy').slice(0, 20), skip: Math.max(0, Math.min(50, Number(m.skip) || 1)) };
      if (![mapping.date, mapping.narration, mapping.credit].every((n) => Number.isInteger(n) && n >= 0 && n < 100)) return bad('Choose the date, narration and credit columns.');
      await env.DB.prepare('INSERT INTO bank_profiles (name, mapping_json, created_by, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(name) DO UPDATE SET mapping_json = ?2').bind(name, JSON.stringify(mapping), req.user.user_id, nowStr()).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bank-profile-save'); }
  }));

  // Suggest a demand for each new line. One query loads the open demands; matching is done in memory.
  async function suggest(env, req, rows) {
    const ids = await visibleProjectIds(env, req.user); if (!ids.length || !rows.length) return [];
    const open = (await env.DB.prepare(`SELECT d.id, d.booking_id, d.label, d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise AS due, b.customer_name, i.unit_no, i.wing
      FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id AND b.deleted_at IS NULL AND b.status != 'cancelled' JOIN sal_inventory i ON i.id = b.unit_id
      WHERE d.status IN ('ready', 'partial') AND b.project_id IN (SELECT value FROM json_each(?)) ORDER BY d.due_date, d.id LIMIT 2000`).bind(JSON.stringify(ids)).all()).results;
    const byAmount = new Map(); const byBooking = new Map();
    for (const d of open) { d.tokens = null; (byAmount.get(d.due) || byAmount.set(d.due, []).get(d.due)).push(d); (byBooking.get(d.booking_id) || byBooking.set(d.booking_id, []).get(d.booking_id)).push(d); }
    const customers = [...byBooking.entries()].map(([bid, ds]) => ({ bid, ds, toks: tokensOf(ds[0].customer_name) })).filter((c) => c.toks.length);
    const out = [];
    for (const r of rows) {
      const text = (r.narration + ' ' + (r.reference || '')).toLowerCase();
      // the customer(s) whose name fits the narration best (at least 2 name parts, or the whole name if it is short)
      let top = 0; const scored = [];
      for (const c of customers) { const n = c.toks.filter((t) => text.includes(t)).length; if (n >= Math.min(2, c.toks.length)) { scored.push([c.bid, n]); if (n > top) top = n; } }
      const nameHits = new Set(scored.filter((x) => x[1] === top).map((x) => x[0]));
      const exact = byAmount.get(r.credit_paise) || [];
      let pick = null, note = '';
      if (exact.length === 1) { pick = exact[0]; note = nameHits.has(pick.booking_id) ? 'Amount and name match.' : 'Amount matches exactly. Check the name.'; }
      else if (exact.length > 1) { const named = exact.filter((d) => nameHits.has(d.booking_id)); if (named.length === 1) { pick = named[0]; note = 'Amount and name match.'; } else note = `${exact.length} open demands have exactly this amount. Pick the right one by hand.`; }
      if (!pick && !exact.length && nameHits.size === 1) { const bid = [...nameHits][0]; const ds = byBooking.get(bid).filter((d) => d.due >= r.credit_paise); if (ds.length) { pick = ds[0]; note = `The name matches, but the amount differs (due ${rupees(pick.due)}). It will be recorded as a part payment.`; } }
      if (pick) out.push({ id: r.id, demand_id: pick.id, booking_id: pick.booking_id, note });
      else if (note) out.push({ id: r.id, demand_id: null, booking_id: null, note });
    }
    return out;
  }

  // One page of lines (up to 100) from the browser. The first call creates the batch; later calls pass batch_id.
  router.post('/api/bank/imports', async (req, env) => withAuth(req, env, 'bank', 'C', async (req, env) => {
    try {
      const b = await req.json().catch(() => ({})); const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return bad('There are no credit lines to import.'); if (rows.length > PAGE) return bad(`Send at most ${PAGE} lines at a time.`);
      let batch = null;
      if (b.batch_id) { batch = await env.DB.prepare('SELECT * FROM bank_import_batches WHERE id = ?').bind(Number(b.batch_id)).first(); if (!batch || batch.uploaded_by !== req.user.user_id) return bad('Import not found.', 404); }
      if ((batch ? batch.row_count : 0) + rows.length > MAX_PER_IMPORT) return bad(`One import can hold at most ${MAX_PER_IMPORT} lines. Split the statement and import the rest separately.`);
      const clean = [], seen = new Map();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; const credit = Math.round(Number(r.credit_paise));
        if (!dateOk(r.date)) return bad(`Line ${i + 1}: the date could not be read. Check the date format you chose.`);
        if (!(credit > 0) || credit > 100000000000) return bad(`Line ${i + 1}: the credit amount could not be read.`);
        const ref = String(r.reference || '').trim().slice(0, 60), narr = scrub(r.narration);
        const base = `${r.date}|${credit}|${ref}|${narr.slice(0, 60).toLowerCase()}`; const n = (seen.get(base) || 0) + 1; seen.set(base, n);
        clean.push({ d: r.date, n: narr, c: credit, f: ref, k: `${base}|${Number(r.seq) || n}` });
      }
      if (!batch) { const r = await env.DB.prepare('INSERT INTO bank_import_batches (filename, uploaded_by, created_at) VALUES (?, ?, ?)').bind(String(b.filename || '').slice(0, 120), req.user.user_id, nowStr()).run(); batch = { id: r.meta.last_row_id, row_count: 0 }; }
      const ins = await env.DB.prepare(`INSERT OR IGNORE INTO bank_import_rows (batch_id, txn_date, narration, credit_paise, reference, row_key, created_at) SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.n'), json_extract(value, '$.c'), json_extract(value, '$.f'), json_extract(value, '$.k'), ?2 FROM json_each(?3)`)
        .bind(batch.id, nowStr(), JSON.stringify(clean)).run();
      const added = ins.meta.changes, dup = clean.length - added;
      let suggested = 0;
      if (added) {
        const fresh = (await env.DB.prepare("SELECT id, narration, credit_paise, reference FROM bank_import_rows WHERE batch_id = ? AND status = 'unmatched' AND matched_demand_id IS NULL AND suggestion_note IS NULL ORDER BY id DESC LIMIT 100").bind(batch.id).all()).results;
        const sug = await suggest(env, req, fresh); suggested = sug.filter((s) => s.demand_id).length;
        if (sug.length) await env.DB.prepare(`UPDATE bank_import_rows SET suggestion_note = j.note, matched_demand_id = j.d, matched_booking_id = j.b, status = CASE WHEN j.d IS NOT NULL THEN 'suggested' ELSE status END
          FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.note') AS note, json_extract(value, '$.demand_id') AS d, json_extract(value, '$.booking_id') AS b FROM json_each(?1)) j WHERE bank_import_rows.id = j.id`).bind(JSON.stringify(sug)).run();
      }
      await env.DB.prepare('UPDATE bank_import_batches SET row_count = row_count + ?2, new_count = new_count + ?3, dup_count = dup_count + ?4 WHERE id = ?1').bind(batch.id, clean.length, added, dup).run();
      await audit(env, req.user, 'import', 'bank_import_batches', batch.id, `Bank statement lines: ${added} new, ${dup} already imported`).run();
      return json({ ok: true, data: { batch_id: batch.id, added, duplicates: dup, suggested } });
    } catch (e) { return serverError(e, 'bank-import'); }
  }));

  const ROW_SQL = `SELECT r.id, r.batch_id, r.txn_date, r.narration, r.credit_paise, r.reference, r.status, r.suggestion_note, r.matched_demand_id, r.matched_booking_id,
      d.label AS demand_label, d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise AS demand_due, d.settled_paise, b.customer_name, i.unit_no, i.wing, pr.name AS project_name
    FROM bank_import_rows r LEFT JOIN sal_demands d ON d.id = r.matched_demand_id LEFT JOIN sal_bookings b ON b.id = r.matched_booking_id LEFT JOIN sal_inventory i ON i.id = b.unit_id LEFT JOIN projects pr ON pr.id = b.project_id`;

  router.get('/api/bank/rows', async (req, env) => withAuth(req, env, 'bank', 'V', async (req, env) => {
    try {
      const q = new URL(req.url).searchParams; const st = ['unmatched', 'suggested', 'confirmed', 'ignored'].includes(q.get('status')) ? q.get('status') : ''; const batch = Number(q.get('batch_id')) || 0; const page = Math.max(1, Number(q.get('page')) || 1);
      const where = "(?1 = '' OR r.status = ?1) AND (?2 = 0 OR r.batch_id = ?2)";
      const rows = (await env.DB.prepare(`${ROW_SQL} WHERE ${where} ORDER BY CASE r.status WHEN 'suggested' THEN 0 WHEN 'unmatched' THEN 1 ELSE 2 END, r.txn_date DESC, r.id DESC LIMIT 50 OFFSET ?3`).bind(st, batch, (page - 1) * 50).all()).results;
      const counts = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM bank_import_rows WHERE (?1 = 0 OR batch_id = ?1) GROUP BY status').bind(batch).all()).results; const c = { unmatched: 0, suggested: 0, confirmed: 0, ignored: 0 }; for (const x of counts) c[x.status] = x.n;
      return json({ ok: true, data: { rows, counts: c, page } });
    } catch (e) { return serverError(e, 'bank-rows'); }
  }));

  router.get('/api/bank/imports', async (req, env) => withAuth(req, env, 'bank', 'V', async (req, env) => {
    try { return json({ ok: true, data: { batches: (await env.DB.prepare('SELECT b.*, u.name AS by_name FROM bank_import_batches b LEFT JOIN users u ON u.id = b.uploaded_by ORDER BY b.id DESC LIMIT 20').all()).results } }); }
    catch (e) { return serverError(e, 'bank-batches'); }
  }));

  async function loadRow(env, id) { return env.DB.prepare('SELECT * FROM bank_import_rows WHERE id = ?').bind(id).first(); }

  router.post('/api/bank/rows/:id/ignore', async (req, env) => withAuth(req, env, 'bank', 'E', async (req, env) => {
    try {
      const row = await loadRow(env, Number(req.params.id)); if (!row) return bad('Line not found.', 404);
      const r = await env.DB.prepare("UPDATE bank_import_rows SET status = 'ignored', decided_by = ?, decided_at = ? WHERE id = ? AND status IN ('unmatched', 'suggested')").bind(req.user.user_id, nowStr(), row.id).run();
      if (!r.meta.changes) return bad('This line is already settled.', 409);
      await audit(env, req.user, 'update', 'bank_import_rows', row.id, `Ignored bank credit ${rupees(row.credit_paise)} on ${row.txn_date}`).run();
      return json({ ok: true });
    } catch (e) { return serverError(e, 'bank-ignore'); }
  }));

  // After the screen has posted the receipt, link it to the line. The server checks the receipt (or the waiting approval) really exists.
  router.post('/api/bank/rows/:id/confirm', async (req, env) => withAuth(req, env, 'bank', 'E', async (req, env) => {
    try {
      const row = await loadRow(env, Number(req.params.id)); if (!row) return bad('Line not found.', 404);
      const b = await req.json().catch(() => ({})); const bookingId = Number(b.booking_id), ref = String(b.ref_no || '').trim();
      const bk = await env.DB.prepare('SELECT id, project_id, customer_name FROM sal_bookings WHERE id = ? AND deleted_at IS NULL').bind(bookingId).first();
      if (!bk || !(await visibleProjectIds(env, req.user)).includes(bk.project_id)) return bad('Booking not found.', 404);
      if (!ref) return bad('The receipt reference is missing.');
      const rc = await env.DB.prepare('SELECT id FROM sal_receipts WHERE booking_id = ? AND ref_no = ? AND amount_paise = ? AND reversed_at IS NULL ORDER BY id DESC LIMIT 1').bind(bk.id, ref, row.credit_paise).first();
      const rq = rc ? null : await env.DB.prepare("SELECT id FROM sal_receipt_requests WHERE booking_id = ? AND ref_no = ? AND amount_paise = ? AND status IN ('pending', 'approving', 'approved') ORDER BY id DESC LIMIT 1").bind(bk.id, ref, row.credit_paise).first();
      if (!rc && !rq) return bad('No receipt for this amount and reference was found on that booking. Record the receipt first.', 409);
      const r = await env.DB.prepare("UPDATE bank_import_rows SET status = 'confirmed', matched_booking_id = ?, matched_demand_id = COALESCE(?, matched_demand_id), matched_receipt_id = ?, matched_request_id = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status IN ('unmatched', 'suggested')")
        .bind(bk.id, b.demand_id ? Number(b.demand_id) : null, rc ? rc.id : null, rq ? rq.id : null, req.user.user_id, nowStr(), row.id).run();
      if (!r.meta.changes) return bad('This line is already settled.', 409);
      await audit(env, req.user, 'update', 'bank_import_rows', row.id, `Bank credit ${rupees(row.credit_paise)} matched to ${bk.customer_name}`).run();
      return json({ ok: true, data: { receipt_id: rc ? rc.id : null, request_id: rq ? rq.id : null } });
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) return bad('That receipt is already linked to another bank line.', 409);
      return serverError(e, 'bank-confirm');
    }
  }));

  // Open demands the Accountant can pick from when a line has no suggestion (search by customer or flat)
  router.get('/api/bank/demands', async (req, env) => withAuth(req, env, 'bank', 'V', async (req, env) => {
    try {
      const ids = await visibleProjectIds(env, req.user); const term = String(new URL(req.url).searchParams.get('q') || '').trim().replace(/[%_\\]/g, '').slice(0, 40);
      if (!ids.length || term.length < 2) return json({ ok: true, data: { demands: [] } });
      const like = `%${term}%`;
      const rows = (await env.DB.prepare(`SELECT d.id, d.booking_id, d.label, d.amount_paise + COALESCE(d.gst_paise, 0) - d.settled_paise AS due, b.customer_name, i.unit_no, i.wing, pr.name AS project_name
        FROM sal_demands d JOIN sal_bookings b ON b.id = d.booking_id AND b.deleted_at IS NULL AND b.status != 'cancelled' JOIN sal_inventory i ON i.id = b.unit_id JOIN projects pr ON pr.id = b.project_id
        WHERE d.status IN ('ready', 'partial') AND b.project_id IN (SELECT value FROM json_each(?1)) AND (b.customer_name LIKE ?2 OR i.unit_no LIKE ?2) ORDER BY b.customer_name, d.due_date LIMIT 20`).bind(JSON.stringify(ids), like).all()).results;
      return json({ ok: true, data: { demands: rows } });
    } catch (e) { return serverError(e, 'bank-demands'); }
  }));

  // Unmatched credits report (CSV)
  router.get('/api/bank/report', async (req, env) => withAuth(req, env, 'bank', 'V', async (req, env) => {
    try {
      const rows = (await env.DB.prepare("SELECT txn_date, narration, credit_paise, reference, status, suggestion_note FROM bank_import_rows WHERE status IN ('unmatched', 'suggested') ORDER BY txn_date, id LIMIT 2000").all()).results;
      return new Response(csvBom([['Date', 'Narration', 'Credit (Rs)', 'Reference', 'Status', 'Note'], ...rows.map((r) => [r.txn_date, r.narration || '', (r.credit_paise / 100).toFixed(2), r.reference || '', r.status, r.suggestion_note || ''])]),
        { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="unmatched-bank-credits.csv"', 'Cache-Control': 'no-store' } });
    } catch (e) { return serverError(e, 'bank-report'); }
  }));
}
