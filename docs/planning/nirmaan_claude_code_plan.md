# NirmaanCRM: action plan and prompt pack for Claude Code
Prepared 2026-11-22 for Dhaval Savai. Source of truth: `NirmaanCRM_Claude_Build_Guide_v1.3.md` (referred to as "the guide", § numbers). Built from the two comparison reports (`nirmaan_vs_selldo.md`, `nirmaan_construction_todo.md`) plus Dhaval's answers: labour is by contractors; accounting = Tally export only; 51% redevelopment consent threshold; member-document list pending.

## How to use this file
1. Do the three setup prompts first (S0, S1, S2).
2. Then work through the packages in the order of the release table in section 3. Where the table says "Guide Phase N", use the guide's own prompt in §8 (with the patched spec from S2). Where it says "WP-n", paste the prompt from this file.
3. One package per Claude Code session, on its own git branch. Routine and checklist: section 4.
4. Each prompt assumes `CLAUDE.md` (S1) is in the repo, so it only states what is specific to the package.

## Decisions needed from Dhaval (Claude Code uses the default shown if you do not answer)
| # | Decision | Default used | Blocks |
|---|---|---|---|
| D1 | Consent counting: by member head-count or by carpet area? Warn only, or block next stage, below the threshold? | Head-count, warn only; threshold 51% per society, editable | WP-1 |
| D2 | Member-document checklist | **PENDING YOUR LIST. Left empty; nothing invented** | WP-1 (checklist part only) |
| D3 | Google OAuth: stay in Testing (weekly Reconnect) or move to the Personal/custom-domain route? | Stay in Testing; improve the reconnect banner | S2, Phase 4 |
| D4 | Contractor payment basis: measured RA bills, lump-sum work orders, or both? Usual retention %? Who supplies materials? | Both supported; retention a per-work-order setting; contractor-supplied materials not tracked | WP-5, WP-8 |
| D5 | Transit rent: monthly or quarterly; post-dated cheques? Corpus: single payment or instalments? | Monthly schedule; cheque number recorded; corpus as dated entries | WP-2 |
| D6 | Tally: send a sample of vouchers your accountant imports today, and the ledger names | Ledger map left empty until supplied | WP-17 |
| D7 | Does MRI sell free-sale units in volume (via brokers/portals)? | Treat as yes but lower priority than redevelopment and construction; R3 can be postponed | R3 |
| D8 | Hindi/Marathi labels for the new site-facing screens | Yes (WP-21) | WP-21 |

Tax and legal rates (GST, TDS, stamp duty, RERA percentages, redevelopment consent rules) are never hard-coded: they are editable settings with the note "confirm with your CA / advocate".

---

## 1. Step 0: reconcile reality vs the guide (before any new feature)
Known drift: the backup shows `projects.brand_id` and `projects.percent_complete`, which guide §5 does not define; 17 guide tables are missing from the backup export (`sal_brokerage_payments`, `ppl_staff`, `ppl_hiring`, `ppl_candidates`, `email_log`, `backup_log`, `notifications`, `sessions`, `otp_codes`, `rate_limits`, `counters`, `file_blobs`, `project_members`, `brand_profiles`, `share_links`, `drive_folders`, `oauth_states`; plus `settings` is not exported). The backup also shows only the owner user, one project, and 27 loaded approvals rows. The export may omit tables on purpose; the database itself must be checked.

### Prompt S0: inspect and write STATE.md (read-only)
```text
SETUP S0. Read-only reconciliation. Do NOT change code, migrations, secrets or data in this session.
Safe-ops: staging first for anything later; additive-only migrations (guide §10.1); D1 export before any migration;
respect free-plan caps (guide §3.2: ~10 ms CPU, 50 D1 queries per request).

Inspect the actual repo and deployments and write docs/STATE.md with these sections:
1. Repo facts: branch, last 20 commits, wrangler.jsonc (bindings, run_worker_first, crons, staging env), package.json.
2. Migrations: files in migrations/ vs what is actually applied on production AND staging
   (npx wrangler d1 migrations list nirmaan-db --remote, and the same for staging). Flag any migration that was edited after being applied.
3. Live schema: list every table and its columns from sqlite_master/pragma table_info on production and staging
   (read-only SELECTs via wrangler d1 execute --remote). Diff against guide §5 (0001-0009 incl. section F). Report:
   (a) tables in the guide but not in the database, (b) tables in the database but not in the guide,
   (c) column drift, especially projects.brand_id and projects.percent_complete (not in guide §5), (d) missing indexes from §5.
4. Modules: contents of src/modules/index.js and core/modules.js; which public/modules/* pages exist; which API routes exist.
5. Phase status: for each guide phase (1, 1 add-on, 2, 3, 4, 4B, 5, 6, 7, 8, 9, 10, 11, 12, 13) state Done / Partial / Not started with the evidence
   (files, routes, tables, data). Use the "Done when" lists in guide §8.
6. Settings and secrets: list settings keys present; list Worker secret NAMES only (never values); storage.driver and storage.gdrive.status;
   which crons are active.
7. Data present: row counts per table (counts only, no personal data in the report).
8. Risks: anything that conflicts with the guide's contracts (e.g. raw SQL across modules, unindexed filters, queries per request over ~40,
   missing X-NirmaanCRM header checks, missing permission checks).
Then update docs/DATA_DICTIONARY.md to describe the REAL schema (mark each drift item "drift from guide v1.3") and write a proposed,
NOT applied, corrective migration as docs/proposed/0010_reconcile.sql (additive only; never rename or drop).
End with a short list of questions for me. Do not start any new feature.
```

---

## 2. Step 1 and Step 2: CLAUDE.md and guide fixes

### Prompt S1: create CLAUDE.md in the repo root
```text
SETUP S1. Create CLAUDE.md in the repo root with exactly the content below (keep it under ~80 lines), commit on branch chore/claude-md.

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
```

