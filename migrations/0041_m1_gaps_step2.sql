-- 0041: Module 1 gaps, step 2. Additive only.
-- Vacating proof (photo + location + meter readings), Director approval PIN and pending rent changes,
-- PAN (hashed for uniqueness) + masked Aadhaar on society members, and the pre-demolition gate.

-- Director approval PIN: stored only as a salted hash, never shown, never exported.
ALTER TABLE users ADD COLUMN approval_pin_hash TEXT;
ALTER TABLE users ADD COLUMN approval_pin_salt TEXT;
ALTER TABLE users ADD COLUMN approval_pin_set_at TEXT;

-- Vacating proof on each member.
ALTER TABLE red_members ADD COLUMN vacate_photo_doc_id INTEGER;   -- photo of the empty flat (documents.id)
ALTER TABLE red_members ADD COLUMN vacate_lat REAL;               -- where the phone was when the proof was taken
ALTER TABLE red_members ADD COLUMN vacate_lng REAL;
ALTER TABLE red_members ADD COLUMN vacate_proof_at TEXT;
ALTER TABLE red_members ADD COLUMN vacate_proof_by INTEGER;
ALTER TABLE red_members ADD COLUMN meter_electricity TEXT;        -- final readings as read off the meters
ALTER TABLE red_members ADD COLUMN meter_water TEXT;
ALTER TABLE red_members ADD COLUMN final_bills_doc_id INTEGER;    -- zero-due utility bills (documents.id)
ALTER TABLE red_members ADD COLUMN vacate_override_note TEXT;     -- Owner only: why vacating was recorded without photo or location

-- Identity: PAN is kept encrypted (like contractors) plus a keyed hash so one PAN can belong to one member of a society.
-- Aadhaar: only the last 4 digits are ever stored.
ALTER TABLE red_members ADD COLUMN pan_enc TEXT;
ALTER TABLE red_members ADD COLUMN pan_hash TEXT;
ALTER TABLE red_members ADD COLUMN pan_last4 TEXT;
ALTER TABLE red_members ADD COLUMN aadhaar_last4 TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_red_mem_pan ON red_members(society_id, pan_hash) WHERE pan_hash IS NOT NULL AND deleted_at IS NULL;

-- Rent changes that wait for the Director's PIN (maker-checker). Nothing is applied until approved.
CREATE TABLE red_rent_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  kind TEXT NOT NULL,                                -- terms | transit_term
  payload TEXT NOT NULL,                             -- the request as JSON, applied on approval
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',            -- pending | approved | rejected
  requested_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT
);
CREATE INDEX idx_red_chg_status ON red_rent_changes(status, member_id);

-- Site proofs for the pre-demolition gate: meter-removal receipts and the tree / barricade NOCs.
CREATE TABLE red_site_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,                                -- electricity | water | gas | tree_noc | barricade
  status TEXT NOT NULL DEFAULT 'provided',           -- provided | not_applicable
  document_id INTEGER REFERENCES documents(id), ref_no TEXT, on_date TEXT, note TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE (project_id, kind)
);

-- A work order that starts demolition cannot be approved until the gate is clear.
ALTER TABLE con_work_orders ADD COLUMN is_demolition INTEGER NOT NULL DEFAULT 0;
