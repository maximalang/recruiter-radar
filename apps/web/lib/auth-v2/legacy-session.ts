import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getPool } from "../db-pool";
import { logError } from "../runtime";
import {
  type AuthEnvironment,
  isAuthPlatformV2EnabledForUser,
  isLegacySessionMigrationWindowOpen,
} from "./config";
import {
  hashAuthSessionToken,
  type AuthSession,
  type AuthSessionWithToken,
} from "./sessions";

const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

type LegacyExchangeRow = {
  id: string;
  userId: string;
  workspaceId: string | null;
  authMethod: "legacy_exchange";
  deviceLabel: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date;
  lastAuthenticatedAt: Date | null;
  rotationDue: boolean;
};

function validUserId(value: string): boolean {
  if (!POSITIVE_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

function signingSecret(env: AuthEnvironment): string | null {
  const secret = env.SESSION_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

function migrationSecret(env: AuthEnvironment): string | null {
  const secret = (
    env.AUTH_LEGACY_MIGRATION_SECRET
    ?? env.SESSION_SECRET
  )?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function decodeLegacyOwnerSession(
  token: string,
  env: AuthEnvironment = process.env,
): string | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;

    const userId = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    if (!validUserId(userId) || !HASH_PATTERN.test(mac)) return null;

    const secret = signingSecret(env);
    if (!secret) return null;
    const expected = createHmac("sha256", secret)
      .update(`session:${userId}`)
      .digest("hex");
    return timingSafeEqual(
      Buffer.from(mac, "hex"),
      Buffer.from(expected, "hex"),
    )
      ? userId
      : null;
  } catch {
    return null;
  }
}

function legacyFingerprint(
  token: string,
  env: AuthEnvironment,
): string | null {
  const secret = migrationSecret(env);
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`auth-v2:legacy-session:${token}`)
    .digest("hex");
}

function validOptionalHash(value: string | null | undefined): boolean {
  return value === null || value === undefined || HASH_PATTERN.test(value);
}

function mapSession(row: LegacyExchangeRow): AuthSession {
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    authMethod: row.authMethod,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    rotatedAt: row.rotatedAt,
    lastAuthenticatedAt: row.lastAuthenticatedAt,
    rotationDue: row.rotationDue,
  };
}

export async function exchangeLegacyOwnerSession(input: {
  legacyToken: string;
  requestIpHash?: string | null;
  userAgentHash?: string | null;
  env?: AuthEnvironment;
  now?: Date;
}): Promise<AuthSessionWithToken | null> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  if (
    !isLegacySessionMigrationWindowOpen(env, now)
    || !validOptionalHash(input.requestIpHash)
    || !validOptionalHash(input.userAgentHash)
  ) {
    return null;
  }

  const userId = decodeLegacyOwnerSession(input.legacyToken, env);
  const fingerprint = legacyFingerprint(input.legacyToken, env);
  if (
    !userId
    || !fingerprint
    || !isAuthPlatformV2EnabledForUser(userId, env)
  ) {
    return null;
  }

  const pool = getPool();
  if (!pool) return null;
  const sessionToken = randomBytes(32).toString("hex");

  try {
    const result = await pool.query<LegacyExchangeRow>(
      `WITH created AS (
         INSERT INTO auth_sessions (
           user_id,
           workspace_id,
           token_hash,
           auth_method,
           request_ip_hash,
           user_agent_hash,
           legacy_fingerprint_hash,
           created_at,
           last_seen_at,
           idle_expires_at,
           absolute_expires_at,
           rotated_at
         )
         SELECT
           account.id,
           NULL,
           $2,
           'legacy_exchange',
           $4,
           $5,
           $3,
           $6::TIMESTAMPTZ,
           $6::TIMESTAMPTZ,
           $6::TIMESTAMPTZ + INTERVAL '14 days',
           $6::TIMESTAMPTZ + INTERVAL '30 days',
           $6::TIMESTAMPTZ
         FROM users AS account
         WHERE account.id = $1
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM auth_security_events AS prior_exchange
             WHERE prior_exchange.event_type = 'legacy_session_migrated'
               AND prior_exchange.subject_hash = $3
           )
         ON CONFLICT (legacy_fingerprint_hash)
           WHERE legacy_fingerprint_hash IS NOT NULL
           DO NOTHING
         RETURNING *
       ),
       migration_recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           session_id,
           subject_hash,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'legacy_session_migrated',
           created.user_id,
           created.id,
           created.legacy_fingerprint_hash,
           created.request_ip_hash,
           created.user_agent_hash,
           JSONB_BUILD_OBJECT(
             'auth_version',
             'v2',
             'method',
             'legacy_exchange',
             'source',
             'legacy'
           ),
           $6::TIMESTAMPTZ
         FROM created
         ON CONFLICT (subject_hash)
           WHERE event_type = 'legacy_session_migrated'
             AND subject_hash IS NOT NULL
           DO NOTHING
         RETURNING id
       ),
       session_recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'session_created',
           created.user_id,
           created.id,
           created.request_ip_hash,
           created.user_agent_hash,
           JSONB_BUILD_OBJECT('method', 'legacy_exchange'),
           $6::TIMESTAMPTZ
         FROM created
         RETURNING id
       )
       SELECT
         created.id::TEXT AS id,
         created.user_id::TEXT AS "userId",
         created.workspace_id::TEXT AS "workspaceId",
         created.auth_method AS "authMethod",
         created.device_label AS "deviceLabel",
         created.created_at AS "createdAt",
         created.last_seen_at AS "lastSeenAt",
         created.idle_expires_at AS "idleExpiresAt",
         created.absolute_expires_at AS "absoluteExpiresAt",
         created.rotated_at AS "rotatedAt",
         created.last_authenticated_at AS "lastAuthenticatedAt",
         FALSE AS "rotationDue",
         (SELECT COUNT(*) FROM migration_recorded) AS "migrationEventCount",
         (SELECT COUNT(*) FROM session_recorded) AS "sessionEventCount"
       FROM created
       JOIN users AS account ON account.id = created.user_id
       WHERE EXISTS (SELECT 1 FROM migration_recorded)`,
      [
        userId,
        hashAuthSessionToken(sessionToken),
        fingerprint,
        input.requestIpHash ?? null,
        input.userAgentHash ?? null,
        now,
      ],
    );
    const row = result.rows[0];
    return row ? { session: mapSession(row), token: sessionToken } : null;
  } catch (error) {
    logError("auth_v2.legacy_session_exchange_failed", error);
    return null;
  }
}
