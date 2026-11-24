-- 0044: Module 2 gaps, step 1. Additive only.
-- Minimum selling price (MSP) floor, channel-partner KYC vault, lead SLA auto-reassign, hold log.

-- MSP: the lowest agreement value the Owner allows for a flat. NULL = no floor set.
ALTER TABLE sal_inventory ADD COLUMN msp_paise INTEGER;
ALTER TABLE sal_cost_sheets ADD COLUMN below_msp INTEGER NOT NULL DEFAULT 0;      -- 1 = agreement value was under the flat's MSP when the sheet was made
ALTER TABLE sal_cost_sheets ADD COLUMN msp_paise INTEGER;                          -- the MSP at that moment
ALTER TABLE sal_cost_sheets ADD COLUMN msp_approved_by INTEGER;                    -- Owner who approved it below MSP (with approval PIN)

-- Channel-partner vault. PAN is kept encrypted (last 4 shown); GSTIN and RERA details as typed.
ALTER TABLE sal_partners ADD COLUMN pan_enc TEXT;
ALTER TABLE sal_partners ADD COLUMN pan_last4 TEXT;
ALTER TABLE sal_partners ADD COLUMN gstin TEXT;
ALTER TABLE sal_partners ADD COLUMN rera_valid_till TEXT;                          -- MahaRERA agent registration expiry (YYYY-MM-DD)
ALTER TABLE sal_partners ADD COLUMN rera_doc_id INTEGER REFERENCES documents(id);  -- scan of the certificate
ALTER TABLE sal_partners ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'pending';    -- pending | approved
ALTER TABLE sal_partners ADD COLUMN kyc_by INTEGER;
ALTER TABLE sal_partners ADD COLUMN kyc_at TEXT;

-- Lead SLA: how many times a lead was moved to the next executive for not being called in time.
ALTER TABLE sal_leads ADD COLUMN sla_reassigns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sal_leads ADD COLUMN sla_assigned_at TEXT;

-- Every hold that ended without a booking (expired or released), so a closer cannot keep re-blocking the same flat.
CREATE TABLE IF NOT EXISTS sal_hold_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES sal_inventory(id),
  user_id INTEGER,
  lead_id INTEGER,
  held_at TEXT, ended_at TEXT NOT NULL,
  reason TEXT NOT NULL                                                             -- expired | released
);
CREATE INDEX IF NOT EXISTS idx_holdlog_unit ON sal_hold_log(unit_id, user_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_lead_sla ON sal_leads(status, first_contact_at, created_at);
