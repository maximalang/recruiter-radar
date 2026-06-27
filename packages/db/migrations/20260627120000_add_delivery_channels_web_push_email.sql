BEGIN;

-- Delivery paths #1 (web-push) and #2 (email digest).
--
-- Adds, all additive / backward-compatible:
--   * client_profiles.web_push_enabled / email_digest_enabled / digest_email
--     — per-profile channel preferences.
--   * web_push_subscriptions — one row per (profile, browser push endpoint).
--   * lead_channel_deliveries — aggregate-delivery dedupe log for run-level
--     push and day-level email. Per-candidate Telegram idempotency stays in
--     digest_delivery_attempts; this table is only for aggregate deliveries
--     that have no single candidate to key on.

-- 1. Per-profile channel preferences ----------------------------------------

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS web_push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_digest_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS digest_email TEXT;

COMMENT ON COLUMN client_profiles.web_push_enabled IS 'Whether the agency wants browser push for new strong (A/B) leads. Default on; only fires when an active subscription exists.';
COMMENT ON COLUMN client_profiles.email_digest_enabled IS 'Whether the agency wants the daily email digest. Default off; opt-in requires digest_email.';
COMMENT ON COLUMN client_profiles.digest_email IS 'Destination address for the daily email digest. NULL = email digest not configured.';

ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_digest_email_not_blank
    CHECK (digest_email IS NULL OR BTRIM(digest_email) <> '');

-- 2. Web-push subscriptions --------------------------------------------------

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT web_push_subscriptions_endpoint_not_blank CHECK (BTRIM(endpoint) <> ''),
  CONSTRAINT web_push_subscriptions_p256dh_not_blank CHECK (BTRIM(p256dh) <> ''),
  CONSTRAINT web_push_subscriptions_auth_not_blank CHECK (BTRIM(auth) <> ''),
  CONSTRAINT web_push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

-- Hot path: "active subscriptions for this profile" (revoked_at IS NULL).
CREATE INDEX IF NOT EXISTS web_push_subscriptions_profile_active_idx
  ON web_push_subscriptions (client_profile_id)
  WHERE revoked_at IS NULL;

-- 3. Aggregate-delivery dedupe log ------------------------------------------

CREATE TABLE IF NOT EXISTS lead_channel_deliveries (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  client_profile_id BIGINT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  digest_run_id BIGINT REFERENCES digest_runs(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_channel_deliveries_channel_check CHECK (channel IN ('web_push', 'email')),
  CONSTRAINT lead_channel_deliveries_dedupe_key_not_blank CHECK (BTRIM(dedupe_key) <> ''),
  CONSTRAINT lead_channel_deliveries_lead_count_check CHECK (lead_count >= 0)
);

-- One aggregate delivery per (channel, profile, dedupe_key):
--   web_push dedupe_key = 'run:<digest_run_id>'
--   email    dedupe_key = 'day:<YYYY-MM-DD>'
CREATE UNIQUE INDEX IF NOT EXISTS lead_channel_deliveries_channel_profile_key_uidx
  ON lead_channel_deliveries (channel, client_profile_id, dedupe_key);

COMMIT;
