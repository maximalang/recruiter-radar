BEGIN;

-- Harden notification provider identity to be globally unique per provider
-- + external_account_id, instead of only unique per owner. This prevents a
-- second owner from re-registering a Telegram bot or VK community that is
-- already active for a different owner, which would otherwise reconfigure the
-- provider webhook/callback before the database rejects the duplicate row.
--
-- Active (non-revoked) Telegram/VK identities must be globally unique. Revoked
-- connections are excluded so an owner can reconnect the same bot/community
-- after revocation, and a different owner can claim an identity that a prior
-- owner released.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM notification_provider_accounts
    WHERE provider IN ('telegram', 'vk')
      AND external_account_id IS NOT NULL
      AND status <> 'revoked'
    GROUP BY provider, external_account_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce notification provider identity uniqueness: duplicate active Telegram/VK accounts exist. Resolve duplicates before re-running.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS notification_provider_accounts_global_identity_unique
  ON notification_provider_accounts(provider, external_account_id)
  WHERE provider IN ('telegram', 'vk')
    AND external_account_id IS NOT NULL
    AND status <> 'revoked';

COMMIT;
