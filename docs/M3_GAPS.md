# Module 3 (Site Engineering, BOQ and Contractor Billing): gap review

Source: `Module_3.docx` (Dhaval, 2026-11-24). Compared with the code at migration 0046 (Module 2 live).
Status: **steps 1 to 3 built (migrations 0047 to 0049)**. Dhaval's answers to the four decisions are at the bottom.

Module 3 is the most complete module already: the app has a BOQ per cost head, contractor work orders with variations, joint measurements, RA bills with retention, advance recovery, debit notes, TDS and GST, a Store with stock, material requests (indents), POs and receipts, concrete pours with cube tests, offline mode and a DPR with labour.

| # | In the document | State before | Step 1 (now) | Still missing |
|---|---|---|---|---|
| A1 | Master BOQ by trade, wing-wise and floor-wise | BOQ items under cost heads, quantity x rate, paste up to 200 lines, CSV export | Same | Wing and floor columns on a BOQ line (needs your word: **Decision 4**) |
| A2 | Work orders capped by BOQ quantity and rate | A work order item can link to a BOQ line, but nothing stopped it going over | **Built**: a work order line cannot take more than the BOQ quantity still free (after other work orders) or a rate above the BOQ rate, unless the Owner gives a written reason | None |
| A3 | No work orders or progress above the approved CC floor | Indents and RA bills had the floor lock; work orders and the daily report did not | **Built**: work order (wing and floor) and each line of the daily report are checked against the approved CC floor; the Owner may override with a reason; no CC floor recorded means no lock | None |
| B1 | Indent checks the BOQ material allowance | Indent lines were free text | **Built**: an indent line can name its BOQ item; if the request goes past the BOQ quantity (counting earlier requests) the line is marked "over BOQ" and the PM is told in the approval alert | A 1-tap "repeat last request" (step 2) |
| B2 | Gate photo-GRN: truck, challan, weight, geotag photo | Receipt had a challan field, no photo, no weight, no truck number | **Built**: the challan number is compulsory and must be new for that supplier; truck number, weighbridge weight, phone location and the gate photo are saved; a receipt with no photo is flagged | Photo from a phone with no signal is saved later, not at the gate (it cannot upload offline) |
| B2b | "No photo-GRN, no payment": bill refused without a gate-stamped receipt | A bill was held when it was above material received at PO rates | **Built**: a bill on a PO that has any receipt without a photo is also held, with the reason shown | None |
| B3 | Weekly wastage audit, alert above 2.5% | A per-work-order comparison screen, no alert | **Built**: every Monday morning the PM and Owner are told which material was issued beyond what the measured work needed plus the allowed wastage (setting `stk.wastage_alert_bp`, default 250 = 2.5%) | None |
| C1 | 5-point pre-pour checklist | Built (concrete pours) | Same | None |
| C2 | 60-second DPR with labour, concrete, 2 to 3 geotagged photos | DPR with labour, work lines, photos, offline queue | Same | Photo location stamp on DPR photos (step 2) |
| C3 | 7 and 28 day cube reminders | Built (cube sweep) | Same | None |
| D1 | Joint measurement against BOQ lines | Built | Same | None |
| D2 | RA waterfall: retention, advance recovery, debit notes, TDS, GST | Built, per work order | Same | GST payout held until the contractor's GST returns are filed (**Decision 2**) |
| D3 | Slab sign-off by Site Engineer and RCC consultant (photos) before demand letters | The PM certifies a milestone with a certificate document; open NCRs and CC floor block it | Not built | Two-signature slab sign-off (**Decision 1**) |
| E | Over-billing blocked at the BOQ ceiling | Built at work-order level (qty plus approved variations, and only measured quantity can be billed) | Same, plus A2 above | None |
| E | Offline basement mode | Built (pending-entries queue) | Same | None |
| E | Live cost-to-complete meter | Budget overview shows committed, billed, paid per head | Same | Spent against physical completion % per wing (**Decision 3**) |
| E | 20-minute RA bill processing | Built (one approval screen) | Same | None |

## Decisions needed (nothing below was built)
1. **RCC consultant sign-off.** Your rule is that outsiders get no login. Proposal: the consultant signs the inspection sheet on site, the Site Engineer uploads that photo, and the PM or Owner (a second person) confirms it. The slab can then be certified and buyer demands released only with both uploads. Is that acceptable, or do you want something else?
2. **GST hold until the contractor files GSTR-1 and 3B.** The app cannot see the GST portal (that needs a paid provider). Proposal: Accounts tick "GST returns confirmed" on each RA bill after checking the contractor's filing; until then the GST part of the bill is held. Agree?
3. **Cost-to-complete by wing.** Needs a wing-wise physical completion percentage (from certified milestones or entered by the PM). Which do you want?
4. **Wing and floor on each BOQ line.** The document wants BOQ wing-wise and floor-wise. This adds two optional columns and a filter. Agree?

## Answers received (2026-11-24) and what was built in step 2
1. RCC sign-off: anyone on the site team, the PM or the Owner uploads the consultant's report; the Owner confirms it. Built: both sign-offs are needed before a stage that releases buyer demands can be certified.
2. GST hold: agreed. Built: Accounts or the Owner confirm the contractor's filing (with a note of what they saw on the portal); until then the GST part of the RA bill cannot be paid.
3. Cost to complete: both sources (certified stages and the PM's figure). Built: the lower one is used; a wing is complete only when both say 100%.
4. BOQ wing and floor: agreed, with an alternative for a standalone building. Built: wing is optional and can be left blank, or named (Basement, Podium, Terrace); floor is optional.

## Closed in step 3 (migration 0049)
- One-tap "Ask again" for material requests; the daily report is stamped with where it was filed from (compared with the project location, warning only); the Owner can override the CC-floor refusal on the daily report from the screen; receipts without a gate photo have their own screen with an Add photo button; the wastage alert uses the usual allowance for each material instead of one figure.
- The starter wastage figures follow common Mumbai site practice (ready-mix 1%, steel 2.5%, cement 3%, bricks and blocks 5%, aggregate 5%, sand and tiles 6%, paint, waterproofing and putty 5%). They are starting points for your QS to confirm, not rules from a code.

## Still open
Nothing from the original Module 3 list.
