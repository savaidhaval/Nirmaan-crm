# Construction and procurement software in India vs NirmaanCRM, guide issues, and prioritised to-do list
Prepared 2026-11-22 for Dhaval Savai (MRI). Replaces the earlier version. Corrected against `NirmaanCRM_Claude_Build_Guide_v1.3.md` (all 2,022 lines read; § numbers refer to it).

## 0. Basis
- **Status labels:** In guide (spec'd) | In guide, partial | Built (schema only, from backup) | Not in guide | N/A. "Built (schema only)" = table exists in `nirmaan-backup-2026-11-22.json`; the tables are empty.
- **User answers applied:** labour is supplied by contractors (no direct labour/payroll); accounting need is Tally export only; redevelopment consent threshold is 51% (member-document list pending, not invented here).
- **Market evidence:** no authoritative market-share figure exists. Vendor claims and independent evidence are labelled (V / I).
- Guide-vs-backup differences are listed in the Sell.Do file (section 0) and not repeated.

## 1. Which construction/procurement software is most used in India? (research findings kept)
**Pick: Powerplay (getpowerplay.in; Bengaluru, founded Dec 2019), most used among small and mid builders and contractors, on thin evidence.**
- V: 700K+ active users and 700K+ app downloads, 85,000+ projects, "India's #1" (company pages; unaudited, undated, and the two user figures are conflated).
- V/press (YourStory, Mar 2022, company-sourced): about 250,000 workers a day on the platform in 2021; Rs 7,000 cr of activity (about 1% of India's); $5.8M funding from Accel, Sequoia Surge, India Quotient; Maharashtra the top state (16%). Peak XV profile: 10,000+ contractors in 800+ cities.
- I (thin): Capterra India 4.5/5 from only 8 reviews; App Store 4.8 from 4 ratings. Pricing on Capterra: Rs 71,999/yr (Pro), Rs 1,19,999/yr (Pro+), Advanced custom. Reviewers cite cost, limited data visualisation, app vs web differences.
- Named clients are small and mid firms (adarsh, ampus, aristo, Dezign Code, Jay Constructions, OKNO, Tanuvas). L&T, Tata Projects and Godrej were named only as firms its contractor users work for.
- Segments: small builders and contractors -> Powerplay (also Onsite from about Rs 12,000 + GST/user/year, RDash, SuperWise, Site Setu; prices vendor-published only). Large developers -> ERP (In4Suite, SAP/Oracle) or Procore/Autodesk. For a mid-size Mumbai developer like MRI: Powerplay is the practical primary pick for site and material work; its procurement documentation is shallow.
- **Runners-up:** (1) In4Velocity In4Suite: real-estate plus construction ERP, deeper procurement and finance; Capterra India 4.3/5 from 18 reviews; Kanakia reported deal above US$100,000 (CIOL, 2008, dated); heavy. (2) Procore: global leader; Capterra 4.5/5 from 2,680 reviews (global); about 82 Indian companies mention it in job-posting data (Adani Airport, WeWork India); costly. (3) Leads not verified: Onsite, RDash, SuperWise, Site Setu, Tally's construction ERP, Zoho Projects, Autodesk, Oracle Primavera/Aconex, Buildsmart, Kovai, Ecosoft, Constrofacilitator, Zepth.

### Powerplay features (vendor pages; many items "not mentioned")
Project/work management with DPR, tasks, timelines; material and inventory (indents, stock alerts and reorder points, transfers, utilisation analytics); PO from templates with automatic approver notification, revision tracking, status vs budget, PO and GRN generation; labour attendance and payroll; issue management; petty cash; reports; role-based permissions; Android/iOS/web in 12+ languages. **Not documented:** RFQ, quote comparison, vendor bills and payments, drawings with revisions, BOQ (separate Takeoff AI product), RA bills, subcontractor work orders, Tally integration, RERA compliance, offline mode. Documented PO flow: create -> send -> approvers notified -> tracked revision -> status vs budget; site team records received quantity against pending items. No indent -> RFQ -> bill -> payment sequence is documented.

### Screenshots (from vendor pages, saved earlier)
- /home/claude/screenshots/powerplay_purchase_order_screen.jpg
- /home/claude/screenshots/powerplay_inventory_material_report.jpg
- /home/claude/screenshots/powerplay_generic_landing_claim_india_no1.jpg (a page with a lead form; not filled)
- Sell.Do: /home/claude/screenshots/selldo_*.jpg (5 files).

## 2. Powerplay vs NirmaanCRM (against the guide)
| Category | Powerplay | NirmaanCRM status (guide ref) | Gap / advantage | Priority for MRI |
|---|---|---|---|---|
| Planning/scheduling | Timelines, tasks | **In guide, partial** (§7.4): milestones per wing with planned/actual dates, "Next 7 days" look-ahead. Gantt deliberately excluded ("No Gantt charts"). **Built (schema only):** `site_milestones` | Gap: no dependencies or baseline. Excluded by choice | Low-Med |
| DPR / site progress | Daily progress report, photos | **In guide** (§6.3, §7.4): photo-first, offline, `client_uuid` dedupe, 14-day strip, 7 PM nudge. `site_dprs.labour_count` is a single number | Parity; **gap:** no labour split by contractor or trade | High (DPR is the most-used screen) |
| Snag/issue | Issue tracking | **In guide** (§7.4): photo, severity, assign, due, open -> fixed -> verified, high >3 days nudges PM. `site_snags` has wing/location only | Parity; no checklist or unit link | Med |
| Drawings and revisions | Document hub only | **In guide** (§7.3): one live IFC per drawing (`uq_rev_one_ifc`), site sees latest only, superseded banner. **Built (schema only)** | Advantage | High |
| BOQ / estimation / budget | Budget tracking; takeoff in separate product | **Not in guide.** Only `projects.budget_paise` | Gap | High (cost control) |
| Indent / material request | Raise and track indents | **Not in guide.** Site role is "C (GRN only)" (§4.5); the RFQ is created by purchase (§7.5) | Gap: site cannot raise requests | High |
| RFQ + quote comparison | Not documented | **In guide** (§7.5): quotes with lowest/fastest highlighted, "2 of 3 quotes", last-paid rate. `pro_rfqs` holds one material per RFQ | Advantage; single-line RFQ limits multi-item requests | Med |
| PO and approvals | Template, auto-notify approvers | **In guide** (§7.5): `PO-<code>-<seq>` from `counters`, line items, GST, maker-checker (creator cannot approve), PM limit compared with GST-inclusive total, letterhead print, DRAFT watermark | Advantage | High |
| GRN | PO/GRN generation | **In guide, partial** (§7.5): site picks PO, challan photo, offline, `client_uuid`. Received quantity is free text (`qty_note`) | Gap: no structured received quantities; "part_received" status has no data to drive it | High |
| Vendor bills and payments | Not documented | **In guide, partial** (§7.5, §5 `pro_bills`): bill no, amount, due date, status, one `paid_on`/`payment_ref`; vendor ledger page. No GST/TDS columns, no partial payments | Advantage over Powerplay; gap for exact balance payable | High |
| Vendor management | Basic | **In guide** (§7.5): master, GSTIN, rating, duplicate-phone warning | Parity | Low |
| Inventory / store | Stock levels, alerts, transfers | **Not in guide** | Gap | Med |
| Subcontractor, work orders, RA bills | Not documented | **Not in guide.** `pro_vendors.category` includes `contractor`; roster in §7.7 only | Gap; essential when labour is by contractors | High |
| Labour, attendance, payroll | Attendance, payroll | **Excluded** (payroll, §1). Roadmap "Site Attendance by contractor" (§1.1, `att_` tables). §7.7 contractor roster | Replace with contractor-based records (see to-do) | High (as contractor records) |
| Budget and cost control | Spend vs budget on PO | **Not in guide** (no budget heads) | Gap | High |
| Approvals / workflow | Auto approver chains | **In guide, partial** (§7.5): PO maker-checker only. Statutory approvals tracker (§7.2, App. A) is a different thing | Advantage on statutory; no generic workflow | Med |
| RERA / statutory | Not offered | **In guide** (§7.2, App. A, §7.6): 29-row Mumbai template, quarterly RERA reminders, 70% account row, 10% warning. **Built (schema only, with data):** 27 rows | Advantage | High |
| Reports / dashboards | Instant/custom reports | **In guide, partial** (§7.9): purchase register, vendor ledger, last rate, DPR register + monthly labour totals, milestone delay; 6-tile owner dashboard | Parity for the basics | Med |
| Mobile / offline | Native app, 12+ languages, low-end devices | **In guide** (§6.3, §6.5): PWA, offline DPR/GRN/snag photo queue; English, Hindi, Marathi; native excluded (§1) | Advantage on offline; fewer languages | Med |
| Accounting / Tally | Not documented | **In guide, partial** (§7.9): Tally-friendly CSV (receipts register, purchase register); Tally XML only as roadmap (§1.1, "new reports exporter; no new tables") | Gap: no voucher export | Med |
| Roles and access | Role-based | **In guide** (§4.5-4.6) | Advantage | High |
| Petty cash | Expense by category | **Not in guide** | Gap | Low |
| Cost / hosting | Rs 72K-1.2L per year, SaaS | ₹0 on free tiers (§3.2) | Advantage; you maintain it | n/a |

## 3. Guide issues, risks and inconsistencies (checked against the text)
1. **Master Prompt names the wrong file.** §0 tells Claude to treat "NirmaanCRM_Claude_Build_Guide_v1.2.md" as binding, but the file is v1.3 (header and revision notes say v1.3). Fix the filename before the next session.
2. **Google OAuth audience.** §3.4 and the Phase 1 add-on say choose `Personal` "if it is offered" and "never leave the app in *Testing*", but the decision box then lists *Testing with a weekly Reconnect* as a last resort (option 4). The guide itself says to re-verify in Phase 4 that `Personal` accepts a Web-application client and keeps the refresh token valid. I have not verified that `Personal` exists; the guide's own wording suggests it may not be offered. Dhaval already runs in Testing with weekly reconnect (stored fact) and has no homepage/privacy page, which publishing to production would need. So the guide's first-choice path may not apply, and "never Testing" contradicts the fallback. Decide explicitly, and make sure the "Needs reconnect" banner, the phone photo queue (IndexedDB) and the nightly check cover a week of expiry. The backup audit log shows two "Google Drive connected" events 41 minutes apart.
3. **Contractor roster (§7.7) cannot do what it says.** It "feeds a simple who-works-at-which-site list", but `ppl_staff` (0007) has no trade and no project column. The module is OFF by default and visible only to HR (PM view-only; Site has none, §4.5).
4. **GRN quantities are free text** (`pro_grns.qty_note`); no per-line received quantities, so partial receipts and any stock ledger have nothing to compute from.
5. **Bills cannot hold partial payments, GST or TDS** (`pro_bills`: single `paid_on`/`payment_ref`), while the vendor ledger promises "balance payable". The v1.1 note about TDS and partial payments applies to sales tables only.
6. **Site cannot raise material requests** (§4.5: Purchase module Site = "C (GRN only)"); the process starts at RFQ.
7. **No number series for receipts and demand letters** (only POs use `counters`, §5); printed legal documents need sequences.
8. **Demand letters are one manual PDF per demand** (§7.6: Save as PDF, upload, send). Appendix C shows 4 letters (₹38.4L) per milestone; this will not scale if a milestone covers dozens of bookings.
9. **Customer portal vs "customers never get a login"** (§1.1 roadmap row vs §2 rule 15).
10. **Inventory:** `sal_inventory` has no hold owner (`blocked_by`/lead) and `type` is a BHK type, with no rehab/transit category for redevelopment.
11. **Template count:** Appendix A has 29 rows; the two redevelopment rows are ★5 (society consent, DA registration) and ★6 (transit rent, bank guarantee), not just one. Phase 5 says "27 rows, or 29 for redevelopment", which matches. The backup loaded the 27-row variant.
12. **Schema drift:** backup `projects` has `brand_id` and `percent_complete`, which §5 does not define (guide uses `brand_profiles.project_id`). Record in DATA_DICTIONARY.
13. **Free-plan CPU and query risks (the guide flags most):** PBKDF2 at 100,000 iterations may exceed ~10 ms CPU (guide says measure in Phase 3 and stop if it does); SMTP over `cloudflare:sockets` with TLS handshakes, and STARTTLS quirks (§7.8); nightly backup limited to ~40 queries per tick; hourly sweep at ~40 queries per run (SLA nudges and overdue marking for many leads could need several ticks); `milestone.done` fan-out (demands update, notifications, emails) must be one batched UPDATE and run after the response. Also to verify: §3.2 relies on `LIKE 'abc%'` using an index for search; in SQLite that needs a NOCASE index or the right collation, otherwise it scans.
14. **Tally XML has no phase.** It exists only as a roadmap row (§1.1); the build phases (§8) deliver CSV only (Phase 12).
15. **Backup protects the files only if the Google account survives** (§11.1 says so and requires a laptop copy; make that monthly download a habit). Drive tokens are in D1 encrypted with `APP_KEY`; lose `APP_KEY` and the connection is lost.

## 4. Prioritised to-do list (items missing or underspecified in the guide)
Constraints for every item: ₹0, Cloudflare free plan (about 10 ms CPU, 50 queries per request, 5 cron triggers, so no new crons: reuse the hourly sweep), module contract (§4.2, §10.3: one folder, one additive migration, one registry line, one import line, events instead of cross-imports), money in paise, percentages in basis points, files in Drive via `documents`. Effort: S = days, M = 1-3 weeks, L = 1+ month. "Slot" = after which guide phase (§8). The backup suggests the build is in the Phase 4-5 area; Phases 6-13 appear not to have produced data yet.

### P1 (do first)
| # | Title | What / why | Effort | Builds on | Dependencies | Slot |
|---|---|---|---|---|---|---|
| 1 | **Redevelopment module: society and member registry + consent tracker** | New module `red_` (e.g. `red_societies`, `red_members`, `red_consent_events`): society per project (`projects.type='redevelopment'`), members with flat no., member type (owner/tenant/commercial), carpet area, consent status (pending/consented/declined), date. Consent % = consented / total members shown against a configurable threshold (**default 51%**, stored per society in bp, e.g. 5100). Choice of counting by members or by area to be confirmed with Dhaval. One aggregate query per view. Emits `consent.threshold_reached`; the approvals row ★5 (App. A) links to it. Member-document checklist: **pending Dhaval's list** (no items invented). Fills the one gap neither Sell.Do nor the guide covers | M | `projects`, `apr_items` (★5), `documents`, `audit_log`, notifications | Phase 5 (approvals) and Phase 4B (documents); legal wording for threshold to be confirmed with advocate | After Phase 5 |
| 2 | **Procurement completeness: indent, structured GRN, vendor payments** | Additive migration: `pro_indents` + items (site raises a request; permission change for Site), `pro_grn_items` (received qty per PO line, drives `part_received`), `pro_payments` (partial payments, TDS, reference), GST/TDS fields on `pro_bills`. Why: closes issues 4-6 of section 3 and makes the vendor ledger exact | M | `pro_pos`, `pro_po_items`, `pro_grns`, `pro_bills`, `counters` | Phase 8 (do inside it if not started; else a new migration) | In/after Phase 8 |
| 3 | **Contractor and work-order module (replaces labour attendance/payroll)** | New module `con_` (labour supplier/contractor master as a vendor with trade, project assignment; work orders with scope, rate basis, value, approval limit like POs; **running-account (RA) bills** with measurement, gross, retention %, advance recovery, TDS and GST fields, partial payments; **retention and advance ledger** per contractor). DPR gets a per-contractor labour count table so the DPR labour total comes from contractors. Why: labour is by contractors, so you pay contractors, not workers. Tax rates "confirm with CA" | L | `pro_vendors` (via procurement `service.js`, not raw SQL), `site_dprs`, `documents`, PO approval limit setting, `ppl_staff` roster (fix §7.7 gaps) | Items 2 and Phase 7; Phase 4B (branding) for printing work orders | After Phase 8 |
| 4 | **Budget heads and committed-vs-actual** | `pro_budget_heads` per project (cement, steel, labour contract, ...): budget, committed (approved POs and WOs), actual (bills and RA bills). Owner-dashboard tile and report. Why: no cost control in the guide beyond `projects.budget_paise` | M | `projects`, `pro_pos`, `pro_bills`, items 2-3 | Items 2 and 3 | After item 3 (Phase 12 dashboard extension) |
| 5 | **Document number series and receipt controls** | Use `counters` for receipt, demand letter and brokerage-payment numbers (per project and financial year); optional maker-checker on receipts using the PM limit pattern. Why: printed legal documents currently have no sequence (issue 7) | S | `sal_receipts`, `sal_demands`, `counters`, print helper (§7.10) | Phase 9 | In Phase 9 |
| 6 | **Fix contractor roster (§7.7) and spec drift** | Add trade and project assignment to the roster (or point it at `con_`); correct the Master Prompt filename; record `brand_id`/`percent_complete` in the data dictionary. Why: guide issues 1, 3, 12 | S | `ppl_staff`, `docs/DATA_DICTIONARY.md` | None | Before Phase 10 |

### P2
| # | Title | What / why | Effort | Builds on | Dependencies | Slot |
|---|---|---|---|---|---|---|
| 7 | **Rehab/PAP allotment, transit rent and corpus ledger** | Allot rehab units to members; transit rent schedule per member (amount, due dates, cheque numbers, paid status) with reminder through the hourly sweep; bank-guarantee row tracking (App. A ★6); corpus payments. Rehab units need their own category in `sal_inventory` | L | Item 1, `sal_inventory`, `apr_items` ★6, notify | Item 1; inventory category change | After item 1 / Phase 9 |
| 8 | **Tally voucher export (XML)** | Browser-side generator (CPU stays off the Worker) for Tally import: receipt vouchers, purchase/bill vouchers, payment vouchers, contractor RA bill vouchers, with a ledger-mapping settings screen (party to Tally ledger, GST/TDS ledgers). Keeps CSVs. Matches the §1.1 roadmap row (no new tables beyond a mapping setting) | M | `sal_receipts`, `pro_bills`, `pro_payments`, `con_ra_bills`, reports exporter (Phase 12) | Items 2, 3 and the CSV exporter | After Phase 12 |
| 9 | **Store/stock ledger** | Stock on hand per site from GRN items, issue to work, transfers, low-stock reminder. Developer-supplied materials only | M | `pro_grn_items` (item 2), `site_dprs.materials_used` | Item 2 | After item 2 |
| 10 | **Cost sheet and discount approvals (free-sale units)** | Per-unit cost sheet (base, floor rise, PLC, parking, stamp duty, GST, discount) stored with the booking, with approval bands reusing `po.pm_approval_limit_paise`; feeds `agreed_price_paise` and the CLP schedule | M | `sal_inventory`, `sal_bookings`, `sal_plan_stages` | Phase 9 | After Phase 9 |
| 11 | **Hold ownership and booking extras** | `blocked_by` and `blocked_lead_id` on units; co-applicants; expiry notification | S | `sal_inventory`, `sal_bookings` | Phase 9 | After Phase 9 |
| 12 | **Bulk demand letters** | Generate and queue demand emails for all Ready demands of a milestone from one screen; PDFs built in the browser one at a time and uploaded in chunks (stays within CPU cap) | M | `sal_demands`, email queue (§7.8), print helper | Phase 11 | After Phase 11 |
| 13 | **Possession/handover and registration checklist per unit** | Checklist, loan details, unit-wise snag list, handover date | M | `sal_bookings`, `site_snags`, `documents` | Phase 9 | After Phase 9 |
| 14 | **Society meetings and resolutions log** | Meeting date, agenda, attendees, resolution upload, follow-ups. Content/legal checklist to be defined with Dhaval | S-M | Item 1, `documents` | Item 1 | After item 1 |
| 15 | **Owner-dashboard extras** | Tiles/reports for consent % per society, transit rent due, contractor retention, budget vs actual (added to the six tiles of §7.9, no chart library) | S | Items 1, 3, 4, 7 | Those items | Phase 12 |

### P3
| # | Title | What / why | Effort | Builds on | Dependencies | Slot |
|---|---|---|---|---|---|---|
| 16 | Lead capture helper | Public enquiry form (Cloudflare Turnstile) creating leads; optionally parse portal lead emails via Cloudflare Email Routing (verify free limits before relying on it) | M | `sal_leads` | Phase 9 | After Phase 11 |
| 17 | Buyer statement via share link | Read-only demand/receipt statement as an expiring `/s/<token>` page (respects §2 rule 15; replaces a customer portal) | M | `share_links`, `sal_demands`, `sal_receipts` | Phase 4B, 9 | After Phase 12 |
| 18 | Bank-statement CSV import and matching | Match received amounts to demands by reference; manual confirm | M | `sal_receipts`, `sal_demands` | Item 5 | After item 5 |
| 19 | Visit verification | Browser geolocation tag on visit check-in; structured feedback fields | S | `sal_visits` | Phase 9 | After Phase 9 |
| 20 | Petty cash and site expenses | Simple expense log per project with category (Tally voucher optional) | S-M | `projects`, `documents` | None | Anytime |
| 21 | Vendor and contractor documents | KYC, GST, agreement expiry reminders per party | S | `pro_vendors`, `documents` | Item 3 | After item 3 |
| 22 | Drawing acknowledgement | Site "seen" confirmation per new IFC revision | S | `drw_revisions`, `drawing.new_ifc` event | Phase 6 | After Phase 6 |

**Deliberately not proposed (guide §1 excludes them or they break ₹0):** payroll and direct-labour attendance, native apps, WhatsApp Business API, payment gateways, AI/voice, Gantt/BI dashboards, telephony.

## 5. Open questions for Dhaval
- Consent: count by members or by carpet area? Is 51% per society, and should Nirmaan block or only warn below it? Member-document list: pending from you.
- Contractors: do you pay on measured RA bills, lump-sum work orders, or both? Typical retention %? (Tax treatment to confirm with your CA.)
- Do you also supply materials (stock ledger needed), or do contractors supply materials too?
- Tally: which ledger names should vouchers use? A sample Tally export from your accountant would let me match the XML format.
- Google OAuth: remain in Testing and accept weekly reconnect, or move to the Personal/custom-domain route (see issue 2)?
- Does MRI sell free-sale units in volume (then items 10-13 move up)?

## 6. Sources
- Vendor (V): getpowerplay.in (home, /generic/, /our-story/, /construction-purchase-order-software/, /construction-inventory-management-software/, /material-management/); getpowerplay.ai.
- Independent/third party (I): capterra.in/software/1036292/powerplay; capterra.com/p/268357/Powerplay/; apps.apple.com/app/id1552606148; yourstory.com 2022 Powerplay article (company-sourced); surge.peakxv.com/companies/powerplay; capterra.in/software/70753/in4suite; ciol.com/kanakia-spaces-implements-in4suite; capterra.in/software/56250/procore; theirstack.com/en//technology/procore/in.
- Vendor-authored listicle: sitesetu.in/blog/top-10-construction-management-software-india-2026.
- Own data: `NirmaanCRM_Claude_Build_Guide_v1.3.md`; Drive file `nirmaan-backup-2026-11-22.json` (id 1KBL72vo13IcfwTCJHH1rZ6e7xUyaxVUY).
