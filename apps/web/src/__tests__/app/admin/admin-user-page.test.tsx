import { Children, isValidElement, type ReactNode } from "react";

jest.mock("@/lib/operator-auth", () => ({ checkOperatorAccess: jest.fn() }));
jest.mock("@/lib/admin/adminUserDetail", () => ({ getAdminUserDetail: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn(), notFound: jest.fn() }));

import AdminUserPage from "@/app/admin/users/[id]/page";
import { getAdminUserDetail } from "@/lib/admin/adminUserDetail";
import { checkOperatorAccess } from "@/lib/operator-auth";

describe("admin user control center", () => {
  test("renders diagnostic chain and operational sections", async () => {
    jest.mocked(checkOperatorAccess).mockResolvedValue({ ok: true } as never);
    jest.mocked(getAdminUserDetail).mockResolvedValue({
      dataOwnerId: "42",
      account: { id: "42", email: "owner@example.test", fullName: "Owner", status: "active", createdAt: "2026-08-01T00:00:00.000Z", emailVerifiedAt: null, lastLoginAt: null, activeSessionCount: 1 },
      workspace: { id: "9", name: "Agency", status: "active", role: "owner" },
      profile: { id: "7", agencyName: "Agency", isActive: true, specialization: "IT", targetCity: "Москва", roles: [], industries: [], companySizes: [], excludedIndustries: [], thresholds: { hiringIntentMin: null, signalFreshnessDays: 14, minOpenRoles: null } },
      access: { status: "active", source: "admin", plan: "radar-admin-7", startsAt: "2026-08-09T00:00:00.000Z", expiresAt: "2026-08-16T00:00:00.000Z", features: ["digest"], activeSources: ["admin"] },
      payments: [],
      delivery: { enabled: true, telegramConfigured: true, emailEnabled: false, emailConfigured: false, webPushEnabled: false, activeWebPushCount: 0, activeEndpointCount: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null },
      radar: { matchingCompanyCount: 3, currentOpportunityCount: 2, lastRunAt: null, lastDigestAt: null, lastDigestStatus: null, lastSignalAt: "2026-08-08T00:00:00.000Z" },
      diagnostics: [
        { key: "account", label: "Account", status: "PASS", reason: "Статус аккаунта: active" },
        { key: "digest", label: "Digest eligible", status: "PASS", reason: "Все обязательные условия выполнены" },
      ],
    } as never);

    const page = await AdminUserPage({ params: Promise.resolve({ id: "42" }) });
    const text = collectText(page);
    expect(text).toContain("Диагностика готовности");
    expect(text).toContain("Digest eligible");
    expect(text).toContain("Платежи и заказы");
    expect(getAdminUserDetail).toHaveBeenCalledWith("42");
  });
});

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement<Record<string, unknown>>(node)) return "";
  const children = (node.props as { children?: ReactNode }).children;
  return Children.toArray(children).map(collectText).join(" ");
}
