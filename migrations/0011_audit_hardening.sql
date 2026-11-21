-- 0011_audit_hardening.sql — unit holds, lead protection, discount control, receipt integrity,
-- refunds, marketing spend, and a tamper-resistant audit log.

-- Payment plan stages are never deleted (existing demands point at them); a changed plan retires the old stages.
ALTER TABLE sal_plan_stages ADD COLUMN retired INTEGER NOT NULL DEFAULT 0;

-- Inventory: sale vs rehab segregation, 48h holds
ALTER TABLE sal_inventory ADD COLUMN category TEXT NOT NULL DEFAULT 'sale';          -- sale | rehab
ALTER TABLE sal_inventory ADD COLUMN hold_by INTEGER REFERENCES users(id);
ALTER TABLE sal_inventory ADD COLUMN hold_lead_id INTEGER REFERENCES sal_leads(id);
ALTER TABLE sal_inventory ADD COLUMN hold_at TEXT;
ALTER TABLE sal_inventory ADD COLUMN list_note TEXT;
CREATE INDEX idx_inventory_grid ON sal_inventory(project_id, wing, floor);
CREATE INDEX idx_inventory_hold ON sal_inventory(status, blocked_till);

-- Leads: normalised phone (last 10 digits) for duplicate / poaching checks, channel-partner registration
ALTER TABLE sal_leads ADD COLUMN phone_norm TEXT;
ALTER TABLE sal_leads ADD COLUMN channel_partner_id INTEGER REFERENCES sal_partners(id);
UPDATE sal_leads SET phone_norm = substr(replace(replace(replace(replace(phone, '+', ''), ' ', ''), '-', ''), '(', ''), -10);
CREATE INDEX idx_lead_phone_norm ON sal_leads(phone_norm);
CREATE INDEX idx_lead_project_status ON sal_leads(project_id, status);

-- Bookings: price override trail
ALTER TABLE sal_bookings ADD COLUMN list_price_paise INTEGER;
ALTER TABLE sal_bookings ADD COLUMN discount_reason TEXT;
ALTER TABLE sal_bookings ADD COLUMN approved_by INTEGER REFERENCES users(id);
ALTER TABLE sal_bookings ADD COLUMN unit_snapshot TEXT;                              -- JSON of the cost sheet at booking time

-- Receipts: sequential numbers, account routing (RERA 70% designated vs other), reversal trail
ALTER TABLE sal_receipts ADD COLUMN receipt_no TEXT;
ALTER TABLE sal_receipts ADD COLUMN account TEXT NOT NULL DEFAULT 'rera_designated'; -- rera_designated | project_other
ALTER TABLE sal_receipts ADD COLUMN reversed_by INTEGER REFERENCES users(id);
CREATE UNIQUE INDEX uq_receipt_no ON sal_receipts(receipt_no) WHERE receipt_no IS NOT NULL;

-- Refunds after cancellation: request -> approve (different person) -> paid
CREATE TABLE sal_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  amount_paise INTEGER NOT NULL,
  forfeited_paise INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested',                                          -- requested | approved | paid | rejected
  requested_by INTEGER REFERENCES users(id), approved_by INTEGER REFERENCES users(id),
  paid_on TEXT, ref_no TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_refund_booking ON sal_refunds(booking_id, status);

-- Marketing spend (entered monthly) for cost-per-lead / visit / booking
CREATE TABLE mkt_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  source TEXT NOT NULL,
  month TEXT NOT NULL,                                                               -- YYYY-MM
  amount_paise INTEGER NOT NULL,
  note TEXT, created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_mkt_spend ON mkt_spend(project_id, month);

-- Webhook de-duplication / replay protection
CREATE TABLE webhook_seen (
  id TEXT PRIMARY KEY,
  source TEXT, seen_at TEXT DEFAULT (datetime('now'))
);

-- Audit log: append-only. Updates and deletes are rejected by the database itself.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
