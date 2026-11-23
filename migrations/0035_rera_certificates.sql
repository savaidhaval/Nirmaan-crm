-- 0035: certificates behind every withdrawal from the MahaRERA designated account. Additive only.
-- Architect and engineer certify the % of work done; the CA certifies the amount that may be withdrawn.
CREATE TABLE IF NOT EXISTS rera_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,                 -- architect | engineer | ca
  cert_no TEXT NOT NULL, cert_date TEXT NOT NULL,
  issued_by TEXT,                     -- name of the architect / engineer / CA firm
  pct_complete_bp INTEGER,            -- architect / engineer: work done, 6500 = 65%
  amount_paise INTEGER,               -- CA: amount that may be withdrawn
  document_id INTEGER NOT NULL,       -- the certificate itself (documents.id)
  note TEXT, created_by INTEGER, created_at TEXT,
  cancelled_at TEXT, cancelled_by INTEGER, cancel_note TEXT     -- never deleted: a wrong entry is cancelled with a reason
);
CREATE INDEX IF NOT EXISTS idx_rera_cert ON rera_certificates(project_id, kind, cert_date);
ALTER TABLE rera_account_entries ADD COLUMN architect_cert_id INTEGER;
ALTER TABLE rera_account_entries ADD COLUMN engineer_cert_id INTEGER;
ALTER TABLE rera_account_entries ADD COLUMN ca_cert_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_rera_entry_ca ON rera_account_entries(ca_cert_id);
