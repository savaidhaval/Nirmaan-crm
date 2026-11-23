-- 0033: project profile, AutoDCR link, approval sub-steps and file movement, task in-charge, member terms, meeting attendees, PO charges.
-- Additive only: new tables, new columns and new indexes. Nothing is dropped, renamed or rewritten.

-- Project profile (new project form)
ALTER TABLE projects ADD COLUMN members_count INTEGER;            -- number of society members / existing occupants
ALTER TABLE projects ADD COLUMN plot_area_sqm REAL;               -- plot area in square metres
ALTER TABLE projects ADD COLUMN planning_authority TEXT;          -- e.g. MCGM (BMC), SRA, MHADA, MMRDA
ALTER TABLE projects ADD COLUMN other_authorities TEXT;           -- JSON list, e.g. ["Estate Department","Collector"]
ALTER TABLE projects ADD COLUMN cts_no TEXT;                      -- CTS / survey / plot number
ALTER TABLE projects ADD COLUMN village TEXT;                     -- revenue village
ALTER TABLE projects ADD COLUMN property_card_details TEXT;       -- what the property card says (holder, area, tenure)
ALTER TABLE projects ADD COLUMN property_card_doc_id INTEGER;     -- optional scanned copy (documents.id)
ALTER TABLE projects ADD COLUMN conveyance_details TEXT;          -- conveyance deed: registration no., date, parties
ALTER TABLE projects ADD COLUMN conveyance_doc_id INTEGER;        -- optional scanned copy (documents.id)
ALTER TABLE projects ADD COLUMN maps_url TEXT;                    -- Google Maps link: the only way the site location is entered
ALTER TABLE projects ADD COLUMN extra_info TEXT;                  -- any other important information
ALTER TABLE projects ADD COLUMN autodcr_url TEXT;                 -- set by the Owner; can be corrected, never cleared
ALTER TABLE projects ADD COLUMN autodcr_set_by INTEGER;
ALTER TABLE projects ADD COLUMN autodcr_set_at TEXT;

-- Every value the AutoDCR link has had (append-only)
CREATE TABLE IF NOT EXISTS prj_autodcr_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  url TEXT NOT NULL, reason TEXT,
  set_by INTEGER REFERENCES users(id), set_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autodcr_hist ON prj_autodcr_history(project_id, id);

-- Approval: where the file is now and where it goes next, and the expected completion date
ALTER TABLE apr_items ADD COLUMN target_date TEXT;
ALTER TABLE apr_items ADD COLUMN holder_designation TEXT;         -- officer now holding the file, e.g. Assistant Engineer (Building Proposal)
ALTER TABLE apr_items ADD COLUMN holder_name TEXT;
ALTER TABLE apr_items ADD COLUMN next_designation TEXT;           -- officer the file goes to next
ALTER TABLE apr_items ADD COLUMN next_name TEXT;
ALTER TABLE apr_items ADD COLUMN file_moved_at TEXT;
CREATE INDEX IF NOT EXISTS idx_apr_owner_target ON apr_items(owner_user_id, target_date);

