-- 0020 (WP-10): site petty cash. Additive only. Cancel or reject, never delete.
CREATE TABLE IF NOT EXISTS pty_funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  custodian_user_id INTEGER NOT NULL,
  opening_paise INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pty_fund_project ON pty_funds(project_id, active);
CREATE INDEX IF NOT EXISTS idx_pty_fund_user ON pty_funds(custodian_user_id, active);

CREATE TABLE IF NOT EXISTS pty_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER NOT NULL REFERENCES pty_funds(id),
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- expense | top_up | return
  category TEXT, amount_paise INTEGER NOT NULL, narration TEXT,
  document_id INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted | approved | rejected | cancelled
  created_by INTEGER, approved_by INTEGER, decided_at TEXT, decision_note TEXT,
  client_uuid TEXT UNIQUE,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pty_entry_fund ON pty_entries(fund_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_pty_entry_status ON pty_entries(status, kind);
