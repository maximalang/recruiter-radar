import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import {
  buildAccountLoginUrl,
  type AccountIdentity,
} from "../account-auth";
import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logWarn } from "../runtime";
import { renderAuthEmail } from "./email-templates";
import {
  getAuthV2Flags,
  isAuthPlatformV2EnabledForUser,
} from "./config";
import {
  maskAuthEmail,
  normalizeAuthEmail,
  sanitizeAuthReturnTo,
} from "./security";
import { fingerprintLegacyOwnerSession } from "./legacy-session";

const LOGIN_TTL_MINUTES = 15;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type AuthV2LoginRequestResult =
  | { ok: true }
  | { ok: false; error: string };

export type AuthV2LoginConsumeResult = {
  account: AccountIdentity;
  returnTo: string;
  session: {
    id: string;
    token: string;
  };
};

export type AuthV2LoginChallengeState =
  | {
    status: "active";
    maskedEmail: string;
    userId: string | null;
  }
  | {
    status: "expired" | "used" | "invalid";
    userId: string | null;
  };

function authRateLimitSecret(): string {
  const secret = (
    process.env.AUTH_RATE_LIMIT_SECRET
    ?? process.env.SESSION_SECRET
  )?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_RATE_LIMIT_SECRET must be at least 32 characters.");
  }
  return secret;
}

