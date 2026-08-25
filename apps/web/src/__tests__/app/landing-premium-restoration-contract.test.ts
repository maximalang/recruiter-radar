import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

/* Premium restoration contracts (PR #227 checkpoint A):
 * the pre-218 identity stays, but the radar becomes an abstract signal
 * field instead of a literal HUD radar, decorative markers leave the
 * keyboard order, and every dated fact derives from the canonical demo
 * story rather than duplicated hardcode. */

describe("landing premium restoration contract", () => {
  it("renders the hero signal field as a decorative abstract composition without fake radar labels", () => {
    const field = source("app/landing/hero-signal-field.tsx");
    const fieldCss = source("app/landing/hero-signal-field.module.css");

    // Decorative object: fully hidden from accessibility tree, no keyboard stops.
    expect(field).toContain('aria-hidden="true"');
    expect(field).not.toContain("tabIndex");
    expect(field).not.toContain("role=");
    expect(field).not.toContain("aria-label");

    // No sci-fi coordinate labels (N-04 / E-12 / Q-08 / W-03 / SRC/7).
    expect(field).not.toMatch(/[NEQWS][RC]?-\d{2}/);
    expect(field).not.toContain("SRC/7");

    // Abstract field, not four concentric rings: at most three structural curves,
    // one dominant focus cluster, sparse points, evidence links.
    expect(field.match(/<circle/g)?.length ?? 0).toBeLessThanOrEqual(18);
    expect(fieldCss).toContain(".structArcA");
    expect(fieldCss).toContain(".structArcB");
    expect(fieldCss).toContain(".orbitLine");
    expect(fieldCss).toContain(".focusHalo");
    expect(fieldCss).not.toContain("stroke-dasharray: 178 42 56 31");
    expect(field).not.toContain("tickLayer");

    // At most two text annotations: one dominant + one whisper.
    const annotations = [
      field.indexOf("styles.annotation"),
      field.indexOf("styles.whisper"),
    ].filter((index) => index >= 0);
    expect(annotations.length).toBeLessThanOrEqual(2);

    // Line hierarchy: structural arcs are quieter than evidence links,
    // links quieter than the dominant signal.
    const arcOpacity = Number(fieldCss.match(/\.structArcA\s*\{[^}]*signal-on-dark\)\s*(\d+)%/)?.[1] ?? 0);
    const linkOpacity = Number(fieldCss.match(/\.linkSolid\s*\{[^}]*signal-on-dark\)\s*(\d+)%/)?.[1] ?? 0);
    expect(arcOpacity).toBeLessThan(linkOpacity);
    expect(fieldCss).toMatch(/\.focusCore[^{]*\{[^}]*62%/);
  });

  it("derives hero radar annotations and timeline events from the canonical demo story only", () => {
    const field = source("app/landing/hero-signal-field.tsx");
    const timeline = source("app/landing/signal-timeline.tsx");
    const demo = source("lib/landing-demo.ts");

    expect(field).toContain('import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo"');
    expect(field).toContain("STORY.company.name");
    expect(field).toContain("STORY.company.signal");
    expect(timeline).toContain('import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo"');

    // The retired fake numbers stay retired everywhere on the landing.
    expect(demo).toContain("vacanciesCount: 14");
    for (const scene of [field, timeline]) {
      expect(scene).not.toContain('"Промышленная группа"');
      expect(scene).not.toContain("8 позиций");
      expect(scene).not.toContain("4 авг");
      expect(scene).not.toContain("9 авг");
    }
  });

  it("keeps informational timeline rows out of the keyboard order while preserving list semantics", () => {
    const timeline = source("app/landing/signal-timeline.tsx");
    const timelineCss = source("app/landing/signal-timeline.module.css");

    expect(timeline).not.toContain("tabIndex");
    expect(timeline).toContain("<ol className={styles.events}>");
    expect(timeline).toContain("<time>{event.date}</time>");
    expect(timeline).toContain('data-timeline-event');
    expect(timeline).toContain("ПОВОД СОБРАН");
    // No fake button affordances on rows.
    expect(timelineCss).not.toMatch(/\.event\s*\{[^}]*cursor:\s*pointer/);
    expect(timelineCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the hero description self-sufficient for screen readers", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const heroCss = source("app/landing/detection-scene.module.css");

    // The priority-list description names the product value directly and makes
    // no delivery-cadence promise; no extra screen-reader account is needed.
    expect(hero).toContain(
      "Приоритетный список компаний с активным наймом: почему компания актуальна, какие факты это подтверждают и с чего начать контакт.",
    );
    expect(heroCss).toContain(".visuallyHidden");
  });

  it("keeps pointer drift subtle and reduced motion fully static", () => {
    const field = source("app/landing/hero-signal-field.tsx");
    const fieldCss = source("app/landing/hero-signal-field.module.css");

    // Max perceived movement stays within ~2-5px across all layers.
    const shifts = [...fieldCss.matchAll(/var\(--field-x\)\s*\*\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(shifts.length).toBeGreaterThan(0);
    for (const shift of shifts) expect(shift).toBeLessThanOrEqual(4);

    expect(fieldCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(field).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(field).toContain('window.matchMedia("(pointer: coarse)")');
    // No infinite loops anywhere in the field.
    expect(fieldCss).not.toContain("animation:");
  });

  it("keeps mobile hero geometry inside the viewport without shrinking desktop into mobile", () => {
    const fieldCss = source("app/landing/hero-signal-field.module.css");
    const heroCss = source("app/landing/detection-scene.module.css");

    // Mobile drops the secondary structure instead of scaling everything down.
    expect(fieldCss).toMatch(/@media \(max-width: 760px\)/);
    expect(fieldCss).toMatch(/@media \(max-width: 480px\)[^@]*opacity:\s*\.78/);
    // Mobile radar identity stays legible: the lone structural arc and focal
    // rings run modestly stronger than desktop (no glow, no extra geometry).
    const desktopArcOpacity = Number(fieldCss.match(/\.structArcA\s*\{[^}]*signal-on-dark\)\s*(\d+)%/)?.[1] ?? 0);
    const mobileArcOpacity = Number(fieldCss.match(/@media \(max-width: 760px\) \{[\s\S]*?\.structArcA\s*\{[^}]*signal-on-dark\)\s*(\d+)%/)?.[1] ?? 0);
    expect(mobileArcOpacity).toBeGreaterThan(desktopArcOpacity);
    // Production audit keeps guarding against horizontal overflow on phones.
    const audit = source("scripts/verify-landing-production.mjs");
    expect(audit).toContain("[data-mobile-hero-signal]");
    expect(heroCss).toContain(".visuallyHidden");
  });
});
