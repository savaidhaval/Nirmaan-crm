# Sell.Do vs NirmaanCRM (corrected against the build guide)
Prepared 2026-11-22 for Dhaval Savai. Replaces the earlier version.

## 0. Basis and status labels
- **Source of truth:** `NirmaanCRM_Claude_Build_Guide_v1.3.md` (v1.3, 21 Nov 2026; 2,022 lines; migrations 0001-0009, plus an optional 0010_gdrive.sql if 0009 v1.2 was already applied, §5). Section numbers (§) refer to it. All of it was read.
- **Sell.Do side:** vendor-described pages only (see the earlier Sell.Do report). Treat its claims as vendor claims.
- **Status labels:** **In guide (spec'd)** | **In guide, partial** | **Built (schema only, from backup)** | **Not in guide** | **N/A** (not relevant to MRI). "Built (schema only)" means the table exists in `nirmaan-backup-2026-11-22.json`; the backup holds no data for it.
- **Relevance:** Sell.Do is for sale-led developers (leads, portals, brokers). MRI's core is redevelopment (society/member consent, rehab, project work), so each row flags relevance. User answers applied: labour via contractors; accounting = Tally export only; 51% consent is the redevelopment threshold (member-document list still pending).

### Guide vs backup (differences)
- **In the guide, missing from the backup export:** `sal_brokerage_payments`, `ppl_staff`, `ppl_hiring`, `ppl_candidates`, `email_log`, `backup_log`, `notifications`, `sessions`, `otp_codes`, `rate_limits`, `counters`, `file_blobs`, `project_members`, `brand_profiles`, `share_links`, `drive_folders`, `oauth_states`. The `settings` table is not exported either, though the audit log shows setting changes. Several (sessions, OTP, rate limits, OAuth state) are probably left out on purpose; I cannot tell which are absent from the database and which only from the export.
- **Columns:** the backup's `users` has none of the 0009 columns (`extra_roles`, `must_change_password`, `is_primary_owner`, ...) and `documents` is empty, so I cannot tell whether 0009 is applied. The backup `projects` has two columns the guide's §5 does not: `brand_id` and `percent_complete`. The guide has `brand_profiles(project_id)` instead of a `brand_id` on projects, so the app and spec have diverged (needs a DATA_DICTIONARY note, Master Prompt rule 7).
- **In the backup, not in the guide:** only those two project columns. Tables in the backup that match the guide: projects, apr_items/events, drw_*, site_*, pro_* (7), sal_* (9 of 10), documents, audit_log, users.
- **Data present:** 1 owner user, project "Shivneri Heights" (SHIV-A, `new_build`, planning), 27 approvals rows (the guide's 27-row Mumbai template, non-redevelopment variant), 28 audit rows (two "Google Drive connected" events, 41 minutes apart on 21 Nov). Every sales, site, drawing and procurement table is empty.
- **Settings seen in the backup audit log:** `po.pm_approval_limit_paise`, `access.allow_second_owner`, `sales.share_all_leads`, `demand.due_days_after_milestone`, `share.default_expiry_days`, `files.brochure_max_mb`. All are in the guide except `demand.due_days_after_milestone`, which the guide describes ("+7 days (setting)", §7.6) without naming the key.

## A) Feature comparison
Columns: Sell.Do | NirmaanCRM status (guide ref) | Gap or advantage | Priority for MRI (relevance in brackets). "Excluded?" notes the guide's §1 list of what it deliberately does NOT build: full accounting, payroll, native apps, WhatsApp Business API, BI dashboards with 30 charts, multi-company. Anything else missing is simply not specified (and the ₹0 rule, §2 rule 6, rules out paid services).

### Lead capture and routing
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Auto-capture from 99acres, MagicBricks, Housing, Meta/Google ads, web, missed calls; dedup | **In guide, partial** (§7.6): 30-second manual fast-add; `source` list includes portal_99acres/magicbricks/housing/broker/referral/walkin/website; duplicate-phone merge on +91 number; DPDP consent tick stores `consent_at`. **Not in guide:** portal, ad or form connectors. Not on the §1 exclusion list | Gap: manual entry. Dedup and consent are covered | Low-Med (sale-led; MRI sells few units) |
| AI lead scoring, voice agents, call analysis | **Not in guide** | Gap; skip for now | Low |
| Routing (round-robin, skill/project/language, capacity), SLA timers, escalation, reassign | **In guide, partial** (§7.6, §7.1): round-robin among sales users; SLA nudge at 1 working hour to assignee, 4 hours to PM; working-hours setting; follow-up due reminders hourly. **Not in guide:** skill/project routing, automatic reassignment (only on user deactivation, §4.6) | Parity for a 5-20 person team | Low |
| Mandatory next follow-up discipline | **In guide** (§7.6: next follow-up required to save a call outcome) | Sell.Do offers automated follow-ups; this is simpler and enforceable | Med |

### Telephony and messaging
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Cloud dialer, click-to-call, recordings, masking, missed-call capture | **Not in guide** (only one-tap `tel:` call buttons on lead pages, §6.2) | Gap; paid telephony conflicts with ₹0 | Low |
| WhatsApp Business API, flow builder, shared inbox | **Deliberately excluded** (§1, §1.1, FAQ). Instead: free `wa.me` one-tap share with pre-written text (§6.1) | Conscious trade-off; no automation or inbox | Low (excluded) |
| SMS (DLT), RCS, drip campaigns | **Not in guide** | Gap | Low |
| Email, templates, tracking | **In guide** (§7.8): company SMTP over sockets or Brevo fallback, queue, retry, send log, attachments, editable templates; no open/click tracking | Advantage: owned, free; no marketing sends | Med |

### Site visits
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Schedule and confirm visits, GPS geo-fence check-in (200 m), structured feedback, no-show guard, visit-to-booking by project/rep | **In guide, partial** (§7.6, §5 `sal_visits`): schedule date/time and project, 2-hour reminder to assignee, status scheduled/done/no_show/cancelled, free-text feedback, day-list on sales home. **Not in guide:** geo-fence, structured feedback fields, auto-confirm; the funnel report counts stages, not visit-to-booking | Gap: verification and analytics | Low-Med (sale-led) |

### Inventory, cost sheets, negotiation
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Project-tower-unit grid with live status, atomic expiring holds | **In guide** (§7.6, §5): wing x floor grid; colour + word status (available/blocked/booked/agreement/registered); "Block for 48h" with cron auto-expiry (`blocked_till`); a database unique index refuses a second active booking per unit (`uq_booking_one_active_per_unit`). **Gaps:** no `blocked_by`/lead column (the hold is not tied to a person); no unit category for rehab/transit units | Parity on double-booking; weaker hold ownership | Med (needed for free-sale units; redevelopment adds a rehab unit category) |
| Versioned cost sheets (floor rise, PLC, parking, GST, stamp duty), AI compliance check | **Not in guide.** Only `price_paise` + `floor_rise_paise` on the unit, typed `agreed_price_paise` on the booking, and GST rate per booking (`gst_bp`, §7.6) | Gap | Med |
| Negotiation with approval chain (discount bands, margin impact) | **Not in guide for sales.** Maker-checker exists only for purchase orders (§7.5, PM limit `po.pm_approval_limit_paise`) | Gap; the PO pattern can be reused | Med |
| Property match, availability ranked by fit | **Not in guide** | Skip | Low |

### Channel partners
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Self-registration, KYC/RERA verification, e-sign, partner portal, lead-ownership rules, tiers | **In guide, partial** (§7.6, §5): partner master (firm, contact, RERA no., default brokerage in bp), booking links a partner, brokerage-payable report, `sal_brokerage_payments` with TDS (s.194H, "confirm with CA"). **Not in guide:** partner login/portal, onboarding, lead-ownership rules (the guide gives customers and external parties no login, §2 rule 15) | Parity on brokerage payouts with TDS; no portal | Low-Med |

### Booking, demands, collections (post-sales)
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Booking with co-applicants, token, agreement | **In guide** (§7.6): flat + lead, customer details, PAN restricted, Aadhaar masked only, token counts toward stage 1; cancellation (reason required) releases the flat and keeps receipts. **Not in guide:** co-applicants, loan details | Parity (single applicant only) | Med |
| Construction-linked payment plans; demands from certified milestones | **In guide** (§7.4, §7.6, §5): CLP stages in basis points (must total 10000, remainder to last stage), `milestone_key` link, site "Done" emits `milestone.done`, demands go scheduled -> ready, due = done + 7 days (setting), `demand.ready` notification | Parity or better on exact paise maths and the site-to-sales event link; the guide does not describe "certified" (architect-certified) milestones, only site-marked | High if MRI sells units; N/A for member rehab |
| Bulk demand letters by email and WhatsApp | **In guide, partial** (§7.6): letter template with placeholders; staff open the print view, Save as PDF, upload it per demand, then email with the PDF attached or WhatsApp text. No bulk generation or send | Gap at scale (one manual PDF per demand) | Med |
| Receipts with TDS, maker-checker, reversal | **In guide, partial** (§7.6): receipt with mode/ref/date and customer TDS (1%, s.194-IA, Form 26QB reminder); demand partial/paid by cash + TDS; bounced or wrong entry reversed, never deleted. **Not in guide:** maker-checker on receipts; receipt/demand number series (only POs use `counters`) | Receipt numbering is unspecified | High (numbering) |
| RERA 10% advance warning; RERA escrow calculation | **In guide, partial** (§7.6): red warning if money before the registered agreement exceeds 10% of price; 70% designated-account compliance is a reminder row only (Appendix A #23); MahaRERA quarterly reminder (§7.1) | Warnings and reminders only; no escrow maths | Med |
| Ledger, ageing, credit notes, parking/add-on swaps | **In guide, partial** (§7.9): receivables ageing 0-30/31-60/60+. **Not in guide:** credit notes, adjustments, parking/add-ons | Gap | Low |
| Online collection (Razorpay/UPI), UTR/bank reconciliation | **Not in guide** (receipt `mode` field only: cheque/neft/rtgs/upi/cash). Gateway fees conflict with ₹0 | Gap | Low |
| Registration, loan, possession, handover | **In guide, partial** (§5): `agreement_date`, `registration_date`, booking status agreement/registered, flat status registered; documents attach. **Not in guide:** possession/handover checklist, loan tracking, per-unit snags (snags are project-level, `site_snags` has wing/location only) | Gap at the end of the flow | Med |

### Buyer portal, reports, mobile, AI
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| White-label buyer portal (ledger, payments, handover) | **Not in guide.** Customer portal is only a roadmap row (§1.1) and conflicts with §2 rule 15 (customers never get a login). Closest: expiring, revocable share links for brochures (§7.10) | Gap; a statement via share link would respect rule 15 | Low |
| 100+ reports, role dashboards, natural-language queries | **In guide, partial** (§7.9): ~8 report groups (funnel by source/person, response time, receivables ageing, receipts register, brokerage payable, purchase register, DPR register + labour totals, milestone delay, approvals sheet, export-everything); 6-tile owner dashboard; 8 AM digest (§7.8, App. C). BI with many charts is excluded (§1) | Advantage: tailored and simple; gap: no custom builder | Med |
| Native iOS/Android with GPS, OCR, voice notes | **Native apps excluded** (§1). **PWA** with offline DPR, photo queue in IndexedDB, `client_uuid` dedupe, "Add to Home Screen" (§6.3, §6.5); site engineer home = 3 big buttons | Advantage: offline-first and free; no GPS/OCR | Med |
| 60+ integrations, REST API, webhooks, ERP/SAP, Salesforce | **In guide:** Google Drive (Mode G), SMTP/Brevo, wa.me, Tally CSV (§7.9). Tally XML is a roadmap row only (§1.1). **Not in guide:** API, webhooks, portals, telephony, payment gateways | Gap by design | Low |
| Jarvis AI (scoring, next-best-action, voice) | **Not in guide** | Gap | Low |

### Access, branding, storage, security
| Sell.Do | NirmaanCRM status | Gap / advantage | Priority |
|---|---|---|---|
| Roles, dashboards by role, SSO/white-label (enterprise) | **In guide** (§4.5, §4.6): 8 fixed roles + extra roles (union), Owner as admin with server-enforced safeguards (always one active Owner, primary owner protected, nobody edits own role, second Owner optional), project-wise access (`project_members`), temporary password + forced change, OTP email login, "log out everyone", field-level hiding of PAN/bank, audit log in plain sentences (§7.1) | Parity or better for a small firm | High (done in spec) |
| White-label branding | **In guide** (§7.10, §5 `brand_profiles`): logo, colours, signatory, signature/stamp (private, issued documents only), 3 letterhead modes, DRAFT watermark, per-project override incl. RERA collection account | Advantage: free; on every PO, demand and receipt | Med |
| Brochures and sharing | **In guide** (§7.10): brochure library with versions, customer-shareable flag, expiring/revocable `/s/<token>` links, view counted only on Open, `share.viewed` alert | Advantage | Med |
| Document/KYC storage | **In guide** (§3.4, §7.1): Google Drive (Mode G) via `drive.file`, streamed uploads, nightly integrity check, R2/D1 options; **Built (schema only):** `documents` table | Advantage: owned. Risk: OAuth audience/expiry (see C) | High |
| Backups | **In guide** (§11.1): nightly chunked backup to Drive, D1 Time Travel (7 days free), monthly ZIP to laptop, restore drill | Advantage; the Drive copy does not protect against losing the Google account | Med |
| Data protection | **In guide** (§11.3): DPDP consent, masked Aadhaar, privacy page, retention via CA | Parity | Med |

### Not offered by Sell.Do, in Nirmaan (advantages)
| Feature | NirmaanCRM status | Relevance |
|---|---|---|
| Statutory approvals and compliance tracker (29-row Mumbai template: MCGM, IOD, CC, Fire, AAI, MahaRERA, OC; reminders, renewals re-arm) | **In guide** (§7.2, App. A); **Built (schema only, with data):** `apr_items` 27 rows loaded | High for MRI |
| Drawing register with revision control (one live IFC per drawing, site sees latest only) | **In guide** (§7.3); **Built (schema only)** | High |
| Site DPR, milestones, snags, RFQ-to-bill procurement | **In guide** (§7.4, §7.5); **Built (schema only)** | High |
| Redevelopment: society/member consent, rehab, transit rent | **In guide, partial:** `projects.type` includes redevelopment; the approvals template has two redevelopment rows (★5 society consent and DA registration, ★6 transit-rent and bank guarantee, App. A); **no society/member registry or consent-% tracker** | High; the main true gap (Sell.Do also lacks it) |

## B) Process comparison (Sell.Do's 9-step flow vs NirmaanCRM)
| # | Sell.Do step | NirmaanCRM in the guide | Gap / suggested addition |
|---|---|---|---|
| 1 | Capture: portals, ads, WhatsApp, missed calls; dedup; score | Manual fast-add lead with source; duplicate-phone merge; DPDP consent (§7.6) | Optional web form or email-to-lead later; scoring not needed |
| 2 | Route and SLA | Round-robin auto-assign; 1h/4h SLA nudges within working hours (§7.1, §7.6) | None for 5-20 users |
| 3 | Qualification: calls, nurture, stage funnel | Activity log, call outcome + required next follow-up date; stages new/contacted/site_visit/negotiation/booked/lost (§5, §7.6) | WhatsApp is manual one-tap, no drip |
| 4 | Site visit: schedule, geo check-in, feedback | Schedule + 2h reminder, done/no-show, text feedback (§7.6) | Structured feedback fields; optional browser geolocation tag |
| 5 | Inventory hold, cost sheet | Unit grid; block 48h auto-expire; price + floor rise (§7.6) | Add `blocked_by`; cost sheet (PLC, parking, stamp duty, GST) |
| 6 | Negotiation and approval | Agreed price typed at booking; no negotiation record; no discount approval | Add discount request with PM/Owner bands (reuse the PO limit pattern) |
| 7 | Booking | Booking flow, token, PAN/masked Aadhaar, schedule generated paise-exact; double-booking refused; cancellation frees the flat (§7.6) | Co-applicants; booking confirmation letter number |
| 8 | Demand, collection | Site milestone done -> demands Ready -> review, manual PDF, send; receipts with TDS; partial/paid; reversal; ageing; RERA 10% warning (§7.4, §7.6, §7.9) | Receipt/demand number series; maker-checker on receipts; bulk send; payment reconciliation (bank CSV) |
| 9 | Registration, possession | Agreement and registration dates, statuses, documents; "Society formation/conveyance" and OC rows in the approvals template (App. A) | Possession/handover checklist, per-unit snags, loan details |
| (pre-step, not in Sell.Do) | Redevelopment: society consent, member agreements, rehab, transit rent | Two approvals rows only (App. A ★5, ★6) | Society/member registry, consent-% tracker (default 51%, configurable), rehab/PAP allotment, rent/corpus ledger. Member-document checklist: pending Dhaval's list |

## C) Summary
**Top 5 gaps worth adding (sales side; redevelopment and construction items are in the second file)**
1. Society/member registry with a consent-% tracker (51% default, configurable) and rehab/transit-rent ledger: MRI's core work, uncovered by guide and Sell.Do alike.
2. Cost sheet (floor rise, PLC, parking, stamp duty, GST) plus discount-approval bands, reusing the PO approval-limit pattern.
3. Receipt and demand number series plus maker-checker on receipts (printed legal documents currently have no sequence).
4. Possession/handover and registration checklist per unit, with unit-level snags.
5. Lead capture helper (public enquiry form, optionally portal emails) and hold ownership (`blocked_by`), only if MRI actually sells free-sale units.

**Top 3 things Nirmaan does better or differently**
1. Statutory approvals and RERA compliance calendar with the Mumbai template: Sell.Do has nothing equivalent.
2. One spine for site, drawings, procurement and sales, linked by events (slab done -> demands Ready), with exact paise maths and database-level double-booking refusal.
3. ₹0 running cost, data ownership (D1 + your Drive, full export), offline-first PWA, and owner safeguards, built for a non-technical site team.

**Open questions for Dhaval**
- Does MRI sell free-sale units (needs items 2-5) or mainly rehab plus a few sale units?
- Consent: counted by members (head-count) or by carpet area? Is the 51% to be checked per society? (Left configurable; the member-document list will follow later; none invented here.)
- Is the Google OAuth audience staying in Testing (weekly reconnect)? See guide issues in the construction file.
- Are demand letters sent in volume (bulk send needed)?
- Should the app's extra `projects.brand_id` / `percent_complete` columns be recorded in the guide's data dictionary?
