# Changelog

## Unreleased
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
