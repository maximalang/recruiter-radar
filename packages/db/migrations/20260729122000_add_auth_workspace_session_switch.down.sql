BEGIN;

DROP FUNCTION change_auth_session_workspace(
  TEXT,
  TEXT,
  BIGINT,
  TIMESTAMPTZ
);

COMMIT;
