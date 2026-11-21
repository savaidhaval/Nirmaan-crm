CREATE TABLE sal_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
  source TEXT DEFAULT 'other',
  source_detail TEXT, budget_paise INTEGER, config_pref TEXT,
  status TEXT DEFAULT 'new',
  assigned_to INTEGER REFERENCES users(id),
  next_followup_at TEXT, last_contact_at TEXT,
  first_contact_at TEXT,
  consent INTEGER DEFAULT 0, consent_at TEXT,
  notes TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES sal_leads(id),
  type TEXT DEFAULT 'call',
  outcome TEXT, note TEXT, by_user INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sal_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES sal_leads(id),
  project_id INTEGER REFERENCES projects(id),
  visit_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled',
  feedback TEXT, by_user INTEGER, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, floor INTEGER, unit_no TEXT NOT NULL,
  type TEXT,
  carpet_sqft REAL, rera_carpet_sqft REAL,
  price_paise INTEGER, floor_rise_paise INTEGER DEFAULT 0,
  status TEXT DEFAULT 'available',
  blocked_till TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firm TEXT NOT NULL, contact TEXT, phone TEXT, rera_no TEXT,
  brokerage_default_bp INTEGER, notes TEXT, active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  unit_id INTEGER NOT NULL REFERENCES sal_inventory(id),
  lead_id INTEGER REFERENCES sal_leads(id),
  customer_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
  pan TEXT, aadhaar_masked TEXT,
  token_paise INTEGER, agreed_price_paise INTEGER NOT NULL,
  payment_plan TEXT DEFAULT 'clp',
  booking_date TEXT, agreement_date TEXT, registration_date TEXT,
  gst_bp INTEGER DEFAULT 500,
  status TEXT DEFAULT 'token',
  cancelled_on TEXT, cancel_reason TEXT,
  channel_partner_id INTEGER REFERENCES sal_partners(id),
  brokerage_bp INTEGER, created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sal_plan_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  stage_name TEXT NOT NULL,
  pct_bp INTEGER NOT NULL,
  milestone_key TEXT,
  sort_order INTEGER DEFAULT 100
);
CREATE TABLE sal_demands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  milestone_id INTEGER REFERENCES site_milestones(id),
  stage_id INTEGER REFERENCES sal_plan_stages(id),
  label TEXT NOT NULL, amount_paise INTEGER NOT NULL, gst_paise INTEGER DEFAULT 0,
  due_date TEXT,
  settled_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'scheduled',
  letter_document_id INTEGER REFERENCES documents(id),
  sent_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sal_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  demand_id INTEGER REFERENCES sal_demands(id),
  amount_paise INTEGER NOT NULL,
  tds_paise INTEGER NOT NULL DEFAULT 0,
  mode TEXT,
  ref_no TEXT, received_on TEXT NOT NULL, received_by INTEGER, note TEXT,
  reversed_at TEXT, reversal_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sal_brokerage_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  partner_id INTEGER NOT NULL REFERENCES sal_partners(id),
  amount_paise INTEGER NOT NULL, tds_paise INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT NOT NULL, mode TEXT, ref_no TEXT, note TEXT,
  reversed_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_lead_assignee ON sal_leads(assigned_to, status, next_followup_at);
CREATE INDEX idx_lead_phone ON sal_leads(phone);
CREATE INDEX idx_inventory_project ON sal_inventory(project_id, status);
CREATE INDEX idx_demand_due ON sal_demands(due_date, status);
CREATE INDEX idx_receipt_booking ON sal_receipts(booking_id);
CREATE INDEX idx_activity_lead ON sal_activities(lead_id, created_at);
CREATE INDEX idx_visit_lead ON sal_visits(lead_id, visit_at);
CREATE INDEX idx_visit_day ON sal_visits(visit_at, status);
CREATE INDEX idx_booking_project ON sal_bookings(project_id, status);
CREATE INDEX idx_demand_booking ON sal_demands(booking_id, status);
CREATE INDEX idx_brokerage_booking ON sal_brokerage_payments(booking_id);
CREATE UNIQUE INDEX uq_inventory_unit ON sal_inventory(project_id, COALESCE(wing,''), unit_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_booking_one_active_per_unit ON sal_bookings(unit_id) WHERE status <> 'cancelled' AND deleted_at IS NULL;
