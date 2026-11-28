# Nirmaan CRM — Process Workflow Review

Date: 28 November 2026
Branch: `Dhaval`
Scope: how work moves end to end, where it stalls, and what to change. This is not a feature-parity list.

Basis: code and migrations at `2d86e8d`, `docs/STATE.md`, `docs/M2_GAPS.md` to `docs/M5_GAPS.md`, and the route/menu code.

## 1. Summary

The CRM already has unusually strong controls for a small developer: RERA and CC-floor gates, the 10% AFS stop, maker-checker on money, the Owner approval PIN, retention held against snags, GST and TDS holds, an append-only audit trail, and offline site entry. Those should not be rewritten.

The remaining weakness is orchestration. People can find the data, but the system does not reliably tell each person what to do next, how long it has waited, or who owns the handoff. The five changes that matter most:

1. A role-based **My Work** home instead of a project chooser followed by a module menu.
2. **One work queue** for every approval and exception, not six object types.
3. **Age and escalation** on every queue, using the existing cron slots.
4. **Handoff checklists** at booking, procurement, contractor billing, and possession.
5. **Process KPIs** (cycle time and SLA), not only financial reports.

## 2. Current end-to-end flow

| Stage | Trigger | What the system does now | Gate or output |
|---|---|---|---|
| Business development | A society or plot is identified | Opportunity moves Identified → Follow-ups → Feasibility → 79A → DA signed → DA registered; follow-ups, studies and papers are stored | DA registered before "Open as project" |
| Project start | Project opened | A redevelopment project needs the society's appointment letter; a land project needs the registered sale deed; modules 2–5 stay locked until then | `start_basis` gate; Owner/PM records the paper |
| Land and approvals | Project started | Approval checklist with dependencies, sub-steps, file movement, target dates, expiry alerts; redevelopment consent, PAAA, vacating, transit rent; site readiness score | Approval must be approved with letter number/date; dependent steps block |
| Pre-sales | Lead arrives from webhook, website form, CSV, or walk-in | Round-robin, 15-minute SLA reassignment, calls/visits, reception QR and broker source lock, inventory and stacking plan, price matrix and MSP, cost sheet, token hold with proof | Booking needs a priced cost sheet; below MSP needs Owner PIN; AFS gates demands past 10% |
| Site and quality | Work starts | Drawings issued for construction with acknowledgement, DPR with labour/photos/offline, snags, pour cards, cube tests, NCRs, milestones | Site marks "ready"; PM certifies with certificate; only certification releases demands |
| Procurement | Material needed | Indent → approval → RFQ → quotes → selected quote → PO → approval → GRN with challan/photo/truck/weight → vendor bill with GST/TDS → part payments → Tally | PO maker-checker; GRN photo gate; bill held beyond received quantity or without gate photo |
| Contractors | Work order agreed | WO → approval → variations → joint measurements → RA bill → check → approve → payments; advance recovery, retention, debit notes, GST hold | Checker cannot approve; billing capped by WO + variations + measurements; retention held 60 months and while snags are open |
| Collections | Milestone certified | Demand schedule → demand letter/email/WhatsApp → receipt (maker-checker) → bank import matching → buyer TDS verification → interest and waiver → RERA 70/30 deposits and withdrawals → Tally | Receipt needs a second person; TDS held until Form 26QB verified; RERA withdrawal needs three certificates |
| Possession | Flat ready | Snags → joint inspection link → six-point no-dues → possession notice → certificate and key receipt → fit-out NOC → DLP tickets and back-charges → society formation and CHS vault | No-dues strict mode; OC required; vault complete before project Completed |
| Cross-cutting | Every request | Project membership gate, role matrix, audit log, notifications, derived tasks, approval PIN | Non-owner sees only assigned projects; every write audited |

## 3. What is already strong

- Hard stops are real, not warnings: RERA number, CC floor, AFS 10%, OC, no-dues, retention, GST/TDS.
- Maker-checker is applied to money and to high-risk actions; the checker cannot approve their own work.
- Project scoping and the project start gate are enforced on the server, not only in the menu.
- Field work works offline and is idempotent.
- Every write is audited; backup, restore and restore-drill exist.
- Decisions and open questions are documented per module.

## 4. Friction points

### P1 — fix first

**4.1 There is no role-based "My Work" landing page.**
After login a person sees project cards and company groups (`public/pages33.js`). The project home shows module cards, not pending work. The Tasks page aggregates only approvals, approval steps, milestones, snags, meeting next actions and NCRs (`src/routes/projectplus.js`).

