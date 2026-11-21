CREATE TABLE site_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, name TEXT NOT NULL,
  milestone_key TEXT,
  planned_date TEXT, actual_date TEXT,
  status TEXT DEFAULT 'pending',
  sort_order INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE site_dprs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  report_date TEXT NOT NULL, wing TEXT,
  work_summary TEXT NOT NULL,
  labour_count INTEGER, weather TEXT,
  materials_used TEXT, issues TEXT, safety_incident TEXT,
  created_by INTEGER REFERENCES users(id),
  client_uuid TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE site_snags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT, location TEXT, title TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  assigned_to INTEGER REFERENCES users(id), due_date TEXT, closed_at TEXT,
  created_by INTEGER REFERENCES users(id), client_uuid TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE INDEX idx_dpr_project_date ON site_dprs(project_id, report_date);
CREATE INDEX idx_milestone_project ON site_milestones(project_id, status);
CREATE UNIQUE INDEX uq_milestone_key ON site_milestones(project_id, COALESCE(wing,''), milestone_key) WHERE milestone_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_snag_project ON site_snags(project_id, status);