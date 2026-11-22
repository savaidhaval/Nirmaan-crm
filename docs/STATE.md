# NirmaanCRM: actual state vs build guide v1.3 (prompt S0 result)

Written 2026-11-22 by Claude Code (read-only reconciliation: no code, migration, secret or data was changed).
Evidence = the repo at `main` (commit `df5fbdb`, a shallow clone of one commit), `HANDOVER_FOR_CLAUDE.md`, `CHANGELOG.md`, `docs/*`.
NOT verified (no Cloudflare access was used): which migrations are applied on the live D1 databases, live row counts, live settings values, which Worker secrets are really set. Where this file says "applied", it is inferred from `.github/workflows/deploy.yml`, which runs `wrangler d1 migrations apply nirmaan-db --remote` on every push to `main`. Confirm with `npx wrangler d1 migrations list nirmaan-db --remote` (read-only).

## 1. Repo facts and conventions (these override the plan where they conflict)
| Item | Guide v1.3 | Actual repo |
|---|---|---|
| Wrangler config | `wrangler.jsonc` | `wrangler.toml` (drift; keep toml, update the guide wording) |
| Instruction files | CLAUDE.md (Master Prompt) | No `CLAUDE.md`; standing context is `HANDOVER_FOR_CLAUDE.md` (partly stale: says "9 migrations", "GitHub remote not configured", "Build remaining frontend pages") |
| Module structure (§4.2) | `src/modules/<key>/{api,service,hooks}.js` + registry + flags | Only 3 real modules (`projects`, `users`, `documents`) in `src/modules/`. Everything else is in a monolithic `src/index.js` (3,082 lines) plus `src/routes/{sales_ops,reports,finance,mfa,importer,privacy}.js`, each exposing `registerX(router, deps)` called from `index.js`. `MODULE_HOOKS` and `MODULE_SERVICES` are empty; there is no `core/modules.js` registry and no feature flags |
| Frontend | `public/modules/<key>/` | Flat `public/pages.js` to `pages5.js`, `app.js`, `ui.js`, loaded by script tags in `index.html` (CSP: no inline scripts) |
| Tests | Phase 13 checklist | `tests/*.mjs` (7 suites, about 290 checks: security, features, multibrand, sales2, audit, reports, phase2), run by CI against a local Worker |
| CI/CD | staging first (§10.1) | `ci.yml` on PRs (syntax check, dry-run bundle for prod and staging, tests). `deploy.yml` deploys production and applies migrations automatically on every push to `main`. There is NO staging step in CI; "staging first" is a manual step (`npm run deploy:staging`) |
| Migrations | 0001 to 0009 (+ section F) | `0001` to `0012` present (0010 brands, 0011 audit hardening, 0012 interest/MFA/finance). Next free number: **0013** |
| Crons | 4 triggers | 4 triggers, matching: `30 2`, `30 13`, `30 * * * *`, `30 20` (UTC). Staging: `crons = []` plus a `scheduled()` guard |
| Production | custom domain | `crm.mysociety.tech` only; `workers_dev=false`, `preview_urls=false`; non-matching hostnames 308-redirect |
| Storage | Mode G | Google Drive Mode G code present (`core/gdrive.js`); `file_blobs` D1 fallback; "untested against Google" per CHANGELOG at one point, so confirm Drive status in Settings |

