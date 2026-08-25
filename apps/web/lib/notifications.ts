import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { isAuthorizedTelegramCallbackOrigin } from "./telegram-callback-authorization";
import { acquireAuthOwnerWriteFence } from "./auth-v2/owner-write-fence";
import { getPool } from "./db-pool";
import {
  configureTelegramWebhook,
  configureVkCallback,
  getVkCallbackConfirmationCode,
  sendSignedWebhook,
  sendTelegramNotification,
  sendVkNotification,
  validateWebhookUrl,
  verifyTelegramBotToken,
  verifyVkCommunity,
} from "./notification-providers";
import {
  decryptNotificationSecret,
  encryptNotificationSecret,
  hashNotificationToken,
  redactProviderSecret,
  timingSafeTextEqual,
} from "./notification-secrets";

export type NotificationProvider = "telegram" | "vk" | "webhook";
export type NotificationConnectionStatus =
  | "pending_verification"
  | "active"
  | "degraded"
  | "paused"
  | "error"
  | "revoked";

export type NotificationEndpoint = {
  id: string;
  endpointType: string;
  status: string;
  destinationLabel: string | null;
  lastDeliveryAt: string | null;
  lastErrorCode: string | null;
};

export type NotificationConnection = {
  id: string;
  publicId: string;
  provider: NotificationProvider;
  displayName: string;
  status: NotificationConnectionStatus;
  externalAccountName: string | null;
  lastVerifiedAt: string | null;
  lastErrorMessage: string | null;
  providerMetadata: Record<string, unknown>;
  endpoints: NotificationEndpoint[];
};

type AccountRow = {
  id: string;
  publicId: string;
  ownerId: string;
  clientProfileId: string;
  provider: NotificationProvider;
  displayName: string;
  status: NotificationConnectionStatus;
  externalAccountId: string | null;
  externalAccountName: string | null;
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

type WebhookCredentials = {
  url: string;
  signingSecret: string;
};

function accountAad(accountId: string, ownerId: string | number): string {
  return `notification-account:${accountId}:owner:${ownerId}`;
}

function notificationBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.AUTH_SITE_URL?.trim() ||
    process.env.RR_APP_BASE_URL?.trim();
  if (!raw) throw new Error("Public application URL is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Public application URL must use HTTPS.");
  }
  return url.toString().replace(/\/+$/, "");
}

function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function normalizeDisplayName(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 120) : fallback;
}

async function insertDefaultEndpointAndRoute(input: {
  client: PoolClient;
  accountId: string;
  clientProfileId: string | number;
  endpointType: string;
  status?: "pending_bind" | "active";
  destinationId?: string | null;
  destinationLabel?: string | null;
}): Promise<string> {
  const endpoint = await input.client.query<{ id: string }>(
    `
      INSERT INTO notification_endpoints (
        provider_account_id, client_profile_id, endpoint_type, status,
        destination_id, destination_label
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id::text AS id
    `,
    [
      input.accountId,
      input.clientProfileId,
      input.endpointType,
      input.status ?? "pending_bind",
      input.destinationId ?? null,
      input.destinationLabel ?? null,
    ],
  );
  const endpointId = endpoint.rows[0].id;
  await input.client.query(
    `
      INSERT INTO notification_routes (
        endpoint_id, client_profile_id, event_kind, status,
        confidence_policy, schedule_timezone
      )
      VALUES ($1, $2, 'daily_digest', 'active', 'A_OR_B', 'Europe/Moscow')
      ON CONFLICT (endpoint_id, event_kind) DO NOTHING
    `,
    [endpointId, input.clientProfileId],
  );
  return endpointId;
}

