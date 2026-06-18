-- Repair migration: re-assert ICP columns on client_profiles.
--
-- Why this exists:
--   On prod, 20260604000000_add_icp_industries_company_sizes and
--   20260612120000_add_icp_roles_and_exclusions are RECORDED as applied in
--   schema_migrations, yet the six columns they add were absent from the live
--   client_profiles table (verified 2026-06-18). The DDL ran against a database
--   instance that prod no longer points at (restore / re-provision), leaving the
--   ledger ahead of the schema. Reads/writes in apps/web/lib/clientProfiles.ts
--   then failed with: column "industries" does not exist.
--
-- This migration is forward-only and fully idempotent (ADD COLUMN IF NOT EXISTS):
--   - On prod (columns missing): adds them, restoring the intended schema.
--   - On dev/local/CI (columns present): a no-op.
-- It does NOT touch schema_migrations rows for the earlier versions — the prior
-- records stay truthful for every DB where those migrations really did run.
--
-- Column names/types match the originals exactly so existing 20260604/20260612
-- records remain consistent with the live schema after repair.

-- From 20260604000000 — industries + company_sizes (JSONB, NOT NULL, default []).
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS industries JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS company_sizes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- From 20260612120000 — roles + exclusions + remote_friendly.
ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_industries TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_locations TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS remote_friendly BOOLEAN NOT NULL DEFAULT false;

-- Re-assert column documentation (idempotent).
COMMENT ON COLUMN client_profiles.industries IS 'Industry keys the agency targets. Feeds FIUR computeFit / industryAlignment.';
COMMENT ON COLUMN client_profiles.company_sizes IS 'Company-size buckets the agency targets. Feeds FIUR computeFit.';
COMMENT ON COLUMN client_profiles.roles IS 'Canonical role keys the agency specialises in (e.g. it-engineering, data, sales). Used by computeFit role-match scoring.';
COMMENT ON COLUMN client_profiles.excluded_industries IS 'Industry keys the agency explicitly does not serve. Overridden by excludedLocations in geographic-fit.';
COMMENT ON COLUMN client_profiles.excluded_locations IS 'Location/region names the agency explicitly does not cover.';
COMMENT ON COLUMN client_profiles.remote_friendly IS 'Whether the agency can serve remote-first companies regardless of location.';