### Prompt S2: guide patch 1.3.1 (cheap fixes) as docs plus additive migration
The five fixes were flagged in the construction report (section 3, issues 1, 2, 3, 4, 5).
```text
SETUP S2. Patch the guide and add one additive migration. Branch chore/guide-1-3-1. Staging first. D1 export before migrating.
Use docs/STATE.md to choose the next free migration number (call it 00NN below); if 0007 (ppl_) or the 0010 Drive section were never applied, say so and stop.

A) Guide text edits (docs/THIS_GUIDE.md only; mark each with "v1.3.1"):
 1. Master Prompt in section 0: change the file name from NirmaanCRM_Claude_Build_Guide_v1.2.md to NirmaanCRM_Claude_Build_Guide_v1.3.md.
 2. Google OAuth wording (section 3.4 note 1, Phase 1 add-on, section 11.4): remove the contradiction between "never leave the app in Testing" and fallback option 4.
    State plainly: "Current accepted setting (D3): the app stays in Testing; Google ends the sign-in after 7 days, so the Owner presses Reconnect weekly.
    The 'Personal' audience has not been verified to exist; check it only if it is offered." Make the Reconnect banner, the phone photo/DPR queue and the nightly
    verification the designed mitigation. Do not change code in this step.
 3. Section 7.7 contractor roster: replace "feeds a who-works-at-which-site list" with "roster of staff and consultants; contractors and labour suppliers
    are managed in the Contractors module (work packages WP-5/WP-6)". Keep payroll out of scope.
 4. Section 7.5 and Appendix: GRN quantities are structured per PO line (new table below); bills support partial payments, GST and TDS.
B) Migration 00NN_guide_fixes.sql (additive only):
 - ALTER TABLE ppl_staff ADD COLUMN trade TEXT; ALTER TABLE ppl_staff ADD COLUMN project_id INTEGER REFERENCES projects(id);
 - CREATE TABLE pro_grn_items (id, grn_id REFERENCES pro_grns, po_item_id REFERENCES pro_po_items, qty_received REAL NOT NULL, note TEXT, created_at) + index on grn_id and po_item_id.
 - CREATE TABLE pro_payments (id, bill_id REFERENCES pro_bills, amount_paise INTEGER NOT NULL, tds_paise INTEGER NOT NULL DEFAULT 0, paid_on TEXT NOT NULL, mode TEXT, ref_no TEXT,
   note TEXT, reversed_at TEXT, reversal_note TEXT, created_by INTEGER, created_at) + index on bill_id. Payments are reversed, never deleted.
 - ALTER TABLE pro_bills ADD COLUMN gst_paise INTEGER NOT NULL DEFAULT 0; ADD COLUMN tds_bp INTEGER NOT NULL DEFAULT 0; ADD COLUMN tds_paise INTEGER NOT NULL DEFAULT 0;
   (status gains the documented value part_paid; no CHECK change needed). Keep pro_bills.paid_on/payment_ref for backward compatibility; new code uses pro_payments.
C) Update section 5 text, docs/DATA_DICTIONARY.md, CHANGELOG, and the nightly-backup table list. Do not build any screen in this session.
Give me the 3-click test: show the new tables on staging, and prove an old PO/bill still loads.
```

---

## 3. Release plan (ordered)
Effort S = days, M = 1-3 weeks, L = 1+ month. "Guide Phase N" = use the guide's §8 prompt. WP = work package prompt below.

| Release | Order | Item | Depends on | Effort |
|---|---|---|---|---|
| **R1 Foundations + redevelopment** | 1 | S0 reconcile, S1 CLAUDE.md, S2 guide patch | none | S |
| | 2 | Guide Phase 4B and 5 (finish if STATE.md says not done) | S0 | M |
| | 3 | WP-1 Redevelopment: society/member registry + consent tracker | Phase 5 | M |
| | 4 | WP-2 Rehab/PAP, transit rent, corpus | WP-1, Phase 9 table `sal_inventory` exists | L |
| | 5 | WP-3 Society meetings and resolutions log | WP-1 | S |
| | 6 | Guide Phase 6 (drawings) and Phase 7 (site) | Phase 4B | M |
| **R2 Procurement + contractors + budgets** | 7 | Guide Phase 8 (procurement, using the S2-patched spec) | S2, Phase 7 | M |
| | 8 | WP-4 Procurement addendum: indents, multi-line RFQ, GRN lines/payments UI | Phase 8, S2 | M |
| | 9 | WP-5 Contractors, work orders, RA bills, retention/advance ledger | WP-4 | L |
| | 10 | WP-6 DPR labour by contractor | WP-5, Phase 7 | S-M |
| | 11 | WP-7 Budget heads and committed vs actual | WP-4, WP-5 | M |
| | 12 | WP-8 Store/stock ledger | WP-4 | M |
| | 13 | WP-9 Vendor/contractor document expiry | WP-5 | S |
| | 14 | WP-10 Petty cash | Phase 4B | S-M |
| **R3 Sales completeness + collections + Tally** | 15 | Guide Phase 9 (sales) | Phase 7, S2 | L |
| | 16 | WP-11 Number series, receipt controls, credit notes | Phase 9 | S-M |
| | 17 | WP-12 Hold ownership, co-applicants | Phase 9 | S |
| | 18 | WP-13 Cost sheet + discount approvals | WP-12 | M |
| | 19 | WP-14 Handover/possession/registration checklist | Phase 9, Phase 7 | M |
| | 20 | WP-15 RERA 70% designated-account tracker | Phase 9, WP-4 | M |
| | 21 | WP-19 Site-visit structured feedback + geotag | Phase 9 | S |
| | 22 | Guide Phase 10 (optional) and Phase 11 (email engine) | Phase 4B | M |
| | 23 | WP-16 Bulk demand letters | Phase 11, Phase 9 | M |
| | 24 | WP-18 Bank-statement CSV import and matching | WP-11 | M |
| | 25 | Guide Phase 12 baseline (dashboard 6 tiles, reports, CSV, ZIP) | all above | M |
| | 26 | WP-17 Tally voucher export (XML) | Phase 12, WP-4, WP-5, WP-11 | M |
| **R4 Dashboards, mobile, polish** | 27 | WP-20 Dashboard extras and targeted reports | R1-R3 | S-M |
| | 28 | WP-21 Offline queues and Hindi/Marathi for new screens | R2-R3 | M |
| | 29 | WP-22 Drawing acknowledgement | Phase 6 | S |
| | 30 | WP-23 Hardening, performance, restore drill for all additions, then Guide Phase 13 | all | M |
| **R5 Optional / later** | 31 | WP-24 Lead capture form (and portal-email parsing, if feasible) | Phase 9 | M |
| | 32 | WP-25 Buyer statement through a share link | Phase 12, WP-11 | M |

**Not planned (guide §1 excludes them, or they break ₹0):** payroll and direct-labour attendance, native apps, WhatsApp Business API, payment gateway, AI scoring/voice, telephony, Gantt/BI, partner portal with logins (conflicts with §2 rule 15), full customer portal. Revisit only on request.

---

## 4. Work-package prompts

### R1: Foundations + redevelopment

