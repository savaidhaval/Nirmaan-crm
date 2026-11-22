-- 0027: bulk sending of demand letters (WP-16). Additive only.
-- A "run" is one bulk send; each item is one demand in it. Nothing here changes how a demand is paid or reversed.
CREATE TABLE sal_bulk_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sal_bulk_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES sal_bulk_runs(id),
  demand_id INTEGER NOT NULL REFERENCES sal_demands(id),
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed | skipped
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  email_log_id INTEGER,
  sent_at TEXT,
  UNIQUE (run_id, demand_id)
);
CREATE INDEX idx_bulk_items_run ON sal_bulk_items(run_id, status);
CREATE INDEX idx_bulk_items_demand ON sal_bulk_items(demand_id, status);

-- Expiring, revocable link to a read-only copy of one demand letter (no login, no file address, no account number).
CREATE TABLE sal_demand_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  demand_id INTEGER NOT NULL REFERENCES sal_demands(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_dlinks_demand ON sal_demand_links(demand_id);

-- Daily email limit check counts sent emails by template and day.
CREATE INDEX idx_email_template_sent ON email_log(template, sent_at);
