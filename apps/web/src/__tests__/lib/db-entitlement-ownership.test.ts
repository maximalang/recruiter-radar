jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));
jest.mock("@/lib/entitlements", () => ({
  getEffectiveEntitlement: jest.fn(),
}));

import { getPool } from "@/lib/db-pool";
import { getEffectiveEntitlement } from "@/lib/entitlements";

const { assertDigestEntitlementByClientProfileId } =
  jest.requireActual<typeof import("@/lib/db")>("@/lib/db");

const mockGetPool = jest.mocked(getPool);
const mockGetEffectiveEntitlement = jest.mocked(getEffectiveEntitlement);

describe("profile ownership entitlement boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("preserves BIGINT owner identifiers as strings", async () => {
    const ownerId = "9007199254740993";
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({
        rows: [{ isActive: true, ownerId, workspaceId: "9" }],
        rowCount: 1,
      }),
    } as never);
    mockGetEffectiveEntitlement.mockResolvedValue({
      status: "active",
      source: "admin",
      plan: "radar-30",
      startsAt: "2026-08-09T10:00:00.000Z",
      expiresAt: "2026-09-08T10:00:00.000Z",
      features: ["digest", "delivery"],
      activeSources: ["admin"],
    });

    await expect(assertDigestEntitlementByClientProfileId("7"))
      .resolves.toBeUndefined();
    expect(mockGetEffectiveEntitlement).toHaveBeenCalledWith(ownerId, { workspaceId: "9" });
  });

  test("requires the delivery feature on notification delivery paths", async () => {
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({
        rows: [{ isActive: true, ownerId: "42", workspaceId: "9" }],
        rowCount: 1,
      }),
    } as never);
    mockGetEffectiveEntitlement.mockResolvedValue({
      status: "active",
      source: "admin",
      plan: "digest-only",
      startsAt: "2026-08-09T10:00:00.000Z",
      expiresAt: "2026-09-08T10:00:00.000Z",
      features: ["digest"],
      activeSources: ["admin"],
    });

    await expect(assertDigestEntitlementByClientProfileId("7", "digest"))
      .resolves.toBeUndefined();
    await expect(assertDigestEntitlementByClientProfileId("7", "delivery"))
      .rejects.toThrow("No active subscription or pilot.");
  });
});
