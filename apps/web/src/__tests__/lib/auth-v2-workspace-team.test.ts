jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(),
}));

import {
  acceptWorkspaceInvite,
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
} from "@/lib/auth-v2/workspace-team";
import { getClient, getPool } from "@/lib/db-pool";
import { sendEmail } from "@/lib/email/transport";
import { hashAuthRateLimitBoundary } from "@/lib/auth-v2/rate-limits";

const mockGetClient = jest.mocked(getClient);
const mockGetPool = jest.mocked(getPool);
const mockSendEmail = jest.mocked(sendEmail);
const now = new Date("2026-07-29T12:00:00.000Z");

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "17",
    userId: "42",
    workspaceId: "9",
    lastAuthenticatedAt: new Date("2026-07-29T11:55:00.000Z"),
    ...overrides,
  } as never;
}

describe("auth v2 workspace team lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    process.env.AUTH_WORKSPACES_V2_ENABLED = "true";
    mockSendEmail.mockResolvedValue({ ok: true });
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as never);
  });

  test("never allows an ordinary invite to assign owner", async () => {
    await expect(inviteWorkspaceMember({
      actorUserId: "42",
      workspaceId: "9",
      email: "member@example.com",
      role: "owner" as never,
      now,
    })).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("binds invite acceptance to the current verified account email", async () => {
    const query = jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FROM workspace_invites AS invite")) {
        return {
          rows: [{
            inviteId: "81",
            workspaceId: "9",
            emailNormalized: "invited@example.com",
            role: "recruiter",
            expiresAt: new Date("2026-07-30T12:00:00.000Z"),
            acceptedAt: null,
            revokedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM users AS account") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{ email: "attacker@example.com", emailNormalized: "attacker@example.com" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(acceptWorkspaceInvite({
      token: "a".repeat(64),
      session: session(),
      now,
    })).resolves.toEqual({ ok: false, code: "email_mismatch" });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO workspace_members"),
    )).toBe(false);
  });

  test("does not merge case-distinct mailbox local parts during invite acceptance", async () => {
    const query = jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FROM workspace_invites AS invite")) {
        return {
          rows: [{
            inviteId: "81",
            workspaceId: "9",
            emailNormalized: "Alice@example.com",
            role: "recruiter",
            expiresAt: new Date("2026-07-30T12:00:00.000Z"),
            acceptedAt: null,
            revokedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM users AS account") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            email: "alice@example.com",
            emailNormalized: "alice@example.com",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(acceptWorkspaceInvite({
      token: "a".repeat(64),
      session: session(),
      now,
    })).resolves.toEqual({ ok: false, code: "email_mismatch" });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO workspace_members"),
    )).toBe(false);
  });

  test("fails invite acceptance closed outside the workspace rollout", async () => {
    await expect(acceptWorkspaceInvite({
      token: "a".repeat(64),
      session: session(),
      now,
      env: {
        AUTH_PLATFORM_V2_ENABLED: "true",
        AUTH_WORKSPACES_V2_ENABLED: "false",
      },
    } as Parameters<typeof acceptWorkspaceInvite>[0])).resolves.toEqual({
      ok: false,
      code: "unavailable",
    });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("does not spend a target invite bucket after the workspace bucket denies", async () => {
    const query = jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FOR UPDATE OF membership, workspace")) {
        return {
          rows: [{ actorRole: "owner", workspaceName: "Radar Team" }],
          rowCount: 1,
        };
      }
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(inviteWorkspaceMember({
      actorUserId: "42",
      workspaceId: "9",
      email: "MiXeD@example.com",
      role: "recruiter",
      now,
    })).resolves.toEqual({ ok: false, code: "rate_limited" });

    expect(query.mock.calls.filter(([sql]) =>
      String(sql).includes("consume_auth_rate_limit"),
    )).toHaveLength(1);
    const targetLock = query.mock.calls.find(([_sql, values]) =>
      String(values?.[0]).startsWith("auth-workspace-invite:"),
    );
    expect(targetLock?.[1]).toEqual([
      "auth-workspace-invite:9:MiXeD@example.com",
    ]);
  });

  test("folds only the invite abuse bucket while keeping the identity lock exact", async () => {
    const query = jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FOR UPDATE OF membership, workspace")) {
        return {
          rows: [{ actorRole: "owner", workspaceName: "Radar Team" }],
          rowCount: 1,
        };
      }
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("FROM workspace_members AS membership")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO workspace_invites")) {
        return { rows: [{ id: "81" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(inviteWorkspaceMember({
      actorUserId: "42",
      workspaceId: "9",
      email: "MiXeD@example.com",
      role: "recruiter",
      now,
    })).resolves.toEqual({ ok: true, delivery: "sent" });

    const targetLock = query.mock.calls.find(([_sql, values]) =>
      String(values?.[0]).startsWith("auth-workspace-invite:"),
    );
    expect(targetLock?.[1]).toEqual([
      "auth-workspace-invite:9:MiXeD@example.com",
    ]);
    const rateCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("consume_auth_rate_limit"),
    );
    expect(rateCalls).toHaveLength(2);
    expect(rateCalls[1]?.[1]?.[1]).toBe(hashAuthRateLimitBoundary(
      "workspace-invite-target",
      "9:mixed@example.com",
    ));
  });

  test("returns the accepted workspace only after single-use acceptance commits", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM workspace_invites AS invite")) {
        return {
          rows: [{
            inviteId: "81",
            workspaceId: "19",
            emailNormalized: "invited@example.com",
            role: "recruiter",
            expiresAt: new Date("2026-07-30T12:00:00.000Z"),
            acceptedAt: null,
            revokedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM users AS account") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            email: "invited@example.com",
            emailNormalized: "invited@example.com",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM workspace_members")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("UPDATE workspace_invites")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(acceptWorkspaceInvite({
      token: "a".repeat(64),
      session: session(),
      now,
    })).resolves.toEqual({ ok: true, workspaceId: "19" });

    expect(query.mock.calls.at(-2)?.[0]).toContain("invite_accepted");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  test("prevents self-escalation and generic owner assignment", async () => {
    await expect(changeWorkspaceMemberRole({
      actorUserId: "42",
      workspaceId: "9",
      targetUserId: "42",
      role: "admin",
      now,
    })).resolves.toEqual({ ok: false, code: "denied" });
    await expect(changeWorkspaceMemberRole({
      actorUserId: "42",
      workspaceId: "9",
      targetUserId: "77",
      role: "owner" as never,
      now,
    })).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("removal revokes only the target member's sessions in this workspace", async () => {
    const query = jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FOR UPDATE OF actor_membership, target_membership")) {
        return {
          rows: [{
            actorRole: "owner",
            targetRole: "recruiter",
            targetEmail: "member@example.com",
            targetName: "Участник",
            workspaceName: "Radar Team",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(removeWorkspaceMember({
      actorUserId: "42",
      workspaceId: "9",
      targetUserId: "77",
      now,
    })).resolves.toEqual({ ok: true });
    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(allSql).toContain("session.user_id = $2");
    expect(allSql).toContain("session.workspace_id = $1");
    const eventCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO auth_security_events"),
    );
    expect(eventCall?.[1]?.[0]).toBe("membership_removed");
  });

  test("requires recent auth and atomically swaps ownership before revoking privilege sessions", async () => {
    await expect(transferWorkspaceOwnership({
      session: session({
        lastAuthenticatedAt: new Date("2026-07-29T10:00:00.000Z"),
      }),
      targetUserId: "77",
      now,
    })).resolves.toEqual({ ok: false, code: "reauth_required" });

    const query = jest.fn(async (sql: string) => {
      if (
        sql.includes("FROM users AS account")
        && sql.includes("ORDER BY account.id")
      ) {
        return { rows: [{ id: "42" }, { id: "77" }], rowCount: 2 };
      }
      if (sql.includes("FOR UPDATE OF actor_membership, target_membership")) {
        return {
          rows: [{
            actorRole: "owner",
            targetRole: "admin",
            actorEmail: "owner@example.com",
            targetEmail: "admin@example.com",
            workspaceName: "Radar Team",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(transferWorkspaceOwnership({
      session: session(),
      targetUserId: "77",
      now,
    })).resolves.toEqual({ ok: true });
    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(allSql).toContain("role = CASE");
    expect(allSql).toContain("WHEN user_id = $2 THEN 'admin'");
    expect(allSql).toContain("WHEN user_id = $3 THEN 'owner'");
    expect(allSql).not.toContain("UPDATE client_profiles");
    expect(allSql).not.toContain("UPDATE notification_provider_accounts");
    expect(allSql).not.toContain("UPDATE opportunities");
    expect(allSql).toContain("UPDATE auth_sessions");
    expect(allSql).toContain("'ownership_transferred'");
  });
});
