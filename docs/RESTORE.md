# Backup & restore drill

## What you have
- **Nightly (02:00 IST):** a JSON backup is saved to Google Drive → `NirmaanCRM/Backups/nirmaan-backup-YYYY-MM-DD-part1of3.json`. Parts 2 and 3 follow within the next two hours (the free plan allows only 50 database reads per run). All three parts are needed. Needs Drive connected; if any part fails the Owner gets a notification.
- **On demand:** More → Download for Excel → *Backup 1 of 3*, *2 of 3*, *3 of 3*.
- Files themselves stay in Drive. Files stored in the database (small ones) are not in the JSON.

## Drill — restore last night's backup into STAGING and check it (15 minutes)
```bash
# 1. get the newest backup JSON from Drive/Backups (or download "Everything (backup)")
# 2. empty staging schema
npx wrangler d1 migrations apply nirmaan-db-staging --remote --env staging
# 3. turn the backup into SQL and load it
node scripts/restore.mjs nirmaan-backup-2026-11-21-part1of3.json nirmaan-backup-2026-11-21-part2of3.json nirmaan-backup-2026-11-21-part3of3.json > restore.sql
npx wrangler d1 execute nirmaan-db-staging --remote --env staging --file restore.sql
# 4. compare row counts with the backup
node scripts/restore.mjs nirmaan-backup-2026-11-21-part1of3.json nirmaan-backup-2026-11-21-part2of3.json nirmaan-backup-2026-11-21-part3of3.json --counts
npx wrangler d1 execute nirmaan-db-staging --remote --env staging --command "SELECT 'projects', COUNT(*) FROM projects UNION ALL SELECT 'sal_bookings', COUNT(*) FROM sal_bookings UNION ALL SELECT 'pro_pos', COUNT(*) FROM pro_pos UNION ALL SELECT 'documents', COUNT(*) FROM documents"
```
Counts must match. Open the staging site, sign in as Owner with the `OWNER_PASSWORD` secret, spot-check a project and a booking.

## Real disaster
Same steps against production **only after** creating a fresh empty D1 database (never over live data), then point `wrangler.toml` at it, apply migrations, load `restore.sql`, deploy. Users come back without passwords: sign in as Owner with `OWNER_PASSWORD`, then *Reset password* for each person.

## Verified
`scripts/restore.mjs` output was loaded into a fresh database built from `migrations/` and every table's row count matched the export.