## 2. Guide phases: what is actually built
Labels: Built = code, routes, screens and tests exist. Partial = some of the "Done when" list is missing. Not built = absent.
| Guide phase | Status | Evidence / gap |
|---|---|---|
| 1 Skeleton + deploy | Built | `wrangler.toml`, health route, CI, deploy workflow |
| 2 Database + storage | Built, Partial on backup | 12 migrations. Drive routing present. Backup/export code covers 27 of 53 tables (26 in full, `users` trimmed) (see section 4) |
| 3 Login, users, roles | Built, ahead of guide | PBKDF2 sessions (hashed), forced first-login password change, role matrix, `extra_roles`, owner safeguards, `project_members`, login limiter, optional email OTP, **TOTP + recovery codes** (not in guide) |
| 4 Core shell | Built | `app.js`, `ui.js`, nav, notifications bell, global search, Hindi/Marathi dictionary translator, PWA manifest + `sw.js` |
| 4B Branding, letterhead, brochures | Built | `brand_profiles`, `brands` (multi-brand, 0010), letterhead print views (`print.html`), share links `/s/:token`, brochure library with versions |
| 5 Approvals & compliance | Built | `apr_items`, `apr_events`, Mumbai template incl. redevelopment rows (society consent and DA registration is a checklist ROW only), reminders |
| 6 Drawings | Built | `drw_drawings`, `drw_revisions`, atomic supersede, site sees latest IFC |
| 7 Site | Built | milestones, DPR, snags (open, fixed, verified), offline queues (IndexedDB), milestone.done makes demands ready. DPR labour is a single count, not per contractor |
| 8 Procurement | Partial | vendors, RFQ + quote comparison, PO with maker-checker and PM limit, GRN (text `qty_note`, no per-line quantities), bills with GST/TDS (0012). Missing: indents, per-line GRN, partial payments (bill pay is one `paid_on`), contractors/work orders |
| 9 Sales CRM | Built, far ahead of guide | leads with SLA and state machine, visits, inventory with holds (`hold_by`, `hold_lead_id`, 48 h expiry), cost sheet, bookings, payment plans, demands, receipts (numbered, reversible, cash limit), refunds, unit transfer, channel partners + brokerage, marketing spend/ROI, signed lead webhook, bulk CSV import, late interest + waivers, customer statement, DPDP find/export/erase |
| 10 People (optional) | Built | `ppl_staff`, `ppl_hiring`, `ppl_candidates` |
| 11 Email engine | Built, not switched on | SMTP client + digest + retries + OTP code; HANDOVER says email setup "kept pending by the Owner". Tested only against a scripted server |
| 12 Dashboard, reports | Built, ahead of guide | dashboard with charts, funnel, receivables, aging, stacking plan, cash flow/escrow, velocity, marketing ROI, interest, purchase register, TDS report, project financials with RERA withdrawal estimate, Tally CSV exports, JSON export |
| 13 Hardening, UAT | Partial | security/feature tests, `docs/UAT.md`, `docs/RESTORE.md` + `scripts/restore.mjs` (verified by the previous session). Not done: UAT with real staff; restore drill of the complete data set (export is incomplete) |

