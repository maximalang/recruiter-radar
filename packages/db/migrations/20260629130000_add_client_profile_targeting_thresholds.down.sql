BEGIN;

ALTER TABLE client_profiles DROP CONSTRAINT IF EXISTS client_profiles_hiring_intent_min_range;
ALTER TABLE client_profiles DROP CONSTRAINT IF EXISTS client_profiles_signal_freshness_days_positive;
ALTER TABLE client_profiles DROP CONSTRAINT IF EXISTS client_profiles_min_open_roles_nonneg;

ALTER TABLE client_profiles
  DROP COLUMN IF EXISTS hiring_intent_min,
  DROP COLUMN IF EXISTS signal_freshness_days,
  DROP COLUMN IF EXISTS min_open_roles;

COMMIT;
