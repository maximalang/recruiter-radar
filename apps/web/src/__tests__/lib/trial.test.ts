jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));

import { getPool } from "@/lib/db-pool";
import {
  activateVerifiedTrial,
  closeTrialClaimsForAccountDeletion,
  isTrialProfileImmutableError,
} from "@/lib/trial";

const mockGetPool = jest.mocked(getPool);
const now = new Date("2026-08-25T12:00:00.000Z");

function account() {
  return {
    id: "42",
    emailNormalized: "owner@example.com",
    emailVerifiedAt: now,
    telegramChatId: "70000000001",
    telegramVerifiedAt: now,
  };
}

function successfulActivationQuery() {
  return jest
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [account()], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ id: "77" }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({
      rows: [{
        id: "88",
        startsAt: now,
        endsAt: new Date("2026-08-28T12:00:00.000Z"),
      }],
      rowCount: 1,
    })
    .mockResolvedValueOnce({ rows: [{ id: "99" }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
}

describe("verified trial runtime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TRIAL_ANTI_ABUSE_SECRET = [
      "unit-only-binding-secret-with-sufficient-entropy",
    ].join("");
  });

  afterEach(() => {
    delete process.env.TRIAL_ANTI_ABUSE_SECRET;
  });

  test("creates one canonical three-day grant and hashed binding claim", async () => {
    const query = successfulActivationQuery();
    const release = jest.fn();
    mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue({ query, release }) } as never);

    await expect(activateVerifiedTrial({ userId: "42", workspaceId: "9", now })).resolves.toEqual({
      status: "activated",
      claimId: "99",
      grantId: "88",
      startsAt: now.toISOString(),
      endsAt: "2026-08-28T12:00:00.000Z",
    });

    const grantCall = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO entitlement_grants"));
    const claimCall = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO trial_claims"));
    expect(grantCall?.[1]).toEqual([
      "42",
      "9",
      "trial-3d",
      ["dashboard", "api", "digest", "delivery"],
      now.toISOString(),
    ]);
    expect(claimCall?.[1]).toHaveLength(8);
    expect(claimCall?.[1]?.[4]).toMatch(/^[a-f0-9]{64}$/);
    expect(claimCall?.[1]?.[5]).toMatch(/^[a-f0-9]{64}$/);
    expect(claimCall?.[1]?.[6]).toMatch(/^[a-f0-9]{64}$/);
    expect(claimCall?.[1]).not.toContain("owner@example.com");
    expect(claimCall?.[1]).not.toContain("70000000001");
    expect(String(grantCall?.[0])).toContain("INTERVAL '3 days'");
    expect(String(claimCall?.[0])).toContain("INTERVAL '3 days'");
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("fails closed when the anti-abuse secret is weak", async () => {
    process.env.TRIAL_ANTI_ABUSE_SECRET = "too-short";

    await expect(activateVerifiedTrial({ userId: 42, workspaceId: 9, now })).rejects.toThrow(
      "sufficient entropy",
    );
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  test("fails closed when Telegram is linked but not server-verified", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ ...account(), telegramVerifiedAt: null }],
        rowCount: 1,
      });
    mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }) } as never);

    await expect(activateVerifiedTrial({ userId: 42, workspaceId: 9, now })).resolves.toEqual({
      status: "not_eligible",
      reason: "telegram_unverified",
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO entitlement_grants"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  test("rejects a second claim before creating another grant", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [account()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "77" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "99" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue({ query, release: jest.fn() }) } as never);

    await expect(activateVerifiedTrial({ userId: 42, workspaceId: 9, now })).resolves.toEqual({
      status: "already_claimed",
      reason: "binding_or_account_has_trial",
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO entitlement_grants"))).toBe(false);
  });

  test("closes the claim before account deletion profile scrubbing", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await closeTrialClaimsForAccountDeletion({ query }, "42", now);

    expect(query).toHaveBeenNthCalledWith(1, "SELECT rr_trial_profile_owner_lock($1)", ["42"]);
    expect(String(query.mock.calls[1][0])).toContain("UPDATE trial_claims");
    expect(String(query.mock.calls[2][0])).toContain("UPDATE entitlement_grants");
    expect(query.mock.calls[1][1]).toEqual(["42", now.toISOString()]);
    expect(query.mock.calls[2][1]).toEqual(["42", now.toISOString()]);
  });

  test("recognizes only the database guard error", () => {
    expect(isTrialProfileImmutableError({
      code: "42501",
      constraint: "client_profiles_trial_immutable_guard",
    })).toBe(true);
    expect(isTrialProfileImmutableError({ code: "42501" })).toBe(false);
    expect(isTrialProfileImmutableError({
      code: "23505",
      constraint: "client_profiles_trial_immutable_guard",
    })).toBe(false);
  });
});
