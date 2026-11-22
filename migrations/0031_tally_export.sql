-- 0031: Tally voucher export (WP-17). Additive only. Export only: no accounting happens in the CRM.
-- The ledger names live in the setting tally.ledger_map (edited on the Tally screen). The browser builds the XML file.
CREATE TABLE tally_export_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- receipts | vendor_payments | contractor_payments | petty | purchase_bills | ra_bills | credit_notes
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  voucher_count INTEGER NOT NULL, skipped_count INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL DEFAULT 0,
  exported_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_tally_log_created ON tally_export_log(created_at);
