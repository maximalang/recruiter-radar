import { buildAccountNavigation } from "@/app/ui/account-navigation";

describe("buildAccountNavigation", () => {
  it("uses the final Today / Companies / Situations / Radar information architecture", () => {
    const items = buildAccountNavigation("settings");

    expect(items.filter((item) => item.active)).toEqual([
      expect.objectContaining({ href: "/settings", label: "Настройки" }),
    ]);
    expect(items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/leads",
      "/opportunities",
      "/opportunities/radar",
      "/settings",
    ]);
    expect(items.slice(0, 4).map((item) => item.label)).toEqual([
      "Сегодня",
      "Компании",
      "Ситуации",
      "Радар",
    ]);
    expect(items.map((item) => item.label)).not.toContain("Возможности");
    expect(items.map((item) => item.label)).not.toContain("Проверка");
  });

  it("maps review into Today and profile configuration into Settings", () => {
    expect(buildAccountNavigation("review").find((item) => item.active)?.href).toBe("/dashboard");
    expect(buildAccountNavigation("profile").find((item) => item.active)?.href).toBe("/settings");
  });
});
