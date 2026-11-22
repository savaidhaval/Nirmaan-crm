-- DRAFT ONLY. Not in migrations/, never applied. Review, then copy to migrations/0013_guide_fixes.sql in the S2-revised work package.
-- Additive only (guide section 10.1). Takes a D1 export first. Staging first: merging to main auto-applies migrations to production.
-- Already present in the repo (do NOT re-add): sal_inventory.category (0011); pro_bills.gst_paise/tds_bp/tds_paise/taxable_paise/tds_section/project_id (0012).

-- 1. Roster columns (guide 7.7): who works where, what trade. Contractors live in the future con_ module.
ALTER TABLE ppl_staff ADD COLUMN trade TEXT;
ALTER TABLE ppl_staff ADD COLUMN project_id INTEGER REFERENCES projects(id);

-- 2. Structured GRN quantities per PO line (pro_grns.qty_note stays for old rows).
CREATE TABLE pro_grn_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_id INTEGER NOT NULL REFERENCES pro_grns(id),
  po_item_id INTEGER NOT NULL REFERENCES pro_po_items(id),
  qty_received REAL NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_grnitem_grn ON pro_grn_items(grn_id);
CREATE INDEX idx_grnitem_poitem ON pro_grn_items(po_item_id);

-- 3. Partial payments against a bill (pro_bills.paid_on/payment_ref stay for old rows and are filled when fully paid).
CREATE TABLE pro_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES pro_bills(id),
  amount_paise INTEGER NOT NULL,
  tds_paise INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT NOT NULL,
  mode TEXT, ref_no TEXT, note TEXT,
  reversed_at TEXT, reversal_note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_pay_bill ON pro_payments(bill_id);
-- Application change in the same package: /api/procurement/bills/:id/pay writes a pro_payments row, status becomes part_paid or paid by SUM.

-- 4. Demand numbering (receipts already have receipt_no). Verify first that sal_demands has no demand_no column.
-- ALTER TABLE sal_demands ADD COLUMN demand_no TEXT;
