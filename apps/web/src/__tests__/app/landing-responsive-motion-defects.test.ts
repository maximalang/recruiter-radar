import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

// Owner visual verdict (2026-09-14, preview :3459): the workspace scene stayed
// invisible ("huge empty vertical gap") and the skip link rendered visible
// without focus. Both defects live in the landing reveal-motion contract:
// a section taller than ~12% of the viewport never reaches the observer
// threshold and stays data-motion-state="pending" (opacity:0) forever, and
// the landing.module.css skip link ships no off-screen transform guard, so
// any ancestor transform breaks its top:-5rem hiding.

const source = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("landing responsive motion defects", () => {
  it("reveals tall landing sections regardless of viewport-driven intersection ratio", () => {
    const motion = source("app/landing/landing-motion.tsx");
    // A single numeric threshold of 0.12 means a section taller than ~12% of
    // the viewport never fires the observer callback (on small viewports the
    // intersection ratio of a full-height section stays below 0.12), so the
    // section stays data-motion-state="pending" (opacity:0) — an empty gap.
    expect(motion).toContain("threshold: 0");
    expect(motion).not.toContain("threshold: 0.12");
  });

  it("hides the landing skip link with a transform guard that survives transformed ancestors", () => {
    const landingCss = source("app/landing/landing.module.css");
    expect(landingCss).toMatch(
      /\.skipLink\s*\{[\s\S]*?transform:\s*translateY\(calc\(-100% - 1rem\)\);/,
    );
    expect(landingCss).toMatch(/\.skipLink:focus\s*\{[\s\S]*?transform:\s*translateY\(0\);/);
    expect(landingCss).not.toMatch(/\.skipLink\s*\{[^}]*top:\s*-5rem/);
  });

  it("keeps deterministic static CSS for reduced motion without adding scripting media queries", () => {
    const css = source("app/landing/landing-motion.module.css");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).not.toMatch(/@media\s*\(\s*scripting/);
  });
});
