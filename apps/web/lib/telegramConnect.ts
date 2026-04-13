import { randomBytes } from "node:crypto";

import { Pool, type PoolClient } from "pg";

import {
  CUSTOMER_CHECKOUT_COPY,
  TELEGRAM_CONNECT_RESULT_COPY
} from "./copy/customer";
import { savePilotOrderTelegramChat } from "./payments";
import { getTelegramBotUsername } from "./telegram";

type TelegramConnectTokenRow = {
  id: string;
  token: string;
  orderId: string | null;
  clientProfileId: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type TelegramConnectLinkState =
  | {
      connected: true;
      botUsername: string | null;
      connectUrl: null;
      expiresAt: null;
      error: null;
    }
  | {
      connected: false;
      botUsername: string | null;
      connectUrl: string | null;
      expiresAt: string | null;
      error: string | null;
    };

export type TelegramConnectConsumeResult = {
  status: "connected" | "invalid" | "expired" | "used" | "error";
  message: string;
  orderId: string | null;
  clientProfileId: string | null;
};

const TELEGRAM_CONNECT_TOKEN_TTL_MS = 20 * 60 * 1000;

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarTelegramConnectPool?: Pool;
};

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarTelegramConnectPool) {
    globalForPg.recruiterRadarTelegramConnectPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarTelegramConnectPool;
}

export async function getTelegramConnectLinkState(input: {
  orderId: string | number;
  clientProfileId?: string | number | null;
  connectedTelegramChatId?: string | null;
}): Promise<TelegramConnectLinkState> {
  const connectedTelegramChatId = normalizeTelegramChatId(input.connectedTelegramChatId);
  const { username, error } = await getTelegramBotUsername();

  if (connectedTelegramChatId) {
    return {
      connected: true,
      botUsername: username,
      connectUrl: null,
      expiresAt: null,
      error: null
    };
  }

  if (!username) {
    return {
      connected: false,
      botUsername: null,
      connectUrl: null,
      expiresAt: null,
      error: error ?? CUSTOMER_CHECKOUT_COPY.telegramNotConfigured
    };
  }

  const token = await findOrCreateTelegramConnectToken({
    orderId: input.orderId,
    clientProfileId: input.clientProfileId ?? null
  });

  return {
    connected: false,
    botUsername: username,
    connectUrl: `https://t.me/${username}?start=${token.token}`,
    expiresAt: token.expiresAt,
    error: null
  };
}

