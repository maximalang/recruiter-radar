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

  it("keeps the authenticated shell addressable after the frame migration", () => {
    const workspace = readAppFile("ui/product-workspace.tsx");
    const internalPage = readAppFile("ui/internal-page.tsx");

    expect(workspace).toContain('data-product-workspace="true"');
    expect(internalPage).toContain("<ProductWorkspaceFrame");
  });
});
