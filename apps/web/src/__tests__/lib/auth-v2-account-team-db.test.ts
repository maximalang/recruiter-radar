import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { getPool } from "@/lib/db-pool";
import { readTestEmailOutbox } from "@/lib/email/transport";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  confirmAccountEmailChange,
  requestAccountDeletion,
  requestAccountEmailChange,
} from "@/lib/auth-v2/account-security";
import {
  saveOnboardingProgress,
  type OnboardingDbClient,
} from "@/lib/auth-v2/onboarding";
import {
  changeActiveWorkspace,
  createAuthSession,
  listAuthSessions,
  readAuthSession,
  revokeAllAuthSessions,
  rotateAuthSession,
  type AuthSession,
} from "@/lib/auth-v2/sessions";
import {
  acceptWorkspaceInvite,
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
} from "@/lib/auth-v2/workspace-team";

const { hasPremiumEntitlement } =
  jest.requireActual<typeof import("@/lib/db")>("@/lib/db");
const execFileAsync = promisify(execFile);
const describeDatabase =
  process.env.AUTH_V2_ACCOUNT_TEAM_DB_TEST === "true"
    ? describe
    : describe.skip;
const purgeScript = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "purge-auth-v2-accounts.mjs",
);
const downMigration = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729130000_add_auth_account_security_and_team.down.sql",
);
const activeOwnerGuardDownMigration = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729131000_guard_auth_active_owner_writes.down.sql",
);

type Fixture = {
  email: string;
  userId: string;
  workspaceId: string;
  session: AuthSession;
  token: string;
};

type AccountState = {
  email: string;
  normalized: string;
  displayName: string | null;
  fullName: string | null;
  status: string;
  requestStatus: string;
  workspaceStatus: string;
  activeSessions: number;
  subscriptionCount: number;
};

