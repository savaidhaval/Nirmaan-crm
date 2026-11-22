-- 0021: professionals register (architects, engineers, advocates, CAs, consultants...) and a "contract" kind on party documents. Additive only.
CREATE TABLE IF NOT EXISTS pro_professionals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  profession TEXT,                 -- typed freely: Architect, Structural engineer, Advocate, CA, Liaison, Valuer...
  firm TEXT, phone TEXT, email TEXT, gstin TEXT,
  pan_enc TEXT,                    -- encrypted, last 4 shown to Owner and Accounts only
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prof_active ON pro_professionals(active, name);
ALTER TABLE pro_party_docs ADD COLUMN kind TEXT NOT NULL DEFAULT 'document';   -- contract | document
