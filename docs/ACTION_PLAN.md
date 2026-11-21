# Action plan: late interest + the five missing essentials

Chosen after the Mumbai audit (docs/AUDIT.md). Order = dependency order. Every item ships with API, screen, tests (`tests/phase2.mjs`) and a migration (`0012`).

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 0 | **Late-interest accrual** on overdue demands | RERA s.18 / agreement clause: buyers pay interest on delay; today it is tracked by hand | Done |
| 1 | **Bulk CSV import** (flats, vendors, leads) | Nobody keys 300 flats by hand; blocks go-live | Done |
| 2 | **Two-step sign-in (TOTP + recovery codes)** | Owner/Accounts accounts hold money data; password-only is too weak | Done |
| 3 | **Project financials** (budget vs committed/billed/paid, collections, margin, RERA withdrawal estimate) | Owner's first question: "am I over budget, how much can I withdraw?" | Done |
| 4 | **Vendor bill GST/TDS + TDS payable report + Tally CSV** | TDS default = interest + penalty; CA needs vouchers | Done |
| 5 | **Customer statement of account + DPDP find/export/erase** | Needed for loans/disputes; DPDP Act duty | Done |

## Design decisions
- **Interest**: simple interest per day, `rate_bp` setting (default 11% = SBI MCLR + 2%), `grace_days`, can be switched off. A part-paid demand charges the paid part only until its receipt date. Interest receipts (`kind='interest'`) never count as principal, never settle a demand, never feed the 70% RERA split. Waivers: Owner direct, PM/Accounts request, Owner approves (not own requests); always with reason; audited.
- **Import**: server validates every row; `dry_run` shows problems with row numbers; invalid rows are skipped, never half-saved. Chunked from the browser (free-plan subrequest limit). Same duplicate rules as the forms.
- **MFA**: RFC 6238 TOTP, SHA-1, 30 s, ±1 window, replay-proof (a step is usable once), 10 one-time recovery codes (stored hashed), challenge token expires and dies after 5 wrong tries. Owner can require it per role and reset a lost device. Enforcement blocks the API (not only the UI) until enrolled.
- **TDS**: on taxable value (bill − GST); 20% if vendor has no PAN (s.206AA); due 7th of next month (30 April for March); challan recorded by Accounts/Owner.
- **DPDP**: erase only cancelled/old records; personal fields blanked, money rows kept; reason mandatory; audited. Export omits PAN/bank.

## Still open (see docs/AUDIT.md)
Email (kept pending by decision), Agreement-for-Sale template, redevelopment member corpus, portal adapters, WhatsApp API, OTP visit tagging, MahaRERA broker verification.

## Go-live steps after merge
Deploy applies migration 0012 automatically. Then: Owner opens **Two-step sign-in** and enrols; sets **Require it for** `owner, accounts`; sets project completion % and budget in **Finance**; confirms the interest rate with the advocate.
