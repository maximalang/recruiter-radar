jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(),
}));

import {
  ACCOUNT_DELETION_CONFIRMATION,
  confirmAccountEmailChange,
  getAccountSecurityProfile,
  requestAccountDeletion,
  requestAccountEmailChange,
} from "@/lib/auth-v2/account-security";
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

describe("auth v2 account security", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    process.env.SESSION_SECRET = "s".repeat(32);
    delete process.env.AUTH_ACCOUNT_PURGE_AFTER_DAYS;
    delete process.env.AUTH_ACCOUNT_RETENTION_POLICY_KEY;
    mockSendEmail.mockResolvedValue({ ok: true });
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as never);
  });

  test("reads the account and active workspace through both server-owned ids", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        id: "42",
        displayName: "Максим",
        email: "owner@example.com",
        createdAt: now,
        emailVerifiedAt: now,
        workspaceId: "9",
        workspaceName: "Radar Team",
        role: "owner",
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(getAccountSecurityProfile({
      userId: "42",
      workspaceId: "9",
    })).resolves.toEqual(expect.objectContaining({
      id: "42",
      workspaceName: "Radar Team",
      role: "owner",
    }));
    expect(query.mock.calls[0]?.[1]).toEqual(["42", "9"]);
    expect(String(query.mock.calls[0]?.[0])).toContain("membership.status = 'active'");
  });

  test("requires recent authentication before requesting an email change", async () => {
    await expect(requestAccountEmailChange({
      session: session({
        lastAuthenticatedAt: new Date("2026-07-29T10:00:00.000Z"),
      }),
      newEmail: "new@example.com",
      now,
    })).resolves.toEqual({ ok: false, code: "reauth_required" });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("issues a new-email challenge and notifies the old address without changing primary email", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FOR UPDATE OF account")) {
        return {
          rows: [{
            email: "owner@example.com",
            emailNormalized: "owner@example.com",
            displayName: "Максим",
            workspaceName: "Radar Team",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT 1") && sql.includes("email_normalized")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO auth_challenges")) {
        return { rows: [{ id: "81" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(requestAccountEmailChange({
      session: session(),
      newEmail: "New@Example.com",
      now,
    })).resolves.toEqual({ ok: true, delivery: "sent" });

    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(allSql).toContain("INSERT INTO auth_challenges");
    expect(allSql).toContain("'change_email'");
    expect(allSql).toContain("'email_change_requested'");
    expect(allSql).not.toContain("UPDATE users SET email");
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "New@example.com",
    }));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
    }));
  });

  test("confirms the new email transactionally and revokes every other session", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM auth_challenges AS challenge")) {
        return {
          rows: [{
            challengeId: "81",
            userId: "42",
            workspaceId: "9",
            newEmail: "new@example.com",
            expiresAt: new Date("2026-07-29T13:00:00.000Z"),
            consumedAt: null,
            invalidatedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM users AS account") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            email: "owner@example.com",
            displayName: "Максим",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT 1") && sql.includes("email_normalized")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("WITH rotated_session AS")) {
        return { rows: [{ rotated: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    const result = await confirmAccountEmailChange({
      token: "a".repeat(64),
      currentSession: session(),
      currentSessionToken: "b".repeat(64),
      now,
    });
    expect(result).toEqual({
      ok: true,
      preservedCurrentSession: true,
      sessionToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(allSql).toContain("UPDATE users");
    expect(allSql).toContain("email_normalized = $2");
    expect(allSql).toContain("previous_token_hash = NULL");
    expect(allSql).toContain("previous_token_authorizes = FALSE");
    expect(allSql).toContain("UPDATE auth_sessions");
    expect(allSql).toContain("session.id <> $2");
    expect(allSql).toContain("'email_changed'");
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
    }));
  });

  test("requires explicit deletion text and leaves purge scheduling unset by default", async () => {
    await expect(requestAccountDeletion({
      session: session(),
      confirmation: "удалить",
      now,
    })).resolves.toEqual({ ok: false, code: "confirmation_required" });
    expect(mockGetClient).not.toHaveBeenCalled();

    const query = jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("FROM users AS account") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            email: "owner@example.com",
            displayName: "Максим",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("AS blocking_workspace_id")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(requestAccountDeletion({
      session: session(),
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      now,
    })).resolves.toEqual({ ok: true });

    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO account_deletion_requests"),
    );
    expect(insert?.[1]).toEqual(["42", "17", "manual_review", now, null]);
    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(allSql).toContain("status = 'deletion_pending'");
    expect(allSql).toContain("status = 'removed'");
    expect(allSql).toContain("UPDATE auth_sessions");
    expect(allSql).toContain("'account_deletion_requested'");
  });
});
