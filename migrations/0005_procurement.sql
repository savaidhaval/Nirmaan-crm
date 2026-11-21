CREATE TABLE pro_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, category TEXT,
  contact_person TEXT, phone TEXT, email TEXT, gstin TEXT, address TEXT,
  rating INTEGER, notes TEXT, active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL, material TEXT, qty REAL, unit TEXT, needed_by TEXT,
  status TEXT DEFAULT 'open',
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES pro_rfqs(id),
  vendor_id INTEGER NOT NULL REFERENCES pro_vendors(id),
  rate_paise INTEGER, amount_paise INTEGER, delivery_days INTEGER, terms TEXT,
  document_id INTEGER REFERENCES documents(id),
  selected INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_pos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  vendor_id INTEGER NOT NULL REFERENCES pro_vendors(id),
  rfq_id INTEGER, po_no TEXT UNIQUE,
  po_seq INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  gst_bp INTEGER DEFAULT 1800,
  gst_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL DEFAULT 0,
  terms TEXT,
  status TEXT DEFAULT 'draft',
  approved_by INTEGER, approved_at TEXT, created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_po_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES pro_pos(id),
  description TEXT NOT NULL, qty REAL, unit TEXT,
  rate_paise INTEGER, amount_paise INTEGER
);
CREATE TABLE pro_grns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES pro_pos(id),
  received_on TEXT NOT NULL, qty_note TEXT, challan_no TEXT,
  received_by INTEGER REFERENCES users(id),
  document_id INTEGER REFERENCES documents(id),
  client_uuid TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE pro_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER REFERENCES pro_pos(id),
  vendor_id INTEGER NOT NULL REFERENCES pro_vendors(id),
  bill_no TEXT, amount_paise INTEGER NOT NULL, due_date TEXT,
  status TEXT DEFAULT 'received',
  paid_on TEXT, payment_ref TEXT,
  document_id INTEGER REFERENCES documents(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_po_project ON pro_pos(project_id, status);
CREATE UNIQUE INDEX uq_po_seq ON pro_pos(project_id, po_seq);
CREATE INDEX idx_quote_rfq ON pro_quotes(rfq_id);
CREATE INDEX idx_poitem_po ON pro_po_items(po_id);
CREATE INDEX idx_grn_po ON pro_grns(po_id);
CREATE INDEX idx_bill_due ON pro_bills(due_date, status);
