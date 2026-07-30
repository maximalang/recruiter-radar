jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(),
}));
jest.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: jest.fn(),
  generateRegistrationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  getPasskeyConfiguration,
  hashPasskeyChallenge,
  matchesPasskeyChallengeHash,
  removeUserPasskey,
} from "@/lib/auth-v2/passkeys";
import { getClient } from "@/lib/db-pool";
import { sendEmail } from "@/lib/email/transport";

const mockGetClient = jest.mocked(getClient);
const mockSendEmail = jest.mocked(sendEmail);
const mockGenerateAuthenticationOptions = jest.mocked(
  generateAuthenticationOptions,
);
const mockGenerateRegistrationOptions = jest.mocked(
  generateRegistrationOptions,
);
const mockVerifyAuthenticationResponse = jest.mocked(
  verifyAuthenticationResponse,
);
const mockVerifyRegistrationResponse = jest.mocked(
  verifyRegistrationResponse,
);
const now = new Date("2026-07-29T12:00:00.000Z");
const env = {
  AUTH_PASSKEYS_ENABLED: "true",
  AUTH_PLATFORM_V2_ENABLED: "true",
  AUTH_SITE_URL: "https://radar.example",
  AUTH_RATE_LIMIT_SECRET: "r".repeat(32),
  SESSION_SECRET: "s".repeat(32),
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "17",
    userId: "42",
    workspaceId: "9",
    authMethod: "magic_link",
    lastAuthenticatedAt: new Date("2026-07-29T11:55:00.000Z"),
    ...overrides,
  } as never;
}

function clientData(challenge: string, type: string): string {
  return Buffer.from(JSON.stringify({
    challenge,
    origin: "https://radar.example",
    type,
  })).toString("base64url");
}

