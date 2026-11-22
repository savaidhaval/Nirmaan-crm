-- 0028: Redevelopment module (WP-1 societies, members, consent; WP-2 rehab, transit rent, corpus, guarantees; WP-3 meetings). Additive only.
-- Money is in paise. Nothing is deleted: payments are reversed with a reason; members and societies are soft-deleted.

CREATE TABLE red_societies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, registration_no TEXT, address TEXT,
  consent_threshold_bp INTEGER NOT NULL DEFAULT 5100,      -- 5100 = 51%. Confirm the required majority with your advocate.
  count_basis TEXT NOT NULL DEFAULT 'members',             -- members | area
  threshold_reached INTEGER NOT NULL DEFAULT 0,            -- last known state, so a crossing is announced once
  notes TEXT, created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_red_soc_project ON red_societies(project_id, deleted_at);

CREATE TABLE red_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES red_societies(id),
  wing TEXT, unit_label TEXT NOT NULL, member_name TEXT NOT NULL, phone TEXT,
  member_type TEXT NOT NULL DEFAULT 'owner',               -- owner | tenant | commercial | other
  carpet_sqft REAL,
  consent_status TEXT NOT NULL DEFAULT 'pending',          -- pending | consented | declined
  consent_date TEXT, notes TEXT,
  client_uuid TEXT UNIQUE,
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_red_mem_soc ON red_members(society_id, deleted_at, consent_status);
CREATE INDEX idx_red_mem_unit ON red_members(society_id, unit_label);

CREATE TABLE red_consent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES red_societies(id),
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  from_status TEXT, to_status TEXT NOT NULL, note TEXT,
  by_user INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_red_ev_soc ON red_consent_events(society_id, id);
CREATE INDEX idx_red_ev_mem ON red_consent_events(member_id);

-- Member document checklist: the items come from the setting red.member_doc_checklist (empty until the Owner lists them).
CREATE TABLE red_member_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  item_key TEXT NOT NULL, document_id INTEGER REFERENCES documents(id),
  status TEXT NOT NULL DEFAULT 'pending',                  -- pending | received | not_needed
  updated_by INTEGER, updated_at TEXT NOT NULL,
  UNIQUE (member_id, item_key)
);

-- WP-2: rehab flat per member
CREATE TABLE red_rehab_allotments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL UNIQUE REFERENCES red_members(id),
  inventory_id INTEGER REFERENCES sal_inventory(id),
  entitlement_sqft REAL, allotted_on TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',                 -- proposed | allotted | possessed | cancelled
  created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX idx_red_rehab_inv ON red_rehab_allotments(inventory_id);

-- WP-2: transit rent. One term per member, a schedule row per month, payments are separate rows that can be reversed.
CREATE TABLE red_transit_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL UNIQUE REFERENCES red_members(id),
  monthly_rent_paise INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
  deposit_paise INTEGER NOT NULL DEFAULT 0,
  bg_ref TEXT, bg_amount_paise INTEGER, bg_expiry TEXT, notes TEXT,
  created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX idx_red_terms_bg ON red_transit_terms(bg_expiry);
CREATE TABLE red_transit_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  period TEXT NOT NULL,                                    -- YYYY-MM
  due_paise INTEGER NOT NULL, due_on TEXT NOT NULL,
  UNIQUE (member_id, period)
);
CREATE INDEX idx_red_sched_due ON red_transit_schedule(due_on);
CREATE TABLE red_transit_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES red_transit_schedule(id),
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  amount_paise INTEGER NOT NULL, paid_on TEXT NOT NULL, mode TEXT, ref_no TEXT,
  client_uuid TEXT UNIQUE,
  reversed_at TEXT, reversal_note TEXT, reversed_by INTEGER,
  created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX idx_red_pay_sched ON red_transit_payments(schedule_id, reversed_at);

-- WP-2: corpus fund entries (a charge with a due date, marked paid when received)
CREATE TABLE red_corpus_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  label TEXT NOT NULL, amount_paise INTEGER NOT NULL, due_on TEXT,
  paid_on TEXT, ref_no TEXT,
  reversed_at TEXT, reversal_note TEXT, reversed_by INTEGER,
  created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX idx_red_corpus_mem ON red_corpus_entries(member_id, reversed_at);

-- WP-3: meetings and resolutions (a record, not legal advice)
CREATE TABLE red_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES red_societies(id),
  kind TEXT NOT NULL DEFAULT 'general_body',               -- general_body | committee | other
  held_on TEXT NOT NULL, agenda TEXT, attendees_count INTEGER,
  resolution_text TEXT, resolution_passed INTEGER NOT NULL DEFAULT 0,
  minutes_document_id INTEGER REFERENCES documents(id),
  next_action TEXT, next_action_due TEXT, next_action_done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_red_meet_soc ON red_meetings(society_id, held_on);
CREATE INDEX idx_red_meet_due ON red_meetings(next_action_due, next_action_done);
