-- 0052: price / cost per sq ft everywhere. Additive only.
-- Which area a "per sq ft" figure is divided by, for each project. The flats' own areas already live on sal_inventory.
ALTER TABLE projects ADD COLUMN builtup_sqft REAL;                         -- built-up (construction) area of the whole project, typed by the PM; optional
ALTER TABLE projects ADD COLUMN area_basis TEXT NOT NULL DEFAULT 'saleable';   -- saleable | carpet_all | builtup | plot
