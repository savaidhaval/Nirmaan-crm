# NirmaanCRM data dictionary (real schema from migrations 0001-0014, updated 2026-11-22)

Source: replaying migrations/*.sql into an empty SQLite DB. Live D1 not verified (see docs/STATE.md). Money = paise INTEGER, percentages = basis points (_bp). NN = NOT NULL, PK = primary key.

## Drift from guide v1.3
- projects.brand_id, projects.percent_complete
- tables not in guide: brands, mfa_challenges, user_totp, user_recovery_codes, sal_interest_waivers, sal_refunds, mkt_spend, webhook_seen
- pro_bills already has gst/tds columns; sal_inventory.category and sal_receipts.receipt_no already exist

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
### pro_payments
id INTEGER PK, bill_id INTEGER NN, amount_paise INTEGER NN, tds_paise INTEGER NN, paid_on TEXT NN, mode TEXT, ref_no TEXT, note TEXT, reversed_at TEXT, reversal_note TEXT, created_by INTEGER, created_at TEXT
### pro_po_items
id INTEGER PK, po_id INTEGER NN, description TEXT NN, qty REAL, unit TEXT, rate_paise INTEGER, amount_paise INTEGER
### pro_pos
id INTEGER PK, project_id INTEGER NN, vendor_id INTEGER NN, rfq_id INTEGER, po_no TEXT, po_seq INTEGER NN, amount_paise INTEGER NN, gst_bp INTEGER, gst_paise INTEGER NN, total_paise INTEGER NN, terms TEXT, status TEXT, approved_by INTEGER, approved_at TEXT, created_by INTEGER, created_at TEXT, deleted_at TEXT
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
### rate_limits
key TEXT PK, window_start TEXT NN, hits INTEGER NN
### sal_activities
id INTEGER PK, lead_id INTEGER NN, type TEXT, outcome TEXT, note TEXT, by_user INTEGER, created_at TEXT
### sal_bookings
id INTEGER PK, project_id INTEGER NN, unit_id INTEGER NN, lead_id INTEGER, customer_name TEXT NN, phone TEXT, email TEXT, address TEXT, pan TEXT, aadhaar_masked TEXT, token_paise INTEGER, agreed_price_paise INTEGER NN, payment_plan TEXT, booking_date TEXT, agreement_date TEXT, registration_date TEXT, gst_bp INTEGER, status TEXT, cancelled_on TEXT, cancel_reason TEXT, channel_partner_id INTEGER, brokerage_bp INTEGER, created_by INTEGER, created_at TEXT, deleted_at TEXT, list_price_paise INTEGER, discount_reason TEXT, approved_by INTEGER, unit_snapshot TEXT, erased_at TEXT
### sal_brokerage_payments
id INTEGER PK, booking_id INTEGER NN, partner_id INTEGER NN, amount_paise INTEGER NN, tds_paise INTEGER NN, paid_on TEXT NN, mode TEXT, ref_no TEXT, note TEXT, reversed_at TEXT, created_at TEXT
### sal_demands
id INTEGER PK, booking_id INTEGER NN, milestone_id INTEGER, stage_id INTEGER, label TEXT NN, amount_paise INTEGER NN, gst_paise INTEGER, due_date TEXT, settled_paise INTEGER NN, status TEXT, letter_document_id INTEGER, sent_at TEXT, created_at TEXT
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
### site_dprs
id INTEGER PK, project_id INTEGER NN, report_date TEXT NN, wing TEXT, work_summary TEXT NN, labour_count INTEGER, weather TEXT, materials_used TEXT, issues TEXT, safety_incident TEXT, created_by INTEGER, client_uuid TEXT, created_at TEXT, deleted_at TEXT
### site_milestones
id INTEGER PK, project_id INTEGER NN, wing TEXT, name TEXT NN, milestone_key TEXT, planned_date TEXT, actual_date TEXT, status TEXT, sort_order INTEGER, created_at TEXT, deleted_at TEXT
### site_snags
id INTEGER PK, project_id INTEGER NN, wing TEXT, location TEXT, title TEXT NN, severity TEXT, status TEXT, assigned_to INTEGER, due_date TEXT, closed_at TEXT, created_by INTEGER, client_uuid TEXT, created_at TEXT, deleted_at TEXT
### user_recovery_codes
id INTEGER PK, user_id INTEGER NN, code_hash TEXT NN, used_at TEXT
### user_totp
user_id INTEGER PK, secret_enc TEXT NN, enabled_at TEXT, last_step INTEGER NN, created_at TEXT
### users
id INTEGER PK, name TEXT NN, email TEXT NN, phone TEXT, role TEXT NN, password_hash TEXT, password_salt TEXT, lang TEXT NN, active INTEGER NN, last_login_at TEXT, created_at TEXT, deleted_at TEXT, extra_roles TEXT, must_change_password INTEGER NN, password_changed_at TEXT, is_primary_owner INTEGER NN, deactivated_at TEXT, deactivated_by INTEGER
### webhook_seen
id TEXT PK, source TEXT, seen_at TEXT

## Indexes
- apr_events:idx_apr_events_item
- apr_items:idx_apr_project
- apr_items:idx_apr_valid
- audit_log:idx_audit_entity
- backup_log:idx_backup_started
- brand_profiles:uq_brand_scope
- brands:uq_brand_name
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
- pro_payments:idx_pay_bill
- pro_po_items:idx_poitem_po
- pro_pos:idx_po_project
- pro_pos:uq_po_seq
- pro_quote_items:idx_quote_items
- pro_quotes:idx_quote_rfq
- pro_rfq_items:idx_rfq_items
- pro_rfqs:idx_rfq_project
- project_members:uq_project_member
- project_members:idx_project_member_user
- projects:idx_projects_brand
- sal_activities:idx_activity_lead
- sal_bookings:idx_booking_project
- sal_bookings:uq_booking_one_active_per_unit
- sal_brokerage_payments:idx_brokerage_booking
- sal_demands:idx_demand_due
- sal_demands:idx_demand_booking
- sal_interest_waivers:idx_waiver_demand
- sal_inventory:idx_inventory_project
- sal_inventory:uq_inventory_unit
- sal_inventory:idx_inventory_grid
- sal_inventory:idx_inventory_hold
- sal_leads:idx_lead_assignee
- sal_leads:idx_lead_phone
- sal_leads:idx_lead_phone_norm
- sal_leads:idx_lead_project_status
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
- site_dprs:idx_dpr_project_date
- site_milestones:idx_milestone_project
- site_milestones:uq_milestone_key
- site_snags:idx_snag_project
- user_recovery_codes:idx_recovery_user
- users:uq_primary_owner

## 0013 additions (v1.3.1 fixes)
- ppl_staff.trade, ppl_staff.project_id; pro_grn_items (per-PO-line received qty); pro_payments (partial bill payments, reversed never deleted). Not yet used by any screen.

## 0014 additions (WP-4)
- pro_indents, pro_indent_items (site material requests; status submitted/approved/rejected/converted; numbers from counters key `ind:<project_id>`), pro_rfq_items, pro_quote_items (per-line quote rates), pro_rfqs.indent_id.
- pro_bills.status gains `part_paid`. Paid amounts come from pro_payments (reversed rows ignored); legacy bills marked paid before 0013 have no payment rows and count as fully paid.
