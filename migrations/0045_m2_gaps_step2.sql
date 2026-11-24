-- 0045: Module 2 gaps, step 2. Additive only.
-- Token proof on a hold (cleared by Accounts), reception check-in with buyer confirmation, broker source lock.

CREATE TABLE IF NOT EXISTS sal_hold_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES sal_inventory(id),
  lead_id INTEGER,
  held_by INTEGER,
  hold_at TEXT NOT NULL,                       -- identifies the hold this token belongs to (sal_inventory.hold_at)
  amount_paise INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,                          -- upi | neft | cheque
  ref_no TEXT NOT NULL,                        -- UTR or cheque number
  proof_doc_id INTEGER REFERENCES documents(id),
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | cleared | rejected
  decided_by INTEGER, decided_at TEXT, note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holdtok_status ON sal_hold_tokens(status, unit_id);

CREATE TABLE IF NOT EXISTS sal_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  phone_norm TEXT NOT NULL,
  name TEXT NOT NULL,
  partner_id INTEGER REFERENCES sal_partners(id),   -- the broker the buyer is asked about (NULL = walked in alone)
  token_hash TEXT,                                  -- SHA-256 of the one-time link token; the token itself is never stored
  status TEXT NOT NULL DEFAULT 'pending',           -- pending | confirmed | declined
  answer TEXT,                                      -- yes | no
  lead_id INTEGER,
  conflict_note TEXT,
  created_by INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, confirmed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_token ON sal_checkins(token_hash);
CREATE INDEX IF NOT EXISTS idx_checkin_day ON sal_checkins(project_id, created_at);

ALTER TABLE sal_leads ADD COLUMN source_confirmed_at TEXT;   -- the buyer confirmed the broker at reception (set once per lock; never edited)
ALTER TABLE sal_leads ADD COLUMN source_locked_until TEXT;   -- the broker keeps the lead until this date (setting sales.source_lock_days)
ALTER TABLE sal_leads ADD COLUMN source_checkin_id INTEGER;