**WP-1 Redevelopment: society/member registry + consent tracker** | Goal: record each society and its members and show consent % against a configurable threshold (default 51%). Depends: Phase 5, S0-S2. Effort M. Acceptance: below. Risk: member personal data (DPDP), keeping the consent meter to one aggregate query, legal meaning of the threshold (confirm with advocate); member-document checklist is a placeholder.
```text
New module per guide §4.2/§10.3: "Redevelopment" (key: redevelopment, prefix red_, requires: projects, enabledByDefault:false until I test).
Purpose: for projects with type='redevelopment', track the society and every member's consent so I can see consent % against the required threshold.
Screens (max 3): (1) Societies list + society detail with a big consent meter ("46 of 80 members = 57.5%, threshold 51%: reached"); (2) Members list for a society
 (search by flat/name, one-tap Consented / Declined / Pending buttons, paste-in CSV import, 25 per page); (3) Consent log + pending follow-up list.
Fields: red_societies(project_id, name, registration_no, address, consent_threshold_bp DEFAULT 5100, count_basis DEFAULT 'members' [members|area], notes);
 red_members(society_id, wing, unit_label, member_name, phone, member_type [owner|tenant|commercial|other], carpet_sqft, consent_status [pending|consented|declined],
 consent_date, notes, client_uuid UNIQUE); red_consent_events(member_id, from_status, to_status, note, by_user, created_at);
 red_member_docs(member_id, item_key, document_id, status) driven by a settings key red.member_doc_checklist.
 MEMBER-DOCUMENT CHECKLIST: PENDING DHAVAL'S LIST. Create the settings key as an empty list and the UI for ticking items from it; do NOT invent any checklist items.
Workflow: create society under a redevelopment project; import or add members; set each member's consent; the meter recomputes from ONE aggregate query
 (COUNT and SUM(carpet_sqft) grouped by status); crossing the threshold emits consent.threshold_reached, dropping below emits consent.dropped_below.
 Decision D1 defaults: count by head-count; warn only. Make the basis and threshold editable per society; show the legal note "confirm the required majority with your advocate".
Roles: Owner VCEA; PM VCE; Accounts and Viewer V; others none. Phone numbers hidden from roles other than Owner and PM. Never store Aadhaar. Soft delete only; status changes are logged, never overwritten silently.
Notifications: consent.threshold_reached and consent.dropped_below to Owner + PM (in-app, email when Phase 11 is live).
Reports: consent % per society; pending/declined list for follow-up; CSV export (BOM).
Events: approvals/hooks.js subscribes to consent.threshold_reached and adds a note to the "Society consent" row (Appendix A star 5); redevelopment never imports approvals.
Create src/modules/redevelopment/ (api.js, service.js, hooks.js), public/modules/redevelopment/, the next migration, the registry entry and the one import line.
Add the new tables to the backup list. Staging first, then CHANGELOG + DATA_DICTIONARY.
3-click test: create a society with 10 test members; mark 5 consented (50%: not reached); mark a 6th (60%: reached, Owner notified, approvals row note appears);
 a Sales user cannot open the module; the consent log shows every change.
```

**WP-2 Rehab/PAP allotment, transit rent, corpus ledger** | Goal: track rehab flat allotment per member, transit rent payments and corpus. Depends: WP-1; `sal_inventory` exists (schema). Effort L. Risk: schedule generation must not exceed 50 queries (generate month rows in small batches or lazily); money rows are reversed, never deleted; rent rules pending D5.
```text
Extend module "redevelopment" (guide §4.2, §10.3). Purpose: allot rehab flats to members, run the transit-rent schedule, bank guarantees and corpus, with reminders.
Migration (additive): ALTER TABLE sal_inventory ADD COLUMN category TEXT NOT NULL DEFAULT 'sale' (sale|rehab|other) with an index; the Sales booking flow must refuse rehab units
 (change only via sales/service.js, not raw SQL from this module).
 New tables: red_rehab_allotments(member_id UNIQUE, inventory_id, entitlement_sqft, allotted_on, status [proposed|allotted|possessed|cancelled]);
 red_transit_terms(member_id UNIQUE, monthly_rent_paise, start_date, end_date, deposit_paise, bg_ref, bg_amount_paise, bg_expiry, notes);
 red_transit_payments(member_id, period 'YYYY-MM', due_paise, paid_paise DEFAULT 0, paid_on, mode, ref_no, reversed_at, reversal_note);
 red_corpus_entries(member_id, label, amount_paise, due_on, paid_on, ref_no, reversed_at).
Screens (max 3): (1) Rehab: members with entitlement and allotted unit; (2) Transit rent: month grid per society with Paid/Due/Overdue chips, one-tap record payment; (3) Corpus and bank guarantees.
Workflow: set a transit term for a member; schedule rows are generated for the next 12 months in one batched insert and topped up by the hourly sweep (never more than ~40 queries per tick);
 record payments (cheque/NEFT/UPI/cash, reference); reversal needs a reason. Decision D5 defaults: monthly rent, cheque number recorded. Rent frequency and any rules are settings, not hard-coded.
Roles: Owner VCEA; Accounts VCE (payments); PM V; Site and Sales none.
Notifications: transit.rent_due (3 days before, assignee Accounts), transit.rent_overdue (Owner + Accounts), bg.expiring (reuse the approvals reminder pattern, 30 days before).
Reports: rent due this month; overdue rent; bank guarantees expiring within 60 days; corpus paid vs due per society; CSV export.
Respect module contract; staging first; update backup list, CHANGELOG, DATA_DICTIONARY.
3-click test: set a term for a test member; see 12 months scheduled; record month 1 paid; reverse it with a reason; a rehab unit cannot be booked from Sales; BG expiry 20 days out shows in the reminder list.
```

**WP-3 Society meetings and resolutions log** | Goal: record meetings and resolutions with documents. Depends: WP-1. Effort S. Risk: legal significance; this is a record, not legal advice.
```text
Extend module "redevelopment" (guide §10.3). Purpose: log society meetings and resolutions with the minutes file, so consent history has supporting documents.
Table (additive): red_meetings(society_id, kind [general_body|committee|other], held_on, agenda, attendees_count, resolution_text, resolution_passed INTEGER, minutes_document_id, next_action, next_action_due).
Screen (1): meetings list per society with a "+ New meeting" big button, upload minutes (Drive via documents), mark resolution passed, set next action with a due date.
Roles: Owner VCE; PM VCE; Viewer V. Notification: meeting.next_action_due (hourly sweep) to PM. Report: CSV of meetings and open actions.
Add UI note: "Record only. Confirm required procedures with your advocate." Do not invent legal requirements.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: add a meeting with a minutes PDF; set next action 2 days ahead; confirm the reminder reaches the PM.
```

### R2: Procurement + contractors + budgets

**WP-4 Procurement addendum: indents, multi-line RFQ, GRN lines and payments UI** | Goal: close procurement gaps (site raises indents; exact received quantities; partial payments). Depends: Guide Phase 8, S2 migration. Effort M. Risk: permission change for Site; GRN save must be one `db.batch()`; offline idempotency.
```text
Change request per guide §10 on module "procurement" (key procurement). Purpose: complete the request-to-payment chain.
1) Indents: tables pro_indents(project_id, indent_no from counters key 'ind:<project_id>', needed_by, status [draft|submitted|approved|rejected|converted], requested_by, client_uuid UNIQUE)
 and pro_indent_items(indent_id, description, qty, unit). Site Engineer may create indents (update permissions.js and the §4.5 matrix; Site still cannot see money). PM approves; Purchase converts an approved indent into an RFQ.
2) Multi-line RFQ: pro_rfq_items(rfq_id, description, qty, unit) additive; quotes keep one total per vendor plus optional per-line rates; comparison highlights lowest total.
3) GRN lines: the site GRN screen uses pro_grn_items (from S2) for per-PO-line received quantities; PO status part_received/received is computed from the sums inside the same db.batch(); offline with client_uuid.
4) Bills and payments: use pro_payments (S2) for partial payments, GST and TDS (rates are settings, confirm with CA); the vendor ledger shows exact balance payable; reversals instead of deletes; bill statuses received|approved|part_paid|paid|hold|cancelled.
Roles: update matrix: Site C indent + GRN; PM A indent; Purchase VCE RFQ/PO; Accounts VCE bills/payments. Notifications: indent.submitted (PM), indent.approved (Purchase), grn.received, bill.due.
Reports: pending indents; PO vs received; vendor ledger with partial payments.
Migration additive; staging first; backup list, CHANGELOG, DATA_DICTIONARY.
3-click test (offline for step 1): site raises an indent; PM approves; Purchase converts to RFQ; GRN records 90 of 100 bags (PO = part_received); Accounts pays a bill in two instalments (balance exact).
```

