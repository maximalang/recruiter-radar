import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("cross-route layout finish contract", () => {
  const readAppFile = (path: string) =>
    readFileSync(resolve(process.cwd(), "app", path), "utf8");

  it("loads the finishing layer after the older premium layers", () => {
    const layout = readAppFile("layout.tsx");
    const premiumIndex = layout.indexOf('import "./premium-ui.css"');
    const refinementsIndex = layout.indexOf('import "./premium-ui-refinements.css"');
    const finishIndex = layout.indexOf('import "./site-finish.css"');

    expect(premiumIndex).toBeGreaterThan(-1);
    expect(refinementsIndex).toBeGreaterThan(premiumIndex);
    expect(finishIndex).toBeGreaterThan(refinementsIndex);
  });

  it("covers every page family and preserves responsive accessibility", () => {
    const css = readAppFile("site-finish.css");

    expect(css).toContain('[data-product-workspace="true"]');
    expect(css).toContain("main[data-ui-system]:not([class*=\"shell\"])");
    expect(css).toContain("main[data-ui-system][class*=\"shell\"]");
    expect(css).toContain("[data-landing-experience]");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("@media (hover: none)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the authenticated shell addressable after the frame migration", () => {
    const workspace = readAppFile("ui/product-workspace.tsx");
    const internalPage = readAppFile("ui/internal-page.tsx");

    expect(workspace).toContain('data-product-workspace="true"');
    expect(internalPage).toContain("<ProductWorkspaceFrame");
  });
});
