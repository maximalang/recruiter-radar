BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM trial_claims) THEN
    RAISE EXCEPTION 'verified trial rollback refused while claim audit rows exist';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trial_claims_set_updated_at ON trial_claims;
DROP TRIGGER IF EXISTS client_profiles_trial_immutable_guard ON client_profiles;
DROP FUNCTION IF EXISTS trial_claims_set_updated_at();
DROP FUNCTION IF EXISTS rr_trial_profile_immutability_guard();
DROP FUNCTION IF EXISTS rr_trial_profile_owner_lock(BIGINT);
DROP TABLE IF EXISTS trial_claims;
ALTER TABLE users DROP COLUMN IF EXISTS telegram_verified_at;

COMMIT;
