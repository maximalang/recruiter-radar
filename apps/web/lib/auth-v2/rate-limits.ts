import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";

import type { AuthEnvironment } from "./config";

export type AuthRateLimitScope =
  | "global"
  | "trusted_ip_hash"
  | "email_hash"
  | "resend"
  | "challenge_verify"
  | "passkey_verify"
  | "workspace_invite";

function authRateLimitSecret(env: AuthEnvironment): string {
  const secret = (
    env.AUTH_RATE_LIMIT_SECRET
    ?? env.SESSION_SECRET
  )?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_RATE_LIMIT_SECRET must be at least 32 characters.");
  }
  return secret;
}

export function hashAuthRateLimitBoundary(
  kind: string,
  value: string,
  env: AuthEnvironment = process.env,
): string {
  if (!kind || !value) throw new Error("Auth rate-limit boundary is required.");
  return createHmac("sha256", authRateLimitSecret(env))
    .update(`auth-v2:${kind}:${value}`)
    .digest("hex");
}

export async function consumeAuthRateLimit(
  client: PoolClient,
  input: {
    scope: AuthRateLimitScope;
    keyHash: string;
    windowSeconds: number;
    limit: number;
    now: Date;
  },
): Promise<boolean> {
  if (
    !Number.isInteger(input.windowSeconds)
    || input.windowSeconds < 1
    || input.windowSeconds > 86_400
    || !Number.isInteger(input.limit)
    || input.limit < 1
    || input.limit > 100_000
    || !Number.isFinite(input.now.getTime())
  ) {
    throw new Error("Invalid auth rate-limit policy.");
  }
  const result = await client.query<{ allowed: boolean }>(
    `SELECT consume_auth_rate_limit(
       $1,
       $2,
       $3,
       $4,
       $5
     ) AS allowed`,
    [
      input.scope,
      input.keyHash,
      input.windowSeconds,
      input.limit,
      input.now,
    ],
  );
  return result.rows[0]?.allowed === true;
}
