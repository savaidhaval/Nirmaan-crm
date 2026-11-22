-- PROPOSED, NOT APPLIED. Do not copy into migrations/ before STATE.md remote checks.
-- Number 0010 is already taken in migrations/; the real next free number is 0013. Rename on adoption.
-- Additive only. Items below are what S2 still needs after discounting columns that already exist.
-- (pro_bills.gst_paise/tds_bp/tds_paise and sal_inventory.category and sal_receipts.receipt_no already exist: do NOT re-add.)

ALTER TABLE ppl_staff ADD COLUMN trade TEXT;
ALTER TABLE ppl_staff ADD COLUMN project_id INTEGER REFERENCES projects(id);

CREATE TABLE IF NOT EXISTS pro_grn_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_id INTEGER NOT NULL REFERENCES pro_grns(id),
  po_item_id INTEGER NOT NULL REFERENCES pro_po_items(id),
  qty_received REAL NOT NULL,
  note TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON pro_grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_poitem ON pro_grn_items(po_item_id);

CREATE TABLE IF NOT EXISTS pro_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES pro_bills(id),
  amount_paise INTEGER NOT NULL,
  tds_paise INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT NOT NULL,
  mode TEXT, ref_no TEXT, note TEXT,
  reversed_at TEXT, reversal_note TEXT,
  created_by INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_bill ON pro_payments(bill_id);

-- Missing lookup indexes found in S0
CREATE INDEX IF NOT EXISTS idx_rfq_project ON pro_rfqs(project_id);
CREATE INDEX IF NOT EXISTS idx_grn_project_date ON pro_grns(received_on);
