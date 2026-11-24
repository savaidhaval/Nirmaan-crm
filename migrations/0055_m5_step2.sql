-- 0055: Module 5, step 2. Additive only.
-- Floor-plan library: one plan picture per unit type per project, reused for every snag in a flat of that type.
CREATE TABLE IF NOT EXISTS plan_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  unit_type TEXT NOT NULL,                       -- as written on the flat (2BHK, 3BHK ...)
  label TEXT, doc_id INTEGER NOT NULL REFERENCES documents(id),
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_type ON plan_library(project_id, unit_type) WHERE deleted_at IS NULL;

-- Handover: possession notice, buyer's joint inspection, buyer-signed baseline of the flat as handed over.
ALTER TABLE sal_handover ADD COLUMN notice_on TEXT;
ALTER TABLE sal_handover ADD COLUMN notice_due_on TEXT;
ALTER TABLE sal_handover ADD COLUMN inspection_on TEXT;
ALTER TABLE sal_handover ADD COLUMN inspection_name TEXT;
ALTER TABLE sal_handover ADD COLUMN inspection_remarks TEXT;
ALTER TABLE sal_handover ADD COLUMN baseline_signed_on TEXT;
ALTER TABLE sal_handover ADD COLUMN baseline_signed_name TEXT;

-- One-time links the buyer opens without a login (only the SHA-256 of the token is kept).
CREATE TABLE IF NOT EXISTS sal_hv_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  kind TEXT NOT NULL,                            -- inspection | slot | baseline
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT,
  created_by INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hvl_booking ON sal_hv_links(booking_id, kind);

-- Handover time slots (45 minutes each by default) the buyer picks from once the no-dues points are green.
CREATE TABLE IF NOT EXISTS sal_handover_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  slot_on TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  booking_id INTEGER REFERENCES sal_bookings(id), booked_at TEXT,
  created_by INTEGER, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot ON sal_handover_slots(project_id, slot_on, start_time);
CREATE INDEX IF NOT EXISTS idx_slot_booking ON sal_handover_slots(booking_id);

-- Fit-out NOC: interior work may begin only with this, after the deposit is received and the baseline is signed.
CREATE TABLE IF NOT EXISTS sal_fitout_noc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES sal_bookings(id),
  noc_no TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'issued',   -- issued | revoked
  issued_on TEXT NOT NULL, valid_till TEXT, note TEXT, issued_by INTEGER,
  revoked_on TEXT, revoked_reason TEXT, created_at TEXT
);

-- Defect helpdesk: who complained by phone / QR form, and the numbered debit note raised against the contractor's retention.
ALTER TABLE dlp_tickets ADD COLUMN raised_phone TEXT;
ALTER TABLE dlp_tickets ADD COLUMN debit_no TEXT;
ALTER TABLE dlp_tickets ADD COLUMN debit_on TEXT;

-- Common-area costs paid during the transition period, entered by the team and certified by the CA, for the society statement.
CREATE TABLE IF NOT EXISTS chs_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  spent_on TEXT NOT NULL, head TEXT NOT NULL,    -- electricity | security | housekeeping | water | lift_amc | repairs | other
  amount_paise INTEGER NOT NULL, bill_no TEXT, paid_to TEXT, note TEXT,
  certified_by_name TEXT, certified_on TEXT,
  created_by INTEGER, created_at TEXT, reversed_at TEXT, reversed_by INTEGER, reverse_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_chsx_project ON chs_expenses(project_id, spent_on);

-- Society formation: one row per project, plus its committee.
CREATE TABLE IF NOT EXISTS chs_society (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
  society_name TEXT, stage TEXT NOT NULL DEFAULT 'proposed',     -- proposed | provisional | registered
  registration_no TEXT, registered_on TEXT,
  share_cert_count INTEGER NOT NULL DEFAULT 0, shares_issued_on TEXT,
  conveyance_on TEXT, conveyance_ref TEXT, notes TEXT,
  updated_by INTEGER, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS chs_committee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL,                            -- chairman | secretary | treasurer | member
  name TEXT NOT NULL, phone TEXT, since TEXT,
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chsc_project ON chs_committee(project_id);
