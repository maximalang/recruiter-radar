BEGIN;

DROP FUNCTION IF EXISTS issue_auth_login_challenge(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ
);

COMMIT;
