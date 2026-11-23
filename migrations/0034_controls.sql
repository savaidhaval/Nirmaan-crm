-- 0034: hard stops and money controls (audit priorities 1 and 2). Additive only.

-- Approvals: what kind of approval it is (so the system can gate on it), its letter, and the order between approvals.
ALTER TABLE apr_items ADD COLUMN gate_key TEXT;          -- iod | cc | plinth_cc | further_cc | rera_reg | fire_final | bcc | oc | NULL
ALTER TABLE apr_items ADD COLUMN wing TEXT;              -- a part OC / CC for one wing; NULL = whole project
ALTER TABLE apr_items ADD COLUMN cc_upto_floor INTEGER;  -- a CC / further CC: work allowed up to this floor (0 = plinth)
ALTER TABLE apr_items ADD COLUMN letter_no TEXT;         -- approval letter number
ALTER TABLE apr_items ADD COLUMN letter_date TEXT;
ALTER TABLE apr_items ADD COLUMN letter_doc_id INTEGER;  -- the letter (documents.id)
CREATE INDEX IF NOT EXISTS idx_apr_gate ON apr_items(project_id, gate_key, status);
CREATE TABLE IF NOT EXISTS apr_deps (
  item_id INTEGER NOT NULL REFERENCES apr_items(id),
  depends_on_id INTEGER NOT NULL REFERENCES apr_items(id),
  created_by INTEGER, created_at TEXT,
  PRIMARY KEY (item_id, depends_on_id)
);
CREATE INDEX IF NOT EXISTS idx_apr_deps_on ON apr_deps(depends_on_id);

-- Milestones: two steps (site says ready, PM certifies), floor for the CC check, wing rule, undo.
ALTER TABLE site_milestones ADD COLUMN floor INTEGER;              -- highest floor this milestone reaches (0 = plinth); NULL = not floor work
ALTER TABLE site_milestones ADD COLUMN all_wings INTEGER NOT NULL DEFAULT 0;   -- 1 = deliberately applies to every wing
ALTER TABLE site_milestones ADD COLUMN ready_at TEXT;
ALTER TABLE site_milestones ADD COLUMN ready_by INTEGER;
ALTER TABLE site_milestones ADD COLUMN ready_note TEXT;
ALTER TABLE site_milestones ADD COLUMN cert_ref TEXT;              -- architect's stage certificate number / date
ALTER TABLE site_milestones ADD COLUMN cert_doc_id INTEGER;
ALTER TABLE site_milestones ADD COLUMN certified_by INTEGER;
ALTER TABLE site_milestones ADD COLUMN override_note TEXT;         -- Owner went past a missing CC, and why
ALTER TABLE site_milestones ADD COLUMN undone_at TEXT;
ALTER TABLE site_milestones ADD COLUMN undo_reason TEXT;
ALTER TABLE sal_demands ADD COLUMN hold_reason TEXT;               -- a demand held after its milestone was undone

-- Contractors: variations, measurements, advance recovery rule.
ALTER TABLE con_work_orders ADD COLUMN advance_recovery_bp INTEGER;   -- share of each bill's gross recovered against the advance (1000 = 10%)
ALTER TABLE con_wo_items ADD COLUMN variation_id INTEGER;            -- an item added by an approved variation
CREATE TABLE IF NOT EXISTS con_variations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id INTEGER NOT NULL REFERENCES con_work_orders(id),
  wo_item_id INTEGER REFERENCES con_wo_items(id),     -- extra quantity on this item; NULL = a new item or a lump-sum extra
  description TEXT NOT NULL, unit TEXT,
  qty REAL, rate_paise INTEGER, amount_paise INTEGER NOT NULL,
  reason TEXT NOT NULL, drawing_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',               -- pending | approved | rejected
  created_by INTEGER, created_at TEXT,
  approved_by INTEGER, approved_at TEXT, decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_con_var_wo ON con_variations(wo_id, status);
CREATE INDEX IF NOT EXISTS idx_con_var_item ON con_variations(wo_item_id, status);
CREATE TABLE IF NOT EXISTS con_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id INTEGER NOT NULL REFERENCES con_work_orders(id),
  wo_item_id INTEGER NOT NULL REFERENCES con_wo_items(id),
  location TEXT NOT NULL,                               -- wing / floor / grid
  nos REAL, length_m REAL, width_m REAL, depth_m REAL,
  qty REAL NOT NULL,
  contractor_rep TEXT,                                  -- the contractor's person who measured jointly
  photo_doc_id INTEGER, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',               -- pending | approved | rejected
  measured_by INTEGER, created_at TEXT,
  approved_by INTEGER, approved_at TEXT, decision_note TEXT,
  client_uuid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_con_meas_item ON con_measurements(wo_item_id, status);
CREATE INDEX IF NOT EXISTS idx_con_meas_wo ON con_measurements(wo_id, status);

-- Vendor bills: held when they do not match the PO and what was received.
ALTER TABLE pro_bills ADD COLUMN hold_reason TEXT;
ALTER TABLE pro_bills ADD COLUMN released_by INTEGER;
ALTER TABLE pro_bills ADD COLUMN released_at TEXT;
ALTER TABLE pro_bills ADD COLUMN release_note TEXT;
ALTER TABLE pro_bills ADD COLUMN created_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_bill_vendor_no ON pro_bills(vendor_id, bill_no);

-- Material received above the PO quantity: who allowed it and why.
ALTER TABLE pro_grns ADD COLUMN excess_note TEXT;

-- Possession: why it went ahead with dues or snags open.
ALTER TABLE sal_handover ADD COLUMN override_note TEXT;
