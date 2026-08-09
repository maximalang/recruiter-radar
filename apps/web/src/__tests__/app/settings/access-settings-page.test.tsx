import { Children, isValidElement, type ReactNode } from "react";

jest.mock("@/lib/auth-v2/authorization", () => ({ getSession: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({ getEffectiveEntitlement: jest.fn() }));
jest.mock("@/lib/paymentsRepo", () => ({ listCheckoutOrdersForOwner: jest.fn() }));

import AccessSettingsPage from "@/app/settings/access/page";
import { getSession } from "@/lib/auth-v2/authorization";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import { listCheckoutOrdersForOwner } from "@/lib/paymentsRepo";

describe("access settings page", () => {
  test("loads canonical access and only the signed-in user's orders", async () => {
    jest.mocked(getSession).mockResolvedValue({ userId: "84", dataOwnerId: "42" } as never);
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({
      status: "active",
      source: "admin",
      plan: "radar-admin-7",
      startsAt: "2026-08-09T10:00:00.000Z",
      expiresAt: "2026-08-16T10:00:00.000Z",
      features: ["dashboard", "digest"],
      activeSources: ["admin"],
    });
    jest.mocked(listCheckoutOrdersForOwner).mockResolvedValue([]);

    const page = await AccessSettingsPage();
    const text = collectText(page);
    expect(text).toContain("Текущий доступ");
    expect(text).toContain("radar-admin-7");
    expect(getEffectiveEntitlement).toHaveBeenCalledWith("42");
    expect(listCheckoutOrdersForOwner).toHaveBeenCalledWith("42");
    expect(getSession).toHaveBeenCalledWith({
      permissions: ["workspace:read", "billing:read"],
    });
  });

  test("shows an explicit unavailable state when order history cannot be loaded", async () => {
    jest.mocked(getSession).mockResolvedValue({ userId: "84", dataOwnerId: "42" } as never);
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({
      status: "inactive", source: null, plan: null, startsAt: null, expiresAt: null,
      features: [], activeSources: [], reason: "no_active_entitlement",
    });
    jest.mocked(listCheckoutOrdersForOwner).mockRejectedValue(new Error("database unavailable"));

    const page = await AccessSettingsPage();

    expect(collectText(page)).toContain("История заказов временно недоступна");
    expect(collectText(page)).not.toContain("Заказов пока нет");
  });
});

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement<Record<string, unknown>>(node)) return "";
  const children = (node.props as { children?: ReactNode }).children;
  return Children.toArray(children).map(collectText).join(" ");
}
