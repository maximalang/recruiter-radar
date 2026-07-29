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
    const query = jest.fn(async (sql: string) => {
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
    const query = jest.fn(async (sql: string) => {
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
    expect(allSql).toContain("UPDATE auth_sessions");
    expect(allSql).toContain("'ownership_transferred'");
  });
});
