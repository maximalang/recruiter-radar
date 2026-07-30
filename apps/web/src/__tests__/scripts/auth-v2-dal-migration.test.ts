import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const webRoot = resolve(process.cwd());
const auditedRoots = [
  "app/dashboard",
  "app/checkout",
  "app/onboarding/pilot",
  "app/profile",
  "app/settings",
  "app/leads",
  "app/review",
  "app/opportunities",
  "app/api/leads",
  "app/api/profile",
  "app/api/review",
  "app/api/opportunities",
  "app/api/push",
  "app/api/telegram",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("Auth v2 DAL migration contract", () => {
  test("removes direct legacy session authorization from every audited tenant surface", () => {
    const offenders = auditedRoots.flatMap((root) =>
      sourceFiles(resolve(webRoot, root))
        .filter((path) => {
          const source = readFileSync(path, "utf8");
          return (
            /\b(?:readOwnerSession|getOwnerIdFromSession)\b/.test(source)
            && /(?:@\/lib\/session|lib\/session)/.test(source)
          );
        })
        .map((path) => path.slice(webRoot.length + 1).replaceAll("\\", "/"))
    );

    expect(offenders).toEqual([]);
  });

  test("uses explicit least-privilege permissions on representative surfaces", () => {
    const expectedPermissions: Record<string, string[]> = {
      "app/dashboard/page.tsx": [
        "workspace:read",
        "profiles:read",
        "leads:read",
        "notifications:read",
      ],
      "app/settings/page.tsx": [
        "workspace:read",
        "profiles:read",
        "notifications:read",
      ],
      "app/checkout/page.tsx": ["billing:manage"],
      "app/profile/page.tsx": ["profiles:read"],
      "app/profile/actions.ts": ["profiles:write"],
      "app/profile/notification-actions.ts": ["notifications:write"],
      "app/leads/page.tsx": ["leads:read"],
      "app/api/leads/export/route.ts": ["exports:create"],
      "app/review/page.tsx": ["leads:read"],
      "app/api/review/route.ts": ["leads:write"],
      "app/opportunities/page.tsx": ["opportunities:read"],
      "app/api/opportunities/[id]/action/route.ts": ["opportunities:write"],
      "app/api/push/subscribe/route.ts": ["notifications:write"],
      "app/api/telegram/connect-status/route.ts": ["notifications:read"],
    };

    for (const [file, permissions] of Object.entries(expectedPermissions)) {
      const source = readFileSync(resolve(webRoot, file), "utf8");
      for (const permission of permissions) {
        expect(source).toMatch(new RegExp(`["']${permission}["']`));
      }
    }
  });
});
