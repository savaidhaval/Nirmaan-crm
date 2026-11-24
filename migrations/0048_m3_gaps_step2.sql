-- 0048: Module 3 gaps, step 2. Additive only.
-- Slab sign-offs (Site Engineer + RCC consultant report confirmed by the Owner), GST held on RA bills until the contractor's returns are confirmed,
-- wing-wise physical completion entered by the PM, wing / floor on BOQ lines.

CREATE TABLE IF NOT EXISTS site_ms_signoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id INTEGER NOT NULL REFERENCES site_milestones(id),
  kind TEXT NOT NULL,                              -- site_engineer | rcc_consultant
  document_id INTEGER NOT NULL REFERENCES documents(id),
  note TEXT,
  uploaded_by INTEGER, uploaded_at TEXT NOT NULL,
  confirmed_by INTEGER, confirmed_at TEXT,         -- only the consultant report needs the Owner's confirmation
  superseded INTEGER NOT NULL DEFAULT 0            -- 1 = replaced by a newer upload of the same kind
);
CREATE INDEX IF NOT EXISTS idx_msso_ms ON site_ms_signoffs(milestone_id, kind, superseded);

ALTER TABLE con_ra_bills ADD COLUMN gst_hold INTEGER NOT NULL DEFAULT 0;        -- 1 = the GST part cannot be paid until Accounts confirm the contractor filed
ALTER TABLE con_ra_bills ADD COLUMN gst_confirmed_by INTEGER;
ALTER TABLE con_ra_bills ADD COLUMN gst_confirmed_at TEXT;
ALTER TABLE con_ra_bills ADD COLUMN gst_confirm_note TEXT;

CREATE TABLE IF NOT EXISTS site_wing_progress (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT NOT NULL,                              -- the wing or building name; '' = the whole standalone building
  pct_bp INTEGER NOT NULL,                         -- physical completion entered by the PM, in basis points (10000 = 100%)
  note TEXT, updated_by INTEGER, updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, wing)
);

ALTER TABLE bud_items ADD COLUMN wing TEXT;        -- wing, building or block; blank for a standalone building (or type Basement, Podium, Terrace...)
ALTER TABLE bud_items ADD COLUMN floor INTEGER;    -- floor the line belongs to; blank for lines that are not floor-wise
CREATE INDEX IF NOT EXISTS idx_bud_items_wing ON bud_items(project_id, wing, floor);
