import type { NavItem } from "./internal-page";

export type AccountNavigationKey =
  | "dashboard"
  | "leads"
  | "opportunities"
  | "radar"
  | "review"
  | "profile"
  | "settings";

const ACCOUNT_ROUTES = [
  { key: "dashboard", href: "/dashboard", label: "Сегодня" },
  { key: "leads", href: "/leads", label: "Компании" },
  { key: "opportunities", href: "/opportunities", label: "Ситуации" },
  { key: "radar", href: "/opportunities/radar", label: "Радар" },
  { key: "settings", href: "/settings", label: "Настройки" },
] as const;

function routeIsActive(routeKey: (typeof ACCOUNT_ROUTES)[number]["key"], active: AccountNavigationKey) {
  if (active === "review") return routeKey === "dashboard";
  if (active === "profile") return routeKey === "settings";
  return routeKey === active;
}

export function buildAccountNavigation(active: AccountNavigationKey): NavItem[] {
  return ACCOUNT_ROUTES.map((route) => ({
    href: route.href,
    label: route.label,
    active: routeIsActive(route.key, active),
  }));
}
