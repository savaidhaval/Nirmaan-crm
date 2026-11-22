-- 0025 (WP-19): structured site-visit feedback and an optional location check-in. Additive only.
ALTER TABLE sal_visits ADD COLUMN interest TEXT;          -- hot | warm | cold
ALTER TABLE sal_visits ADD COLUMN objection TEXT;
ALTER TABLE sal_visits ADD COLUMN next_step TEXT;
ALTER TABLE sal_visits ADD COLUMN checked_in_at TEXT;
ALTER TABLE sal_visits ADD COLUMN lat REAL;
ALTER TABLE sal_visits ADD COLUMN lng REAL;
ALTER TABLE sal_visits ADD COLUMN accuracy_m REAL;
ALTER TABLE sal_visits ADD COLUMN distance_m INTEGER;     -- from the project's location at the time of check-in
ALTER TABLE projects ADD COLUMN lat REAL;
ALTER TABLE projects ADD COLUMN lng REAL;
CREATE INDEX IF NOT EXISTS idx_visit_status ON sal_visits(status, project_id);