The dashboard does have a few exception lines, but they are gated by role (`src/routes/dash_extras.js`): receipts waiting for a second person and the RERA deposit gap are built only for owner, PM and accounts; indents and low stock for owner, PM, purchase and accounts; handovers and visit conversion for owner, PM and accounts. A site user or a sales user sees no work lines of their own. HR has no work queue at all.

**4.2 Handoffs are notification-only.**
Examples: booking to KYC/AFS/registration/loan, stage certified to demand dispatch, GRN to vendor bill, RA bill approved to GST confirmation, possession to fit-out NOC and society formation. Notifications tell someone something happened; they do not create an owned next step with a due date. Work can sit until someone remembers.

**4.3 No aging or escalation.**
Due dates exist in places (approval target dates, snag due dates, RA due dates), but there is no age bucket, no oldest-first queue, no escalation owner, and no weekly bottleneck report. The 08:00 digest goes to Owners only, is a per-project summary (missing DPR, approvals expiring, high snags, POs waiting, overdue demands), and carries no age or oldest-first list.

**4.4 No single approval or exception inbox.**
Each decision lives on its own screen: purchase orders, work orders, variations, measurements, RA bills, debit notes, receipts, interest waivers, petty cash, token clearance, RERA certificates. Held items are also scattered: bill beyond GRN, missing gate photo, over-BOQ, GST hold, TDS pending, no-dues red. A manager has to visit many screens to clear the day.

**4.5 Procurement quote control is optional.**
An indent can become an RFQ and an RFQ can award a quote, but a PO can be created without either (`pro_pos.rfq_id` is optional). There is no "three quotes above ₹X" rule, no single-source reason, and no vendor scorecard. `pro_vendors.rating` exists but is a free number, not a measured score.

### P2 — next

**4.6 Contractor and vendor compliance is thin.**
`con_contractors` stores name, phone, trade, PAN, GSTIN and one agreement document. It does not store labour/BOCW licence, PF/ESIC registration, workmen compensation insurance, agreement validity, or safety induction. There are no expiry alerts and no block on a new work order or payment when compliance has lapsed.

**4.7 The party master is fragmented.**
Vendors (`pro_vendors`), contractors (`con_contractors`), professionals, and channel partners are separate. A contractor has an optional `vendor_id`, but nothing prevents the same firm being entered twice with different GSTIN spellings or phone numbers. Split ledgers mean missed dues and duplicate KYC.

**4.8 There is no booking file checklist or buyer 360.**
KYC, cost sheet, token proof, booking form, AFS draft, registered AFS + Index-II, loan, parking, and possession documents live on different screens. There is a handover checklist and a member document checklist, but no per-booking checklist with an owner and status.

**4.9 Document expiry is scattered.**
Approvals have `valid_till`, bank guarantees have expiry, broker RERA has expiry. Contractor licences, insurance, vendor agreements, project RERA expiry, and CHS warranties do not have a unified calendar or alert.

**4.10 No delegation or out-of-office.**
Maker-checker and the Owner PIN are person-specific. If the Owner or a PM is away, the process stops. There is no audited "act for" rule.

**4.11 No process KPI report.**
Financial and operational reports exist (aging, cash flow, funnel, marketing ROI). There is no report for lead response time, booking-to-AFS time, stage-to-cash time, indent-to-payment time, RA cycle time, snag closure time, or approval turnaround. Without these, bottlenecks are invisible.

### P3 — later

- Task assignment is restricted: site and viewer can only reassign snags; PMs assign the rest.
- No one-tap approval from a notification; the user must open the screen.
- Master data is largely free text; GSTIN and PAN are not mandatory or unique where present.
- The project home shows modules, not project health or next actions.

## 5. Proposed changes

### A. My Work home (P1)

Add a role-specific worklist at the top of Welcome and on the project home.

| Role | What the page shows first |
|---|---|
| Owner | Approvals waiting, cash exceptions, overdue collections, budget overruns, projects waiting for start papers |
| PM | Approvals, POs, work orders, RA bills, indents, missing DPRs, milestones ready to certify, snags to verify, open NCRs |
| Site | Today's DPR, drawings not acknowledged, assigned snags, material requests, GRNs without photo, cube tests due |
| Sales | New leads, SLA breaches, follow-ups due, holds expiring, cost sheets, bookings missing AFS/KYC, demands ready |
| Accounts | Receipts waiting for a second person, unmatched bank rows, TDS to verify, bills to pay, GST confirmations, RERA deposits/withdrawals, Tally vouchers held back |
| Purchase | Indents, RFQs without quotes, POs pending approval, GRNs without photo, bills on hold, low stock |
| HR | Candidates and interviews due |

