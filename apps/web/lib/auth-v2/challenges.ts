import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import {
  buildAccountLoginUrl,
  type AccountIdentity,
} from "../account-auth";
import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logEvent, logWarn } from "../runtime";
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
import { hashAuthRateLimitBoundary } from "./rate-limits";
import {
  isAuthSessionEnvironment,
  type AuthSessionEnvironment,
} from "./session-environment";

const LOGIN_TTL_MINUTES = 15;
const LOGIN_TEMPORARILY_UNAVAILABLE =
  "Вход временно недоступен. Попробуйте ещё раз немного позже.";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type AuthV2LoginRequestResult =
  | { ok: true; delivery: "sent" | "suppressed" }
  | { ok: false; error: string };

export type AuthV2LoginConsumeResult = {
  account: AccountIdentity;
  onboardingRequired: boolean;
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
           OR (
             email_normalized IS NULL
             AND split_part(email, '@', 1) = split_part($1, '@', 1)
             AND LOWER(split_part(email, '@', 2))
               = split_part($1, '@', 2)
           )
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
  logEvent("auth_v2.login_requested", {});

  const returnTo = sanitizeAuthReturnTo(input.returnTo);
  let client: PoolClient | null = null;
  let token: string | null = null;
  let challengeId: string | null = null;
  let deliveryEmail: string | null = null;
  try {
    const globalHash = hashAuthRateLimitBoundary("global", "login");
    const emailHash = hashAuthRateLimitBoundary("email", email.normalized);
    const requestIpHash = input.clientAddress === "unknown"
      ? null
      : hashAuthRateLimitBoundary("ip", input.clientAddress);
    const userAgentHash = input.userAgent
      ? hashAuthRateLimitBoundary("user-agent", input.userAgent.slice(0, 512))
      : null;

    client = await getClient();
    if (!client) {
      logWarn("auth_v2.login_unavailable", { reasonCode: "database_not_configured" });
      return { ok: false, error: LOGIN_TEMPORARILY_UNAVAILABLE };
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
      logEvent("auth_v2.login_request_suppressed", {});
      return { ok: true, delivery: "suppressed" };
    }
    challengeId = issued.rows[0].challengeId;
    if (!challengeId) throw new Error("Challenge issuance returned no identifier.");
    const delivery = await client.query<{ deliveryEmail: string }>(
      `SELECT
         COALESCE(account.email, challenge.email_normalized) AS "deliveryEmail"
       FROM auth_challenges AS challenge
       LEFT JOIN users AS account ON account.id = challenge.user_id
       WHERE challenge.id = $1
         AND challenge.purpose IN ('login', 'signup')
       LIMIT 1`,
      [challengeId],
    );
    const normalizedDelivery = normalizeAuthEmail(
      delivery.rows[0]?.deliveryEmail,
    );
    if (
      !normalizedDelivery
      || normalizedDelivery.normalized !== email.normalized
    ) {
      throw new Error("Challenge delivery identity mismatch.");
    }
    deliveryEmail = normalizedDelivery.canonical;
    await client.query("COMMIT");
  } catch (error) {
    if (client) await rollbackQuietly(client);
    logError("auth_v2.login_request_failed", error);
    return { ok: false, error: LOGIN_TEMPORARILY_UNAVAILABLE };
  } finally {
    client?.release();
  }

  if (!token || !challengeId || !deliveryEmail) return { ok: true, delivery: "suppressed" };
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
      to: deliveryEmail,
    });
    sendStatus = sent.ok ? "sent" : "failed";
    if (sent.ok) logEvent("auth_v2.login_email_sent", {});
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

  return sendStatus === "sent"
    ? { ok: true, delivery: "sent" }
    : { ok: false, error: LOGIN_TEMPORARILY_UNAVAILABLE };
}

export async function consumeAuthV2Login(input: {
  token: string;
  clientAddress: string;
  legacyToken?: string | null;
  sessionEnvironment?: AuthSessionEnvironment | null;
}): Promise<AuthV2LoginConsumeResult | null> {
  const token = input.token.trim();
  if (
    !TOKEN_PATTERN.test(token)
    || (
      input.sessionEnvironment !== null
      && input.sessionEnvironment !== undefined
      && !isAuthSessionEnvironment(input.sessionEnvironment)
    )
  ) {
    return null;
  }

  let sessionToken: string | null = null;
  let client: PoolClient | null = null;

  try {
    sessionToken = randomBytes(32).toString("hex");
    const globalVerificationKeyHash = hashAuthRateLimitBoundary(
      "challenge-verify-global",
      "login",
    );
    const verificationIpKeyHash = input.clientAddress === "unknown"
      ? null
      : hashAuthRateLimitBoundary("challenge-verify-ip", input.clientAddress);
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
      onboardingStatus: string | null;
      returnTo: string | null;
    }>(
      `SELECT
         consumed_result.consumed,
         consumed_result.user_id::TEXT AS "userId",
         consumed_result.session_id::TEXT AS "sessionId",
         consumed_result.email,
         consumed_result.full_name AS "fullName",
         consumed_result.email_verified_at AS "emailVerifiedAt",
         account.onboarding_status AS "onboardingStatus",
         consumed_result.return_to AS "returnTo"
       FROM consume_auth_login_challenge(
         $1,
         $2,
         $3,
         $4,
         $5
       ) AS consumed_result
       LEFT JOIN users AS account
         ON account.id = consumed_result.user_id`,
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

    if (input.sessionEnvironment) {
      await client.query(
        `UPDATE auth_sessions
         SET device_label = $3,
             browser_label = $4,
             environment_label = $5
         WHERE id = $1
           AND user_id = $2`,
        [
          row.sessionId,
          row.userId,
          input.sessionEnvironment.deviceLabel,
          input.sessionEnvironment.browserLabel,
          input.sessionEnvironment.environmentLabel,
        ],
      );
    }

    await client.query("COMMIT");
    logEvent("auth_v2.session_created", { onboardingRequired: row.onboardingStatus !== "completed" });
    return {
      account: {
        id: row.userId,
        email: row.email,
        fullName: row.fullName,
        emailVerifiedAt: row.emailVerifiedAt,
      },
      onboardingRequired: row.onboardingStatus !== "completed",
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
