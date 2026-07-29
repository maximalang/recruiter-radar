import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { getCanonicalAccountOrigin } from "../account-auth";
import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logWarn } from "../runtime";
import { renderAuthEmail } from "./email-templates";
import { normalizeAuthEmail } from "./security";
import {
  RecentAuthenticationRequiredError,
  requireRecentAuthentication,
  type AuthSession,
} from "./sessions";
import {
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "./workspaces";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const EMAIL_CHANGE_TTL_MINUTES = 60;
const RETENTION_POLICY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const ACCOUNT_DELETION_CONFIRMATION = "УДАЛИТЬ АККАУНТ";

type AccountSessionContext = Pick<
  AuthSession,
  "id" | "userId" | "workspaceId" | "lastAuthenticatedAt"
>;

export type AccountSecurityProfile = {
  id: string;
  displayName: string | null;
  email: string;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

type MutationFailureCode =
  | "invalid"
  | "reauth_required"
  | "conflict"
  | "ownership_transfer_required"
  | "confirmation_required"
  | "unavailable";

export type AccountMutationResult =
  | { ok: true }
  | { ok: false; code: MutationFailureCode };

export type EmailChangeRequestResult =
  | { ok: true; delivery: "sent" | "failed" }
  | { ok: false; code: MutationFailureCode };

export type EmailChangeConfirmationResult =
  | { ok: true; preservedCurrentSession: boolean }
  | { ok: false; code: "invalid" | "conflict" | "unavailable" };

type LockedAccount = {
  email: string;
  emailNormalized: string | null;
  displayName: string | null;
  workspaceName: string;
};

type EmailChangeChallenge = {
  challengeId: string;
  userId: string;
  workspaceId: string | null;
  newEmail: string;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
};

export async function getAccountSecurityProfile(input: {
  userId: string;
  workspaceId: string;
}): Promise<AccountSecurityProfile | null> {
  if (!validId(input.userId) || !validId(input.workspaceId)) return null;
  const pool = getPool();
  if (!pool) return null;

  try {
    const result = await pool.query<AccountSecurityProfile>(
      `SELECT
         account.id::TEXT AS id,
         COALESCE(account.display_name, account.full_name) AS "displayName",
         account.email,
         account.created_at AS "createdAt",
         account.email_verified_at AS "emailVerifiedAt",
         workspace.id::TEXT AS "workspaceId",
         workspace.name AS "workspaceName",
         membership.role
       FROM users AS account
       JOIN workspace_members AS membership
         ON membership.user_id = account.id
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
       WHERE account.id = $1
         AND workspace.id = $2
         AND account.status = 'active'
         AND membership.status = 'active'
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
       LIMIT 1`,
      [input.userId, input.workspaceId],
    );
    const profile = result.rows[0];
    return profile && isWorkspaceRole(profile.role) ? profile : null;
  } catch (error) {
    logError("auth_v2.account_security_profile_failed", error);
    return null;
  }
}

export async function requestAccountEmailChange(input: {
  session: AccountSessionContext;
  newEmail: unknown;
  now?: Date;
}): Promise<EmailChangeRequestResult> {
  const now = input.now ?? new Date();
  const session = input.session;
  if (
    !validId(session.id)
    || !validId(session.userId)
    || !session.workspaceId
    || !validId(session.workspaceId)
    || !Number.isFinite(now.getTime())
  ) {
    return { ok: false, code: "unavailable" };
  }
  try {
    requireRecentAuthentication(session, now);
  } catch (error) {
    if (error instanceof RecentAuthenticationRequiredError) {
      return { ok: false, code: "reauth_required" };
    }
    return { ok: false, code: "unavailable" };
  }
  const newEmail = normalizeAuthEmail(input.newEmail);
  if (!newEmail) return { ok: false, code: "invalid" };

  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  const token = randomBytes(32).toString("hex");
  let challengeId: string | null = null;
  let account: LockedAccount | null = null;

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`auth-email-change-user:${session.userId}`],
    );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`auth-email-change-target:${newEmail.normalized}`],
    );
    const locked = await client.query<LockedAccount>(
      `SELECT
         account.email,
         account.email_normalized AS "emailNormalized",
         COALESCE(account.display_name, account.full_name) AS "displayName",
         workspace.name AS "workspaceName"
       FROM users AS account
       JOIN workspace_members AS membership
         ON membership.user_id = account.id
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
       WHERE account.id = $1
         AND workspace.id = $2
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
         AND membership.status = 'active'
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
       FOR UPDATE OF account, membership`,
      [session.userId, session.workspaceId],
    );
    account = locked.rows[0] ?? null;
    if (!account) {
      await client.query("ROLLBACK");
      return { ok: false, code: "unavailable" };
    }
    if (sameEmail(account, newEmail.normalized)) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid" };
    }
    const conflict = await client.query(
      `SELECT 1
       FROM users
       WHERE id <> $1
         AND status <> 'deleted'
         AND (
           email_normalized = $2
           OR LOWER(email) = LOWER($2)
         )
       LIMIT 1`,
      [session.userId, newEmail.normalized],
    );
    if ((conflict.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict" };
    }

    await client.query(
      `UPDATE auth_challenges
       SET invalidated_at = $2
       WHERE purpose = 'change_email'
         AND user_id = $1
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [session.userId, now],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO auth_challenges (
         purpose,
         email_normalized,
         user_id,
         workspace_id,
         token_hash,
         return_to,
         send_status,
         expires_at,
         created_at
       )
       VALUES (
         'change_email',
         $1,
         $2,
         $3,
         $4,
         '/settings/security',
         'pending',
         $5 + INTERVAL '1 hour',
         $5
       )
       RETURNING id::TEXT AS id`,
      [
        newEmail.normalized,
        session.userId,
        session.workspaceId,
        hashToken(token),
        now,
      ],
    );
    challengeId = inserted.rows[0]?.id ?? null;
    if (!challengeId) throw new Error("Email change challenge was not created.");
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         session_id,
         subject_hash,
         metadata,
         created_at
       )
       VALUES (
         'email_change_requested',
         $1,
         $2,
         $3,
         $4,
         JSONB_BUILD_OBJECT(
           'challenge_purpose',
           'change_email',
           'source',
           'web'
         ),
         $5
       )`,
      [
        session.userId,
        session.workspaceId,
        session.id,
        hashAuditSubject("email", newEmail.normalized),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.email_change_request_failed", error);
    return {
      ok: false,
      code: isUniqueViolation(error) ? "conflict" : "unavailable",
    };
  } finally {
    client.release();
  }

  const actionUrl = buildFragmentUrl("/auth/change-email", token);
  const newAddressMessage = renderAuthEmail({
    template: "change_email",
    actionUrl,
    recipientName: account.displayName,
    expiresInMinutes: EMAIL_CHANGE_TTL_MINUTES,
  });
  const oldAddressMessage = renderAuthEmail({
    template: "email_change_requested",
    recipientName: account.displayName,
  });
  const [delivery] = await Promise.all([
    sendEmail({ ...newAddressMessage, to: newEmail.normalized }).catch((error) => {
      logError("auth_v2.email_change_email_failed", error);
      return { ok: false as const, reason: "send_failed" as const };
    }),
    sendEmail({ ...oldAddressMessage, to: account.email }).catch((error) => {
      logError("auth_v2.email_change_old_address_notice_failed", error);
      return { ok: false as const, reason: "send_failed" as const };
    }),
  ]);
  const sendStatus = delivery.ok ? "sent" : "failed";
  await getPool()?.query(
    `UPDATE auth_challenges
     SET send_status = $1
     WHERE id = $2`,
    [sendStatus, challengeId],
  ).catch((error) => {
    logError("auth_v2.email_change_delivery_status_failed", error);
  });
  if (!delivery.ok) {
    logWarn("auth_v2.email_change_email_not_sent", {
      reasonCode: delivery.reason,
    });
  }
  return { ok: true, delivery: sendStatus };
}

export async function confirmAccountEmailChange(input: {
  token: string;
  currentSession?: AccountSessionContext | null;
  now?: Date;
}): Promise<EmailChangeConfirmationResult> {
  const token = input.token.trim();
  const now = input.now ?? new Date();
  if (!TOKEN_PATTERN.test(token) || !Number.isFinite(now.getTime())) {
    return { ok: false, code: "invalid" };
  }

  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  let oldEmail: string | null = null;
  let displayName: string | null = null;
  let preservedCurrentSession = false;

  try {
    await client.query("BEGIN");
    const challengeResult = await client.query<EmailChangeChallenge>(
      `SELECT
         challenge.id::TEXT AS "challengeId",
         challenge.user_id::TEXT AS "userId",
         challenge.workspace_id::TEXT AS "workspaceId",
         challenge.email_normalized AS "newEmail",
         challenge.expires_at AS "expiresAt",
         challenge.consumed_at AS "consumedAt",
         challenge.invalidated_at AS "invalidatedAt"
       FROM auth_challenges AS challenge
       WHERE challenge.token_hash = $1
         AND challenge.purpose = 'change_email'
       LIMIT 1
       FOR UPDATE OF challenge`,
      [hashToken(token)],
    );
    const challenge = challengeResult.rows[0];
    if (
      !challenge
      || !validId(challenge.userId)
      || challenge.consumedAt
      || challenge.invalidatedAt
      || challenge.expiresAt.getTime() <= now.getTime()
    ) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid" };
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`auth-email-change-target:${challenge.newEmail}`],
    );
    const accountResult = await client.query<{
      email: string;
      displayName: string | null;
    }>(
      `SELECT
         account.email,
         COALESCE(account.display_name, account.full_name) AS "displayName"
       FROM users AS account
       WHERE account.id = $1
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       FOR UPDATE`,
      [challenge.userId],
    );
    const account = accountResult.rows[0];
    if (!account) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid" };
    }
    const conflict = await client.query(
      `SELECT 1
       FROM users
       WHERE id <> $1
         AND status <> 'deleted'
         AND (
           email_normalized = $2
           OR LOWER(email) = LOWER($2)
         )
       LIMIT 1`,
      [challenge.userId, challenge.newEmail],
    );
    if ((conflict.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict" };
    }

    preservedCurrentSession = Boolean(
      input.currentSession
      && input.currentSession.userId === challenge.userId
      && validId(input.currentSession.id),
    );
    const preservedSessionId = preservedCurrentSession
      ? input.currentSession!.id
      : null;

    await client.query(
      `UPDATE users
       SET email = $2,
           email_normalized = $2,
           email_verified_at = $3,
           updated_at = $3
       WHERE id = $1
         AND status = 'active'`,
      [challenge.userId, challenge.newEmail, now],
    );
    await client.query(
      `UPDATE auth_challenges
       SET consumed_at = $2
       WHERE id = $1
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [challenge.challengeId, now],
    );
    await client.query(
      `UPDATE auth_challenges
       SET invalidated_at = $2
       WHERE purpose = 'change_email'
         AND user_id = $1
         AND id <> $3
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      [challenge.userId, now, challenge.challengeId],
    );
    await client.query(
      `WITH revoked_sessions AS (
         UPDATE auth_sessions AS session
         SET revoked_at = $3,
             revoke_reason = 'security_action'
         WHERE session.user_id = $1
           AND ($2::BIGINT IS NULL OR session.id <> $2)
           AND session.revoked_at IS NULL
         RETURNING session.id
       )
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         session_id,
         metadata,
         created_at
       )
       SELECT
         'all_sessions_revoked',
         $1,
         $4,
         $2,
         JSONB_BUILD_OBJECT(
           'reason_code',
           'email_changed',
           'revoke_scope',
           'all'
         ),
         $3
       WHERE EXISTS (SELECT 1 FROM revoked_sessions)`,
      [
        challenge.userId,
        preservedSessionId,
        now,
        challenge.workspaceId,
      ],
    );
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         session_id,
         subject_hash,
         metadata,
         created_at
       )
       VALUES (
         'email_changed',
         $1,
         $2,
         $3,
         $4,
         JSONB_BUILD_OBJECT('source', 'email'),
         $5
       )`,
      [
        challenge.userId,
        challenge.workspaceId,
        preservedSessionId,
        hashAuditSubject("email", challenge.newEmail),
        now,
      ],
    );
    await client.query("COMMIT");
    oldEmail = account.email;
    displayName = account.displayName;
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.email_change_confirmation_failed", error);
    return {
      ok: false,
      code: isUniqueViolation(error) ? "conflict" : "unavailable",
    };
  } finally {
    client.release();
  }

  if (oldEmail) {
    const message = renderAuthEmail({
      template: "email_changed",
      recipientName: displayName,
      actionUrl: new URL("/settings/security", getCanonicalAccountOrigin()).toString(),
    });
    await sendEmail({ ...message, to: oldEmail }).catch((error) => {
      logError("auth_v2.email_changed_notice_failed", error);
    });
  }
  return { ok: true, preservedCurrentSession };
}

