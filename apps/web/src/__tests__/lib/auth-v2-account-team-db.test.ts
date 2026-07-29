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
  changeActiveWorkspace,
  createAuthSession,
  listAuthSessions,
  type AuthSession,
} from "@/lib/auth-v2/sessions";
import {
  acceptWorkspaceInvite,
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
} from "@/lib/auth-v2/workspace-team";

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

type Fixture = {
  email: string;
  userId: string;
  workspaceId: string;
  session: AuthSession;
  token: string;
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
    })).resolves.toEqual({ ok: false, code: "conflict" });

    const newEmail = uniqueEmail("email-confirmed");
    await expect(requestAccountEmailChange({
      session: account.session,
      newEmail,
    })).resolves.toEqual({ ok: true, delivery: "sent" });

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
      }),
      confirmAccountEmailChange({
        token,
        currentSession: account.session,
      }),
    ]);
    expect(confirmations.filter((result) => result.ok)).toHaveLength(1);
    expect(confirmations).toContainEqual({
      ok: true,
      preservedCurrentSession: true,
    });
    expect(confirmations).toContainEqual({ ok: false, code: "invalid" });

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

  test("invite email binding, single use, role ceilings, removal, and ownership transfer are atomic", async () => {
    const owner = await createFixture("team-owner");
    const invited = await createFixture("team-invited");
    const wrongAccount = await createFixture("team-wrong");
    const secondAdmin = await createFixture("team-admin");

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
    await expect(requestAccountDeletion({
      session: due.session,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      env: {
        AUTH_ACCOUNT_RETENTION_POLICY_KEY: "test_policy",
        AUTH_ACCOUNT_PURGE_AFTER_DAYS: "7",
      },
    })).resolves.toEqual({ ok: true });
    await pool!.query(
      `UPDATE account_deletion_requests
       SET purge_after = requested_at
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
    await expect(accountState(future.userId)).resolves.toMatchObject({
      status: "deletion_pending",
      requestStatus: "pending",
      workspaceStatus: "deletion_pending",
    });
    await expect(securityEventCount(due.userId)).resolves.toBe(beforeAudit);
  });

  test("rollback refuses live security history and succeeds after disposable fixtures are cleared", async () => {
    const sql = await readFile(downMigration, "utf8");
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
         WHERE event_type IN (
           'membership_role_changed',
           'membership_removed',
           'ownership_transferred'
         )`,
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

  async function accountState(userId: string): Promise<{
    email: string;
    normalized: string;
    displayName: string | null;
    fullName: string | null;
    status: string;
    requestStatus: string;
    workspaceStatus: string;
    activeSessions: number;
    subscriptionCount: number;
  }> {
    const result = await pool!.query(
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