**WP-5 Contractors, work orders, RA bills, retention/advance ledger** | Goal: manage contractors and labour suppliers (labour is by contractors, so no payroll). Depends: WP-4. Effort L. Risk: tax rates (TDS/GST) are settings; approval limits; query cap on RA bill calculation; money maths in paise with tests.
```text
New module per guide §4.2/§10.3: "Contractors" (key contractors, prefix con_, requires: projects, procurement; enabledByDefault:false until I test).
Purpose: contractors and labour suppliers are paid on work orders and running-account (RA) bills with retention and advances; replaces labour attendance/payroll (out of scope, guide §1).
Screens (max 3): (1) Contractors list/detail (trade, PAN restricted, GSTIN, agreement document, active); (2) Work orders: detail with items, RA bills, status chips, "+ New RA bill";
 (3) Contractor ledger (advance given/recovered, retention held/released, payments, balance).
Fields: con_contractors(vendor_id REFERENCES pro_vendors [use procurement/service.js, no raw SQL], trade, pan_enc, gstin, agreement_document_id, active);
 con_work_orders(project_id, contractor_id, wo_no from counters 'wo:<project_id>', scope, basis [lump_sum|item_rate|measured], value_paise, retention_bp, advance_paise,
 status [draft|pending_approval|approved|rejected|closed|cancelled], approved_by, approved_at); con_wo_items(wo_id, description, qty, unit, rate_paise, amount_paise);
 con_ra_bills(wo_id, ra_no, period_from, period_to, gross_paise, retention_paise, advance_recovery_paise, other_deductions_paise, gst_paise, tds_bp, tds_paise, net_paise,
 status [draft|checked|approved|part_paid|paid|cancelled], approved_by); con_ra_lines(ra_id, wo_item_id, qty_this_bill, rate_paise, amount_paise);
 con_payments(ra_id, amount_paise, paid_on, mode, ref_no, reversed_at, reversal_note); con_ledger (append-only: contractor_id, project_id, kind [advance|advance_recovery|retention_held|retention_released|payment], amount_paise, ref_table, ref_id, created_at).
Workflow: create contractor (or pick an existing vendor) -> work order (maker-checker: creator cannot approve; PM up to setting con.pm_approval_limit_paise, Owner above) -> advance entry -> RA bill with measured lines
 (cumulative qty must not exceed the work-order quantity without a warning) -> checked by PM -> approved -> paid in parts -> retention released at closure. All maths in integers; rates for GST/TDS are settings (D4: both bases supported; retention per work order).
Roles: Purchase VCE work orders; PM VCEA; Accounts VCE payments; Owner all; Site V (own project, no money columns); Viewer V.
Notifications: wo.pending_approval, ra.pending_approval, ra.due (hourly sweep). Print: work order and RA bill on the letterhead via public/print/print.js with DRAFT watermark until approved.
Reports: contractor ledger; WO value vs billed vs paid; retention held; advances outstanding; CSV.
Events: emit wo.approved and ra.approved (budget and Tally modules subscribe later).
Create src/modules/contractors/, public/modules/contractors/, migration, registry entry, import line; backup list; staging first; CHANGELOG, DATA_DICTIONARY.
3-click test: WO Rs 10,00,000 with 5% retention and Rs 1,00,000 advance; RA bill 1 for Rs 2,00,000 shows retention Rs 10,000 and advance recovery as set; PM approves up to limit, a bigger RA routes to Owner;
 partial payment updates the ledger to the paisa; Site cannot open the money screens.
```

**WP-6 DPR labour by contractor** | Goal: DPR labour count comes from contractors, replacing attendance. Depends: WP-5, Phase 7. Effort S-M. Risk: offline payload; the 3-tap DPR must stay fast.
```text
Change request per guide §10 on module "site". Purpose: the daily report records labour per contractor and trade.
Additive: site_dpr_labour(dpr_id, contractor_id, trade, headcount, client_uuid UNIQUE). site_dprs.labour_count becomes the sum (keep the column for old rows).
UI: in the DPR form replace the single +/- stepper with a short list of the project's active contractors (from contractors/service.js listForProject; site never imports contractors) pre-filled from the last report,
 each with a +/- stepper; still 90 seconds and works offline (lines travel inside the DPR payload and sync once).
Report: monthly labour by contractor and trade (feeds RA bill checking); CSV. Notification: none new.
Permissions: Site VCE own project. Staging first; backup list, CHANGELOG, DATA_DICTIONARY.
3-click test (airplane mode): file a DPR with 2 contractors, reconnect, no duplicate; monthly report shows the totals; old DPRs still show their old count.
```

**WP-7 Budget heads and committed vs actual** | Goal: cost control. Depends: WP-4, WP-5. Effort M. Risk: GST treatment of budgets (setting; confirm with CA); aggregate queries across modules must go through service.js.
```text
New module per guide §4.2/§10.3: "Budget" (key budget, prefix bud_, requires: projects, procurement, contractors).
Purpose: budget by cost head per project with committed and actual amounts and variance.
Screens (max 3): (1) Budget heads per project (code, name, budget); (2) Variance table (budget, committed, billed, paid, balance, % used with words and colour); (3) Head detail (the POs and work orders behind it).
Fields: bud_heads(project_id, code, name, budget_paise, sort_order). Additive columns budget_head_id (nullable) on pro_po_items and con_work_orders, set at creation; tagging is optional but the PO/WO screens ask for it.
Workflow: set heads (Owner/PM); PO and WO creation picks a head; committed = approved POs + WOs; actual = bills and RA gross; a soft warning (not a block) shows when approving a PO that pushes a head over budget.
 Setting budget.gst_basis [exclusive|inclusive], default exclusive, note "confirm with your CA".
Data access only through procurement/service.js and contractors/service.js (committedByHead, actualByHead) using one aggregate query each; no raw SQL on their tables.
Roles: Owner VCEA; PM VCE; Accounts V; Purchase V; Site none. Notifications: budget.head_over (Owner + PM, once per head per week). Report: budget vs committed vs actual per project; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: set Steel budget Rs 50,00,000; approve POs worth Rs 52,00,000; warning shows and the variance row turns red with words.
```

