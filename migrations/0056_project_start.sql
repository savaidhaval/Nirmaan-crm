-- 0056: when a project starts. A redevelopment project starts once the 79A process is complete and the society gives us the
-- preferred-developer / appointment letter; a land project starts once the land is bought (sale deed registered).
-- Until then a project is 'pending': only Land & Approvals takes new work. Additive only.
ALTER TABLE projects ADD COLUMN start_basis TEXT;        -- NULL = existed before this rule (treated as started) | pending | appointment_letter | land_purchase | da_registered
ALTER TABLE projects ADD COLUMN started_on TEXT;         -- date of the paper (IST date)
ALTER TABLE projects ADD COLUMN start_ref TEXT;          -- letter number / sale deed registration number
ALTER TABLE projects ADD COLUMN start_doc_id INTEGER;    -- the scanned paper (documents.id)
-- The same paper recorded on the Business Development deal before it becomes a project.
ALTER TABLE bd_opportunities ADD COLUMN start_paper_on TEXT;
ALTER TABLE bd_opportunities ADD COLUMN start_paper_ref TEXT;
ALTER TABLE bd_opportunities ADD COLUMN start_paper_doc_id INTEGER;
