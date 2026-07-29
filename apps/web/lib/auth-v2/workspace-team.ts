import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { getCanonicalAccountOrigin } from "../account-auth";
import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logWarn } from "../runtime";
import {
  type AuthEnvironment,
  isAuthWorkspacesV2EnabledForUser,
} from "./config";
import { renderAuthEmail, type AuthEmailTemplateName } from "./email-templates";
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
const INVITE_TTL_HOURS = 24;
const INVITABLE_ROLES = new Set<WorkspaceRole>([
  "admin",
  "recruiter",
  "viewer",
  "billing",
]);

type TeamSessionContext = Pick<
  AuthSession,
  "id" | "userId" | "workspaceId" | "lastAuthenticatedAt"
>;

export type WorkspaceTeamMember = {
  userId: string;
  displayName: string | null;
  email: string;
  role: WorkspaceRole;
  joinedAt: Date;
};

export type WorkspaceTeamInvite = {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  expiresAt: Date;
  sendStatus: "pending" | "sent" | "failed";
};

export type WorkspaceTeam = {
  workspaceId: string;
  workspaceName: string;
  actorRole: "owner" | "admin";
  members: WorkspaceTeamMember[];
  invites: WorkspaceTeamInvite[];
};

type TeamFailureCode =
  | "invalid"
  | "denied"
  | "conflict"
  | "email_mismatch"
  | "rate_limited"
  | "reauth_required"
  | "unavailable";

export type TeamMutationResult =
  | { ok: true }
  | { ok: false; code: TeamFailureCode };

export type InviteMutationResult =
  | { ok: true; delivery: "sent" | "failed" }
  | { ok: false; code: TeamFailureCode };

export type InviteAcceptanceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; code: TeamFailureCode };

type ActorWorkspace = {
  actorRole: WorkspaceRole;
  workspaceName: string;
};

type MembershipPair = {
  actorRole: WorkspaceRole;
  targetRole: WorkspaceRole;
  targetEmail: string;
  targetName: string | null;
  actorEmail?: string;
  workspaceName: string;
};

