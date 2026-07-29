import { createHash, createHmac, randomBytes } from "crypto";
import type { PoolClient } from "pg";

import { getClient, getPool } from "./db-pool";
import { sendEmail } from "./email/transport";
import { logError, logEvent, logWarn } from "./runtime";
import { renderAuthEmail } from "./auth-v2/email-templates";
import { maskAuthEmail } from "./auth-v2/security";

const ACCOUNT_PATHS = ["/dashboard", "/checkout", "/settings", "/profile", "/leads", "/review"];
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const LOGIN_TTL_MINUTES = 15;

export type AccountIdentity = {
  id: string;
  email: string;
  fullName: string | null;
  emailVerifiedAt: Date | null;
};

export function normalizeAccountEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || /[\r\n,;]/.test(email)) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email)) {
    return null;
  }
  return email;
}

export function sanitizeAccountReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  try {
    const parsed = new URL(value, "https://account.local");
    if (parsed.origin !== "https://account.local") return "/dashboard";
    const allowed = ACCOUNT_PATHS.some((path) => parsed.pathname === path || parsed.pathname.startsWith(`${path}/`));
    return allowed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

function authSecret(): string {
  const secret = (process.env.AUTH_RATE_LIMIT_SECRET ?? process.env.SESSION_SECRET)?.trim();
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  return secret;
}

export function hashLoginSource(value: string): string {
  return createHmac("sha256", authSecret()).update(`login-source:${value}`).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getCanonicalAccountOrigin(): string {
  const raw = (
    process.env.AUTH_SITE_URL
    ?? process.env.PAYMENTS_SITE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.RR_APP_BASE_URL
  )?.trim();
  const fallback = process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
  if (!raw && !fallback) throw new Error("AUTH_SITE_URL is required in production.");
  const url = new URL(raw ?? fallback!);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || (url.protocol !== "https:" && !local)) {
    throw new Error("AUTH_SITE_URL must be a canonical HTTPS origin.");
  }
  return url.origin;
}

export function buildAccountLoginUrl(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid account login token.");
  const verifyUrl = new URL("/auth/verify", getCanonicalAccountOrigin());
  verifyUrl.hash = token;
  return verifyUrl.toString();
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export type LoginRequestResult = { ok: true } | { ok: false; error: string };

export async function requestAccountLogin(input: {
  email: unknown;
  returnTo?: unknown;
  sourceKey: string;
}): Promise<LoginRequestResult> {
  const email = normalizeAccountEmail(input.email);
  if (!email) return { ok: false, error: "Укажите один корректный email." };

  const returnTo = sanitizeAccountReturnTo(input.returnTo);
  const sourceHash = hashLoginSource(input.sourceKey || "unknown");
  const client = await getClient();
  if (!client) {
    logWarn("account.login_unavailable", { reason: "database_not_configured" });
    return { ok: true };
  }

  let token: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["account-login-global"]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`account-login-source:${sourceHash}`]);
    const rate = await client.query<{ global_count: string; source_count: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM account_login_challenges WHERE created_at > NOW() - INTERVAL '1 minute') AS global_count,
         (SELECT COUNT(*)::text FROM account_login_challenges WHERE request_key_hash = $1 AND created_at > NOW() - INTERVAL '15 minutes') AS source_count`,
      [sourceHash],
    );
    if (Number(rate.rows[0]?.global_count ?? 0) >= 100 || Number(rate.rows[0]?.source_count ?? 0) >= 10) {
      await client.query("COMMIT");
      logWarn("account.login_rate_limited", { source: sourceHash.slice(0, 10) });
      return { ok: true };
    }

    const user = await client.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (LOWER(email)) DO UPDATE SET email = users.email
       RETURNING id::text AS id`,
      [email],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("Account could not be resolved.");

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`account-login-user:${userId}`]);
    const perUser = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM account_login_challenges
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [userId],
    );
    if (Number(perUser.rows[0]?.count ?? 0) >= 3) {
      await client.query("COMMIT");
      return { ok: true };
    }

    token = randomBytes(32).toString("hex");
    await client.query(
      `INSERT INTO account_login_challenges
         (user_id, token_hash, request_key_hash, return_to, expires_at, send_status)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '15 minutes', 'pending')`,
      [userId, hashToken(token), sourceHash, returnTo],
    );
    await client.query(
      `DELETE FROM account_login_challenges
       WHERE expires_at < NOW() - INTERVAL '1 day' OR consumed_at < NOW() - INTERVAL '1 day'`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    logError("account.login_request_failed", error);
    return { ok: true };
  } finally {
    client.release();
  }

  if (!token) return { ok: true };
  try {
    const verifyUrl = buildAccountLoginUrl(token);
    const message = renderAuthEmail({
      template: "login_signup",
      actionUrl: verifyUrl,
      expiresInMinutes: LOGIN_TTL_MINUTES,
    });
    const sent = await sendEmail({
      ...message,
      to: email,
    });
    await getPool()?.query(
      "UPDATE account_login_challenges SET send_status = $2 WHERE token_hash = $1",
      [hashToken(token), sent.ok ? "sent" : "failed"],
    );
    if (!sent.ok) logWarn("account.login_email_not_sent", { reason: sent.reason });
  } catch (error) {
    logError("account.login_email_failed", error);
  }
  return { ok: true };
}

