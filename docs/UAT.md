# UAT script — run once before go-live (about 60 minutes)

Use a real phone for the site steps. Tick each line. Anything that fails: note the screen and the exact text.

## 1. Owner
- [ ] Sign in, choose your own password (10+ characters).
- [ ] Branding: company details saved; logo uploaded; letter style chosen; "How your letters will look" printed on paper — text clear of artwork.
- [ ] Storage: Connected; **Test upload** says "Works".
- [ ] Email: test email arrives from your sender address; sign out and sign back in with **only an emailed code**.
- [ ] Projects: create one, load the Mumbai checklist (27 rows, 29 for redevelopment).
- [ ] Approvals: mark IOD Applied with a date; set CC valid-till 20 days out → "expiring" banner shows.
- [ ] Users: add Ramesh (site) with the project; copy the temporary password.

## 2. Site engineer (Ramesh, own phone)
- [ ] Signs in, is forced to choose a password.
- [ ] Sees only his project and the Site / Drawings screens. `/api/sales/leads` in the browser says "Not allowed".
- [ ] Files a work report with 2 photos in under 2 minutes.
- [ ] Airplane mode: files another report, photos attached → "saved on this phone". Turn network on → it sends once, no duplicate.
- [ ] Switches to मराठी; the site screens read Marathi.
- [ ] Drawings: owner issues R1 then R2 as IFC; Ramesh sees only R2; the API refuses R1.

## 3. Purchasing
- [ ] Vendor + RFQ with 3 quotes → lowest/fastest marked → PO created as Draft.
- [ ] PO total above the PM limit goes to the Owner, not the PM.
- [ ] Creator cannot approve own PO. Owner approves → Print shows the letterhead, signature and stamp (Draft showed DRAFT).
- [ ] Material received (partial, then complete). Add bill; mark paid.

## 4. Sales
- [ ] Payment plan 10/30/60 with milestone key on the 30% stage.
- [ ] Add a flat, book it; try booking again → refused.
- [ ] Mark the milestone done → the 30% demand becomes Ready with due date +7 days.
- [ ] Print demand letter; email it to yourself; record a receipt with TDS; print the receipt.
- [ ] Brochures: upload v1 (customer-shareable), then v2 → v1 under "Older versions". Internal price list does not show for Sales.
- [ ] Send a brochure link; open it on another phone with no login; Owner cancels it → "expired".

## 4b. Sales follow-up
- [ ] Open a lead → Log a call: saving without a next follow-up date is refused.
- [ ] Schedule a visit → it appears under Today; mark Visited with feedback.
- [ ] A new lead left alone for an hour nudges its owner (business hours only); after 4 hours the Owner/PM are told.
- [ ] Channel partner: add one, book a flat through them, record a receipt → brokerage payable = percent of money received.
- [ ] Search (magnifier, top bar) finds a lead, a drawing code, a vendor and a PO.

## 5. People
- [ ] Open a position, add a candidate, move to Interview (time), then Hired → appears in Staff.

## 6. Reports & safety
- [ ] Download receipts CSV; opens in Excel with ₹ amounts intact.
- [ ] More → Everything (backup) downloads; run the restore drill (docs/RESTORE.md).
- [ ] `node tests/security.mjs` and `node tests/features.mjs` pass on staging.

## Phase 2 checks
1. Finance > Late interest: open a booking with an overdue demand; interest shows; PM "Ask to waive" then Owner approves.
2. Record an interest receipt; principal due and the 70/30 split do not change.
3. Import & privacy > Import: upload a 5-row flats CSV with one bad row; bad row listed; others import.
4. Two-step sign-in: enrol with an authenticator, save recovery codes, sign out, sign in with code; try a recovery code once.
5. Finance > TDS: record a bill with 194C 1%; a vendor without PAN gets 20%; record the challan; download Tally CSVs.
6. Booking > Statement of account prints with interest block.
7. Privacy requests: find by mobile, export, erase a cancelled booking.


