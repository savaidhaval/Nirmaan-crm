-- 0012: late-payment interest, TOTP two-factor, project financials, vendor TDS/GST, DPDP erasure trail.

-- Late interest (RERA s.18 / Rule 18: simple interest on the delay). Interest is computed on demand, never stored,
-- so a changed rate or a reversed receipt can never leave a stale figure behind. What IS stored: interest actually
-- collected (a receipt of kind 'interest') and approved waivers.
ALTER TABLE sal_receipts ADD COLUMN kind TEXT NOT NULL DEFAULT 'principal';          -- principal | interest
CREATE TABLE sal_interest_waivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demand_id INTEGER NOT NULL REFERENCES sal_demands(id),
  amount_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',                                           -- requested | approved | rejected
  requested_by INTEGER REFERENCES users(id), approved_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_waiver_demand ON sal_interest_waivers(demand_id, status);

-- TOTP second factor
CREATE TABLE user_totp (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  secret_enc TEXT NOT NULL,
  enabled_at TEXT,                                                                    -- NULL until the first code is verified
  last_step INTEGER NOT NULL DEFAULT 0,                                               -- replay protection
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE user_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_recovery_user ON user_recovery_codes(user_id, used_at);
CREATE TABLE mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Project financials
ALTER TABLE projects ADD COLUMN percent_complete INTEGER NOT NULL DEFAULT 0;         -- engineer's / architect's certified completion

-- Vendor bills: project, GST, TDS
ALTER TABLE pro_bills ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE pro_bills ADD COLUMN taxable_paise INTEGER;
ALTER TABLE pro_bills ADD COLUMN gst_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pro_bills ADD COLUMN tds_section TEXT;                                   -- 194C, 194J, 194I ...
ALTER TABLE pro_bills ADD COLUMN tds_bp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pro_bills ADD COLUMN tds_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pro_bills ADD COLUMN tds_deposited_on TEXT;
ALTER TABLE pro_bills ADD COLUMN tds_challan TEXT;
UPDATE pro_bills SET project_id = (SELECT project_id FROM pro_pos WHERE pro_pos.id = pro_bills.po_id) WHERE po_id IS NOT NULL;
CREATE INDEX idx_bill_project ON pro_bills(project_id, status);
ALTER TABLE pro_vendors ADD COLUMN pan TEXT;                                         -- stored encrypted (enc: prefix)

-- DPDP: record of personal-data erasures (the audit log carries the who/why)
ALTER TABLE sal_leads ADD COLUMN erased_at TEXT;
ALTER TABLE sal_bookings ADD COLUMN erased_at TEXT;
