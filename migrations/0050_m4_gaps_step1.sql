-- 0050: Module 4 gaps, step 1. Additive only.
-- AFS registration (the 10% gate), buyer TDS under s.194-IA held until verified, bank relationship manager on a home loan, receipt back-dating note.

ALTER TABLE sal_bookings ADD COLUMN afs_reg_no TEXT;            -- registration number of the registered Agreement for Sale
ALTER TABLE sal_bookings ADD COLUMN afs_doc_id INTEGER REFERENCES documents(id);   -- scanned Index-II
ALTER TABLE sal_bookings ADD COLUMN tds194ia INTEGER NOT NULL DEFAULT 0;           -- 1 = the buyer deducts 1% TDS (price at or above the threshold when booked)

-- The buyer's TDS part of a payment. It is not counted as received (not in the receipt, not against the demand) until Accounts verify the challan / Form 16B.
CREATE TABLE IF NOT EXISTS sal_tds_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  receipt_id INTEGER NOT NULL REFERENCES sal_receipts(id),
  demand_id INTEGER REFERENCES sal_demands(id),
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | verified | cancelled
  challan_no TEXT,                             -- Form 26QB acknowledgement number
  form16b_doc_id INTEGER REFERENCES documents(id),
  paid_on TEXT,
  verified_by INTEGER, verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tdscred_booking ON sal_tds_credits(booking_id, status);
CREATE INDEX IF NOT EXISTS idx_tdscred_receipt ON sal_tds_credits(receipt_id);

ALTER TABLE sal_booking_loans ADD COLUMN rm_name TEXT;          -- the bank's relationship manager for this loan
ALTER TABLE sal_booking_loans ADD COLUMN rm_email TEXT;
ALTER TABLE sal_booking_loans ADD COLUMN rm_phone TEXT;
ALTER TABLE sal_booking_loans ADD COLUMN coordinator_email TEXT; -- the bank's project coordinator, for escalation
ALTER TABLE sal_receipts ADD COLUMN backdate_note TEXT;          -- why a receipt dated more than a few days back was accepted
