# Changelog

## Unreleased
- New (phase 2): late-interest accrual with waivers and interest receipts; bulk CSV import; two-step sign-in (TOTP + recovery codes, per-role requirement); project financials with RERA withdrawal estimate; vendor bill GST/TDS, TDS report, Tally exports; customer statement; DPDP find/export/erase. See docs/ACTION_PLAN.md.
- Audit pass: atomic holds/bookings, 48h holds with expiry, discount approval limits, audited price/plan changes, lead protection (normalised phone, first registration wins), lead state machine, receipt integrity (numbering, cash limit, duplicates, reversal), refunds workflow, unit transfer, Maharashtra cost sheet, RERA 70% routing report, signed lead webhook, append-only audit log, KYC document isolation, magic-byte uploads, sanitized errors, IP login throttle, hashed sessions. See docs/AUDIT.md.
- Reports and UI: interactive stacking plan, cash flow/escrow, aging, marketing & partner ROI, velocity & discount leakage, charts on the dashboard.
- Fix: changing the payment plan after bookings crashed (foreign key).
- New: lead timeline with mandatory next follow-up, site visits, 1h/4h lead SLA nudges, Today strip, channel partners + brokerage payable, lead funnel report, global search, approval expiry/unanswered-query reminders (08:00 IST), "Needs attention" strip and PM home, notification tap-through.
- New: brochure library, site photo queue, snag workflow, People/HR, project archive, encrypted PAN/bank, signature/stamp/letterhead styles, demand-letter email, owner checklist, Hindi/Marathi everywhere, privacy/terms pages, cheat sheets, UAT + restore drill, automated security/feature tests.
- Fix: `visibleProjectIds` duplicated in index.js ignored the "only site is limited" rule and archived projects.
- Fix: Drive connect (PKCE verifier, callback binds, hidden Connect button).
- Fix: cron triggers never ran (`scheduled` was not on the default export). Failed logins only count towards the lockout.
- New: letterhead print views, RFQ quotes, GRN, vendor bills/ledger, offline queue, Hindi/Marathi site flow, CSV + JSON exports, nightly Drive backup, Drive upload/download routing (untested against Google).
- Fix: blank page caused by `const API_BASE` declared twice; `api()` now JSON-encodes object bodies.
- Fix: dashboard, receivables, branding, approval events, documents, share links, PO numbering SQL errors.
- Fix: file/brand downloads returned comma-separated numbers; `/s/*` and `/brand/*` now reach the Worker.
- Fix: login errors are 401/429 not 500; unauthenticated API calls return JSON 401.
- Security: forced first-login password change enforced on the server; CSP without inline scripts; HTML escaping on every screen;
  settings API allow-list and secret masking; documents API can no longer point at arbitrary blobs; project checks on documents.
- Email: SMTP client rewritten (multi-line replies, AUTH PLAIN/LOGIN, STARTTLS, MIME with UTF-8, dot-stuffing, header-injection guard);
  encrypted SMTP password; Email settings screen; working OTP login; digest escapes content.
- New: users admin, approvals template, drawing revisions, PO approval, sales bookings/receipts, share links with revoke, document upload/links.

## S0/S1 (2026-11-22)
- Docs only: added `docs/STATE.md` (reconciliation, remote checks pending), `docs/DATA_DICTIONARY.md` (real schema), `docs/proposed/0010_reconcile.sql` (NOT applied), `CLAUDE.md` (standing rules).
- S2: migration 0013 (ppl_staff trade/project_id, pro_grn_items, pro_payments); export now includes those plus 9 previously omitted tables. Option B adopted.

## WP-4 procurement addendum (2026-11-22)
- New: indents (site raises, PM approves, Purchase converts to RFQ), items on RFQs, per-line quotes with server-calculated totals, material received by PO line (PO becomes part_received/received from the totals in one batch), bill part-payments with atomic over-payment guard, payment reversal, exact vendor ledger, reports (pending indents, PO vs received; CSV).
- Changed: old "mark paid" now records a normal payment for the balance; project financials count payments; site engineers can open the Procurement screen (lists they may not view are skipped).
- Migration 0014; code in `src/routes/procurement2.js`, `public/pages6.js`; test `tests/procurement2.mjs` (39 checks, added to CI).

## WP-5 contractors (2026-11-22)
- New module "Contractors" (switched off until the Owner turns it on in Settings): contractors with private PAN, work orders (lump sum / item rate / measured, retention per work order, advance), maker-checker approval with a PM limit, running-account (RA) bills with retention, advance recovery, GST/TDS from settings, over-quantity warning, check then approve, part payments with reversal, retention release, closing rules, append-only ledger, reports (CSV), letterhead print for work orders and RA bills (DRAFT until approved), hourly RA-due reminder.
- Changed: Export-everything and the nightly backup now come in 3 parts (the free plan allows 50 database reads per run). `scripts/restore.mjs` takes all parts and now restores every table, including ones it used to skip.
- Changed: `api()` errors carry `.data` so screens can offer "save anyway". Staging workers.dev address switched off; crm.mysociety.tech is the only public address.
- Migration 0015; code in `src/routes/contractors.js`, `public/pages7.js`; test `tests/contractors.mjs` (61 checks, in CI).
- Fix (found by the browser walkthrough): the Contractors menu entry broke the whole app because it was wired before its script loaded; site engineers could not see any PO to receive material against (new money-free `/api/procurement/pos-to-receive`); the Contractors screen hid its buttons from Purchase/Accounts. Browser walkthrough: 26 checks as 5 roles on a phone-sized screen (`tests/ui-walkthrough.mjs.txt`, screenshots in `docs/ui-walkthrough/`).

## WP-6 daily report labour by contractor (2026-11-22)
- Daily report: one +/- row per contractor with an approved work order on the project, copied from the last report; contractor list is remembered on the phone so it works in airplane mode and syncs once. With Contractors off or no contractors, the old single labour box shows. Photos unchanged.
- Report saved in one batch (report + labour lines + audit). Contractors are checked server-side; unknown, duplicate or absurd lines are refused and nothing is half-saved.
- New: monthly man-days by contractor and trade (`/api/site/reports/labour`, CSV link on the Site screen for Owner/PM).
- Backup/restore include `site_dpr_labour`. Migration 0016; test `tests/dprlabour.mjs` (20 checks, in CI); browser walkthrough with airplane mode (11 checks).

- WP-6 merged and deployed after GitHub checks passed.
