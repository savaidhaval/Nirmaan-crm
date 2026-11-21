CREATE TABLE drw_drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  discipline TEXT DEFAULT 'arch',
  zone TEXT,
  waiting_consultant INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE drw_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id INTEGER NOT NULL REFERENCES drw_drawings(id),
  rev_no TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  issued_on TEXT, received_from TEXT, note TEXT,
  document_id INTEGER REFERENCES documents(id),
  issued_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_drw_project ON drw_drawings(project_id, discipline);
CREATE INDEX idx_rev_drawing ON drw_revisions(drawing_id, status);
CREATE UNIQUE INDEX uq_drw_code ON drw_drawings(project_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_rev_no ON drw_revisions(drawing_id, rev_no);
CREATE UNIQUE INDEX uq_rev_one_ifc ON drw_revisions(drawing_id) WHERE status = 'ifc';