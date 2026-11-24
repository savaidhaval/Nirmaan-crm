# Module 2 (Pre-Sales, Channel Partners & Live Tower Inventory): gap review

Source: `Module_2.docx` (Dhaval, 2026-11-24). Compared with the code at migration 0043.
Status: **steps 1 and 2 built (migrations 0044, 0045)** after Dhaval's answers (below). Still open: the pricing matrix, broker flyers (no broker access, so these become staff tools or are dropped) and portal field mappings.

## What the document asks for, and where it stands

| # | Sub-module in the document | Before this change | Now | Still missing |
|---|---|---|---|---|
| A1 | Lead capture from portals and ads, duplicate check on mobile number | Built: signed webhook `/api/webhooks/leads/:source`, website enquiry form, CSV import, duplicate check on the last 10 digits | Same | Per-portal field mapping for 99acres, MagicBricks, Housing.com, Meta lead forms (today they must post the generic JSON) |
| A2 | WhatsApp welcome pack in 5 seconds (brochure, RERA QR, floor plans, map pin) | Not built (only manual WhatsApp share links) | Not built | **Decision 1** |
| A3 | Round-robin, 15-minute call SLA, auto-reassign, flag the Sales Manager | Round-robin by least open leads. Nudges at 1 hour and 4 hours only. No reassign | **Built**: a lead nobody called is moved to the next executive, the owner and PM are told, max 3 moves, setting `sales.sla_minutes` (default 15, 0 = off) | True 15-minute timing (**Decision 5**) |
| B1 | Broker vault: MahaRERA certificate, PAN, GSTIN; payout locked until RERA approved | Only firm, phone, RERA number | **Built**: PAN (encrypted, last 4 shown), GSTIN, RERA number + expiry, Owner/Accounts approval, any edit needs re-approval | Upload of the certificate scan from the partner screen (field exists: `rera_doc_id`) |
| B2 | Broker pre-visit check of a buyer's number | Not built | **Built for staff**: "Is this number already ours?" card on the Sales page | Broker-side version (**Decision 3**) |
| B3 | Reception QR check-in, buyer OTP, 45/60-day source lock | Not built | Not built | **Decision 2** |
| B4 | No manual broker tagging after the visit | A booking accepted any broker | **Built**: a booking inherits the broker who registered the lead; a different broker can be set only by the Owner with a written reason | Needs B3 for the full lock |
| C1 | Live tower grid: green / yellow with countdown / red / grey | Built (stacking plan) but showed rehab and landowner flats to sales and had no countdown | **Built**: sales never sees rehab or landowner flats; held flats show a live countdown; flats above the approved CC floor show "Not open yet" when `sales.lock_above_cc` = on | **Decision 4** |
| C2 | One-tap cost sheet from a pricing matrix (floor rise, PLC, parking, club fees, stamp duty, registration, GST) | Cost sheet exists with free-form extra lines and tax rates from Settings | Same | Pricing matrix settings (floor-rise per floor, PLC rules, standard parking and club charges) and the watermarked, time-stamped PDF |
| C3 | Quote to the buyer's WhatsApp | Print / PDF only | Same | Share link (**Decision 1**) |
| D1 | Floor-rate lock (MSP) with Director approval and margin impact | Approval only against the rate card, no floor | **Built**: Owner sets MSP per flat or per project (rate per RERA sq ft). A cost sheet or booking below it is refused unless the Owner approves it with the approval PIN | Mobile push with margin impact (today it is an in-app notification) |
| D2 | 48-hour hold, flat flips back automatically | Built (hourly sweep, one set-based statement) | Same | Accounts "token cleared" step (**Decision 6**) |
| D3 | No fake holds; repeat blocks by the same closer refused | Per-user cap of 5 holds only | **Built**: a closer who released a flat, or let a hold lapse, cannot block it again for 24 hours (`sales.rehold_block_hours`); managers are exempt | UTR / cheque image on a hold (**Decision 6**) |
| D4 | Double booking impossible | Built (one conditional UPDATE decides the winner; unique index on active booking per flat) | Same | None. D1 has no row lock; this design is the safe equivalent |
| E1 | Returning-visitor recognition at reception | Not built | **Built** (same card as B2): previous visits, last visit, BHK, budget, closer | Reception tablet screen (needs B3) |
| E2 | Co-branded flyers and videos for brokers | Not built | Not built | Needs **Decision 3** |
| E3 | Marketing ROI: cost per lead, visit, booking, by source and partner | Built (Reports, Marketing and partners) | Same | None |
| E4 | Slab-milestone re-engagement WhatsApp to warm prospects | Not built | Not built | **Decision 1** |
| F | Unregistered broker cannot be paid (RERA expiry gate) | Not built | **Built**: payment refused if KYC not approved, RERA missing or past expiry | None |
| F | Only sellable floors up to Further CC | Server gate existed for RERA and holds only | **Built as a setting** (`sales.lock_above_cc`): hold, cost sheet and booking refused above the approved CC floor | **Decision 4** |

