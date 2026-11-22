-- 0032: small cache for dashboard lines that are too heavy to compute on every page load (WP-20). Additive only.
-- The hourly sweep refreshes one project's budget status per tick; the dashboard only reads these rows.
CREATE TABLE dash_snapshot (
  key TEXT PRIMARY KEY,               -- e.g. 'budget:12'
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
