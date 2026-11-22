-- 0023 (WP-11..14): numbering and receipt approval, credit notes, co-applicants, cost sheets, handover. Additive only.

-- WP-11 ------------------------------------------------------------------
ALTER TABLE sal_demands ADD COLUMN demand_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_demand_no ON sal_demands(demand_no) WHERE demand_no IS NOT NULL;

-- Large receipts wait here for a second person. Nothing in reports or balances changes until they are approved (then a normal receipt is posted).
CREATE TABLE IF NOT EXISTS sal_receipt_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  demand_id INTEGER,
  amount_paise INTEGER NOT NULL, tds_paise INTEGER NOT NULL DEFAULT 0,
  mode TEXT, ref_no TEXT, received_on TEXT, note TEXT,
  account TEXT NOT NULL DEFAULT 'rera_designated', kind TEXT NOT NULL DEFAULT 'principal',
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approving | approved | rejected
  requested_by INTEGER, decided_by INTEGER, decided_at TEXT, decision_note TEXT,
  receipt_id INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rcpt_req_status ON sal_receipt_requests(status, booking_id);

-- Credit notes, debit notes and adjustments change what a demand asks for; each has its own number.
CREATE TABLE IF NOT EXISTS sal_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  demand_id INTEGER NOT NULL REFERENCES sal_demands(id),
  kind TEXT NOT NULL,                        -- credit_note | debit_note | adjustment
  adj_no TEXT,
  amount_paise INTEGER NOT NULL, gst_paise INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | reversed
  created_by INTEGER, approved_by INTEGER, approved_at TEXT, reversed_at TEXT, reversal_note TEXT, decision_note TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_adj_booking ON sal_adjustments(booking_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_adj_no ON sal_adjustments(adj_no) WHERE adj_no IS NOT NULL;

-- WP-12 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sal_booking_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  name TEXT NOT NULL, phone TEXT, relation TEXT,
  share_bp INTEGER NOT NULL DEFAULT 0,
  pan_enc TEXT,                              -- encrypted; last 4 shown to Owner, Accounts and the booking's own salesperson only
  aadhaar_masked TEXT,                       -- 'XXXX XXXX 1234' only: the full number is never stored
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_party_booking ON sal_booking_parties(booking_id);

-- WP-13 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sal_cost_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES sal_inventory(id),
  lead_id INTEGER, booking_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  area_basis TEXT NOT NULL DEFAULT 'rera_carpet',    -- rera_carpet | carpet
  area_sqft REAL NOT NULL, base_rate_paise_per_sqft INTEGER NOT NULL,
  base_paise INTEGER NOT NULL, additions_paise INTEGER NOT NULL DEFAULT 0, discount_paise INTEGER NOT NULL DEFAULT 0,
  list_paise INTEGER NOT NULL,                       -- the unit's rate-card price when the sheet was made
  agreement_value_paise INTEGER NOT NULL,
  below_list_paise INTEGER NOT NULL DEFAULT 0,       -- how far the agreement value is under the rate card: this is what approval bands use
  gst_bp INTEGER NOT NULL DEFAULT 0, gst_paise INTEGER NOT NULL DEFAULT 0,
  stamp_duty_bp INTEGER NOT NULL DEFAULT 0, stamp_duty_paise INTEGER NOT NULL DEFAULT 0, registration_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',              -- draft | pending_approval | approved | rejected | superseded
  note TEXT,
  created_by INTEGER, approved_by INTEGER, approved_at TEXT, decision_note TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cs_unit ON sal_cost_sheets(unit_id, lead_id, status);
CREATE INDEX IF NOT EXISTS idx_cs_status ON sal_cost_sheets(status);

CREATE TABLE IF NOT EXISTS sal_cost_sheet_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL REFERENCES sal_cost_sheets(id),
  label TEXT NOT NULL, kind TEXT NOT NULL,           -- addition | discount
  amount_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cs_lines ON sal_cost_sheet_lines(sheet_id);

-- WP-14 ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sal_handover (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES sal_bookings(id),
  status TEXT NOT NULL DEFAULT 'in_progress',        -- in_progress | handed_over
  possession_offered_on TEXT, possession_given_on TEXT, oc_reference TEXT, notes TEXT,
  opened_by INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS sal_handover_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handover_id INTEGER NOT NULL REFERENCES sal_handover(id),
  label TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, done_on TEXT, note TEXT, document_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ho_items ON sal_handover_items(handover_id);
CREATE INDEX IF NOT EXISTS idx_ho_due ON sal_handover(status, possession_offered_on);

CREATE TABLE IF NOT EXISTS sal_booking_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  bank TEXT NOT NULL, sanction_paise INTEGER NOT NULL DEFAULT 0, sanction_date TEXT, disbursed_paise INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_loan_booking ON sal_booking_loans(booking_id);

ALTER TABLE site_snags ADD COLUMN unit_id INTEGER;   -- a snag found inside one flat
CREATE INDEX IF NOT EXISTS idx_snag_unit ON site_snags(unit_id);
