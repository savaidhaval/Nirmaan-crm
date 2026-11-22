-- 0019 (WP-9): vendor and contractor documents with expiry dates. Additive only. Document types are typed freely, not a fixed list.
CREATE TABLE IF NOT EXISTS pro_party_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL,                -- vendor | contractor
  party_id INTEGER NOT NULL,
  party_label TEXT,                        -- name at the time, so reminders need no lookup in another module
  doc_type TEXT NOT NULL,
  valid_till TEXT,                         -- YYYY-MM-DD, empty = no expiry
  reminder_days INTEGER NOT NULL DEFAULT 30,
  document_id INTEGER,
  note TEXT,
  superseded_by INTEGER,                   -- set when a newer copy replaces this one: stops reminders
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_partydoc_party ON pro_party_docs(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_partydoc_expiry ON pro_party_docs(valid_till);
