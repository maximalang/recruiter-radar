import { createHash, randomBytes } from "node:crypto";

import { getPool } from "../db-pool";
import { logError } from "../runtime";
import {
  type AuthEnvironment,
  getAuthWorkspacesV2RolloutPolicy,
  isAuthWorkspacesV2EnabledForUser,
} from "./config";
import {
  isAuthSessionEnvironment,
  type AuthSessionEnvironment,
} from "./session-environment";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const RECENT_AUTH_SECONDS = 10 * 60;
const SESSION_TOUCH_INTERVAL_MINUTES = 5;

export type AuthSessionMethod =
  | "magic_link"
  | "passkey"
  | "legacy_exchange";

export type AuthSession = {
  id: string;
  userId: string;
  workspaceId: string | null;
  authMethod: AuthSessionMethod;
  deviceLabel: string | null;
  browserLabel: string | null;
  environmentLabel: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date;
  lastAuthenticatedAt: Date | null;
  rotationDue: boolean;
};

export type AuthSessionWithToken = {
  session: AuthSession;
  token: string;
};

export class AuthSessionRequiredError extends Error {
  constructor() {
    super("Active authentication session required.");
    this.name = "AuthSessionRequiredError";
  }
}

export class RecentAuthenticationRequiredError extends Error {
  constructor() {
    super("Recent authentication required.");
    this.name = "RecentAuthenticationRequiredError";
  }
}

export type AuthSessionSummary = {
  id: string;
  authMethod: AuthSessionMethod;
  deviceLabel: string | null;
  browserLabel: string | null;
  environmentLabel: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  current: boolean;
};

type SessionRow = {
  id: string;
  userId: string;
  workspaceId: string | null;
  authMethod: AuthSessionMethod;
  deviceLabel: string | null;
  browserLabel: string | null;
  environmentLabel: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  rotatedAt: Date;
  lastAuthenticatedAt: Date | null;
  rotationDue: boolean;
};

type RevokeReason =
  | "logout"
  | "logout_all"
  | "security_action"
  | "workspace_access_lost"
  | "account_unavailable";

