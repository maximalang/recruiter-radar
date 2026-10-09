/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import HeroProductPreview from "@/app/landing/hero-product-preview";

const WEB_ROOT = basename(process.cwd()) === "web"
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing hero advertising workflow", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders product benefits instead of real or demo company data", () => {
    const { container } = render(<HeroProductPreview />);

    expect(container.querySelector('[data-hero-product-preview="workflow"]')).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Ваш рынок/i })).toHaveAttribute("aria-selected", "true");
    // v3.1 R10 (variant A): the stage-1 title is the concise market name.
    expect(screen.getAllByText("Инженерный подбор").length).toBeGreaterThanOrEqual(2);
    expect(container).not.toHaveTextContent(/Промет|Демо|12 мая/i);
  });

  it("lets the visitor inspect every workflow stage", () => {
    jest.useFakeTimers();
    render(<HeroProductPreview />);

    // v3.1 §5.3: the outgoing scene exits for 180ms, then the swap is atomic.
    fireEvent.click(screen.getByRole("tab", { name: /10 компаний/i }));
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("10 компаний за 7 дней");

    fireEvent.click(screen.getByRole("tab", { name: /Готовый черновик/i }));
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Черновик готов. Отправляете вы.");
  });

  it("advances automatically until the first manual choice, then stays put", () => {
    jest.useFakeTimers();
    render(<HeroProductPreview />);

    act(() => jest.advanceTimersByTime(7_999));
    expect(screen.getByRole("tab", { name: /Ваш рынок/i })).toHaveAttribute("aria-selected", "true");
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("tab", { name: /27 источников/i })).toHaveAttribute("aria-selected", "true");

    // v3.1 §5.3: a manual tab click stops the cadence until reload; it never
    // resumes spontaneously after the first interaction.
    fireEvent.click(screen.getByRole("tab", { name: /10 компаний/i }));
    act(() => jest.advanceTimersByTime(200));
    expect(screen.getByRole("tab", { name: /10 компаний/i })).toHaveAttribute("aria-selected", "true");
    act(() => jest.advanceTimersByTime(24_000));
    expect(screen.getByRole("tab", { name: /10 компаний/i })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the hero demo as the v3.1 peek window inside its clip area", () => {
    const css = source("app/landing/detection-scene.module.css");

    // v3.1 R11: the hero section clips horizontally only; the dock slide is
    // the single transform author for the peek↔full travel (exactly 50% of
    // the frame plus the gutter waits behind the right clip edge).
    expect(css).toMatch(/\.section\s*\{[\s\S]*?overflow-x:\s*clip/);
    expect(css).toMatch(/\.fieldFigure\s*\{[^}]*width:\s*100%/);
    expect(css).toContain("--v31-peek-x: calc(50% + var(--v31-demo-gutter));");
    expect(css).toMatch(/\.peekDock\[data-peek-state="peek"\] \.peekSlide,\s*\r?\n\.peekDock\[data-peek-state="closing"\] \.peekSlide \{ transform: translateX\(var\(--v31-peek-x\)\); \}/);
    // Owner verdict 23.09 remnants that v3.1 keeps banned: no hover/focus
    // expansion of the product shot itself, no :has() layout coupling, and
    // no near-zero opacity literals.
    expect(css).not.toMatch(/\.fieldFigure:hover\s+\.productShot/);
    expect(css).not.toMatch(/\.fieldFigure:focus-within\s+\.productShot/);
    expect(css).not.toMatch(/\.section:has\(/);
    expect(css).not.toMatch(/opacity:\s*\.\d+\s*;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none/);
  });

  it("scopes the production audit exceptions to the hero teaser only", () => {
    const audit = source("scripts/verify-landing-production.mjs");
    const responsive = readFileSync(resolve(WEB_ROOT, "../../scripts/verify-responsive-surfaces.mjs"), "utf8");

    // The hero CTA now targets the interactive workflow card, and the audit
    // documents why the miniature product shot is exempt from the 44px and
    // viewport-bleed rules. No blanket exemptions for other page controls.
    expect(audit).toContain('assert.equal(new URL(page.url()).hash, "#hero-workflow")');
    expect(audit).toContain('element.closest("[data-hero-workflow]")');
    expect(audit).toContain('element.closest("#scene-detection [data-hero-visual]")');
    expect(audit).toMatch(/От сигнала до сообщения/);
    expect(audit).not.toContain("Компании, которым стоит написать сегодня");
    expect(audit).not.toContain('assert.equal(new URL(page.url()).hash, "#preview-configurator")');

    // The responsive-surface audit exemption is desktop-only (>900px): on mobile
    // the hero shot renders full-width and its controls stay subject to the 44px
    // touch contract.
    expect(responsive).toContain("const insideHeroTeaser = (element) => (");
    expect(responsive).toMatch(/window\.innerWidth > 900\s+&& Boolean\(element\.closest\('#scene-detection \[data-hero-visual\]'\)\)/);
    expect(responsive).toContain(".filter((element) => !insideHeroTeaser(element))");
    expect(responsive).toContain("!insideHorizontalScroller(element) && !insideHeroTeaser(element)");
  });

  it("expands the peek demo through the external handle (F-1 click path)", () => {
    jest.useFakeTimers();
    // jsdom lacks container-unit feature detection; the peek machine enhances
    // in exactly when the browser supports the R11 geometry contract.
    const cssNamespace = window as unknown as { CSS?: { supports?: unknown } };
    const originalCss = cssNamespace.CSS;
    cssNamespace.CSS = { ...originalCss, supports: () => true };
    try {
      const { container } = render(<HeroProductPreview />);
      const dock = container.querySelector("[data-demo-peek]");
      const handle = container.querySelector("[data-peek-handle]");
      if (!dock || !handle) throw new Error("peek dock and handle must render");

      // Hydration commits the settled peek; two frames later the instant
      // entry is over and the dock waits as the plain 50% peek.
      act(() => { jest.advanceTimersByTime(64); });
      expect(dock).toHaveAttribute("data-peek-state", "peek");
      expect(dock.hasAttribute("data-peek-instant")).toBe(false);
      expect(handle).toHaveAttribute("aria-expanded", "false");

      // The R11 click path: the handle pins the demo open (760ms ladder).
      fireEvent.click(handle);
      expect(dock).toHaveAttribute("data-peek-state", "opening");
      act(() => { jest.advanceTimersByTime(760); });
      expect(dock).toHaveAttribute("data-peek-state", "full");
      expect(handle).toHaveAttribute("aria-expanded", "true");
      expect(handle).toHaveAttribute("aria-label", "Свернуть демо");
    } finally {
      cssNamespace.CSS = originalCss;
    }
  });

  it("keeps the transparent desktop header click-through over the peek handle (F-1)", () => {
    const headerCss = source("app/landing/landing-header.module.css");
    const heroCss = source("app/landing/detection-scene.module.css");

    // jsdom cannot hit-test, so the desktop-only pointer-events pass-through
    // is pinned here: at ≥1200px the handle (y16–60) lives under the fixed
    // 72px header strip, and without the pass-through the unit gates would
    // stay green while the button is dead for real pointer input.
    expect(headerCss).toMatch(
      /@media \(min-width: 1200px\) \{\s*\.header:not\(\[data-scrolled\]\):not\(\[data-menu-open\]\) \{\s*pointer-events: none;\s*\}/,
    );
    expect(headerCss).toMatch(
      /\.header:not\(\[data-scrolled\]\):not\(\[data-menu-open\]\) \.brand,[\s\S]*?\.header:not\(\[data-scrolled\]\):not\(\[data-menu-open\]\) \.navLink,[\s\S]*?\.header:not\(\[data-scrolled\]\):not\(\[data-menu-open\]\) \.menuButton \{\s*pointer-events: auto;\s*\}/,
    );
    // The fix must not move the paint order or the R2/R11 layer contracts.
    expect(headerCss).toMatch(/\.header \{\s*position: fixed;\s*z-index: 90;/);
    expect(heroCss).toMatch(/\.peekHandle \{[^}]*top: -48px;[^}]*z-index: 5;/);
    expect(heroCss).toMatch(/\.productShot::after \{[^}]*z-index: 5;[^}]*pointer-events: none;/);
  });
});
