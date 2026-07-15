import { getPool } from "./db-pool";
import {
  configureTelegramWebhook,
  deleteTelegramWebhook,
  deleteVkCallbackServer,
  verifyTelegramBotToken,
  verifyVkCommunity,
} from "./notification-providers";
import { decryptNotificationSecret, redactProviderSecret } from "./notification-secrets";
import { reconcileVkNotificationConnection } from "./notification-vk-reconcile";
import {
  createNotificationBindingInstructions,
  createTelegramNotificationConnection,
  createVkNotificationConnection,
  disconnectNotificationConnection,
} from "./notifications";

export type DisconnectNotificationResult = {
  cleanupWarning?: string;
};

type ExistingAccountRow = {
  id: string;
  ownerId: string;
  provider: "telegram" | "vk" | "webhook";
  status: string;
  secretCiphertext: string;
  providerMetadata: Record<string, unknown> | null;
};

type TelegramCredentials = {
  botToken: string;
  webhookSecret: string;
  username: string;
};

type VkCredentials = {
  token: string;
  groupId: string;
  callbackSecret: string;
  confirmationCode: string;
};

function accountAad(accountId: string, ownerId: string | number): string {
  return `notification-account:${accountId}:owner:${ownerId}`;
}

async function findExistingAccount(input: {
  ownerId: string | number;
  provider: "telegram" | "vk";
  externalAccountId: string;
}): Promise<ExistingAccountRow | null> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<ExistingAccountRow>(
    `
      SELECT id::text AS id, owner_id::text AS "ownerId", provider, status,
             secret_ciphertext AS "secretCiphertext", provider_metadata AS "providerMetadata"
      FROM notification_provider_accounts
      WHERE owner_id = $1
        AND provider = $2
        AND external_account_id = $3
        AND status <> 'revoked'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.ownerId, input.provider, input.externalAccountId],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function getOwnedAccount(input: {
  ownerId: string | number;
  connectionId: string;
}): Promise<ExistingAccountRow | null> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<ExistingAccountRow>(
    `
      SELECT id::text AS id, owner_id::text AS "ownerId", provider, status,
             secret_ciphertext AS "secretCiphertext", provider_metadata AS "providerMetadata"
      FROM notification_provider_accounts
      WHERE id = $1 AND owner_id = $2 AND status <> 'revoked'
      LIMIT 1
    `,
    [input.connectionId, input.ownerId],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function recoverTelegramConnection(account: ExistingAccountRow): Promise<{
  connectionId: string;
  privateLink: string;
  groupLink: string;
} | null> {
  const credentials = decryptNotificationSecret<TelegramCredentials>(
    account.secretCiphertext,
    accountAad(account.id, account.ownerId),
  );
  const webhookUrl = String(account.providerMetadata?.webhookUrl ?? "").trim();
  if (!webhookUrl) return null;
  await configureTelegramWebhook({
    botToken: credentials.botToken,
    webhookUrl,
    webhookSecret: credentials.webhookSecret,
  });
  const instructions = await createNotificationBindingInstructions({
    ownerId: account.ownerId,
    connectionId: account.id,
  });
  if (!instructions.privateLink || !instructions.groupLink) return null;
  return {
    connectionId: account.id,
    privateLink: instructions.privateLink,
    groupLink: instructions.groupLink,
  };
}

export async function createTelegramNotificationConnectionSafely(input: {
  ownerId: string | number;
  clientProfileId: string | number;
  botToken: string;
  displayName?: string | null;
}): Promise<{ connectionId: string; privateLink: string; groupLink: string }> {
  const botToken = input.botToken.trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    throw new Error("Telegram bot token has an invalid format.");
  }
  const identity = await verifyTelegramBotToken(botToken);
  const before = await findExistingAccount({
    ownerId: input.ownerId,
    provider: "telegram",
    externalAccountId: identity.id,
  });
  if (before) throw new Error("Этот Telegram-бот уже подключён к аккаунту.");

  try {
    return await createTelegramNotificationConnection({ ...input, botToken });
  } catch (error) {
    const after = await findExistingAccount({
      ownerId: input.ownerId,
      provider: "telegram",
      externalAccountId: identity.id,
    });
    if (after) {
      const recovered = await recoverTelegramConnection(after).catch(() => null);
      if (recovered) return recovered;
    } else {
      await deleteTelegramWebhook({ botToken }).catch(() => {});
    }
    throw error;
  }
}

export async function createVkNotificationConnectionSafely(input: {
  ownerId: string | number;
  clientProfileId: string | number;
  groupId: string;
  token: string;
  displayName?: string | null;
}): Promise<{ connectionId: string; connectCommand: string; callbackConfigured: boolean }> {
  const groupId = input.groupId.trim().replace(/^club/, "");
  const token = input.token.trim();
  if (!/^\d+$/.test(groupId) || token.length < 20) {
    throw new Error("Укажите ID сообщества и действующий ключ доступа VK.");
  }
  const identity = await verifyVkCommunity({ groupId, token });
  const before = await findExistingAccount({
    ownerId: input.ownerId,
    provider: "vk",
    externalAccountId: identity.id,
  });
  if (before) throw new Error("Это VK-сообщество уже подключено к аккаунту.");

  try {
    return await createVkNotificationConnection({ ...input, groupId, token });
  } catch (error) {
    const after = await findExistingAccount({
      ownerId: input.ownerId,
      provider: "vk",
      externalAccountId: identity.id,
    });
    if (!after) throw error;
    let callbackConfigured = true;
    try {
      await reconcileVkNotificationConnection({
        ownerId: input.ownerId,
        connectionId: after.id,
      });
    } catch {
      callbackConfigured = false;
    }
    const instructions = await createNotificationBindingInstructions({
      ownerId: input.ownerId,
      connectionId: after.id,
    });
    return {
      connectionId: after.id,
      connectCommand: instructions.connectCommand ?? "/connect",
      callbackConfigured,
    };
  }
}

export async function disconnectNotificationConnectionSafely(input: {
  ownerId: string | number;
  connectionId: string;
}): Promise<DisconnectNotificationResult> {
  const account = await getOwnedAccount(input);
  if (!account) throw new Error("Канал уведомлений не найден.");

  await disconnectNotificationConnection(input);

  let cleanupWarning: string | undefined;
  try {
    if (account.provider === "telegram") {
      const credentials = decryptNotificationSecret<TelegramCredentials>(
        account.secretCiphertext,
        accountAad(account.id, account.ownerId),
      );
      await deleteTelegramWebhook({ botToken: credentials.botToken });
    } else if (account.provider === "vk") {
      const serverId = String(account.providerMetadata?.callbackServerId ?? "").trim();
      if (serverId) {
        const credentials = decryptNotificationSecret<VkCredentials>(
          account.secretCiphertext,
          accountAad(account.id, account.ownerId),
        );
        await deleteVkCallbackServer({
          groupId: credentials.groupId,
          token: credentials.token,
          serverId,
        });
      }
    }
  } catch (error) {
    cleanupWarning = redactProviderSecret(
      error instanceof Error ? error.message : "Provider hook cleanup failed.",
    ).slice(0, 500);
    const pool = getPool();
    if (pool) {
      await pool.query(
        `
          INSERT INTO notification_audit_log (
            owner_id, actor_type, action, object_type, object_id, metadata
          ) VALUES ($1, 'system', 'notification.provider_cleanup_failed',
                    'provider_account', $2, $3::jsonb)
        `,
        [input.ownerId, input.connectionId, JSON.stringify({ warning: cleanupWarning })],
      ).catch(() => {});
    }
  }
  return cleanupWarning ? { cleanupWarning } : {};
}
