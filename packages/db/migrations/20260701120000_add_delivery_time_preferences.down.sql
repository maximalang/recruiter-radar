BEGIN;

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_delivery_frequency_check;
ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_delivery_timezone_not_blank;
ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_delivery_time_local_format;

ALTER TABLE client_profiles
  DROP COLUMN IF EXISTS delivery_frequency,
  DROP COLUMN IF EXISTS delivery_timezone,
  DROP COLUMN IF EXISTS delivery_time_local,
  DROP COLUMN IF EXISTS delivery_enabled;

COMMIT;
