# Architecture & security audit — NirmaanCRM (Mumbai developer workflows)

Scope: the whole repository (Cloudflare Worker + D1 + vanilla JS). Status as of this PR.
**Fixed** = implemented and covered by an automated test. **Open** = not built, with the reason.

> Platform note. The prompt assumes Postgres. This system runs on Cloudflare D1 (SQLite) and Workers, so
> Row-Level Security, `SELECT … FOR UPDATE` and Zod do not exist here. Equivalents used instead: server-side
> project scoping in one function (`visibleProjectIds`), single conditional `UPDATE`s whose row count decides a race,
> and explicit validation in each route. This is called out where it matters.

## Phase 1 — Missing Mumbai / Indian real-estate features

| Area | Status |
|---|---|
| RERA carpet area on every flat; price per sq ft on RERA carpet; cost sheet shows it | **Fixed** (`rera_carpet_sqft`, stacking plan, cost sheet) |
| Demand letters (print + email), receipts (print) | Already built; now numbered receipts |
| Allotment letter / Agreement for Sale generation | **Open.** The Agreement for Sale must follow the MahaRERA model text and be settled by your advocate; I will not ship legal text. Add it as a Word template in Drive and send to customers via Shared links. |
| 70/30 designated-account routing | **Fixed**: every receipt carries an account (`rera_designated` default); only Owner/Accounts may route outside it; the Cash-flow report shows % deposited vs the 70% rule and the shortfall |
| Stamp duty 5% + 1% metro cess, women concession, registration 1% capped at ₹30,000, 5% GST | **Fixed**: `POST /api/sales/cost-sheet`, rates editable in Settings, printed on the cost-sheet screen. Estimate only; confirm with your CA |
| Redevelopment: rehab vs free-sale segregation | **Fixed**: flats have a kind (rehab/sale); rehab flats cannot be sold; stacking plan shows them |
| Redevelopment: member corpus, rent/transit tracking, hardship allowance | **Open.** A separate member ledger module; needs your society agreement terms before modelling |
| Channel partner: 48-hour holds, first-registration-wins | **Fixed**: holds (max 48h), lead registration by partner, duplicate numbers refused in any format |
| MahaRERA broker registration *verification* | **Open.** The RERA number is stored; there is no public API to verify it automatically |
| OTP-verified site-visit tagging | **Open.** Needs an SMS/WhatsApp gateway account (DLT-registered templates in India) |
| Commission/GST payout ledger | **Partly fixed**: brokerage earned vs paid per partner, payments with TDS. GST on commission is not computed |
| Webhooks: 99acres / MagicBricks / Housing / Meta | **Fixed (generic)**: signed (`HMAC-SHA256`, timestamp, replay-safe) `POST /api/webhooks/leads/:source`; set the `WEBHOOK_SECRET` secret. Each portal's own payload format still needs a small adapter once you have their documentation |
| Official WhatsApp Business API acknowledgements and CLP reminders | **Open.** Needs a Meta WABA account + approved templates; wa.me links are built into the lead screen meanwhile |

## Phase 2 — Functional / architectural gaps

| Finding | Status |
|---|---|
| Two reps holding/booking the same flat | **Fixed.** One conditional `UPDATE … WHERE status = 'available'` decides the winner (0 rows changed = 409). The unique index `uq_booking_one_active_per_unit` stays as the last line. Tests fire 3 simultaneous holds and 4 simultaneous bookings and require exactly one winner |
| Holds that never expire (hoarding) | **Fixed.** 48h maximum, hourly expiry job, per-rep cap (5), conversion needs a token, only a manager can extend (with a reason) |
| No audit of price overrides, floor-rise, plan changes | **Fixed.** Rate-card price changes need a reason and are logged; discounts need a reason and are logged with list vs agreed and approver; plan changes log before/after; booked flats' prices are frozen |
| **Bug:** changing a payment plan after any booking crashed (foreign key) | **Fixed.** Old stages are retired, never deleted |
| Lead lifecycle had no rules | **Fixed.** Explicit transition table; "Booked" only through booking; reopening a lost lead is manager-only |
| Cancellation without refund control; no unit transfer | **Fixed.** Refund request → Owner approves (not the requester) → Accounts pays with a reference; forfeiture ≤ 10%; refund + forfeiture ≤ amount paid. Transfer is manager-only and audited |
| Unvalidated payloads | **Mostly fixed.** Length/type bounds on the money and lead routes, 1 MB JSON cap, magic-byte check on uploads. A schema library is not used; remaining low-risk routes still validate field by field |
| N+1 queries | Reviewed. Lists use joins/aggregates; the per-project inventory fetch on the Sales screen is bounded by project count. Indexes added for stacking grid, hold expiry, lead phone, receipts |
| Missing error boundaries / leaked errors | **Fixed.** Every route's catch now returns a generic message with a short reference; detail goes to `wrangler tail` |
| Audit log editable | **Fixed.** Database triggers reject UPDATE/DELETE on `audit_log`; filters + search on the Audit screen |

