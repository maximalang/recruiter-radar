BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth_sessions)
     OR EXISTS (
       SELECT 1
       FROM auth_security_events
       WHERE event_type IN (
         'login_succeeded',
         'challenge_replayed',
         'session_created',
         'session_rotated',
         'session_revoked',
         'all_sessions_revoked',
         'legacy_session_migrated',
         'legacy_session_revoked'
       )
     ) THEN
    RAISE EXCEPTION
      'auth v2 challenge consumption rollback refused: sessions or lifecycle events exist';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS consume_auth_login_challenge(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ
);

DROP INDEX IF EXISTS auth_security_events_challenge_replay_uidx;

ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS auth_sessions_device_label_check,
  DROP CONSTRAINT IF EXISTS auth_sessions_auth_method_check,
  DROP COLUMN IF EXISTS device_label,
  DROP COLUMN IF EXISTS auth_method;

COMMIT;
