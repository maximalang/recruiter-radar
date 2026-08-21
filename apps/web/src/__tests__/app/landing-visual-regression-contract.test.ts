import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing visual regression contract", () => {
  it("keeps the inverse hero and transparent header on readable tone contracts", () => {
    const hero = source("app/landing/detection-scene.tsx");

    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain('data-header-tone="light"');
    expect(hero).toContain('data-hero-layout="company-brief"');
    expect(hero).not.toContain('data-header-tone="dark"');
  });

  it("keeps the live product preview on the canonical scene stylesheet", () => {
    const workspace = source("app/landing/workspace-scene.tsx");

    expect(workspace).toContain('className={sceneStyles.productFrame}');
    expect(workspace).toContain('className={sceneStyles.checkout}');
    expect(workspace).not.toContain("styles.workspaceProductFrame");
    expect(workspace).not.toContain("styles.workspaceCheckout");
  });
});