## Phase 3 — Security (white-box)

| Item | Status |
|---|---|
| Session handling | Tokens are now stored hashed; cookie is HttpOnly + Secure + SameSite=Lax. **Open:** refresh-token rotation and TOTP MFA (the emailed code is the second factor option) |
| Brute force | Per-email (5/15 min) **and** per-IP (40/15 min) login limits; OTP send/verify limits; share-link IP throttle; webhook throttle. Only failures count |
| RBAC | Central matrix (`permissions.js`) enforced server-side on every route; tests cover each role boundary |
| BOLA / IDOR | Project scoping in one function; lead access checked per lead (rep sees own); documents checked per project; **buyer KYC/legal/agreement documents restricted to Owner/PM/Sales/Accounts**; internal brochures blocked by id. 57 + 78 automated checks |
| Row-level security | Not available on D1. App-level scoping replaces it; no query path bypasses `visibleProjectIds` (the stale duplicate was removed) |
| Injection | All SQL is parameterised; dynamic fragments are built from fixed column lists or `Number()`-coerced ids. Output is HTML-escaped everywhere and CSP forbids inline scripts |
| CSRF | Required `X-NirmaanCRM` header on every state change; no CORS |
| SSRF | No server-side fetch of user-supplied URLs (only Google/Brevo/Cloudflare endpoints) |
| Unauthenticated webhooks | The only public write endpoint is the signed lead webhook (HMAC + timestamp + replay table + rate limit) |
| Env/secrets/source maps | Secrets live in Worker secrets; no source maps are published |
| PII at rest | Customer PAN encrypted (AES-GCM) and masked everywhere incl. exports; brand PAN/bank encrypted. **Open:** phone/email are plain (needed for search). Aadhaar is never collected |
| Upload safety | Allow-list + magic-byte match; no SVG/HTML; size caps; KYC category restricted |
| Stack traces | Fixed (see above) |

## Phase 4 — Fraud vectors

| Vector | Control now in place |
|---|---|
| Lead poaching / CP hijack | First registration wins; phone matching ignores formatting (+91, 0, spaces); phone change = Owner only + reason + audit; reassign = manager + reason + audit; created-at is never editable |
| Cost-sheet tampering / unauthorised discount | Rate card is the baseline; reason mandatory; rep ≤ 1%, PM ≤ 3%, Owner unlimited (settings); every override logged; "Discount leakage" report lists them with approver |
| Waiving late interest on CLP | **Open.** Interest is not computed yet; once it is, waivers must go through the same approval |
| Inventory hoarding | See holds above |
| Fake receipts | Sales reps can no longer record receipts (Accounts/PM/Owner only); receipts are sequentially numbered; duplicate cheque/UTR refused; cash ≥ ₹2,00,000 refused (s.269ST); reversal = Owner only, with reason, logged; nothing can be deleted |
| Funds outside escrow | Account is recorded per receipt; Cash-flow report shows the 70% test; routing outside needs Owner/Accounts |
| Cannot defend | An Owner with database access can still alter data. The trail protects against the application's users, not against someone holding the Cloudflare account |

## Phase 5 — Executive reporting (built)
Stacking plan (wing × floor, Available / Token locked / Booked / Registered / Rehab, drill-down with hold/book/cost sheet) ·
Cash-flow (due vs collected by month) with the 70/30 escrow gauge · Receivables aging buckets + biggest overdue ·
Marketing & channel-partner ROI (cost per lead / visit / booking from monthly spend you enter; partner net realisation) ·
Sales velocity (absorption by configuration and floor band, realisation vs rate card) with a discount-leakage list.

## Verification
`node tests/security.mjs` (57), `features.mjs` (28), `multibrand.mjs` (25), `sales2.mjs` (18), `audit.mjs` (78), `reports.mjs` (16)
against a local instance; `wrangler deploy --dry-run` for production and staging.
