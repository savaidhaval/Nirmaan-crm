-- 0024 (WP-15): RERA designated-account tracker. Additive only. Entries are reversed with a reason, never deleted.
CREATE TABLE IF NOT EXISTS rera_account_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- deposit | withdrawal
  amount_paise INTEGER NOT NULL,
  ref_no TEXT,                              -- bank reference
  cert_ref TEXT,                            -- the CA / engineer / architect certificate behind a withdrawal
  note TEXT,
  created_by INTEGER, created_at TEXT,
  reversed_at TEXT, reversed_by INTEGER, reversal_note TEXT,
  client_uuid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_rera_project ON rera_account_entries(project_id, entry_date);
