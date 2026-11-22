# Planning pack (Claude Code)

Files in this folder:
- `nirmaan_claude_code_plan.md` — ordered prompt pack (S0 to S2, WP-1 to WP-25). Written against guide v1.3 before the repo was inspected; read the "Repo reality" note below first.
- `nirmaan_vs_selldo.md` — feature and process comparison with Sell.Do.
- `nirmaan_construction_todo.md` — construction/procurement research and the P1-P3 to-do list.
- `proposed-migrations/0013_proposed_reconcile.sql` — DRAFT, not applied.
- `../STATE.md` — what is actually built (result of prompt S0).
- `../NirmaanCRM_Claude_Build_Guide_v1.3.md` — the spec.

## Repo reality that changes the plan (details in docs/STATE.md)
- Phases 1 to 13 of the guide are built or exceeded. Skip "Guide Phase N" steps in the release table; start at S1.
- Structure is a monolith (`src/index.js` + `src/routes/*.js` + `public/pages*.js`), not `src/modules/<key>/`. New code follows the existing pattern: a `src/routes/<name>.js` with `registerX(router, deps)`, a line in `src/index.js`, a `public/pagesN.js` screen, a migration, and a test in `tests/`. Do not refactor to the guide's module folders without Dhaval's approval (decision D9).
- Next migration number is 0013. Tables/columns that already exist must not be re-added (see STATE.md section 3).
- `deploy.yml` applies migrations to production on every push to `main`. Test every migration on staging first and export D1 before merging.

## Order of work (revised)
1. ~~S0~~ DONE (docs/STATE.md). ~~**S1**~~ DONE: `CLAUDE.md` created, HANDOVER banner added, CI gate added (see D10 below).
2. **B0** backup/export completeness (new): export all data tables, chunked; restore drill; cron guard (`rate_limits` cleanup, per-run LIMITs).
3. **S2-revised** migration 0013 from `proposed-migrations/`, plus guide wording fixes (filename, OAuth Testing mode, roster).
4. **R1** WP-1 redevelopment registry + consent, WP-2 transit rent/corpus (no re-adding `category`), WP-3 meetings.
5. **R2** WP-4 indents + per-line GRN + partial payments, WP-5 contractors/work orders/RA bills, WP-6 DPR labour, WP-7 head-level budgets, WP-8 stock, WP-9 party documents, WP-10 petty cash.
6. **R3** only the remaining gaps: demand numbering and credit notes, co-applicants, handover checklist, bulk demand letters, bank CSV matching, Tally XML. Verify first: cost sheet versions, WP-15 RERA entries, WP-19 visit feedback, WP-25 statement link (partly built).
7. **R4** dashboard extras, offline queues + Hindi/Marathi for new screens, drawing acknowledgement, hardening/UAT.
8. **R5** public lead form, optional extras.

## Decisions (2026-11-22: Dhaval said "use default" for all; D2 stays pending)
| # | Decision | Default |
|---|---|---|
| D1 | Consent counting: head-count or carpet area; warn only or block | Head-count; warn only; 51% per society, editable |
| D2 | Member-document checklist | PENDING Dhaval's list; left empty, nothing invented |
| D3 | Google OAuth: stay in Testing (weekly Reconnect) or change route | Stay in Testing |
| D4 | Contractor payment basis, retention %, who supplies materials | Both RA and lump-sum; retention per work order; contractor-supplied materials not tracked |
| D5 | Transit rent frequency, cheques, corpus instalments | Monthly; cheque number recorded; corpus as dated entries |
| D6 | Tally: sample voucher file + ledger names | Mapping left empty; XML marked UNTESTED until supplied |
| D7 | Sell free-sale units in volume? | Yes but lower priority; remaining R3 items can wait |
| D8 | Hindi/Marathi for new site screens | Yes |
| D9 (new) | Keep the monolith structure, or refactor to guide modules | **DECIDED 2026-11-22: keep**; new features as `src/routes/*.js` |
| D10 (new) | Add a gate before production deploys | **DECIDED: yes** (done in S1, see below) |

## D10 production gate: what was done and what Dhaval must click
Done in code (`.github/workflows/`): `ci.yml` can now be called by other workflows; `deploy.yml` first runs the whole CI (frontend syntax check, production and staging bundle dry-runs, ALL migrations applied to an empty local D1 database, every test suite) and the deploy job runs only if that passes (`needs: checks`) and uses `environment: production`. No new Cloudflare resources or secrets were created, and no real staging deploy was added (that would need a staging Worker run from CI with its own token; recommended later, not done).
Three manual steps in GitHub (cannot be done from code):
1. Repo Settings > Environments > New environment, name it exactly `production`.
2. In that environment, tick "Required reviewers" and add yourself. Every deploy then waits for your Approve click.
3. Settings > Branches > add a branch protection rule for `main`: require a pull request and require the status checks "build" and "tests" to pass.
Until steps 2 and 3 are done, the CI gate still blocks a failing deploy, but a deploy of a passing build is not held for approval.

## Next step
**B0** (backup/export completeness), prompt in the plan under "Prompt B0". Needs from Dhaval: nothing blocking; confirm that an export containing settings (secrets masked) and customer data may be written to his private Google Drive Backups folder, as the nightly backup already does.
