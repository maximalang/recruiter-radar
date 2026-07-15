BEGIN;

DROP TABLE IF EXISTS account_login_challenges;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;

COMMIT;
