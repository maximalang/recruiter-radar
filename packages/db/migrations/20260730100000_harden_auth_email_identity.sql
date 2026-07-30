SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DO $identity_consistency$
DECLARE
  inconsistent_identity_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO inconsistent_identity_count
  FROM users
  WHERE email_normalized IS NOT NULL
    AND (
      split_part(email, '@', 1)
        <> split_part(email_normalized, '@', 1)
      OR LOWER(split_part(email, '@', 2))
        <> split_part(email_normalized, '@', 2)
    );

  IF inconsistent_identity_count > 0 THEN
    RAISE EXCEPTION
      'auth email identity hardening refused: % inconsistent normalized identities',
      inconsistent_identity_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'users'::REGCLASS
      AND conname = 'users_auth_v2_identity_consistency_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_auth_v2_identity_consistency_check
      CHECK (
        email_normalized IS NULL
        OR (
          split_part(email, '@', 1)
            = split_part(email_normalized, '@', 1)
          AND LOWER(split_part(email, '@', 2))
            = split_part(email_normalized, '@', 2)
        )
      )
      NOT VALID;
  END IF;
END;
$identity_consistency$;

ALTER TABLE users
  VALIDATE CONSTRAINT users_auth_v2_identity_consistency_check;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_v2_identity_active_uidx
  ON users (
    (split_part(COALESCE(email_normalized, email), '@', 1)),
    (LOWER(split_part(COALESCE(email_normalized, email), '@', 2)))
  )
  WHERE status <> 'deleted';

DROP INDEX IF EXISTS users_email_uidx;

DO $harden_installed_functions$
DECLARE
  function_definition TEXT;
  hardened_definition TEXT;
  insecure_match_count INTEGER;
  secure_match_count INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'issue_auth_login_challenge(text,text,text,text,text,text,text,timestamptz)'
      ::REGPROCEDURE
  )
  INTO function_definition;

  SELECT COUNT(*)
  INTO insecure_match_count
  FROM regexp_matches(
    function_definition,
    $regex$email_normalized IS NULL\s+AND LOWER\(email\)\s*=\s*LOWER\(input_email_normalized\)$regex$,
    'gi'
  );
  SELECT COUNT(*)
  INTO secure_match_count
  FROM regexp_matches(
    function_definition,
    $regex$email_normalized IS NULL\s+AND split_part\(email, '@', 1\)\s*=\s*split_part\(input_email_normalized, '@', 1\)\s+AND LOWER\(split_part\(email, '@', 2\)\)\s*=\s*split_part\(input_email_normalized, '@', 2\)$regex$,
    'gi'
  );

  IF insecure_match_count = 1 THEN
    hardened_definition := regexp_replace(
      function_definition,
      $regex$email_normalized IS NULL\s+AND LOWER\(email\)\s*=\s*LOWER\(input_email_normalized\)$regex$,
      $replacement$email_normalized IS NULL
        AND split_part(email, '@', 1)
          = split_part(input_email_normalized, '@', 1)
        AND LOWER(split_part(email, '@', 2))
          = split_part(input_email_normalized, '@', 2)$replacement$,
      'gi'
    );
    EXECUTE hardened_definition;
  ELSIF secure_match_count <> 1 THEN
    RAISE EXCEPTION
      'auth email identity hardening refused: unexpected issuance function';
  END IF;

  SELECT pg_get_functiondef(
    'consume_auth_login_challenge(text,text,text,text,text,timestamptz)'
      ::REGPROCEDURE
  )
  INTO function_definition;

  SELECT COUNT(*)
  INTO insecure_match_count
  FROM regexp_matches(
    function_definition,
    $regex$account.email_normalized IS NULL\s+AND LOWER\(account.email\)\s*=\s*LOWER\(locked_challenge.email_normalized\)$regex$,
    'gi'
  );
  SELECT COUNT(*)
  INTO secure_match_count
  FROM regexp_matches(
    function_definition,
    $regex$account.email_normalized IS NULL\s+AND split_part\(account.email, '@', 1\)\s*=\s*split_part\(locked_challenge.email_normalized, '@', 1\)\s+AND LOWER\(split_part\(account.email, '@', 2\)\)\s*=\s*split_part\(locked_challenge.email_normalized, '@', 2\)$regex$,
    'gi'
  );

  IF insecure_match_count = 2 THEN
    hardened_definition := regexp_replace(
      function_definition,
      $regex$account.email_normalized IS NULL\s+AND LOWER\(account.email\)\s*=\s*LOWER\(locked_challenge.email_normalized\)$regex$,
      $replacement$account.email_normalized IS NULL
          AND split_part(account.email, '@', 1)
            = split_part(locked_challenge.email_normalized, '@', 1)
          AND LOWER(split_part(account.email, '@', 2))
            = split_part(locked_challenge.email_normalized, '@', 2)$replacement$,
      'gi'
    );
    EXECUTE hardened_definition;
  ELSIF secure_match_count <> 2 THEN
    RAISE EXCEPTION
      'auth email identity hardening refused: unexpected consumption function';
  END IF;
END;
$harden_installed_functions$;
