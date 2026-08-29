import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing visual regression contract", () => {
  it("keeps the ambient radar hero and transparent header on readable tone contracts", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const timeline = source("app/landing/signal-timeline.tsx");

    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain('data-header-tone="dark"');
    expect(hero).toContain('data-hero-layout="product-workspace"');
    expect(hero).not.toContain('data-header-tone="light"');

    expect(timeline).toContain('data-header-tone="light"');
    expect(timeline).toContain('id="scene-signal-timeline"');
    expect(timeline).toContain('data-product-workflow="profile-to-contact"');
    expect(timeline).toContain("Решение остаётся за вами");
  });

  it("keeps the live product preview on the canonical scene stylesheet", () => {
    const workspace = source("app/landing/workspace-scene.tsx");

    expect(workspace).toContain('className={sceneStyles.productFrame}');
    expect(workspace).toContain('className={sceneStyles.checkout}');
    expect(workspace).not.toContain("styles.workspaceProductFrame");
    expect(workspace).not.toContain("styles.workspaceCheckout");
  });
});
