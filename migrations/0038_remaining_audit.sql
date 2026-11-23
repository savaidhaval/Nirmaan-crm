-- 0038: the rest of the audit — baseline dates and wing hold, tenant vacating / PAAA, drawing links, debit notes and material
-- reconciliation, BOQ items. (Voice notes need no table: they are files attached like photos.) Additive only.

-- Milestones: the date agreed at the start, and every change to the expected date with its reason.
ALTER TABLE site_milestones ADD COLUMN baseline_date TEXT;
CREATE TABLE IF NOT EXISTS site_ms_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id INTEGER NOT NULL REFERENCES site_milestones(id),
  old_date TEXT, new_date TEXT,
  reason TEXT NOT NULL,                  -- monsoon | approvals | contractor | material | funds | design | other
  note TEXT, changed_by INTEGER, changed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ms_changes ON site_ms_changes(milestone_id, id);

-- A wing put on hold (redesign, stay order, dispute): its milestones cannot be certified and its flats cannot be booked.
CREATE TABLE IF NOT EXISTS prj_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  wing TEXT,                             -- NULL = the whole project
  reason TEXT NOT NULL,
  held_by INTEGER, held_at TEXT,
  released_by INTEGER, released_at TEXT, release_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_prj_holds ON prj_holds(project_id, released_at);

-- Redevelopment: permanent alternate accommodation agreement (PAAA) and vacating.
ALTER TABLE red_members ADD COLUMN paaa_reg_no TEXT;
ALTER TABLE red_members ADD COLUMN paaa_reg_date TEXT;
ALTER TABLE red_members ADD COLUMN paaa_doc_id INTEGER;
ALTER TABLE red_members ADD COLUMN vacated_on TEXT;
ALTER TABLE red_members ADD COLUMN keys_received INTEGER NOT NULL DEFAULT 0;
ALTER TABLE red_members ADD COLUMN utilities_disconnected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_red_mem_vacated ON red_members(society_id, vacated_on);

-- Drawing links: a work-order item or a pour card is built from a drawing; a newer issued revision flags it.
ALTER TABLE con_wo_items ADD COLUMN drawing_id INTEGER;
ALTER TABLE qa_pours ADD COLUMN drawing_id INTEGER;
ALTER TABLE qa_pours ADD COLUMN drawing_rev_id INTEGER;        -- the issued revision current when the card was made
CREATE INDEX IF NOT EXISTS idx_wo_items_drawing ON con_wo_items(drawing_id);
CREATE INDEX IF NOT EXISTS idx_qa_pours_drawing ON qa_pours(drawing_id, status);

-- Debit notes against a contractor: approved ones are deducted from the next RA bill.
CREATE TABLE IF NOT EXISTS con_debit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id INTEGER NOT NULL REFERENCES con_work_orders(id),
  reason TEXT NOT NULL,                  -- rework | wastage | damage | penalty | excess_material | other
  description TEXT NOT NULL,
  qty REAL, unit TEXT, rate_paise INTEGER, amount_paise INTEGER NOT NULL,
  photo_doc_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | recovered
  ra_id INTEGER,                         -- the RA bill it was deducted on
  created_by INTEGER, created_at TEXT, approved_by INTEGER, approved_at TEXT, decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_con_dn_wo ON con_debit_notes(wo_id, status);
CREATE INDEX IF NOT EXISTS idx_con_dn_ra ON con_debit_notes(ra_id);

-- Material reconciliation: what one unit of a work-order item uses of a store item, and the wastage allowed.
ALTER TABLE con_wo_items ADD COLUMN stock_item_id INTEGER;
ALTER TABLE con_wo_items ADD COLUMN consumption_per_unit REAL;   -- e.g. 6.5 bags of cement per cum
ALTER TABLE con_wo_items ADD COLUMN wastage_bp INTEGER;          -- allowed wastage, 300 = 3%
ALTER TABLE stk_moves ADD COLUMN wo_id INTEGER;                  -- material issued to this work order (free issue)
CREATE INDEX IF NOT EXISTS idx_stk_moves_wo ON stk_moves(wo_id, item_id);

-- BOQ: items under each budget head; work orders and PO lines point at them.
CREATE TABLE IF NOT EXISTS bud_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  head_id INTEGER NOT NULL REFERENCES bud_heads(id),
  code TEXT, description TEXT NOT NULL, unit TEXT,
  qty REAL NOT NULL, rate_paise INTEGER NOT NULL, amount_paise INTEGER NOT NULL,
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bud_items ON bud_items(project_id, head_id);
ALTER TABLE con_wo_items ADD COLUMN boq_item_id INTEGER;
ALTER TABLE pro_po_items ADD COLUMN boq_item_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_wo_items_boq ON con_wo_items(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_po_items_boq ON pro_po_items(boq_item_id);
