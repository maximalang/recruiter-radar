import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
  logWarn: jest.fn(),
}));

import { getClient, getPool } from "@/lib/db-pool";
import { sendEmail } from "@/lib/email/transport";
import {
  consumeAuthV2Login,
  requestAuthV2Login,
  shouldRequestAuthV2Login,
} from "@/lib/auth-v2/challenges";

const mockGetClient = jest.mocked(getClient);
const mockGetPool = jest.mocked(getPool);
const mockSendEmail = jest.mocked(sendEmail);

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260728121000_add_auth_challenge_issuance.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260728121000_add_auth_challenge_issuance.down.sql",
);
const verifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-challenges.mjs",
);
const consumeMigrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260728122000_add_auth_challenge_consumption.sql",
);
const consumeRollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260728122000_add_auth_challenge_consumption.down.sql",
);
const consumeVerifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-consumption.mjs",
);
const rollbackVerifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-rollback.mjs",
);

function fakeClient(issueResult: { issued: boolean; challengeId: string | null }) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("issue_auth_login_challenge")) {
      return {
        rows: [{
          issued: issueResult.issued,
          challengeId: issueResult.challengeId,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    query,
    release: jest.fn(),
  };
}

describe("auth v2 login challenge service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_RATE_LIMIT_SECRET = "a".repeat(32);
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.AUTH_SITE_URL = "https://radar.example";
  });

  test("rejects invalid syntax before acquiring a database client", async () => {
    await expect(requestAuthV2Login({
      email: "first@example.com,second@example.com",
      returnTo: "/dashboard",
      clientAddress: "192.0.2.10",
      userAgent: "test-browser",
    })).resolves.toEqual({
      ok: false,
      error: "Укажите один корректный email.",
    });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("issues a hashed challenge without creating a user and sends the fragment link", async () => {
    const client = fakeClient({ issued: true, challengeId: "17" });
    mockGetClient.mockResolvedValue(client as never);
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as never);
    mockSendEmail.mockResolvedValue({ ok: true });

    await expect(requestAuthV2Login({
      email: "User+sales@Example.COM",
      returnTo: "/checkout?plan=pilot-week",
      clientAddress: "192.0.2.10",
      userAgent: "test-browser",
    })).resolves.toEqual({ ok: true });

    const issueCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("issue_auth_login_challenge"),
    );
    expect(issueCall).toBeDefined();
    expect(issueCall?.[1]?.[0]).toBe("User+sales@example.com");
    expect(issueCall?.[1]).not.toContain("192.0.2.10");
    expect(issueCall?.[1]).not.toContain("test-browser");
    expect(client.query.mock.calls.flatMap(([sql]) => String(sql))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/INSERT\s+INTO\s+users/i)]),
    );

    const message = mockSendEmail.mock.calls[0]?.[0];
    expect(message?.to).toBe("User+sales@example.com");
    expect(message?.text).toMatch(/https:\/\/radar\.example\/auth\/verify#[a-f0-9]{64}/);
    expect(message?.text).not.toContain("?token=");
    expect(client.release).toHaveBeenCalled();
  });

  test("keeps rate limits enumeration-safe and does not send an email", async () => {
    const client = fakeClient({ issued: false, challengeId: null });
    mockGetClient.mockResolvedValue(client as never);

    await expect(requestAuthV2Login({
      email: "unknown@example.com",
      returnTo: "/dashboard",
      clientAddress: "192.0.2.10",
      userAgent: null,
    })).resolves.toEqual({ ok: true });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  test("keeps database and SMTP failures enumeration-safe", async () => {
    const client = fakeClient({ issued: true, challengeId: "19" });
    mockGetClient
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(client as never);
    mockSendEmail.mockResolvedValue({ ok: false, reason: "send_failed" });
    const update = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    mockGetPool.mockReturnValue({ query: update } as never);

    await expect(requestAuthV2Login({
      email: "first@example.com",
      clientAddress: "unknown",
      userAgent: null,
    })).resolves.toEqual({ ok: true });
    await expect(requestAuthV2Login({
      email: "second@example.com",
      clientAddress: "unknown",
      userAgent: null,
    })).resolves.toEqual({ ok: true });

    expect(update).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE auth_challenges"),
      ["failed", "19"],
    );
  });

  test("consumes a challenge into one opaque database session", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("consume_auth_login_challenge")) {
        return {
          rows: [{
            consumed: true,
            userId: "42",
            sessionId: "73",
            email: "User@example.com",
            fullName: null,
            emailVerifiedAt: new Date("2026-07-28T12:00:00.000Z"),
            returnTo: "/checkout?plan=pilot-week",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: jest.fn() };
    mockGetClient.mockResolvedValue(client as never);
    const legacyToken = `42.${
      createHmac("sha256", process.env.SESSION_SECRET!)
        .update("session:42")
        .digest("hex")
    }`;

    const result = await consumeAuthV2Login({
      token: "a".repeat(64),
      clientAddress: "192.0.2.10",
      legacyToken,
    });

    expect(result).toMatchObject({
      account: {
        id: "42",
        email: "User@example.com",
        fullName: null,
      },
      returnTo: "/checkout?plan=pilot-week",
      session: { id: "73" },
    });
    expect(result?.session.token).toMatch(/^[a-f0-9]{64}$/);
    const consumeCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("consume_auth_login_challenge"),
    );
    expect(consumeCall?.[1]).toHaveLength(5);
    expect(consumeCall?.[1]?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[0]).not.toBe("a".repeat(64));
    expect(consumeCall?.[1]?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[1]).not.toBe(result?.session.token);
    expect(consumeCall?.[1]?.[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[4]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[4]).not.toBe(legacyToken);
    expect(consumeCall?.[1]).not.toContain("192.0.2.10");
    expect(client.release).toHaveBeenCalled();
  });

  test("rejects malformed consume tokens before touching the database", async () => {
    await expect(consumeAuthV2Login({
      token: "not-a-token",
      clientAddress: "unknown",
    })).resolves.toBeNull();
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("fails closed when the consume database is unavailable", async () => {
    mockGetClient.mockRejectedValue(new Error("database unavailable"));

    await expect(consumeAuthV2Login({
      token: "b".repeat(64),
      clientAddress: "unknown",
    })).resolves.toBeNull();
  });

  test("fails closed when the consume hashing secret is unavailable", async () => {
    delete process.env.AUTH_RATE_LIMIT_SECRET;
    delete process.env.SESSION_SECRET;

    await expect(consumeAuthV2Login({
      token: "c".repeat(64),
      clientAddress: "unknown",
    })).resolves.toBeNull();
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("does not collapse unknown clients into one shared verification IP bucket", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        consumed: false,
        userId: null,
        sessionId: null,
        email: null,
        fullName: null,
        emailVerifiedAt: null,
        returnTo: null,
      }],
      rowCount: 1,
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await consumeAuthV2Login({
      token: "d".repeat(64),
      clientAddress: "unknown",
    });

    const consumeCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("consume_auth_login_challenge"),
    );
    expect(consumeCall?.[1]?.[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(consumeCall?.[1]?.[3]).toBeNull();
    expect(consumeCall?.[1]?.[4]).toBeNull();
  });

  test("routes an existing canary identity through the ordinary login form", async () => {
    const previousPlatform = process.env.AUTH_PLATFORM_V2_ENABLED;
    const previousCanary = process.env.AUTH_V2_CANARY_USER_IDS;
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    process.env.AUTH_V2_CANARY_USER_IDS = "42";
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({
        rows: [{ userId: "42" }],
        rowCount: 1,
      }),
    } as never);

    try {
      await expect(shouldRequestAuthV2Login("owner@example.com"))
        .resolves.toBe(true);
    } finally {
      restoreEnv("AUTH_PLATFORM_V2_ENABLED", previousPlatform);
      restoreEnv("AUTH_V2_CANARY_USER_IDS", previousCanary);
    }
  });
});

