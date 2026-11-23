-- 0037: safety checks in the daily report. Additive only.
ALTER TABLE site_dprs ADD COLUMN safety_checks TEXT;     -- JSON: { check: true/false } from the setting dpr.safety_checks
ALTER TABLE site_dprs ADD COLUMN incident_kind TEXT;     -- none | near_miss | injury | dangerous (dangerous occurrence)
CREATE INDEX IF NOT EXISTS idx_dpr_incident ON site_dprs(project_id, incident_kind);
