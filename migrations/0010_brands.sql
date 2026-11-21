-- 0010_brands.sql — several brands in one CRM. Each project belongs to one brand; letters, branding
-- and pictures resolve per brand (project overrides still win field by field).

CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX uq_brand_name ON brands(lower(name)) WHERE deleted_at IS NULL;

INSERT INTO brands (id, name, is_default) VALUES (1, 'Default', 1);

ALTER TABLE brand_profiles ADD COLUMN brand_id INTEGER REFERENCES brands(id);
ALTER TABLE projects ADD COLUMN brand_id INTEGER REFERENCES brands(id);

-- existing company-wide profile becomes the default brand's profile; existing projects join the default brand
UPDATE brand_profiles SET brand_id = 1;
UPDATE projects SET brand_id = 1;

-- one profile per brand, plus at most one override per project
DROP INDEX IF EXISTS uq_brand_scope;
CREATE UNIQUE INDEX uq_brand_scope ON brand_profiles(COALESCE(brand_id, 0), COALESCE(project_id, 0));

-- brand pictures are now per brand: brand:logo -> brand:1:logo
UPDATE documents SET series_key = 'brand:1:' || substr(series_key, 7)
 WHERE series_key LIKE 'brand:%' AND series_key NOT LIKE 'brand:%:%';

CREATE INDEX idx_projects_brand ON projects(brand_id);
