# Module 4 (Post-Sales Collections, Home Loans and RERA 70/30 Escrow): gap review

Source: `Module_4.docx` (Dhaval, 2026-11-24). Compared with the code at migration 0049 (Module 3 live).
Status: **steps 1 and 2 built (migrations 0050, 0051)**. Dhaval's answers to the decisions are at the bottom.

| # | In the document | State before | Step 1 (now) | Still missing |
|---|---|---|---|---|
| A1 | Booking and cost sheet flow from sales to post-sales with no re-typing | Built (one database; booking takes the approved cost sheet) | Same | None |
| A2 | Digital KYC by the buyer on a WhatsApp link, standard MahaRERA Allotment Letter | Co-applicants, PAN (encrypted) and masked Aadhaar are entered by staff. No buyer link, no allotment letter | Not built | **Decisions 3 and 4** |
| A3 | 10% hard stop: no demand beyond 10% before the Agreement for Sale is registered, with its number and Index-II | Only the token was capped at 10% at booking | **Built**: demands past the first 10% stay held (also at booking), a certified stage does not bill an unregistered buyer, Accounts, PM and Owner are told who to remind, and registering the Agreement (number plus scanned Index-II) opens the held demands. Switch `sales.afs_gate` | An automatic AFS reminder to the buyer (staff use the one-tap list) |
| B1 | Slab certification unlocks demands | Built (certified stage releases demands, now with the two sign-offs) | Same | None |
| B2 | One-click bulk dispatch of demand letters, invoices and payment links | Built (bulk run, daily limit, email, print, expiring read-only link). No payment link | Same | **Decision 1** |
| B3 | Demand letter, slab photos and bank NOC to the buyer's loan manager | Loan record had bank and amounts only | **Built**: relationship manager (name, email, phone) and the bank's project coordinator on each loan; one-tap email and WhatsApp to them | Bank NOC letter and sending photos automatically (**Decision 5**) |
| C1 | Automatic UTR matching to the buyer, per-flat virtual account | Built for bank statement imports (match by amount and reference). Virtual accounts need the bank | Same | **Decision 1** |
| C2 | 1% buyer TDS (s.194-IA): split every instalment, hold credit until Form 16B / challan | A "TDS" figure could be typed on a receipt and counted at once | **Built**: on flats at or above the threshold (default Rs 50 lakh) the TDS part is held as "pending" and counted as received only after Accounts verify the Form 26QB acknowledgement; possession is blocked while any is open; reversing a receipt cancels it | None. Rate and threshold are Settings |
| C3 | Two-way Tally / SAP sync | Tally vouchers export and a log of what was exported | Same | **Decision 6** |
| D1 | Automatic 70/30 split of RERA collections | Built (RERA account screen, designated money, completion estimate) | Same | None |
| D2 | Withdrawals gated by Form 1, 2 and 3 certificates | Built (architect, engineer and CA certificates; CA limit; age limit; completion cap; never below zero) | Same | None |
| E1 | Collecting over 10% without AFS | See A3 | See A3 | None |
| E2 | Over-withdrawing the 70% account | Built (see D2) | Same | None |
| E3 | Uncollected buyer TDS | See C2 | See C2 | None |
| E4 | Interest waivers and back-dated receipts | A waiver needed the Owner's approval; a receipt could carry any date | **Built**: a receipt cannot be dated in the future or more than 7 days back (`sales.receipt_backdate_days`) except by the Owner with a written reason, which is recorded | Owner approval PIN on each waiver (**Decision 7**) |
| E5 | Cancellation waterfall (forfeiture, GST, broker commission) | Cancel, then a refund with forfeiture capped at 10% and Owner approval | Same | **Decision 2** |
| E6 | Bank follow-up: flag a bank-funded demand unpaid past 10 days and escalate to the project coordinator | Not built | **Built**: "Bank follow-ups" list (setting `sales.bank_followup_days`, default 10) with one-tap email to the manager and to the coordinator | None |
| F1 | Escalation ladder: 3 days before, Day 1 overdue, Day 15 interest notice | Interest is calculated; no reminders to buyers | **Built**: Collections, "Follow up": three lists with one-tap WhatsApp messages, interest shown on the 15+ list | Sending without a person tapping (WhatsApp API is paid) |
| F2 | Cash-flow forecast, 30/60/90 days | Cash flow report (scheduled against actual by month) | **Built**: Collections, "Next 90 days": what falls due in each window, stages not yet certified, home-loan money still to come | None |
| F3 | Buyer WhatsApp bot ("Ledger", "Receipt") | Buyer statement link (expiring, revocable) exists | Same | **Decision 1** |