describeDatabase("auth v2 account and team PostgreSQL integration", () => {
  const pool = getPool();
  let sequence = 0;

  beforeAll(async () => {
    if (!pool) throw new Error("DATABASE_URL is required.");
    const database = await pool.query<{ name: string }>(
      "SELECT CURRENT_DATABASE() AS name",
    );
    if (!/^auth_v2_test_account_team_[a-z0-9_]+$/.test(
      database.rows[0]?.name ?? "",
    )) {
      throw new Error(
        "Refusing to run outside auth_v2_test_account_team_<suffix>.",
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("email change confirms once, preserves only the current session, and audits once", async () => {
    const account = await createFixture("email-owner");
    const otherSession = await createAuthSession({
      userId: account.userId,
      authMethod: "magic_link",
      requestIpHash: "1".repeat(64),
      userAgentHash: "2".repeat(64),
      sessionEnvironment: {
        deviceLabel: "Ноутбук",
        browserLabel: "Firefox",
        environmentLabel: "Windows",
      },
    });
    expect(otherSession).not.toBeNull();
    const conflict = await createFixture("email-conflict");

    await expect(requestAccountEmailChange({
      session: account.session,
      newEmail: conflict.email,
    })).resolves.toEqual({ ok: true });

    const newEmail = uniqueEmail("email-confirmed");
    await expect(requestAccountEmailChange({
      session: account.session,
      newEmail,
    })).resolves.toEqual({ ok: true });

    const before = await pool!.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1",
      [account.userId],
    );
    expect(before.rows[0]?.email).toBe(account.email);

    const token = await tokenFromOutbox(newEmail, "/auth/change-email");
    const confirmations = await Promise.all([
      confirmAccountEmailChange({
        token,
        currentSession: account.session,
        currentSessionToken: account.token,
      }),
      confirmAccountEmailChange({
        token,
        currentSession: account.session,
        currentSessionToken: account.token,
      }),
    ]);
    expect(confirmations.filter((result) => result.ok)).toHaveLength(1);
    const confirmed = confirmations.find((result) => result.ok);
    expect(confirmed).toEqual({
      ok: true,
      preservedCurrentSession: true,
      sessionToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(confirmations).toContainEqual({ ok: false, code: "invalid" });
    if (!confirmed?.ok || !confirmed.preservedCurrentSession) {
      throw new Error("Email confirmation did not rotate the current session.");
    }
    await expect(readAuthSession(account.token)).resolves.toBeNull();
    await expect(readAuthSession(confirmed.sessionToken)).resolves.toMatchObject({
      id: account.session.id,
      userId: account.userId,
    });

    const after = await pool!.query<{
      email: string;
      normalized: string;
      changedEvents: number;
      activeSessions: number;
      currentActive: boolean;
      otherRevoked: boolean;
    }>(
      `SELECT
         account.email,
         account.email_normalized AS normalized,
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_security_events AS event
           WHERE event.event_type = 'email_changed'
             AND event.user_id = account.id
         ) AS "changedEvents",
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_sessions AS session
           WHERE session.user_id = account.id
             AND session.revoked_at IS NULL
         ) AS "activeSessions",
         EXISTS (
           SELECT 1 FROM auth_sessions
           WHERE id = $2 AND revoked_at IS NULL
         ) AS "currentActive",
         EXISTS (
           SELECT 1 FROM auth_sessions
           WHERE id = $3 AND revoked_at IS NOT NULL
         ) AS "otherRevoked"
       FROM users AS account
       WHERE account.id = $1`,
      [account.userId, account.session.id, otherSession!.session.id],
    );
    expect(after.rows[0]).toEqual({
      email: newEmail,
      normalized: newEmail,
      changedEvents: 1,
      activeSessions: 1,
      currentActive: true,
      otherRevoked: true,
    });

    const summaries = await listAuthSessions({
      userId: account.userId,
      currentSessionId: account.session.id,
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: account.session.id,
      current: true,
    });
    expect(summaries[0]).not.toHaveProperty("requestIpHash");
    expect(summaries[0]).not.toHaveProperty("userAgentHash");
  });

  test("logout-all invalidates a pending email-change challenge", async () => {
    const account = await createFixture("email-revoke");
    const newEmail = uniqueEmail("email-revoke-target");
    await expect(requestAccountEmailChange({
      session: account.session,
      newEmail,
    })).resolves.toEqual({ ok: true });
    const token = await tokenFromOutbox(newEmail, "/auth/change-email");

    await expect(revokeAllAuthSessions({
      userId: account.userId,
    })).resolves.toBe(1);
    await expect(confirmAccountEmailChange({
      token,
      currentSession: null,
      currentSessionToken: null,
    })).resolves.toEqual({ ok: false, code: "invalid" });

    const challenge = await pool!.query<{ invalidated: boolean }>(
      `SELECT invalidated_at IS NOT NULL AS invalidated
       FROM auth_challenges
       WHERE token_hash = ENCODE(DIGEST($1, 'sha256'), 'hex')`,
      [token],
    );
    expect(challenge.rows[0]?.invalidated).toBe(true);
  });

  test("a previous grace token cannot confirm or rotate a session during email change", async () => {
    const account = await createFixture("email-grace");
    const rotated = await rotateAuthSession(account.token, new Date(), {
      force: true,
    });
    expect(rotated).not.toBeNull();
    const previousTokenSession = await readAuthSession(
      account.token,
      new Date(),
    );
    expect(previousTokenSession?.id).toBe(account.session.id);

    const newEmail = uniqueEmail("email-grace-confirmed");
    await expect(requestAccountEmailChange({
      session: account.session,
      newEmail,
    })).resolves.toEqual({ ok: true });
    const token = await tokenFromOutbox(newEmail, "/auth/change-email");

    await expect(confirmAccountEmailChange({
      token,
      currentSession: previousTokenSession,
      currentSessionToken: account.token,
    })).resolves.toEqual({ ok: false, code: "reauth_required" });
    const unchanged = await pool!.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1",
      [account.userId],
    );
    expect(unchanged.rows[0]?.email).toBe(account.email);

    await expect(confirmAccountEmailChange({
      token,
      currentSession: rotated!.session,
      currentSessionToken: rotated!.token,
    })).resolves.toEqual({
      ok: true,
      preservedCurrentSession: true,
      sessionToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const changed = await pool!.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1",
      [account.userId],
    );
    expect(changed.rows[0]?.email).toBe(newEmail);
  });

  test("workspace invitation rate limits serialize concurrent sends", async () => {
    const owner = await createFixture("invite-rate-owner");
    const email = uniqueEmail("invite-rate-target");

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        inviteWorkspaceMember({
          actorUserId: owner.userId,
          workspaceId: owner.workspaceId,
          email,
          role: "viewer",
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results).toContainEqual({ ok: false, code: "rate_limited" });
    const state = await pool!.query<{
      createdEvents: number;
      bucketHits: number;
      activeInvites: number;
    }>(
      `SELECT
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_security_events
           WHERE event_type = 'invite_created'
             AND workspace_id = $1
         ) AS "createdEvents",
         (
           SELECT MAX(hit_count)::INTEGER
           FROM auth_rate_limit_buckets
           WHERE bucket_scope = 'workspace_invite'
         ) AS "bucketHits",
         (
           SELECT COUNT(*)::INTEGER
           FROM workspace_invites
           WHERE workspace_id = $1
             AND email_normalized = $2
             AND accepted_at IS NULL
             AND revoked_at IS NULL
         ) AS "activeInvites"`,
      [owner.workspaceId, email],
    );
    expect(state.rows[0]).toEqual({
      createdEvents: 3,
      bucketHits: 4,
      activeInvites: 1,
    });
  });

  test("invite replacement clamps a stale timestamp to the replaced invite history", async () => {
    const owner = await createFixture("invite-history-owner");
    const email = uniqueEmail("invite-history-target");
    const later = new Date("2026-07-29T12:01:00.000Z");
    const earlier = new Date("2026-07-29T12:00:00.000Z");

    await expect(inviteWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      email,
      role: "viewer",
      now: later,
    })).resolves.toMatchObject({ ok: true });
    await expect(inviteWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      email,
      role: "viewer",
      now: earlier,
    })).resolves.toMatchObject({ ok: true });

    const history = await pool!.query<{
      activeInvites: number;
      validRevocations: boolean;
      revokedEvents: number;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE accepted_at IS NULL AND revoked_at IS NULL
         )::INTEGER AS "activeInvites",
         BOOL_AND(
           revoked_at IS NULL OR revoked_at >= created_at
         ) AS "validRevocations",
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_security_events
           WHERE event_type = 'invite_revoked'
             AND workspace_id = $1
         ) AS "revokedEvents"
       FROM workspace_invites
       WHERE workspace_id = $1
         AND email_normalized = $2`,
      [owner.workspaceId, email],
    );
    expect(history.rows[0]).toEqual({
      activeInvites: 1,
      validRevocations: true,
      revokedEvents: 1,
    });
  });

  test("keeps case-distinct invite targets and mailbox identities separate", async () => {
    const owner = await createFixture("invite-case-owner");
    const caseVariant = await createFixture("invite-case-variant");
    const foldedEmail = uniqueEmail("invite-case-binding");
    const exactEmail = foldedEmail.replace(
      "invite-case-binding-",
      "Invite-Case-Binding-",
    );
    expect(exactEmail).not.toBe(foldedEmail);

    await pool!.query(
      `UPDATE users
       SET email = $2, email_normalized = $2, updated_at = NOW()
       WHERE id = $1`,
      [caseVariant.userId, foldedEmail],
    );

    await expect(inviteWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      email: exactEmail,
      role: "recruiter",
    })).resolves.toEqual({ ok: true, delivery: "sent" });
    const exactToken = await tokenFromOutbox(exactEmail, "/auth/invite");

    await expect(inviteWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      email: foldedEmail,
      role: "viewer",
    })).resolves.toEqual({ ok: true, delivery: "sent" });
    const foldedToken = await tokenFromOutbox(foldedEmail, "/auth/invite");

    const activeInvites = await pool!.query<{ email: string }>(
      `SELECT email_normalized AS email
       FROM workspace_invites
       WHERE workspace_id = $1
         AND accepted_at IS NULL
         AND revoked_at IS NULL
       ORDER BY email_normalized`,
      [owner.workspaceId],
    );
    expect(activeInvites.rows.map((row) => row.email).sort()).toEqual(
      [exactEmail, foldedEmail].sort(),
    );

    await expect(acceptWorkspaceInvite({
      token: exactToken,
      session: caseVariant.session,
    })).resolves.toEqual({ ok: false, code: "email_mismatch" });
    await expect(acceptWorkspaceInvite({
      token: foldedToken,
      session: caseVariant.session,
    })).resolves.toEqual({ ok: true, workspaceId: owner.workspaceId });
  });

  test("invite email binding, single use, role ceilings, removal, and ownership transfer are atomic", async () => {
    const owner = await createFixture("team-owner");
    const invited = await createFixture("team-invited");
    const wrongAccount = await createFixture("team-wrong");
    const secondAdmin = await createFixture("team-admin");
    const transferredDelivery = await createDeliveryFixture(owner);

    await expect(inviteWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      email: invited.email,
      role: "recruiter",
    })).resolves.toEqual({ ok: true, delivery: "sent" });
    const token = await tokenFromOutbox(invited.email, "/auth/invite");

    await expect(acceptWorkspaceInvite({
      token,
      session: wrongAccount.session,
    })).resolves.toEqual({ ok: false, code: "email_mismatch" });

    const acceptances = await Promise.all([
      acceptWorkspaceInvite({ token, session: invited.session }),
      acceptWorkspaceInvite({ token, session: invited.session }),
    ]);
    expect(acceptances.filter((result) => result.ok)).toHaveLength(1);
    expect(acceptances).toContainEqual({
      ok: true,
      workspaceId: owner.workspaceId,
    });
    expect(acceptances).toContainEqual({ ok: false, code: "invalid" });
    await expect(acceptWorkspaceInvite({
      token,
      session: invited.session,
    })).resolves.toEqual({ ok: false, code: "invalid" });

    const switchedInvited = await changeActiveWorkspace({
      token: invited.token,
      workspaceId: owner.workspaceId,
    });
    expect(switchedInvited).not.toBeNull();
    invited.session = switchedInvited!.session;
    invited.token = switchedInvited!.token;

    await pool!.query(
      `INSERT INTO workspace_members (
         workspace_id, user_id, role, status, joined_at, updated_at
       )
       VALUES ($1, $2, 'admin', 'active', NOW(), NOW())`,
      [owner.workspaceId, secondAdmin.userId],
    );
    const switchedSecondAdmin = await changeActiveWorkspace({
      token: secondAdmin.token,
      workspaceId: owner.workspaceId,
    });
    expect(switchedSecondAdmin).not.toBeNull();
    secondAdmin.session = switchedSecondAdmin!.session;
    secondAdmin.token = switchedSecondAdmin!.token;

    await expect(changeWorkspaceMemberRole({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      targetUserId: invited.userId,
      role: "admin",
    })).resolves.toEqual({ ok: true });
    await expect(changeWorkspaceMemberRole({
      actorUserId: invited.userId,
      workspaceId: owner.workspaceId,
      targetUserId: invited.userId,
      role: "admin",
    })).resolves.toEqual({ ok: false, code: "denied" });
    await expect(removeWorkspaceMember({
      actorUserId: invited.userId,
      workspaceId: owner.workspaceId,
      targetUserId: secondAdmin.userId,
    })).resolves.toEqual({ ok: false, code: "denied" });

    await expect(removeWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      targetUserId: secondAdmin.userId,
    })).resolves.toEqual({ ok: true });
    const removedSession = await pool!.query<{ revoked: boolean }>(
      "SELECT revoked_at IS NOT NULL AS revoked FROM auth_sessions WHERE id = $1",
      [secondAdmin.session.id],
    );
    expect(removedSession.rows[0]?.revoked).toBe(true);

    await expect(transferWorkspaceOwnership({
      session: owner.session,
      targetUserId: invited.userId,
    })).resolves.toEqual({ ok: true });
    const ownership = await pool!.query<{
      userId: string;
      role: string;
      revoked: boolean;
    }>(
      `SELECT
         membership.user_id::TEXT AS "userId",
         membership.role,
         session.revoked_at IS NOT NULL AS revoked
       FROM workspace_members AS membership
       JOIN auth_sessions AS session
         ON session.user_id = membership.user_id
        AND session.workspace_id = membership.workspace_id
       WHERE membership.workspace_id = $1
         AND membership.user_id IN ($2, $3)
       ORDER BY membership.user_id`,
      [owner.workspaceId, owner.userId, invited.userId],
    );
    expect(ownership.rows).toEqual(expect.arrayContaining([
      { userId: owner.userId, role: "admin", revoked: true },
      { userId: invited.userId, role: "owner", revoked: true },
    ]));
    const transferEvents = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM auth_security_events
       WHERE event_type = 'ownership_transferred'
         AND user_id = $1
         AND target_user_id = $2
         AND workspace_id = $3`,
      [owner.userId, invited.userId, owner.workspaceId],
    );
    expect(transferEvents.rows[0]?.count).toBe(1);
    const transferredGraph = await pool!.query<{
      profileOwnerId: string;
      providerOwnerId: string;
      ownerRole: string;
    }>(
      `SELECT
         profile.owner_id::TEXT AS "profileOwnerId",
         provider.owner_id::TEXT AS "providerOwnerId",
         membership.role AS "ownerRole"
       FROM client_profiles AS profile
       JOIN notification_provider_accounts AS provider
         ON provider.client_profile_id = profile.id
       JOIN workspace_members AS membership
         ON membership.workspace_id = profile.workspace_id
        AND membership.user_id = $2
       WHERE profile.id = $1`,
      [transferredDelivery.profileId, invited.userId],
    );
    expect(transferredGraph.rows[0]).toEqual({
      profileOwnerId: owner.userId,
      providerOwnerId: owner.userId,
      ownerRole: "owner",
    });

    await expect(requestAccountDeletion({
      session: owner.session,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
    })).resolves.toEqual({
      ok: false,
      code: "workspace_data_transfer_required",
    });
    const graphAfterFormerOwnerDeletion = await pool!.query<{
      profileActive: boolean;
      providerActive: boolean;
      workspaceActive: boolean;
    }>(
      `SELECT
         profile.is_active AS "profileActive",
         provider.status = 'active' AS "providerActive",
         workspace.status = 'active' AS "workspaceActive"
       FROM client_profiles AS profile
       JOIN notification_provider_accounts AS provider
         ON provider.client_profile_id = profile.id
       JOIN workspaces AS workspace
         ON workspace.id = profile.workspace_id
       WHERE profile.id = $1`,
      [transferredDelivery.profileId],
    );
    expect(graphAfterFormerOwnerDeletion.rows[0]).toEqual({
      profileActive: true,
      providerActive: true,
      workspaceActive: true,
    });
  });

  test("invite acceptance and owner deletion serialize on the workspace boundary", async () => {
    const owner = await createFixture("workspace-lock-owner");
    const invited = await createFixture("workspace-lock-invited");

    await expect(inviteWorkspaceMember({
      actorUserId: owner.userId,
      workspaceId: owner.workspaceId,
      email: invited.email,
      role: "recruiter",
    })).resolves.toEqual({ ok: true, delivery: "sent" });
    const inviteToken = await tokenFromOutbox(
      invited.email,
      "/auth/invite",
    );

    const accepted = await runBehindWorkspaceLock(
      owner.workspaceId,
      "FROM workspace_invites AS invite",
      () => acceptWorkspaceInvite({
        token: inviteToken,
        session: invited.session,
      }),
    );
    expect(accepted).toEqual({
      ok: true,
      workspaceId: owner.workspaceId,
    });
    await expect(requestAccountDeletion({
      session: owner.session,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
    })).resolves.toEqual({
      ok: false,
      code: "ownership_transfer_required",
    });

    const soloOwner = await createFixture("workspace-lock-solo-owner");
    const deletion = await runBehindWorkspaceLock(
      soloOwner.workspaceId,
      "FROM workspace_members AS owner_membership",
      () => requestAccountDeletion({
        session: soloOwner.session,
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
      }),
    );
    expect(deletion).toEqual({ ok: true });
  });

  test("deletion requires ownership resolution and purge is explicit, due-only, and ledger-preserving", async () => {
    const due = await createFixture("delete-due");
    const colleague = await createFixture("delete-colleague");
    await pool!.query(
      `INSERT INTO workspace_members (
         workspace_id, user_id, role, status, joined_at, updated_at
       )
       VALUES ($1, $2, 'recruiter', 'active', NOW(), NOW())`,
      [due.workspaceId, colleague.userId],
    );

    await expect(requestAccountDeletion({
      session: due.session,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      env: {
        AUTH_ACCOUNT_RETENTION_POLICY_KEY: "test_policy",
        AUTH_ACCOUNT_PURGE_AFTER_DAYS: "7",
      },
    })).resolves.toEqual({
      ok: false,
      code: "ownership_transfer_required",
    });
    await expect(removeWorkspaceMember({
      actorUserId: due.userId,
      workspaceId: due.workspaceId,
      targetUserId: colleague.userId,
    })).resolves.toEqual({ ok: true });

    await pool!.query(
      `INSERT INTO subscriptions (
         user_id, plan_code, status, started_at, created_at, updated_at
       )
       VALUES ($1, 'auth-purge-test', 'active', NOW(), NOW(), NOW())`,
      [due.userId],
    );
    await expect(hasPremiumEntitlement(Number(due.userId))).resolves.toEqual({
      allowed: true,
      reason: null,
    });
    const deliveryFixture = await createDeliveryFixture(due);
    await expect(requestAccountDeletion({
      session: due.session,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      env: {
        AUTH_ACCOUNT_RETENTION_POLICY_KEY: "test_policy",
        AUTH_ACCOUNT_PURGE_AFTER_DAYS: "7",
      },
    })).resolves.toEqual({ ok: true });
    await expect(hasPremiumEntitlement(Number(due.userId))).resolves.toEqual({
      allowed: false,
      reason: "No active subscription or pilot.",
    });
    const deactivated = await pool!.query<{
      profileInactive: boolean;
      deliveryDisabled: boolean;
      webPushDisabled: boolean;
      emailDisabled: boolean;
      pushRevoked: boolean;
      providerRevoked: boolean;
      endpointRevoked: boolean;
      routeDisabled: boolean;
      jobCancelled: boolean;
      profileContactsCleared: boolean;
      providerSecretPurged: boolean;
      endpointDestinationCleared: boolean;
    }>(
      `SELECT
         NOT profile.is_active AS "profileInactive",
         NOT profile.delivery_enabled AS "deliveryDisabled",
         NOT profile.web_push_enabled AS "webPushDisabled",
         NOT profile.email_digest_enabled AS "emailDisabled",
         subscription.revoked_at IS NOT NULL AS "pushRevoked",
         provider.status = 'revoked' AS "providerRevoked",
         endpoint.status = 'revoked' AS "endpointRevoked",
         route.status = 'disabled' AS "routeDisabled",
         job.status = 'cancelled' AS "jobCancelled",
         profile.digest_email IS NULL
           AND profile.telegram_chat_id IS NULL AS "profileContactsCleared",
         provider.secret_ciphertext = 'purged' AS "providerSecretPurged",
         endpoint.destination_id IS NULL AS "endpointDestinationCleared"
       FROM client_profiles AS profile
       JOIN web_push_subscriptions AS subscription
         ON subscription.client_profile_id = profile.id
       JOIN notification_provider_accounts AS provider
         ON provider.client_profile_id = profile.id
       JOIN notification_endpoints AS endpoint
         ON endpoint.provider_account_id = provider.id
       JOIN notification_routes AS route
         ON route.endpoint_id = endpoint.id
       JOIN notification_delivery_jobs AS job
         ON job.route_id = route.id
       WHERE profile.id = $1`,
      [deliveryFixture.profileId],
    );
    expect(deactivated.rows[0]).toEqual({
      profileInactive: true,
      deliveryDisabled: true,
      webPushDisabled: true,
      emailDisabled: true,
      pushRevoked: true,
      providerRevoked: true,
      endpointRevoked: true,
      routeDisabled: true,
      jobCancelled: true,
      profileContactsCleared: true,
      providerSecretPurged: true,
      endpointDestinationCleared: true,
    });
    await pool!.query(
      `UPDATE account_deletion_requests
       SET requested_at = due.due_at,
           purge_after = due.due_at
       FROM (SELECT clock_timestamp() AS due_at) AS due
       WHERE user_id = $1
         AND status = 'pending'`,
      [due.userId],
    );

    const future = await createFixture("delete-future");
    await expect(requestAccountDeletion({
      session: future.session,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      env: {
        AUTH_ACCOUNT_RETENTION_POLICY_KEY: "test_policy",
        AUTH_ACCOUNT_PURGE_AFTER_DAYS: "30",
      },
    })).resolves.toEqual({ ok: true });
    const inviter = await createFixture("delete-invite-owner");
    await expect(inviteWorkspaceMember({
      actorUserId: inviter.userId,
      workspaceId: inviter.workspaceId,
      email: due.email,
      role: "viewer",
    })).resolves.toEqual({ ok: true, delivery: "sent" });

    const beforeAudit = await securityEventCount(due.userId);
    const dryRun = await runPurge([]);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      mode: "dry-run",
      eligible: 1,
      processed: 0,
    });
    await expect(accountState(due.userId)).resolves.toMatchObject({
      status: "deletion_pending",
      requestStatus: "pending",
    });

    const applied = await runPurge(["--apply"]);
    expect(JSON.parse(applied.stdout)).toMatchObject({
      mode: "apply",
      eligible: 1,
      processed: 1,
    });
    const dueState = await accountState(due.userId);
    expect(dueState).toMatchObject({
      email: `deleted+${due.userId}@deleted.invalid`,
      normalized: `deleted+${due.userId}@deleted.invalid`,
      displayName: null,
      fullName: null,
      status: "deleted",
      requestStatus: "completed",
      workspaceStatus: "deleted",
      activeSessions: 0,
      subscriptionCount: 1,
    });
    const purgedDelivery = await pool!.query<{
      digestEmail: string | null;
      telegramChatId: string | null;
      pushCount: number;
      inviteEmail: string;
    }>(
      `SELECT
         profile.digest_email AS "digestEmail",
         profile.telegram_chat_id::TEXT AS "telegramChatId",
         (
           SELECT COUNT(*)::INTEGER
           FROM web_push_subscriptions
           WHERE client_profile_id = profile.id
         ) AS "pushCount",
         (
           SELECT email_normalized
           FROM workspace_invites
           WHERE workspace_id = $2
             AND invited_by = $3
           ORDER BY id DESC
           LIMIT 1
         ) AS "inviteEmail"
       FROM client_profiles AS profile
       WHERE profile.id = $1`,
      [deliveryFixture.profileId, inviter.workspaceId, inviter.userId],
    );
    expect(purgedDelivery.rows[0]).toEqual({
      digestEmail: null,
      telegramChatId: null,
      pushCount: 0,
      inviteEmail: `deleted+${due.userId}@deleted.invalid`,
    });
    await expect(accountState(future.userId)).resolves.toMatchObject({
      status: "deletion_pending",
      requestStatus: "pending",
      workspaceStatus: "deletion_pending",
    });
    await expect(securityEventCount(due.userId)).resolves.toBe(beforeAudit);
  });

  test("an in-flight owner write serializes before deletion and cannot reactivate delivery afterward", async () => {
    const account = await createFixture("delete-write-race");
    const delivery = await createDeliveryFixture(account);
    const inFlightWriter = await pool!.connect();
    try {
      await inFlightWriter.query("BEGIN");
      await inFlightWriter.query(
        `UPDATE client_profiles
         SET updated_at = updated_at
         WHERE id = $1`,
        [delivery.profileId],
      );

      const deletion = requestAccountDeletion({
        session: account.session,
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
      });
      await expect(Promise.race([
        deletion.then(() => "resolved"),
        delay(100).then(() => "blocked"),
      ])).resolves.toBe("blocked");

      await expect(inFlightWriter.query(
        `UPDATE client_profiles
         SET is_active = TRUE,
             delivery_enabled = TRUE,
             email_digest_enabled = TRUE,
             digest_email = $2
         WHERE id = $1`,
        [delivery.profileId, account.email],
      )).resolves.toMatchObject({ rowCount: 1 });
      await inFlightWriter.query("COMMIT");
      await expect(deletion).resolves.toEqual({ ok: true });

      await expect(pool!.query(
        `UPDATE notification_endpoints
         SET status = 'active',
             destination_id = 'reactivated-destination'
         WHERE id = $1`,
        [delivery.endpointId],
      )).rejects.toMatchObject({ code: "42501" });
      await expect(pool!.query(
        `INSERT INTO lead_channel_deliveries (
           channel, client_profile_id, dedupe_key, lead_count
         )
         VALUES ('email', $1, $2, 1)`,
        [
          delivery.profileId,
          `post-delete-race-${delivery.profileId}`,
        ],
      )).rejects.toMatchObject({ code: "42501" });

      const finalProfile = await pool!.query<{
        active: boolean;
        deliveryEnabled: boolean;
        emailDigestEnabled: boolean;
        digestEmail: string | null;
      }>(
        `SELECT
           is_active AS active,
           delivery_enabled AS "deliveryEnabled",
           email_digest_enabled AS "emailDigestEnabled",
           digest_email AS "digestEmail"
         FROM client_profiles
         WHERE id = $1`,
        [delivery.profileId],
      );
      expect(finalProfile.rows[0]).toEqual({
        active: false,
        deliveryEnabled: false,
        emailDigestEnabled: false,
        digestEmail: null,
      });
    } finally {
      await inFlightWriter.query("ROLLBACK").catch(() => undefined);
      inFlightWriter.release();
    }
  });

  test("a deletion that starts first fences later owner writes without a deadlock", async () => {
    const account = await createFixture("delete-first-race");
    const delivery = await createDeliveryFixture(account);
    const workspaceBlocker = await pool!.connect();
    await workspaceBlocker.query("BEGIN");
    try {
      await workspaceBlocker.query(
        "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
        [account.workspaceId],
      );
      const deletion = requestAccountDeletion({
        session: account.session,
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
      });
      await expect(Promise.race([
        deletion.then(() => "resolved"),
        delay(100).then(() => "blocked"),
      ])).resolves.toBe("blocked");

      const writerOutcome = pool!.query(
        `UPDATE client_profiles
         SET is_active = TRUE,
             delivery_enabled = TRUE
         WHERE id = $1`,
        [delivery.profileId],
      ).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await expect(Promise.race([
        writerOutcome.then(() => "resolved"),
        delay(100).then(() => "blocked"),
      ])).resolves.toBe("blocked");

      await workspaceBlocker.query("COMMIT");
      await expect(deletion).resolves.toEqual({ ok: true });
      await expect(writerOutcome).resolves.toMatchObject({
        ok: false,
        error: { code: "42501" },
      });
    } finally {
      await workspaceBlocker.query("ROLLBACK").catch(() => undefined);
      workspaceBlocker.release();
    }
  });

  test("onboarding takes the owner-write fence before parent locks and cannot deadlock deletion", async () => {
    const account = await createFixture("onboarding-delete-race");
    await pool!.query(
      `UPDATE users
       SET onboarding_status = 'in_progress',
           onboarding_step = 'profile',
           onboarding_data = $2::JSONB,
           updated_at = NOW()
       WHERE id = $1`,
      [
        account.userId,
        JSON.stringify({
          fullName: "Owner",
          agencyName: "Deletion race workspace",
          teamRole: "leader",
        }),
      ],
    );

    const onboardingClient = await pool!.connect();
    let releaseProfileWrite: () => void = () => {};
    const profileWriteGate = new Promise<void>((resolve) => {
      releaseProfileWrite = resolve;
    });
    let markProfileWriteReached: () => void = () => {};
    const profileWriteReached = new Promise<void>((resolve) => {
      markProfileWriteReached = resolve;
    });
    const onboardingDb = {
      query: async (sqlValue: unknown, values?: unknown[]) => {
        const sql = String(sqlValue);
        if (sql.includes("INSERT INTO client_profiles")) {
          markProfileWriteReached();
          await profileWriteGate;
        }
        return onboardingClient.query(sql, values);
      },
    } as unknown as OnboardingDbClient;

    try {
      const onboarding = saveOnboardingProgress({
        userId: account.userId,
        workspaceId: account.workspaceId,
        workspaceName: "Deletion race workspace",
        workspaceRole: "owner",
        sessionId: account.session.id,
      }, {
        step: "profile",
        intent: "next",
        values: {
          specialization: "Product",
          roles: ["product"],
          industries: ["it"],
          geography: "Москва",
          hiringMode: "specialist",
        },
      }, onboardingDb);
      await expect(Promise.race([
        profileWriteReached.then(() => "reached"),
        delay(1_000).then(() => "timed_out"),
      ])).resolves.toBe("reached");

      const deletion = requestAccountDeletion({
        session: account.session,
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
      });
      await expect(Promise.race([
        deletion.then(() => "resolved"),
        delay(100).then(() => "blocked"),
      ])).resolves.toBe("blocked");

      releaseProfileWrite();
      await expect(onboarding).resolves.toMatchObject({
        status: "in_progress",
        step: "complete",
      });
      await expect(deletion).resolves.toEqual({ ok: true });
    } finally {
      releaseProfileWrite();
      await onboardingClient.query("ROLLBACK").catch(() => undefined);
      onboardingClient.release();
    }
  });

  test("guarded child writes remain compatible with a legacy null workspace profile", async () => {
    const account = await createFixture("legacy-null-write");
    const delivery = await createDeliveryFixture(account);
    const legacySeeder = await pool!.connect();
    try {
      await legacySeeder.query("BEGIN");
      await legacySeeder.query(
        "ALTER TABLE notification_provider_accounts DISABLE TRIGGER notification_provider_accounts_assign_workspace",
      );
      await legacySeeder.query(
        "ALTER TABLE notification_provider_accounts DISABLE TRIGGER notification_provider_accounts_require_active_owner",
      );
      await legacySeeder.query(
        "ALTER TABLE client_profiles DISABLE TRIGGER client_profiles_assign_workspace",
      );
      await legacySeeder.query(
        "ALTER TABLE client_profiles DISABLE TRIGGER client_profiles_require_active_owner",
      );
      await legacySeeder.query(
        "UPDATE notification_provider_accounts SET workspace_id = NULL WHERE id = $1",
        [delivery.providerId],
      );
      await legacySeeder.query(
        "UPDATE client_profiles SET workspace_id = NULL WHERE id = $1",
        [delivery.profileId],
      );
      await legacySeeder.query(
        "ALTER TABLE client_profiles ENABLE TRIGGER client_profiles_require_active_owner",
      );
      await legacySeeder.query(
        "ALTER TABLE client_profiles ENABLE TRIGGER client_profiles_assign_workspace",
      );
      await legacySeeder.query(
        "ALTER TABLE notification_provider_accounts ENABLE TRIGGER notification_provider_accounts_require_active_owner",
      );
      await legacySeeder.query(
        "ALTER TABLE notification_provider_accounts ENABLE TRIGGER notification_provider_accounts_assign_workspace",
      );
      await legacySeeder.query("COMMIT");
    } finally {
      await legacySeeder.query("ROLLBACK").catch(() => undefined);
      legacySeeder.release();
    }

    await expect(pool!.query(
      `UPDATE notification_endpoints
       SET destination_label = 'legacy-compatible'
       WHERE id = $1`,
      [delivery.endpointId],
    )).resolves.toMatchObject({ rowCount: 1 });
    const legacyProfile = await pool!.query<{ workspaceId: string | null }>(
      `SELECT workspace_id::TEXT AS "workspaceId"
       FROM client_profiles
       WHERE id = $1`,
      [delivery.profileId],
    );
    expect(legacyProfile.rows[0]?.workspaceId).toBeNull();
  });

  test("rollback refuses live security history and succeeds after disposable fixtures are cleared", async () => {
    const sql = await readFile(downMigration, "utf8");
    const activeOwnerGuardDownSql = await readFile(
      activeOwnerGuardDownMigration,
      "utf8",
    );
    const rollbackClient = await pool!.connect();
    try {
      await expect(rollbackClient.query(sql)).rejects.toThrow(
        /while team audit events exist/,
      );
      await rollbackClient.query("ROLLBACK");

      await rollbackClient.query(
        `ALTER TABLE auth_security_events
         DISABLE TRIGGER auth_security_events_append_only`,
      );
      await rollbackClient.query(
        `DELETE FROM auth_security_events
         WHERE target_user_id IS NOT NULL`,
      );
      await rollbackClient.query(
        `ALTER TABLE auth_security_events
         ENABLE TRIGGER auth_security_events_append_only`,
      );
      await expect(rollbackClient.query(sql)).rejects.toThrow(
        /while account deletion requests exist/,
      );
      await rollbackClient.query("ROLLBACK");

      await rollbackClient.query("DELETE FROM account_deletion_requests");
      await expect(
        rollbackClient.query(activeOwnerGuardDownSql),
      ).resolves.toBeDefined();
      await expect(rollbackClient.query(sql)).resolves.toBeDefined();
      const remaining = await rollbackClient.query<{ count: number }>(
        `SELECT COUNT(*)::INTEGER AS count
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (
             (table_name = 'auth_sessions'
               AND column_name IN ('browser_label', 'environment_label'))
             OR (table_name = 'workspace_invites'
               AND column_name IN ('send_status', 'last_sent_at'))
             OR (table_name = 'auth_security_events'
               AND column_name = 'target_user_id')
           )`,
      );
      expect(remaining.rows[0]?.count).toBe(0);
      const deletionTable = await rollbackClient.query<{ exists: boolean }>(
        `SELECT TO_REGCLASS(
           'public.account_deletion_requests'
         ) IS NOT NULL AS exists`,
      );
      expect(deletionTable.rows[0]?.exists).toBe(false);
    } finally {
      await rollbackClient.query("ROLLBACK").catch(() => undefined);
      rollbackClient.release();
    }
  });

  async function createFixture(prefix: string): Promise<Fixture> {
    const email = uniqueEmail(prefix);
    const user = await pool!.query<{ id: string }>(
      `INSERT INTO users (
         email,
         email_normalized,
         email_verified_at,
         created_at,
         updated_at
       )
       VALUES ($1, $1, NOW(), NOW(), NOW())
       RETURNING id::TEXT AS id`,
      [email],
    );
    const userId = user.rows[0]!.id;
    const workspace = await pool!.query<{ id: string }>(
      "SELECT ensure_auth_user_workspace($1)::TEXT AS id",
      [userId],
    );
    const session = await createAuthSession({
      userId,
      authMethod: "magic_link",
      requestIpHash: "a".repeat(64),
      userAgentHash: "b".repeat(64),
      sessionEnvironment: {
        deviceLabel: "Тестовое устройство",
        browserLabel: "Chromium",
        environmentLabel: "Integration test",
      },
    });
    if (!session) throw new Error("Auth session fixture was not created.");
    return {
      email,
      userId,
      workspaceId: workspace.rows[0]!.id,
      session: session.session,
      token: session.token,
    };
  }

  async function createDeliveryFixture(
    account: Fixture,
  ): Promise<{ profileId: string; endpointId: string; providerId: string }> {
    const profile = await pool!.query<{ id: string }>(
      `INSERT INTO client_profiles (
         owner_id,
         workspace_id,
         agency_name,
         telegram_chat_id,
         is_active,
         delivery_enabled,
         web_push_enabled,
         email_digest_enabled,
         digest_email
       )
       VALUES (
         $1,
         $2,
         'Deletion delivery fixture',
         $1,
         TRUE,
         TRUE,
         TRUE,
         TRUE,
         $3
       )
       RETURNING id::TEXT AS id`,
      [account.userId, account.workspaceId, account.email],
    );
    const profileId = profile.rows[0]!.id;
    await pool!.query(
      `INSERT INTO web_push_subscriptions (
         client_profile_id,
         endpoint,
         p256dh,
         auth
       )
       VALUES ($1, $2, 'fixture-p256dh', 'fixture-auth')`,
      [profileId, `https://push.example.invalid/${profileId}`],
    );
    const provider = await pool!.query<{ id: string }>(
      `INSERT INTO notification_provider_accounts (
         owner_id,
         workspace_id,
         client_profile_id,
         provider,
         auth_mode,
         display_name,
         status,
         secret_ciphertext
       )
       VALUES (
         $1,
         $2,
         $3,
         'telegram',
         'byob',
         'Deletion fixture',
         'active',
         'fixture-ciphertext'
       )
       RETURNING id::TEXT AS id`,
      [account.userId, account.workspaceId, profileId],
    );
    const endpoint = await pool!.query<{ id: string }>(
      `INSERT INTO notification_endpoints (
         provider_account_id,
         client_profile_id,
         endpoint_type,
         status,
         destination_id
       )
       VALUES (
         $1,
         $2,
         'telegram_private_chat',
         'active',
         $3
       )
       RETURNING id::TEXT AS id`,
      [provider.rows[0]!.id, profileId, `chat-${profileId}`],
    );
    const route = await pool!.query<{ id: string }>(
      `INSERT INTO notification_routes (
         endpoint_id,
         client_profile_id,
         event_kind,
         status
       )
       VALUES ($1, $2, 'daily_digest', 'active')
       RETURNING id::TEXT AS id`,
      [endpoint.rows[0]!.id, profileId],
    );
    await pool!.query(
      `INSERT INTO notification_delivery_jobs (
         client_profile_id,
         route_id,
         endpoint_id,
         provider_account_id,
         event_kind,
         idempotency_key,
         status
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         'daily_digest',
         $5,
         'queued'
       )`,
      [
        profileId,
        route.rows[0]!.id,
        endpoint.rows[0]!.id,
        provider.rows[0]!.id,
        `account-delete-${profileId}`,
      ],
    );
    return {
      profileId,
      endpointId: endpoint.rows[0]!.id,
      providerId: provider.rows[0]!.id,
    };
  }

  function uniqueEmail(prefix: string): string {
    sequence += 1;
    return `${prefix}-${process.pid}-${Date.now()}-${sequence}@example.invalid`;
  }

  async function tokenFromOutbox(
    email: string,
    pathname: string,
  ): Promise<string> {
    const messages = await readTestEmailOutbox();
    const message = [...messages].reverse().find(
      (entry) => entry.to === email && entry.text.includes(pathname),
    );
    const token = message?.text.match(/#([a-f0-9]{64})(?:\s|$)/)?.[1];
    if (!token) throw new Error(`Token for ${pathname} was not recorded.`);
    return token;
  }

  async function runPurge(args: string[]): Promise<{ stdout: string }> {
    return execFileAsync(process.execPath, [purgeScript, ...args], {
      cwd: resolve(process.cwd(), "..", ".."),
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
  }

  async function runBehindWorkspaceLock<T>(
    workspaceId: string,
    queryMarker: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const blocker = await pool!.connect();
    let operationPromise: Promise<T> | null = null;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
        [workspaceId],
      );
      operationPromise = operation();
      let settled = false;
      void operationPromise.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40 && !settled; attempt += 1) {
        const activity = await pool!.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE datname = CURRENT_DATABASE()
               AND pid <> PG_BACKEND_PID()
               AND wait_event_type = 'Lock'
               AND query LIKE '%' || $1 || '%'
               AND CARDINALITY(pg_blocking_pids(pid)) > 0
           ) AS blocked`,
          [queryMarker],
        );
        blocked = activity.rows[0]?.blocked === true;
        if (blocked) break;
        await delay(25);
      }
      expect(blocked).toBe(true);
      await blocker.query("ROLLBACK");
      return await operationPromise;
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
  }

  async function securityEventCount(userId: string): Promise<number> {
    const result = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM auth_security_events
       WHERE user_id = $1 OR target_user_id = $1`,
      [userId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async function accountState(userId: string): Promise<AccountState> {
    const result = await pool!.query<AccountState>(
      `SELECT
         account.email,
         account.email_normalized AS normalized,
         account.display_name AS "displayName",
         account.full_name AS "fullName",
         account.status,
         request.status AS "requestStatus",
         workspace.status AS "workspaceStatus",
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_sessions AS session
           WHERE session.user_id = account.id
             AND session.revoked_at IS NULL
         ) AS "activeSessions",
         (
           SELECT COUNT(*)::INTEGER
           FROM subscriptions AS subscription
           WHERE subscription.user_id = account.id
         ) AS "subscriptionCount"
       FROM users AS account
       JOIN account_deletion_requests AS request
         ON request.user_id = account.id
       JOIN workspaces AS workspace
         ON workspace.bootstrap_user_id = account.id
       WHERE account.id = $1
       ORDER BY request.id DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Account deletion state was not found.");
    return row;
  }
});
