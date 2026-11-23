-- 0040: Module 1 gaps, step 1. Additive only.
-- Land & FSI details on the project, the architect-certified area on each member (set once, then locked),
-- and a third inventory bucket "landowner" (sal_inventory.category: sale | rehab | landowner; no schema change needed, the column has no CHECK).

ALTER TABLE projects ADD COLUMN dcpr_regulation TEXT;        -- DCPR 2034 regulation the scheme uses, e.g. 33(7), 33(7)(B), 33(9), 33(11). Confirm with your architect.
ALTER TABLE projects ADD COLUMN sanctioned_fsi REAL;         -- FSI sanctioned on the approved plans
ALTER TABLE projects ADD COLUMN fungible_fsi REAL;           -- fungible FSI (premium) taken
ALTER TABLE projects ADD COLUMN tdr_purchased REAL;          -- TDR bought, in the same unit as FSI

ALTER TABLE red_members ADD COLUMN certified_area_sqft REAL; -- architect-certified (Annexure-II) carpet area; set once, then locked; per-sq-ft rent uses only this
ALTER TABLE red_members ADD COLUMN certified_by INTEGER;
ALTER TABLE red_members ADD COLUMN certified_at TEXT;
-- (Indexes for the OC stop and the alerts already exist: idx_apr_gate and idx_apr_valid.)