**WP-8 Store/stock ledger** | Goal: stock on hand per site for developer-supplied materials. Depends: WP-4. Effort M. Risk: balance consistency (update in the same batch); SUM over many rows (use a balance table).
```text
New module per guide §4.2/§10.3: "Stores" (key stores, prefix stk_, requires: projects, procurement).
Purpose: know stock on hand per project and reduce theft/loss for materials we buy (Decision D4: contractor-supplied materials are not tracked).
Screens (max 3): (1) Stock on hand with low-stock chips; (2) Issue to work (site, offline: pick item, qty, where used); (3) Stock moves log (receipts, issues, transfers, adjustments).
Fields: stk_items(name, unit, category, active); stk_balance(project_id, item_id, qty REAL, reorder_level REAL, UNIQUE(project_id,item_id));
 stk_moves(project_id, item_id, kind [receipt|issue|transfer_out|transfer_in|adjust], qty, ref_table, ref_id, to_project_id, note, by_user, client_uuid UNIQUE, created_at);
 additive nullable stock_item_id on pro_po_items.
Workflow: a GRN line (event grn.received, subscribed in stores/hooks.js) creates a receipt move and updates stk_balance in the same db.batch(); issues and transfers do the same; adjustments need a reason and PM approval.
Roles: Site VCE issue/receipt; PM VCEA; Purchase V; Accounts V. Notifications: stock.low (hourly sweep, one batched query). Report: stock on hand; moves by item; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: GRN 100 bags -> stock 100; issue 30 offline -> 70; reorder level 80 triggers the low-stock notification.
```

**WP-9 Vendor and contractor document expiry** | Goal: remember party documents and expiry dates. Depends: WP-5. Effort S. Risk: none significant; no invented document types.
```text
Change request per guide §10 on modules procurement and contractors. Purpose: keep each vendor/contractor's documents and expiry dates (e.g. agreements, insurance, licences) and remind before expiry.
Additive: pro_party_docs(party_type [vendor|contractor], party_id, doc_type TEXT free text, valid_till, reminder_days DEFAULT 30, document_id). No predefined list of document types: I will type them.
UI: a "Documents" block on the vendor and contractor detail pages (upload to Drive via documents). Hourly sweep: one indexed query on valid_till; notification party.doc_expiring to PM + Purchase.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: add a document expiring in 20 days; reminder appears; replacing it re-arms.
```

**WP-10 Petty cash** | Goal: site petty cash with approval. Depends: Phase 4B. Effort S-M. Risk: cash handling controls; offline entry.
```text
New module per guide §4.2/§10.3: "Petty cash" (key petty, prefix pty_, requires: projects).
Purpose: a site petty-cash fund with expense entries, photo of the bill, and PM approval.
Screens (max 3): (1) My fund (balance, + Expense big button); (2) Entries for approval (PM); (3) Fund statement per project.
Fields: pty_funds(project_id, custodian_user_id, opening_paise, active); pty_entries(fund_id, entry_date, kind [expense|top_up|return], category TEXT, amount_paise, narration, document_id, status [submitted|approved|rejected|cancelled], approved_by, client_uuid UNIQUE).
Workflow: site engineer adds an expense with a photo (offline); PM approves; top-ups are entered by Accounts; balance = opening + top-ups - approved expenses; cancellations instead of deletes.
Roles: Site VC own fund; PM VCEA; Accounts VCE; Owner all. Notifications: petty.pending_approval (PM), petty.low_balance. Report: statement and category totals; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: offline expense with a photo syncs once; PM approves; balance drops; a rejected entry does not change the balance.
```

### R3: Sales completeness + collections + Tally

**WP-11 Number series, receipt controls, credit notes** | Goal: legal documents get sequential numbers; optional receipt approval; credit notes. Depends: Phase 9. Effort S-M. Risk: race-safe counters, financial-year rollover (April-March IST).
```text
Change request per guide §10 on module "sales". Purpose: sequential numbers on printed receipts and demand letters, optional maker-checker on receipts, credit notes and adjustments.
Additive: ALTER sal_receipts ADD receipt_no TEXT, status DEFAULT 'posted', approved_by, approved_at; ALTER sal_demands ADD demand_no TEXT;
 sal_adjustments(booking_id, demand_id, kind [credit_note|debit_note|adjustment], amount_paise, gst_paise, reason, approved_by, reversed_at, created_by).
Numbers from the counters table with keys like 'rcpt:<project>:<FY>' and 'dem:<project>:<FY>' (FY = April-March in IST), taken inside the same db.batch() as the insert; never reused, even if cancelled.
Setting sales.receipt_approval_limit_paise (default off): receipts above it are created as pending and count toward settled_paise only after approval by PM/Owner; creator cannot approve.
Adjustments reduce the demand's balance and are approved by Owner/PM; reversal instead of delete. Print views (receipt, demand) show the number on the letterhead.
Roles: Accounts VCE; PM A; Owner all. Notifications: receipt.pending_approval. Report: numbering gaps check and adjustments list; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: two simultaneous receipts get different numbers; a pending receipt does not settle a demand until approved; a credit note lowers the balance to the paisa.
```

**WP-12 Hold ownership and co-applicants** | Goal: know who holds a unit and for whom; multiple applicants. Depends: Phase 9. Effort S. Risk: hold expiry job within the 50-query cap.
```text
Change request per guide §10 on module "sales". Purpose: make the 48-hour block show who blocked and for which lead, and support co-applicants.
Additive: ALTER sal_inventory ADD blocked_by INTEGER, blocked_lead_id INTEGER, blocked_at TEXT; sal_booking_parties(booking_id, name, phone, relation, share_bp, pan_enc restricted, aadhaar_masked).
UI: the flat card says "Blocked by Priya for Mr Kulkarni until 12:30"; extend or release; one hold per salesperson cap is a setting (default off).
Hourly sweep: release expired holds with ONE set-based UPDATE, then batch the notifications (hold.expiring 1 hour before, hold.released); never more than ~40 queries per run.
PAN/Aadhaar rules as in guide §4.5 (Owner, Accounts and the booking's own Sales user only). Staging first; backup list, CHANGELOG, DATA_DICTIONARY.
3-click test: block a flat for a lead, see the owner on the card, wait or force expiry on staging and see it auto-release with a notification; add a co-applicant to a booking.
```

