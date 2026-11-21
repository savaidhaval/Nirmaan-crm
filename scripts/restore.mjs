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

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/restore.mjs <backup.json> [--counts]'); process.exit(2); }
const dump = JSON.parse(readFileSync(file, 'utf8'));
const tables = dump.tables;

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
  'sal_partners', 'sal_bookings', 'sal_plan_stages', 'sal_demands', 'sal_receipts', 'audit_log'];
const out = ['PRAGMA defer_foreign_keys = true;'];
for (const t of order) {
  for (const row of tables[t] || []) {
    const cols = Object.keys(row);
    out.push(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});`);
  }
}
console.log(out.join('\n'));
