-- 0049: Module 3 gaps, step 3. Additive only.
-- Where the daily report was filed from (phone location, optional), compared with the project's location.
ALTER TABLE site_dprs ADD COLUMN lat REAL;
ALTER TABLE site_dprs ADD COLUMN lng REAL;
ALTER TABLE site_dprs ADD COLUMN accuracy_m REAL;
ALTER TABLE site_dprs ADD COLUMN distance_m INTEGER;     -- metres from the project's location at the time, when both are known
CREATE INDEX IF NOT EXISTS idx_grn_nophoto ON pro_grns(po_id, document_id);
