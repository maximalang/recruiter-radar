import { getPool } from "./db-pool";
import { configureVkCallback } from "./notification-providers";
import { decryptNotificationSecret, redactProviderSecret } from "./notification-secrets";

type VkCredentials = {
  token: string;
  groupId: string;
  callbackSecret: string;
  confirmationCode: string;
};

type VkAccountRow = {
  id: string;
  ownerId: string;
  clientProfileId: string;
  secretCiphertext: string;
  providerMetadata: Record<string, unknown> | null;
};

function accountAad(accountId: string, ownerId: string): string {
  return `notification-account:${accountId}:owner:${ownerId}`;
}

export async function reconcileVkNotificationConnection(input: {
  ownerId: string | number;
  connectionId: string;
}): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const accountResult = await pool.query<VkAccountRow>(
    `
      SELECT
        id::text AS id,
        owner_id::text AS "ownerId",
        client_profile_id::text AS "clientProfileId",
        secret_ciphertext AS "secretCiphertext",
        provider_metadata AS "providerMetadata"
      FROM notification_provider_accounts
      WHERE id = $1
        AND owner_id = $2
        AND provider = 'vk'
        AND status <> 'revoked'
      LIMIT 1
    `,
    [input.connectionId, input.ownerId],
  );
  if (accountResult.rowCount !== 1) {
    throw new Error("VK-подключение не найдено.");
  }

  const account = accountResult.rows[0];
  const credentials = decryptNotificationSecret<VkCredentials>(
    account.secretCiphertext,
    accountAad(account.id, account.ownerId),
  );
  const callbackUrl = String(account.providerMetadata?.callbackUrl ?? "").trim();
  if (!callbackUrl) throw new Error("В подключении отсутствует Callback API URL.");

  try {
    const configured = await configureVkCallback({
      groupId: credentials.groupId,
      token: credentials.token,
      callbackUrl,
      callbackSecret: credentials.callbackSecret,
    });

    await pool.query(
      `
        UPDATE notification_provider_accounts
        SET status = 'active',
            provider_metadata = provider_metadata || $3::jsonb,
            last_verified_at = NOW(),
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = NOW()
        WHERE id = $1 AND owner_id = $2
      `,
      [
        account.id,
        input.ownerId,
        JSON.stringify({ callbackServerId: configured.serverId }),
      ],
    );
    await pool.query(
      `
        INSERT INTO notification_audit_log (
          owner_id, client_profile_id, actor_type, action, object_type, object_id, metadata
        ) VALUES ($1, $2, 'user', 'notification.vk.callback_reconciled',
                  'provider_account', $3, $4::jsonb)
      `,
      [
        input.ownerId,
        account.clientProfileId,
        account.id,
        JSON.stringify({ callbackServerId: configured.serverId }),
      ],
    );
  } catch (error) {
    const message = redactProviderSecret(
      error instanceof Error ? error.message : "VK Callback API setup failed.",
    ).slice(0, 1000);
    await pool.query(
      `
        UPDATE notification_provider_accounts
        SET status = 'degraded',
            last_error_code = 'callback_setup_failed',
            last_error_message = $3,
            updated_at = NOW()
        WHERE id = $1 AND owner_id = $2
      `,
      [account.id, input.ownerId, message],
    );
    throw new Error(message);
  }
}