## 3. Plan packages vs repo reality (this changes the order)
| Plan item | Repo reality | Action |
|---|---|---|
| WP-1 Redevelopment registry + consent | Not built (AUDIT.md row: "Open") | Build as planned |
| WP-2 Rehab, transit rent, corpus | `sal_inventory.category` (sale/rehab) ALREADY exists (0011) and rehab units cannot be sold. No transit/corpus tables | Build only the `red_*` tables; DO NOT re-add `category` |
| WP-3 Meetings log | Not built | As planned |
| S2 migration | `pro_bills.gst_paise`, `tds_bp`, `tds_paise`, `taxable_paise`, `tds_section`, `project_id` ALREADY exist (0012) | Revised S2: drop those ALTERs; add `pro_payments`, `pro_grn_items`, `ppl_staff` columns only. See `proposed-migrations/0013_proposed_reconcile.sql` |
| WP-4 Procurement addendum | indents and per-line GRN missing; bill GST/TDS exist | Build indents, `pro_grn_items`, `pro_payments`; do not rebuild GST/TDS |
| WP-5/6/8/9/10 Contractors, DPR labour, stock, party docs, petty cash | Not built | As planned |
| WP-7 Budget heads | Project-level budget vs committed/billed/paid exists (`/api/reports/project-financials`, finance.js) | Treat as extension: add head-level budgets |
| WP-11 Number series, credit notes | `sal_receipts.receipt_no`, reversal, cash limit exist. Demand numbering and credit notes not seen | Verify demand numbering; add credit/debit notes and optional maker-checker only |
| WP-12 Hold ownership | `hold_by`, `hold_lead_id`, `hold_at`, expiry cron, `sales.max_holds_per_user` exist | Only co-applicants remain |
| WP-13 Cost sheet + discount approval | `/api/sales/cost-sheet`, `sales.max_discount_bp`, `sales.pm_max_discount_bp`, `approved_by` exist | Verify; likely only versioning/lines remain |
| WP-14 Handover | `/api/sales/bookings/:id/registration` exists; handover checklist not seen | Build checklist only |
| WP-15 RERA 70% | designated account flag on receipts + withdrawal estimate exist | Add deposit/withdrawal entries only if still wanted |
| WP-16 Bulk demands | single `/demands/:id/email` exists | As planned |
| WP-17 Tally | CSV vouchers (receipts, purchases) exist | Add XML + payment vouchers |
| WP-18 Bank CSV | Not built | As planned |
| WP-24 Lead form | signed webhook exists (`WEBHOOK_SECRET`) | Add public form only |
| WP-25 Buyer statement | statement in finance.js + share links exist | Verify; likely done |
| NEW | Backup/export misses 26 of 53 tables | Highest-value fix: new package B0 before feature work |

## 4. Schema drift vs guide section 5
- Guide `CREATE TABLE` list = 45; repo migrations = 53. Every guide table exists in the repo. **Repo-only tables (8):** `brands`, `sal_refunds`, `mkt_spend`, `webhook_seen`, `sal_interest_waivers`, `user_totp`, `user_recovery_codes`, `mfa_challenges`.
- **Why `projects.brand_id` and `projects.percent_complete` are "not in guide §5":** they come from 0010 (multi-brand) and 0012 (finance completion %). The guide is behind the code; document them, do not remove.
- Other repo-added columns not in guide §5: `sal_inventory.{category, hold_by, hold_lead_id, hold_at, list_note}`, `sal_leads.{phone_norm, channel_partner_id, erased_at}`, `sal_bookings.{list_price_paise, discount_reason, approved_by, unit_snapshot, erased_at}`, `sal_receipts.{receipt_no, account, reversed_by, kind}`, `sal_plan_stages.retired`, `pro_bills.{project_id, taxable_paise, gst_paise, tds_section, tds_bp, tds_paise, tds_deposited_on, tds_challan}`, `pro_vendors.pan`, `brand_profiles.brand_id`.
- Still missing vs guide section 7 intent (needs migration): `pro_grn_items`, `pro_payments`, `ppl_staff.trade` and `ppl_staff.project_id`.
- **The "17 tables absent from the Drive backup export"** is a code fact, not a data loss in the sample file: `buildExport()` in `src/index.js` selects 26 tables in full plus a trimmed `users`. Not exported at all (26): `backup_log, brand_profiles, brands, counters, drive_folders, email_log, file_blobs, mfa_challenges, mkt_spend, notifications, oauth_states, otp_codes, ppl_candidates, ppl_hiring, ppl_staff, project_members, rate_limits, sal_brokerage_payments, sal_interest_waivers, sal_refunds, sessions, settings, share_links, user_recovery_codes, user_totp, webhook_seen`. The 17 seen earlier are those of them that exist in migrations 0001 to 0009; the rest were added later. Intentionally transient (fine to skip): `sessions, otp_codes, rate_limits, oauth_states, mfa_challenges, webhook_seen`. **Real losses on restore:** `ppl_*`, `project_members`, `brand_profiles`, `brands`, `counters` (numbering would restart), `file_blobs` (files stored in D1), `settings`, `share_links`, `sal_brokerage_payments`, `sal_refunds`, `sal_interest_waivers`, `mkt_spend`, `user_totp`, `user_recovery_codes`, `notifications`, `email_log`.

