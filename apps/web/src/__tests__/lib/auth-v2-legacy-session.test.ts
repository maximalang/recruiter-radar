import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({
  logError: jest.fn(),
}));

import { getClient, getPool } from "@/lib/db-pool";
import {
  isLegacySessionMigrationWindowOpen,
} from "@/lib/auth-v2/config";
import {
  decodeLegacyOwnerSession,
  exchangeLegacyOwnerSession,
  readLegacyOwnerSessionForAuthorization,
  revokeLegacyOwnerSessionForLogout,
} from "@/lib/auth-v2/legacy-session";

const mockGetPool = jest.mocked(getPool);
const mockGetClient = jest.mocked(getClient);
const sessionSecret = "s".repeat(32);
const migrationSecret = "m".repeat(32);
const now = new Date("2026-07-28T12:00:00.000Z");
const enabledEnv = {
  AUTH_PLATFORM_V2_ENABLED: "true",
  AUTH_WORKSPACES_V2_ENABLED: "true",
  AUTH_LEGACY_SESSION_MIGRATION_ENABLED: "true",
  AUTH_LEGACY_SESSION_MIGRATION_DEADLINE: "2026-08-15T00:00:00Z",
  AUTH_LEGACY_MIGRATION_SECRET: migrationSecret,
  SESSION_SECRET: sessionSecret,
};

function legacyToken(userId: string): string {
  const mac = createHmac("sha256", sessionSecret)
    .update(`session:${userId}`)
    .digest("hex");
  return `${userId}.${mac}`;
}