describe("auth v2 passkeys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_RATE_LIMIT_SECRET = "r".repeat(32);
    mockSendEmail.mockResolvedValue({ ok: true });
  });

  test("fails closed on a non-canonical origin or mismatched explicit RP ID", () => {
    expect(getPasskeyConfiguration({
      ...env,
      AUTH_SITE_URL: "http://radar.example",
    })).toBeNull();
    expect(getPasskeyConfiguration({
      ...env,
      AUTH_PASSKEY_RP_ID: "example",
    })).toBeNull();
    expect(getPasskeyConfiguration(env)).toEqual({
      origin: "https://radar.example",
      rpID: "radar.example",
      rpName: "Recruiter Radar",
    });
  });

  test("compares only a SHA-256 challenge hash", () => {
    const hash = hashPasskeyChallenge("challenge-value");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("challenge-value");
    expect(matchesPasskeyChallengeHash("challenge-value", hash)).toBe(true);
    expect(matchesPasskeyChallengeHash("other-value", hash)).toBe(false);
    expect(matchesPasskeyChallengeHash("challenge-value", "invalid")).toBe(false);
  });

  test("issues registration options with discoverability and required UV without storing raw challenge", async () => {
    const rawChallenge = "registration-challenge";
    mockGenerateRegistrationOptions.mockResolvedValue({
      challenge: rawChallenge,
    } as never);
    const query = jest.fn(async (
      sql: string,
      _values?: readonly unknown[],
    ) => {
      if (sql.includes("FROM auth_sessions AS session")) {
        return {
          rows: [{
            active: true,
            email: "owner@example.com",
            displayName: "Owner",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("FROM user_passkeys")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(beginPasskeyRegistration({
      session: session(),
      clientAddress: "203.0.113.4",
      userAgent: "Test Browser",
      now,
      env,
    })).resolves.toEqual({ challenge: rawChallenge });

    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "radar.example",
        rpName: "Recruiter Radar",
        userName: "owner@example.com",
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      }),
    );
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO auth_challenges"),
    );
    expect(insert).toBeDefined();
    expect(insert?.[1]).toContain(hashPasskeyChallenge(rawChallenge));
    expect(insert?.[1]).not.toContain(rawChallenge);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join(
      "\n",
    );
    expect(sql).toContain("consume_auth_rate_limit");
    expect(sql).toContain("LIMIT $2");
    expect(sql).toContain("'passkey_verify'");
    const boundedCredentials = query.mock.calls.find(([statement]) =>
      String(statement).includes("LIMIT $2"),
    );
    expect(boundedCredentials?.[1]).toEqual([
      "42",
      20,
    ]);
  });

  test("refuses registration options when the per-user policy denies them", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM auth_sessions AS session")) {
        return {
          rows: [{
            email: "owner@example.com",
            displayName: "Owner",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(beginPasskeyRegistration({
      session: session(),
      now,
      env,
    })).resolves.toBeNull();
    expect(mockGenerateRegistrationOptions).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO auth_challenges"),
    )).toBe(false);
  });

  test("verifies registration against exact challenge hash, origin, RP ID, and UV", async () => {
    const rawChallenge = "registration-challenge";
    const response = {
      id: "credential-id",
      rawId: "credential-id",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        attestationObject: "attestation",
        clientDataJSON: clientData(rawChallenge, "webauthn.create"),
        transports: ["internal"],
      },
    } as never;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("COUNT(*) < $1")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("FROM auth_challenges AS challenge")) {
        return {
          rows: [{
            challengeId: "81",
            challengeHash: hashPasskeyChallenge(rawChallenge),
            expiresAt: new Date("2026-07-29T12:05:00.000Z"),
            consumedAt: null,
            invalidatedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM auth_sessions AS session")) {
        return {
          rows: [{
            email: "owner@example.com",
            displayName: "Owner",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("WITH created AS")) {
        return {
          rows: [{
            id: "7",
            name: "MacBook",
            deviceType: "multiDevice",
            backedUp: true,
            backupEligible: true,
            transports: ["internal"],
            createdAt: now,
            lastUsedAt: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);
    mockVerifyRegistrationResponse.mockImplementation(async (options) => {
      if (typeof options.expectedChallenge !== "function") {
        throw new Error("Expected a hashed-challenge verifier callback.");
      }
      expect(await options.expectedChallenge(rawChallenge)).toBe(true);
      expect(options.expectedOrigin).toBe("https://radar.example");
      expect(options.expectedRPID).toBe("radar.example");
      expect(options.requireUserPresence).toBe(true);
      expect(options.requireUserVerification).toBe(true);
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: "credential-id",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          userVerified: true,
        },
      } as never;
    });

    await expect(finishPasskeyRegistration({
      session: session(),
      response,
      name: "MacBook",
      now,
      env,
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      passkey: expect.objectContaining({
        name: "MacBook",
        backupEligible: true,
        backedUp: true,
      }),
    }));

    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("INSERT INTO user_passkeys");
    expect(sql).toContain("'passkey_added'");
    expect(sql).toContain("consumed_at");
    expect(sql).toContain("COUNT(*) < $1");
    expect(sql).toContain("'passkey_verify'");
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      subject: expect.stringContaining("Recruiter Radar"),
      html: expect.stringContaining("Recruiter Radar"),
      text: expect.stringContaining("Recruiter Radar"),
    }));
  });

  test("rejects a consumed registration challenge before calling the verifier", async () => {
    const rawChallenge = "registration-challenge";
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("COUNT(*) < $1")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("FROM auth_challenges AS challenge")) {
        return {
          rows: [{
            challengeId: "81",
            challengeHash: hashPasskeyChallenge(rawChallenge),
            expiresAt: new Date("2026-07-29T12:05:00.000Z"),
            consumedAt: new Date("2026-07-29T11:59:00.000Z"),
            invalidatedAt: null,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);

    await expect(finishPasskeyRegistration({
      session: session(),
      response: {
        response: {
          clientDataJSON: clientData(rawChallenge, "webauthn.create"),
        },
      } as never,
      name: "MacBook",
      now,
      env,
    })).resolves.toEqual({ ok: false, code: "challenge_replayed" });
    expect(mockVerifyRegistrationResponse).not.toHaveBeenCalled();
  });

  test("records an unknown authentication credential without disclosing identity", async () => {
    const rawChallenge = "unknown-credential-challenge";
    const response = {
      id: "unknown-credential",
      rawId: "unknown-credential",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: "authenticator-data",
        clientDataJSON: clientData(rawChallenge, "webauthn.get"),
        signature: "signature",
        userHandle: null,
      },
    } as never;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("FROM auth_challenges AS challenge")) {
        return {
          rows: [{
            challengeId: "83",
            challengeHash: hashPasskeyChallenge(rawChallenge),
            returnTo: "/dashboard",
            expiresAt: new Date("2026-07-29T12:05:00.000Z"),
            consumedAt: null,
            invalidatedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM user_passkeys AS passkey")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValueOnce({
      query,
      release: jest.fn(),
    } as never);

    await expect(finishPasskeyAuthentication({
      response,
      clientAddress: "203.0.113.4",
      now,
      env,
    })).resolves.toEqual({
      ok: false,
      code: "verification_failed",
    });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join(
      "\n",
    );
    expect(sql).toContain("'login_failed'");
    expect(sql).toContain("'passkey_verification_failed'");
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  test("issues discoverable authentication options and updates counter and backup state atomically", async () => {
    const rawChallenge = "authentication-challenge";
    mockGenerateAuthenticationOptions.mockResolvedValue({
      challenge: rawChallenge,
    } as never);
    const startQuery = jest.fn(async (
      sql: string,
      _values?: readonly unknown[],
    ) => (
      sql.includes("consume_auth_rate_limit")
        ? { rows: [{ allowed: true }], rowCount: 1 }
        : { rows: [], rowCount: 1 }
    ));
    mockGetClient.mockResolvedValueOnce({
      query: startQuery,
      release: jest.fn(),
    } as never);

    await expect(beginPasskeyAuthentication({
      returnTo: "/dashboard",
      clientAddress: "203.0.113.4",
      userAgent: "Test Browser",
      now,
      env,
    })).resolves.toEqual({ challenge: rawChallenge });
    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: "radar.example",
      userVerification: "required",
    });
    expect(startQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO auth_challenges"),
    )?.[1]).toContain(hashPasskeyChallenge(rawChallenge));

    const response = {
      id: "credential-id",
      rawId: "credential-id",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: "authenticator-data",
        clientDataJSON: clientData(rawChallenge, "webauthn.get"),
        signature: "signature",
        userHandle: null,
      },
    } as never;
    const finishQuery = jest.fn(async (
      sql: string,
      _values?: readonly unknown[],
    ) => {
      if (sql.includes("consume_auth_rate_limit")) {
        return { rows: [{ allowed: true }], rowCount: 1 };
      }
      if (sql.includes("FROM auth_challenges AS challenge")) {
        return {
          rows: [{
            challengeId: "82",
            challengeHash: hashPasskeyChallenge(rawChallenge),
            returnTo: "/dashboard",
            expiresAt: new Date("2026-07-29T12:05:00.000Z"),
            consumedAt: null,
            invalidatedAt: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM user_passkeys AS passkey")) {
        return {
          rows: [{
            id: "7",
            userId: "42",
            credentialId: "credential-id",
            publicKey: Buffer.from([1, 2, 3]),
            counter: "4",
            transports: ["internal"],
            deviceType: "singleDevice",
            backedUp: false,
            email: "owner@example.com",
            displayName: "Owner",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO auth_sessions")) {
        return { rows: [{ sessionId: "91" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValueOnce({
      query: finishQuery,
      release: jest.fn(),
    } as never);
    mockVerifyAuthenticationResponse.mockImplementation(async (options) => {
      if (typeof options.expectedChallenge !== "function") {
        throw new Error("Expected a hashed-challenge verifier callback.");
      }
      expect(await options.expectedChallenge(rawChallenge)).toBe(true);
      expect(options.expectedOrigin).toBe("https://radar.example");
      expect(options.expectedRPID).toBe("radar.example");
      expect(options.requireUserVerification).toBe(true);
      expect(options.credential.counter).toBe(4);
      return {
        verified: true,
        authenticationInfo: {
          credentialID: "credential-id",
          newCounter: 5,
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      } as never;
    });

    await expect(finishPasskeyAuthentication({
      response,
      clientAddress: "203.0.113.4",
      userAgent: "Test Browser",
      replaceSession: {
        id: "19",
        userId: "55",
      },
      now,
      env,
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      returnTo: "/dashboard",
      userId: "42",
      session: {
        id: "91",
        token: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    }));
    const sql = finishQuery.mock.calls
      .map(([statement]) => String(statement))
      .join("\n");
    expect(sql).toContain("'global'");
    expect(sql).toContain("'passkey_verify'");
    expect(sql).toContain("$2::TEXT IS NULL");
    expect(sql).toContain("counter = $2");
    expect(sql).toContain("backed_up = $4");
    expect(sql).toContain("consumed_at");
    expect(sql).toContain("INSERT INTO auth_sessions");
    expect(sql).toContain("'login_succeeded'");
    expect(sql).toContain("revoked_previous");
    expect(sql).toContain("'session_revoked'");
    expect(sql).toContain("'security_action'");
    const sessionInsert = finishQuery.mock.calls.find(([statement]) =>
      String(statement).includes("INSERT INTO auth_sessions"),
    );
    expect(sessionInsert?.[1]?.slice(-2)).toEqual(["19", "55"]);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      subject: expect.stringContaining("Recruiter Radar"),
    }));
  });

  test("notifies the verified recovery email after a passkey is removed", async () => {
    const query = jest.fn(async (sql: string) => (
      sql.includes("WITH active_account AS")
        ? {
          rows: [{
            id: "7",
            name: "MacBook",
            email: "owner@example.com",
            displayName: "Owner",
          }],
          rowCount: 1,
        }
        : { rows: [], rowCount: 1 }
    ));
    mockGetClient.mockResolvedValueOnce({
      query,
      release: jest.fn(),
    } as never);

    await expect(removeUserPasskey({
      session: session(),
      passkeyId: "7",
      now,
      env,
    })).resolves.toBe("removed");

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      subject: expect.stringContaining("Recruiter Radar"),
    }));
    expect(query.mock.calls.map(([sql]) => String(sql)).join("\n"))
      .toContain("'passkey_removed'");
  });
});
