BEGIN;

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
      'Cannot enforce notification provider identity uniqueness: duplicate active Telegram/VK accounts exist.';
  END IF;
END
$$;

CREATE UNIQUE INDEX notification_provider_accounts_global_identity_unique
  ON notification_provider_accounts(provider, external_account_id)
  WHERE provider IN ('telegram', 'vk')
    AND external_account_id IS NOT NULL
    AND status <> 'revoked';

COMMIT;