## Decisions needed (nothing below was built)
1. **Payment links and WhatsApp bot.** Virtual account numbers per flat come from your bank (usually a paid service, set up by the bank). A WhatsApp bot needs the WhatsApp Business API (paid). Free option: print a UPI QR and link on every demand letter from the RERA collection account's UPI ID, and buyers use the existing statement link. Do you want the UPI QR on demand letters? If yes, what is the collection account's UPI ID?
2. **Cancellation waterfall.** The document deducts broker commission from the buyer's refund. That is a legal question (the agreement and MahaRERA rules decide what may be kept). Please ask your advocate which deductions are permitted, then tell me the list. Until then the refund keeps its 10% forfeiture cap and Owner approval.
3. **Buyer KYC by link.** Your own rule keeps Aadhaar masked and never stored in full. A buyer upload page would receive full photos of Aadhaar and PAN. Options: (a) PAN photo and address proof only, no Aadhaar image; (b) staff keep entering KYC as today. Which?
4. **Allotment letter.** Send me your advocate's approved MahaRERA allotment letter (Word or PDF). I will build the printable letter from it, with the payment schedule filled in. I will not invent the legal wording.
5. **Bank NOC and the loan pack.** Same: send the NOC wording your bank accepts, and say whether the progress photos should be attached to the email by hand (one-tap email opens ready) or stored with each slab.
6. **Two-way Tally.** Today the CRM exports vouchers and keeps a log. True two-way sync needs a small program on the computer that runs Tally. Do you want that, and which Tally (Prime or ERP 9)?
7. **Owner approval PIN on interest waivers.** The document asks for an OTP; your Owner already has an approval PIN used elsewhere. Use the PIN for every waiver, including the Owner's own? (Recommended.)

## Answers received (2026-11-24) and what was built in step 2
1. Demand letters: a custom letter for each milestone, in Word, downloadable, with a box to mark it sent by hand. Built (templates per stage or general; Word download; "Sent by hand" box). Payment links and a WhatsApp bot were not asked for and are not built.
2. Cancellation: broker commission may be deducted; follow the RERA refund rules. Built as a calculator that keeps everything kept (booking amount, brokerage, admin charge) inside the 10% limit and the balance due in 45 days, as the MahaRERA model agreement describes. Both numbers are Settings: confirm them with your advocate. GST on instalments is adjusted by credit note, not deducted. If your agreement lets you keep brokerage in addition to the 10%, change sales.cancel_cap_bp.
3. KYC: staff enter it, as today. No buyer upload page.
4. Allotment letter: upload a general letter (Word with {{placeholders}}) or type one; each customer's copy is editable and downloads as Word; "Sent by hand" box. Built.
5. Tally Prime two-way: not yet built. Plan: a small program (one file, no installation beyond Node.js) runs on the computer that has Tally Prime open, with Tally's XML port switched on. Every few minutes it asks the CRM for vouchers not yet in Tally, posts them to Tally on localhost, and reports back success or the error. It uses a token you create in Settings, and it can be switched off. Needs: Node.js on that computer, Tally's port enabled, and the ledger names in Tally matching the CRM's map (already in Tally settings). Say go and I will build it as step 3.
6. Interest waivers: Owner approval PIN on every waiver. Built.
