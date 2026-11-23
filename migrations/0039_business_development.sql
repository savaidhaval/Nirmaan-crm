-- 0039: Business Development — where new projects come from: opportunities, follow-ups, feasibility studies,
-- the 79A process for societies, the development agreement (signed, then registered), and conversion into a project. Additive only.

CREATE TABLE IF NOT EXISTS bd_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                     -- e.g. "Shanti Niketan CHS, Andheri West"
  kind TEXT NOT NULL DEFAULT 'society',   -- society | land | jv | other
  society_name TEXT, address TEXT, ward TEXT,
  plot_area_sqm REAL, members_count INTEGER,
  source TEXT,                            -- broker, member, PMC, direct, tender notice...
  contact_name TEXT, contact_phone TEXT,  -- +91 format
  owner_user_id INTEGER,                  -- our person in charge
  stage TEXT NOT NULL DEFAULT 'identified',   -- identified | follow_up | feasibility | process_79a | da_signed | da_registered
  status TEXT NOT NULL DEFAULT 'open',    -- open | won | lost | dropped
  next_followup TEXT, lost_reason TEXT,
  da_signed_on TEXT, da_doc_id INTEGER, da_registered_on TEXT, da_reg_no TEXT,
  override_note TEXT,                     -- the Owner went past an open 79A step, and why
  project_id INTEGER,                     -- the project it became
  notes TEXT, created_by INTEGER, created_at TEXT, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bd_opp ON bd_opportunities(status, stage, next_followup);
CREATE INDEX IF NOT EXISTS idx_bd_owner ON bd_opportunities(owner_user_id, status);

CREATE TABLE IF NOT EXISTS bd_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES bd_opportunities(id),
  on_date TEXT NOT NULL, kind TEXT,       -- call | meeting | site_visit | email | other
  note TEXT NOT NULL, next_date TEXT,
  created_by INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bd_fu ON bd_followups(opportunity_id, id);

CREATE TABLE IF NOT EXISTS bd_studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES bd_opportunities(id),
  version INTEGER NOT NULL, study_date TEXT, title TEXT,
  est_cost_paise INTEGER, est_revenue_paise INTEGER, saleable_sqft REAL, completion_months INTEGER,
  document_id INTEGER, notes TEXT, created_by INTEGER, created_at TEXT,
  UNIQUE (opportunity_id, version)
);

-- Steps of the 79A process (society) — the list is a setting; each is ticked with its date and, where there is one, the paper.
CREATE TABLE IF NOT EXISTS bd_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES bd_opportunities(id),
  step TEXT NOT NULL, done_on TEXT, note TEXT, document_id INTEGER,
  done_by INTEGER, created_at TEXT,
  UNIQUE (opportunity_id, step)
);

-- Project life-cycle steps that happen before construction and are not approvals or site milestones:
-- designs finalised, vacating notice issued, vacating complete (land/JV projects), demolition, DA registered (projects not from Business Development).
CREATE TABLE IF NOT EXISTS prj_lifecycle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  step TEXT NOT NULL, done_on TEXT, note TEXT, document_id INTEGER,
  override_note TEXT, done_by INTEGER, created_at TEXT,
  UNIQUE (project_id, step)
);