describe("auth v2 challenge issuance database contract", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  const verifier = readFileSync(verifierPath, "utf8");
  const compact = migration.replace(/\s+/g, " ");

  test("serializes issue/resend and never creates an unverified user", () => {
    expect(compact).toContain("CREATE FUNCTION issue_auth_login_challenge");
    expect(compact).toContain("pg_advisory_xact_lock");
    expect(compact).toContain(
      "UPDATE auth_challenges SET invalidated_at = action_now",
    );
    expect(compact).toContain("COALESCE(MAX(created_at), input_now)");
    expect(compact).toContain("INSERT INTO auth_challenges");
    expect(compact).not.toMatch(/INSERT\s+INTO\s+users/i);
  });

  test("applies global, IP, and email rate limits through canonical buckets", () => {
    const deniedBranch = compact.slice(
      compact.indexOf("IF NOT global_allowed"),
      compact.indexOf("SELECT id INTO resolved_user_id"),
    );

    expect(compact).toContain("consume_auth_rate_limit(");
    expect(compact).toContain("'global'");
    expect(compact).toContain("'trusted_ip_hash'");
    expect(compact).toContain("'email_hash'");
    expect(compact).toContain("RETURN QUERY SELECT FALSE, NULL::BIGINT");
    expect(deniedBranch).not.toContain("INSERT INTO auth_security_events");
  });

  test("resolves login versus signup internally and writes redacted audit", () => {
    expect(compact).toContain("email_normalized = input_email_normalized");
    expect(compact).toContain("LOWER(email) = LOWER(input_email_normalized)");
    expect(compact).toContain("resolved_purpose := 'login'");
    expect(compact).toContain("resolved_purpose := 'signup'");
    expect(compact).toContain("INSERT INTO auth_security_events");
    expect(compact).not.toContain("input_email_normalized, input_email_normalized");
  });

  test("ships a reversible function and real concurrency verifier", () => {
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS issue_auth_login_challenge",
    );
    expect(verifier).toContain("Promise.all");
    expect(verifier).toContain("users_created_before_verification");
    expect(verifier).toContain("one_active_after_concurrent_resend");
    expect(verifier).toContain("rate_limit_denied");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("auth v2 atomic challenge consumption contract", () => {
  const migration = readFileSync(consumeMigrationPath, "utf8");
  const rollback = readFileSync(consumeRollbackPath, "utf8");
  const verifier = readFileSync(consumeVerifierPath, "utf8");
  const rollbackVerifier = readFileSync(rollbackVerifierPath, "utf8");
  const compact = migration.replace(/\s+/g, " ");

  test("serializes identity resolution and creates verified users only on consume", () => {
    expect(compact).toContain("CREATE FUNCTION consume_auth_login_challenge");
    expect(compact).toContain("pg_advisory_xact_lock");
    expect(compact).toContain("FOR UPDATE");
    expect(compact).toContain("INSERT INTO users");
    expect(compact).toContain("email_verified_at");
    expect(compact).toContain("INSERT INTO auth_sessions");
    expect(compact).toContain("UPDATE auth_challenges AS challenge SET consumed_at");
    expect(compact).toContain("challenge_identity_changed");
    expect(compact).toContain("last_authenticated_at");
  });

  test("applies verification limits and writes bounded replay and success audit", () => {
    expect(compact).toContain("input_global_verification_key_hash");
    expect(compact).toContain("input_verification_ip_key_hash IS NOT NULL");
    expect(compact).toContain("'challenge_verify'");
    expect(compact).toContain("challenge_replayed");
    expect(compact).toContain("ON CONFLICT (subject_hash)");
    expect(compact).toContain("login_succeeded");
    expect(compact).toContain("session_created");
    expect(compact).not.toContain("input_email");
  });

  test("ships a safe down path and real race verifier", () => {
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS consume_auth_login_challenge",
    );
    expect(verifier).toContain("Promise.all");
    expect(verifier).toContain("one_consumer_one_session");
    expect(verifier).toContain("one_signup_identity");
    expect(verifier).toContain("resend_consume_serialized");
    expect(verifier).toContain("stale_bound_identity_denied");
    expect(verifier).toContain("magic_login_legacy_revoked");
    expect(verifier).toContain("magic_login_without_cookie_legacy_denied");
    expect(rollback).toContain("rollback refused");
    expect(rollbackVerifier).toContain("full_reverse_chain");
    expect(rollbackVerifier).toContain("live_session_rollback_refused");
  });
});
