BEGIN;

DROP FUNCTION IF EXISTS consume_auth_login_challenge(
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
