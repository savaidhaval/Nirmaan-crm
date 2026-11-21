CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT,
  status TEXT DEFAULT 'queued',
  error TEXT, attempts INTEGER DEFAULT 0, next_attempt_at TEXT,
  template TEXT, related_entity TEXT, related_id INTEGER,
  attachment_document_id INTEGER REFERENCES documents(id),
  provider TEXT, message_id TEXT,
  created_at TEXT DEFAULT (datetime('now')), sent_at TEXT
);
CREATE TABLE backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT DEFAULT 'nightly',
  status TEXT DEFAULT 'running',
  cursor_json TEXT,
  files_written INTEGER DEFAULT 0, bytes INTEGER DEFAULT 0, note TEXT,
  started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
);
CREATE INDEX idx_email_status ON email_log(status, next_attempt_at);
CREATE INDEX idx_backup_started ON backup_log(started_at);
