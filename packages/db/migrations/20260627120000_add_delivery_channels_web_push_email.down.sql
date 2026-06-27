BEGIN;

DROP TABLE IF EXISTS lead_channel_deliveries;
DROP TABLE IF EXISTS web_push_subscriptions;

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_digest_email_not_blank;

ALTER TABLE client_profiles
  DROP COLUMN IF EXISTS web_push_enabled,
  DROP COLUMN IF EXISTS email_digest_enabled,
  DROP COLUMN IF EXISTS digest_email;

COMMIT;
