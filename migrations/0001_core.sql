CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT, password_salt TEXT,
  lang TEXT NOT NULL DEFAULT 'en',
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, user_agent TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
  address TEXT, ward TEXT, city TEXT DEFAULT 'Mumbai',
  type TEXT DEFAULT 'new_build',
  status TEXT DEFAULT 'planning',
  rera_no TEXT, rera_expiry TEXT,
  start_date TEXT, target_date TEXT, budget_paise INTEGER,
  notes TEXT, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  module TEXT, entity TEXT, entity_id INTEGER,
  title TEXT NOT NULL, category TEXT,
  kind TEXT NOT NULL DEFAULT 'file',
  r2_key TEXT, external_url TEXT,
  blob_id INTEGER,
  mime TEXT, size_bytes INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE file_blobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT, size_bytes INTEGER, data BLOB,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT, link TEXT,
  read_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL,
  updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER,
  summary TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE counters (
  key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_otp_email ON otp_codes(email, created_at);
CREATE INDEX idx_documents_link ON documents(module, entity, entity_id);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);