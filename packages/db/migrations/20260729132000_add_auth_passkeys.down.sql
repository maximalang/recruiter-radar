BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE user_passkeys IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_passkeys LIMIT 1) THEN
    RAISE EXCEPTION
      'refusing to drop non-empty user_passkeys; remove credentials through the application first';
  END IF;
END;
$$;

DROP TABLE user_passkeys;

DELETE FROM auth_challenges
WHERE purpose = 'passkey_authentication'
  AND email_normalized IS NULL;

DROP INDEX auth_challenges_active_identity_uidx;

ALTER TABLE auth_challenges
  DROP CONSTRAINT auth_challenges_identity_presence_check,
  ALTER COLUMN email_normalized SET NOT NULL;

CREATE UNIQUE INDEX auth_challenges_active_identity_uidx
  ON auth_challenges (purpose, email_normalized)
  WHERE consumed_at IS NULL
    AND invalidated_at IS NULL;

COMMIT;
