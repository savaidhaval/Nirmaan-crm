-- 0018 (WP-8): store / stock ledger for materials we buy. Additive only.
CREATE TABLE IF NOT EXISTS stk_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, unit TEXT, category TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stk_item_name ON stk_items(name, unit);

-- One row per item per project; updated in the same batch as the move that changes it.
CREATE TABLE IF NOT EXISTS stk_balance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item_id INTEGER NOT NULL REFERENCES stk_items(id),
  qty REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stk_balance ON stk_balance(project_id, item_id);

-- Append-only log. kind: receipt | issue | transfer_out | transfer_in | adjust. adjust waits as 'pending' until a PM approves.
CREATE TABLE IF NOT EXISTS stk_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  qty REAL NOT NULL,                       -- always positive, except adjust which is signed
  status TEXT NOT NULL DEFAULT 'posted',   -- posted | pending | rejected
  ref_table TEXT, ref_id INTEGER, to_project_id INTEGER,
  note TEXT, where_used TEXT,
  by_user INTEGER, approved_by INTEGER, decided_at TEXT,
  client_uuid TEXT UNIQUE,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stk_moves_project ON stk_moves(project_id, id);
CREATE INDEX IF NOT EXISTS idx_stk_moves_item ON stk_moves(item_id, project_id);
CREATE INDEX IF NOT EXISTS idx_stk_moves_status ON stk_moves(status, kind);

ALTER TABLE pro_po_items ADD COLUMN stock_item_id INTEGER;   -- optional: items received into the store
CREATE INDEX IF NOT EXISTS idx_poitem_stock ON pro_po_items(stock_item_id);
