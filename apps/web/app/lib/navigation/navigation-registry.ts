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
    id: "opportunities",
    route: "/opportunities",
    permission: "opportunities:read",
    visibility: "workspace",
    analyticsKey: "opportunities_open",
  },
  {
    id: "review",
    route: "/review",
    permission: "review:read",
    visibility: "workspace",
    analyticsKey: "review_open",
  },
  {
    id: "profile",
    route: "/profile",
    permission: "workspace:read",
    visibility: "workspace",
    analyticsKey: "profile_open",
  },
  {
    id: "settings",
    route: "/settings",
    permission: "workspace:read",
    visibility: "workspace",
    analyticsKey: "settings_open",
  },
  {
    id: "diagnostics",
    route: "/settings/diagnostics",
    permission: "workspace:read",
    visibility: "workspace",
    analyticsKey: "diagnostics_open",
  },
];