## UAT: flows added in 2026 (tick each on STAGING, then production)
1. **Menu**: sign in as Owner, PM, Site, Sales, Accounts, HR. Each sees only its groups. Open two groups at once; reload: both stay open.
2. **Install**: top-bar install icon opens steps for iPhone/iPad, Android, Windows, Mac. On Android/Chrome tap Install now.
3. **Offline**: as Site, open Drawings, switch on aeroplane mode, reload (app still opens), raise a snag, switch off aeroplane mode: snag arrives once.
4. **Profile**: add a picture, crop it, save; position and mobile number show on Team (number only to Owner/PM).
5. **Redevelopment**: new society (type Redevelopment project), paste 10 members, mark 6 consented: Owner and PM are notified once; approvals row note appears. Sales cannot open it.
6. **Transit rent**: set rent for a member; 12 months appear; record month 1 paid with a cheque number; reverse it with a reason.
7. **Meetings**: add a meeting with minutes PDF and a next action 2 days ahead; the PM is reminded.
8. **Demand letters**: 25 ready demands emailed in steps; one forced failure retried; print sheet of 10.
9. **Bank statement**: import a 20-row CSV, confirm 3 matches, ignore the rest, import the same file again: nothing is added.
10. **Tally**: set ledger names, export a day of receipts, import it into a TEST company in Tally; totals match the receipt register.
11. **Statement link**: Accounts sends a statement link; the customer opens it with no login; revoke; it says expired.
12. **Drawing seen**: PM issues R2; Site taps "I have seen R2"; PM sees 1 of N; an unconfirmed user is reminded after 24 hours.
13. **Enquiry form**: submit /enquiry with consent ticked: a lead appears (source website); the same number again adds a note, not a second lead.
14. **Dashboard**: Owner home shows Needs your attention; each line opens its list; Insights downloads open in Excel.
15. **Delete**: PM and Accounts cannot delete anything; Owner can.
16. **Backup**: More → Everything backup (3 files) downloads; run the restore drill on staging.

## Agreement, WhatsApp, MahaRERA check, email
1. Letter templates > Agreement for Sale: see "Built-in text: advocate must review". Open a booking > Agreement (Word): the file says DRAFT. Write your own wording, Save, then (as Owner) "Advocate has approved" and type the advocate's name. Download again: no DRAFT line.
2. Booking > WhatsApp: balance / demand / last receipt / agreement ready / thanks. WhatsApp opens with the message ready; nothing is sent until you press Send.
3. Sales > Channel partners > Checked on MahaRERA: look the number up on the MahaRERA website, write what you saw. Paying brokerage before this check is refused with a plain message.
4. More > Email settings: Save, send the test email (arrives in the Owner's inbox), then ask for a login code from the sign-in page.

## Module 5, step 1
1. Snags: open a snag, "Contractor / spot": pick the contractor's work order, add the floor plan picture, tap the spot. "See spot" shows the red dot.
2. Mark that snag fixed: refused until you add an "After photo". Then the PM verifies it.
3. Contractors: release retention on that work order while a snag is open: refused with the number of open snags.
4. A booking: "Possession: six no-dues points". Set corpus and maintenance due, record the money received, upload the signed letter and the undertaking. When all six are green, hand over; then "Possession certificate".
5. Defect helpdesk: log a defect for a flat, give it to the work order. After the time limit, "Repair by outside vendor"; Accounts confirms; check the retention fell by that amount.
6. Society handover vault: load the standard checklist, upload and acknowledge each item; the project can then be set to Completed.

## Module 5, step 2
1. Snags: "Floor-plan library": add the 2BHK plan once. Raise a snag inside a 2BHK flat; "Contractor / spot" opens that plan by itself.
2. A booking: "Issue possession notice" and print it. "Joint inspection link" (works only with zero open snags): send by WhatsApp and open it on a phone, sign, add a touch-up. It appears as a low snag due in 7 days.
3. Possession & handover: "Handover time slots": add a morning. When the six points are green, "Handover time link": open it, pick a time.
4. After possession: add a baseline photo, send the baseline link, sign it; then "Issue fit-out NOC" (deposit must be received).
5. Defect helpdesk: "Complaint QR for residents": scan it with a phone and send a complaint; it appears in the list. Confirm a back-charge and open the numbered debit note.
6. Society handover vault: update the society, add committee members, enter a common-area cost, mark it CA-certified, print the society statement, download the binder.
