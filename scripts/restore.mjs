// scripts/restore.mjs — turn a NirmaanCRM JSON backup (More -> Everything backup, or the nightly file in Drive/Backups)
// into SQL you can load into an EMPTY database (staging!) and verify.
//
//   node scripts/restore.mjs nirmaan-export.json > restore.sql
//   npx wrangler d1 migrations apply nirmaan-db-staging --remote --env staging     # empty schema first
//   npx wrangler d1 execute nirmaan-db-staging --remote --env staging --file restore.sql
//   node scripts/restore.mjs nirmaan-export.json --counts                           # expected row counts per table
//
// Notes: file contents stored in the database (file_blobs) are NOT in the export; Drive files are untouched.
// Users are restored without passwords: sign in as Owner with the OWNER_PASSWORD secret, then Reset password for the rest.
import { readFileSync } from 'node:fs';

// Backups come in 3 parts (…-part1of3.json etc.). Give every part: node scripts/restore.mjs p1.json p2.json p3.json [--counts]
const args = process.argv.slice(2);
const flag = args.find((a) => a.startsWith('--'));
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('usage: node scripts/restore.mjs <part1.json> [part2.json part3.json] [--counts]'); process.exit(2); }
const tables = {};
const seenParts = new Set();
for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  Object.assign(tables, d.tables);
  seenParts.add(d.part || 1);
  if (d.of) tables.__of = d.of;
}
const need = tables.__of || 1; delete tables.__of;
if (seenParts.size < need) { console.error(`WARNING: this backup has ${need} parts but you gave ${seenParts.size}. Tables from the missing parts will NOT be restored.`); }

if (flag === '--counts') {
  for (const [t, rows] of Object.entries(tables)) console.log(`${t.padEnd(20)} ${rows.length}`);
  process.exit(0);
}

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
};

// Parents before children so foreign keys are satisfied.
const order = ['users', 'projects', 'documents', 'apr_items', 'apr_events', 'drw_drawings', 'drw_revisions', 'site_milestones', 'site_dprs', 'site_snags',
  'pro_vendors', 'pro_rfqs', 'pro_quotes', 'pro_pos', 'pro_po_items', 'pro_grns', 'pro_bills', 'sal_leads', 'sal_activities', 'sal_visits', 'sal_inventory',
  'sal_partners', 'sal_bookings', 'sal_plan_stages', 'sal_demands', 'sal_receipts', 'audit_log',
  'pro_grn_items', 'pro_payments', 'ppl_staff', 'ppl_hiring', 'ppl_candidates', 'sal_brokerage_payments', 'sal_refunds', 'sal_interest_waivers', 'mkt_spend', 'brands', 'counters',
  'site_dpr_labour', 'bud_heads', 'stk_items', 'stk_balance', 'stk_moves', 'pro_party_docs', 'pro_professionals', 'ai_log', 'sal_receipt_requests', 'sal_adjustments', 'sal_booking_parties', 'sal_cost_sheets', 'sal_cost_sheet_lines', 'sal_handover', 'sal_handover_items', 'sal_booking_loans', 'rera_account_entries', 'eng_kudos', 'fea_versions', 'sal_bulk_runs', 'sal_bulk_items', 'drw_acks', 'bank_profiles', 'bank_import_batches', 'bank_import_rows', 'red_societies', 'red_members', 'red_consent_events', 'red_member_docs', 'red_rehab_allotments', 'red_transit_terms', 'red_transit_schedule', 'red_transit_payments', 'red_corpus_entries', 'red_meetings', 'pty_funds', 'pty_entries', 'pro_indents', 'pro_indent_items', 'pro_rfq_items', 'pro_quote_items', 'con_contractors', 'con_work_orders', 'con_wo_items', 'con_ra_bills', 'con_ra_lines', 'con_payments', 'con_ledger'];
const out = ['PRAGMA defer_foreign_keys = true;'];
for (const t of order) {
  for (const row of tables[t] || []) {
    const cols = Object.keys(row);
    out.push(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});`);
  }
}
console.log(out.join('\n'));