function hashBoundary(kind: string, value: string): string {
  return createHmac("sha256", authRateLimitSecret())
    .update(`auth-v2:${kind}:${value}`)
    .digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export async function shouldRequestAuthV2Login(emailInput: unknown): Promise<boolean> {
  if (getAuthV2Flags().platform) return true;
  const email = normalizeAuthEmail(emailInput);
  if (!email) return false;
  const pool = getPool();
  if (!pool) return false;
  try {
    const result = await pool.query<{ userId: string }>(
      `SELECT id::TEXT AS "userId"
       FROM users
       WHERE status = 'active'
         AND email_verified_at IS NOT NULL
         AND (
           email_normalized = $1
           OR (email_normalized IS NULL AND LOWER(email) = LOWER($1))
         )
       ORDER BY (email_normalized IS NOT NULL) DESC, id
       LIMIT 1`,
      [email.normalized],
    );
    return isAuthPlatformV2EnabledForUser(result.rows[0]?.userId);
  } catch (error) {
    logError("auth_v2.login_eligibility_failed", error);
    return false;
  }
}

export async function requestAuthV2Login(input: {
  email: unknown;
  returnTo?: unknown;
  clientAddress: string;
  userAgent: string | null;
}): Promise<AuthV2LoginRequestResult> {
  const email = normalizeAuthEmail(input.email);
  if (!email) {
    return { ok: false, error: "Укажите один корректный email." };
  }

  const returnTo = sanitizeAuthReturnTo(input.returnTo);
  let client: PoolClient | null = null;
  let token: string | null = null;
  let challengeId: string | null = null;
  try {
    const globalHash = hashBoundary("global", "login");
    const emailHash = hashBoundary("email", email.normalized);
    const requestIpHash = input.clientAddress === "unknown"
      ? null
      : hashBoundary("ip", input.clientAddress);
    const userAgentHash = input.userAgent
      ? hashBoundary("user-agent", input.userAgent.slice(0, 512))
      : null;

    client = await getClient();
    if (!client) {
      logWarn("auth_v2.login_unavailable", { reasonCode: "database_not_configured" });
      return { ok: true };
    }

    token = randomBytes(32).toString("hex");
    await client.query("BEGIN");
    const issued = await client.query<{
      issued: boolean;
      challengeId: string | null;
    }>(
      `SELECT
         issued,
         challenge_id::TEXT AS "challengeId"
       FROM issue_auth_login_challenge($1, $2, $3, $4, $5, $6, $7)`,
      [
        email.normalized,
        hashToken(token),
        returnTo,
        globalHash,
        emailHash,
        requestIpHash,
        userAgentHash,
      ],
    );
    if (!issued.rows[0]?.issued) {
      await client.query("COMMIT");
      return { ok: true };
    }
    challengeId = issued.rows[0].challengeId;
    if (!challengeId) throw new Error("Challenge issuance returned no identifier.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await rollbackQuietly(client);
    logError("auth_v2.login_request_failed", error);
    return { ok: true };
  } finally {
    client?.release();
  }

  if (!token || !challengeId) return { ok: true };
  let sendStatus: "sent" | "failed" = "failed";
  try {
    const verifyUrl = buildAccountLoginUrl(token);
    const message = renderAuthEmail({
      template: "login_signup",
      actionUrl: verifyUrl,
      expiresInMinutes: LOGIN_TTL_MINUTES,
    });
    const sent = await sendEmail({
      ...message,
      to: email.canonical,
    });
    sendStatus = sent.ok ? "sent" : "failed";
    if (!sent.ok) {
      logWarn("auth_v2.login_email_not_sent", { reasonCode: sent.reason });
    }
  } catch (error) {
    logError("auth_v2.login_email_failed", error);
  }

  try {
    await getPool()?.query(
      `UPDATE auth_challenges
       SET send_status = $1
       WHERE id = $2`,
      [sendStatus, challengeId],
    );
  } catch (error) {
    logError("auth_v2.login_delivery_status_failed", error);
  }

  return { ok: true };
}

export async function consumeAuthV2Login(input: {
  token: string;
  clientAddress: string;
  legacyToken?: string | null;
}): Promise<AuthV2LoginConsumeResult | null> {
  const token = input.token.trim();
  if (!TOKEN_PATTERN.test(token)) return null;

  let sessionToken: string | null = null;
  let client: PoolClient | null = null;

  try {
    sessionToken = randomBytes(32).toString("hex");
    const globalVerificationKeyHash = hashBoundary(
      "challenge-verify-global",
      "login",
    );
    const verificationIpKeyHash = input.clientAddress === "unknown"
      ? null
      : hashBoundary("challenge-verify-ip", input.clientAddress);
    const legacyFingerprintHash = input.legacyToken
      ? fingerprintLegacyOwnerSession(input.legacyToken)
      : null;
    client = await getClient();
    if (!client) return null;
    await client.query("BEGIN");
    const consumed = await client.query<{
      consumed: boolean;
      userId: string | null;
      sessionId: string | null;
      email: string | null;
      fullName: string | null;
      emailVerifiedAt: Date | null;
      returnTo: string | null;
    }>(
      `SELECT
         consumed,
         user_id::TEXT AS "userId",
         session_id::TEXT AS "sessionId",
         email,
         full_name AS "fullName",
         email_verified_at AS "emailVerifiedAt",
         return_to AS "returnTo"
       FROM consume_auth_login_challenge($1, $2, $3, $4, $5)`,
      [
        hashToken(token),
        hashToken(sessionToken),
        globalVerificationKeyHash,
        verificationIpKeyHash,
        legacyFingerprintHash,
      ],
    );
    const row = consumed.rows[0];
    if (
      !row?.consumed
      || !row.userId
      || !row.sessionId
      || !row.email
      || !row.emailVerifiedAt
    ) {
      await client.query("COMMIT");
      return null;
    }

    await client.query("COMMIT");
    return {
      account: {
        id: row.userId,
        email: row.email,
        fullName: row.fullName,
        emailVerifiedAt: row.emailVerifiedAt,
      },
      returnTo: sanitizeAuthReturnTo(row.returnTo),
      session: {
        id: row.sessionId,
        token: sessionToken,
      },
    };
  } catch (error) {
    if (client) await rollbackQuietly(client);
    logError("auth_v2.login_confirmation_failed", error);
    return null;
  } finally {
    client?.release();
  }
}

export async function isAuthV2LoginChallengeActive(
  token: string,
): Promise<boolean> {
  const normalized = token.trim();
  if (!TOKEN_PATTERN.test(normalized)) return false;
  const pool = getPool();
  if (!pool) return false;

  try {
    const result = await pool.query(
      `SELECT 1
       FROM auth_challenges
       WHERE token_hash = $1
         AND purpose IN ('login', 'signup')
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [hashToken(normalized)],
    );
    return result.rowCount === 1;
  } catch (error) {
    logError("auth_v2.login_challenge_read_failed", error);
    return false;
  }
}

export async function readAuthV2LoginChallengePreview(
  token: string,
): Promise<{ maskedEmail: string; userId: string | null } | null> {
  const state = await readAuthV2LoginChallengeState(token);
  return state.status === "active"
    ? { maskedEmail: state.maskedEmail, userId: state.userId }
    : null;
}

export async function readAuthV2LoginChallengeState(
  token: string,
  now = new Date(),
): Promise<AuthV2LoginChallengeState> {
  const normalized = token.trim();
  if (!TOKEN_PATTERN.test(normalized) || !Number.isFinite(now.getTime())) {
    return { status: "invalid", userId: null };
  }
  const pool = getPool();
  if (!pool) return { status: "invalid", userId: null };
  try {
    const result = await pool.query<{
      email: string;
      userId: string | null;
      expiresAt: Date;
      consumedAt: Date | null;
      invalidatedAt: Date | null;
    }>(
      `SELECT
         email_normalized AS email,
         user_id::TEXT AS "userId",
         expires_at AS "expiresAt",
         consumed_at AS "consumedAt",
         invalidated_at AS "invalidatedAt"
       FROM auth_challenges
       WHERE token_hash = $1
         AND purpose IN ('login', 'signup')
       LIMIT 1`,
      [hashToken(normalized)],
    );
    const row = result.rows[0];
    if (!row) return { status: "invalid", userId: null };
    if (row.consumedAt || row.invalidatedAt) {
      return { status: "used", userId: row.userId };
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      return { status: "expired", userId: row.userId };
    }
    return {
      status: "active",
      maskedEmail: maskAuthEmail(row.email),
      userId: row.userId,
    };
  } catch (error) {
    logError("auth_v2.login_challenge_preview_failed", error);
    return { status: "invalid", userId: null };
  }
}
