-- 0047: Module 3 gaps, step 1. Additive only.
-- Gate receipt (challan lock, truck, weight, location, photo), work-order BOQ cap and CC floor, daily-report CC floor, indent BOQ allowance.

ALTER TABLE pro_grns ADD COLUMN vendor_id INTEGER REFERENCES pro_vendors(id);   -- the supplier of the PO at receipt time (for the unique challan rule)
ALTER TABLE pro_grns ADD COLUMN truck_no TEXT;
ALTER TABLE pro_grns ADD COLUMN weight_kg REAL;                                  -- weighbridge weight on the challan
ALTER TABLE pro_grns ADD COLUMN lat REAL;
ALTER TABLE pro_grns ADD COLUMN lng REAL;
ALTER TABLE pro_grns ADD COLUMN accuracy_m REAL;
ALTER TABLE pro_grns ADD COLUMN photo_at TEXT;                                   -- when the gate photo was attached (server time)
-- One challan number once per supplier. Older rows have no vendor_id and are not affected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_grn_challan ON pro_grns(vendor_id, lower(trim(challan_no)))
  WHERE vendor_id IS NOT NULL AND challan_no IS NOT NULL AND trim(challan_no) <> '' AND deleted_at IS NULL;

ALTER TABLE con_work_orders ADD COLUMN wing TEXT;                                -- the wing and highest floor the order covers (optional)
ALTER TABLE con_work_orders ADD COLUMN floor INTEGER;
ALTER TABLE con_work_orders ADD COLUMN cc_override_note TEXT;                    -- Owner's reason when the floor was above the approved CC
ALTER TABLE con_work_orders ADD COLUMN boq_override_note TEXT;                   -- Owner's reason when an item went past the BOQ quantity or rate

ALTER TABLE pro_indent_items ADD COLUMN boq_item_id INTEGER;
ALTER TABLE pro_indent_items ADD COLUMN over_boq INTEGER NOT NULL DEFAULT 0;     -- 1 = this request goes past the BOQ quantity
CREATE INDEX IF NOT EXISTS idx_indent_items_boq ON pro_indent_items(boq_item_id);

ALTER TABLE site_dprs ADD COLUMN cc_override_note TEXT;                          -- Owner's reason when a work line was above the approved CC floor
