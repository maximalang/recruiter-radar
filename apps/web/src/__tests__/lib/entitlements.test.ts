jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));

import { getPool } from "@/lib/db-pool";
import {
  extendEntitlement,
  getEffectiveEntitlement,
  grantEntitlement,
  grantEntitlementUntil,
  hasFeatureAccess,
  revokeEntitlement,
} from "@/lib/entitlements";

const mockGetPool = jest.mocked(getPool);
const mockQuery = jest.fn();

describe("canonical entitlement service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue({
      query: mockQuery,
      connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
    } as never);
  });

  test("returns one stable active contract with explicit source and features", async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        userId: "42",
        source: "admin",
        plan: "admin",
        startsAt: new Date("2026-08-09T10:00:00.000Z"),
        expiresAt: new Date("2026-09-08T10:00:00.000Z"),
        features: ["dashboard", "api", "digest", "delivery"],
        activeSources: ["admin"],
      }],
      rowCount: 1,
    });

    const fixedNow = new Date("2026-08-10T10:00:00.000Z");
    await expect(getEffectiveEntitlement("42", { now: fixedNow })).resolves.toEqual({
      status: "active",
      source: "admin",
      plan: "admin",
      startsAt: "2026-08-09T10:00:00.000Z",
      expiresAt: "2026-09-08T10:00:00.000Z",
      features: ["dashboard", "api", "digest", "delivery"],
      activeSources: ["admin"],
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("CURRENT_TIMESTAMP"),
      [["42"], fixedNow],
    );
  });

  test("fails closed when no active source exists", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(getEffectiveEntitlement(42)).resolves.toEqual({
      status: "inactive",
      source: null,
      plan: null,
      startsAt: null,
      expiresAt: null,
      features: [],
      activeSources: [],
      reason: "no_active_entitlement",
    });
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("COALESCE($2::TIMESTAMPTZ, CURRENT_TIMESTAMP)"),
      [["42"], null],
    );
    await expect(hasFeatureAccess(42, "digest")).resolves.toBe(false);
  });

  test("rejects invalid account identifiers before querying", async () => {
    await expect(getEffectiveEntitlement("not-an-id")).rejects.toThrow(
      "Invalid entitlement user id.",
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("writes admin grants to the canonical audit ledger", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "91" }], rowCount: 1 });

    await expect(grantEntitlement({
      userId: "42",
      source: "admin",
      plan: "radar-30",
      durationDays: 30,
      features: ["dashboard", "digest", "delivery"],
    })).resolves.toEqual({ changed: true, grantId: "91" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO entitlement_grants"),
      ["42", "admin", "radar-30", 30, ["dashboard", "digest", "delivery"]],
    );
  });

  test("writes an exact operator expiry to the same canonical audit ledger", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "92" }], rowCount: 1 });
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);

    await expect(grantEntitlementUntil({
      userId: "42", source: "admin", plan: "radar-admin", expiresAt,
      features: ["dashboard", "digest", "delivery"],
    })).resolves.toEqual({ changed: true, grantId: "92" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/\$4::TIMESTAMPTZ[\s\S]*ends_at = EXCLUDED\.ends_at/),
      ["42", "admin", "radar-admin", expiresAt.toISOString(), ["dashboard", "digest", "delivery"]],
    );
  });

  test("revokes and extends only canonical grants selected by source", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: "93" }], rowCount: 1 });

    await expect(revokeEntitlement({
      userId: 42,
      source: "admin",
    })).resolves.toEqual({ changed: true, count: 2 });
    await expect(extendEntitlement({
      userId: 42,
      source: "admin",
      durationDays: 7,
    })).resolves.toEqual({ changed: true, grantId: "93" });

    expect(String(mockQuery.mock.calls[0][0])).toContain("status = 'revoked'");
    expect(mockQuery.mock.calls[0][1]).toEqual(["42", "admin"]);
    expect(String(mockQuery.mock.calls[1][0])).toContain("INTERVAL '1 day'");
    expect(mockQuery.mock.calls[1][1]).toEqual(["42", "admin", 7]);
  });
});
