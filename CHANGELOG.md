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

## WP-7 budget heads (2026-11-22)
- New "Budget" screen per project: heads with budget, committed, billed, paid, balance and % used, in words and colour (Within budget / Close to the limit / Over budget). Tap a head to see the POs and work orders behind it. CSV download. Owner/PM set heads; Accounts, Purchase and Viewer can read; Site and Sales cannot.
- PO and work order forms ask for a budget head (optional). Approving a PO or work order that pushes a head over budget still works but shows a warning, and tells the Owner and PM (once per head per week).
- New setting: budget.gst_basis (without/with GST), default without.
- Migration 0017; code in `src/routes/budget.js` plus service functions in procurement2.js and contractors.js; test `tests/budget.mjs` (30 checks, in CI); browser walkthrough (10 checks).
- WP-7 released after GitHub checks passed.

## WP-8 store, WP-9 document expiry, WP-10 petty cash (2026-11-22)
- Store: stock on hand per project; goods received against a PO line tied to a store item go into stock in the same batch as the receipt; issue to work (offline-capable, never below zero, two taps at once cannot both win); transfers between sites; stock-count adjustments need a PM; reorder level with a daily low-stock reminder; moves log and CSVs.
- Documents with expiry for vendors and contractors: type freely, valid-till date, reminder days, file upload, replace with a new copy (stops the old reminder); PM and Purchase are reminded once per document per week, again when expired.
- Petty cash: fund per custodian, expenses with bill photo (offline-capable) wait for PM approval, Accounts adds cash, cash can be returned, entries are cancelled never deleted, low-balance warning (setting petty.low_balance_paise), statement CSV with category totals.
- Fix found by browser tests: the screens used the wrong field for the signed-in user's id. Migrations 0018-0020; tests stores (41), partydocs (26), petty (34) in CI; browser walkthrough 29 checks. CI now starts the dev server with --test-scheduled so hourly sweeps can be tested.

## Professionals, contracts and the AI assistant (2026-11-22)
- Professionals register (architect, structural engineer, advocate, CA...). Every vendor, contractor and professional has a "Contracts and documents" block: upload contracts (with end date and reminders) and other documents, replace with a new signed copy, history kept. Reminders say "Contract expiring" or "Document expiring".
- AI assistant (Cloudflare Workers AI, free allowance, off until the Owner switches it on): Ask the CRM (permission-filtered facts, shows its sources), write messages in English/Hindi/Marathi, summaries. Nothing is sent or changed by AI. See docs/AI.md.
- Deploy workflow adds the AI binding at deploy time; CI starts the dev server with AI_MOCK so tests need no real model.
- Migrations 0021-0022; tests professionals (23), ai (38) in CI; browser walkthrough (17 checks).

## WP-11 to WP-14 sales completeness (2026-11-22)
- AI assistant: English only (Hindi and Marathi removed by decision).
- WP-11: receipt, demand-letter and credit-note numbers by financial year, race-safe (five receipts at once get five numbers); large receipts wait for a second person (setting); credit notes, debit notes and adjustments with approval, own numbers, reversal and print; numbering-gap report (CSV).
- WP-12: flat card shows who holds it and for which lead; hold sweep rewritten to a fixed number of statements (was up to 300 queries) with a one-hour warning; co-applicants on a booking with PAN and Aadhaar kept private.
- WP-13: cost sheets (rate x area, extra charges, discounts, GST, stamp duty, registration) with versions, PM/Owner approval bands, letterhead print, booking priced from an approved sheet, discount report.
- WP-14: handover checklist (editable template), possession details, home-loan records, snags per flat, "possessed" status, due reminders, pending-handover report.
- Migration 0023; code in `src/routes/sales3.js`, `public/pages11.js`; test `tests/sales3.mjs` (92 checks, in CI); browser walkthrough 25 checks.
- Released: WP-8 to WP-14, professionals and contracts, AI assistant (after GitHub checks passed).
