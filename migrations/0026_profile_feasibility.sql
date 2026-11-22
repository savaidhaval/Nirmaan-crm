-- 0026: staff profiles (position, about, display picture), kudos, project feasibility versions. Additive only.
ALTER TABLE users ADD COLUMN position TEXT;             -- job title, e.g. Site Engineer
ALTER TABLE users ADD COLUMN about TEXT;
ALTER TABLE users ADD COLUMN avatar_blob_id INTEGER;    -- file_blobs row holding the small display picture
ALTER TABLE users ADD COLUMN avatar_updated_at TEXT;

CREATE TABLE IF NOT EXISTS eng_kudos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user INTEGER NOT NULL, to_user INTEGER NOT NULL,
  message TEXT NOT NULL, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kudos_to ON eng_kudos(to_user, id);
CREATE INDEX IF NOT EXISTS idx_kudos_from_day ON eng_kudos(from_user, created_at);

-- One row per version of a project's feasibility study. Versions only ever grow: version 2, 3, ... and the old ones stay readable.
CREATE TABLE IF NOT EXISTS fea_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  title TEXT, notes TEXT, study_date TEXT,
  est_cost_paise INTEGER, est_revenue_paise INTEGER, saleable_sqft REAL, completion_months INTEGER,
  document_id INTEGER,
  created_by INTEGER, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fea_version ON fea_versions(project_id, version);
