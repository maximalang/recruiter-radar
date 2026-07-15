import { buildAccountNavigation } from "@/app/ui/account-navigation";

describe("buildAccountNavigation", () => {
  it("keeps one active item and includes settings", () => {
    const items = buildAccountNavigation("settings");

    expect(items.filter((item) => item.active)).toEqual([
      expect.objectContaining({ href: "/settings", label: "Настройки" }),
    ]);
    expect(items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/leads",
      "/review",
      "/profile",
      "/settings",
    ]);
  });
});
