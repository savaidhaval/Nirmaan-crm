-- 0046: Module 2 gaps, step 3. Additive only. Pricing matrix per project.
-- Money in paise; rates "per sq ft" are per RERA carpet sq ft. Confirm every figure with your CA before use.

CREATE TABLE IF NOT EXISTS sal_price_matrix (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  base_rate_paise INTEGER NOT NULL,                 -- base rate per RERA carpet sq ft
  rise_paise_per_floor INTEGER NOT NULL DEFAULT 0,  -- floor rise: per sq ft, for each floor from rise_from_floor upward
  rise_from_floor INTEGER NOT NULL DEFAULT 1,
  parking_paise INTEGER NOT NULL DEFAULT 0,         -- per parking slot
  club_paise INTEGER NOT NULL DEFAULT 0,            -- club / amenities membership, per flat
  dev_paise INTEGER NOT NULL DEFAULT 0,             -- development charges, per flat
  updated_by INTEGER, updated_at TEXT
);

-- Preferential location charges. A flat carries tags (sal_inventory.plc_tags, e.g. "garden,corner"); a rule applies to every flat with its tag.
CREATE TABLE IF NOT EXISTS sal_plc_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  tag TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,                               -- per_sqft | flat
  amount_paise INTEGER NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_plc_project ON sal_plc_rules(project_id, retired);

ALTER TABLE sal_inventory ADD COLUMN plc_tags TEXT;  -- comma separated, lower case