Each line shows the count, the oldest age, and a deep link. "Mine" is the default; managers can switch to "my team" or "all projects".

Build sketch: one read-only endpoint (`/api/my-work`) that returns groups of `{ label, count, oldest_days, route, project_id }`. Reuse the existing queries in `dash_extras.js` and `projectplus.js`. Keep it under the 50-statement free-plan cap by using one aggregate per group, not one per project.

### B. One work queue (P1)

Extend the Tasks page from six object types to every open item that has an owner or a due date. Add read-only unions for:

- Procurement: indents submitted, POs pending approval, GRNs without photo, bills on hold.
- Contractors: work orders pending approval, variations pending, measurements pending, RA bills draft/checked, debit notes pending.
- Collections: receipts waiting for a second person, token holds awaiting Accounts, bulk demand runs with failures, bookings missing AFS, TDS pending verification.
- Compliance: RERA certificates expiring, approval items expiring, bank guarantees expiring, broker KYC expiring.
- Possession: no-dues red, possession notices due, fit-out NOCs pending, DLP tickets open.
- Site: cube tests due, drawings not acknowledged, milestones ready to certify.

Add filters for project, type, mine, and age. Add "claim" and "snooze" only after the read-only queue is in use.

Recommendation: keep the queue derived at first. A `wf_tasks` table is justified only when manual tasks, delegation, or reminders are needed; a derived queue avoids a second source of truth.

### C. Aging and escalation (P1)

For every queue item, compute `days_waiting` from the earliest submitted/created date and bucket it: 0–2, 3–7, 8–15, 16+ days. Show the oldest first. Extend the existing 08:00 digest (today it goes to Owners only) with the oldest ten items, and add PMs as recipients. Add an escalation owner per type in Settings. No new cron trigger; all five free-plan slots are already used (`wrangler.toml`).

### D. Handoff checklists (P1/P2)

Make the next step explicit at the four handoffs that currently rely on memory:

1. **Booking file**: KYC, cost sheet, token proof, booking form, AFS draft, AFS registered + Index-II, loan application, parking, possession documents. Each item has an owner and a status; the booking shows a completion bar.
2. **Procurement**: indent → RFQ → selected quote → PO → GRN → bill → payment. Auto-create the next task when the previous step completes.
3. **Contractor billing**: WO → measurement → RA bill → GST confirmation → payment. Auto-create the GST confirmation task when the RA bill is approved.
4. **Possession**: no-dues → notice → certificate → fit-out NOC → society formation. Auto-create the next task when a point turns green.

Build sketch: a small `wf_templates` table (project type, stage, item, role, due days) and a `wf_tasks` table, or a JSON checklist on the parent record for the first version. The booking checklist can start as a JSON column to avoid a migration-heavy design.

### E. Procurement controls and vendor scorecard (P2)

- Above a setting threshold (`pro.quote_min_paise`, starting at ₹1,00,000), a PO must come from a selected quote with at least `pro.min_quotes` quotes (default 3), or carry a single-source reason approved by the Owner/PM and written to the audit log.
- Show the quote count and selected vendor on the PO.
- Add a read-only vendor scorecard: on-time delivery (PO delivery date vs GRN), quote win rate, bills held, NCRs linked to the vendor, and average payment days.
- Add an expediting queue: POs past their delivery date and partially received POs.

### F. Contractor and vendor compliance (P2)

Add to contractor onboarding: labour/BOCW licence number and expiry, PF and ESIC registration, workmen compensation policy number and expiry, agreement valid till, and safety induction date. Add the same expiry pattern to vendor agreements. Show a 30/15/7-day alert in the existing digest. Block a new work order or RA payment when a mandatory item is expired, with an Owner override and a written reason.

### G. Party master cleanup (P2)

- Add a unique index on normalised GSTIN and PAN where present.
- Warn on create when the name, phone, or GSTIN matches an existing party.
- Link contractor ↔ vendor, professional ↔ vendor, and broker ↔ party.
- Add one "party ledger" view across procurement bills, contractor bills, and brokerage.

