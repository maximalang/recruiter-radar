-- E2E test teardown: deactivate the seeded test client profile.
--
-- Companion to seed-test-profile.sql. Flips is_active=false so the daily-radar
-- cron loop (api/cron/daily-radar/route.ts) stops selecting it -- its query
-- requires is_active = true. The profile row, its owner user, and any
-- digest_candidates are LEFT IN PLACE (non-destructive); re-running the seed
-- re-activates it (the seed forces is_active = true on conflict).
--
-- Idempotent: matches the owner by LOWER(email) exactly like the seed, so it
-- targets only the dedicated E2E profile and never touches real customer data.
-- Running it when no E2E profile exists is a harmless no-op (0 rows updated).

UPDATE client_profiles
SET
  is_active  = false,
  updated_at = NOW()
WHERE owner_id IN (
  SELECT id FROM users WHERE LOWER(email) = 'e2e-owner@example.test'
);

-- Confirmation: active-profile counts after teardown.
SELECT
  COUNT(*) FILTER (WHERE is_active)                                   AS active_profiles_total,
  COUNT(*) FILTER (WHERE is_active AND telegram_chat_id IS NOT NULL)  AS active_with_telegram_picked_up_by_cron
FROM client_profiles;
