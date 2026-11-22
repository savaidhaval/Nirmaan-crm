-- 0029: bank-statement CSV import and matching (WP-18). Additive only.
-- The browser reads the CSV; the server only stores credit lines (no account numbers) and suggests which open demand each one pays.
-- Confirming a line creates a normal receipt through the existing receipt route (so numbering and the second-person approval still apply).

CREATE TABLE bank_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  mapping_json TEXT NOT NULL,            -- which CSV column is the date, narration, credit and reference; date format
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE bank_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT, uploaded_by INTEGER NOT NULL REFERENCES users(id),
  row_count INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0, dup_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE bank_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES bank_import_batches(id),
  txn_date TEXT NOT NULL, narration TEXT, credit_paise INTEGER NOT NULL, reference TEXT,
  row_key TEXT NOT NULL UNIQUE,          -- date|amount|reference|narration start|n-th identical line: importing the same file twice adds nothing
  status TEXT NOT NULL DEFAULT 'unmatched',   -- unmatched | suggested | confirmed | ignored
  suggestion_note TEXT,
  matched_demand_id INTEGER REFERENCES sal_demands(id), matched_booking_id INTEGER REFERENCES sal_bookings(id),
  matched_receipt_id INTEGER REFERENCES sal_receipts(id), matched_request_id INTEGER REFERENCES sal_receipt_requests(id),
  decided_by INTEGER, decided_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_bank_rows_batch ON bank_import_rows(batch_id, status);
CREATE INDEX idx_bank_rows_status ON bank_import_rows(status, created_at);
-- one receipt can settle at most one bank line
CREATE UNIQUE INDEX idx_bank_rows_receipt ON bank_import_rows(matched_receipt_id) WHERE matched_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX idx_bank_rows_request ON bank_import_rows(matched_request_id) WHERE matched_request_id IS NOT NULL;
