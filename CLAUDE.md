# NirmaanCRM: standing rules for Claude Code
Dhaval is not a programmer. Explain plainly, give exact commands, and end every task with a click-by-click "3-click test".
Read first: `docs/STATE.md` (what is really built), `docs/planning/README.md` (order of work, decisions), `docs/planning/nirmaan_claude_code_plan.md` (prompt pack), `docs/NirmaanCRM_Claude_Build_Guide_v1.3.md` (spec). `HANDOVER_FOR_CLAUDE.md` is partly stale. Where the repo and the guide differ, follow the repo's conventions and say so.

## Repo structure (decision D9: keep it)
- `wrangler.toml` (not jsonc): production on `crm.mysociety.tech`, D1 binding `DB`, assets `public/`, 4 crons, `[env.staging]` with its own DB and `crons = []`.
- `src/index.js` is the Worker entry plus most API routes. New features go in `src/routes/<name>.js` exporting `registerX(router, deps)` and are wired with ONE import and ONE call in `src/index.js` (see finance.js, mfa.js). Shared helpers live in `src/core/` (auth, permissions, audit, settings, db, events, gdrive, mail, util).
- Frontend: vanilla JS, no build step, no inline scripts (CSP). Screens live in `public/pages*.js` (add a new `pagesN.js` and a script tag in `public/index.html`), shared helpers in `ui.js`, router in `app.js`. Bump the cache name in `public/sw.js` when shell files change.
- Migrations: `migrations/NNNN_name.sql`, next free number is **0013**. Tests: `tests/*.mjs`.

## Binding rules (from the guide, still apply)
- Migrations are additive only: CREATE TABLE, ADD COLUMN, CREATE INDEX. Never edit an applied migration; never drop or rename. Check existing columns first (`grep` migrations/) so you never re-add one.
- Money in paise (INTEGER), percentages in basis points (`_bp`), dates stored UTC and shown in IST, phones +91. All money arithmetic in integers.
- Soft delete (`deleted_at`) for normal records. Money records (receipts, payments, bills, adjustments) are never deleted: cancel or reverse with a reason.
- Every route checks permission on the server (`withAuth(req, env, module, action)`, `visibleProjectIds` for project scope). Hiding a button is not security.
- Every write is audited (`audit_log`, append-only) and, where useful, notifies. Use `db.batch()` for multi-row writes; use `counters` for race-safe numbering; use `client_uuid` for idempotent offline writes.
- Every state-changing request needs the `X-NirmaanCRM: 1` header (CSRF). Never expose a public file URL: files are served only to signed-in users or through expiring, revocable `/s/<token>` share links. Customers and outsiders never get a login. No SVG uploads (magic-byte checks stay).
- Secrets only via `wrangler secret` / `.dev.vars` (git-ignored). Never put a secret, token, key, password or Aadhaar number in code, logs, audit text, API output, exports or chat. Aadhaar is never stored; PAN/bank are encrypted and masked.
- Tax, legal and RERA rates and thresholds (GST, TDS, stamp duty, 70% designated account, consent majority, interest rate) are editable settings with the note "confirm with CA/advocate", never hard-coded. Do not invent legal text or checklists (the member-document list for redevelopment is pending Dhaval's list).

## Free-plan caps and the Rs 0 contract: design for them
- About 10 ms CPU per request or cron run; 50 D1 queries per request/run (join, aggregate, batch, paginate); 50 subrequests; 5 cron triggers (4 used: add work to the hourly sweep, never a new cron); request bodies streamed. Add an index for every filter/sort column. Chunk heavy work (exports, imports, XML/PDF) in the browser or in resumable pieces.
- Never add a paid service, a card requirement, a trial, or a runtime npm dependency without asking first. wrangler is the only dev dependency. Warn BEFORE writing code that could break a cap and report measured queries/CPU after.

## UX rules (55-year-old user, cheap Android phone)
A daily task takes 3 taps or fewer; 18px+ text, 48px+ buttons; plain-language errors; empty states with one big action; Hindi/Marathi labels for site-facing screens; works on 4G; offline queue for site forms.

## Running and testing
```
npm install --no-audit --no-fund
printf 'SESSION_SECRET=...\nAPP_KEY=...\nOWNER_EMAIL=owner@test.local\nOWNER_PASSWORD=ChangeMe12345\nWEBHOOK_SECRET=testwebhooksecret\n' > .dev.vars   # local only, never commit
npx wrangler d1 migrations apply nirmaan-db --local
npx wrangler dev --port 8787 &            # then log in once and change the password (see .github/workflows/ci.yml for the exact curl calls)
BASE=http://localhost:8787 OWNER_EMAIL=owner@test.local OWNER_PASSWORD=CiStrongPass-12345 node tests/<suite>.mjs
```
Suites: security, features, multibrand, sales2, audit, reports, phase2 (about 290 checks). Add or extend a suite for every package. `node --check public/*.js` must pass. CI (`.github/workflows/ci.yml`) runs all of this on every PR; `deploy.yml` deploys only after CI passes and the `production` environment is approved.

## Safe operations
- Merging to `main` applies migrations to PRODUCTION automatically. So: export D1 first (`npx wrangler d1 export nirmaan-db --remote --output=pre-change.sql`, keep outside git), test the migration locally and on staging (`npm run deploy:staging`, `npx wrangler d1 migrations apply nirmaan-db-staging --remote --env staging`), then merge.
- Never run wrangler against production, deploy, change secrets, or touch Cloudflare/Google accounts unless Dhaval explicitly asks in that session. Always pass --local or --remote explicitly.

## Working routine: one package per session
1. Branch per package (`feature/<id>-<name>`, or `claude/...`). Never commit to main.
2. Read the package prompt in `docs/planning/nirmaan_claude_code_plan.md`; verify what already exists (STATE.md section 3) and build only the gap.
3. Write the migration, route file, screen, and tests. Run all suites.
4. Update `CHANGELOG.md` and the data dictionary (`docs/DATA_DICTIONARY.md`, create it from the migrations on the first package that needs it) in the same change; add any new table to the backup/export list (package B0 adds a test that fails otherwise).
5. Report: files changed, measured queries/CPU, the 3-click acceptance test, risks. Wait for Dhaval's confirmation. Tick the package in the plan's progress table.
6. Resume prompt for a new session (guide Appendix E): "Continue NirmaanCRM per CLAUDE.md. Read docs/STATE.md and CHANGELOG.md. Current package: [id]; branch [name]; status [..]; latest migration [NNNN]. Do not redo finished packages. Resume from: [step]."

## Stop and ask Dhaval when
The guide or plan is ambiguous, a cap would be exceeded, a legal/tax rule is involved, a decision in `docs/planning/README.md` is unanswered, or a change needs new infrastructure, cost or a dependency.
