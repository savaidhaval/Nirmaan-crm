-- 0042: Module 1 gaps, step 3. Additive only.
-- Floor on indents and RA bills (CC-floor lock), bank details and monthly payout batches for transit rent.

-- CC-floor lock: an indent or RA bill that names a floor above the approved CC limit is refused (the Owner may go ahead with a written reason).
ALTER TABLE pro_indents ADD COLUMN wing TEXT;
ALTER TABLE pro_indents ADD COLUMN floor INTEGER;               -- highest floor this request is for; NULL = not floor work
ALTER TABLE pro_indents ADD COLUMN cc_override_note TEXT;
ALTER TABLE con_ra_bills ADD COLUMN wing TEXT;
ALTER TABLE con_ra_bills ADD COLUMN floor INTEGER;              -- highest floor this bill's work reaches; NULL = not floor work
ALTER TABLE con_ra_bills ADD COLUMN cc_override_note TEXT;

-- Where transit rent is paid. The account number is kept encrypted; only the last 4 digits are shown.
ALTER TABLE red_members ADD COLUMN bank_holder TEXT;
ALTER TABLE red_members ADD COLUMN bank_acct_enc TEXT;
ALTER TABLE red_members ADD COLUMN bank_acct_last4 TEXT;
ALTER TABLE red_members ADD COLUMN bank_ifsc TEXT;

-- One bank file for a month: the unpaid rent of every member, locked into the batch so it cannot be paid twice.
CREATE TABLE red_payout_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  society_id INTEGER NOT NULL REFERENCES red_societies(id),
  period TEXT NOT NULL,                              -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'generated',          -- generated | paid | cancelled
  line_count INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL DEFAULT 0,
  bank_ref TEXT, paid_on TEXT, mode TEXT, note TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
  decided_by INTEGER REFERENCES users(id), decided_at TEXT
);
CREATE INDEX idx_red_batch_soc ON red_payout_batches(society_id, status, period);
ALTER TABLE red_transit_schedule ADD COLUMN batch_id INTEGER;     -- the open or paid batch this month is in
CREATE INDEX idx_red_sched_batch ON red_transit_schedule(batch_id);