export async function requestAccountDeletion(input: {
  session: AccountSessionContext;
  confirmation: unknown;
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<AccountMutationResult> {
  const now = input.now ?? new Date();
  const session = input.session;
  if (input.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    return { ok: false, code: "confirmation_required" };
  }
  if (
    !validId(session.id)
    || !validId(session.userId)
    || !session.workspaceId
    || !validId(session.workspaceId)
    || !Number.isFinite(now.getTime())
  ) {
    return { ok: false, code: "unavailable" };
  }
  try {
    requireRecentAuthentication(session, now);
  } catch (error) {
    if (error instanceof RecentAuthenticationRequiredError) {
      return { ok: false, code: "reauth_required" };
    }
    return { ok: false, code: "unavailable" };
  }
  const policy = resolveDeletionPolicy(input.env ?? process.env, now);
  if (!policy) return { ok: false, code: "unavailable" };

  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  let accountEmail: string | null = null;
  let displayName: string | null = null;

  try {
    await client.query("BEGIN");
    const accountResult = await client.query<{
      email: string;
      displayName: string | null;
    }>(
      `SELECT
         account.email,
         COALESCE(account.display_name, account.full_name) AS "displayName"
       FROM users AS account
       WHERE account.id = $1
         AND account.status = 'active'
       FOR UPDATE`,
      [session.userId],
    );
    const account = accountResult.rows[0];
    if (!account) {
      await client.query("ROLLBACK");
      return { ok: false, code: "unavailable" };
    }
    const blockingOwner = await client.query<{ blockingWorkspaceId: string }>(
      `SELECT owner_membership.workspace_id::TEXT AS blocking_workspace_id
       FROM workspace_members AS owner_membership
       WHERE owner_membership.user_id = $1
         AND owner_membership.role = 'owner'
         AND owner_membership.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM workspace_members AS colleague
           WHERE colleague.workspace_id = owner_membership.workspace_id
             AND colleague.user_id <> owner_membership.user_id
             AND colleague.status = 'active'
         )
       LIMIT 1
       FOR UPDATE OF owner_membership`,
      [session.userId],
    );
    if ((blockingOwner.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "ownership_transfer_required" };
    }

    await client.query(
      `INSERT INTO account_deletion_requests (
         user_id,
         requested_by_session_id,
         retention_policy_key,
         requested_at,
         purge_after
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        session.userId,
        session.id,
        policy.key,
        now,
        policy.purgeAfter,
      ],
    );
    await client.query(
      `UPDATE workspaces AS workspace
       SET status = 'deletion_pending',
           updated_at = $2
       WHERE workspace.id IN (
         SELECT membership.workspace_id
         FROM workspace_members AS membership
         WHERE membership.user_id = $1
           AND membership.role = 'owner'
           AND membership.status = 'active'
           AND NOT EXISTS (
             SELECT 1
             FROM workspace_members AS colleague
             WHERE colleague.workspace_id = membership.workspace_id
               AND colleague.user_id <> membership.user_id
               AND colleague.status = 'active'
           )
       )`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE workspace_members
       SET status = 'removed',
           updated_at = $2
       WHERE user_id = $1
         AND status = 'active'`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = $2,
           revoke_reason = 'account_unavailable'
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE users
       SET status = 'deletion_pending',
           updated_at = $2
       WHERE id = $1
         AND status = 'active'`,
      [session.userId, now],
    );
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         session_id,
         metadata,
         created_at
       )
       VALUES (
         'account_deletion_requested',
         $1,
         $2,
         $3,
         JSONB_BUILD_OBJECT(
           'reason_code',
           'user_requested',
           'source',
           'web'
         ),
         $4
       )`,
      [session.userId, session.workspaceId, session.id, now],
    );
    await client.query("COMMIT");
    accountEmail = account.email;
    displayName = account.displayName;
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.account_deletion_request_failed", error);
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }

  if (accountEmail) {
    const message = renderAuthEmail({
      template: "account_deletion",
      recipientName: displayName,
    });
    await sendEmail({ ...message, to: accountEmail }).catch((error) => {
      logError("auth_v2.account_deletion_notice_failed", error);
    });
  }
  return { ok: true };
}

function resolveDeletionPolicy(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
): { key: string; purgeAfter: Date | null } | null {
  const key = env.AUTH_ACCOUNT_RETENTION_POLICY_KEY?.trim() || "manual_review";
  if (!RETENTION_POLICY_PATTERN.test(key)) return null;
  const rawDays = env.AUTH_ACCOUNT_PURGE_AFTER_DAYS?.trim();
  if (!rawDays) return { key, purgeAfter: null };
  if (!/^[1-9]\d{0,3}$/.test(rawDays)) return null;
  const days = Number(rawDays);
  if (!Number.isSafeInteger(days) || days > 3650) return null;
  return {
    key,
    purgeAfter: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
  };
}

function sameEmail(account: LockedAccount, nextEmail: string): boolean {
  return (
    account.emailNormalized?.toLocaleLowerCase("en-US")
      === nextEmail.toLocaleLowerCase("en-US")
    || account.email.toLocaleLowerCase("en-US")
      === nextEmail.toLocaleLowerCase("en-US")
  );
}

function validId(value: string): boolean {
  if (!POSITIVE_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashAuditSubject(kind: string, value: string): string {
  const secret = (
    process.env.AUTH_RATE_LIMIT_SECRET
    ?? process.env.SESSION_SECRET
  )?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_RATE_LIMIT_SECRET must be at least 32 characters.");
  }
  return createHmac("sha256", secret)
    .update(`auth-v2:${kind}:${value}`)
    .digest("hex");
}

function buildFragmentUrl(pathname: string, token: string): string {
  const url = new URL(pathname, getCanonicalAccountOrigin());
  url.hash = token;
  return url.toString();
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "23505",
  );
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
