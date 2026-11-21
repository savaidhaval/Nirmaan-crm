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
