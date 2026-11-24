// scripts/check-tables.mjs — every table the migrations create must be in the nightly backup / Export-everything list and in the restore order,
// unless it is on the short, reasoned exclusion list below. Run in CI: node scripts/check-tables.mjs (exit 1 if a table is missing).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const EXCLUDED = {
  sessions: 'login sessions: temporary', rate_limits: 'counters that expire', otp_codes: 'one-time codes: temporary', mfa_challenges: 'temporary', webhook_seen: 'duplicate-delivery memory',
  notifications: 'in-app messages: not business records', backup_log: 'log of the backups themselves', dash_snapshot: 'derived cache, rebuilt by the hourly sweep', file_blobs: 'file contents are not in the JSON export (Drive/D1 files are separate)',
  settings: 'holds encrypted secrets: re-enter after a restore', user_recovery_codes: 'secret: never exported', user_totp: 'secret: never exported', email_log: 'sent-mail log with message bodies: not business records',
  sal_demand_links: 'expiring links (token hashes): not exported', sal_hv_links: 'expiring buyer links (token hashes): not exported', share_links: 'expiring links (token hashes): not exported', d1_migrations: 'tool table', sqlite_sequence: 'sqlite internal', oauth_states: 'temporary sign-in handshakes',
};
const db = new DatabaseSync(':memory:');
for (const f of fs.readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync('migrations/' + f, 'utf8'));
const tables = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map((r) => r.name);
const idx = fs.readFileSync('src/index.js', 'utf8'); const rest = fs.readFileSync('scripts/restore.mjs', 'utf8');
const list = (src, start) => { const i = src.indexOf(start); const j = src.indexOf(']', i); return [...src.slice(i, j).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]); };
const exp = new Set(list(idx, 'const EXPORT_TABLES = ['));
// the users table is exported separately (without passwords)
exp.add('users');
const order = new Set(list(rest, 'const order = ['));
let bad = 0;
for (const t of tables) {
  if (EXCLUDED[t]) continue;
  const miss = []; if (!exp.has(t)) miss.push('backup/export list (src/index.js EXPORT_TABLES)'); if (!order.has(t)) miss.push('restore order (scripts/restore.mjs)');
  if (miss.length) { bad++; console.log(`MISSING  ${t}: not in ${miss.join(' and ')}`); }
}
for (const t of exp) if (!tables.includes(t)) { bad++; console.log(`UNKNOWN  ${t}: in the export list but no migration creates it`); }
console.log(`${tables.length} tables checked, ${Object.keys(EXCLUDED).filter((t) => tables.includes(t)).length} excluded with a reason, ${bad} problem(s).`);
process.exit(bad ? 1 : 0);
