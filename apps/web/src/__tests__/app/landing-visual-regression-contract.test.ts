import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing visual regression contract", () => {
  it("keeps the dark hero and header on the same tone contract", () => {
    const hero = source("app/landing/detection-scene.tsx");

    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain('data-header-tone="dark"');
    expect(hero).not.toContain('data-header-tone="light" data-hero-layout="signal-spine"');
  });

  it("keeps the live product preview on the canonical scene stylesheet", () => {
    const workspace = source("app/landing/workspace-scene.tsx");

    expect(workspace).toContain('className={sceneStyles.productFrame}');
    expect(workspace).toContain('className={sceneStyles.checkout}');
    expect(workspace).not.toContain("styles.workspaceProductFrame");
    expect(workspace).not.toContain("styles.workspaceCheckout");
  });
});
