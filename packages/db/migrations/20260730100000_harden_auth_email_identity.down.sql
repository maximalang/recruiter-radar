BEGIN;

DO $rollback_guard$
DECLARE
  folded_duplicate_count BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM auth_challenges)
     OR EXISTS (SELECT 1 FROM auth_sessions)
     OR EXISTS (
       SELECT 1
       FROM users
       WHERE email_normalized IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'auth email identity hardening rollback refused: live auth v2 identity data exists';
  END IF;

  SELECT COUNT(*)
  INTO folded_duplicate_count
  FROM (
    SELECT LOWER(email)
    FROM users
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  ) AS folded_duplicate;

  IF folded_duplicate_count > 0 THEN
    RAISE EXCEPTION
      'auth email identity hardening rollback refused: case-distinct mailboxes exist';
  END IF;
END;
$rollback_guard$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx
  ON users (LOWER(email));

DO $restore_installed_functions$
DECLARE
  function_definition TEXT;
  restored_definition TEXT;
  secure_match_count INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'issue_auth_login_challenge(text,text,text,text,text,text,text,timestamptz)'
      ::REGPROCEDURE
  )
  INTO function_definition;

  SELECT COUNT(*)
  INTO secure_match_count
  FROM regexp_matches(
    function_definition,
    $regex$email_normalized IS NULL\s+AND split_part\(email, '@', 1\)\s*=\s*split_part\(input_email_normalized, '@', 1\)\s+AND LOWER\(split_part\(email, '@', 2\)\)\s*=\s*split_part\(input_email_normalized, '@', 2\)$regex$,
    'gi'
  );
  IF secure_match_count <> 1 THEN
    RAISE EXCEPTION
      'auth email identity hardening rollback refused: unexpected issuance function';
  END IF;
  restored_definition := regexp_replace(
    function_definition,
    $regex$email_normalized IS NULL\s+AND split_part\(email, '@', 1\)\s*=\s*split_part\(input_email_normalized, '@', 1\)\s+AND LOWER\(split_part\(email, '@', 2\)\)\s*=\s*split_part\(input_email_normalized, '@', 2\)$regex$,
    $replacement$email_normalized IS NULL
        AND LOWER(email) = LOWER(input_email_normalized)$replacement$,
    'gi'
  );
  EXECUTE restored_definition;

  SELECT pg_get_functiondef(
    'consume_auth_login_challenge(text,text,text,text,text,timestamptz)'
      ::REGPROCEDURE
  )
  INTO function_definition;

  SELECT COUNT(*)
  INTO secure_match_count
  FROM regexp_matches(
    function_definition,
    $regex$account.email_normalized IS NULL\s+AND split_part\(account.email, '@', 1\)\s*=\s*split_part\(locked_challenge.email_normalized, '@', 1\)\s+AND LOWER\(split_part\(account.email, '@', 2\)\)\s*=\s*split_part\(locked_challenge.email_normalized, '@', 2\)$regex$,
    'gi'
  );
  IF secure_match_count <> 2 THEN
    RAISE EXCEPTION
      'auth email identity hardening rollback refused: unexpected consumption function';
  END IF;
  restored_definition := regexp_replace(
    function_definition,
    $regex$account.email_normalized IS NULL\s+AND split_part\(account.email, '@', 1\)\s*=\s*split_part\(locked_challenge.email_normalized, '@', 1\)\s+AND LOWER\(split_part\(account.email, '@', 2\)\)\s*=\s*split_part\(locked_challenge.email_normalized, '@', 2\)$regex$,
    $replacement$account.email_normalized IS NULL
          AND LOWER(account.email) = LOWER(locked_challenge.email_normalized)$replacement$,
    'gi'
  );
  EXECUTE restored_definition;
END;
$restore_installed_functions$;

DROP INDEX IF EXISTS users_auth_v2_identity_active_uidx;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_auth_v2_identity_consistency_check;

COMMIT;
