jest.mock("@/lib/db-pool", () => ({ getPool: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({ getEffectiveEntitlement: jest.fn() }));
jest.mock("@/lib/paymentsRepo", () => ({ listCheckoutOrdersForAccess: jest.fn() }));

import { buildAdminUserDiagnostics, getAdminUserDetail } from "@/lib/admin/adminUserDetail";
import { getPool } from "@/lib/db-pool";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import { listCheckoutOrdersForAccess } from "@/lib/paymentsRepo";

const activeAccess = {
  status: "active" as const,
  source: "admin" as const,
  plan: "radar-admin-7",
  startsAt: "2026-08-09T00:00:00.000Z",
  expiresAt: "2026-08-16T00:00:00.000Z",
  features: ["dashboard", "digest", "delivery"] as const,
  activeSources: ["admin"] as const,
};

describe("admin user detail", () => {
  test("loads the exact user and reuses canonical access and owner-scoped payments", async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{
      id: "42", dataOwnerId: "7", email: "member@example.test", fullName: null, status: "active",
      createdAt: "2026-08-01T00:00:00.000Z", emailVerifiedAt: null,
      lastLoginAt: null, activeSessionCount: "1", workspaceId: "9", workspaceName: "Agency",
      workspaceStatus: "active", workspaceRole: "owner", profileId: "7", agencyName: "Agency",
      profileActive: true, specialization: "IT", targetCity: "Москва", roles: ["developer"],
      industries: ["software"], companySizes: ["51-200"], excludedIndustries: [],
      hiringIntentMin: 2, signalFreshnessDays: 14, minOpenRoles: 1, deliveryEnabled: true,
      telegramChatId: "100", emailDigestEnabled: false, digestEmailConfigured: false,
      webPushEnabled: false, activeWebPushCount: "0", activeEndpointCount: "0",
      lastDeliveryAt: null, lastDeliveryErrorAt: null, lastDeliveryErrorCode: null,
      matchingCompanyCount: "3", currentOpportunityCount: "2", lastRadarAt: null,
      lastDigestAt: null, lastDigestStatus: null, lastSignalAt: "2026-08-08T00:00:00.000Z",
    }] });
    jest.mocked(getPool).mockReturnValue({ query } as never);
    jest.mocked(getEffectiveEntitlement).mockResolvedValue(activeAccess as never);
    jest.mocked(listCheckoutOrdersForAccess).mockResolvedValue([]);

    const detail = await getAdminUserDetail("42", "9");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("ws.id = $2::BIGINT"), ["42", "9"]);
    const detailSql = String(query.mock.calls[0]?.[0] ?? "");
    expect(detailSql).toContain("delivery_status IN ('failed_retryable', 'failed_terminal')");
    expect(detailSql).toContain("attempted_at AS error_at");
    expect(detailSql).toContain("MAX(delivered_at)");
    expect(getEffectiveEntitlement).toHaveBeenCalledWith("7", { workspaceId: "9" });
    expect(listCheckoutOrdersForAccess).toHaveBeenCalledWith({ workspaceId: "9", entitlementOwnerId: "7", limit: 50 });
    expect(detail?.account.id).toBe("42");
    expect(detail?.dataOwnerId).toBe("7");
    expect(detail?.diagnostics.at(-1)).toMatchObject({ key: "digest", status: "PASS" });
  });

  test("fails closed when an upstream readiness link is missing", () => {
    const diagnostics = buildAdminUserDiagnostics({
      dataOwnerId: "1",
      account: { id: "1", email: "x@example.test", fullName: null, status: "active", createdAt: "2026-08-01T00:00:00.000Z", emailVerifiedAt: null, lastLoginAt: null, activeSessionCount: 0 },
      workspace: null,
      profile: null,
      access: activeAccess as never,
      payments: [],
      delivery: { enabled: true, telegramConfigured: true, emailEnabled: false, emailConfigured: false, webPushEnabled: false, activeWebPushCount: 0, activeEndpointCount: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
      radar: { matchingCompanyCount: 0, currentOpportunityCount: 0, lastRunAt: null, lastDigestAt: null, lastDigestStatus: null, lastSignalAt: null },
    }, new Date("2026-08-09T00:00:00.000Z"));

    expect(diagnostics.find((item) => item.key === "workspace")?.status).toBe("FAIL");
    expect(diagnostics.at(-1)).toMatchObject({ key: "digest", status: "FAIL" });
  });

  test("requires both digest and delivery features for digest eligibility", () => {
    const diagnostics = buildAdminUserDiagnostics({
      dataOwnerId: "1",
      account: { id: "1", email: "x@example.test", fullName: null, status: "active", createdAt: "2026-08-01T00:00:00.000Z", emailVerifiedAt: null, lastLoginAt: null, activeSessionCount: 0 },
      workspace: { id: "2", name: "Agency", status: "active", role: "owner" },
      profile: { id: "3", agencyName: "Agency", isActive: true, specialization: null, targetCity: null, roles: [], industries: [], companySizes: [], excludedIndustries: [], thresholds: { hiringIntentMin: null, signalFreshnessDays: 14, minOpenRoles: null }, dailyDigestLimit: 5 },
      access: { ...activeAccess, features: ["dashboard", "digest"] } as never,
      payments: [],
      delivery: { enabled: true, telegramConfigured: true, emailEnabled: false, emailConfigured: false, webPushEnabled: false, activeWebPushCount: 0, activeEndpointCount: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
      radar: { matchingCompanyCount: 1, currentOpportunityCount: 1, lastRunAt: null, lastDigestAt: null, lastDigestStatus: null, lastSignalAt: "2026-08-08T00:00:00.000Z" },
    }, new Date("2026-08-09T00:00:00.000Z"));

    expect(diagnostics.at(-1)).toMatchObject({ key: "digest", status: "FAIL", reason: "Нет возможностей: delivery" });
  });
});
