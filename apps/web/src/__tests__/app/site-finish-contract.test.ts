import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("cross-route visual layer contract", () => {
  const readAppFile = (path: string) =>
    readFileSync(resolve(process.cwd(), "app", path), "utf8");

  it("loads one scoped product layer without the legacy visual stack", () => {
    const layout = readAppFile("layout.tsx");
    const productIndex = layout.indexOf('import "./product-visual-system.css"');
    const interactionsIndex = layout.indexOf('import "./site-interactions.css"');

    expect(layout).not.toContain('import "./premium-ui.css"');
    expect(layout).not.toContain('import "./premium-ui-refinements.css"');
    expect(layout).not.toContain('import "./site-finish.css"');
    expect(layout).not.toContain("PremiumUiEffects");
    expect(productIndex).toBeGreaterThan(-1);
    expect(interactionsIndex).toBeGreaterThan(productIndex);
  });

  it("removes the obsolete broad-selector stylesheets", () => {
    for (const legacyFile of [
      "premium-ui.css",
      "premium-ui-refinements.css",
      "site-finish.css",
      "premium-ui-effects.tsx",
    ]) {
      expect(existsSync(resolve(process.cwd(), "app", legacyFile))).toBe(false);
    }
  });

  it("keeps product controls free of the retired blue action palette", () => {
    const productStyles = [
      "ui/internal-page.module.css",
      "ui/page-primitives.module.css",
      "dashboard/dashboard.module.css",
      "opportunities/opportunities.module.css",
      "auth/pending-auth-action.module.css",
      "leads/[id]/next-steps-block.module.css",
      "leads/[id]/feedback-buttons.module.css",
      "settings/settings-overview.module.css",
      "settings/security/security-settings.module.css",
      "settings/team/team-settings.module.css",
    ];
    const legacyBlue = /#(?:1d4ed8|1e3a8a|1e40af|3b82f6|bfdbfe|dbeafe|eff6ff)|rgba\(59,\s*130,\s*246/gi;

    for (const path of productStyles) {
      expect(readAppFile(path).match(legacyBlue)).toBeNull();
    }
  });

  it("keeps the authenticated shell addressable after the frame migration", () => {
    const workspace = readAppFile("ui/product-workspace.tsx");
    const internalPage = readAppFile("ui/internal-page.tsx");

    expect(workspace).toContain('data-product-workspace="true"');
    expect(internalPage).toContain("<ProductWorkspaceFrame");
  });
});
