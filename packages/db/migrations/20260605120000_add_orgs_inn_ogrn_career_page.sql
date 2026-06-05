-- Add entity resolution fields and career page URL to orgs table.
-- Per product concept §Схема карточки лида: ИНН, ОГРН, career_page_url are mandatory fields.

BEGIN;

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS inn TEXT,
  ADD COLUMN IF NOT EXISTS ogrn TEXT,
  ADD COLUMN IF NOT EXISTS career_page_url TEXT;

-- INN format: 10 digits for юрлицо, 12 digits for ИП
ALTER TABLE orgs ADD CONSTRAINT orgs_inn_format
  CHECK (inn IS NULL OR inn ~ '^\d{10}$' OR inn ~ '^\d{12}$');

-- ОГРН format: 13 digits for юрлицо, 15 for ОГРНИП
ALTER TABLE orgs ADD CONSTRAINT orgs_ogrn_format
  CHECK (ogrn IS NULL OR ogrn ~ '^\d{13}$' OR ogrn ~ '^\d{15}$');

-- Career page URL must be non-blank if present
ALTER TABLE orgs ADD CONSTRAINT orgs_career_page_url_not_blank
  CHECK (career_page_url IS NULL OR BTRIM(career_page_url) <> '');

-- Useful indexes for entity resolution lookups
CREATE INDEX IF NOT EXISTS orgs_inn_idx ON orgs (inn) WHERE inn IS NOT NULL;
CREATE INDEX IF NOT EXISTS orgs_ogrn_idx ON orgs (ogrn) WHERE ogrn IS NOT NULL;

COMMIT;
