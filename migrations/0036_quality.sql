-- 0036: quality on site — pour cards, cube tests, non-conformance reports (NCR) — and the structured daily report. Additive only.

-- Pour card: asked for by the site engineer, checked and approved by the PM before concrete is poured.
CREATE TABLE IF NOT EXISTS qa_pours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, floor INTEGER,
  element TEXT NOT NULL,                 -- slab | beam | column | footing | raft | wall | staircase | other
  location TEXT,                         -- grid / bay
  grade TEXT NOT NULL,                   -- M20, M25, M30 ...
  qty_cum REAL NOT NULL,                 -- planned quantity (cubic metres)
  planned_date TEXT,
  drawing_ref TEXT,                      -- the issued-for-construction drawing and revision
  rmc_supplier TEXT,
  checklist TEXT NOT NULL,               -- JSON: { item: true/false } for the pre-pour checks
  photo_doc_id INTEGER,
  status TEXT NOT NULL DEFAULT 'requested',   -- requested | approved | poured | cancelled
  requested_by INTEGER, created_at TEXT,
  approved_by INTEGER, approved_at TEXT, override_note TEXT,
  poured_on TEXT, poured_qty_cum REAL, rmc_tickets TEXT, poured_by INTEGER,
  cancel_note TEXT, client_uuid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_qa_pours_proj ON qa_pours(project_id, status, planned_date);

-- Cube test: one row per test age (7 and 28 days) for each pour, made when the pour is recorded.
CREATE TABLE IF NOT EXISTS qa_cubes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pour_id INTEGER NOT NULL REFERENCES qa_pours(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  age_days INTEGER NOT NULL,             -- 7 | 28
  due_date TEXT NOT NULL,
  required_mpa REAL NOT NULL,            -- what this age must reach
  result_mpa REAL,                       -- average of the set
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | pass | fail
  tested_on TEXT, lab TEXT, report_doc_id INTEGER, entered_by INTEGER, entered_at TEXT,
  UNIQUE (pour_id, age_days)
);
CREATE INDEX IF NOT EXISTS idx_qa_cubes_due ON qa_cubes(status, due_date);
CREATE INDEX IF NOT EXISTS idx_qa_cubes_proj ON qa_cubes(project_id, status);

-- Non-conformance report: raised by a failed cube or by hand; closed by the PM with the correction.
CREATE TABLE IF NOT EXISTS qa_ncrs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, floor INTEGER,
  source TEXT NOT NULL DEFAULT 'site',   -- cube7 | cube28 | site
  pour_id INTEGER, cube_id INTEGER,
  title TEXT NOT NULL, details TEXT,
  contractor_id INTEGER,                 -- the contractor responsible (no foreign key: quality never touches contractor tables)
  assigned_to INTEGER, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed
  correction TEXT, closed_by INTEGER, closed_at TEXT, closing_doc_id INTEGER,
  photo_doc_id INTEGER, created_by INTEGER, created_at TEXT, client_uuid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_qa_ncr_proj ON qa_ncrs(project_id, status, wing, floor);
CREATE INDEX IF NOT EXISTS idx_qa_ncr_user ON qa_ncrs(assigned_to, status);

-- Structured daily report: what work was done where, how much; rain and hours lost.
CREATE TABLE IF NOT EXISTS site_dpr_work (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dpr_id INTEGER NOT NULL REFERENCES site_dprs(id),
  wing TEXT, floor INTEGER, activity TEXT NOT NULL,
  qty REAL, unit TEXT
);
CREATE INDEX IF NOT EXISTS idx_dpr_work ON site_dpr_work(dpr_id);
CREATE INDEX IF NOT EXISTS idx_dpr_work_act ON site_dpr_work(activity, wing, floor);
ALTER TABLE site_dprs ADD COLUMN hours_lost REAL;
ALTER TABLE site_dprs ADD COLUMN lost_reason TEXT;     -- rain | material | labour | power | approvals | other
