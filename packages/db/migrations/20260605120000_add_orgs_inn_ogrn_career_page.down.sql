-- Rollback: remove inn, ogrn, career_page_url from orgs
BEGIN;

DROP INDEX IF EXISTS orgs_ogrn_idx;
DROP INDEX IF EXISTS orgs_inn_idx;

ALTER TABLE orgs
  DROP CONSTRAINT IF EXISTS orgs_career_page_url_not_blank,
  DROP CONSTRAINT IF EXISTS orgs_ogrn_format,
  DROP CONSTRAINT IF EXISTS orgs_inn_format,
  DROP COLUMN IF EXISTS career_page_url,
  DROP COLUMN IF EXISTS ogrn,
  DROP COLUMN IF EXISTS inn;

COMMIT;
