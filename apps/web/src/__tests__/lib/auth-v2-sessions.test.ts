import { readFileSync } from "node:fs";
import { resolve } from "node:path";

jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));
jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

import { getPool } from "@/lib/db-pool";
import {
  AUTH_V2_SESSION_COOKIE,
  clearAuthV2SessionCookie,
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  createAuthSession,
  isRecentAuthentication,
  readAuthSession,
  revokeAllAuthSessions,
  revokeAuthSessionById,
  revokeAuthSessionForAccountSwitch,
  revokeAuthSessionForLogout,
  rotateAuthSession,
  changeActiveWorkspace,
} from "@/lib/auth-v2/sessions";
import { cookies } from "next/headers";

const mockGetPool = jest.mocked(getPool);
const mockCookies = jest.mocked(cookies);
const verifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-sessions.mjs",
);

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "17",
    userId: "42",
    workspaceId: "9",
    authMethod: "magic_link",
    deviceLabel: null,
    browserLabel: null,
    environmentLabel: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-07-28T11:45:00.000Z"),
    idleExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-07-31T00:00:00.000Z"),
    rotatedAt: new Date("2026-07-27T00:00:00.000Z"),
    lastAuthenticatedAt: new Date("2026-07-28T11:55:00.000Z"),
    rotationDue: true,
    ...overrides,
  };
}

