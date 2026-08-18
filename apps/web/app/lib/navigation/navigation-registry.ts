export type NavigationRegistryEntry = {
  id: string;
  route: string;
  permission?: string;
  visibility?: string;
  analyticsKey?: string;
};

/**
 * Single navigation metadata contract.
 * Presentation layers should consume this registry instead of duplicating
 * route metadata.
 */
export const NavigationRegistry: NavigationRegistryEntry[] = [
  {
    id: "dashboard",
    route: "/dashboard",
    permission: "workspace:read",
    visibility: "workspace",
    analyticsKey: "dashboard_open",
  },
  {
    id: "leads",
    route: "/leads",
    permission: "leads:read",
    visibility: "workspace",
    analyticsKey: "leads_open",
  },
  {
    id: "settings",
    route: "/settings",
    permission: "workspace:read",
    visibility: "workspace",
    analyticsKey: "settings_open",
  },
];
