import type { NavItem } from "./internal-page";

export type AccountNavigationKey = "dashboard" | "leads" | "review" | "profile" | "settings";

const ACCOUNT_ROUTES: ReadonlyArray<{ key: AccountNavigationKey; href: string; label: string }> = [
  { key: "dashboard", href: "/dashboard", label: "Дашборд" },
  { key: "leads", href: "/leads", label: "Возможности" },
  { key: "review", href: "/review", label: "Проверка" },
  { key: "profile", href: "/settings/radar", label: "Радар" },
  { key: "settings", href: "/settings", label: "Настройки" },
];

export function buildAccountNavigation(active: AccountNavigationKey): NavItem[] {
  return ACCOUNT_ROUTES.map((route) => ({
    href: route.href,
    label: route.label,
    active: route.key === active,
  }));
}
