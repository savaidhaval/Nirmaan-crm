-- 0030: drawing acknowledgement (WP-22). Additive only.
-- A site user confirms they have seen the current "issued for construction" revision. One row per person per revision, never edited.
CREATE TABLE drw_acks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES drw_revisions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  acked_at TEXT NOT NULL,
  UNIQUE (revision_id, user_id)
);
CREATE INDEX idx_drw_acks_rev ON drw_acks(revision_id);
