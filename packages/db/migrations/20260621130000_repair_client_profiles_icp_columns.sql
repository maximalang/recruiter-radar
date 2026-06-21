-- Repair migration: reconcile client_profiles ICP columns with prod schema drift.
--
-- WHY: schema_migrations on prod marks both
--   20260604000000_add_icp_industries_company_sizes  and
--   20260612120000_add_icp_roles_and_exclusions
-- as applied, but the physical columns are missing. The first of those two
-- migrations used bare `ADD COLUMN` (no IF NOT EXISTS), so a partial/failed
-- application could not be safely re-run, and the marker was recorded anyway.
-- Result: getClientProfileById() issues `SELECT ... industries, roles ...`
-- and Postgres raises `column "industries" does not exist` (42703), which
-- aborts every digest run before the candidate funnel.
--
-- This migration is fully idempotent: ADD COLUMN IF NOT EXISTS only, never
-- touches schema_migrations, and re-applies the intended defaults / NOT NULL
-- constraints without erroring on already-correct schema. Safe on a clean DB,
-- a fully-drifted DB, and a partially-drifted DB alike.
--
-- Types mirror the original migrations exactly:
--   industries / company_sizes              -> jsonb,  default '[]', NOT NULL
--   roles / excluded_industries / excl_loc  -> text[], default '{}'
--   remote_friendly                         -> boolean, default false, NOT NULL

BEGIN;

-- 1) jsonb ICP columns (from 20260604000000)
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS industries    JSONB,
  ADD COLUMN IF NOT EXISTS company_sizes JSONB;

-- Backfill any NULLs (covers freshly-added columns and pre-existing NULL rows)
UPDATE client_profiles
  SET industries = COALESCE(industries, '[]'::jsonb),
      company_sizes = COALESCE(company_sizes, '[]'::jsonb)
  WHERE industries IS NULL OR company_sizes IS NULL;

ALTER TABLE client_profiles
  ALTER COLUMN industries    SET DEFAULT '[]'::jsonb,
  ALTER COLUMN company_sizes SET DEFAULT '[]'::jsonb,
  ALTER COLUMN industries    SET NOT NULL,
  ALTER COLUMN company_sizes SET NOT NULL;

-- 2) text[] ICP columns + remote_friendly (from 20260612120000)
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS roles               TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_industries TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_locations  TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS remote_friendly     BOOLEAN DEFAULT false;

-- remote_friendly must be NOT NULL; backfill then enforce (idempotent)
UPDATE client_profiles
  SET remote_friendly = COALESCE(remote_friendly, false)
  WHERE remote_friendly IS NULL;

ALTER TABLE client_profiles
  ALTER COLUMN remote_friendly SET NOT NULL;

COMMIT;
