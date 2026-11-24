-- 0054: Module 5, step 1. Additive only.
-- Snags: which work order is responsible, where on the flat's floor plan, and when it was marked fixed.
ALTER TABLE site_snags ADD COLUMN wo_id INTEGER REFERENCES con_work_orders(id);   -- the contractor's work order that must fix it (blocks that order's retention release)
ALTER TABLE site_snags ADD COLUMN pin_x INTEGER;                                  -- tapped spot on the floor plan, 0-1000 across
ALTER TABLE site_snags ADD COLUMN pin_y INTEGER;                                  -- 0-1000 down
ALTER TABLE site_snags ADD COLUMN plan_doc_id INTEGER REFERENCES documents(id);   -- the floor-plan picture the pin sits on
ALTER TABLE site_snags ADD COLUMN category TEXT;                                  -- civil | flooring | doors_windows | plumbing | electrical | painting | other
ALTER TABLE site_snags ADD COLUMN fixed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_snag_wo ON site_snags(wo_id, status);

-- Handover: signed possession letter and indemnity / fit-out undertaking (uploaded documents), certificate number, key release date.
ALTER TABLE sal_handover ADD COLUMN letter_doc_id INTEGER REFERENCES documents(id);
ALTER TABLE sal_handover ADD COLUMN indemnity_doc_id INTEGER REFERENCES documents(id);
ALTER TABLE sal_handover ADD COLUMN pc_no TEXT;
ALTER TABLE sal_handover ADD COLUMN keys_released_on TEXT;

-- Society corpus, advance maintenance, share money, fit-out deposit: a separate ledger per head, never mixed with the sale price or the 70% RERA account.
CREATE TABLE IF NOT EXISTS sal_possession_funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES sal_bookings(id),
  head TEXT NOT NULL,                  -- corpus | maintenance | share_money | fitout_deposit
  kind TEXT NOT NULL,                  -- due | received | refunded
  amount_paise INTEGER NOT NULL,
  on_date TEXT NOT NULL, ref_no TEXT, note TEXT,
  created_by INTEGER, created_at TEXT, reversed_at TEXT, reversed_by INTEGER, reverse_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pf_booking ON sal_possession_funds(booking_id, head, kind);

-- Defect-liability helpdesk (RERA s.14(3), five years from possession).
CREATE TABLE IF NOT EXISTS dlp_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  unit_id INTEGER REFERENCES sal_inventory(id),
  booking_id INTEGER REFERENCES sal_bookings(id),
  raised_by_name TEXT, raised_via TEXT,        -- staff | phone | whatsapp | email
  category TEXT NOT NULL DEFAULT 'other',      -- plumbing | electrical | seepage | civil | finishing | other
  title TEXT NOT NULL, detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',         -- open | assigned | fixed | verified | rejected
  wo_id INTEGER REFERENCES con_work_orders(id), contractor_id INTEGER REFERENCES con_contractors(id),
  raised_on TEXT NOT NULL, sla_due_on TEXT, fixed_on TEXT, verified_on TEXT,
  repair_vendor TEXT, backcharge_paise INTEGER NOT NULL DEFAULT 0, backcharge_status TEXT,   -- NULL | pending | cleared
  backcharge_note TEXT, reject_reason TEXT,
  client_uuid TEXT UNIQUE, created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dlp_project ON dlp_tickets(project_id, status);
CREATE INDEX IF NOT EXISTS idx_dlp_wo ON dlp_tickets(wo_id, backcharge_status);
CREATE INDEX IF NOT EXISTS idx_dlp_sla ON dlp_tickets(status, sla_due_on);

-- Society (CHS) handover vault: the statutory documents and equipment warranties, each acknowledged by the society's secretary.
CREATE TABLE IF NOT EXISTS chs_vault_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  label TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'document',   -- document | amc
  required INTEGER NOT NULL DEFAULT 1,
  document_id INTEGER REFERENCES documents(id), uploaded_on TEXT, valid_till TEXT,
  ack_by_name TEXT, ack_on TEXT, note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chs_project ON chs_vault_items(project_id);
