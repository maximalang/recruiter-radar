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
});
