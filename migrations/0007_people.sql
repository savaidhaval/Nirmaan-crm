CREATE TABLE ppl_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, role_title TEXT,
  department TEXT,
  phone TEXT, email TEXT, joined_on TEXT,
  employment TEXT DEFAULT 'staff',
  active INTEGER DEFAULT 1, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE ppl_hiring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position TEXT NOT NULL, project_id INTEGER REFERENCES projects(id),
  status TEXT DEFAULT 'open',
  opened_on TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE ppl_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hiring_id INTEGER NOT NULL REFERENCES ppl_hiring(id),
  name TEXT NOT NULL, phone TEXT,
  status TEXT DEFAULT 'new',
  interview_on TEXT, note TEXT,
  resume_document_id INTEGER REFERENCES documents(id),
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE INDEX idx_cand_hiring ON ppl_candidates(hiring_id, status);