-- Approval sub-steps, each with the person responsible and an expected completion date
CREATE TABLE IF NOT EXISTS apr_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES apr_items(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  seq INTEGER NOT NULL DEFAULT 100,
  title TEXT NOT NULL,
  responsible_designation TEXT,                                   -- officer at the authority who acts on this step
  responsible_name TEXT,
  assigned_to INTEGER REFERENCES users(id),                       -- our person in charge of chasing it
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',                         -- pending | in_progress | done | na
  done_on TEXT, note TEXT,
  created_by INTEGER, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_apr_steps_item ON apr_steps(item_id, seq);
CREATE INDEX IF NOT EXISTS idx_apr_steps_open ON apr_steps(project_id, status, target_date);
CREATE INDEX IF NOT EXISTS idx_apr_steps_user ON apr_steps(assigned_to, status);

-- Site milestones: person in charge (planned_date is the expected completion date)
ALTER TABLE site_milestones ADD COLUMN assigned_to INTEGER;
CREATE INDEX IF NOT EXISTS idx_milestone_user ON site_milestones(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_snag_user ON site_snags(assigned_to, status);

-- Redevelopment member terms
ALTER TABLE red_members ADD COLUMN rent_basis TEXT;               -- per_sqft (Rs per sq ft per month) | monthly (Rs per month)
ALTER TABLE red_members ADD COLUMN rent_y1_paise INTEGER;         -- year 1 rate: paise per sq ft per month, or paise per month
ALTER TABLE red_members ADD COLUMN rent_y2_paise INTEGER;
ALTER TABLE red_members ADD COLUMN rent_y3_paise INTEGER;
ALTER TABLE red_members ADD COLUMN rent_y4_paise INTEGER;
ALTER TABLE red_members ADD COLUMN rent_y5_paise INTEGER;
ALTER TABLE red_members ADD COLUMN corpus_paise INTEGER;
ALTER TABLE red_members ADD COLUMN car_parks INTEGER;
ALTER TABLE red_members ADD COLUMN shifting_paise INTEGER;
ALTER TABLE red_members ADD COLUMN extra_area_bp INTEGER;         -- proposed extra area on RERA carpet, 3500 = 35%
ALTER TABLE red_members ADD COLUMN new_rera_sqft REAL;            -- worked out: current area x (1 + extra %)
ALTER TABLE red_members ADD COLUMN buys_extra INTEGER NOT NULL DEFAULT 0;   -- 1 = member is buying extra area
ALTER TABLE red_members ADD COLUMN buys_extra_sqft REAL;

-- Meetings: who attended, and who is in charge of the next action
CREATE TABLE IF NOT EXISTS red_meeting_attendees (
  meeting_id INTEGER NOT NULL REFERENCES red_meetings(id),
  member_id INTEGER NOT NULL REFERENCES red_members(id),
  PRIMARY KEY (meeting_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_red_att_member ON red_meeting_attendees(member_id);
ALTER TABLE red_meetings ADD COLUMN next_action_owner INTEGER;
CREATE INDEX IF NOT EXISTS idx_red_meet_owner ON red_meetings(next_action_owner, next_action_done);

-- Purchase order: charges besides the material, and the usual PO terms
ALTER TABLE pro_pos ADD COLUMN material_category TEXT;            -- cement | steel | rmc | sand_aggregate | blocks_bricks | electrical | plumbing | tiles | paint | hardware | other
ALTER TABLE pro_pos ADD COLUMN transport_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pro_pos ADD COLUMN loading_paise INTEGER NOT NULL DEFAULT 0;      -- loading / unloading
ALTER TABLE pro_pos ADD COLUMN packing_paise INTEGER NOT NULL DEFAULT 0;      -- packing and forwarding
ALTER TABLE pro_pos ADD COLUMN insurance_paise INTEGER NOT NULL DEFAULT 0;    -- transit insurance
ALTER TABLE pro_pos ADD COLUMN other_charges_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pro_pos ADD COLUMN other_charges_label TEXT;
ALTER TABLE pro_pos ADD COLUMN charges_gst_bp INTEGER;           -- GST on the charges (editable; confirm with your CA)
ALTER TABLE pro_pos ADD COLUMN price_basis TEXT;                 -- e.g. Delivered at site / Ex-works
ALTER TABLE pro_pos ADD COLUMN delivery_date TEXT;
ALTER TABLE pro_pos ADD COLUMN delivery_address TEXT;
ALTER TABLE pro_pos ADD COLUMN payment_terms TEXT;
ALTER TABLE pro_pos ADD COLUMN warranty TEXT;
ALTER TABLE pro_pos ADD COLUMN penalty_clause TEXT;
ALTER TABLE pro_pos ADD COLUMN category_details TEXT;            -- JSON of the extra fields for the material category (grade, brand, test certificate...)
ALTER TABLE pro_po_items ADD COLUMN hsn TEXT;