async function writeAudit(input: {
  client: PoolClient;
  ownerId: string | number | null;
  clientProfileId: string | number | null;
  action: string;
  objectType: string;
  objectId: string;
  metadata?: Record<string, unknown>;
  actorType?: "user" | "system" | "provider";
}): Promise<void> {
  await input.client.query(
    `
      INSERT INTO notification_audit_log (
        owner_id, client_profile_id, actor_type, action, object_type, object_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      input.ownerId,
      input.clientProfileId,
      input.actorType ?? "user",
      input.action,
      input.objectType,
      input.objectId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function listNotificationConnectionsByOwnerId(
  ownerId: string | number,
): Promise<NotificationConnection[]> {
  const pool = getPool();
  if (!pool) return [];

  const result = await pool.query<{
    id: string;
    publicId: string;
    provider: NotificationProvider;
    displayName: string;
    status: NotificationConnectionStatus;
    externalAccountName: string | null;
    lastVerifiedAt: string | null;
    lastErrorMessage: string | null;
    providerMetadata: Record<string, unknown> | null;
    endpointId: string | null;
    endpointType: string | null;
    endpointStatus: string | null;
    destinationLabel: string | null;
    lastDeliveryAt: string | null;
    endpointLastErrorCode: string | null;
  }>(
    `
      SELECT
        a.id::text AS id,
        a.public_id::text AS "publicId",
        a.provider,
        a.display_name AS "displayName",
        a.status,
        a.external_account_name AS "externalAccountName",
        a.last_verified_at::text AS "lastVerifiedAt",
        a.last_error_message AS "lastErrorMessage",
        a.provider_metadata AS "providerMetadata",
        e.id::text AS "endpointId",
        e.endpoint_type AS "endpointType",
        e.status AS "endpointStatus",
        e.destination_label AS "destinationLabel",
        e.last_delivery_at::text AS "lastDeliveryAt",
        e.last_error_code AS "endpointLastErrorCode"
      FROM notification_provider_accounts a
      LEFT JOIN notification_endpoints e ON e.provider_account_id = a.id AND e.status <> 'revoked'
      WHERE a.owner_id = $1 AND a.status <> 'revoked'
      ORDER BY a.created_at DESC, e.created_at ASC
    `,
    [ownerId],
  );

  const connections = new Map<string, NotificationConnection>();
  for (const row of result.rows) {
    const current = connections.get(row.id) ?? {
      id: row.id,
      publicId: row.publicId,
      provider: row.provider,
      displayName: row.displayName,
      status: row.status,
      externalAccountName: row.externalAccountName,
      lastVerifiedAt: row.lastVerifiedAt,
      lastErrorMessage: row.lastErrorMessage,
      providerMetadata: row.providerMetadata ?? {},
      endpoints: [],
    };
    if (row.endpointId && row.endpointType && row.endpointStatus) {
      current.endpoints.push({
        id: row.endpointId,
        endpointType: row.endpointType,
        status: row.endpointStatus,
        destinationLabel: row.destinationLabel,
        lastDeliveryAt: row.lastDeliveryAt,
        lastErrorCode: row.endpointLastErrorCode,
      });
    }
    connections.set(row.id, current);
  }
  return [...connections.values()];
}

export async function createTelegramNotificationConnection(input: {
  ownerId: string | number;
  clientProfileId: string | number;
  botToken: string;
  displayName?: string | null;
}): Promise<{
  connectionId: string;
  privateLink: string;
  groupLink: string;
}> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const botToken = input.botToken.trim();
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    throw new Error("Telegram bot token has an invalid format.");
  }

  const identity = await verifyTelegramBotToken(botToken);
  const accountId = randomUUID();
  const publicId = randomUUID();
  const webhookSecret = randomSecret(24);
  const webhookUrl = `${notificationBaseUrl()}/api/notifications/telegram/${publicId}`;
  await configureTelegramWebhook({ botToken, webhookUrl, webhookSecret });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ciphertext = encryptNotificationSecret(
      { botToken, webhookSecret, username: identity.username },
      accountAad(accountId, input.ownerId),
    );
    await client.query(
      `
        INSERT INTO notification_provider_accounts (
          id, public_id, owner_id, client_profile_id, provider, auth_mode,
          display_name, status, external_account_id, external_account_name,
          secret_ciphertext, capabilities, provider_metadata, last_verified_at
        ) VALUES (
          $1, $2, $3, $4, 'telegram', 'byob',
          $5, 'active', $6, $7, $8,
          '{"outbound":true,"inbound":true,"groups":true}'::jsonb,
          $9::jsonb, NOW()
        )
      `,
      [
        accountId,
        publicId,
        input.ownerId,
        input.clientProfileId,
        normalizeDisplayName(input.displayName, identity.displayName),
        identity.id,
        `@${identity.username}`,
        ciphertext,
        JSON.stringify({ username: identity.username, webhookUrl }),
      ],
    );
    await insertDefaultEndpointAndRoute({
      client,
      accountId,
      clientProfileId: input.clientProfileId,
      endpointType: "telegram_private_chat",
    });
    await writeAudit({
      client,
      ownerId: input.ownerId,
      clientProfileId: input.clientProfileId,
      action: "notification.telegram.connected",
      objectType: "provider_account",
      objectId: accountId,
      metadata: { username: identity.username },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new Error("Этот Telegram-бот уже подключён к аккаунту.");
    }
    throw error;
  } finally {
    client.release();
  }

  const instructions = await createNotificationBindingInstructions({
    ownerId: input.ownerId,
    connectionId: accountId,
  });
  if (!instructions.privateLink || !instructions.groupLink) {
    throw new Error("Telegram connection was created, but bind links could not be generated.");
  }
  return {
    connectionId: accountId,
    privateLink: instructions.privateLink,
    groupLink: instructions.groupLink,
  };
}

export async function createVkNotificationConnection(input: {
  ownerId: string | number;
  clientProfileId: string | number;
  groupId: string;
  token: string;
  displayName?: string | null;
}): Promise<{ connectionId: string; connectCommand: string; callbackConfigured: boolean }> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const groupId = input.groupId.trim().replace(/^club/, "");
  const token = input.token.trim();
  if (!/^\d+$/.test(groupId) || token.length < 20) {
    throw new Error("Укажите ID сообщества и действующий ключ доступа VK.");
  }

  const identity = await verifyVkCommunity({ groupId, token });
  const confirmationCode = await getVkCallbackConfirmationCode({ groupId, token });
  const accountId = randomUUID();
  const publicId = randomUUID();
  const callbackSecret = randomSecret(24);
  const callbackUrl = `${notificationBaseUrl()}/api/notifications/vk/${publicId}`;
  let callbackConfigured = true;
  let callbackServerId: string | null = null;
  let callbackError: string | null = null;
  try {
    callbackServerId = (
      await configureVkCallback({
        groupId,
        token,
        callbackUrl,
        callbackSecret,
      })
    ).serverId;
  } catch (error) {
    callbackConfigured = false;
    callbackError = error instanceof Error ? error.message : "VK callback setup failed.";
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ciphertext = encryptNotificationSecret(
      { token, groupId, callbackSecret, confirmationCode },
      accountAad(accountId, input.ownerId),
    );
    await client.query(
      `
        INSERT INTO notification_provider_accounts (
          id, public_id, owner_id, client_profile_id, provider, auth_mode,
          display_name, status, external_account_id, external_account_name,
          secret_ciphertext, capabilities, provider_metadata, last_verified_at,
          last_error_code, last_error_message
        ) VALUES (
          $1, $2, $3, $4, 'vk', 'community_token',
          $5, $6, $7, $8, $9,
          '{"outbound":true,"inbound":true,"community":true}'::jsonb,
          $10::jsonb, NOW(), $11, $12
        )
      `,
      [
        accountId,
        publicId,
        input.ownerId,
        input.clientProfileId,
        normalizeDisplayName(input.displayName, identity.name),
        callbackConfigured ? "active" : "degraded",
        identity.id,
        identity.name,
        ciphertext,
        JSON.stringify({ groupId, callbackUrl, callbackServerId }),
        callbackConfigured ? null : "callback_setup_failed",
        callbackError,
      ],
    );
    await insertDefaultEndpointAndRoute({
      client,
      accountId,
      clientProfileId: input.clientProfileId,
      endpointType: "vk_peer",
    });
    await writeAudit({
      client,
      ownerId: input.ownerId,
      clientProfileId: input.clientProfileId,
      action: "notification.vk.connected",
      objectType: "provider_account",
      objectId: accountId,
      metadata: { groupId, callbackConfigured },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new Error("Это VK-сообщество уже подключено к аккаунту.");
    }
    throw error;
  } finally {
    client.release();
  }

  const instructions = await createNotificationBindingInstructions({
    ownerId: input.ownerId,
    connectionId: accountId,
  });
  return {
    connectionId: accountId,
    connectCommand: instructions.connectCommand ?? "/connect",
    callbackConfigured,
  };
}

export async function createWebhookNotificationConnection(input: {
  ownerId: string | number;
  clientProfileId: string | number;
  url: string;
  displayName?: string | null;
}): Promise<{ connectionId: string; signingSecret: string }> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const url = validateWebhookUrl(input.url.trim());
  const accountId = randomUUID();
  const publicId = randomUUID();
  const signingSecret = randomSecret(32);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const ciphertext = encryptNotificationSecret(
      { url: url.toString(), signingSecret },
      accountAad(accountId, input.ownerId),
    );
    await client.query(
      `
        INSERT INTO notification_provider_accounts (
          id, public_id, owner_id, client_profile_id, provider, auth_mode,
          display_name, status, external_account_id, external_account_name,
          secret_ciphertext, capabilities, provider_metadata, last_verified_at
        ) VALUES (
          $1, $2, $3, $4, 'webhook', 'hmac',
          $5, 'active', $6, $7, $8,
          '{"outbound":true,"signed":true}'::jsonb,
          $9::jsonb, NOW()
        )
      `,
      [
        accountId,
        publicId,
        input.ownerId,
        input.clientProfileId,
        normalizeDisplayName(input.displayName, url.hostname),
        hashNotificationToken(url.toString()),
        url.hostname,
        ciphertext,
        JSON.stringify({ hostname: url.hostname }),
      ],
    );
    await insertDefaultEndpointAndRoute({
      client,
      accountId,
      clientProfileId: input.clientProfileId,
      endpointType: "generic_webhook",
      status: "active",
      destinationId: `webhook:${hashNotificationToken(url.toString()).slice(0, 24)}`,
      destinationLabel: url.hostname,
    });
    await writeAudit({
      client,
      ownerId: input.ownerId,
      clientProfileId: input.clientProfileId,
      action: "notification.webhook.connected",
      objectType: "provider_account",
      objectId: accountId,
      metadata: { hostname: url.hostname },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { connectionId: accountId, signingSecret };
}

export async function createNotificationBindingInstructions(input: {
  ownerId: string | number;
  connectionId: string;
}): Promise<{
  privateLink?: string;
  groupLink?: string;
  connectCommand?: string;
  expiresAt: string;
}> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const accountResult = await pool.query<{
    id: string;
    provider: NotificationProvider;
    clientProfileId: string;
    providerMetadata: Record<string, unknown> | null;
  }>(
    `
      SELECT id::text AS id, provider, client_profile_id::text AS "clientProfileId",
             provider_metadata AS "providerMetadata"
      FROM notification_provider_accounts
      WHERE id = $1 AND owner_id = $2 AND status <> 'revoked'
      LIMIT 1
    `,
    [input.connectionId, input.ownerId],
  );
  if (accountResult.rowCount !== 1) throw new Error("Канал уведомлений не найден.");
  const account = accountResult.rows[0];
  if (account.provider === "webhook") {
    throw new Error("Webhook не требует привязки чата.");
  }

  const client = await pool.connect();
  const rawToken = randomSecret(24);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  try {
    await client.query("BEGIN");
    await acquireAuthOwnerWriteFence(client);
    let endpoint = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM notification_endpoints
        WHERE provider_account_id = $1 AND status = 'pending_bind'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [account.id],
    );
    if (endpoint.rowCount !== 1) {
      const endpointId = await insertDefaultEndpointAndRoute({
        client,
        accountId: account.id,
        clientProfileId: account.clientProfileId,
        endpointType: account.provider === "telegram" ? "telegram_private_chat" : "vk_peer",
      });
      endpoint = { ...endpoint, rowCount: 1, rows: [{ id: endpointId }] };
    }
    await client.query(
      `
        UPDATE notification_endpoints
        SET bind_token_hash = $2, bind_token_expires_at = $3, updated_at = NOW()
        WHERE id = $1
      `,
      [endpoint.rows[0].id, hashNotificationToken(rawToken), expiresAt.toISOString()],
    );
    await writeAudit({
      client,
      ownerId: input.ownerId,
      clientProfileId: account.clientProfileId,
      action: "notification.endpoint.bind_token_issued",
      objectType: "endpoint",
      objectId: endpoint.rows[0].id,
      metadata: { provider: account.provider },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (account.provider === "telegram") {
    const username = String(account.providerMetadata?.username ?? "").replace(/^@/, "");
    if (!username) throw new Error("Telegram bot username is missing.");
    return {
      privateLink: `https://t.me/${username}?start=${rawToken}`,
      groupLink: `https://t.me/${username}?startgroup=${rawToken}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  return {
    connectCommand: `/connect ${rawToken}`,
    expiresAt: expiresAt.toISOString(),
  };
}

async function getOwnedAccount(
  ownerId: string | number,
  connectionId: string,
): Promise<AccountRow> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<AccountRow>(
    `
      SELECT id::text AS id, public_id::text AS "publicId", owner_id::text AS "ownerId",
             client_profile_id::text AS "clientProfileId", provider,
             display_name AS "displayName", status,
             external_account_id AS "externalAccountId",
             external_account_name AS "externalAccountName",
             secret_ciphertext AS "secretCiphertext",
             provider_metadata AS "providerMetadata"
      FROM notification_provider_accounts
      WHERE id = $1 AND owner_id = $2 AND status <> 'revoked'
      LIMIT 1
    `,
    [connectionId, ownerId],
  );
  if (result.rowCount !== 1) throw new Error("Канал уведомлений не найден.");
  return result.rows[0];
}

export async function testNotificationConnection(input: {
  ownerId: string | number;
  connectionId: string;
}): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const account = await getOwnedAccount(input.ownerId, input.connectionId);
  const endpoint = await pool.query<{
    id: string;
    destinationId: string;
    destinationLabel: string | null;
  }>(
    `
      SELECT id::text AS id, destination_id AS "destinationId",
             destination_label AS "destinationLabel"
      FROM notification_endpoints
      WHERE provider_account_id = $1 AND status = 'active' AND destination_id IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [account.id],
  );
  if (endpoint.rowCount !== 1) {
    throw new Error("Сначала привяжите чат или точку доставки.");
  }

  const message = "Recruiter Radar: тестовое уведомление доставлено. Канал настроен правильно.";
  if (account.provider === "telegram") {
    const credentials = decryptNotificationSecret<TelegramCredentials>(
      account.secretCiphertext,
      accountAad(account.id, account.ownerId),
    );
    await sendTelegramNotification({
      botToken: credentials.botToken,
      chatId: endpoint.rows[0].destinationId,
      text: message,
    });
  } else if (account.provider === "vk") {
    const credentials = decryptNotificationSecret<VkCredentials>(
      account.secretCiphertext,
      accountAad(account.id, account.ownerId),
    );
    await sendVkNotification({
      token: credentials.token,
      peerId: endpoint.rows[0].destinationId,
      text: message,
      randomId: Math.floor(Date.now() % 2_000_000_000),
    });
  } else {
    const credentials = decryptNotificationSecret<WebhookCredentials>(
      account.secretCiphertext,
      accountAad(account.id, account.ownerId),
    );
    await sendSignedWebhook({
      url: credentials.url,
      secret: credentials.signingSecret,
      event: "notification.test",
      eventId: `test_${randomUUID()}`,
      payload: { text: message, connection_id: account.id },
    });
  }

  await pool.query(
    `
      UPDATE notification_endpoints
      SET last_delivery_at = NOW(), last_error_at = NULL, last_error_code = NULL, updated_at = NOW()
      WHERE id = $1
    `,
    [endpoint.rows[0].id],
  );
}

