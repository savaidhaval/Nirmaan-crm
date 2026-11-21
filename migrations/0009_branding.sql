-- ===== A. documents: versions, audience, language (brochures, floor plans, branding files) =====
ALTER TABLE documents ADD COLUMN series_key TEXT;
ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN supersedes_id INTEGER REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE documents ADD COLUMN language TEXT;
CREATE UNIQUE INDEX uq_doc_latest ON documents(COALESCE(project_id,0), series_key)
  WHERE is_latest = 1 AND series_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_documents_series ON documents(series_key, project_id, version);
CREATE INDEX idx_documents_category ON documents(project_id, category, is_latest);

-- ===== B. users: second job, forced password change, protected primary owner =====
ALTER TABLE users ADD COLUMN extra_roles TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN is_primary_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deactivated_at TEXT;
ALTER TABLE users ADD COLUMN deactivated_by INTEGER REFERENCES users(id);
CREATE UNIQUE INDEX uq_primary_owner ON users(is_primary_owner) WHERE is_primary_owner = 1;

-- ===== C. project_members: who may see which project =====
CREATE TABLE project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  added_by INTEGER REFERENCES users(id),
  removed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_project_member ON project_members(project_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX idx_project_member_user ON project_members(user_id, removed_at);

-- ===== D. brand_profiles: company default + optional per-project overrides =====
CREATE TABLE brand_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  legal_name TEXT, trade_name TEXT, tagline TEXT,
  address TEXT, phone TEXT, email TEXT, website TEXT,
  gstin TEXT, cin_or_llpin TEXT, promoter_rera_ref TEXT,
  pan_enc TEXT,
  bank_account_name TEXT, bank_name TEXT, bank_branch TEXT, bank_ifsc TEXT,
  bank_account_enc TEXT,
  signatory_name TEXT, signatory_title TEXT,
  footer_text TEXT,
  wa_intro_text TEXT,
  colour_primary TEXT, colour_secondary TEXT, colour_accent TEXT,
  letterhead_mode TEXT,
  margin_top_mm INTEGER, margin_bottom_mm INTEGER, margin_side_mm INTEGER,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_brand_scope ON brand_profiles(COALESCE(project_id,0));

-- ===== E. share_links: expiring, revocable customer links =====
CREATE TABLE share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  project_id INTEGER REFERENCES projects(id),
  entity TEXT, entity_id INTEGER,
  recipient_label TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  max_views INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  first_viewed_at TEXT, last_viewed_at TEXT,
  revoked_at TEXT, revoked_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_share_doc ON share_links(document_id);
CREATE INDEX idx_share_entity ON share_links(entity, entity_id);
CREATE INDEX idx_share_creator ON share_links(created_by, created_at);
CREATE INDEX idx_share_expiry ON share_links(expires_at, revoked_at);

-- ===== F. Google Drive storage =====
ALTER TABLE documents ADD COLUMN store TEXT CHECK (store IN ('gdrive','r2','d1'));
ALTER TABLE documents ADD COLUMN drive_file_id TEXT;
ALTER TABLE documents ADD COLUMN drive_folder_id TEXT;
ALTER TABLE documents ADD COLUMN thumb_drive_file_id TEXT;
ALTER TABLE documents ADD COLUMN md5 TEXT;
ALTER TABLE documents ADD COLUMN drive_status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE documents ADD COLUMN drive_checked_at TEXT;
CREATE UNIQUE INDEX uq_doc_drive_file ON documents(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX idx_doc_store_check ON documents(store, drive_checked_at);

CREATE TABLE drive_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path_key TEXT NOT NULL UNIQUE,
  project_id INTEGER REFERENCES projects(id),
  drive_folder_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  verifier_enc TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'gdrive',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_states_expiry ON oauth_states(expires_at);