## 5. Settings and secrets (names only, never values)
Worker secrets referenced in code: `SESSION_SECRET`, `APP_KEY`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEBHOOK_SECRET` (optional). Vars in `wrangler.toml`: `ENVIRONMENT`, `EXTERNAL_URL`. CI needs repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (present or absent not verified). `.dev.vars.example` exists; `.dev.vars` is git-ignored.
Settings keys read by code: `access.allow_second_owner`, `access.limit_roles_to_assigned_projects`, `brochure.price_list_default_audience`, `demand.due_days_after_milestone`, `email.otp_enabled`, `files.brochure_max_mb`, `interest.enabled|grace_days|rate_bp`, `po.pm_approval_limit_paise`, `sales.max_discount_bp`, `sales.pm_max_discount_bp`, `sales.max_holds_per_user`, `sales.share_all_leads`, `security.require_mfa_roles`, `share.default_expiry_days`, `storage.driver`, `storage.gdrive.*` (status, tokens encrypted, root folder, account email), `storage.warn_percent`, `tax.women_concession_bp`. Not present yet: any `red.*`, `budget.*`, `rera.*`, `tally.*` keys.
Doc staleness to fix: `HANDOVER_FOR_CLAUDE.md` still contains the Owner login e-mail and an instruction to set up the GitHub remote; remove stale lines in the next docs commit (no password values are in the file).

## 6. Cron and wrangler vs guide
Matches: four crons (08:00 IST digest + approval reminders, 19:00 IST DPR nudge, hourly sweep = email retry + lead SLA nudges + hold expiry, 02:00 IST housekeeping + nightly Drive backup). Guide 5-trigger cap respected (one spare). Differences: `wrangler.toml` not `.jsonc`; the 02:00 housekeeping deletes `sessions` and `otp_codes` but NOT expired `rate_limits` (code comment says it does); `/api/health` is open and returns the environment name.

## 7. Free-plan risks spotted (to measure, not yet measured)
1. **Backup/export CPU and memory:** `buildExport` and the nightly backup read every row of 26 tables, including `audit_log` and `documents`, then `JSON.stringify` the whole set in one request or cron run. Will exceed 10 ms CPU and the memory/Drive-upload practicality as data grows. Needs chunked, per-table export (resumable) before real data volume arrives.
2. **Staging gap:** production migrations apply automatically on merge to `main` with no staging gate (contradicts guide §10.1). Mitigation until fixed: always run `deploy:staging` and acceptance tests from the branch before merging; take a D1 export before merging any migration.
3. **Hourly sweep growth:** `retryFailedEmails`, `leadSlaNudges`, `expireHolds` run in one tick; each adds queries per row. Add per-run LIMITs and measure query counts (cap 50).
4. **`src/index.js` size (3,082 lines) and wide `SELECT *`** in reports/exports: bundle is fine today; per-request CPU should be measured on the dashboard, `project-financials`, `stacking`, `aging` and `cashflow` reports.
5. **Dependence on missing indexes:** only the indexes in migrations exist; every new list/report filter must add its own.
6. **Email/Drive untested against real services** (scripted SMTP server only; Drive routing "untested against Google" at one point). Treat both as unproven until the Owner connects them.
7. **Google OAuth Testing mode:** weekly reconnect remains (D3).

## 8. Next step
Per the real state, run **S1** (create `CLAUDE.md`, adapted to the repo's actual structure and CI), then **B0** (backup/export completeness and cron guard), then **S2-revised** (migration 0013: only the genuinely missing tables and columns), then **WP-1**. Reasons: all guide phases through 13 are already built or ahead, so "finish Phase 4B/5" and "Guide Phase 8/9 prompts" are no longer needed; the biggest risk to real data is the incomplete backup. See `docs/planning/README.md`.
