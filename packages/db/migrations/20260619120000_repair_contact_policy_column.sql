-- Repair migration: re-assert contact_policy on client_profiles.
--
-- Why this exists:
--   On prod, 20260605140000_add_contact_policy_to_client_profiles is RECORDED as
--   applied in schema_migrations (applied_at 2026-06-17), yet neither the
--   contact_policy ENUM type nor the client_profiles.contact_policy column exist
--   on the live database (verified 2026-06-19). Same ledger-ahead-of-schema drift
--   that 20260618120000_repair_icp_columns fixed for the ICP columns: the original
--   DDL ran against a database instance prod no longer points at. The daily-radar
--   digest then failed with: column "contact_policy" does not exist.
--
-- This migration is forward-only and fully idempotent:
--   - CREATE TYPE is guarded by a pg_type existence check (CREATE TYPE has no
--     IF NOT EXISTS), so it is a no-op where the type already exists.
--   - ADD COLUMN IF NOT EXISTS adds the column only where missing.
-- On prod (type+column missing): restores the intended schema. On dev/local/CI
-- (both present): a no-op. It does NOT touch the 20260605140000 ledger row — that
-- record stays truthful for every DB where the original migration really ran.
--
-- Type/values/default match the original 20260605140000 exactly so the existing
-- record stays consistent with the live schema after repair.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_policy') THEN
    CREATE TYPE contact_policy AS ENUM ('corporate_only', 'no_personal', 'unrestricted');
  END IF;
END$$;

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS contact_policy contact_policy NOT NULL DEFAULT 'corporate_only';

COMMENT ON COLUMN client_profiles.contact_policy IS 'Controls which contact paths are delivered to the agency. corporate_only = only corporate/HR channels; no_personal = exclude personal emails/phones; unrestricted = all paths';

COMMIT;
