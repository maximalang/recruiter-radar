BEGIN;

DROP FUNCTION change_auth_session_workspace(
  TEXT,
  TEXT,
  BIGINT,
  TIMESTAMPTZ
);

UPDATE auth_sessions
SET
  previous_token_hash = NULL,
  previous_token_valid_until = NULL
WHERE NOT previous_token_authorizes;

ALTER TABLE auth_sessions
  DROP COLUMN previous_token_authorizes;

COMMIT;
