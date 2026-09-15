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
    const timeline = source("app/landing/signal-timeline.tsx");

    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain('data-header-tone="light"');
    expect(hero).toContain('data-hero-layout="interactive-workflow"');
    expect(hero).not.toContain('data-header-tone="dark"');

    expect(timeline).toContain('data-header-tone="light"');
    expect(timeline).toContain('id="scene-signal-timeline"');
    expect(timeline).toContain('data-product-workflow="profile-to-contact"');
    expect(timeline).toContain("Решение остаётся за вами");
  });

  it("keeps the hero demo as the single interactive example on the landing", () => {
    const landing = source("app/landing/landing-page.tsx");

    expect(landing).not.toContain("WorkspaceScene");
    expect(landing).not.toContain("<HeroProductPreview");
    expect(source("app/landing/detection-scene.tsx")).toContain("<HeroProductPreview />");
  });
});
