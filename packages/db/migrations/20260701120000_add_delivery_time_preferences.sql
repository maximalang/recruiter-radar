BEGIN;

-- Block 3: delivery-time preferences on client_profiles.
--
-- Adds, all additive / backward-compatible:
--   * delivery_enabled       — master toggle. Defaults TRUE so existing
--                              profiles keep receiving digests (no leads=0
--                              regression). When FALSE the daily-radar delivery
--                              step skips this profile entirely.
--   * delivery_time_local    — desired local delivery time, 'HH:MM' 24h.
--                              NULL = "no preference, send in the default
--                              morning window". The daily cron fires once at
--                              03:00 UTC, so this is advisory/orientation, not
--                              a hard schedule (documented in the UI hint).
--   * delivery_timezone      — IANA tz name, default Europe/Moscow.
--   * delivery_frequency     — 'daily' | 'weekly'. Default daily.
--
-- Channel selection (Telegram / email / web-push) is NOT duplicated here: it
-- is already expressed by telegram_chat_id, email_digest_enabled+digest_email,
-- and web_push_enabled respectively. delivery_enabled is a master gate on top
-- of those, not a replacement for them.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS delivery_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS delivery_time_local    TEXT,
  ADD COLUMN IF NOT EXISTS delivery_timezone      TEXT NOT NULL DEFAULT 'Europe/Moscow',
  ADD COLUMN IF NOT EXISTS delivery_frequency     TEXT NOT NULL DEFAULT 'daily';

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_delivery_time_local_format;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_delivery_time_local_format
    CHECK (
      delivery_time_local IS NULL
      OR delivery_time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    );

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_delivery_timezone_not_blank;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_delivery_timezone_not_blank
    CHECK (BTRIM(delivery_timezone) <> '');

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_delivery_frequency_check;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_delivery_frequency_check
    CHECK (delivery_frequency IN ('daily', 'weekly'));

COMMENT ON COLUMN client_profiles.delivery_enabled IS 'Master toggle for lead delivery. FALSE = skip this profile in the daily-radar delivery step (channels stay configured but receive nothing). Defaults TRUE.';
COMMENT ON COLUMN client_profiles.delivery_time_local IS 'Desired local delivery time, HH:MM 24h. NULL = no preference (default morning window). Advisory only: the daily cron fires once at 03:00 UTC, so exact per-user time is not honored yet.';
COMMENT ON COLUMN client_profiles.delivery_timezone IS 'IANA timezone name for interpreting delivery_time_local and rendering the next-delivery hint. Defaults Europe/Moscow.';
COMMENT ON COLUMN client_profiles.delivery_frequency IS 'How often to deliver a digest. daily (default) or weekly. weekly delivery still rides the daily cron but is skipped on non-target days.';

COMMIT;
