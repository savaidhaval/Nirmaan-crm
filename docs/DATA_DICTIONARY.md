# NirmaanCRM data dictionary (real schema from migrations 0001-0023, updated 2026-11-22)

Source: replaying migrations/*.sql into an empty SQLite DB. Live D1 not verified (see docs/STATE.md). Money = paise INTEGER, percentages = basis points (_bp). NN = NOT NULL, PK = primary key.

## Drift from guide v1.3
- projects.brand_id, projects.percent_complete
- tables not in guide: brands, mfa_challenges, user_totp, user_recovery_codes, sal_interest_waivers, sal_refunds, mkt_spend, webhook_seen
- pro_bills already has gst/tds columns; sal_inventory.category and sal_receipts.receipt_no already exist

### ai_log
id INTEGER PK, user_id INTEGER, feature TEXT NN, ok INTEGER NN, created_at TEXT
### ai_log
id INTEGER PK, user_id INTEGER, feature TEXT NN, ok INTEGER NN, created_at TEXT
### apr_events
id INTEGER PK, item_id INTEGER NN, event TEXT NN, note TEXT, by_user INTEGER, created_at TEXT
### apr_items
id INTEGER PK, project_id INTEGER NN, name TEXT NN, authority TEXT, category TEXT, stage_order INTEGER, status TEXT, applied_on TEXT, approved_on TEXT, valid_till TEXT, reminder_days INTEGER, renew_months INTEGER, owner_user_id INTEGER, consultant TEXT, fee_paise INTEGER, notes TEXT, created_at TEXT, deleted_at TEXT
### audit_log
id INTEGER PK, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, summary TEXT, created_at TEXT
### backup_log
id INTEGER PK, kind TEXT, status TEXT, cursor_json TEXT, files_written INTEGER, bytes INTEGER, note TEXT, started_at TEXT, finished_at TEXT
### brand_profiles
id INTEGER PK, project_id INTEGER, legal_name TEXT, trade_name TEXT, tagline TEXT, address TEXT, phone TEXT, email TEXT, website TEXT, gstin TEXT, cin_or_llpin TEXT, promoter_rera_ref TEXT, pan_enc TEXT, bank_account_name TEXT, bank_name TEXT, bank_branch TEXT, bank_ifsc TEXT, bank_account_enc TEXT, signatory_name TEXT, signatory_title TEXT, footer_text TEXT, wa_intro_text TEXT, colour_primary TEXT, colour_secondary TEXT, colour_accent TEXT, letterhead_mode TEXT, margin_top_mm INTEGER, margin_bottom_mm INTEGER, margin_side_mm INTEGER, updated_by INTEGER, updated_at TEXT, created_at TEXT, brand_id INTEGER
### brands
id INTEGER PK, name TEXT NN, is_default INTEGER NN, created_at TEXT, deleted_at TEXT
### bud_heads
id INTEGER PK, project_id INTEGER NN, code TEXT NN, name TEXT NN, budget_paise INTEGER NN, sort_order INTEGER NN, created_by INTEGER, created_at TEXT, deleted_at TEXT
### con_contractors
id INTEGER PK, vendor_id INTEGER, name TEXT NN, phone TEXT, trade TEXT, pan_enc TEXT, gstin TEXT, agreement_document_id INTEGER, active INTEGER NN, created_at TEXT, deleted_at TEXT
### con_ledger
id INTEGER PK, contractor_id INTEGER NN, project_id INTEGER NN, wo_id INTEGER NN, kind TEXT NN, amount_paise INTEGER NN, ref_table TEXT, ref_id INTEGER, created_at TEXT
### con_payments
id INTEGER PK, wo_id INTEGER NN, ra_id INTEGER, kind TEXT NN, amount_paise INTEGER NN, paid_on TEXT NN, mode TEXT, ref_no TEXT, note TEXT, reversed_at TEXT, reversal_note TEXT, client_uuid TEXT, created_by INTEGER, created_at TEXT
### con_ra_bills
id INTEGER PK, wo_id INTEGER NN, ra_no INTEGER NN, period_from TEXT, period_to TEXT, due_date TEXT, gross_paise INTEGER NN, retention_paise INTEGER NN, advance_recovery_paise INTEGER NN, other_deductions_paise INTEGER NN, gst_bp INTEGER NN, gst_paise INTEGER NN, tds_bp INTEGER NN, tds_paise INTEGER NN, net_paise INTEGER NN, status TEXT NN, note TEXT, created_by INTEGER, checked_by INTEGER, approved_by INTEGER, approved_at TEXT, cancel_note TEXT, created_at TEXT
### con_ra_lines
id INTEGER PK, ra_id INTEGER NN, wo_item_id INTEGER NN, qty_this_bill REAL NN, rate_paise INTEGER NN, amount_paise INTEGER NN
### con_wo_items
id INTEGER PK, wo_id INTEGER NN, description TEXT NN, qty REAL NN, unit TEXT, rate_paise INTEGER NN, amount_paise INTEGER NN
### con_work_orders
id INTEGER PK, project_id INTEGER NN, contractor_id INTEGER NN, wo_no TEXT NN, scope TEXT, basis TEXT NN, value_paise INTEGER NN, retention_bp INTEGER NN, advance_paise INTEGER NN, status TEXT NN, created_by INTEGER, approved_by INTEGER, approved_at TEXT, decision_note TEXT, created_at TEXT, budget_head_id INTEGER
### counters
key TEXT PK, value INTEGER NN
### documents
id INTEGER PK, project_id INTEGER, module TEXT, entity TEXT, entity_id INTEGER, title TEXT NN, category TEXT, kind TEXT NN, r2_key TEXT, external_url TEXT, blob_id INTEGER, mime TEXT, size_bytes INTEGER, uploaded_by INTEGER, created_at TEXT, deleted_at TEXT, series_key TEXT, version INTEGER NN, is_latest INTEGER NN, supersedes_id INTEGER, audience TEXT NN, language TEXT, store TEXT, drive_file_id TEXT, drive_folder_id TEXT, thumb_drive_file_id TEXT, md5 TEXT, drive_status TEXT NN, drive_checked_at TEXT
### drive_folders
id INTEGER PK, path_key TEXT NN, project_id INTEGER, drive_folder_id TEXT NN, created_at TEXT
### drw_drawings
id INTEGER PK, project_id INTEGER NN, code TEXT NN, title TEXT NN, discipline TEXT, zone TEXT, waiting_consultant INTEGER NN, created_at TEXT, deleted_at TEXT
### drw_revisions
id INTEGER PK, drawing_id INTEGER NN, rev_no TEXT NN, status TEXT, issued_on TEXT, received_from TEXT, note TEXT, document_id INTEGER, issued_by INTEGER, created_at TEXT
### email_log
id INTEGER PK, to_email TEXT NN, subject TEXT NN, body_html TEXT, status TEXT, error TEXT, attempts INTEGER, next_attempt_at TEXT, template TEXT, related_entity TEXT, related_id INTEGER, attachment_document_id INTEGER, provider TEXT, message_id TEXT, created_at TEXT, sent_at TEXT
### file_blobs
id INTEGER PK, mime TEXT, size_bytes INTEGER, data BLOB, created_at TEXT
### mfa_challenges
token_hash TEXT PK, user_id INTEGER NN, expires_at TEXT NN, attempts INTEGER NN, created_at TEXT
### mkt_spend
id INTEGER PK, project_id INTEGER, source TEXT NN, month TEXT NN, amount_paise INTEGER NN, note TEXT, created_by INTEGER, created_at TEXT
### notifications
id INTEGER PK, user_id INTEGER NN, title TEXT NN, body TEXT, link TEXT, read_at TEXT, created_at TEXT
### oauth_states
state_hash TEXT PK, user_id INTEGER NN, verifier_enc TEXT NN, purpose TEXT NN, expires_at TEXT NN, used_at TEXT, created_at TEXT
### otp_codes
id INTEGER PK, email TEXT NN, code_hash TEXT NN, expires_at TEXT NN, attempts INTEGER NN, created_at TEXT
### ppl_candidates
id INTEGER PK, hiring_id INTEGER NN, name TEXT NN, phone TEXT, status TEXT, interview_on TEXT, note TEXT, resume_document_id INTEGER, created_at TEXT, deleted_at TEXT
### ppl_hiring
id INTEGER PK, position TEXT NN, project_id INTEGER, status TEXT, opened_on TEXT, notes TEXT, created_at TEXT, deleted_at TEXT
### ppl_staff
id INTEGER PK, name TEXT NN, role_title TEXT, department TEXT, phone TEXT, email TEXT, joined_on TEXT, employment TEXT, active INTEGER, notes TEXT, created_at TEXT, deleted_at TEXT, trade TEXT, project_id INTEGER
### pro_bills
id INTEGER PK, po_id INTEGER, vendor_id INTEGER NN, bill_no TEXT, amount_paise INTEGER NN, due_date TEXT, status TEXT, paid_on TEXT, payment_ref TEXT, document_id INTEGER, created_at TEXT, project_id INTEGER, taxable_paise INTEGER, gst_paise INTEGER NN, tds_section TEXT, tds_bp INTEGER NN, tds_paise INTEGER NN, tds_deposited_on TEXT, tds_challan TEXT
### pro_grn_items
id INTEGER PK, grn_id INTEGER NN, po_item_id INTEGER NN, qty_received REAL NN, note TEXT, created_at TEXT
### pro_grns
id INTEGER PK, po_id INTEGER NN, received_on TEXT NN, qty_note TEXT, challan_no TEXT, received_by INTEGER, document_id INTEGER, client_uuid TEXT, created_at TEXT, deleted_at TEXT
### pro_indent_items
id INTEGER PK, indent_id INTEGER NN, description TEXT NN, qty REAL, unit TEXT
### pro_indents
id INTEGER PK, project_id INTEGER NN, indent_no TEXT NN, needed_by TEXT, note TEXT, status TEXT NN, requested_by INTEGER, decided_by INTEGER, decided_at TEXT, decision_note TEXT, rfq_id INTEGER, client_uuid TEXT, created_at TEXT, deleted_at TEXT
### pro_party_docs
id INTEGER PK, party_type TEXT NN, party_id INTEGER NN, party_label TEXT, doc_type TEXT NN, valid_till TEXT, reminder_days INTEGER NN, document_id INTEGER, note TEXT, superseded_by INTEGER, created_by INTEGER, created_at TEXT, deleted_at TEXT, kind TEXT NN
### pro_payments
id INTEGER PK, bill_id INTEGER NN, amount_paise INTEGER NN, tds_paise INTEGER NN, paid_on TEXT NN, mode TEXT, ref_no TEXT, note TEXT, reversed_at TEXT, reversal_note TEXT, created_by INTEGER, created_at TEXT
### pro_po_items
id INTEGER PK, po_id INTEGER NN, description TEXT NN, qty REAL, unit TEXT, rate_paise INTEGER, amount_paise INTEGER, budget_head_id INTEGER, stock_item_id INTEGER
### pro_pos
id INTEGER PK, project_id INTEGER NN, vendor_id INTEGER NN, rfq_id INTEGER, po_no TEXT, po_seq INTEGER NN, amount_paise INTEGER NN, gst_bp INTEGER, gst_paise INTEGER NN, total_paise INTEGER NN, terms TEXT, status TEXT, approved_by INTEGER, approved_at TEXT, created_by INTEGER, created_at TEXT, deleted_at TEXT
### pro_professionals
id INTEGER PK, name TEXT NN, profession TEXT, firm TEXT, phone TEXT, email TEXT, gstin TEXT, pan_enc TEXT, notes TEXT, active INTEGER NN, created_at TEXT, deleted_at TEXT
### pro_quote_items
id INTEGER PK, quote_id INTEGER NN, rfq_item_id INTEGER NN, rate_paise INTEGER NN
### pro_quotes
id INTEGER PK, rfq_id INTEGER NN, vendor_id INTEGER NN, rate_paise INTEGER, amount_paise INTEGER, delivery_days INTEGER, terms TEXT, document_id INTEGER, selected INTEGER, created_at TEXT, deleted_at TEXT
### pro_rfq_items
id INTEGER PK, rfq_id INTEGER NN, description TEXT NN, qty REAL, unit TEXT
### pro_rfqs
id INTEGER PK, project_id INTEGER, title TEXT NN, material TEXT, qty REAL, unit TEXT, needed_by TEXT, status TEXT, created_by INTEGER, created_at TEXT, deleted_at TEXT, indent_id INTEGER
### pro_vendors
id INTEGER PK, name TEXT NN, category TEXT, contact_person TEXT, phone TEXT, email TEXT, gstin TEXT, address TEXT, rating INTEGER, notes TEXT, active INTEGER, created_at TEXT, deleted_at TEXT, pan TEXT
### project_members
id INTEGER PK, project_id INTEGER NN, user_id INTEGER NN, added_by INTEGER, removed_at TEXT, created_at TEXT
### projects
id INTEGER PK, name TEXT NN, code TEXT NN, address TEXT, ward TEXT, city TEXT, type TEXT, status TEXT, rera_no TEXT, rera_expiry TEXT, start_date TEXT, target_date TEXT, budget_paise INTEGER, notes TEXT, created_at TEXT, deleted_at TEXT, brand_id INTEGER, percent_complete INTEGER NN
### pty_entries
id INTEGER PK, fund_id INTEGER NN, entry_date TEXT NN, kind TEXT NN, category TEXT, amount_paise INTEGER NN, narration TEXT, document_id INTEGER, status TEXT NN, created_by INTEGER, approved_by INTEGER, decided_at TEXT, decision_note TEXT, client_uuid TEXT, created_at TEXT
### pty_funds
id INTEGER PK, project_id INTEGER NN, custodian_user_id INTEGER NN, opening_paise INTEGER NN, active INTEGER NN, created_by INTEGER, created_at TEXT
### rate_limits
key TEXT PK, window_start TEXT NN, hits INTEGER NN
### sal_activities
id INTEGER PK, lead_id INTEGER NN, type TEXT, outcome TEXT, note TEXT, by_user INTEGER, created_at TEXT
### sal_adjustments
id INTEGER PK, booking_id INTEGER NN, demand_id INTEGER NN, kind TEXT NN, adj_no TEXT, amount_paise INTEGER NN, gst_paise INTEGER NN, reason TEXT NN, status TEXT NN, created_by INTEGER, approved_by INTEGER, approved_at TEXT, reversed_at TEXT, reversal_note TEXT, decision_note TEXT, created_at TEXT
### sal_booking_loans
id INTEGER PK, booking_id INTEGER NN, bank TEXT NN, sanction_paise INTEGER NN, sanction_date TEXT, disbursed_paise INTEGER NN, notes TEXT, created_by INTEGER, created_at TEXT, deleted_at TEXT
### sal_booking_parties
id INTEGER PK, booking_id INTEGER NN, name TEXT NN, phone TEXT, relation TEXT, share_bp INTEGER NN, pan_enc TEXT, aadhaar_masked TEXT, created_by INTEGER, created_at TEXT, deleted_at TEXT
### sal_bookings
id INTEGER PK, project_id INTEGER NN, unit_id INTEGER NN, lead_id INTEGER, customer_name TEXT NN, phone TEXT, email TEXT, address TEXT, pan TEXT, aadhaar_masked TEXT, token_paise INTEGER, agreed_price_paise INTEGER NN, payment_plan TEXT, booking_date TEXT, agreement_date TEXT, registration_date TEXT, gst_bp INTEGER, status TEXT, cancelled_on TEXT, cancel_reason TEXT, channel_partner_id INTEGER, brokerage_bp INTEGER, created_by INTEGER, created_at TEXT, deleted_at TEXT, list_price_paise INTEGER, discount_reason TEXT, approved_by INTEGER, unit_snapshot TEXT, erased_at TEXT
### sal_brokerage_payments
id INTEGER PK, booking_id INTEGER NN, partner_id INTEGER NN, amount_paise INTEGER NN, tds_paise INTEGER NN, paid_on TEXT NN, mode TEXT, ref_no TEXT, note TEXT, reversed_at TEXT, created_at TEXT
### sal_cost_sheet_lines
id INTEGER PK, sheet_id INTEGER NN, label TEXT NN, kind TEXT NN, amount_paise INTEGER NN
### sal_cost_sheets
id INTEGER PK, unit_id INTEGER NN, lead_id INTEGER, booking_id INTEGER, version INTEGER NN, area_basis TEXT NN, area_sqft REAL NN, base_rate_paise_per_sqft INTEGER NN, base_paise INTEGER NN, additions_paise INTEGER NN, discount_paise INTEGER NN, list_paise INTEGER NN, agreement_value_paise INTEGER NN, below_list_paise INTEGER NN, gst_bp INTEGER NN, gst_paise INTEGER NN, stamp_duty_bp INTEGER NN, stamp_duty_paise INTEGER NN, registration_paise INTEGER NN, total_paise INTEGER NN, status TEXT NN, note TEXT, created_by INTEGER, approved_by INTEGER, approved_at TEXT, decision_note TEXT, created_at TEXT
### sal_demands
id INTEGER PK, booking_id INTEGER NN, milestone_id INTEGER, stage_id INTEGER, label TEXT NN, amount_paise INTEGER NN, gst_paise INTEGER, due_date TEXT, settled_paise INTEGER NN, status TEXT, letter_document_id INTEGER, sent_at TEXT, created_at TEXT, demand_no TEXT
### sal_handover
id INTEGER PK, booking_id INTEGER NN, status TEXT NN, possession_offered_on TEXT, possession_given_on TEXT, oc_reference TEXT, notes TEXT, opened_by INTEGER, created_at TEXT
### sal_handover_items
id INTEGER PK, handover_id INTEGER NN, label TEXT NN, done INTEGER NN, done_on TEXT, note TEXT, document_id INTEGER, sort_order INTEGER NN
### sal_interest_waivers
id INTEGER PK, demand_id INTEGER NN, amount_paise INTEGER NN, reason TEXT NN, status TEXT NN, requested_by INTEGER, approved_by INTEGER, created_at TEXT
### sal_inventory
id INTEGER PK, project_id INTEGER NN, wing TEXT, floor INTEGER, unit_no TEXT NN, type TEXT, carpet_sqft REAL, rera_carpet_sqft REAL, price_paise INTEGER, floor_rise_paise INTEGER, status TEXT, blocked_till TEXT, created_at TEXT, deleted_at TEXT, category TEXT NN, hold_by INTEGER, hold_lead_id INTEGER, hold_at TEXT, list_note TEXT
### sal_leads
id INTEGER PK, project_id INTEGER, name TEXT NN, phone TEXT NN, email TEXT, source TEXT, source_detail TEXT, budget_paise INTEGER, config_pref TEXT, status TEXT, assigned_to INTEGER, next_followup_at TEXT, last_contact_at TEXT, first_contact_at TEXT, consent INTEGER, consent_at TEXT, notes TEXT, created_at TEXT, deleted_at TEXT, phone_norm TEXT, channel_partner_id INTEGER, erased_at TEXT
### sal_partners
id INTEGER PK, firm TEXT NN, contact TEXT, phone TEXT, rera_no TEXT, brokerage_default_bp INTEGER, notes TEXT, active INTEGER, created_at TEXT, deleted_at TEXT
### sal_plan_stages
id INTEGER PK, project_id INTEGER NN, stage_name TEXT NN, pct_bp INTEGER NN, milestone_key TEXT, sort_order INTEGER, retired INTEGER NN
### sal_receipt_requests
id INTEGER PK, booking_id INTEGER NN, demand_id INTEGER, amount_paise INTEGER NN, tds_paise INTEGER NN, mode TEXT, ref_no TEXT, received_on TEXT, note TEXT, account TEXT NN, kind TEXT NN, status TEXT NN, requested_by INTEGER, decided_by INTEGER, decided_at TEXT, decision_note TEXT, receipt_id INTEGER, created_at TEXT
### sal_receipts
id INTEGER PK, booking_id INTEGER NN, demand_id INTEGER, amount_paise INTEGER NN, tds_paise INTEGER NN, mode TEXT, ref_no TEXT, received_on TEXT NN, received_by INTEGER, note TEXT, reversed_at TEXT, reversal_note TEXT, created_at TEXT, receipt_no TEXT, account TEXT NN, reversed_by INTEGER, kind TEXT NN
### sal_refunds
id INTEGER PK, booking_id INTEGER NN, amount_paise INTEGER NN, forfeited_paise INTEGER NN, reason TEXT, status TEXT NN, requested_by INTEGER, approved_by INTEGER, paid_on TEXT, ref_no TEXT, created_at TEXT
### sal_visits
id INTEGER PK, lead_id INTEGER NN, project_id INTEGER, visit_at TEXT NN, status TEXT, feedback TEXT, by_user INTEGER, created_at TEXT, deleted_at TEXT
### sessions
id TEXT PK, user_id INTEGER NN, expires_at TEXT NN, user_agent TEXT, created_at TEXT
### settings
key TEXT PK, value_json TEXT NN, updated_by INTEGER, updated_at TEXT
### share_links
id INTEGER PK, token_hash TEXT NN, document_id INTEGER NN, project_id INTEGER, entity TEXT, entity_id INTEGER, recipient_label TEXT, created_by INTEGER NN, expires_at TEXT NN, max_views INTEGER, view_count INTEGER NN, first_viewed_at TEXT, last_viewed_at TEXT, revoked_at TEXT, revoked_by INTEGER, created_at TEXT
### site_dpr_labour
id INTEGER PK, dpr_id INTEGER NN, contractor_id INTEGER NN, trade TEXT, headcount INTEGER NN, created_at TEXT
### site_dprs
id INTEGER PK, project_id INTEGER NN, report_date TEXT NN, wing TEXT, work_summary TEXT NN, labour_count INTEGER, weather TEXT, materials_used TEXT, issues TEXT, safety_incident TEXT, created_by INTEGER, client_uuid TEXT, created_at TEXT, deleted_at TEXT
### site_milestones
id INTEGER PK, project_id INTEGER NN, wing TEXT, name TEXT NN, milestone_key TEXT, planned_date TEXT, actual_date TEXT, status TEXT, sort_order INTEGER, created_at TEXT, deleted_at TEXT
### site_snags
id INTEGER PK, project_id INTEGER NN, wing TEXT, location TEXT, title TEXT NN, severity TEXT, status TEXT, assigned_to INTEGER, due_date TEXT, closed_at TEXT, created_by INTEGER, client_uuid TEXT, created_at TEXT, deleted_at TEXT, unit_id INTEGER
### stk_balance
id INTEGER PK, project_id INTEGER NN, item_id INTEGER NN, qty REAL NN, reorder_level REAL NN
### stk_items
id INTEGER PK, name TEXT NN, unit TEXT, category TEXT, active INTEGER NN, created_at TEXT
### stk_moves
id INTEGER PK, project_id INTEGER NN, item_id INTEGER NN, kind TEXT NN, qty REAL NN, status TEXT NN, ref_table TEXT, ref_id INTEGER, to_project_id INTEGER, note TEXT, where_used TEXT, by_user INTEGER, approved_by INTEGER, decided_at TEXT, client_uuid TEXT, created_at TEXT
### user_recovery_codes
id INTEGER PK, user_id INTEGER NN, code_hash TEXT NN, used_at TEXT
### user_totp
user_id INTEGER PK, secret_enc TEXT NN, enabled_at TEXT, last_step INTEGER NN, created_at TEXT
### users
id INTEGER PK, name TEXT NN, email TEXT NN, phone TEXT, role TEXT NN, password_hash TEXT, password_salt TEXT, lang TEXT NN, active INTEGER NN, last_login_at TEXT, created_at TEXT, deleted_at TEXT, extra_roles TEXT, must_change_password INTEGER NN, password_changed_at TEXT, is_primary_owner INTEGER NN, deactivated_at TEXT, deactivated_by INTEGER
### webhook_seen
id TEXT PK, source TEXT, seen_at TEXT

## Indexes
- ai_log:idx_ai_log_day
- apr_events:idx_apr_events_item
- apr_items:idx_apr_project
- apr_items:idx_apr_valid
- audit_log:idx_audit_entity
- backup_log:idx_backup_started
- brand_profiles:uq_brand_scope
- brands:uq_brand_name
- bud_heads:uq_bud_head_code
- bud_heads:idx_bud_project
- con_contractors:idx_con_active
- con_ledger:idx_conledger_contractor
- con_ledger:idx_conledger_wo
- con_ledger:idx_conledger_ref
- con_payments:idx_conpay_wo
- con_payments:idx_conpay_ra
- con_ra_bills:uq_ra_no
- con_ra_bills:idx_ra_status_due
- con_ra_lines:idx_ra_lines_ra
- con_ra_lines:idx_ra_lines_item
- con_wo_items:idx_wo_items
- con_work_orders:uq_wo_no
- con_work_orders:idx_wo_project
- con_work_orders:idx_wo_contractor
- con_work_orders:idx_wo_head
- documents:idx_documents_link
- documents:idx_documents_project
- documents:uq_doc_latest
- documents:idx_documents_series
- documents:idx_documents_category
- documents:uq_doc_drive_file
- documents:idx_doc_store_check
- drw_drawings:idx_drw_project
- drw_drawings:uq_drw_code
- drw_revisions:idx_rev_drawing
- drw_revisions:uq_rev_no
- drw_revisions:uq_rev_one_ifc
- email_log:idx_email_status
- mkt_spend:idx_mkt_spend
- notifications:idx_notifications_user
- oauth_states:idx_oauth_states_expiry
- otp_codes:idx_otp_email
- ppl_candidates:idx_cand_hiring
- pro_bills:idx_bill_due
- pro_bills:idx_bill_project
- pro_grn_items:idx_grn_items_grn
- pro_grn_items:idx_grn_items_poitem
- pro_grns:idx_grn_po
- pro_indent_items:idx_indent_items
- pro_indents:uq_indent_no
- pro_indents:idx_indent_project_status
- pro_party_docs:idx_partydoc_party
- pro_party_docs:idx_partydoc_expiry
- pro_payments:idx_pay_bill
- pro_po_items:idx_poitem_po
- pro_po_items:idx_poitem_head
- pro_po_items:idx_poitem_stock
- pro_pos:idx_po_project
- pro_pos:uq_po_seq
- pro_professionals:idx_prof_active
- pro_quote_items:idx_quote_items
- pro_quotes:idx_quote_rfq
- pro_rfq_items:idx_rfq_items
- pro_rfqs:idx_rfq_project
- project_members:uq_project_member
- project_members:idx_project_member_user
- projects:idx_projects_brand
- pty_entries:idx_pty_entry_fund
- pty_entries:idx_pty_entry_status
- pty_funds:idx_pty_fund_project
- pty_funds:idx_pty_fund_user
- sal_activities:idx_activity_lead
- sal_adjustments:idx_adj_booking
- sal_adjustments:uq_adj_no
- sal_booking_loans:idx_loan_booking
- sal_booking_parties:idx_party_booking
- sal_bookings:idx_booking_project
- sal_bookings:uq_booking_one_active_per_unit
- sal_brokerage_payments:idx_brokerage_booking
- sal_cost_sheet_lines:idx_cs_lines
- sal_cost_sheets:idx_cs_unit
- sal_cost_sheets:idx_cs_status
- sal_demands:idx_demand_due
- sal_demands:idx_demand_booking
- sal_demands:uq_demand_no
- sal_handover:idx_ho_due
- sal_handover_items:idx_ho_items
- sal_interest_waivers:idx_waiver_demand
- sal_inventory:idx_inventory_project
- sal_inventory:uq_inventory_unit
- sal_inventory:idx_inventory_grid
- sal_inventory:idx_inventory_hold
- sal_leads:idx_lead_assignee
- sal_leads:idx_lead_phone
- sal_leads:idx_lead_phone_norm
- sal_leads:idx_lead_project_status
- sal_receipt_requests:idx_rcpt_req_status
- sal_receipts:idx_receipt_booking
- sal_receipts:uq_receipt_no
- sal_refunds:idx_refund_booking
- sal_visits:idx_visit_lead
- sal_visits:idx_visit_day
- sessions:idx_sessions_user
- share_links:idx_share_doc
- share_links:idx_share_entity
- share_links:idx_share_creator
- share_links:idx_share_expiry
- site_dpr_labour:idx_dprlab_dpr
- site_dpr_labour:idx_dprlab_contractor
- site_dpr_labour:uq_dprlab_line
- site_dprs:idx_dpr_project_date
- site_milestones:idx_milestone_project
- site_milestones:uq_milestone_key
- site_snags:idx_snag_project
- site_snags:idx_snag_unit
- stk_balance:uq_stk_balance
- stk_items:uq_stk_item_name
- stk_moves:idx_stk_moves_project
- stk_moves:idx_stk_moves_item
- stk_moves:idx_stk_moves_status
- user_recovery_codes:idx_recovery_user
- users:uq_primary_owner

## 0013 additions (v1.3.1 fixes)
- ppl_staff.trade, ppl_staff.project_id; pro_grn_items (per-PO-line received qty); pro_payments (partial bill payments, reversed never deleted). Not yet used by any screen.

## 0014 additions (WP-4)
- pro_indents, pro_indent_items (site material requests; status submitted/approved/rejected/converted; numbers from counters key `ind:<project_id>`), pro_rfq_items, pro_quote_items (per-line quote rates), pro_rfqs.indent_id.
- pro_bills.status gains `part_paid`. Paid amounts come from pro_payments (reversed rows ignored); legacy bills marked paid before 0013 have no payment rows and count as fully paid.

## 0015 additions (WP-5 Contractors)
- con_contractors (PAN encrypted, optional vendor_id link), con_work_orders (basis lump_sum|item_rate|measured; retention_bp, advance_paise per work order; numbers `WO-<code>-0001` from counters `wo:<project>`), con_wo_items, con_ra_bills (numbers per work order from counters `ra:<wo_id>`; status draft/checked/approved/part_paid/paid/cancelled), con_ra_lines, con_payments (kind ra | advance | retention_release; reversed, never deleted; client_uuid for retries), con_ledger (append-only; reversals are negative rows).
- Net payable on an RA bill = gross - retention - advance recovery - other deductions + GST - TDS. GST/TDS rates come from settings con.gst_bp / con.tds_bp (confirm with CA), editable per bill.
- Settings: con.enabled (off by default), con.pm_approval_limit_paise (default Rs 5,00,000), con.gst_bp, con.tds_bp.

## 0016 additions (WP-6)
- site_dpr_labour (dpr_id, contractor_id, trade, headcount): labour per contractor and trade on each daily report. contractor_id has no foreign key: the Site module asks the Contractors module (`activeContractorsForProject`, `contractorNames`) and never reads contractor tables. site_dprs.labour_count = sum of the lines for new reports; old reports keep their single number.

## 0017 additions (WP-7 Budget)
- bud_heads (project_id, code unique per project, name, budget_paise, sort_order, soft delete). pro_po_items.budget_head_id and con_work_orders.budget_head_id tag spend to a head (optional).
- Committed = approved/part-received/received POs + approved/closed work orders. Billed = bills (ex-GST by default) shared across heads by item value + approved RA bills. Paid = payments on those bills. Setting budget.gst_basis exclusive|inclusive (confirm with CA).
- Budget reads other modules only through procurementByHead / contractsByHead / posForHead / wosForHead (one aggregate query each).

## 0018-0020 additions (WP-8, WP-9, WP-10)
- Stores: stk_items, stk_balance (one row per project and item, changed only in the same batch as its move), stk_moves (append-only; kinds receipt, issue, transfer_out, transfer_in, adjust; adjust waits as pending for a PM). pro_po_items.stock_item_id ties a PO line to a store item so goods received go into stock.
- pro_party_docs: documents of vendors and contractors with valid_till, reminder_days, superseded_by (a newer copy replaces the old one and stops its reminders). party_label is stored so reminders need no lookup in another module.
- Petty cash: pty_funds (one custodian per fund), pty_entries (expense, top_up, return; balance counts approved entries only; cancelled or rejected entries stay on record).

## 0021-0022 additions
- pro_professionals: register of architects, engineers, advocates, CAs and other consultants (PAN encrypted). pro_party_docs.kind = contract | document, and party_type can now be 'professional' as well as 'vendor' and 'contractor'.
- ai_log: AI usage counts only (no questions or answers stored). See docs/AI.md.

## 0023 additions (WP-11 to WP-14, sales completeness)
- Numbers: receipts `RC-<project>-<FY>-00001`, demand letters `DL-<project>-<FY>-0001` (given when first printed or sent), credit/debit/adjustment notes `CN|DN|AD-<project>-<FY>-0001`. FY = April to March in IST. Counters keys `rcpt:|dem:|cn:|dn:|ad:<project>:<FY>`; the number is taken in the same batch as the document. Older receipts keep their old `RC-<project>-00001` numbers.
- sal_receipt_requests: large receipts waiting for a second person (setting sales.receipt_approval_limit_paise, 0 = off). Nothing in reports or balances changes until approved, then a normal receipt is posted.
- sal_adjustments: credit notes, debit notes, adjustments. Approval changes the demand's amount and GST (never below what was paid); reversal restores it.
- sal_booking_parties: co-applicants (PAN encrypted, Aadhaar kept only as XXXX XXXX 1234).
- sal_cost_sheets + sal_cost_sheet_lines: immutable versions; one live version per flat and lead; approval bands use below_list_paise (how far under the rate card) against setting sales.discount_pm_limit_paise. A booking can take its price from an approved sheet.
- sal_handover, sal_handover_items, sal_booking_loans; site_snags.unit_id; sal_inventory.status gains 'possessed'. Checklist template is the setting sales.handover_template (items separated by ;) or a starter list.

## 0024-0026 additions (RERA account, visit feedback, profile, kudos, feasibility)
- 0026 users: position, about (free text), avatar_blob_id (points to file_blobs; the picture is served only to signed-in users at /api/users/:id/avatar), avatar_updated_at (cache key).
- eng_kudos: thank-you notes (from_user, to_user, message, created_at, deleted_at). Limit 5 per sender per day.
- fea_versions: one row per feasibility study version per project (UNIQUE project_id + version; the number is MAX+1 inside the insert so two saves at once never collide). Money in paise; document_id points to a documents row of category feasibility, which only Owner, PM, Accounts and the CA can see or download. Rows are never edited or deleted: a new version is added instead.

## 0027 additions (WP-16 bulk demand letters)
- sal_bulk_runs: one bulk send (who, when, how many). sal_bulk_items: one demand in a run; status queued | sent | failed | skipped, plain-words error, attempts (retry stops after 5). A demand can wait in only one unfinished run at a time.
- sal_demand_links: expiring, revocable links (token stored only as a SHA-256 hash) to a read-only copy of one demand letter. Not exported (ephemeral); a revoked or expired link shows a plain message. Days valid: setting sales.demand_link_days.
- Index idx_email_template_sent on email_log (template, sent_at) for the daily-limit count. Demand `sent_at` is the "sent" mark; the payment status (ready/partial/paid) is never changed by sending.

## 0028 additions (WP-1 to WP-3 Redevelopment)
- red_societies (project, name, registration, threshold in basis points default 5100, count_basis members|area, threshold_reached = last announced state). red_members (one row per member; consent_status pending|consented|declined; phone shown to Owner/PM only; soft delete; client_uuid for offline idempotency). red_consent_events (every status change: who, when, why; never edited). red_member_docs (checklist item per member; items come from setting red.member_doc_checklist, empty by default).
- red_rehab_allotments (one per member; flat must be a sal_inventory row with category rehab; one active allotment per flat). red_transit_terms (rent, start/end, deposit, bank guarantee ref/amount/expiry), red_transit_schedule (one row per member per month, UNIQUE member+period), red_transit_payments (money in paise, reversed with a reason, never deleted), red_corpus_entries (charge, paid_on, reversal).
- red_meetings (kind, date, agenda, attendees, resolution text and passed flag, minutes document, next action + due + done).
- Society documents use documents.category 'society' and are visible only to Owner, PM, Accounts and the CA.

## 0029 additions (WP-18 bank statement import)
- bank_profiles (saved column choices per bank format). bank_import_batches (file name, who, counts). bank_import_rows (credit lines only: date, scrubbed narration, amount in paise, reference, row_key UNIQUE so a statement can be imported twice safely, status unmatched|suggested|confirmed|ignored, links to demand/booking/receipt or waiting receipt request; a receipt or request can be linked to at most one line). No bank account numbers are stored: digit runs of 9 or more are masked to the last 4.

## 0030 additions (WP-22 drawing acknowledgement)
- drw_acks (revision_id, user_id, acked_at; UNIQUE per person per revision; never edited or deleted). Only role site (assigned to the project) confirms; only the current IFC revision can be confirmed. Reminder time limit: setting drawing.ack_hours.

## 0031 additions (WP-17 Tally export)
- tally_export_log (what was exported, dates, voucher count, held-back count, total in paise, who, when). Ledger names are in the setting tally.ledger_map (JSON: one name per ledger role, an optional ledger per party, auto_party flag, optional Tally company name). The CRM does no accounting: vouchers are built from existing records (receipts, adjustments, bills, payments, RA bills, petty expenses); reversed or cancelled money records are not exported.

## 0032 additions (WP-20 dashboard)
- dash_snapshot (key, value_json, updated_at): a derived cache of each project's budget status (how many heads are over or close to their budget), refreshed one project per hour by the sweep. It holds nothing that is not in the budget screens, so it is NOT in the backup list: it rebuilds itself within a few hours of a restore.

## 0033 additions (Owner's 16 changes)
- projects: members_count, plot_area_sqm (square metres), planning_authority, other_authorities (JSON list), cts_no, village, property_card_details, property_card_doc_id, conveyance_details, conveyance_doc_id (optional scanned copies, documents.id), maps_url (Google Maps link; lat/lng are read from it), extra_info, autodcr_url, autodcr_set_by, autodcr_set_at.
- prj_autodcr_history (project_id, url, reason, set_by, set_at): every value the AutoDCR link has had. Append-only. In the backup list.
- apr_items: target_date (expected completion), holder_designation / holder_name (officer holding the file now), next_designation / next_name (officer it goes to next), file_moved_at. owner_user_id is the person in charge. Names are stored in capitals from now on (older rows are shown in capitals).
- apr_steps (item_id, project_id, seq, title, responsible_designation, responsible_name, assigned_to, target_date, status pending|in_progress|done|na, done_on, note, created_by, created_at, deleted_at): sub-steps of an approval. In the backup list.
- site_milestones.assigned_to: person in charge (planned_date is the expected completion date). site_snags already had assigned_to and due_date.
- red_members: rent_basis (per_sqft = paise per sq ft per month | monthly = paise per month), rent_y1_paise to rent_y5_paise, corpus_paise, car_parks, shifting_paise, extra_area_bp (3500 = 35%), new_rera_sqft (worked out: carpet_sqft x (1 + extra %)), buys_extra (0/1), buys_extra_sqft. member_type may now be 'residential'.
- red_meeting_attendees (meeting_id, member_id): who was present; attendees_count is worked out from it. In the backup list. red_meetings.next_action_owner: person in charge of the next action.
- pro_pos: material_category, transport_paise, loading_paise, packing_paise, insurance_paise, other_charges_paise, other_charges_label, charges_gst_bp (NULL = same as the PO's GST), price_basis, delivery_date, delivery_address, payment_terms, warranty, penalty_clause, category_details (JSON of the material's usual lines). amount_paise = material + charges; gst_paise = material x gst_bp + charges x charges_gst_bp. pro_po_items.hsn.
- Setting apr.designations: officer titles offered in the approval drop-downs, separated by ; or new lines (empty = the built-in list).
- stk_moves: kind 'receipt' rows can now also come from "Stock received" (note says where from); a site engineer's receipt is 'pending' until a PM or the Owner approves it.

## 0034 additions (controls)
- apr_items: gate_key (iod | cc | plinth_cc | further_cc | rera_reg | fire_final | bcc | oc; older rows are recognised by name), wing (a part OC/CC for one wing), cc_upto_floor (a CC: work allowed up to this floor, 0 = plinth), letter_no, letter_date, letter_doc_id. Status moves are fixed: not_started → applied/na; applied → query/approved/rejected; query → applied/approved/rejected; rejected/expired → applied; approved → expired (anything else back from approved: Owner + reason). Creating an approval always starts at not_started.
- apr_deps (item_id, depends_on_id, created_by, created_at): approvals that must be approved before this one can be applied for or approved. In the backup list.
- site_milestones: floor, all_wings, ready_at, ready_by, ready_note, cert_ref (architect's stage certificate), cert_doc_id, certified_by, override_note (Owner went past a missing CC), undone_at, undo_reason. Status: pending | ready | done.
- sal_demands: hold_reason; new status on_hold (a sent demand whose milestone certification was undone).
- con_work_orders.advance_recovery_bp; con_wo_items.variation_id (item added by a variation).
- con_variations (wo_id, wo_item_id or NULL, description, unit, qty, rate_paise, amount_paise, reason, drawing_ref, status pending|approved|rejected, created_by/at, approved_by/at, decision_note). In the backup list.
- con_measurements (wo_id, wo_item_id, location, nos, length_m, width_m, depth_m, qty, contractor_rep, photo_doc_id, note, status, measured_by, approved_by/at, decision_note, client_uuid). In the backup list.
- pro_bills: hold_reason, released_by, released_at, release_note, created_by. A held bill cannot be paid until released.
- pro_grns.excess_note: why more than the PO (+ tolerance) was accepted.
- sal_handover.override_note: why possession went ahead with dues, snags or checklist items open.
- Settings: con.variation_owner_limit_paise (default 50000000 = Rs 5 lakh), pro.tolerance_bp (300 = 3%), con.dlp_months (60, counted from the OC letter date), con.advance_recovery_bp (1000 = 10%), tax.tds_no_pan_bp (2000 = 20%, confirm with CA).

## 0035 additions (RERA withdrawal certificates)
- rera_certificates (project_id, kind architect | engineer | ca, cert_no, cert_date, issued_by, pct_complete_bp (architect/engineer, 6500 = 65%), amount_paise (CA: amount that may be withdrawn), document_id (required), note, created_by/at, cancelled_at/by, cancel_note). Never deleted. In the backup list.
- rera_account_entries: architect_cert_id, engineer_cert_id, ca_cert_id — the three certificates a withdrawal relied on (required for every new withdrawal).
- Setting rera.cert_valid_days (default 90): a certificate older than this on the withdrawal date is not accepted. Confirm with your CA.

## 0036 additions (quality and daily report)
- qa_pours (project_id, wing, floor, element, location, grade, qty_cum, planned_date, drawing_ref, rmc_supplier, checklist JSON, photo_doc_id, status requested|approved|poured|cancelled, requested_by, approved_by/at, override_note, poured_on, poured_qty_cum, rmc_tickets, poured_by, cancel_note, client_uuid). In the backup list.
- qa_cubes (pour_id, project_id, age_days 7|28, due_date, required_mpa, result_mpa, status pending|pass|fail, tested_on, lab, report_doc_id, entered_by/at). One row per age per pour. In the backup list.
- qa_ncrs (project_id, wing, floor, source cube7|cube28|site, pour_id, cube_id, title, details, contractor_id, assigned_to, due_date, status open|closed, correction, closed_by/at, closing_doc_id, photo_doc_id, created_by/at, client_uuid). An open cube28 NCR stops milestone certification at that wing, at its floor and above. In the backup list.
- site_dpr_work (dpr_id, wing, floor, activity, qty, unit): the work-done lines of a daily report. In the backup list. site_dprs: hours_lost, lost_reason (rain | material | labour | power | approvals | other).
- Settings: qa.pour_checklist (; separated, empty = built-in list), qa.cube_7day_pct_bp (6500), dpr.activities (; separated, empty = built-in list).

## 0037 additions (safety in the daily report)
- site_dprs: safety_checks (JSON { check: true/false } from the setting dpr.safety_checks), incident_kind (none | near_miss | injury | dangerous). safety_incident holds the description. An incident notifies the Owner and PMs.
- Setting dpr.safety_checks (; separated, empty = built-in list). High-contrast choice is kept in the phone's local storage (nirmaan.contrast), not on the server.

## 0038 additions (rest of the audit)
- site_milestones.baseline_date; site_ms_changes (milestone_id, old_date, new_date, reason monsoon|approvals|contractor|material|funds|design|other, note, changed_by/at). In the backup list.
- prj_holds (project_id, wing or NULL for the whole project, reason, held_by/at, released_by/at, release_note). An open hold stops certifying, pour approval, bookings and cost sheets in that wing. In the backup list.
- red_members: paaa_reg_no, paaa_reg_date, paaa_doc_id, vacated_on, keys_received, utilities_disconnected. Transit rent needs vacated_on and cannot start before its month.
- con_wo_items: drawing_id, boq_item_id, stock_item_id, consumption_per_unit, wastage_bp. qa_pours: drawing_id, drawing_rev_id. stk_moves.wo_id (material issued to a work order). pro_po_items.boq_item_id.
- con_debit_notes (wo_id, reason, description, qty, unit, rate_paise, amount_paise, photo_doc_id, status pending|approved|rejected|recovered, ra_id, created_by/at, approved_by/at, decision_note). In the backup list.
- bud_items (project_id, head_id, code, description, unit, qty, rate_paise, amount_paise, created_by/at, deleted_at). In the backup list.
- Uploads now also accept audio/webm, audio/ogg, audio/mp4, audio/x-m4a, audio/aac, audio/mpeg (voice notes), checked by their first bytes.

## 0039 additions (Business Development and project life cycle)
- bd_opportunities (name, kind society|land|jv|other, society_name, address, ward, plot_area_sqm, members_count, source, contact_name, contact_phone +91, owner_user_id, stage identified|follow_up|feasibility|process_79a|da_signed|da_registered, status open|won|lost|dropped, next_followup, lost_reason, da_signed_on, da_doc_id, da_registered_on, da_reg_no, override_note, project_id, notes, created_by/at, closed_at). Never deleted: closed with a reason. In the backup list.
- bd_followups (opportunity_id, on_date, kind call|meeting|site_visit|email|other, note, next_date, created_by/at). In the backup list.
- bd_studies (opportunity_id, version, study_date, title, est_cost_paise, est_revenue_paise, saleable_sqft, completion_months, document_id, notes, created_by/at; unique opportunity + version). The latest is copied to fea_versions v1 when the deal becomes a project. In the backup list.
- bd_steps (opportunity_id, step text from setting bd.steps_79a, done_on, note, document_id, done_by, created_at; unique opportunity + step). In the backup list.
- prj_lifecycle (project_id, step da_registered|designs|vacating_notice|vacating|demolition, done_on, note, document_id, override_note, done_by, created_at; unique project + step). Only steps with no other record; everything else in the life cycle is read from apr_items, red_members, site_milestones, sal_bookings and bd_opportunities. In the backup list.
- documents.module = 'bd': deal papers (feasibility reports, 79A papers, signed DA); only roles with Business Development view can open them.
- Settings: bd.vacate_to_plinth_months (default 7), bd.completion_months (default 36), bd.steps_79a (blank = built-in list).

## Module 1 gaps, step 1 (migration 0040)
- projects: dcpr_regulation (text, as typed on the approvals; confirm with the architect), sanctioned_fsi, fungible_fsi, tdr_purchased (numbers, same unit).
- red_members: certified_area_sqft (architect-certified Annexure-II area; set once, then locked; per-sq-ft rent uses it, with carpet_sqft only as a fallback for rows priced before this existed), certified_by, certified_at.
- sal_inventory.category now takes sale | rehab | landowner (no schema change). A landowner flat has status 'landowner', is never priced or sold, and its bucket cannot be changed once set.
- Settings: red.oc_grace_days (days after the OC date when transit rent stops, default 30), apr.alert_days (expiry alert steps, default 30,15,7).
- Rules: transit-rent escalation years count from red_members.vacated_on (month granularity; vacated after the 1st = one month later); red_transit_schedule rows with no payment row beyond the OC date + grace days are removed by the hourly sweep. Notifications for approval expiry use link approvals#<id>@<valid_till>:T<step>, once per step.

## Module 1 gaps, step 2 (migration 0041)
- users: approval_pin_hash, approval_pin_salt, approval_pin_set_at. The Owner's 6-digit approval PIN, kept only as a salted PBKDF2 hash. Never returned, never exported. 5 wrong tries lock it for 15 minutes (rate_limits key pin:<user>).
- red_members vacating proof: vacate_photo_doc_id (photo of the empty flat, documents.id), vacate_lat, vacate_lng (phone location, must be inside India's bounds), vacate_proof_at, vacate_proof_by, meter_electricity, meter_water (final readings as text), final_bills_doc_id (zero-due utility bills), vacate_override_note (Owner only: why vacating was recorded without photo or location).
- red_members identity: pan_enc (encrypted PAN), pan_hash (keyed HMAC of the PAN, for the one-PAN-one-member rule), pan_last4, aadhaar_last4 (the last 4 digits only; a full Aadhaar is refused). Unique index uq_red_mem_pan on (society_id, pan_hash) for live members. The member list shows pan_masked / aadhaar_masked to Owner, PM and Accounts, and "on file" to others.
- red_rent_changes (member_id, kind terms|transit_term, payload JSON, summary, status pending|approved|rejected, requested_by, created_at, decided_by, decided_at, decision_note). A change to a rent that is already set waits here until the Owner approves it with the PIN (applied then) or rejects it with a reason. In the backup list.
- red_site_proofs (project_id, kind electricity|water|gas|tree_noc|barricade, status provided|not_applicable, document_id, ref_no, on_date, note, created_by, created_at; unique project + kind). In the backup list.
- con_work_orders.is_demolition (0/1): a demolition work order is approved only when the IOD is approved and every proof in the setting red.demolition_proofs (default all five) is provided or marked not applicable.
- Settings: red.demolition_proofs.

## Module 1 gaps, step 3 (migration 0042)
- pro_indents and con_ra_bills: wing, floor (highest floor the request or bill is for; NULL = not floor work), cc_override_note (the Owner's written reason when the floor was above the approved CC). Rule: floor must be covered by an approved cc, plinth_cc or further_cc (apr_items.cc_upto_floor); the Owner may override with a reason of at least 10 letters.
- red_members bank: bank_holder, bank_acct_enc (account number, encrypted like PANs), bank_acct_last4, bank_ifsc. Only Owner and Accounts can read or change them; the full number appears only inside a generated bank file.
- red_payout_batches (society_id, period YYYY-MM, status generated|paid|cancelled, line_count, total_paise, bank_ref, paid_on, mode, note, created_by/at, decided_by/at). One row per bank file. In the backup list.
- red_transit_schedule.batch_id: the bank file a month is in. A month in a generated (unpaid) batch cannot be paid on its own; cancelling the batch clears it. Batch payments are red_transit_payments rows with client_uuid batch<id>-<schedule id> (so marking paid twice cannot pay twice).
- Settings: red.rtgs_min_paise (default 20000000 = Rs 2,00,000: lines at or above it are marked RTGS, below it NEFT; confirm with your bank).
- Site board: nothing stored. Readiness = average of checks that apply (IOD approved, CC or plinth CC approved, site proofs on file, PAAA registered, flats vacated, utilities disconnected). Monday note link: siteboard#monday:<date>, once per day.

## Module 5 screens (migration 0043)
- Index idx_snag_unit on site_snags(unit_id, status): the Possession list counts open snags per flat. No new table or column.
- GET /api/possession (perm sales V): per booked, not cancelled flat: stage not_started (no sal_handover row) | in_progress | handed_over, open checklist items (sal_handover_items.done = 0) and open snags (site_snags for that unit_id, status other than verified). The customer name is shown only to Owner, PM, Accounts and Sales.

## Module 2 gaps, step 1 (migration 0044)
- sal_inventory.msp_paise: the lowest agreement value allowed for the flat (NULL = no floor). Set by the Owner only (POST /api/sales/msp, per flat or per project rate per RERA sq ft; audited).
- sal_cost_sheets: below_msp (1 = agreement value was under the MSP when the sheet was made), msp_paise (the MSP at that moment), msp_approved_by (Owner who approved it with the approval PIN). A booking under the flat's MSP is allowed only through a sheet with below_msp = 1 and msp_approved_by set.
- sal_partners: pan_enc (encrypted, never returned or exported), pan_last4, gstin, rera_valid_till (YYYY-MM-DD), rera_doc_id (documents.id of the certificate scan), kyc_status (pending | approved), kyc_by, kyc_at. Any change to PAN, GSTIN or RERA details sets kyc_status back to pending. Brokerage payment (sal_brokerage_payments) is refused unless kyc_status = approved and rera_valid_till is today or later.
- sal_leads: sla_reassigns (times moved for not being called in time, max 3), sla_assigned_at (when it was last moved). The move is an audit_log row (sla_reassign) and a timeline note.
- sal_hold_log (unit_id, user_id, lead_id, held_at, ended_at, reason expired | released): a hold that ended without a booking. In the backup list. A non-manager cannot hold a flat again within sales.rehold_block_hours of their own entry here.
- Bookings: the broker is taken from the lead (sal_leads.channel_partner_id). A different broker needs role Owner and partner_override_reason of at least 10 letters; the audit text records the override.
- Settings: sales.sla_minutes (default 15, 0 = off; checked at the hourly sweep, 09:00-19:00 IST), sales.rehold_block_hours (default 24), sales.lock_above_cc (on | off, default off; when on, hold, cost sheet and booking are refused for floors above the approved CC / plinth CC / further CC floor of the wing, and the stacking plan shows them as "Not open yet"; no CC floor recorded = no lock).
- Stacking plan (GET /api/reports/stacking): rehab and landowner flats are returned only to Owner, PM and Accounts; msp_paise only to Owner and PM.

## Module 2 gaps, step 2 (migration 0045)
- sal_hold_tokens (unit_id, lead_id, held_by, hold_at, amount_paise, mode upi|neft|cheque, ref_no, proof_doc_id, status pending|cleared|rejected, decided_by, decided_at, note, created_at): the token details entered when a flat is blocked. hold_at ties the row to one hold (sal_inventory.hold_at); once that hold ends the row no longer shows as pending. Cleared by Owner, PM or Accounts; clearing extends sal_inventory.blocked_till by sales.token_cleared_hold_days. In the backup list.
- sal_checkins (project_id, phone_norm, name, partner_id, token_hash, status pending|confirmed|declined, answer yes|no, lead_id, conflict_note, created_by, created_at, expires_at, confirmed_at): one reception check-in. The one-time link token is never stored, only its SHA-256 hash; it expires after 30 minutes; the buyer's own page is /c/<token> (public, no login, rate limited, 6 wrong tries per 30 minutes). In the backup list.
- sal_leads: source_confirmed_at, source_locked_until (YYYY-MM-DD), source_checkin_id. Set once when the buyer confirms the broker; renewable only after source_locked_until has passed. The broker on a lead (channel_partner_id) is paid for a booking only while this lock is running (when sales.broker_needs_confirmation is not Off).
- Settings (all editable in Settings): sales.hold_needs_token (on unless Off), sales.broker_needs_confirmation (on unless Off), sales.lock_above_cc (on unless Off; was off in step 1), sales.source_lock_days (default 45), sales.token_cleared_hold_days (default 7), sales.brochure_url, sales.map_url (blank = project location), plus the step 1 keys sales.sla_minutes and sales.rehold_block_hours, which could not be edited before.
- Cron: a fifth trigger "*/15 * * * *" runs only the lead call-deadline check (business hours 09:00-19:00 IST); it was removed from the hourly sweep. Production only; staging has no crons.
- Routes: POST/GET /api/sales/checkins, GET /api/sales/partner-names, GET/POST /api/public/checkin/:token, GET /c/:token (page), GET /api/sales/token-holds, POST /api/sales/token-holds/:id/clear|reject, GET /api/sales/leads/:id/welcome, GET /api/sales/reengage.

## Module 2 gaps, step 3 (migration 0046)
- sal_price_matrix (one row per project): base_rate_paise (per RERA carpet sq ft), rise_paise_per_floor (per sq ft, for each floor from rise_from_floor upward), rise_from_floor, parking_paise (per slot), club_paise and dev_paise (per flat), updated_by, updated_at. In the backup list.
- sal_plc_rules (project_id, tag, label, kind per_sqft|flat, amount_paise, retired): location charges. A change retires the old rules and adds new ones (nothing deleted). In the backup list.
- sal_inventory.plc_tags: comma-separated lower-case tags (for example garden,corner); a PLC rule applies to flats carrying its tag.
- Quote (GET /api/sales/units/:id/quote?parking=N) is computed, not stored: floor rise = rise x max(0, floor - from + 1) x RERA carpet; PLC per sq ft x carpet or flat amount; parking x slots; club; development. matches_rate_card says whether the flat's price already equals base rate x carpet.
- Apply (POST /api/sales/price-matrix/apply) rewrites price_paise and floor_rise_paise for flats with status available or held (never booked), audited.
- Token proof: sal_hold_tokens.proof_doc_id points to a documents row with category kyc, module sales (visible only to Owner, PM, Sales, Accounts).