export async function consumeTelegramConnectToken(input: {
  token: string;
  telegramChatId: string;
}): Promise<TelegramConnectConsumeResult> {
  const normalizedToken = normalizeConnectToken(input.token);
  const telegramChatId = normalizeTelegramChatId(input.telegramChatId);

  if (!normalizedToken || !telegramChatId) {
    return buildConsumeResult("invalid");
  }

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const tokenRecord = await getTelegramConnectTokenForUpdate(client, normalizedToken);

    if (!tokenRecord) {
      await client.query("ROLLBACK");
      return buildConsumeResult("invalid");
    }

    if (tokenRecord.usedAt) {
      await client.query("ROLLBACK");
      return buildConsumeResult("used", tokenRecord);
    }

    if (new Date(tokenRecord.expiresAt).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return buildConsumeResult("expired", tokenRecord);
    }

    if (!tokenRecord.orderId) {
      await client.query("ROLLBACK");
      return buildConsumeResult("invalid", tokenRecord);
    }

    try {
      await savePilotOrderTelegramChat({
        orderId: tokenRecord.orderId,
        telegramChatId,
        expectedClientProfileId: tokenRecord.clientProfileId,
        db: client
      });
    } catch {
      await client.query("ROLLBACK");
      return buildConsumeResult("error", tokenRecord);
    }

    await client.query(
      `
        UPDATE telegram_connect_tokens
        SET used_at = NOW()
        WHERE id = $1
      `,
      [normalizeConnectTokenId(tokenRecord.id)]
    );
    await client.query("COMMIT");

    return buildConsumeResult("connected", tokenRecord);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findOrCreateTelegramConnectToken(input: {
  orderId: string | number;
  clientProfileId?: string | number | null;
}): Promise<TelegramConnectTokenRow> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const orderId = normalizeOrderId(input.orderId);
  const clientProfileId = normalizeOptionalForeignId(input.clientProfileId);
  const existingToken = await pool.query<TelegramConnectTokenRow>(
    `
      SELECT
        id::TEXT AS id,
        token,
        order_id::TEXT AS "orderId",
        client_profile_id::TEXT AS "clientProfileId",
        expires_at::TEXT AS "expiresAt",
        used_at::TEXT AS "usedAt",
        created_at::TEXT AS "createdAt"
      FROM telegram_connect_tokens
      WHERE order_id = $1
        AND (
          ($2::BIGINT IS NULL AND client_profile_id IS NULL)
          OR client_profile_id = $2
        )
        AND used_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [orderId, clientProfileId]
  );

  if (existingToken.rowCount === 1) {
    return existingToken.rows[0];
  }

  const token = createConnectToken();
  const expiresAt = new Date(Date.now() + TELEGRAM_CONNECT_TOKEN_TTL_MS).toISOString();
  const createdToken = await pool.query<TelegramConnectTokenRow>(
    `
      INSERT INTO telegram_connect_tokens (
        token,
        order_id,
        client_profile_id,
        expires_at
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id::TEXT AS id,
        token,
        order_id::TEXT AS "orderId",
        client_profile_id::TEXT AS "clientProfileId",
        expires_at::TEXT AS "expiresAt",
        used_at::TEXT AS "usedAt",
        created_at::TEXT AS "createdAt"
    `,
    [token, orderId, clientProfileId, expiresAt]
  );

  if (createdToken.rowCount !== 1) {
    throw new Error("Failed to create Telegram connect token.");
  }

  return createdToken.rows[0];
}

async function getTelegramConnectTokenForUpdate(
  client: PoolClient,
  token: string
): Promise<TelegramConnectTokenRow | null> {
  const result = await client.query<TelegramConnectTokenRow>(
    `
      SELECT
        id::TEXT AS id,
        token,
        order_id::TEXT AS "orderId",
        client_profile_id::TEXT AS "clientProfileId",
        expires_at::TEXT AS "expiresAt",
        used_at::TEXT AS "usedAt",
        created_at::TEXT AS "createdAt"
      FROM telegram_connect_tokens
      WHERE token = $1
      FOR UPDATE
    `,
    [token]
  );

  return result.rowCount === 1 ? result.rows[0] : null;
}

function buildConsumeResult(
  status: TelegramConnectConsumeResult["status"],
  tokenRecord?: Pick<TelegramConnectTokenRow, "orderId" | "clientProfileId"> | null
): TelegramConnectConsumeResult {
  return {
    status,
    message:
      status === "connected"
        ? TELEGRAM_CONNECT_RESULT_COPY.connected
        : status === "expired"
          ? TELEGRAM_CONNECT_RESULT_COPY.expired
          : status === "used"
            ? TELEGRAM_CONNECT_RESULT_COPY.used
            : status === "error"
              ? TELEGRAM_CONNECT_RESULT_COPY.failed
              : TELEGRAM_CONNECT_RESULT_COPY.inactive,
    orderId: tokenRecord?.orderId ?? null,
    clientProfileId: tokenRecord?.clientProfileId ?? null
  };
}

function createConnectToken(): string {
  return randomBytes(18).toString("base64url");
}

function normalizeConnectToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeTelegramChatId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!/^-?\d+$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function normalizeOrderId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.invalidOrderId);
  }

  return normalizedValue;
}

function normalizeOptionalForeignId(value: string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.invalidLinkedId);
  }

  return normalizedValue;
}

function normalizeConnectTokenId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.invalidTelegramTokenId);
  }

  return normalizedValue;
}