**WP-13 Cost sheet and discount approvals** | Goal: structured cost sheet per unit with approval bands. Depends: WP-12. Effort M. Risk: money maths; tax/stamp-duty rates must be editable inputs.
```text
Change request per guide §10 on module "sales". Purpose: replace the typed agreed price with a cost sheet (base, floor rise, PLC, parking, other charges, discount, GST, stamp duty/registration) with discount approval bands.
Additive: sal_cost_sheets(unit_id, lead_id, booking_id nullable, version, area_basis [rera_carpet|carpet], base_rate_paise_per_sqft, agreement_value_paise, gst_bp, gst_paise, stamp_duty_bp, registration_paise, total_paise,
 status [draft|pending_approval|approved|superseded], approved_by, approved_at); sal_cost_sheet_lines(sheet_id, label, kind [addition|discount], amount_paise).
Rates are inputs per sheet, defaulting from settings, with the note "confirm rates with your CA"; nothing hard-coded. Discount approval: settings sales.discount_pm_limit_paise; creator cannot approve; PM up to the limit, Owner above (reuse the PO limit pattern).
Booking flow pulls an approved sheet into agreed_price_paise; new version supersedes the old (one live version per unit/lead). Print on letterhead (DRAFT watermark until approved); share by Save-as-PDF and the existing share-link route.
Roles: Sales VCE own leads; PM A; Owner A; Accounts V. Notification: sheet.pending_approval. Report: discounts given by person and project; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: sheet with Rs 3,00,000 discount routes to Owner above the PM limit; approved sheet fills the booking price paise-exact; a new version supersedes the old.
```

**WP-14 Handover, possession and registration checklist** | Goal: finish the flow after agreement. Depends: Phase 9, Phase 7. Effort M. Risk: the checklist template is an editable starter, not a legal list.
```text
Change request per guide §10 on module "sales". Purpose: track registration, loan details, possession and handover per unit, with unit-level snags.
Additive: sal_handover(booking_id UNIQUE, status [not_started|in_progress|handed_over], possession_offered_on, possession_given_on, oc_reference, notes);
 sal_handover_items(handover_id, label, done, done_on, note, document_id); sal_booking_loans(booking_id, bank, sanction_paise, sanction_date, disbursed_paise, notes);
 ALTER site_snags ADD unit_id INTEGER (nullable) so snags can link to a unit; sal_inventory.status gains the documented value 'possessed'.
Checklist template in settings sales.handover_template: ship a short STARTER list (e.g. dues cleared, snag inspection, keys handed over) marked "starter list: edit to match your process; confirm with your advocate"; do not claim it is legally complete.
Workflow: after agreement, open handover; tick items with documents; snags raised on the unit must be fixed/verified before handed_over (warning, not a block); marking handed_over sets the unit to possessed. Event handover.completed.
Roles: Sales VCE; Accounts V; PM VCEA; Site C snags. Notifications: handover.due. Report: pending handovers; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: open handover on a test booking, tick items, raise and verify a unit snag, mark handed over; the grid shows the unit as possessed.
```

**WP-15 RERA 70% designated-account tracker** | Goal: track the designated account against receipts (guide has only a reminder row). Depends: Phase 9, WP-4. Effort M. Risk: legal percentages and certification rules: settings and "confirm with CA/advocate".
```text
Change request per guide §10 (new small table group inside module "approvals" or its own module "rera", your choice, justified in one line). Purpose: track amounts realised vs deposits to the project's RERA designated account and withdrawals vs cost incurred.
Setting rera.designated_pct_bp default 7000 with the note "confirm the current MahaRERA rule with your CA"; never assert the rule in the UI as law.
Additive: rera_account_entries(project_id, entry_date, kind [deposit|withdrawal], amount_paise, ref_no, source_table, source_id, note, reversed_at).
Workflow: sales receipts raise the "required deposit" (receipt x pct) through the existing receipt event; Accounts records deposits and withdrawals; the screen shows required vs deposited vs withdrawn and the gap; a quarterly reminder links to the existing Appendix A row 23. No bank integration.
Roles: Accounts VCE; PM V; Owner all; Viewer V. Notification: rera.deposit_gap (weekly, Owner + Accounts). Report: statement per project; CSV for the CA.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: record Rs 10,00,000 of receipts; required deposit shows 70% (default); record a deposit and see the gap shrink.
```

**WP-19 Site-visit structured feedback and geotag** | Goal: richer visit data. Depends: Phase 9. Effort S. Risk: staff location is personal data (consent note, privacy page); do not block on location.
```text
Change request per guide §10 on module "sales". Purpose: structured visit feedback and an optional location tag.
Additive: ALTER sal_visits ADD interest [hot|warm|cold], objection TEXT, next_step TEXT, checked_in_at TEXT, lat REAL, lng REAL, accuracy_m REAL; ALTER projects ADD lat REAL, lng REAL (nullable, set by PM).
UI: after marking a visit done, 3 big choices (interest, objection from a short editable list in settings, next step) and an optional "Check in here" button using the browser geolocation (asks permission; never blocks); if the location is more than the radius setting (default 200 m) from the project, show a soft warning and still save.
Report: visit-to-booking conversion by project, source and person; add to the funnel report; CSV. Add one line to the privacy page: staff location is stored only at check-in.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: complete a visit with feedback and a check-in; funnel shows visit-to-booking percentage.
```

**WP-16 Bulk demand letters** | Goal: send many demand letters without one manual PDF each. Depends: Phase 11, Phase 9, WP-11. Effort M. Risk: no PDF library allowed by the guide; CPU cap; email quota. Claude Code must STOP and ask before adding any library.
```text
Change request per guide §10 on module "sales". Purpose: when a milestone makes many demands Ready, review and send them in bulk.
First evaluate and report (do not build yet) the zero-library options for the free plan: (a) one multi-page print sheet (one letter per page, page breaks) the user saves as one PDF; (b) bulk email with the letter as HTML in the body plus an expiring share link to the saved document; (c) a tiny text-only PDF writer in the browser. Recommend one, list its limits, and STOP for my decision.
After my decision, build: a "Ready demands" bulk screen (select all, preview first letter, send), processed in chunks of up to ~20 per run through the email queue (§7.8), each with demand_no (WP-11), status updated to sent, failures listed with a retry button.
Never exceed the email provider's daily quota (setting) and never hold PDFs in Worker memory. Roles: Sales and Accounts. Report: sent/failed list; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: 25 Ready demands on staging are sent in chunks, 1 forced failure is retried, statuses are right.
```

**WP-18 Bank-statement CSV import and matching** | Goal: match bank credits to demands. Depends: WP-11. Effort M. Risk: bank formats vary; personal data in narrations; parse in the browser.
```text
Change request per guide §10 on module "sales". Purpose: reduce manual receipt entry by matching bank-statement credits to open demands.
Additive: bank_import_batches(filename, uploaded_by, row_count, created_at); bank_import_rows(batch_id, txn_date, narration, credit_paise, reference, matched_demand_id, matched_receipt_id, status [unmatched|suggested|confirmed|ignored]).
The browser parses the CSV (mapping screen per bank: choose date/narration/credit/reference columns, saved as a profile); at most 500 rows per import, uploaded in pages; the server only matches rows to demands by amount and reference/customer-name hints and returns suggestions.
Accounts confirms each suggestion, which creates a normal receipt (respecting WP-11 approval). Do not store bank account numbers; keep narration text only as long as needed (setting: delete unmatched rows after 90 days).
Roles: Accounts VCE; Owner V. Report: unmatched credits list; CSV.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: import a 20-row sample, confirm 3 matches into receipts, ignore the rest, and confirm no duplicate receipts if the same file is imported twice.
```

