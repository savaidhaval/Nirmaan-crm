# Hardening report (WP-23)

Run on a local database with every test suite loaded. Re-run with the commands in the last column.

| Item | Result | Evidence |
|---|---|---|
| Every private route needs a sign-in | PASS: 349 routes answer 401 with no session | `node tests/hardening.mjs` |
| Every write needs the X-NirmaanCRM header | PASS: 191 write routes answer 403 without it, even when signed in | `node tests/hardening.mjs` |
| No route crashes for any role | PASS: all read routes x 8 roles, no 5xx | `node tests/hardening.mjs` |
| Only the Owner can delete | PASS: no other role can delete through any delete route; four more delete paths made Owner-only | `node tests/hardening.mjs` |
| Roles are refused screens that are not theirs | PASS: users, settings, audit, backup, bank, Tally, money screens by role | `node tests/hardening.mjs` |
| No secret in responses or the backup | PASS: no password, key, token hash, encrypted value or bare 12-digit number; encrypted fields are now blanked in the backup | `node tests/hardening.mjs` |
| Every table is in the backup and restore order | PASS after fix: project assignments, branding and Drive folders were missing and are now included; each exclusion has a written reason | `node scripts/check-tables.mjs` |
| Restore drill | PASS: backup loaded into an empty database, every table's row count matches | `node scripts/restore-drill.mjs` |
| Database statements per request | PASS after fix: one route (issuing a drawing) used 53 on a busy database and now uses 1 for its notices; the busiest remaining request uses 45 (bulk send, by design 3 letters per step) | `node scripts/query-report.mjs dev.log` |
| Database statements per sweep run | PASS: busiest hourly run 33 of 50 | same |
| Financial-year rollover and paise rounding | PASS: 31 March / 1 April in IST, century edge, GST rounding | `node tests/units.mjs` |
| Reversal, never deletion, of money | PASS: covered by the receipt, bill, payment, rent and corpus suites | per-module suites |
| Offline retries never duplicate | PASS: the same entry sent twice creates one record | `tests/ui-walkthrough-offline.mjs.txt` |
| Worker CPU time | NOT MEASURABLE LOCALLY. Wall time is shown (most requests under 100 ms including the local database); real CPU is read in the Cloudflare dashboard (Workers, Metrics) after deploy. Heavy work (PDF, XML, CSV parsing, photo crop) runs in the browser. | Cloudflare dashboard |
| Real email provider | NOT TESTED: bulk letters ran against a mock mail server only. Send a small batch to yourself first. | UAT step 8 |
| Real Cloudflare AI model | NOT TESTED: the assistant ran against the mock only. Ask one question in production. | UAT |
| Tally import | NOT TESTED: needs your accountant's Tally. | UAT step 10 |
