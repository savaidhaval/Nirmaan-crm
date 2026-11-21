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
