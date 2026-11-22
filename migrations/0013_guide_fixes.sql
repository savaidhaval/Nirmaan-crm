-- 0013: additive only (S2). Adds what 0001-0012 lack: staff trade/project, per-line GRN quantities, bill payments.
-- pro_bills GST/TDS columns already exist (0012), so they are not repeated.
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

-- Payments are reversed, never deleted. pro_bills.paid_on/payment_ref stay for old rows.
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
CREATE INDEX IF NOT EXISTS idx_rfq_project ON pro_rfqs(project_id);
