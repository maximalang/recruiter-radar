import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import {
  buildAccountLoginUrl,
  type AccountIdentity,
} from "../account-auth";
import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logWarn } from "../runtime";
import { normalizeAuthEmail, sanitizeAuthReturnTo } from "./security";

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
    const sent = await sendEmail({
      to: email.canonical,
      subject: "Вход в Recruiter Radar",
      text: [
        `Подтвердите вход: ${verifyUrl}`,
        "",
        `Ссылка действует ${LOGIN_TTL_MINUTES} минут.`,
        "Если вы не запрашивали вход, просто проигнорируйте письмо.",
      ].join("\n"),
      html: [
        '<div style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.6">',
        "<h2>Вход в Recruiter Radar</h2>",
        "<p>Подтвердите рабочий email, чтобы войти или создать аккаунт.</p>",
        `<p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#142d63;color:#fff;text-decoration:none;font-weight:700">Подтвердить вход</a></p>`,
        `<p style="color:#667085">Ссылка действует ${LOGIN_TTL_MINUTES} минут. Если вы не запрашивали вход, проигнорируйте письмо.</p>`,
        "</div>",
      ].join(""),
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
}): Promise<AuthV2LoginConsumeResult | null> {
  const token = input.token.trim();
  if (!TOKEN_PATTERN.test(token)) return null;

  const sessionToken = randomBytes(32).toString("hex");
  const verificationKeyHash = hashBoundary(
    "challenge-verify",
    input.clientAddress || "unknown",
  );
  let client: PoolClient | null = null;

  try {
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
       FROM consume_auth_login_challenge($1, $2, $3)`,
      [
        hashToken(token),
        hashToken(sessionToken),
        verificationKeyHash,
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