This is a data migration, so run a duplicate report first and clean the data before adding constraints.

### H. Document expiry calendar (P2)

One read-only calendar over approvals, bank guarantees, broker RERA, contractor licences and insurance, vendor agreements, project RERA, and CHS warranties. Filter by project, type, and owner. Feed the 30/15/7-day alerts into the existing 08:00 digest.

### I. Process KPI report (P2)

Add a read-only "Process health" report and CSV:

- Lead created → first contact → visit → booking.
- Booking → AFS registered → first demand → first receipt.
- Milestone ready → certified → demand sent → receipt.
- Indent → approved → RFQ → PO → GRN → bill → payment.
- RA bill draft → checked → approved → paid.
- Snag open → fixed → verified.
- Approval applied → approved.

Show median, 90th percentile, and SLA compliance by project and by person. This is the report that tells you where the workflow is actually broken.

### J. Delegation and out-of-office (P3)

Add an audited `approval_delegates` table: from user, to user, module/type, start date, end date, reason. Delegated actions are recorded as "on behalf of". The Owner PIN should not be delegable; only non-PIN approvals should be.

### K. Buyer file and links (P3)

A booking 360 with a timeline and checklist. If buyer-facing links are allowed, use the existing expiring, revocable link pattern for KYC (PAN and address proof only, no Aadhaar image), payment schedule, receipts, AFS status, and possession steps. This needs a decision because the current rule is staff-entered KYC.

### L. Mobile approvals (P3)

A notification should open the exact item with one-tap approve/reject and a reason field. Keep the screen readable on a 390 px phone. Web push can come later; the in-app notification and WhatsApp link are enough for the first version.

## 6. Recommended sequence

**Phase 1 — 1 to 2 weeks, read-mostly, no new cron**
A (My Work), B (one queue), C (aging), project-home next actions. One small migration at most.

**Phase 2 — 3 to 4 weeks**
D (booking, procurement, contractor, possession checklists), E (quote control), F (contractor compliance), H (expiry calendar).

**Phase 3 — 4 to 6 weeks**
G (party master), I (process KPIs), J (delegation), K (buyer links), L (mobile approvals).

## 7. Decisions needed

1. Which roles see which My Work groups, and should managers see "my team" by default?
2. Is a derived work queue acceptable for Phase 1, or is a manual `wf_tasks` table wanted from day one?
3. What is the procurement quote threshold and minimum quote count? Who can approve a single-source purchase?
4. Which contractor compliance documents are mandatory before a work order or payment?
5. What are the booking checklist items, and who owns each one?
6. Can approvals be delegated? Which types, and can the Owner PIN ever be delegated?
7. Are buyer-facing KYC links allowed, or does KYC stay staff-entered?
8. What are the target cycle times for lead response, approval turnaround, RA cycle, and snag closure?

## 8. Phase 1 acceptance criteria

- Every role lands on a My Work page with counts, oldest age, and top five items.
- The work queue includes procurement, contractor, collection, compliance, possession, and site items, not only the current six.
- Age buckets and oldest-first sorting work on every group.
- The project home shows the next actions for that project, not only module cards.
- The Monday digest lists the oldest ten items to the Owner and PM.
- No new cron trigger; each request stays under 50 D1 statements.
- Tests cover each role, empty states, project scoping, and the 50-statement budget.
- No change to money calculations or existing approval rules.

## Appendix — task coverage today

| Source | In Tasks today | In My Work proposal |
|---|---|---|
| Approval items and steps | Yes | Yes |
| Milestones | Yes | Yes |
| Snags | Yes | Yes |
| Meeting next actions | Yes | Yes |
| NCRs | Yes | Yes |
| Indents | No | Yes |
| POs pending approval | No | Yes |
| GRNs without photo | No | Yes |
| Vendor bills on hold / to pay | No | Yes |
| Work orders, variations, measurements | No | Yes |
| RA bills draft/checked | No | Yes |
| Debit notes pending | No | Yes |
| Receipts waiting for second person | No | Yes |
| Token holds awaiting Accounts | No | Yes |
| TDS pending verification | No | Yes |
| RERA certificates and withdrawals | No | Yes |
| Approval/bank guarantee/broker RERA expiry | Partial alerts | Yes |
| No-dues red, possession, fit-out NOC | No | Yes |
| DLP tickets | No | Yes |
| Cube tests due, drawings not acknowledged | No | Yes |
