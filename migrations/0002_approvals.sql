CREATE TABLE apr_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, authority TEXT,
  category TEXT DEFAULT 'approval',
  stage_order INTEGER DEFAULT 100,
  status TEXT DEFAULT 'not_started',
  applied_on TEXT, approved_on TEXT, valid_till TEXT,
  reminder_days INTEGER DEFAULT 30,
  renew_months INTEGER,
  owner_user_id INTEGER REFERENCES users(id),
  consultant TEXT, fee_paise INTEGER, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE apr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES apr_items(id),
  event TEXT NOT NULL, note TEXT, by_user INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_apr_project ON apr_items(project_id, status);
CREATE INDEX idx_apr_events_item ON apr_events(item_id);
CREATE INDEX idx_apr_valid ON apr_items(valid_till);