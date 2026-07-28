BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth_challenges)
     OR EXISTS (SELECT 1 FROM auth_sessions)
     OR EXISTS (SELECT 1 FROM auth_security_events)
     OR EXISTS (SELECT 1 FROM auth_rate_limit_buckets)
     OR EXISTS (
       SELECT 1
       FROM users
       WHERE email_normalized IS NOT NULL
          OR display_name IS NOT NULL
          OR status <> 'active'
          OR onboarding_status <> 'not_started'
          OR onboarding_step IS NOT NULL
          OR onboarding_data <> '{}'::JSONB
          OR last_authenticated_at IS NOT NULL
          OR deleted_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'auth v2 rollback refused: foundation data or non-default user state exists';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS consume_auth_rate_limit(
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ
);
DROP TABLE IF EXISTS auth_rate_limit_buckets;

DROP TRIGGER IF EXISTS auth_security_events_reject_truncate
  ON auth_security_events;
DROP TRIGGER IF EXISTS auth_security_events_append_only
  ON auth_security_events;
DROP FUNCTION IF EXISTS reject_auth_security_event_mutation();
DROP TABLE IF EXISTS auth_security_events;
DROP FUNCTION IF EXISTS auth_security_metadata_is_safe(JSONB);

DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_challenges;

DROP INDEX IF EXISTS users_email_normalized_active_uidx;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_auth_v2_deleted_state_check,
  DROP CONSTRAINT IF EXISTS users_auth_v2_onboarding_data_object_check,
  DROP CONSTRAINT IF EXISTS users_auth_v2_onboarding_status_check,
  DROP CONSTRAINT IF EXISTS users_auth_v2_status_check,
  DROP CONSTRAINT IF EXISTS users_auth_v2_verified_identity_check,
  DROP CONSTRAINT IF EXISTS users_auth_v2_email_normalized_check,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS last_authenticated_at,
  DROP COLUMN IF EXISTS onboarding_data,
  DROP COLUMN IF EXISTS onboarding_step,
  DROP COLUMN IF EXISTS onboarding_status,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS email_normalized;

COMMIT;
