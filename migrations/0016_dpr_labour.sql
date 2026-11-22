-- 0016 (WP-6): daily report labour by contractor and trade. Additive only.
-- site_dprs.labour_count stays: for new reports it is the sum of these lines, for old reports it is the old single number.
CREATE TABLE IF NOT EXISTS site_dpr_labour (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dpr_id INTEGER NOT NULL REFERENCES site_dprs(id),
  contractor_id INTEGER NOT NULL,          -- no foreign key: the Site module never touches contractor tables
  trade TEXT,
  headcount INTEGER NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dprlab_dpr ON site_dpr_labour(dpr_id);
CREATE INDEX IF NOT EXISTS idx_dprlab_contractor ON site_dpr_labour(contractor_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dprlab_line ON site_dpr_labour(dpr_id, contractor_id, trade);
