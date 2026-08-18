import { NavigationRegistry } from "../lib/navigation/navigation-registry";
import type { NavItem } from "./internal-page";

export type AccountNavigationKey =
  | "dashboard"
  | "leads"
  | "opportunities"
  | "radar"
  | "review"
  | "profile"
  | "settings";

function registeredRoute(id: string): string {
  const entry = NavigationRegistry.find((item) => item.id === id);
  if (!entry) throw new Error(`Navigation registry is missing route: ${id}`);
  return entry.route;
}

const ACCOUNT_ROUTES = [
  { key: "dashboard", href: registeredRoute("dashboard"), label: "Сегодня" },
  { key: "leads", href: registeredRoute("leads"), label: "Компании" },
  { key: "opportunities", href: registeredRoute("opportunities"), label: "Ситуации" },
  { key: "radar", href: "/opportunities/radar", label: "Радар" },
  { key: "settings", href: registeredRoute("settings"), label: "Настройки" },
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
