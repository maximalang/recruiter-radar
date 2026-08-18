import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("signal timeline visibility contract", () => {
  it("keeps semantic timeline content visible outside the pending reveal state", () => {
    const timeline = source("app/landing/signal-timeline-scene.tsx");
    const styles = source("app/landing/signal-timeline-scene.module.css");

    expect(timeline).toContain("data-timeline-event");
    expect(timeline).toContain('data-opportunity-lock="true"');

    expect(styles).toMatch(/\.event\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none;/);
    expect(styles).toMatch(/\.lock\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none;/);

    expect(styles).toContain('.section:global([data-motion-state="pending"]) .event { opacity: 0;');
    expect(styles).toContain('.section:global([data-motion-state="pending"]) .lock { opacity: 0;');
    expect(styles).toContain('.section:global([data-motion-state="pending"]) .trajectory::before { transform: scaleY(0); }');
    expect(styles).toContain('.section:global([data-motion-state="pending"]) .trajectory i { transform: scaleX(0); }');

    expect(styles).not.toMatch(/data-motion-state="visible"[^\n]*\.event\s*\{\s*animation:\s*none/);
    expect(styles).not.toMatch(/data-motion-state="visible"[^\n]*\.lock\s*\{\s*animation:\s*none/);
  });

  it("forces timeline facts back to a visible final state when motion is reduced", () => {
    const styles = source("app/landing/signal-timeline-scene.module.css");

    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.trajectory::before, \.trajectory i, \.event, \.lock \{[\s\S]*?opacity:\s*1 !important;[\s\S]*?transform:\s*none !important;[\s\S]*?transition:\s*none !important;/);
  });
});
