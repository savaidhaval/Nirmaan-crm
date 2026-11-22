-- 0014 (WP-4): indents, multi-line RFQ, per-line quotes. Additive only.
CREATE TABLE IF NOT EXISTS pro_indents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  indent_no TEXT NOT NULL,
  needed_by TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',   -- draft|submitted|approved|rejected|converted
  requested_by INTEGER,
  decided_by INTEGER, decided_at TEXT, decision_note TEXT,
  rfq_id INTEGER,
  client_uuid TEXT UNIQUE,
  created_at TEXT, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_indent_no ON pro_indents(indent_no);
CREATE INDEX IF NOT EXISTS idx_indent_project_status ON pro_indents(project_id, status);

CREATE TABLE IF NOT EXISTS pro_indent_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indent_id INTEGER NOT NULL REFERENCES pro_indents(id),
  description TEXT NOT NULL, qty REAL, unit TEXT
);
CREATE INDEX IF NOT EXISTS idx_indent_items ON pro_indent_items(indent_id);

CREATE TABLE IF NOT EXISTS pro_rfq_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES pro_rfqs(id),
  description TEXT NOT NULL, qty REAL, unit TEXT
);
CREATE INDEX IF NOT EXISTS idx_rfq_items ON pro_rfq_items(rfq_id);

CREATE TABLE IF NOT EXISTS pro_quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES pro_quotes(id),
  rfq_item_id INTEGER NOT NULL REFERENCES pro_rfq_items(id),
  rate_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_items ON pro_quote_items(quote_id);

ALTER TABLE pro_rfqs ADD COLUMN indent_id INTEGER;
