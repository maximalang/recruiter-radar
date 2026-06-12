BEGIN;

ALTER TABLE client_profiles
  DROP COLUMN IF EXISTS roles,
  DROP COLUMN IF EXISTS excluded_industries,
  DROP COLUMN IF EXISTS excluded_locations,
  DROP COLUMN IF EXISTS remote_friendly;

COMMIT;