type InviteRow = {
  inviteId: string;
  workspaceId: string;
  emailNormalized: string;
  role: WorkspaceRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

export async function getWorkspaceTeam(input: {
  actorUserId: string;
  workspaceId: string;
}): Promise<WorkspaceTeam | null> {
  if (!validId(input.actorUserId) || !validId(input.workspaceId)) return null;
  const pool = getPool();
  if (!pool) return null;
  try {
    const actor = await pool.query<ActorWorkspace>(
      `SELECT
         membership.role AS "actorRole",
         workspace.name AS "workspaceName"
       FROM workspace_members AS membership
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
       WHERE membership.user_id = $1
         AND membership.workspace_id = $2
         AND membership.status = 'active'
         AND membership.role IN ('owner', 'admin')
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
       LIMIT 1`,
      [input.actorUserId, input.workspaceId],
    );
    const workspace = actor.rows[0];
    if (
      !workspace
      || (workspace.actorRole !== "owner" && workspace.actorRole !== "admin")
    ) {
      return null;
    }
    const [members, invites] = await Promise.all([
      pool.query<WorkspaceTeamMember>(
        `SELECT
           account.id::TEXT AS "userId",
           COALESCE(account.display_name, account.full_name) AS "displayName",
           account.email,
           membership.role,
           membership.joined_at AS "joinedAt"
         FROM workspace_members AS membership
         JOIN users AS account ON account.id = membership.user_id
         WHERE membership.workspace_id = $1
           AND membership.status = 'active'
           AND account.status = 'active'
         ORDER BY
           (membership.role = 'owner') DESC,
           LOWER(account.email),
           account.id`,
        [input.workspaceId],
      ),
      pool.query<WorkspaceTeamInvite>(
        `SELECT
           invite.id::TEXT AS id,
           invite.email_normalized AS email,
           invite.role,
           invite.expires_at AS "expiresAt",
           invite.send_status AS "sendStatus"
         FROM workspace_invites AS invite
         WHERE invite.workspace_id = $1
           AND invite.accepted_at IS NULL
           AND invite.revoked_at IS NULL
           AND invite.expires_at > NOW()
         ORDER BY invite.created_at DESC`,
        [input.workspaceId],
      ),
    ]);
    return {
      workspaceId: input.workspaceId,
      workspaceName: workspace.workspaceName,
      actorRole: workspace.actorRole,
      members: members.rows.filter((member) => isWorkspaceRole(member.role)),
      invites: invites.rows.filter((invite) =>
        isInvitableRole(invite.role)
        && ["pending", "sent", "failed"].includes(invite.sendStatus)
      ),
    } as WorkspaceTeam;
  } catch (error) {
    logError("auth_v2.workspace_team_read_failed", error);
    return null;
  }
}

export async function inviteWorkspaceMember(input: {
  actorUserId: string;
  workspaceId: string;
  email: unknown;
  role: WorkspaceRole;
  now?: Date;
}): Promise<InviteMutationResult> {
  let now = input.now ?? new Date();
  const email = normalizeAuthEmail(input.email);
  if (
    !validId(input.actorUserId)
    || !validId(input.workspaceId)
    || !email
    || !isInvitableRole(input.role)
    || !Number.isFinite(now.getTime())
  ) {
    return { ok: false, code: "invalid" };
  }
  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  const token = randomBytes(32).toString("hex");
  let inviteId: string | null = null;
  let workspaceName: string | null = null;
  const targetBoundary = email.normalized.toLowerCase();

  try {
    await client.query("BEGIN");
    const actor = await lockActorWorkspace(
      client,
      input.actorUserId,
      input.workspaceId,
    );
    if (!actor || !canInviteRole(actor.actorRole, input.role)) {
      await client.query("ROLLBACK");
      return { ok: false, code: "denied" };
    }
    workspaceName = actor.workspaceName;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`auth-workspace-invite:${input.workspaceId}:${targetBoundary}`],
    );
    if (input.now === undefined) now = new Date();
    const workspaceAllowed = await consumeAuthRateLimit(client, {
      scope: "workspace_invite",
      keyHash: hashAuthRateLimitBoundary(
        "workspace-invite-workspace",
        input.workspaceId,
      ),
      windowSeconds: 3_600,
      limit: 20,
      now,
    });
    if (!workspaceAllowed) {
      await client.query("COMMIT");
      return { ok: false, code: "rate_limited" };
    }
    const targetAllowed = await consumeAuthRateLimit(client, {
      scope: "workspace_invite",
      keyHash: hashAuthRateLimitBoundary(
        "workspace-invite-target",
        `${input.workspaceId}:${targetBoundary}`,
      ),
      windowSeconds: 86_400,
      limit: 3,
      now,
    });
    if (!targetAllowed) {
      await client.query("COMMIT");
      return { ok: false, code: "rate_limited" };
    }
    const existingMember = await client.query(
      `SELECT 1
       FROM workspace_members AS membership
       JOIN users AS account ON account.id = membership.user_id
       WHERE membership.workspace_id = $1
         AND membership.status = 'active'
         AND account.status = 'active'
         AND (
           account.email_normalized = $2
           OR LOWER(account.email) = LOWER($2)
         )
       LIMIT 1`,
      [input.workspaceId, email.normalized],
    );
    if ((existingMember.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict" };
    }
    await client.query(
      `WITH revoked AS (
          UPDATE workspace_invites
          SET revoked_at = GREATEST($3::TIMESTAMPTZ, created_at)
          WHERE workspace_id = $1
            AND LOWER(email_normalized) = LOWER($2)
            AND accepted_at IS NULL
            AND revoked_at IS NULL
          RETURNING id, revoked_at
       )
       INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         subject_hash,
         metadata,
         created_at
       )
       SELECT
         'invite_revoked',
         $4,
         $1,
         $5,
         JSONB_BUILD_OBJECT(
           'reason_code',
           'replaced',
           'source',
           'web'
         ),
          revoked.revoked_at
        FROM revoked`,
      [
        input.workspaceId,
        email.normalized,
        now,
        input.actorUserId,
        hashAuditSubject("email", email.normalized),
      ],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO workspace_invites (
         workspace_id,
         email_normalized,
         role,
         token_hash,
         invited_by,
         expires_at,
         send_status,
         created_at
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6::TIMESTAMPTZ + INTERVAL '24 hours',
         'pending',
         $6
       )
       RETURNING id::TEXT AS id`,
      [
        input.workspaceId,
        email.normalized,
        input.role,
        hashToken(token),
        input.actorUserId,
        now,
      ],
    );
    inviteId = inserted.rows[0]?.id ?? null;
    if (!inviteId) throw new Error("Workspace invite was not created.");
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         subject_hash,
         metadata,
         created_at
       )
       VALUES (
         'invite_created',
         $1,
         $2,
         $3,
         JSONB_BUILD_OBJECT(
           'invite_role',
           $4::TEXT,
           'source',
           'web'
         ),
         $5
       )`,
      [
        input.actorUserId,
        input.workspaceId,
        hashAuditSubject("email", email.normalized),
        input.role,
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.workspace_invite_create_failed", error);
    return { ok: false, code: isUniqueViolation(error) ? "conflict" : "unavailable" };
  } finally {
    client.release();
  }

  const message = renderAuthEmail({
    template: "workspace_invite",
    actionUrl: buildFragmentUrl("/auth/invite", token),
    workspaceName,
    expiresInMinutes: INVITE_TTL_HOURS * 60,
  });
  const delivery = await sendEmail({
    ...message,
    to: email.normalized,
  }).catch((error) => {
    logError("auth_v2.workspace_invite_email_failed", error);
    return { ok: false as const, reason: "send_failed" as const };
  });
  const sendStatus = delivery.ok ? "sent" : "failed";
  await getPool()?.query(
    `UPDATE workspace_invites
     SET send_status = $1,
         last_sent_at = CASE
           WHEN $1 = 'sent' THEN $2::TIMESTAMPTZ
           ELSE NULL
         END
     WHERE id = $3`,
    [sendStatus, now, inviteId],
  ).catch((error) => {
    logError("auth_v2.workspace_invite_delivery_status_failed", error);
  });
  if (!delivery.ok) {
    logWarn("auth_v2.workspace_invite_not_sent", {
      reasonCode: delivery.reason,
    });
  }
  return { ok: true, delivery: sendStatus };
}

export async function acceptWorkspaceInvite(input: {
  token: string;
  session: TeamSessionContext;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<InviteAcceptanceResult> {
  const token = input.token.trim();
  const now = input.now ?? new Date();
  if (
    !TOKEN_PATTERN.test(token)
    || !validId(input.session.id)
    || !validId(input.session.userId)
    || !Number.isFinite(now.getTime())
  ) {
    return { ok: false, code: "invalid" };
  }
  if (!isAuthWorkspacesV2EnabledForUser(
    input.session.userId,
    input.env ?? process.env,
  )) {
    return { ok: false, code: "unavailable" };
  }
  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query<InviteRow>(
      `SELECT
         invite.id::TEXT AS "inviteId",
         invite.workspace_id::TEXT AS "workspaceId",
         invite.email_normalized AS "emailNormalized",
         invite.role,
         invite.expires_at AS "expiresAt",
         invite.accepted_at AS "acceptedAt",
         invite.revoked_at AS "revokedAt"
       FROM workspace_invites AS invite
       JOIN workspaces AS workspace ON workspace.id = invite.workspace_id
       WHERE invite.token_hash = $1
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
       LIMIT 1
       FOR UPDATE OF invite, workspace`,
      [hashToken(token)],
    );
    const invite = inviteResult.rows[0];
    if (
      !invite
      || !isInvitableRole(invite.role)
      || invite.acceptedAt
      || invite.revokedAt
      || invite.expiresAt.getTime() <= now.getTime()
    ) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid" };
    }
    const accountResult = await client.query<{
      email: string;
      emailNormalized: string | null;
    }>(
      `SELECT
         account.email,
         account.email_normalized AS "emailNormalized"
       FROM users AS account
       WHERE account.id = $1
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       FOR UPDATE`,
      [input.session.userId],
    );
    const account = accountResult.rows[0];
    if (!account || !emailMatches(account, invite.emailNormalized)) {
      await client.query("ROLLBACK");
      return { ok: false, code: "email_mismatch" };
    }
    const activeMembership = await client.query(
      `SELECT 1
       FROM workspace_members
       WHERE workspace_id = $1
         AND user_id = $2
         AND status = 'active'
       LIMIT 1`,
      [invite.workspaceId, input.session.userId],
    );
    if ((activeMembership.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict" };
    }
    await client.query(
      `INSERT INTO workspace_members (
         workspace_id,
         user_id,
         role,
         status,
         joined_at,
         invited_by,
         updated_at
       )
       SELECT
         invite.workspace_id,
         $2,
         invite.role,
         'active',
         $3,
         invite.invited_by,
         $3
       FROM workspace_invites AS invite
       WHERE invite.id = $1
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET
         role = EXCLUDED.role,
         status = 'active',
         invited_by = EXCLUDED.invited_by,
         updated_at = GREATEST(
           workspace_members.joined_at,
           workspace_members.updated_at,
           EXCLUDED.updated_at
         )`,
      [invite.inviteId, input.session.userId, now],
    );
    const accepted = await client.query(
      `UPDATE workspace_invites
       SET accepted_at = $2,
           accepted_by = $3
       WHERE id = $1
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > $2`,
      [invite.inviteId, now, input.session.userId],
    );
    if ((accepted.rowCount ?? 0) !== 1) {
      throw new Error("Workspace invite lost its single-use race.");
    }
    await client.query(
      `INSERT INTO auth_security_events (
         event_type,
         user_id,
         workspace_id,
         session_id,
         target_user_id,
         metadata,
         created_at
       )
       VALUES (
         'invite_accepted',
         $1,
         $2,
         $3,
         $1,
         JSONB_BUILD_OBJECT(
           'invite_role',
           $4::TEXT,
           'source',
           'web'
         ),
         $5
       )`,
      [
        input.session.userId,
        invite.workspaceId,
        input.session.id,
        invite.role,
        now,
      ],
    );
    await client.query("COMMIT");
    return { ok: true, workspaceId: invite.workspaceId };
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.workspace_invite_accept_failed", error);
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }
}

export async function revokeWorkspaceInvite(input: {
  actorUserId: string;
  workspaceId: string;
  inviteId: string;
  now?: Date;
}): Promise<TeamMutationResult> {
  const now = input.now ?? new Date();
  if (
    !validId(input.actorUserId)
    || !validId(input.workspaceId)
    || !validId(input.inviteId)
  ) {
    return { ok: false, code: "invalid" };
  }
  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  try {
    await client.query("BEGIN");
    const actor = await lockActorWorkspace(client, input.actorUserId, input.workspaceId);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, code: "denied" };
    }
    const revoked = await client.query<{ emailNormalized: string }>(
      `UPDATE workspace_invites
       SET revoked_at = $4
       WHERE id = $3
         AND workspace_id = $2
         AND accepted_at IS NULL
         AND revoked_at IS NULL
       RETURNING email_normalized AS "emailNormalized"`,
      [input.actorUserId, input.workspaceId, input.inviteId, now],
    );
    const row = revoked.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid" };
    }
    await client.query(
      `INSERT INTO auth_security_events (
         event_type, user_id, workspace_id, subject_hash, metadata, created_at
       )
       VALUES (
         'invite_revoked', $1, $2, $3,
         JSONB_BUILD_OBJECT('reason_code', 'manual', 'source', 'web'), $4
       )`,
      [
        input.actorUserId,
        input.workspaceId,
        hashAuditSubject("email", row.emailNormalized),
        now,
      ],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.workspace_invite_revoke_failed", error);
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }
}

export async function changeWorkspaceMemberRole(input: {
  actorUserId: string;
  workspaceId: string;
  targetUserId: string;
  role: WorkspaceRole;
  now?: Date;
}): Promise<TeamMutationResult> {
  const now = input.now ?? new Date();
  if (
    !validId(input.actorUserId)
    || !validId(input.workspaceId)
    || !validId(input.targetUserId)
    || input.actorUserId === input.targetUserId
  ) {
    return { ok: false, code: "denied" };
  }
  if (!isInvitableRole(input.role)) return { ok: false, code: "invalid" };
  return mutateMember({
    ...input,
    now,
    kind: "role",
  });
}

export async function removeWorkspaceMember(input: {
  actorUserId: string;
  workspaceId: string;
  targetUserId: string;
  now?: Date;
}): Promise<TeamMutationResult> {
  const now = input.now ?? new Date();
  if (
    !validId(input.actorUserId)
    || !validId(input.workspaceId)
    || !validId(input.targetUserId)
    || input.actorUserId === input.targetUserId
  ) {
    return { ok: false, code: "denied" };
  }
  return mutateMember({
    ...input,
    now,
    role: null,
    kind: "remove",
  });
}

export async function transferWorkspaceOwnership(input: {
  session: TeamSessionContext;
  targetUserId: string;
  now?: Date;
}): Promise<TeamMutationResult> {
  const now = input.now ?? new Date();
  const workspaceId = input.session.workspaceId;
  if (
    !workspaceId
    || !validId(workspaceId)
    || !validId(input.session.id)
    || !validId(input.session.userId)
    || !validId(input.targetUserId)
    || input.session.userId === input.targetUserId
  ) {
    return { ok: false, code: "invalid" };
  }
  try {
    requireRecentAuthentication(input.session, now);
  } catch (error) {
    if (error instanceof RecentAuthenticationRequiredError) {
      return { ok: false, code: "reauth_required" };
    }
    return { ok: false, code: "unavailable" };
  }
  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  let pair: MembershipPair | null = null;
  try {
    await client.query("BEGIN");
    const lockedAccounts = await client.query(
      `SELECT account.id
       FROM users AS account
       WHERE account.id IN ($1, $2)
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       ORDER BY account.id
       FOR UPDATE OF account`,
      [input.session.userId, input.targetUserId],
    );
    if ((lockedAccounts.rowCount ?? 0) !== 2) {
      await client.query("ROLLBACK");
      return { ok: false, code: "denied" };
    }
    pair = await lockMembershipPair(
      client,
      input.session.userId,
      workspaceId,
      input.targetUserId,
    );
    if (!pair || pair.actorRole !== "owner" || pair.targetRole === "owner") {
      await client.query("ROLLBACK");
      return { ok: false, code: "denied" };
    }
    await client.query(
      `UPDATE workspace_members
       SET role = CASE
         WHEN user_id = $2 THEN 'admin'
         WHEN user_id = $3 THEN 'owner'
         ELSE role
       END,
       updated_at = GREATEST(updated_at, $4::TIMESTAMPTZ)
       WHERE workspace_id = $1
         AND user_id IN ($2, $3)
         AND status = 'active'`,
      [workspaceId, input.session.userId, input.targetUserId, now],
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = GREATEST(created_at, $4::TIMESTAMPTZ),
           revoke_reason = 'security_action'
       WHERE workspace_id = $1
         AND user_id IN ($2, $3)
         AND revoked_at IS NULL`,
      [workspaceId, input.session.userId, input.targetUserId, now],
    );
    await client.query(
      `INSERT INTO auth_security_events (
         event_type, user_id, workspace_id, session_id, target_user_id,
         metadata, created_at
       )
       VALUES (
         'ownership_transferred', $1, $2, $3, $4,
         JSONB_BUILD_OBJECT(
           'previous_role', $5::TEXT,
           'new_role', 'owner',
           'source', 'web'
         ),
         $6
       )`,
      [
        input.session.userId,
        workspaceId,
        input.session.id,
        input.targetUserId,
        pair.targetRole,
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.workspace_ownership_transfer_failed", error);
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }
  await sendTeamNotice(
    "workspace_ownership_transferred",
    [pair.actorEmail, pair.targetEmail].filter((email): email is string => Boolean(email)),
    pair.workspaceName,
  );
  return { ok: true };
}

async function mutateMember(input: {
  actorUserId: string;
  workspaceId: string;
  targetUserId: string;
  role: WorkspaceRole | null;
  now: Date;
  kind: "role" | "remove";
}): Promise<TeamMutationResult> {
  const client = await getClient().catch(() => null);
  if (!client) return { ok: false, code: "unavailable" };
  let pair: MembershipPair | null = null;
  try {
    await client.query("BEGIN");
    pair = await lockMembershipPair(
      client,
      input.actorUserId,
      input.workspaceId,
      input.targetUserId,
    );
    if (!pair || !canManageTarget(pair.actorRole, pair.targetRole, input.role)) {
      await client.query("ROLLBACK");
      return { ok: false, code: "denied" };
    }
    if (input.kind === "role" && input.role) {
      await client.query(
        `UPDATE workspace_members
         SET role = $3,
             updated_at = GREATEST(updated_at, $4::TIMESTAMPTZ)
         WHERE workspace_id = $1
           AND user_id = $2
           AND status = 'active'
           AND role <> 'owner'`,
        [
          input.workspaceId,
          input.targetUserId,
          input.role,
          input.now,
        ],
      );
    } else {
      await client.query(
        `UPDATE workspace_members
         SET status = 'removed',
             updated_at = GREATEST(updated_at, $3::TIMESTAMPTZ)
         WHERE workspace_id = $1
           AND user_id = $2
           AND status = 'active'
           AND role <> 'owner'`,
        [
          input.workspaceId,
          input.targetUserId,
          input.now,
        ],
      );
    }
    await client.query(
      `UPDATE auth_sessions AS session
       SET revoked_at = GREATEST(
             session.created_at,
             $3::TIMESTAMPTZ
           ),
           revoke_reason = 'workspace_access_lost'
       WHERE session.workspace_id = $1
         AND session.user_id = $2
         AND session.revoked_at IS NULL`,
      [
        input.workspaceId,
        input.targetUserId,
        input.now,
      ],
    );
    const eventType = input.kind === "role"
      ? "membership_role_changed"
      : "membership_removed";
    const metadata = input.kind === "role"
      ? {
          previous_role: pair.targetRole,
          new_role: input.role,
          source: "web",
        }
      : {
          previous_role: pair.targetRole,
          reason_code: "manual",
          source: "web",
        };
    await client.query(
      `INSERT INTO auth_security_events (
         event_type, user_id, workspace_id, target_user_id, metadata, created_at
       )
       VALUES ($1, $2, $3, $4, $5::JSONB, $6)`,
      [
        eventType,
        input.actorUserId,
        input.workspaceId,
        input.targetUserId,
        JSON.stringify(metadata),
        input.now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.workspace_member_mutation_failed", error, {
      reasonCode: input.kind,
    });
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }
  await sendTeamNotice(
    input.kind === "role" ? "workspace_role_changed" : "workspace_removed",
    [pair.targetEmail],
    pair.workspaceName,
  );
  return { ok: true };
}

async function lockActorWorkspace(
  client: PoolClient,
  actorUserId: string,
  workspaceId: string,
): Promise<ActorWorkspace | null> {
  const result = await client.query<ActorWorkspace>(
    `SELECT
       membership.role AS "actorRole",
       workspace.name AS "workspaceName"
     FROM workspace_members AS membership
     JOIN workspaces AS workspace
       ON workspace.id = membership.workspace_id
     WHERE membership.user_id = $1
       AND membership.workspace_id = $2
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin')
       AND workspace.status = 'active'
       AND workspace.deleted_at IS NULL
     FOR UPDATE OF membership, workspace`,
    [actorUserId, workspaceId],
  );
  return result.rows[0] ?? null;
}

async function lockMembershipPair(
  client: PoolClient,
  actorUserId: string,
  workspaceId: string,
  targetUserId: string,
): Promise<MembershipPair | null> {
  const result = await client.query<MembershipPair>(
    `SELECT
       actor_membership.role AS "actorRole",
       target_membership.role AS "targetRole",
       target_account.email AS "targetEmail",
       COALESCE(target_account.display_name, target_account.full_name) AS "targetName",
       actor_account.email AS "actorEmail",
       workspace.name AS "workspaceName"
     FROM workspace_members AS actor_membership
     JOIN workspace_members AS target_membership
       ON target_membership.workspace_id = actor_membership.workspace_id
     JOIN users AS actor_account ON actor_account.id = actor_membership.user_id
     JOIN users AS target_account ON target_account.id = target_membership.user_id
     JOIN workspaces AS workspace ON workspace.id = actor_membership.workspace_id
     WHERE actor_membership.user_id = $1
       AND actor_membership.workspace_id = $2
       AND target_membership.user_id = $3
       AND actor_membership.status = 'active'
       AND target_membership.status = 'active'
       AND actor_membership.role IN ('owner', 'admin')
       AND workspace.status = 'active'
       AND workspace.deleted_at IS NULL
         FOR UPDATE OF actor_membership, target_membership, workspace`,
    [actorUserId, workspaceId, targetUserId],
  );
  return result.rows[0] ?? null;
}

function canInviteRole(actorRole: WorkspaceRole, inviteRole: WorkspaceRole): boolean {
  if (actorRole === "owner") return isInvitableRole(inviteRole);
  return actorRole === "admin"
    && ["recruiter", "viewer", "billing"].includes(inviteRole);
}

function canManageTarget(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  nextRole: WorkspaceRole | null,
): boolean {
  if (targetRole === "owner" || nextRole === "owner") return false;
  if (actorRole === "owner") return true;
  return (
    actorRole === "admin"
    && targetRole !== "admin"
    && nextRole !== "admin"
  );
}

function emailMatches(
  account: { email: string; emailNormalized: string | null },
  inviteEmail: string,
): boolean {
  const expected = inviteEmail.toLocaleLowerCase("en-US");
  return (
    account.email.toLocaleLowerCase("en-US") === expected
    || account.emailNormalized?.toLocaleLowerCase("en-US") === expected
  );
}

function isInvitableRole(role: WorkspaceRole): role is Exclude<WorkspaceRole, "owner"> {
  return INVITABLE_ROLES.has(role);
}

function isWorkspaceRole(role: string): role is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(role);
}

function validId(value: string): boolean {
  if (!POSITIVE_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
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

async function sendTeamNotice(
  template: AuthEmailTemplateName,
  recipients: string[],
  workspaceName: string,
): Promise<void> {
  const message = renderAuthEmail({ template, workspaceName });
  await Promise.all(recipients.map(async (to) => {
    await sendEmail({ ...message, to }).catch((error) => {
      logError("auth_v2.workspace_team_notice_failed", error);
    });
  }));
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
