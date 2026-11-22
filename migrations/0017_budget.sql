-- 0017 (WP-7): budget heads per project; POs and work orders are tagged to a head. Additive only.
CREATE TABLE IF NOT EXISTS bud_heads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  budget_paise INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bud_head_code ON bud_heads(project_id, code);
CREATE INDEX IF NOT EXISTS idx_bud_project ON bud_heads(project_id, sort_order);

ALTER TABLE pro_po_items ADD COLUMN budget_head_id INTEGER;     -- optional, set when the PO is made
ALTER TABLE con_work_orders ADD COLUMN budget_head_id INTEGER;  -- optional, set when the work order is made
CREATE INDEX IF NOT EXISTS idx_poitem_head ON pro_po_items(budget_head_id);
CREATE INDEX IF NOT EXISTS idx_wo_head ON con_work_orders(budget_head_id);
