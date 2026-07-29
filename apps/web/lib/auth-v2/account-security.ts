import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { getCanonicalAccountOrigin } from "../account-auth";
import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logWarn } from "../runtime";
import { renderAuthEmail } from "./email-templates";
import {
  consumeAuthRateLimit,
  hashAuthRateLimitBoundary,
} from "./rate-limits";
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
  | "workspace_data_transfer_required"
  | "confirmation_required"
  | "unavailable";

export type AccountMutationResult =
  | { ok: true }
  | { ok: false; code: MutationFailureCode };

export type EmailChangeRequestResult =
  | { ok: true }
  | { ok: false; code: MutationFailureCode };

export type EmailChangeConfirmationResult =
  | {
    ok: true;
    preservedCurrentSession: true;
    sessionToken: string;
  }
  | {
    ok: true;
    preservedCurrentSession: false;
  }
  | {
    ok: false;
    code: "invalid" | "reauth_required" | "conflict" | "unavailable";
  };

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

type OwnedWorkspaceLock = {
  workspaceId: string;
  hasActiveColleague: boolean;
};

type LegacyWorkspaceDataLock = {
  workspaceId: string;
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
  const targetBoundary = newEmail.normalized.toLowerCase();

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
      [`auth-email-change-target:${targetBoundary}`],
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
    const userAllowed = await consumeAuthRateLimit(client, {
      scope: "email_hash",
      keyHash: hashAuthRateLimitBoundary(
        "email-change-user",
        session.userId,
      ),
      windowSeconds: 3_600,
      limit: 3,
      now,
    });
    if (!userAllowed) {
      await client.query("COMMIT");
      logWarn("auth_v2.email_change_request_suppressed", {
        reasonCode: "rate_limited",
      });
      return { ok: true };
    }
    const targetAllowed = await consumeAuthRateLimit(client, {
      scope: "email_hash",
      keyHash: hashAuthRateLimitBoundary(
        "email-change-target",
        targetBoundary,
      ),
      windowSeconds: 3_600,
      limit: 3,
      now,
    });
    if (!targetAllowed) {
      await client.query("COMMIT");
      logWarn("auth_v2.email_change_request_suppressed", {
        reasonCode: "rate_limited",
      });
      return { ok: true };
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
      await client.query("COMMIT");
      logWarn("auth_v2.email_change_request_suppressed", {
        reasonCode: "identity_conflict",
      });
      return { ok: true };
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
         $5::TIMESTAMPTZ + INTERVAL '1 hour',
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
  return { ok: true };
}

export async function confirmAccountEmailChange(input: {
  token: string;
  currentSession?: AccountSessionContext | null;
  currentSessionToken?: string | null;
  now?: Date;
}): Promise<EmailChangeConfirmationResult> {
  const token = input.token.trim();
  const currentSessionToken = input.currentSessionToken?.trim() ?? "";
  const now = input.now ?? new Date();
  if (!TOKEN_PATTERN.test(token) || !Number.isFinite(now.getTime())) {
    return { ok: false, code: "invalid" };
  }

  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  let oldEmail: string | null = null;
  let displayName: string | null = null;
  let preservedCurrentSession = false;
  const nextSessionToken = (
    input.currentSession
    && TOKEN_PATTERN.test(currentSessionToken)
  )
    ? randomBytes(32).toString("hex")
    : null;

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
      [`auth-email-change-target:${challenge.newEmail.toLowerCase()}`],
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

    const canPreserveCurrentSession = Boolean(
      input.currentSession
      && input.currentSession.userId === challenge.userId
      && validId(input.currentSession.id),
    );
    if (
      input.currentSession?.userId === challenge.userId
      && (!canPreserveCurrentSession || !nextSessionToken)
    ) {
      await client.query("ROLLBACK");
      return { ok: false, code: "reauth_required" };
    }
    let preservedSessionId: string | null = null;
    if (canPreserveCurrentSession && nextSessionToken) {
      const rotated = await client.query<{ rotated: boolean }>(
        `WITH rotated_session AS (
           UPDATE auth_sessions AS session
           SET
             token_hash = $4,
             previous_token_hash = NULL,
             previous_token_valid_until = NULL,
             previous_token_authorizes = FALSE,
             last_seen_at = $5,
             idle_expires_at = LEAST(
               $5::TIMESTAMPTZ + INTERVAL '14 days',
               session.absolute_expires_at
             ),
             rotated_at = $5
           WHERE session.id = $2
             AND session.user_id = $1
             AND session.revoked_at IS NULL
             AND session.idle_expires_at > $5
             AND session.absolute_expires_at > $5
             AND session.token_hash = $3
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
             rotated_session.user_id,
             rotated_session.workspace_id,
             rotated_session.id,
             rotated_session.request_ip_hash,
             rotated_session.user_agent_hash,
             JSONB_BUILD_OBJECT(
               'method',
               rotated_session.auth_method,
               'reason_code',
               'email_changed'
             ),
             $5
           FROM rotated_session
           RETURNING id
         )
         SELECT
           EXISTS(SELECT 1 FROM rotated_session) AS rotated,
           (SELECT COUNT(*) FROM recorded) AS "recordedCount"`,
        [
          challenge.userId,
          input.currentSession!.id,
          hashToken(currentSessionToken),
          hashToken(nextSessionToken),
          now,
        ],
      );
      preservedCurrentSession = rotated.rows[0]?.rotated === true;
      preservedSessionId = preservedCurrentSession
        ? input.currentSession!.id
        : null;
      if (!preservedCurrentSession) {
        await client.query("ROLLBACK");
        return { ok: false, code: "reauth_required" };
      }
    }

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
         SET revoked_at = GREATEST(
               session.created_at,
               $3::TIMESTAMPTZ
             ),
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
  return preservedCurrentSession && nextSessionToken
    ? {
      ok: true,
      preservedCurrentSession: true,
      sessionToken: nextSessionToken,
    }
    : { ok: true, preservedCurrentSession: false };
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
    const ownedWorkspaces = await client.query<OwnedWorkspaceLock>(
      `SELECT
         owner_membership.workspace_id::TEXT AS "workspaceId",
         EXISTS (
           SELECT 1
           FROM workspace_members AS colleague
           WHERE colleague.workspace_id = owner_membership.workspace_id
             AND colleague.user_id <> owner_membership.user_id
             AND colleague.status = 'active'
         ) AS "hasActiveColleague"
       FROM workspace_members AS owner_membership
       JOIN workspaces AS owned_workspace
         ON owned_workspace.id = owner_membership.workspace_id
       WHERE owner_membership.user_id = $1
         AND owner_membership.role = 'owner'
         AND owner_membership.status = 'active'
         AND owned_workspace.deleted_at IS NULL
       ORDER BY owner_membership.workspace_id
       FOR UPDATE OF owner_membership, owned_workspace`,
      [session.userId],
    );
    if (ownedWorkspaces.rows.some((workspace) =>
      workspace.hasActiveColleague
    )) {
      await client.query("ROLLBACK");
      return { ok: false, code: "ownership_transfer_required" };
    }
    const legacyWorkspaceData = await client.query<LegacyWorkspaceDataLock>(
      `SELECT workspace.id::TEXT AS "workspaceId"
       FROM workspaces AS workspace
       JOIN workspace_members AS successor
         ON successor.workspace_id = workspace.id
       WHERE successor.user_id <> $1
         AND successor.role = 'owner'
         AND successor.status = 'active'
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1
             FROM client_profiles AS profile
             WHERE profile.owner_id = $1
               AND (
                 profile.workspace_id = workspace.id
                 OR profile.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM subscriptions AS subscription
             WHERE subscription.user_id = $1
               AND (
                 subscription.workspace_id = workspace.id
                 OR subscription.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM checkout_orders AS checkout
             WHERE checkout.user_id = $1
               AND (
                 checkout.workspace_id = workspace.id
                 OR checkout.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM pilot_enrollments AS pilot
             WHERE pilot.user_id = $1
               AND (
                 pilot.workspace_id = workspace.id
                 OR pilot.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM leads AS lead
             WHERE lead.user_id = $1
               AND (
                 lead.workspace_id = workspace.id
                 OR lead.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM deliveries AS delivery
             WHERE delivery.user_id = $1
               AND (
                 delivery.workspace_id = workspace.id
                 OR delivery.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM user_search_preferences AS preference
             WHERE preference.user_id = $1
               AND (
                 preference.workspace_id = workspace.id
                 OR preference.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM notification_provider_accounts AS provider
             WHERE provider.owner_id = $1
               AND (
                 provider.workspace_id = workspace.id
                 OR provider.workspace_id IS NULL
               )
           )
           OR EXISTS (
             SELECT 1
             FROM opportunities AS opportunity
             WHERE opportunity.owner_id = $1
               AND (
                 opportunity.workspace_id = workspace.id
                 OR opportunity.workspace_id IS NULL
               )
           )
         )
       ORDER BY workspace.id
       LIMIT 1
       FOR UPDATE OF successor, workspace`,
      [session.userId],
    );
    if ((legacyWorkspaceData.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "workspace_data_transfer_required" };
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
      `UPDATE notification_delivery_jobs AS job
       SET status = CASE
             WHEN job.status IN ('queued', 'sending', 'failed')
               THEN 'cancelled'
             ELSE job.status
           END,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = GREATEST(
             job.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE job.client_profile_id IN (
         SELECT profile.id
         FROM client_profiles AS profile
         WHERE profile.owner_id = $1
       )`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE notification_delivery_attempts AS attempt
       SET provider_message_id = NULL,
           provider_error_code = NULL,
           provider_error_message = NULL,
           response_snapshot = '{}'::JSONB
       WHERE attempt.job_id IN (
         SELECT job.id
         FROM notification_delivery_jobs AS job
         JOIN client_profiles AS profile
           ON profile.id = job.client_profile_id
         WHERE profile.owner_id = $1
       )`,
      [session.userId],
    );
    await client.query(
      `UPDATE notification_inbound_events AS inbound
       SET provider_event_id = NULL,
           payload = '{}'::JSONB,
           error_message = NULL
       WHERE inbound.provider_account_id IN (
         SELECT provider.id
         FROM notification_provider_accounts AS provider
         WHERE provider.owner_id = $1
       )`,
      [session.userId],
    );
    await client.query(
      `UPDATE notification_routes AS route
       SET status = 'disabled',
           quiet_hours = '{}'::JSONB,
           route_config = '{}'::JSONB,
           updated_at = GREATEST(
             route.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE route.client_profile_id IN (
         SELECT profile.id
         FROM client_profiles AS profile
         WHERE profile.owner_id = $1
       )`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE notification_endpoints AS endpoint
       SET status = 'revoked',
           destination_id = NULL,
           destination_label = NULL,
           bind_token_hash = NULL,
           bind_token_expires_at = NULL,
           endpoint_config = '{}'::JSONB,
           provider_state = '{}'::JSONB,
           last_error_code = NULL,
           updated_at = GREATEST(
             endpoint.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE endpoint.client_profile_id IN (
         SELECT profile.id
         FROM client_profiles AS profile
         WHERE profile.owner_id = $1
       )`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE notification_provider_accounts AS provider
       SET display_name = 'Deleted account',
           status = 'revoked',
           external_account_id = NULL,
           external_account_name = NULL,
           secret_ciphertext = 'purged',
           capabilities = '{}'::JSONB,
           provider_metadata = '{}'::JSONB,
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = GREATEST(
             provider.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE provider.owner_id = $1`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE web_push_subscriptions AS subscription
       SET revoked_at = GREATEST(
             subscription.created_at,
             $2::TIMESTAMPTZ
           )
       WHERE subscription.client_profile_id IN (
         SELECT profile.id
         FROM client_profiles AS profile
         WHERE profile.owner_id = $1
       )
         AND subscription.revoked_at IS NULL`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE client_profiles AS profile
       SET is_active = FALSE,
           delivery_enabled = FALSE,
           web_push_enabled = FALSE,
           email_digest_enabled = FALSE,
           digest_email = NULL,
           telegram_chat_id = NULL,
           updated_at = GREATEST(
             profile.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE profile.owner_id = $1`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE workspaces AS workspace
       SET status = 'deletion_pending',
           updated_at = GREATEST(
             workspace.updated_at,
             $2::TIMESTAMPTZ
           )
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
      `UPDATE workspace_members AS membership
       SET status = 'removed',
           updated_at = GREATEST(
             membership.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE membership.user_id = $1
         AND membership.status = 'active'`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE auth_sessions AS session
       SET revoked_at = GREATEST(
             session.created_at,
             $2::TIMESTAMPTZ
           ),
           revoke_reason = 'account_unavailable'
       WHERE session.user_id = $1
         AND session.revoked_at IS NULL`,
      [session.userId, now],
    );
    await client.query(
      `UPDATE users AS account
       SET status = 'deletion_pending',
           updated_at = GREATEST(
             account.updated_at,
             $2::TIMESTAMPTZ
           )
       WHERE account.id = $1
         AND account.status = 'active'`,
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
