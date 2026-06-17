-- E2E test seed: one active client profile so daily-radar has a profile to process.
--
-- Design notes (read before running against prod):
--   * telegram_chat_id is a FAKE numeric id ('999999999'), NOT NULL on purpose so
--     the cron loop in api/cron/daily-radar/route.ts:118-124 actually selects it
--     (that query requires telegram_chat_id IS NOT NULL).
--   * Because the chat id is fake, deliverCandidatesForRun will get "chat not found"
--     from Telegram -> delivery.failed += 1, totalSent stays 0. NO REAL PERSON IS
--     MESSAGED. Candidates are still written to digest_candidates, which is what
--     /leads reads, so lead generation is still verifiable.
--   * owner_id is REQUIRED: migration 20260521000000 added
--     CHECK (owner_id IS NOT NULL) plus a partial unique index on (owner_id).
--     So this seed first upserts a dedicated E2E owner user, then attaches the
--     profile to it. An ownerless profile cannot exist in this schema.
--   * Idempotent on TWO keys:
--       - the owner user is matched by LOWER(email) (users_email_uidx),
--       - the profile is matched by owner_id (client_profiles_owner_id_uidx,
--         partial WHERE owner_id IS NOT NULL).
--     The dropped agency_name unique index (migration 20260517120000) is NOT a
--     valid conflict target and must not be used. Safe to run more than once.
--
-- Column types (from client_profiles, confirmed via clientProfiles.ts):
--   include_keywords / exclude_keywords / industries / company_sizes : jsonb
--   roles / excluded_industries / excluded_locations                 : text[]
--
-- AFTER running, the final SELECT reports the active-profile count (Step 1 answer).

WITH seed_owner AS (
  INSERT INTO users (email, full_name, telegram_username)
  VALUES ('e2e-owner@example.test', 'E2E Test Owner', NULL)
  ON CONFLICT (LOWER(email)) DO UPDATE
    SET updated_at = NOW()
  RETURNING id
)
INSERT INTO client_profiles (
  owner_id,
  agency_name,
  telegram_chat_id,
  target_city,
  specialization,
  include_keywords,
  exclude_keywords,
  industries,
  company_sizes,
  daily_digest_limit,
  is_active,
  contact_policy,
  roles,
  excluded_industries,
  excluded_locations,
  remote_friendly
)
SELECT
  seed_owner.id,
  'Test Agency',
  '999999999',          -- FAKE chat id: picked up by cron, send fails harmlessly
  'Москва',
  'IT',
  NULL,                 -- include_keywords (jsonb): none -> no extra include filter
  NULL,                 -- exclude_keywords  (jsonb): none
  NULL,                 -- industries        (jsonb): none -> industry filter is a no-op
  NULL,                 -- company_sizes     (jsonb): none
  10,                   -- daily_digest_limit
  true,                 -- is_active
  'corporate_only',     -- contact_policy
  ARRAY[]::text[],      -- roles
  ARRAY[]::text[],      -- excluded_industries
  ARRAY[]::text[],      -- excluded_locations
  false                 -- remote_friendly
FROM seed_owner
ON CONFLICT (owner_id) WHERE owner_id IS NOT NULL DO UPDATE
SET
  agency_name      = EXCLUDED.agency_name,
  telegram_chat_id = EXCLUDED.telegram_chat_id,
  target_city      = EXCLUDED.target_city,
  specialization   = EXCLUDED.specialization,
  is_active        = true,
  updated_at       = NOW();

-- Step 1 answer: how many active profiles exist after insert?
SELECT
  COUNT(*) FILTER (WHERE is_active)                                   AS active_profiles_total,
  COUNT(*) FILTER (WHERE is_active AND telegram_chat_id IS NOT NULL)  AS active_with_telegram_picked_up_by_cron
FROM client_profiles;