export async function isLoginChallengeActive(token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const pool = getPool();
  if (!pool) return false;
  const result = await pool.query(
    `SELECT 1 FROM account_login_challenges
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [hashToken(token)],
  );
  return result.rowCount === 1;
}

export async function readLoginChallengePreview(
  token: string,
): Promise<{ maskedEmail: string; userId: string } | null> {
  const state = await readLoginChallengeState(token);
  return state.status === "active"
    ? { maskedEmail: state.maskedEmail, userId: state.userId }
    : null;
}

export type LoginChallengeState =
  | { status: "active"; maskedEmail: string; userId: string }
  | { status: "expired" | "used"; userId: string }
  | { status: "invalid"; userId: null };

export async function readLoginChallengeState(
  token: string,
  now = new Date(),
): Promise<LoginChallengeState> {
  if (!TOKEN_PATTERN.test(token) || !Number.isFinite(now.getTime())) {
    return { status: "invalid", userId: null };
  }
  const pool = getPool();
  if (!pool) return { status: "invalid", userId: null };
  const result = await pool.query<{
    email: string;
    userId: string;
    expiresAt: Date;
    consumedAt: Date | null;
  }>(
    `SELECT
       account.email,
       account.id::TEXT AS "userId",
       challenge.expires_at AS "expiresAt",
       challenge.consumed_at AS "consumedAt"
     FROM account_login_challenges AS challenge
     JOIN users AS account ON account.id = challenge.user_id
     WHERE challenge.token_hash = $1
     LIMIT 1`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return { status: "invalid", userId: null };
  if (row.consumedAt) return { status: "used", userId: row.userId };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { status: "expired", userId: row.userId };
  }
  return {
    status: "active",
    maskedEmail: maskAuthEmail(row.email),
    userId: row.userId,
  };
}

export async function consumeAccountLogin(token: string): Promise<{ account: AccountIdentity; returnTo: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const client = await getClient();
  if (!client) return null;
  try {
    await client.query("BEGIN");
    const challenge = await client.query<{ user_id: string; return_to: string }>(
      `UPDATE account_login_challenges SET consumed_at = NOW()
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING user_id::text AS user_id, return_to`,
      [hashToken(token)],
    );
    const row = challenge.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    const account = await client.query<AccountIdentity>(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
       WHERE id = $1
       RETURNING id::text AS id, email, full_name AS "fullName", email_verified_at AS "emailVerifiedAt"`,
      [row.user_id],
    );
    await client.query("COMMIT");
    if (!account.rows[0]) return null;
    logEvent("account.login_confirmed", { userId: row.user_id });
    return { account: account.rows[0], returnTo: sanitizeAccountReturnTo(row.return_to) };
  } catch (error) {
    await rollbackQuietly(client);
    logError("account.login_confirmation_failed", error);
    return null;
  } finally {
    client.release();
  }
}

export async function getAccountById(ownerId: string | null): Promise<AccountIdentity | null> {
  if (!ownerId || !/^[1-9]\d*$/.test(ownerId)) return null;
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query<AccountIdentity>(
    `SELECT id::text AS id, email, full_name AS "fullName", email_verified_at AS "emailVerifiedAt"
     FROM users WHERE id = $1 LIMIT 1`,
    [ownerId],
  );
  return result.rows[0] ?? null;
}