## Decisions needed from Dhaval (nothing below was built or guessed)

1. **WhatsApp Business API** (welcome pack, quote, milestone updates). It is a paid service with Meta approval and per-message charges, so I did not add it. Free option: one-tap "Send on WhatsApp" links that open the executive's own WhatsApp with the message and link filled in (this is how the app shares today). Recommended: free links now, API later if the volume justifies it.
2. **Buyer OTP at reception.** An SMS OTP needs a paid SMS provider and DLT registration. Free option that keeps the same proof: the receptionist's tablet shows a QR; the buyer scans it with their own phone, types their own mobile number and taps "Yes, I came with <broker firm>" on a one-time page (no login, expires in minutes). The server stamps the time and starts the source lock. Recommended: the QR confirmation. Also tell me the lock days: 45 or 60 (will be a setting).
3. **Broker access.** The standing rule is that outsiders never get a login. Option A (recommended): each broker gets an expiring, revocable personal link (the existing `/s/<token>` pattern) for pre-visit check, own lead status and the flyer studio. Option B: broker logins, which needs a rule change from you.
4. **Sell only up to the approved CC floor.** It is built but OFF. Turn it on per `sales.lock_above_cc` = on in Settings once you have confirmed with your advocate that you want flats above the approved CC floor locked (in Mumbai flats on upper floors are often sold under the RERA registration before Further CC arrives).
5. **15-minute SLA timing.** The free plan allows 5 cron triggers and 4 are used. Hourly check means a lead is moved at the first sweep after 15 minutes (up to about an hour). A fifth cron every 15 minutes would make it exact but uses the last free slot. Say if you want it.
6. **Token clearance.** Today a booking records the token at once. The document wants "block with token proof, accounts confirms within 48 hours, else flips back". Say if you want that two-step flow (hold with UTR / cheque image, then Accounts marks it cleared).
7. **GSTIN compulsory?** Small brokers may have none. Today PAN and the MahaRERA number and expiry are compulsory for approval; GSTIN is optional.

## Plan for the next steps (each its own package, after your answers)

- Step 2: reception check-in, buyer confirmation page, source lock (Decisions 2, 3).
- Step 3: broker links (pre-visit check, own leads, flyers with agency name) (Decision 3), portal field mappings (A1).
- Step 4: pricing matrix and one-tap cost sheet with PLC / parking / club lines, WhatsApp share links, milestone re-engagement (Decision 1), token clearance (Decision 6).

## Answers received (2026-11-24) and what was built

1. WhatsApp: one-tap links. Built: welcome pack on a lead, cost-sheet message, site updates to warm buyers with consent. No WhatsApp API, no cost.
2. Free alternative to OTP. Built: reception QR, buyer confirms on their own phone, 45-day lock (setting; change to 60 if wanted).
3. Broker access: none. No broker login and no broker link. Brokers are entered by staff at reception or lead registration. The broker-side pre-visit check and flyer studio are therefore not built; the staff "Is this number already ours?" card covers the check. A staff-made co-branded flyer can be built later if wanted.
4. Lock flats above the approved CC floor: built and ON by default.
5. 15-minute SLA: built on the fifth free cron. All five free-plan crons are now used.
6. Token clearance: built (hold with UTR or cheque number and amount, Accounts clears).
7. PAN and MahaRERA compulsory, GSTIN optional: as already built in step 1.

## Still to do (needs your word)
- Pricing matrix (floor-rise per floor, PLC rules, standard parking and club charges) and one-tap cost sheet from it.
- Photo of the UTR or cheque on a token (the proof_doc_id field exists; the upload button is not on the screen yet).
- Per-portal mappings for 99acres, MagicBricks, Housing.com and Meta lead forms.
- Staff-made co-branded flyer (only if you still want it, given no broker access).
