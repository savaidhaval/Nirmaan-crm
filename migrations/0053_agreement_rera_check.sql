-- 0053: Agreement for Sale template review mark; channel-partner MahaRERA "checked on the website" record. Additive only.
ALTER TABLE sal_letter_templates ADD COLUMN reviewed_by TEXT;     -- the advocate who approved this wording (typed by the Owner)
ALTER TABLE sal_letter_templates ADD COLUMN reviewed_on TEXT;     -- date of that approval; cleared whenever the wording changes
ALTER TABLE sal_partners ADD COLUMN rera_verified_on TEXT;        -- date someone looked the registration up on the MahaRERA website
ALTER TABLE sal_partners ADD COLUMN rera_verified_by INTEGER;
ALTER TABLE sal_partners ADD COLUMN rera_verify_note TEXT;
