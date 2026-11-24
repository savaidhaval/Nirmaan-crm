-- 0051: Module 4, step 2. Additive only.
-- Letter templates (custom demand letter per milestone, general allotment letter), "sent" marks kept by hand, refund due date.

CREATE TABLE IF NOT EXISTS sal_letter_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,                              -- demand | allotment
  stage_id INTEGER REFERENCES sal_plan_stages(id), -- a demand letter for one payment stage; NULL = the project's general demand letter
  title TEXT,
  body TEXT,                                       -- the letter text with {{placeholders}} (a plain-text template)
  doc_id INTEGER REFERENCES documents(id),         -- or an uploaded Word (.docx) template with {{placeholders}}
  updated_by INTEGER, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_letter_tpl ON sal_letter_templates(project_id, kind, COALESCE(stage_id, 0));

ALTER TABLE sal_demands ADD COLUMN sent_via TEXT;        -- email | whatsapp | hand | courier | other: how a letter was sent when marked by hand
ALTER TABLE sal_demands ADD COLUMN sent_by INTEGER;
ALTER TABLE sal_bookings ADD COLUMN allotment_sent_at TEXT;
ALTER TABLE sal_bookings ADD COLUMN allotment_sent_by INTEGER;
ALTER TABLE sal_bookings ADD COLUMN allotment_sent_via TEXT;
ALTER TABLE sal_refunds ADD COLUMN refund_due_on TEXT;   -- the date by which the balance must be returned after a cancellation