describe("bounded auth v2 legacy session exchange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("opens only with its exact flag and an unexpired UTC deadline", () => {
    expect(isLegacySessionMigrationWindowOpen(enabledEnv, now)).toBe(true);
    expect(isLegacySessionMigrationWindowOpen({
      ...enabledEnv,
      AUTH_WORKSPACES_V2_ENABLED: "false",
    }, now)).toBe(true);
    expect(isLegacySessionMigrationWindowOpen({
      ...enabledEnv,
      AUTH_LEGACY_SESSION_MIGRATION_DEADLINE: "not-a-date",
    }, now)).toBe(false);
    expect(isLegacySessionMigrationWindowOpen({
      ...enabledEnv,
      AUTH_LEGACY_SESSION_MIGRATION_DEADLINE: "2026-07-01T00:00:00Z",
    }, now)).toBe(false);
  });

  test("verifies the legacy owner HMAC without accepting malformed values", () => {
    expect(decodeLegacyOwnerSession(legacyToken("42"), enabledEnv)).toBe("42");
    expect(decodeLegacyOwnerSession("42." + "0".repeat(64), enabledEnv)).toBeNull();
    expect(decodeLegacyOwnerSession("0." + "0".repeat(64), enabledEnv)).toBeNull();
    expect(decodeLegacyOwnerSession("42.not-hex", enabledEnv)).toBeNull();
  });

  test("exchanges a valid legacy cookie into one opaque database session", async () => {
    const exchangeResult = {
      rows: [{
        id: "17",
        userId: "42",
        workspaceId: "9",
        authMethod: "legacy_exchange",
        deviceLabel: null,
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-08-27T12:00:00.000Z"),
        rotatedAt: now,
        lastAuthenticatedAt: new Date("2026-07-01T00:00:00.000Z"),
        rotationDue: false,
      }],
      rowCount: 1,
    };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce(exchangeResult)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const release = jest.fn();
    mockGetClient.mockResolvedValue({ query, release } as never);
    const token = legacyToken("42");

    const exchanged = await exchangeLegacyOwnerSession({
      legacyToken: token,
      requestIpHash: "a".repeat(64),
      userAgentHash: "b".repeat(64),
      env: enabledEnv,
      now,
    });

    expect(exchanged?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(exchanged?.session).toMatchObject({
      id: "17",
      userId: "42",
      authMethod: "legacy_exchange",
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("WITH created AS"),
      "COMMIT",
    ]);
    const values = query.mock.calls[2]?.[1] as unknown[];
    expect(values[0]).toBe("42");
    expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(values[1]).not.toBe(exchanged?.token);
    expect(values[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(values[2]).not.toBe(token);
    expect(String(query.mock.calls[2]?.[0])).toContain("legacy_session_migrated");
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("fails closed when disabled, invalid, or already exchanged", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const release = jest.fn();
    mockGetClient.mockResolvedValue({ query, release } as never);

    await expect(exchangeLegacyOwnerSession({
      legacyToken: legacyToken("42"),
      env: { ...enabledEnv, AUTH_PLATFORM_V2_ENABLED: "false" },
      now,
    })).resolves.toBeNull();
    expect(mockGetClient).not.toHaveBeenCalled();

    await expect(exchangeLegacyOwnerSession({
      legacyToken: "invalid",
      env: enabledEnv,
      now,
    })).resolves.toBeNull();
    expect(mockGetClient).not.toHaveBeenCalled();

    await expect(exchangeLegacyOwnerSession({
      legacyToken: legacyToken("42"),
      env: enabledEnv,
      now,
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("authorizes eligible legacy sessions only inside the migration window", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        legacyDenied: false,
        v2LoginSucceeded: false,
        eligibleIdentity: true,
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);
    const token = legacyToken("42");

    await expect(readLegacyOwnerSessionForAuthorization({
      legacyToken: token,
      env: enabledEnv,
      now,
    })).resolves.toBe("42");
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain("account.status = 'active'");
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "account.email_verified_at IS NOT NULL",
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "prior_denial.event_type IN (",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "42",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);

    await expect(readLegacyOwnerSessionForAuthorization({
      legacyToken: token,
      env: {
        ...enabledEnv,
        AUTH_LEGACY_SESSION_MIGRATION_DEADLINE: "2026-07-01T00:00:00Z",
      },
      now,
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("denies replayed, suspended, or unverified legacy identities", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        legacyDenied: true,
        v2LoginSucceeded: false,
        eligibleIdentity: true,
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(readLegacyOwnerSessionForAuthorization({
      legacyToken: legacyToken("42"),
      env: enabledEnv,
      now,
    })).resolves.toBeNull();
  });

  test("keeps non-canary users on the unchanged legacy path", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        legacyDenied: false,
        v2LoginSucceeded: false,
        eligibleIdentity: false,
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(readLegacyOwnerSessionForAuthorization({
      legacyToken: legacyToken("77"),
      env: {
        ...enabledEnv,
        AUTH_PLATFORM_V2_ENABLED: "false",
        AUTH_V2_CANARY_USER_IDS: "42",
        AUTH_LEGACY_SESSION_MIGRATION_ENABLED: "false",
      },
      now,
    })).resolves.toBe("77");
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("denies an exchanged legacy cookie after canary rollback", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        legacyDenied: true,
        v2LoginSucceeded: false,
        eligibleIdentity: true,
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(readLegacyOwnerSessionForAuthorization({
      legacyToken: legacyToken("42"),
      env: {
        ...enabledEnv,
        AUTH_PLATFORM_V2_ENABLED: "false",
        AUTH_V2_CANARY_USER_IDS: "",
        AUTH_LEGACY_SESSION_MIGRATION_ENABLED: "false",
      },
      now,
    })).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("denies a copied legacy cookie after v2 login on another device", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        legacyDenied: false,
        v2LoginSucceeded: true,
        eligibleIdentity: true,
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(readLegacyOwnerSessionForAuthorization({
      legacyToken: legacyToken("42"),
      env: enabledEnv,
      now,
    })).resolves.toBeNull();
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "v2_login.event_type = 'login_succeeded'",
    );
  });

  test("writes only a hashed append-only tombstone for legacy logout", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ revoked: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const release = jest.fn();
    mockGetClient.mockResolvedValue({ query, release } as never);
    const token = legacyToken("42");

    await expect(revokeLegacyOwnerSessionForLogout(
      token,
      enabledEnv,
      now,
    )).resolves.toBe("revoked");

    const sql = String(query.mock.calls[2]?.[0]);
    const values = query.mock.calls[2]?.[1] as unknown[];
    expect(sql).toContain("'legacy_session_revoked'");
    expect(sql).toContain("auth_security_events");
    expect(values[0]).toBe("42");
    expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(values[1]).not.toBe(token);
    expect(values).not.toContain(token);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("serializes legacy logout and revokes already-exchanged v2 sessions", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [{}], rowCount: 1 };
      }
      return {
        rows: [{ revoked: true }],
        rowCount: 1,
      };
    });
    const release = jest.fn();
    mockGetPool.mockReturnValue(null);
    mockGetClient.mockResolvedValue({ query, release } as never);
    const token = legacyToken("42");

    await expect(revokeLegacyOwnerSessionForLogout(
      token,
      enabledEnv,
      now,
    )).resolves.toBe("revoked");

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("UPDATE auth_sessions"),
      "COMMIT",
    ]);
    const mutationSql = String(query.mock.calls[2]?.[0]);
    const values = query.mock.calls[2]?.[1] as unknown[];
    expect(mutationSql).toContain("legacy_fingerprint_hash = $2");
    expect(mutationSql).toContain("'session_revoked'");
    expect(mutationSql).toContain("'legacy_session_revoked'");
    expect(values[0]).toBe("42");
    expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(values).not.toContain(token);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("fails legacy logout closed when the tombstone store is unavailable", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        throw new Error("database down");
      }
      return { rows: [], rowCount: 0 };
    });
    const release = jest.fn();
    mockGetClient.mockResolvedValueOnce({ query, release } as never);

    await expect(revokeLegacyOwnerSessionForLogout(
      legacyToken("42"),
      enabledEnv,
      now,
    )).resolves.toBe("unavailable");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("pg_advisory_xact_lock"),
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledTimes(1);
    mockGetClient.mockResolvedValueOnce(null);
    await expect(revokeLegacyOwnerSessionForLogout(
      legacyToken("42"),
      enabledEnv,
      now,
    )).resolves.toBe("unavailable");
  });
});

describe("legacy exchange PostgreSQL verifier", () => {
  const verifier = readFileSync(
    resolve(
      process.cwd(),
      "..",
      "..",
      "packages",
      "db",
      "scripts",
      "verify-auth-v2-legacy-exchange.mjs",
    ),
    "utf8",
  );

  test("covers one-way and concurrent exchange", () => {
    expect(verifier).toContain("valid_exchange");
    expect(verifier).toContain("repeated_exchange_denied");
    expect(verifier).toContain("legacy_authorization_replay_denied");
    expect(verifier).toContain("rollback_authorization_replay_denied");
    expect(verifier).toContain("concurrent_exchange_single_winner");
    expect(verifier).toContain("legacy_logout_replay_denied");
    expect(verifier).toContain("pre_exchanged_logout_revokes_v2");
    expect(verifier).toContain("concurrent_exchange_logout_safe");
    expect(verifier).toContain("legacy_logout_rollback_denied");
    expect(verifier).toContain("pg_advisory_xact_lock");
    expect(verifier).toContain("Promise.all");
  });
});