function validId(value: string): boolean {
  if (!POSITIVE_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

function validHash(value: string | null | undefined): boolean {
  return value === null || value === undefined || HASH_PATTERN.test(value);
}

function validDeviceLabel(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return (
    value.trim() === value
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= 120
    && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function hashAuthSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

function mapSession(
  row: SessionRow | undefined,
  env: AuthEnvironment = process.env,
): AuthSession | null {
  if (
    !row
    || !validId(row.id)
    || !validId(row.userId)
    || (row.workspaceId !== null && !validId(row.workspaceId))
    || (
      row.workspaceId === null
      && isAuthWorkspacesV2EnabledForUser(row.userId, env)
    )
  ) {
    return null;
  }
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    authMethod: row.authMethod,
    deviceLabel: row.deviceLabel,
    browserLabel: row.browserLabel ?? null,
    environmentLabel: row.environmentLabel ?? null,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    rotatedAt: row.rotatedAt,
    lastAuthenticatedAt: row.lastAuthenticatedAt,
    rotationDue: row.rotationDue,
  };
}

export async function createAuthSession(
  input: {
    userId: string;
    authMethod: AuthSessionMethod;
    requestIpHash?: string | null;
    userAgentHash?: string | null;
    deviceLabel?: string | null;
    sessionEnvironment?: AuthSessionEnvironment | null;
  },
  now = new Date(),
): Promise<AuthSessionWithToken | null> {
  if (
    !validId(input.userId)
    || !validHash(input.requestIpHash)
    || !validHash(input.userAgentHash)
    || !validDeviceLabel(input.deviceLabel)
    || (
      input.sessionEnvironment !== null
      && input.sessionEnvironment !== undefined
      && !isAuthSessionEnvironment(input.sessionEnvironment)
    )
  ) {
    return null;
  }

  const pool = getPool();
  if (!pool) return null;
  const token = createOpaqueToken();
  try {
    const result = await pool.query<SessionRow>(
      `WITH created AS (
         INSERT INTO auth_sessions (
           user_id,
           workspace_id,
           token_hash,
           auth_method,
           request_ip_hash,
           user_agent_hash,
           device_label,
           browser_label,
           environment_label,
           created_at,
           last_seen_at,
           idle_expires_at,
           absolute_expires_at,
           rotated_at,
           last_authenticated_at
         )
         SELECT
           account.id,
           NULL,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9::TIMESTAMPTZ,
           $9::TIMESTAMPTZ,
           $9::TIMESTAMPTZ + INTERVAL '14 days',
           $9::TIMESTAMPTZ + INTERVAL '30 days',
           $9::TIMESTAMPTZ,
           CASE
             WHEN $3::TEXT = 'legacy_exchange' THEN NULL
             ELSE $9::TIMESTAMPTZ
           END
         FROM users AS account
         WHERE account.id = $1
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
         RETURNING *
       ),
       recorded AS (
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
           JSONB_BUILD_OBJECT('method', created.auth_method),
           $9::TIMESTAMPTZ
         FROM created
         RETURNING id
       )
       SELECT
         created.id::TEXT AS id,
         created.user_id::TEXT AS "userId",
         created.workspace_id::TEXT AS "workspaceId",
         created.auth_method AS "authMethod",
         created.device_label AS "deviceLabel",
         created.browser_label AS "browserLabel",
         created.environment_label AS "environmentLabel",
         created.created_at AS "createdAt",
         created.last_seen_at AS "lastSeenAt",
         created.idle_expires_at AS "idleExpiresAt",
         created.absolute_expires_at AS "absoluteExpiresAt",
         created.rotated_at AS "rotatedAt",
         created.last_authenticated_at AS "lastAuthenticatedAt",
         FALSE AS "rotationDue",
         (SELECT COUNT(*) FROM recorded) AS "recordedCount"
       FROM created
       JOIN users AS account ON account.id = created.user_id`,
      [
        input.userId,
        hashAuthSessionToken(token),
        input.authMethod,
        input.requestIpHash ?? null,
        input.userAgentHash ?? null,
        input.sessionEnvironment?.deviceLabel ?? input.deviceLabel ?? null,
        input.sessionEnvironment?.browserLabel ?? null,
        input.sessionEnvironment?.environmentLabel ?? null,
        now,
      ],
    );
    const session = mapSession(result.rows[0]);
    return session ? { session, token } : null;
  } catch (error) {
    logError("auth_v2.session_create_failed", error);
    return null;
  }
}

export async function readAuthSession(
  token: string,
  now = new Date(),
  options: { env?: AuthEnvironment } = {},
): Promise<AuthSession | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const pool = getPool();
  if (!pool) return null;

  const env = options.env ?? process.env;
  const rollout = getAuthWorkspacesV2RolloutPolicy(env);
  try {
    const result = await pool.query<SessionRow>(
      `WITH invalidated AS (
         UPDATE auth_sessions AS session
         SET
           revoked_at = $2,
           revoke_reason = CASE
             WHEN session.absolute_expires_at <= $2 THEN 'absolute_expired'
             WHEN session.idle_expires_at <= $2 THEN 'idle_expired'
             WHEN (
               $3::BOOLEAN
               AND ($4::BOOLEAN OR session.user_id = ANY($5::BIGINT[]))
               AND (
                 session.workspace_id IS NULL
                 OR NOT EXISTS (
                   SELECT 1
                   FROM workspace_members AS membership
                   JOIN workspaces AS workspace
                     ON workspace.id = membership.workspace_id
                   WHERE membership.workspace_id = session.workspace_id
                     AND membership.user_id = session.user_id
                     AND membership.status = 'active'
                     AND workspace.status = 'active'
                     AND workspace.deleted_at IS NULL
                 )
               )
             )
               THEN 'workspace_access_lost'
             ELSE 'account_unavailable'
           END
         WHERE (
             session.token_hash = $1
             OR (
               session.previous_token_hash = $1
               AND session.previous_token_valid_until > $2
               AND session.previous_token_authorizes
             )
           )
           AND session.revoked_at IS NULL
           AND (
             session.absolute_expires_at <= $2
             OR session.idle_expires_at <= $2
             OR NOT EXISTS (
               SELECT 1
               FROM users AS account
               WHERE account.id = session.user_id
                 AND account.status = 'active'
                 AND account.email_verified_at IS NOT NULL
             )
             OR (
               $3::BOOLEAN
               AND ($4::BOOLEAN OR session.user_id = ANY($5::BIGINT[]))
               AND (
                 session.workspace_id IS NULL
                 OR NOT EXISTS (
                   SELECT 1
                   FROM workspace_members AS membership
                   JOIN workspaces AS workspace
                     ON workspace.id = membership.workspace_id
                   WHERE membership.workspace_id = session.workspace_id
                     AND membership.user_id = session.user_id
                     AND membership.status = 'active'
                     AND workspace.status = 'active'
                     AND workspace.deleted_at IS NULL
                 )
               )
             )
           )
         RETURNING session.*
       ),
       invalidated_event AS (
         INSERT INTO auth_security_events (
           event_type,
           outcome,
           user_id,
           workspace_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'session_revoked',
           'success',
           invalidated.user_id,
           invalidated.workspace_id,
           invalidated.id,
           invalidated.request_ip_hash,
           invalidated.user_agent_hash,
           JSONB_BUILD_OBJECT(
             'reason_code',
             invalidated.revoke_reason,
             'revoke_scope',
             'current'
           ),
           $2
         FROM invalidated
         RETURNING id
       ),
       touched AS (
         UPDATE auth_sessions AS session
         SET
           last_seen_at = $2,
           idle_expires_at = LEAST(
             $2 + INTERVAL '14 days',
             session.absolute_expires_at
           )
         FROM users AS account
         WHERE (
             session.token_hash = $1
             OR (
               session.previous_token_hash = $1
               AND session.previous_token_valid_until > $2
               AND session.previous_token_authorizes
             )
           )
           AND session.user_id = account.id
           AND session.revoked_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM invalidated
             WHERE invalidated.id = session.id
           )
           AND session.idle_expires_at > $2
           AND session.absolute_expires_at > $2
           AND session.last_seen_at <= $2
             - MAKE_INTERVAL(mins => ${SESSION_TOUCH_INTERVAL_MINUTES})
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
           AND (
             NOT (
               $3::BOOLEAN
               AND ($4::BOOLEAN OR session.user_id = ANY($5::BIGINT[]))
             )
             OR EXISTS (
               SELECT 1
               FROM workspace_members AS membership
               JOIN workspaces AS workspace
                 ON workspace.id = membership.workspace_id
               WHERE membership.workspace_id = session.workspace_id
                 AND membership.user_id = session.user_id
                 AND membership.status = 'active'
                 AND workspace.status = 'active'
                 AND workspace.deleted_at IS NULL
             )
           )
         RETURNING session.*
       ),
       current_session AS (
         SELECT session.*
         FROM auth_sessions AS session
         JOIN users AS account ON account.id = session.user_id
         WHERE (
             session.token_hash = $1
             OR (
               session.previous_token_hash = $1
               AND session.previous_token_valid_until > $2
               AND session.previous_token_authorizes
             )
           )
           AND session.revoked_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM invalidated
             WHERE invalidated.id = session.id
           )
           AND session.idle_expires_at > $2
           AND session.absolute_expires_at > $2
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
           AND (
             NOT (
               $3::BOOLEAN
               AND ($4::BOOLEAN OR session.user_id = ANY($5::BIGINT[]))
             )
             OR EXISTS (
               SELECT 1
               FROM workspace_members AS membership
               JOIN workspaces AS workspace
                 ON workspace.id = membership.workspace_id
               WHERE membership.workspace_id = session.workspace_id
                 AND membership.user_id = session.user_id
                 AND membership.status = 'active'
                 AND workspace.status = 'active'
                 AND workspace.deleted_at IS NULL
             )
           )
       ),
       selected AS (
         SELECT * FROM touched
         UNION ALL
         SELECT * FROM current_session
         WHERE NOT EXISTS (SELECT 1 FROM touched)
       )
       SELECT
         selected.id::TEXT AS id,
         selected.user_id::TEXT AS "userId",
         selected.workspace_id::TEXT AS "workspaceId",
         selected.auth_method AS "authMethod",
         selected.device_label AS "deviceLabel",
         selected.browser_label AS "browserLabel",
         selected.environment_label AS "environmentLabel",
         selected.created_at AS "createdAt",
         selected.last_seen_at AS "lastSeenAt",
         selected.idle_expires_at AS "idleExpiresAt",
         selected.absolute_expires_at AS "absoluteExpiresAt",
         selected.rotated_at AS "rotatedAt",
         selected.last_authenticated_at AS "lastAuthenticatedAt",
         (
           selected.token_hash = $1
           AND selected.rotated_at <= $2 - INTERVAL '24 hours'
         ) AS "rotationDue",
         (SELECT COUNT(*) FROM invalidated_event) AS "invalidatedEventCount"
       FROM selected
       JOIN users AS account ON account.id = selected.user_id
       LIMIT 1`,
      [
        hashAuthSessionToken(token),
        now,
        rollout.enabled,
        rollout.global,
        rollout.canaryUserIds,
      ],
    );
    return mapSession(result.rows[0], env);
  } catch (error) {
    logError("auth_v2.session_read_failed", error);
    return null;
  }
}

export async function requireAuthSession(
  token: string,
  now = new Date(),
): Promise<AuthSession> {
  const session = await readAuthSession(token, now);
  if (!session) throw new AuthSessionRequiredError();
  return session;
}

export async function rotateAuthSession(
  token: string,
  now = new Date(),
  options: { force?: boolean; env?: AuthEnvironment } = {},
): Promise<AuthSessionWithToken | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const pool = getPool();
  if (!pool) return null;
  const nextToken = createOpaqueToken();
  const env = options.env ?? process.env;
  const rollout = getAuthWorkspacesV2RolloutPolicy(env);

  try {
    const result = await pool.query<SessionRow>(
      `WITH rotated AS (
         UPDATE auth_sessions AS session
         SET
           previous_token_hash = session.token_hash,
           previous_token_valid_until = LEAST(
             $3::TIMESTAMPTZ + INTERVAL '60 seconds',
             session.absolute_expires_at
           ),
           previous_token_authorizes = TRUE,
           token_hash = $2,
           last_seen_at = $3,
           idle_expires_at = LEAST(
             $3 + INTERVAL '14 days',
             session.absolute_expires_at
           ),
           rotated_at = $3
         FROM users AS account
         WHERE session.token_hash = $1
           AND session.user_id = account.id
           AND session.revoked_at IS NULL
           AND session.idle_expires_at > $3
           AND session.absolute_expires_at > $3
           AND (
             $4::BOOLEAN
             OR session.rotated_at <= $3 - INTERVAL '24 hours'
           )
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
           AND (
             NOT (
               $5::BOOLEAN
               AND ($6::BOOLEAN OR session.user_id = ANY($7::BIGINT[]))
             )
             OR EXISTS (
               SELECT 1
               FROM workspace_members AS membership
               JOIN workspaces AS workspace
                 ON workspace.id = membership.workspace_id
               WHERE membership.workspace_id = session.workspace_id
                 AND membership.user_id = session.user_id
                 AND membership.status = 'active'
                 AND workspace.status = 'active'
                 AND workspace.deleted_at IS NULL
             )
           )
         RETURNING session.*
       ),
       recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'session_rotated',
           rotated.user_id,
           rotated.workspace_id,
           rotated.id,
           rotated.request_ip_hash,
           rotated.user_agent_hash,
           JSONB_BUILD_OBJECT('method', rotated.auth_method),
           $3
         FROM rotated
         RETURNING id
       )
       SELECT
         rotated.id::TEXT AS id,
         rotated.user_id::TEXT AS "userId",
         rotated.workspace_id::TEXT AS "workspaceId",
         rotated.auth_method AS "authMethod",
         rotated.device_label AS "deviceLabel",
         rotated.browser_label AS "browserLabel",
         rotated.environment_label AS "environmentLabel",
         rotated.created_at AS "createdAt",
         rotated.last_seen_at AS "lastSeenAt",
         rotated.idle_expires_at AS "idleExpiresAt",
         rotated.absolute_expires_at AS "absoluteExpiresAt",
         rotated.rotated_at AS "rotatedAt",
         rotated.last_authenticated_at AS "lastAuthenticatedAt",
         FALSE AS "rotationDue",
         (SELECT COUNT(*) FROM recorded) AS "recordedCount"
       FROM rotated
       JOIN users AS account ON account.id = rotated.user_id`,
      [
        hashAuthSessionToken(token),
        hashAuthSessionToken(nextToken),
        now,
        options.force === true,
        rollout.enabled,
        rollout.global,
        rollout.canaryUserIds,
      ],
    );
    const session = mapSession(result.rows[0], env);
    return session ? { session, token: nextToken } : null;
  } catch (error) {
    logError("auth_v2.session_rotate_failed", error);
    return null;
  }
}

export async function changeActiveWorkspace(input: {
  token: string;
  workspaceId: string;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<AuthSessionWithToken | null> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  if (
    !TOKEN_PATTERN.test(input.token)
    || !validId(input.workspaceId)
    || !Number.isFinite(now.getTime())
  ) {
    return null;
  }

  const currentSession = await readAuthSession(input.token, now, { env });
  if (
    !currentSession
    || !isAuthWorkspacesV2EnabledForUser(currentSession.userId, env)
  ) {
    return null;
  }

  const pool = getPool();
  if (!pool) return null;
  const nextToken = createOpaqueToken();

  try {
    const result = await pool.query<SessionRow>(
      `SELECT
         switched.id::TEXT AS id,
         switched.user_id::TEXT AS "userId",
         switched.workspace_id::TEXT AS "workspaceId",
         switched.auth_method AS "authMethod",
         switched.device_label AS "deviceLabel",
         switched.browser_label AS "browserLabel",
         switched.environment_label AS "environmentLabel",
         switched.created_at AS "createdAt",
         switched.last_seen_at AS "lastSeenAt",
         switched.idle_expires_at AS "idleExpiresAt",
         switched.absolute_expires_at AS "absoluteExpiresAt",
         switched.rotated_at AS "rotatedAt",
         switched.last_authenticated_at AS "lastAuthenticatedAt",
         FALSE AS "rotationDue"
       FROM change_auth_session_workspace($1, $2, $3, $4) AS switched`,
      [
        hashAuthSessionToken(input.token),
        hashAuthSessionToken(nextToken),
        input.workspaceId,
        now,
      ],
    );
    const session = mapSession(result.rows[0], env);
    return session ? { session, token: nextToken } : null;
  } catch (error) {
    logError("auth_v2.workspace_switch_failed", error);
    return null;
  }
}

export async function revokeAuthSession(
  token: string,
  reason: RevokeReason = "logout",
): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  return revokeAuthSessionWhere(
    "(session.token_hash = $1 OR session.previous_token_hash = $1)",
    [hashAuthSessionToken(token), reason],
    reason,
  );
}

export async function revokeAuthSessionById(input: {
  userId: string;
  sessionId: string;
  reason: RevokeReason;
}): Promise<boolean> {
  if (!validId(input.userId) || !validId(input.sessionId)) return false;
  return revokeAuthSessionWhere(
    "session.user_id = $1 AND session.id = $2",
    [input.userId, input.sessionId, input.reason],
    input.reason,
  );
}

async function revokeAuthSessionWhere(
  predicate: string,
  values: string[],
  reason: RevokeReason,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const reasonParameter = values.length;
  try {
    const result = await pool.query<{ revoked: boolean }>(
      `WITH revoked_session AS (
         UPDATE auth_sessions AS session
         SET
           revoked_at = clock_timestamp(),
           revoke_reason = $${reasonParameter}
         WHERE ${predicate}
           AND session.revoked_at IS NULL
         RETURNING session.*
       ),
       recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'session_revoked',
           revoked_session.user_id,
           revoked_session.workspace_id,
           revoked_session.id,
           revoked_session.request_ip_hash,
           revoked_session.user_agent_hash,
           JSONB_BUILD_OBJECT(
             'reason_code',
             $${reasonParameter}::TEXT,
             'revoke_scope',
             'current'
           ),
           revoked_session.revoked_at
         FROM revoked_session
         RETURNING id
       )
       SELECT
         EXISTS(SELECT 1 FROM revoked_session) AS revoked,
         (SELECT COUNT(*) FROM recorded) AS "recordedCount"`,
      values,
    );
    return result.rows[0]?.revoked === true;
  } catch (error) {
    logError("auth_v2.session_revoke_failed", error, { reasonCode: reason });
    return false;
  }
}

export async function revokeAllAuthSessions(input: {
  userId: string;
  exceptSessionId?: string | null;
}): Promise<number> {
  if (
    !validId(input.userId)
    || (
      input.exceptSessionId !== null
      && input.exceptSessionId !== undefined
      && !validId(input.exceptSessionId)
    )
  ) {
    return 0;
  }
  const pool = getPool();
  if (!pool) return 0;

  try {
    const result = await pool.query<{ revokedCount: number }>(
      `WITH revoked_sessions AS (
         UPDATE auth_sessions AS session
         SET
           revoked_at = clock_timestamp(),
           revoke_reason = 'logout_all'
         WHERE session.user_id = $1
           AND ($2::BIGINT IS NULL OR session.id <> $2::BIGINT)
           AND session.revoked_at IS NULL
         RETURNING session.*
       ),
       recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           metadata,
           created_at
         )
         SELECT
           'all_sessions_revoked',
           $1::BIGINT,
           JSONB_BUILD_OBJECT(
             'reason_code',
             'logout_all',
             'revoke_scope',
             'all'
           ),
           clock_timestamp()
         WHERE EXISTS (SELECT 1 FROM revoked_sessions)
         RETURNING id
       )
       SELECT
         COUNT(*)::INTEGER AS "revokedCount",
         (SELECT COUNT(*) FROM recorded) AS "recordedCount"
       FROM revoked_sessions`,
      [input.userId, input.exceptSessionId ?? null],
    );
    return result.rows[0]?.revokedCount ?? 0;
  } catch (error) {
    logError("auth_v2.session_revoke_all_failed", error);
    return 0;
  }
}

export async function listAuthSessions(input: {
  userId: string;
  currentSessionId: string;
  now?: Date;
}): Promise<AuthSessionSummary[]> {
  const now = input.now ?? new Date();
  if (
    !validId(input.userId)
    || !validId(input.currentSessionId)
    || !Number.isFinite(now.getTime())
  ) {
    return [];
  }
  const pool = getPool();
  if (!pool) return [];

  try {
    const result = await pool.query<Omit<AuthSessionSummary, "current">>(
      `SELECT
         session.id::TEXT AS id,
         session.auth_method AS "authMethod",
         session.device_label AS "deviceLabel",
         session.browser_label AS "browserLabel",
         session.environment_label AS "environmentLabel",
         session.created_at AS "createdAt",
         session.last_seen_at AS "lastSeenAt"
       FROM auth_sessions AS session
       WHERE session.user_id = $1
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > $2
         AND session.absolute_expires_at > $2
       ORDER BY
         (session.id = $3::BIGINT) DESC,
         session.last_seen_at DESC,
         session.id DESC`,
      [input.userId, now, input.currentSessionId],
    );
    return result.rows.map((row) => ({
      ...row,
      current: row.id === input.currentSessionId,
    }));
  } catch (error) {
    logError("auth_v2.session_list_failed", error);
    return [];
  }
}

export function isRecentAuthentication(
  session: Pick<AuthSession, "lastAuthenticatedAt">,
  now = new Date(),
  maxAgeSeconds = RECENT_AUTH_SECONDS,
): boolean {
  const authenticatedAt = session.lastAuthenticatedAt?.getTime();
  if (
    authenticatedAt === undefined
    || !Number.isInteger(maxAgeSeconds)
    || maxAgeSeconds < 1
    || maxAgeSeconds > 24 * 60 * 60
  ) {
    return false;
  }
  const age = now.getTime() - authenticatedAt;
  return age >= 0 && age <= maxAgeSeconds * 1000;
}

export function requireRecentAuthentication(
  session: Pick<AuthSession, "lastAuthenticatedAt">,
  now = new Date(),
  maxAgeSeconds = RECENT_AUTH_SECONDS,
): void {
  if (!isRecentAuthentication(session, now, maxAgeSeconds)) {
    throw new RecentAuthenticationRequiredError();
  }
}
