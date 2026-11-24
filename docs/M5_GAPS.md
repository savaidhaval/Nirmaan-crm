# Module 5 (Possession Handover, Snagging and Society Transition): gap review

Source: `Module_5.docx` (Dhaval, 2026-11-24). Compared with the code at migration 0053.
Status: **steps 1 and 2 built (migrations 0054, 0055)**. Dhaval's answers to the decisions are at the bottom.

| # | In the document | State before | Step 1 (now) | Still missing |
|---|---|---|---|---|
| A1 | OC from Module 1 unlocks possession | Built: possession is refused without an approved OC for the flat's wing (`handover/complete`) | Same | None |
| A2 | Final possession demand notice (final 5% + corpus + 12/24 months maintenance + share money) with a 15-30 day window | The final instalment is an ordinary demand; no corpus or maintenance amounts | **Built (ledger)**: corpus, advance maintenance, share money and fit-out deposit are set per flat and received separately (`sal_possession_funds`) | A single "possession notice" letter that adds these up: **Decision 1** |
| A3 | Rehab possession intimation; transit rent freezes at notice + grace days | Built: rent stops at the OC date of the member's wing plus `red.oc_grace_days` (default 30) | Same | The document says 15 days: **Decision 2** |
| B1 | Tap a pin on the flat's floor plan, photo, assign to a contractor | Snags had a flat and a photo, no contractor, no plan | **Built**: contractor work order, category, floor-plan picture and a tapped pin on every snag | Typical 1/2/3 BHK plans loaded once and reused: **Decision 3** |
| B2 | Contractor uploads an After photo; engineer verifies | A snag could be marked fixed with no proof | **Built**: a snag that belongs to a work order cannot be marked fixed without an "After photo"; PM/Owner verifies (as before) | None |
| B3 | Open snags hold back the contractor's retention (Module 3) | Retention was held for the defect liability period only | **Built**: no retention is released while any snag of that work order is not verified fixed (no override, not even the Owner) | None |
| B4 | Buyer's digital joint-inspection sign-off, 7-day touch-up SLA | Not built | Not built | **Decision 4** |
| C1 | Six-point no-dues gate before keys | Possession needed: OC, 1% TDS verified (hard), dues/snags/checklist (a written reason overrides, dues only by the Owner) | **Built**: the six points are shown on the booking (dues + GST + interest, TDS, corpus/maintenance/share money, registered AFS, no critical snag, signed letter + undertaking uploaded). A setting `sales.nodues_strict` makes all six a hard lock with no override. Off by default so today's flow does not change | Whether to switch it on: **Decision 5** |
| C2 | Possession Certificate and Key Handover Receipt only when green | A possession letter existed; no certificate | **Built**: a printable certificate with a number, the flat, the funds held and the defect period, available only after possession is given through the gate | Parking sticker / access-card count on the receipt |
| C3 | Self-booked 45-minute handover slots on WhatsApp | Not built | Not built | **Decision 4** |
| D1 | Handover photo baseline, refundable fit-out deposit and NOC | Not built | **Partly**: the fit-out deposit has its own ledger head (received, refunded, never mixed with price or corpus). Photo baseline and NOC not built | Baseline photos + NOC: **Decision 6** |
| D2 | Residents raise tickets on WhatsApp with a photo | Not built | **Built (staff side)**: Defect helpdesk. Staff log a ticket (phone, WhatsApp, email), it gets a 7-day time limit, is given to the contractor's work order, fixed, verified or rejected. Late tickets are flagged | The resident-facing WhatsApp bot: **Decision 7** |
| D3 | Auto back-charge when a contractor ignores a ticket past the SLA | Not built | **Built**: after the time limit the PM/Owner/Accounts name an outside repair vendor and a cost; the amount is held against that contractor's retention; Accounts confirms and it leaves the retention balance | Posting it as a formal debit note on the contractor's account: **Decision 8** |
| E1 | Ring-fenced corpus and maintenance ledger, CA-ready export | Redevelopment members had a corpus; buyers had none | **Built**: one ledger per head per flat, project totals and a spreadsheet download | Audited statement "collected minus certified common-area expenses": **Decision 9** |
| E2 | CHS vault: OC, BCC, plans, CFO NOC, lift/STP/DG warranties, corpus ledger, secretary acknowledges | Not built | **Built**: a 12-item standard checklist, each item uploaded and acknowledged by the society secretary; a replaced file needs a fresh acknowledgement; the project cannot be set to Completed until the vault is complete (the Owner may override with a written reason, audited) | One-click hyperlinked ZIP / PDF binder: **Decision 10** |
| E3 | Society formation tracking, share certificates | Redevelopment screens track the society, not the post-OC formation | Not built | **Decision 11** |