describe("auth v2 server-side sessions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("creates an opaque session and sends only its hash to PostgreSQL", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [sessionRow()],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    const created = await createAuthSession({
      userId: "42",
      authMethod: "magic_link",
      requestIpHash: "a".repeat(64),
      userAgentHash: "b".repeat(64),
    }, new Date("2026-07-28T12:00:00.000Z"));

    expect(created?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created?.session.id).toBe("17");
    const values = query.mock.calls[0]?.[1] as unknown[];
    expect(values[0]).toBe("42");
    expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(values[1]).not.toBe(created?.token);
    expect(values).not.toContain("192.0.2.10");
  });

  test("reads active sessions with throttled touch and rotation metadata", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [sessionRow()],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    const current = await readAuthSession(
      "c".repeat(64),
      new Date("2026-07-28T12:00:00.000Z"),
      {
        env: {
          AUTH_PLATFORM_V2_ENABLED: "true",
          AUTH_WORKSPACES_V2_ENABLED: "true",
        },
      },
    );

    expect(current).toMatchObject({
      id: "17",
      userId: "42",
      rotationDue: true,
    });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("MAKE_INTERVAL(mins => 5)");
    expect(sql).toContain("selected.last_authenticated_at");
    expect(sql).not.toContain("account.last_authenticated_at");
    expect(sql).toContain("workspace_access_lost");
    expect(sql).toContain("workspace_members");
    expect(sql).toContain("membership.status = 'active'");
    expect(sql).toContain("workspace.status = 'active'");
    expect(sql).toContain("previous_token_authorizes");
    expect(query.mock.calls[0]?.[1]?.[0]).not.toBe("c".repeat(64));
  });

  test("preserves pre-backfill sessions while workspace rollout is disabled", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [sessionRow({ workspaceId: null })],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    const current = await readAuthSession(
      "a".repeat(64),
      new Date("2026-07-28T12:00:00.000Z"),
      {
        env: {
          AUTH_PLATFORM_V2_ENABLED: "true",
          AUTH_WORKSPACES_V2_ENABLED: "false",
        },
      },
    );

    expect(current?.workspaceId).toBeNull();
    expect(query.mock.calls[0]?.[1]).toEqual([
      expect.any(String),
      new Date("2026-07-28T12:00:00.000Z"),
      false,
      true,
      [],
    ]);
  });

  test("rotates exactly the presented active token with a bounded grace window", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [sessionRow({ rotatedAt: new Date("2026-07-28T12:00:00.000Z") })],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    const rotated = await rotateAuthSession(
      "d".repeat(64),
      new Date("2026-07-28T12:00:00.000Z"),
    );

    expect(rotated?.token).toMatch(/^[a-f0-9]{64}$/);
    const values = query.mock.calls[0]?.[1] as unknown[];
    expect(values[0]).not.toBe("d".repeat(64));
    expect(values[1]).not.toBe(rotated?.token);
    expect(values[3]).toBe(false);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("session_rotated");
    expect(sql).toContain("previous_token_hash = session.token_hash");
    expect(sql).toContain("previous_token_authorizes = TRUE");
    expect(sql).toContain("INTERVAL '60 seconds'");
    expect(sql).toContain("session.rotated_at <= $3 - INTERVAL '24 hours'");
  });

  test("revokes by both user and session id and scopes revoke-all to the user", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ revoked: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ revokedCount: 3 }], rowCount: 1 });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(revokeAuthSessionById({
      userId: "42",
      sessionId: "17",
      reason: "logout",
    })).resolves.toBe(true);
    await expect(revokeAllAuthSessions({
      userId: "42",
      exceptSessionId: "17",
    })).resolves.toBe(3);

    expect(query.mock.calls[0]?.[1]).toEqual(["42", "17", "logout"]);
    expect(query.mock.calls[1]?.[1]?.slice(0, 2)).toEqual(["42", "17"]);
    expect(String(query.mock.calls[1]?.[0])).toContain("all_sessions_revoked");
  });

  test("distinguishes revoke-all database failure from an empty success", async () => {
    const query = jest.fn().mockRejectedValue(new Error("database down"));
    mockGetPool.mockReturnValue({ query } as never);

    await expect(revokeAllAuthSessions({
      userId: "42",
    })).resolves.toBeNull();
  });

  test("distinguishes logout revocation from inactivity and database failure", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ revoked: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ revoked: false }], rowCount: 1 })
      .mockRejectedValueOnce(new Error("database down"));
    mockGetPool.mockReturnValue({ query } as never);

    await expect(
      revokeAuthSessionForLogout("a".repeat(64)),
    ).resolves.toBe("revoked");
    await expect(
      revokeAuthSessionForLogout("b".repeat(64)),
    ).resolves.toBe("inactive");
    await expect(
      revokeAuthSessionForLogout("c".repeat(64)),
    ).resolves.toBe("unavailable");

    mockGetPool.mockReturnValue(null);
    await expect(
      revokeAuthSessionForLogout("d".repeat(64)),
    ).resolves.toBe("unavailable");
  });

  test("uses tri-state token revocation for account switching", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ revoked: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ revoked: false }], rowCount: 1 })
      .mockRejectedValueOnce(new Error("database down"));
    mockGetPool.mockReturnValue({ query } as never);

    await expect(
      revokeAuthSessionForAccountSwitch("a".repeat(64)),
    ).resolves.toBe("revoked");
    await expect(
      revokeAuthSessionForAccountSwitch("b".repeat(64)),
    ).resolves.toBe("inactive");
    await expect(
      revokeAuthSessionForAccountSwitch("c".repeat(64)),
    ).resolves.toBe("unavailable");
    expect(query.mock.calls[0]?.[1]?.at(-1)).toBe("security_action");
  });

  test("switches workspace through a current-token-only CAS and rotates immediately", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({
        rows: [sessionRow({ workspaceId: "9", rotationDue: false })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [sessionRow({ workspaceId: "11", rotationDue: false })],
        rowCount: 1,
      });
    mockGetPool.mockReturnValue({ query } as never);

    const switched = await changeActiveWorkspace({
      token: "f".repeat(64),
      workspaceId: "11",
      now: new Date("2026-07-28T12:00:00.000Z"),
      env: {
        AUTH_PLATFORM_V2_ENABLED: "true",
        AUTH_WORKSPACES_V2_ENABLED: "true",
      },
    });

    expect(switched?.session.workspaceId).toBe("11");
    expect(switched?.token).toMatch(/^[a-f0-9]{64}$/);
    const sql = String(query.mock.calls[1]?.[0]);
    expect(sql).toContain("change_auth_session_workspace");
    const values = query.mock.calls[1]?.[1] as unknown[];
    expect(values[0]).not.toBe("f".repeat(64));
    expect(values[1]).not.toBe(switched?.token);
    expect(values[2]).toBe("11");
  });

  test("keeps workspace switching unavailable when its rollout flag is off", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [sessionRow({ workspaceId: null, rotationDue: false })],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(changeActiveWorkspace({
      token: "f".repeat(64),
      workspaceId: "11",
      env: {
        AUTH_PLATFORM_V2_ENABLED: "true",
        AUTH_WORKSPACES_V2_ENABLED: "false",
      },
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("checks recent authentication without trusting client timestamps", () => {
    const current = sessionRow();
    expect(isRecentAuthentication(
      current as never,
      new Date("2026-07-28T12:00:00.000Z"),
    )).toBe(true);
    expect(isRecentAuthentication(
      {
        ...current,
        lastAuthenticatedAt: new Date("2026-07-28T11:00:00.000Z"),
      } as never,
      new Date("2026-07-28T12:00:00.000Z"),
    )).toBe(false);
  });

  test("creates recent-auth state on the session row instead of borrowing user state", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [sessionRow()],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await createAuthSession({
      userId: "42",
      authMethod: "magic_link",
    }, new Date("2026-07-28T12:00:00.000Z"));

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("last_authenticated_at");
    expect(sql).toContain("created.last_authenticated_at");
    expect(sql).not.toContain("account.last_authenticated_at");
  });
});

describe("auth v2 session cookie", () => {
  test("uses a host-only secure HttpOnly cookie", async () => {
    const set = jest.fn();
    mockCookies.mockResolvedValue({ set } as never);

    await writeAuthV2SessionCookie("e".repeat(64));

    expect(AUTH_V2_SESSION_COOKIE).toBe("__Host-rr_session");
    expect(set).toHaveBeenCalledWith(
      "__Host-rr_session",
      "e".repeat(64),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      }),
    );
    expect(set.mock.calls[0]?.[2]).not.toHaveProperty("domain");
  });

  test("rejects malformed cookie values and clears the host cookie", async () => {
    const set = jest.fn();
    mockCookies.mockResolvedValue({
      get: jest.fn().mockReturnValue({ value: "invalid" }),
      set,
    } as never);

    await expect(readAuthV2SessionCookie()).resolves.toBeNull();
    await clearAuthV2SessionCookie();

    expect(set).toHaveBeenCalledWith(
      "__Host-rr_session",
      "",
      expect.objectContaining({ maxAge: 0, secure: true, path: "/" }),
    );
  });
});

describe("auth v2 session PostgreSQL verifier", () => {
  const verifier = readFileSync(verifierPath, "utf8");

  test("covers expiry, touch, rotation and revocation races", () => {
    expect(verifier).toContain("idle_and_absolute_expiry");
    expect(verifier).toContain("touch_throttled");
    expect(verifier).toContain("rotation_single_winner");
    expect(verifier).toContain("rotation_previous_token_grace");
    expect(verifier).toContain("recent_auth_session_scoped");
    expect(verifier).toContain("revoke_dominates_rotation");
    expect(verifier).toContain("revoke_all_scoped");
    expect(verifier).toContain("Promise.all");
  });
});