export async function disconnectNotificationConnection(input: {
  ownerId: string | number;
  connectionId: string;
}): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query<{ clientProfileId: string }>(
      `
        UPDATE notification_provider_accounts
        SET status = 'revoked', updated_at = NOW()
        WHERE id = $1 AND owner_id = $2 AND status <> 'revoked'
        RETURNING client_profile_id::text AS "clientProfileId"
      `,
      [input.connectionId, input.ownerId],
    );
    if (account.rowCount !== 1) throw new Error("Канал уведомлений не найден.");
    await client.query(
      `UPDATE notification_endpoints SET status = 'revoked', updated_at = NOW() WHERE provider_account_id = $1`,
      [input.connectionId],
    );
    await client.query(
      `
        UPDATE notification_routes
        SET status = 'disabled', updated_at = NOW()
        WHERE endpoint_id IN (SELECT id FROM notification_endpoints WHERE provider_account_id = $1)
      `,
      [input.connectionId],
    );
    await writeAudit({
      client,
      ownerId: input.ownerId,
      clientProfileId: account.rows[0].clientProfileId,
      action: "notification.connection.revoked",
      objectType: "provider_account",
      objectId: input.connectionId,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getNotificationAccountByPublicId(
  provider: "telegram" | "vk",
  publicId: string,
): Promise<AccountRow | null> {
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query<AccountRow>(
    `
      SELECT id::text AS id, public_id::text AS "publicId", owner_id::text AS "ownerId",
             client_profile_id::text AS "clientProfileId", provider,
             display_name AS "displayName", status,
             external_account_id AS "externalAccountId",
             external_account_name AS "externalAccountName",
             secret_ciphertext AS "secretCiphertext",
             provider_metadata AS "providerMetadata"
      FROM notification_provider_accounts
      WHERE public_id = $1 AND provider = $2 AND status IN ('active', 'degraded')
      LIMIT 1
    `,
    [publicId, provider],
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

export async function authorizeTelegramCallbackOrigin(input: {
  accountId: string;
  clientProfileId: string;
  chatId: string | null;
  actorId: string | null;
}): Promise<boolean> {
  if (!input.chatId || !input.actorId || input.actorId !== input.chatId) return false;
  const pool = getPool();
  if (!pool) return false;

  const endpoint = await pool.query<{
    endpointType: string;
    destinationId: string | null;
  }>(
    `
      SELECT endpoint_type AS "endpointType", destination_id AS "destinationId"
      FROM notification_endpoints
      WHERE provider_account_id = $1
        AND client_profile_id = $2
        AND status = 'active'
        AND endpoint_type = 'telegram_private_chat'
        AND destination_id = $3
      LIMIT 1
    `,
    [input.accountId, input.clientProfileId, input.chatId],
  );
  if (endpoint.rowCount !== 1) return false;

  return isAuthorizedTelegramCallbackOrigin({
    endpointType: endpoint.rows[0].endpointType,
    destinationId: endpoint.rows[0].destinationId,
    chatId: input.chatId,
    actorId: input.actorId,
  });
}

export function decryptTelegramAccountCredentials(account: AccountRow): TelegramCredentials {
  return decryptNotificationSecret<TelegramCredentials>(
    account.secretCiphertext,
    accountAad(account.id, account.ownerId),
  );
}

export function decryptVkAccountCredentials(account: AccountRow): VkCredentials {
  return decryptNotificationSecret<VkCredentials>(
    account.secretCiphertext,
    accountAad(account.id, account.ownerId),
  );
}

export async function bindNotificationEndpoint(input: {
  account: AccountRow;
  bindToken: string;
  destinationId: string;
  destinationLabel: string;
  endpointType: "telegram_private_chat" | "telegram_group" | "telegram_channel" | "vk_peer";
}): Promise<{ status: "bound" | "invalid_or_expired" }> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await acquireAuthOwnerWriteFence(client);
    const pending = await client.query<{ id: string; bindTokenHash: string }>(
      `
        SELECT id::text AS id, bind_token_hash AS "bindTokenHash"
        FROM notification_endpoints
        WHERE provider_account_id = $1
          AND status = 'pending_bind'
          AND bind_token_hash IS NOT NULL
          AND bind_token_expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [input.account.id],
    );
    if (
      pending.rowCount !== 1 ||
      !timingSafeTextEqual(pending.rows[0].bindTokenHash, hashNotificationToken(input.bindToken))
    ) {
      await client.query("ROLLBACK");
      return { status: "invalid_or_expired" };
    }

    await client.query(
      `
        UPDATE notification_endpoints
        SET endpoint_type = $2, status = 'active', destination_id = $3,
            destination_label = $4, bind_token_hash = NULL,
            bind_token_expires_at = NULL, last_inbound_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [
        pending.rows[0].id,
        input.endpointType,
        input.destinationId,
        input.destinationLabel.slice(0, 160),
      ],
    );
    await writeAudit({
      client,
      ownerId: input.account.ownerId,
      clientProfileId: input.account.clientProfileId,
      actorType: "provider",
      action: "notification.endpoint.bound",
      objectType: "endpoint",
      objectId: pending.rows[0].id,
      metadata: { endpointType: input.endpointType },
    });
    await client.query("COMMIT");
    return { status: "bound" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordNotificationInboundEvent(input: {
  accountId: string;
  endpointId?: string | null;
  provider: NotificationProvider;
  providerEventId?: string | null;
  eventType: string;
  payload: unknown;
  status?: "received" | "processed" | "ignored" | "failed";
  errorMessage?: string | null;
}): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const raw = JSON.stringify(input.payload);
  const eventHash = hashNotificationToken(
    `${input.provider}:${input.providerEventId ?? "none"}:${raw}`,
  );
  const result = await pool.query(
    `
      INSERT INTO notification_inbound_events (
        provider_account_id, endpoint_id, provider, provider_event_id,
        event_type, event_hash, payload, status, error_message, processed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
        CASE WHEN $8 IN ('processed', 'ignored', 'failed') THEN NOW() ELSE NULL END)
      ON CONFLICT (provider_account_id, event_hash) DO NOTHING
      RETURNING id
    `,
    [
      input.accountId,
      input.endpointId ?? null,
      input.provider,
      input.providerEventId ?? null,
      input.eventType,
      eventHash,
      raw,
      input.status ?? "received",
      input.errorMessage ? redactProviderSecret(input.errorMessage).slice(0, 1000) : null,
    ],
  );
  return result.rowCount === 1;
}
