# NirmaanCRM: standing rules for Claude Code
Binding spec: docs/THIS_GUIDE.md = NirmaanCRM_Claude_Build_Guide_v1.3.md. Read it (and docs/STATE.md, docs/DATA_DICTIONARY.md) before any change.
I (Dhaval) am not a programmer: explain terms plainly, give exact commands, and end every task with a click-by-click "3-click test".

## Build contracts (guide §2-§7)
- Stack: Cloudflare Workers + Static Assets + D1; files in Google Drive (Mode G); vanilla HTML/CSS/JS; no framework, no build step, no runtime npm dependency.
- Module contract (§4.2, §10.3): a module = src/modules/<key>/ (api.js, service.js, hooks.js) + public/modules/<key>/ + one migration + one registry entry
  + one import line in src/modules/index.js + a feature flag. Modules never import each other or run raw SQL on another module's tables:
  they ask via the other module's service.js, or announce/subscribe via core/events.js. If a change needs more than that, stop and re-shape it.
- Server-side permissions on every route via core/permissions.js (§4.5); project access via permissions.visibleProjectIds(user) in every query (§4.6).
- Every state-changing call needs the X-NirmaanCRM header (§4.3). Every write: permission, validation, write, audit(), optional notify().
- Money in paise (INTEGER), percentages in basis points (_bp), dates in IST, phones +91. Money records are never deleted: cancel or reverse with a reason.
- Rates for GST, TDS, stamp duty, RERA percentages and legal thresholds are editable settings with the note "confirm with CA/advocate"; never hard-code.

## Safe operations (guide §10.1)
- Additive-only migrations: new numbered file, only CREATE TABLE / ADD COLUMN / CREATE INDEX. Never edit an applied migration; never drop or rename.
- Before any migration: npx wrangler d1 export nirmaan-db --remote --output=pre-change.sql. Deploy to STAGING first, run the acceptance test there, then production.
- Always pass an explicit --remote or --local flag. Staging has its own database and no Google keys (uses the d1 driver).
- One work package per session, on its own git branch (feature/<id>-<name>). Update docs/CHANGELOG.md and docs/DATA_DICTIONARY.md in the same change.
- Every new table must be added to the nightly-backup table list and to Export-everything (§11.1) in the same change.

## Free-plan caps (guide §3.2): design for them, and warn me BEFORE writing code that could break one
- About 10 ms CPU per request or cron run; 50 D1 queries per request/run (use db.batch(), joins, aggregates, small pages); 5 cron triggers (we use 4;
  add work to the hourly sweep, never a new cron); 50 subrequests; request bodies streamed, never buffered.
- Every WHERE/ORDER column used by a list, reminder or report has an index. Heavy work (ZIPs, PDFs, big exports, XML) runs in the browser or in resumable chunks.
- After each package report the measured Worker CPU ms and the D1 query count for each new route and sweep step.

## UX contract (guide §2, §6)
- A daily task takes 3 taps or fewer, no jargon, 18px+ text, 48px+ buttons, plain-language errors, empty states with one big action button, a ? help button on every screen.
- Mobile-first for a Rs 10,000 Android phone on 4G; site-facing forms work offline (IndexedDB queue, client_uuid idempotency). Hindi/Marathi labels via i18n.js.

## Secrets and privacy
- Never print, log, audit, return, commit or export any secret, token, key, password or Aadhaar number. Secrets only via wrangler secret. Aadhaar masked only.
- Customers and outsiders never get a login or a raw file address (§2 rule 15); sharing only through expiring, revocable /s/<token> links (§7.10).
- Never add a paid service, a card requirement, a free trial, or an npm runtime dependency without asking me first.

## Stop and ask me when
- The guide is ambiguous or technically impossible, a free-plan cap would be exceeded, a legal/tax rule is involved, or a decision in the plan's "Decisions needed" box is unanswered.

## End of every package
Run the acceptance test on staging, list files changed, update CHANGELOG and DATA_DICTIONARY, give the 3-click test and the measured CPU/queries, then wait for my confirmation.
