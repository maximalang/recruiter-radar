BEGIN;

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_hiring_mode_values;

ALTER TABLE client_profiles
  DROP COLUMN IF EXISTS hiring_mode;

COMMIT;