## Measured (local, free-plan limits are 50 statements per request)
New and changed routes read at most 6 statements (no-dues check: 6; project close with the vault check: 3). The no-dues check runs in `handover/complete` only when strict mode is on.

## Decisions needed (nothing below was built)
1. **Possession demand notice.** One letter that adds the final instalment, corpus, advance maintenance (12 or 24 months?), share money and the payment window (15 to 30 days?), with amounts per sq ft of RERA carpet area? Tell me the usual figures and I will make them project settings.
2. **Rent freeze days.** The document says 15 days after the possession notice; the system today uses 30 days after the OC (`red.oc_grace_days`). Which one, and counted from the OC or from the notice you send?
3. **Floor-plan library.** Load a plan once per unit type (1, 2, 3 BHK) and reuse it for every flat of that type, instead of attaching a picture to each snag.
4. **Buyer-facing steps.** Joint-inspection sign-off on a tablet and self-booking of handover slots need a link the buyer opens without a login (the system has expiring, revocable links for this). Build it as a link sent on WhatsApp?
5. **Strict lock.** Switch `sales.nodues_strict` on now (no key release unless all six are green, no override), or after you have loaded the corpus and letter data for every flat?
6. **Fit-out.** Handover photo baseline signed by the buyer, plus a fit-out NOC the buyer must hold before interior work. Build now?
7. **Resident WhatsApp bot.** Needs the WhatsApp Business API (paid, template approval). Free alternative: a QR code and link on the possession kit that opens a simple complaint form with a photo upload. Which?
8. **Back-charge as a debit note.** Today it reduces the retention balance and keeps the repair vendor's name. Do you also want a numbered debit note printed for the contractor?
9. **Society statement.** A statement of corpus collected minus certified common-area expenses needs the common-area expense entries (the maintenance period before the society takes over). Where are those kept today: Tally, or should the CRM hold them?
10. **Handover binder.** A PDF / ZIP of the whole vault runs in the browser (free plan). OK to build it as a browser download?
11. **Society formation tracker.** Registration number and date, share certificate issue, committee names, conveyance deed date. Build as a short form per project?

## Settings added (confirm with your CA / advocate)
`sales.nodues_strict` (on / off, default off), `sales.nodues_funds_required` (on unless set off), `dlp.sla_days` (default 7), plus existing `con.dlp_months` (60) for the defect liability period.


## Dhaval's answers (2026-11-24) and what step 2 (0055) built
1. Amounts are typed by a team member (no per-sq-ft calculation). **Built**: a possession notice with a pay-by date (default 30 days, setting `sales.possession_notice_days`) listing the final instalment and the corpus / maintenance / share money set for the flat; prints and goes by WhatsApp or email like any letter.
2. Rent freeze stays at 30 days after the OC (`red.oc_grace_days`). **No change.**
3. Floor-plan library, as recommended. **Built**: one plan per flat type per project; a snag raised inside a flat takes the plan by itself.
4. Buyer steps by WhatsApp link and email. **Built**: one-time links (only a hash is kept, 14 days, setting `hv.link_days`) for (a) joint inspection (made only when internal snags are zero; the buyer types touch-ups, which become low snags due in 7 days, `hv.touchup_days`), (b) choosing a handover time from slots the team publishes (made only when all six no-dues points are green), (c) signing the baseline of the flat. The buyer sees only first name, flat and project.
5. Strict no-dues lock **on by default**. Done: keys cannot be released with any of the six points red, no override. The Owner can set `sales.nodues_strict` to off.
6. Fit-out. **Built**: baseline photographs, buyer's signed baseline, and a Fit-out NOC the PM/Owner issues only after possession, with the fit-out deposit received and the baseline signed; the Owner can revoke it with a reason; prints.
7. Complaints by a free QR form or by email. **Built**: a public form (same Turnstile protection as the enquiry form, rate-limited, hidden trap field) that files a ticket with the 7-day limit and tells the PM, Owner and site team; the QR poster shows the company email for photos. Photos by the public are not uploaded through the form: residents email them.
8. Debit note. **Built**: confirming a back-charge numbers a debit note (DN-<project code>-0001) and prints it for the contractor.
9. Society statement: costs are typed into the CRM. **Built**: common-area costs (head, amount, bill number, paid to), certified by the CA (Owner or Accounts records the name); statement = advance maintenance collected minus certified costs, with corpus and share money shown as held for the society; costs not yet certified are listed but not deducted; prints and downloads as CSV.
10. Handover binder. **Built** in the browser (no server load): every vault file, an index page with links, the ledger and the statement as one ZIP.
11. Society formation tracker. **Built**: stage (proposed, provisional, registered), registration number and date, share certificates, conveyance deed date and reference, committee (one chairman, secretary, treasurer each).

Settings added: `sales.possession_notice_days` (30), `hv.link_days` (14), `hv.touchup_days` (7).
