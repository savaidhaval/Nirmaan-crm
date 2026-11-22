# NirmaanCRM: STATE (S0 reconciliation, 2026-11-22)

Read-only inspection. No code, migration, secret or data changed.
**Not verified (no Cloudflare login in this session):** production/staging migration status, live schema, row counts, settings keys, Worker secret names, active crons. Run the commands in "Needs you" and paste the output; this file will then be completed.

## 1. Repo facts
- Branch `claude/clever-franklin-rjqgdp` = `main` at `df5fbdb` (PR #4 merged). Latest feature commit `a6ab8cf` (late interest, CSV import, TOTP, project financials, vendor TDS/GST + Tally, statements, DPDP).
- Config is `wrangler.toml` (not `wrangler.jsonc`). Prod: custom domain `crm.mysociety.tech`, workers_dev off, D1 `nirmaan-db`. Staging: `[env.staging]`, D1 `nirmaan-db-staging`, workers.dev OFF since 2026-11-22 (no URL; test locally with `wrangler dev` or add a custom staging domain), `crons = []`, cron handler also guards `ENVIRONMENT === 'staging'`.
- Crons (4): `30 2 * * *` (08:00 IST digest + approval reminders), `30 13 * * *` (19:00 IST DPR nudge), `30 * * * *` (hourly: email retry, lead SLA nudges, hold expiry), `30 20 * * *` (02:00 IST housekeeping + nightly backup).
- `package.json`: only devDependency `wrangler ^4`. No runtime deps. No build step.
- CI (`.github/workflows`): syntax check of `public/*.js`, dry-run bundle prod+staging, local-Worker test suites (`tests/*.mjs`), auto-PR for `claude/*`, auto-deploy on main (applies migrations).
- Guide file `docs/THIS_GUIDE.md` (NirmaanCRM_Claude_Build_Guide_v1.3.md) is **not in the repo**. Plan references it everywhere. Needs you.

## 2. Migrations (files)
0001_core, 0002_approvals, 0003_drawings, 0004_site, 0005_procurement, 0006_sales, 0007_people, 0008_email, 0009_branding, 0010_brands, 0011_audit_hardening, 0012_interest_mfa_finance, **0013_guide_fixes (S2, written 2026-11-22, NOT yet applied anywhere)**.
- HANDOVER says "all 9 applied (0001-0009)". 0010-0012 arrive via CI auto-deploy on merge to main; applied status unverified.
- Edited-after-applied check: not possible without remote list. Git: 0010-0012 added in last 2 PRs only; 0001-0009 untouched since first commit.
- All 12 apply cleanly to an empty SQLite DB (checked locally with node:sqlite).

## 3. Live schema vs plan/guide
Live DB unverified; below is the schema implied by migrations (see `docs/DATA_DICTIONARY.md`).
- Tables present per migrations: all 17 tables the plan calls "missing from backup export" DO exist in migrations (`sal_brokerage_payments, ppl_staff, ppl_hiring, ppl_candidates, email_log, backup_log, notifications, sessions, otp_codes, rate_limits, counters, file_blobs, project_members, brand_profiles, share_links, drive_folders, oauth_states`; `settings` too). So the backup export likely omits them on purpose or by bug. Check `nightlyBackup` table list.
- Drift, tables not in the guide (added by audit/phase-2 work): `brands`, `mfa_challenges`, `user_totp`, `user_recovery_codes`, `sal_interest_waivers`, `sal_refunds`, `mkt_spend`, `webhook_seen`.
- Column drift: `projects.brand_id`, `projects.percent_complete` (from 0010/0012). `sal_inventory.category` already exists. `pro_bills` already has `gst_paise, taxable_paise, tds_bp, tds_paise, tds_section, tds_challan, tds_deposited_on, project_id`. `sal_receipts` already has `receipt_no, kind, account, reversed_by`. `users` has `extra_roles`, `is_primary_owner`.
- Plan conflicts: S2 asks to add `pro_bills.gst_paise/tds_bp/tds_paise`: **already exist**, re-adding fails. S2 also asks `ppl_staff.trade/project_id`: not present (ok to add). `pro_grn_items`, `pro_payments`: not present. WP-2 asks `sal_inventory.category`: **already exists**. WP-11 asks `sal_receipts.receipt_no`: **already exists**.
- Plan expects `counters` keyed per project: table exists (`key`, `value`).
- Missing indexes: `pro_rfqs`, `pro_grns` project/po lookups partly covered (`idx_grn_po`). Not exhaustive; see proposed migration.

## 4. Modules and routes
- Architecture differs from the guide's module contract. `src/modules/index.js` registers only 3 modules (`projects`, `users`, `documents`), each `api.js` only. `MODULE_HOOKS = []`, `MODULE_SERVICES = {}` empty.
- Everything else lives in `src/index.js` (3082 lines, 288 `env.DB.prepare` calls, ~138 routes) plus `src/routes/{sales_ops,finance,reports,importer,mfa,privacy}.js`.
- No `service.js`/`hooks.js` per module; no feature flags; no module registry. Cross-module raw SQL is the norm (e.g. dashboard, financials join `pro_*`, `sal_*`, `projects`).
- Frontend: flat `public/*.js` (`pages.js`..`pages5.js`), no `public/modules/<key>/`.
- Impact: every WP prompt that says "create src/modules/<key>/ with service.js/hooks.js" assumes a structure that does not exist. Decide: (A) retrofit the contract first, or (B) adapt WPs to the current structure. Recommendation: B for now (new `src/routes/<area>.js` + `public/pagesN.js`, new tables prefixed), retrofit later.

## 5. Phase status (evidence from files/tables; guide not available, "Done when" lists not checked)
| Phase | Status | Evidence |
|---|---|---|
| 1 Core (auth, users, projects, documents, settings) | Done | `core/*`, `modules/{projects,users,documents}` |
| 1 add-on Google Drive | Partial | `core/gdrive.js`; HANDOVER: "untested against Google"; connect fixes in git log |
| 2 Approvals | Done | `apr_*`, reminders in cron |
| 3 Drawings | Done | `drw_*`, supersede logic |
| 4 / 4B Branding, letterhead | Done | `brand_profiles`, `brands`, print views |
| 5 (as numbered in plan) approvals/branding | Done | see above |
| 6 Drawings, 7 Site | Done | `site_*`, offline queue, snags |
| 8 Procurement | Partial | `pro_*` present; no indents, single-line RFQ, GRN is free-text `qty_note`, no partial-payment table |
| 9 Sales | Mostly done | leads, visits, inventory, bookings, demands, receipts, refunds, partners, interest, cost sheet |
| 10 People | Done (optional) | `ppl_*` |
| 11 Email | Partial | `email_log`, SMTP client built; Owner kept it pending |
| 12 Dashboard/reports | Done | `routes/reports.js`, `routes/finance.js` |
| 13 Hardening | Partial | `docs/AUDIT.md`, `tests/*`, `docs/RESTORE.md`; no full restore drill evidence |
| Redevelopment (WP-1..3) | Not started | no `red_*` tables |
| Contractors/budget/stock/petty cash | Not started | no tables |

## 6. Settings and secrets
Unverified remotely. Per HANDOVER: secrets `SESSION_SECRET, APP_KEY, OWNER_EMAIL, OWNER_PASSWORD, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET`; optional `WEBHOOK_SECRET`. Crons per `wrangler.toml` listed above.

## 7. Data present
Unverified. The backup export (plan) shows only owner user, one project, 27 approvals rows.

## 8. Risks vs the plan's contracts
1. `expireHolds` (`routes/sales_ops.js:526`): up to 100 held rows x 2-3 queries each in one hourly run = over the 50-query cap. Needs one set-based UPDATE (WP-12 already asks for it).
2. `src/index.js` is a 3082-line monolith with ~288 queries and cross-module SQL; contradicts module contract (section 4 above).
3. Hourly cron stacks 3 jobs (email retry, lead SLA nudges, hold expiry); CPU/query counts not measured.
4. Free-plan 1.5 MB cap: files stored as D1 BLOBs (`file_blobs`) while Drive is unverified; `OPERATIONS.md` says uploads cap at 1.5 MB.
5. `X-NirmaanCRM` header is checked in `index.js:67,143` and `routes/mfa.js:70`; other route files (`finance`, `reports`, `importer`, `privacy`, `sales_ops`) not individually confirmed. Needs a route-by-route test.
6. HANDOVER_FOR_CLAUDE.md is stale (says 9 migrations, GitHub not configured, "build remaining frontend pages").
7. `pro_bills` keeps single `paid_on/payment_ref` (index.js:1311 marks paid in one shot): no partial payments yet.
8. Secrets: HANDOVER_FOR_CLAUDE.md contains the owner email in plaintext (not a secret value; fine) but no passwords. OK.

## Needs you (run, paste output)
```bash
npx wrangler d1 migrations list nirmaan-db --remote
npx wrangler d1 migrations list nirmaan-db-staging --remote --env staging
npx wrangler d1 execute nirmaan-db --remote --command "select name from sqlite_master where type='table' order by name"
npx wrangler secret list
```
## Questions
1. Upload `NirmaanCRM_Claude_Build_Guide_v1.3.md` to `docs/THIS_GUIDE.md`?
2. Module structure: option A (retrofit the contract) or B (adapt WPs to current structure)? Default B.
3. Plan S2 items already in schema (pro_bills GST/TDS): drop them from S2? Default yes.
4. Is Drive (Mode G) actually connected in production, or are files in D1 blobs?

## S2 status
Decisions: option B (adapt WPs to current structure; new code goes in `src/routes/<area>.js` + `public/pagesN.js`), S2 items already in schema dropped. `migrations/0013_guide_fixes.sql` written; replays clean on empty SQLite. Guide text edits skipped (guide not in repo). Backup export list in `buildExport` extended with the 2 new tables plus 9 existing tables it omitted (`ppl_*`, `sal_brokerage_payments`, `sal_refunds`, `sal_interest_waivers`, `mkt_spend`, `brands`, `counters`). `docs/proposed/0010_reconcile.sql` removed (superseded by 0013).

## WP-4 status
Code complete and tested locally (all 8 suites pass). Migration 0014 NOT applied to staging/production yet. Export/backup is now split into 3 parts (done in WP-5).

## WP-5 status
Code complete, tested locally (all 9 suites pass). Migration 0015 NOT applied to staging/production. Contractors module is OFF by default (setting con.enabled). Staging has no URL now (workers.dev off).
Decisions taken by default: D4 both bases, retention per work order, contractor-supplied materials not tracked; PM approval limit default Rs 5,00,000 (setting). contractors table is standalone (vendor_id optional) instead of raw SQL on pro_vendors.

## WP-6 status
Code complete, all 10 suites + browser walkthroughs pass locally. Migration 0016 applied to the STAGING database only; NOT applied to production. Note: public/pages2.js overrides newDpr/loadSite from pages.js, so edit the DPR form there.

## WP-7 status
Code complete; all 11 suites and 3 browser walkthroughs pass locally. Migration 0017 applied to STAGING database only, not production. Known limit found: lists that filter by project use one SQL variable per project, so more than 100 visible projects would fail (task suggested separately).

## WP-8/9/10 status
Code complete; 14 API suites and 4 browser walkthroughs pass locally. Migrations 0018-0020 NOT applied to staging or production.

## Professionals, contracts, AI status
Code complete; 16 API suites and 5 browser walkthroughs pass locally. Migrations 0018-0022 NOT applied to production. AI never run against the real Cloudflare model (mock only).

## WP-11 to 14 status
Code complete; 17 API suites and 6 browser walkthroughs pass locally. Migrations 0018-0023 NOT applied to production. Rates for GST, stamp duty and registration are not built in: they come from Settings (tax.*) or are typed per cost sheet.

## WP-15 and WP-19 status
Code complete; tests pass locally. Migrations 0024-0025 NOT applied to production.
