-- 0015 (WP-5): contractors, work orders, RA bills, retention/advance ledger. Additive only.
CREATE TABLE IF NOT EXISTS con_contractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER REFERENCES pro_vendors(id),   -- optional link; contractors are managed here, not through vendor SQL
  name TEXT NOT NULL, phone TEXT, trade TEXT,
  pan_enc TEXT, gstin TEXT, agreement_document_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_con_active ON con_contractors(active, name);

CREATE TABLE IF NOT EXISTS con_work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  contractor_id INTEGER NOT NULL REFERENCES con_contractors(id),
  wo_no TEXT NOT NULL,
  scope TEXT,
  basis TEXT NOT NULL DEFAULT 'lump_sum',          -- lump_sum | item_rate | measured
  value_paise INTEGER NOT NULL,
  retention_bp INTEGER NOT NULL DEFAULT 0,
  advance_paise INTEGER NOT NULL DEFAULT 0,        -- advance agreed
  status TEXT NOT NULL DEFAULT 'draft',            -- draft|pending_approval|approved|rejected|closed|cancelled
  created_by INTEGER, approved_by INTEGER, approved_at TEXT, decision_note TEXT,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_no ON con_work_orders(wo_no);
CREATE INDEX IF NOT EXISTS idx_wo_project ON con_work_orders(project_id, status);
CREATE INDEX IF NOT EXISTS idx_wo_contractor ON con_work_orders(contractor_id);

CREATE TABLE IF NOT EXISTS con_wo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id INTEGER NOT NULL REFERENCES con_work_orders(id),
  description TEXT NOT NULL, qty REAL NOT NULL, unit TEXT,
  rate_paise INTEGER NOT NULL, amount_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wo_items ON con_wo_items(wo_id);

CREATE TABLE IF NOT EXISTS con_ra_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id INTEGER NOT NULL REFERENCES con_work_orders(id),
  ra_no INTEGER NOT NULL,
  period_from TEXT, period_to TEXT, due_date TEXT,
  gross_paise INTEGER NOT NULL,
  retention_paise INTEGER NOT NULL DEFAULT 0,
  advance_recovery_paise INTEGER NOT NULL DEFAULT 0,
  other_deductions_paise INTEGER NOT NULL DEFAULT 0,
  gst_bp INTEGER NOT NULL DEFAULT 0, gst_paise INTEGER NOT NULL DEFAULT 0,
  tds_bp INTEGER NOT NULL DEFAULT 0, tds_paise INTEGER NOT NULL DEFAULT 0,
  net_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',            -- draft|checked|approved|part_paid|paid|cancelled
  note TEXT,
  created_by INTEGER, checked_by INTEGER, approved_by INTEGER, approved_at TEXT, cancel_note TEXT,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ra_no ON con_ra_bills(wo_id, ra_no);
CREATE INDEX IF NOT EXISTS idx_ra_status_due ON con_ra_bills(status, due_date);

CREATE TABLE IF NOT EXISTS con_ra_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ra_id INTEGER NOT NULL REFERENCES con_ra_bills(id),
  wo_item_id INTEGER NOT NULL REFERENCES con_wo_items(id),
  qty_this_bill REAL NOT NULL, rate_paise INTEGER NOT NULL, amount_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ra_lines_ra ON con_ra_lines(ra_id);
CREATE INDEX IF NOT EXISTS idx_ra_lines_item ON con_ra_lines(wo_item_id);

-- Every money movement against a work order. kind: ra | advance | retention_release
CREATE TABLE IF NOT EXISTS con_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id INTEGER NOT NULL REFERENCES con_work_orders(id),
  ra_id INTEGER REFERENCES con_ra_bills(id),
  kind TEXT NOT NULL DEFAULT 'ra',
  amount_paise INTEGER NOT NULL,
  paid_on TEXT NOT NULL, mode TEXT, ref_no TEXT, note TEXT,
  reversed_at TEXT, reversal_note TEXT,
  client_uuid TEXT UNIQUE,
  created_by INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conpay_wo ON con_payments(wo_id, kind);
CREATE INDEX IF NOT EXISTS idx_conpay_ra ON con_payments(ra_id);

-- Append-only. Reversals are new rows with a negative amount, never edits.
CREATE TABLE IF NOT EXISTS con_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor_id INTEGER NOT NULL, project_id INTEGER NOT NULL, wo_id INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- advance | advance_recovery | retention_held | retention_released | payment
  amount_paise INTEGER NOT NULL,
  ref_table TEXT, ref_id INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conledger_contractor ON con_ledger(contractor_id, kind);
CREATE INDEX IF NOT EXISTS idx_conledger_wo ON con_ledger(wo_id, kind);
CREATE INDEX IF NOT EXISTS idx_conledger_ref ON con_ledger(ref_table, ref_id, kind);
