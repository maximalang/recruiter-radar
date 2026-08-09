import { buildAccountNavigation } from "@/app/ui/account-navigation";

describe("buildAccountNavigation", () => {
  it("keeps one active item and uses the unified Radar settings route", () => {
    const items = buildAccountNavigation("settings");

    expect(items.filter((item) => item.active)).toEqual([
      expect.objectContaining({ href: "/settings", label: "Настройки" }),
    ]);
    expect(items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/leads",
      "/review",
      "/settings/radar",
      "/settings",
    ]);
    expect(items).toContainEqual(
      expect.objectContaining({ href: "/leads", label: "Возможности" }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ href: "/settings/radar", label: "Радар" }),
    );
  });
});