**WP-17 Tally voucher export (XML)** | Goal: voucher files the accountant can import into Tally (export only, no accounting). Depends: Phase 12 CSV exporter, WP-4, WP-5, WP-11; D6 sample. Effort M. Risk: format fidelity (test with the accountant's Tally); CPU (generate in the browser).
```text
Change request per guide §10 (guide §1.1 roadmap row "Accounting export / Tally XML"; no accounting module). Purpose: export vouchers as Tally-importable XML, keeping the existing CSVs.
Before building, ask me for a sample voucher file my accountant imports and the ledger names (Decision D6); if not supplied, build the mapping screen and the generator against Tally's standard import format and mark it UNTESTED.
Additive: tally_export_log(kind, from_date, to_date, voucher_count, exported_by, created_at) and a settings key tally.ledger_map (JSON editable in Settings: party-to-ledger rules, bank, GST, TDS, income and expense ledgers, retention and advance ledgers).
Voucher kinds: receipt vouchers (sal_receipts), payment vouchers (pro_payments, con_payments, petty cash if enabled), purchase/bill vouchers (pro_bills, con_ra_bills), credit notes (sal_adjustments).
The Worker returns paged JSON (25-100 rows per page); the BROWSER builds the XML and downloads it; the screen lists vouchers with unmapped ledgers before export and refuses to export those. Dates in IST; amounts converted from paise exactly.
Roles: Accounts VCEX; Viewer (CA) X; Owner all. Report: export log. Staging first; backup list, CHANGELOG, DATA_DICTIONARY.
3-click test: export a month of test vouchers; the file imports into the accountant's Tally (or is flagged UNTESTED); totals match the CSV register to the paisa.
```

### R4: Dashboards, mobile, polish

**WP-20 Dashboard extras and targeted reports** | Goal: surface the new data without breaking the "6 tiles" rule. Depends: R1-R3. Effort S-M. Risk: dashboard query count (stay under ~40; use aggregates or a cached snapshot row refreshed by the hourly sweep if measurements exceed the cap).
```text
Change request per guide §10 on core reports/dashboard (guide §7.9). Purpose: add the new data to the existing 6 tiles as drill-down lines, not new tiles.
Add lines: Approvals tile: consent % per society, bank guarantees expiring; Money out: contractor RA bills awaiting approval, retention held, budget heads over limit; Money in: transit rent overdue (if enabled), receipts pending approval, RERA deposit gap; Site: low stock items, pending indents; Sales: pending handovers, visit-to-booking.
New reports (all CSV with BOM): contractor ledger, WO value vs billed vs paid, budget vs committed vs actual, stock on hand, collections by month, discount register, consent report, transit rent due.
Each tile must stay at or below ~8 aggregate queries; measure and report. If over, add a dash_snapshot table refreshed by the hourly sweep and say so. Modules that are OFF contribute nothing (no errors).
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: with all modules on, the dashboard loads under the measured budget and every line opens its list; with Redevelopment off it disappears cleanly.
```

**WP-21 Offline queues and Hindi/Marathi for the new screens** | Goal: site-facing screens work offline and speak the site team's language. Depends: R2-R3 modules. Effort M. Risk: duplicate records on retry; stale service-worker cache.
```text
Change request per guide §10, §6.3-6.5. Purpose: make the new site-facing screens offline-capable and translated.
Screens: indent create, stock issue, petty-cash expense, DPR labour lines (WP-6), consent status taps (optional, behind a setting), handover checklist ticks.
Use the existing IndexedDB queue and client_uuid idempotency (add client_uuid to any table that lacks it via additive migration); show the pending-sync badge; keep photos compressed.
Add hi and mr dictionaries for all labels on those screens and the new home-screen buttons; bump the service-worker cache name (nirmaan-shell-v<N>) and keep the "New version ready" toast.
Staging first; CHANGELOG, DATA_DICTIONARY. 3-click test (airplane mode): create an indent, a stock issue and a petty-cash expense, reconnect, confirm exactly one record each; switch to Marathi and see the labels.
```

**WP-22 Drawing acknowledgement** | Goal: prove site has seen the latest drawing. Depends: Phase 6. Effort S. Risk: reminder volume.
```text
Change request per guide §10 on module "drawings". Purpose: site confirms they have seen each newly issued IFC revision.
Additive: drw_acks(revision_id, user_id, acked_at, UNIQUE(revision_id,user_id)). UI: a big "I have seen R3" button on the drawing for site users; PM sees who has not acknowledged each new revision.
Hourly sweep: for revisions older than 24 hours with missing acks from project-assigned site users, one batched notification to the PM and the user (drawing.ack_pending); at most once per revision per day.
Staging first; backup list, CHANGELOG, DATA_DICTIONARY. 3-click test: issue R2; the site user taps seen; PM sees the acknowledgement; a user who does not tap triggers the reminder after the time limit on staging.
```

**WP-23 Hardening, performance and restore drill for all additions** | Goal: prove the additions are safe and fit the free plan, then run guide Phase 13. Depends: all above. Effort M. Risk: discovering a CPU/query cap breach late; backups missing new tables.
```text
Final pass per guide §9, §11 and Phase 13, covering every package added after the guide's own phases.
1) Permissions: a test per new route and role (allowed and refused), project-assignment limits, field-level hiding (PAN, Aadhaar masked, member phone, PAN of contractors), X-NirmaanCRM header, no cross-module raw SQL (grep and report).
2) Performance: for every new route, cron step and the dashboard, report measured Worker CPU ms and D1 query count; list anything above 8 ms CPU or 40 queries; fix by batching, indexes (EXPLAIN QUERY PLAN) or splitting work across hourly ticks.
3) Backups: confirm every new table is in the nightly backup and Export-everything; run the restore drill into staging and compare row counts for ALL tables; confirm no secret, token or Aadhaar appears in logs, audit text, API output or exports.
4) Data: money-maths tests (paise exactness, rounding, FY rollover for numbering), reversal-not-delete checks, idempotent offline retries.
5) Docs: update docs/OPERATIONS.md (new troubleshooting rows), DATA_DICTIONARY, CHANGELOG, role cheat sheets (Appendix D) for new modules; produce the UAT script for the new flows.
Then run the guide's Phase 13 checklist. Report in a table: item, result, evidence. Do not deploy to production until I confirm.
```

### R5: Optional / later

**WP-24 Lead capture form (and portal-email parsing if feasible)** | Goal: capture leads without typing. Depends: Phase 9. Effort M. Risk: public endpoint abuse, CORS (guide §3.3 has none), DPDP consent, portal email formats unverified.
```text
Change request per guide §10 on module "sales". Purpose: capture website enquiries and, if feasible, portal enquiry emails as leads, within the free tier.
Part 1 (build): a hosted public page /enquiry.html (static) posting to a public endpoint /api/public/enquiry: Cloudflare Turnstile verification (secret as a Worker secret), mandatory DPDP consent tick (stores consent_at), rate limit via rate_limits, phone normalised to +91, duplicate-phone merge, source 'website', optional project from the URL. Provide an iframe/embed snippet for my other sites instead of cross-origin CORS. No data other than the form fields is stored.
Part 2 (investigate first, report, then STOP for my go-ahead): whether Cloudflare Email Routing with an Email Worker is free for this use and how to parse enquiry emails from 99acres/MagicBricks/Housing; I will supply sample emails; do not guess formats.
Roles: public (Part 1); Sales/Owner receive lead.assigned notifications. Staging first; backup list, CHANGELOG, DATA_DICTIONARY.
3-click test: submit the form on staging (consent ticked) and see a lead with source 'website', assigned round-robin; a repeat phone merges; a bot without a Turnstile token is refused.
```

**WP-25 Buyer statement through a share link** | Goal: give a customer a statement without a login. Depends: Phase 12, WP-11. Effort M. Risk: rule 15 (no customer login), exposing money data; start with a snapshot document.
```text
Change request per guide §7.10 and §2 rule 15. Purpose: let Accounts send a customer their statement (demands, receipts, balance) through an expiring, revocable link, with no login.
Build the SNAPSHOT approach first: Accounts opens the booking, "Customer statement" produces a printable statement on the letterhead (print.js); Save as PDF; upload it as a customer-shareable document and share it with the existing share-link flow (default expiry 14 days). No new link type, no live data exposed.
Report to me, before any further build, whether a live statement page under /s/<token> is worth the extra security surface (it would need a new link kind that reveals one booking's ledger only); do not build it without my approval.
Roles: Accounts and Owner create; Sales cannot. Staging first; CHANGELOG, DATA_DICTIONARY. 3-click test: send a statement link to a test phone, open it without a login, revoke it, and see it say it has expired.
```

---

## 5. Recommended working routine
1. **One work package per session.** Open Claude Code in the repo; it reads CLAUDE.md automatically. Paste only one prompt.
2. **Branch per package:** `git checkout -b feature/wp-<n>-<name>` (GitHub Desktop: Current Branch, New Branch).
3. **Before migrations:** Claude Code runs `npx wrangler d1 export nirmaan-db --remote --output=pre-change.sql` and keeps the file outside git.
4. **Staging first:** deploy with `npx wrangler deploy --env staging`, apply migrations to the staging database, run the package's acceptance test (the "3-click test") on your phone.
5. **Check the report:** Claude Code states measured CPU ms and D1 query counts; anything near 10 ms CPU or 50 queries means redesign before production.
6. **Production:** only after you confirm. Apply migrations, deploy, repeat the 3-click test once on production, then merge the branch and tag it (`wp-<n>-done`).
7. **Commit message style:** "WP-n done: <name>". Keep docs/CHANGELOG.md and docs/DATA_DICTIONARY.md current.
8. **Session limit or new chat (guide Appendix E):** paste this resume prompt, adapted:
```text
Continue NirmaanCRM per CLAUDE.md and docs/THIS_GUIDE.md (v1.3). Read docs/STATE.md, docs/CHANGELOG.md and docs/DATA_DICTIONARY.md first.
Current package: WP-[n] ([name]); branch feature/wp-[n]-[name]; status: [not started / migration written, not applied / on staging, test pending / bug: ...].
Storage mode: G; Google Drive connected: [yes/no/needs reconnect]. Latest migration number: [00NN]. Do not redo completed packages. Resume exactly from: [next step].
```
9. **Weekly:** Reconnect Google Drive while the app is in Testing mode (D3); check the nightly backup shows OK; download the monthly Export-everything ZIP to your laptop.
10. **If anything in the plan conflicts with the guide,** Claude Code must stop and ask rather than choose.

### Progress checklist
| ID | Package | Release | Branch done | Staging test passed | Production deployed | Date |
|---|---|---|---|---|---|---|
| S0 | Reconcile, STATE.md | R1 | ☐ | n/a | n/a | |
| S1 | CLAUDE.md | R1 | ☐ | n/a | n/a | |
| S2 | Guide patch + migration | R1 | ☐ | ☐ | ☐ | |
| Ph 4B/5 | Branding, approvals (guide) | R1 | ☐ | ☐ | ☐ | |
| WP-1 | Society/member registry + consent | R1 | ☐ | ☐ | ☐ | |
| WP-2 | Rehab, transit rent, corpus | R1 | ☐ | ☐ | ☐ | |
| WP-3 | Meetings log | R1 | ☐ | ☐ | ☐ | |
| Ph 6, 7 | Drawings, site (guide) | R1 | ☐ | ☐ | ☐ | |
| Ph 8 | Procurement (guide) | R2 | ☐ | ☐ | ☐ | |
| WP-4 | Procurement addendum | R2 | ☐ | ☐ | ☐ | |
| WP-5 | Contractors, WO, RA bills | R2 | ☐ | ☐ | ☐ | |
| WP-6 | DPR labour by contractor | R2 | ☐ | ☐ | ☐ | |
| WP-7 | Budget heads | R2 | ☐ | ☐ | ☐ | |
| WP-8 | Stock ledger | R2 | ☐ | ☐ | ☐ | |
| WP-9 | Party document expiry | R2 | ☐ | ☐ | ☐ | |
| WP-10 | Petty cash | R2 | ☐ | ☐ | ☐ | |
| Ph 9 | Sales (guide) | R3 | ☐ | ☐ | ☐ | |
| WP-11 | Number series, receipt controls | R3 | ☐ | ☐ | ☐ | |
| WP-12 | Hold owner, co-applicants | R3 | ☐ | ☐ | ☐ | |
| WP-13 | Cost sheet, discount approvals | R3 | ☐ | ☐ | ☐ | |
| WP-14 | Handover checklist | R3 | ☐ | ☐ | ☐ | |
| WP-15 | RERA 70% tracker | R3 | ☐ | ☐ | ☐ | |
| WP-19 | Visit feedback, geotag | R3 | ☐ | ☐ | ☐ | |
| Ph 10, 11 | People (optional), Email (guide) | R3 | ☐ | ☐ | ☐ | |
| WP-16 | Bulk demand letters | R3 | ☐ | ☐ | ☐ | |
| WP-18 | Bank CSV matching | R3 | ☐ | ☐ | ☐ | |
| Ph 12 | Dashboard, reports (guide) | R3 | ☐ | ☐ | ☐ | |
| WP-17 | Tally XML export | R3 | ☐ | ☐ | ☐ | |
| WP-20 | Dashboard extras, reports | R4 | ☐ | ☐ | ☐ | |
| WP-21 | Offline + Hindi/Marathi | R4 | ☐ | ☐ | ☐ | |
| WP-22 | Drawing acknowledgement | R4 | ☐ | ☐ | ☐ | |
| WP-23 | Hardening + Ph 13 | R4 | ☐ | ☐ | ☐ | |
| WP-24 | Lead capture form | R5 | ☐ | ☐ | ☐ | |
| WP-25 | Buyer statement link | R5 | ☐ | ☐ | ☐ | |
