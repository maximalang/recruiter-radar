-- Revert 20260703120000_add_orgs_country_industry_city.sql

BEGIN;

ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_country_not_blank;
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_industry_not_blank;
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_city_not_blank;

ALTER TABLE orgs
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS city;

COMMIT;
