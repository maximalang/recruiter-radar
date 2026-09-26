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
    expect(screen.getByText("Один профиль вместо десятков сохранённых поисков")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Промет|Демо|12 мая/i);
  });

  it("lets the visitor inspect every workflow stage", () => {
    render(<HeroProductPreview />);

    fireEvent.click(screen.getByRole("tab", { name: /10 компаний/i }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("10 компаний за 7 дней — каждая с причиной написать");

    fireEvent.click(screen.getByRole("tab", { name: /Готовый черновик/i }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Черновик готов — отправляете только вы");
  });

  it("advances to the next idea after a comfortable reading interval", () => {
    jest.useFakeTimers();
    const { container } = render(<HeroProductPreview />);
    const workflow = container.querySelector<HTMLElement>("[data-hero-workflow]");
    expect(workflow).not.toBeNull();

    fireEvent.pointerEnter(workflow!);
    act(() => jest.advanceTimersByTime(7_999));
    expect(screen.getByRole("tab", { name: /Ваш рынок/i })).toHaveAttribute("aria-selected", "true");
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("tab", { name: /42 источника/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /10 компаний/i }));
    act(() => jest.advanceTimersByTime(8_000));
    expect(screen.getByRole("tab", { name: /Готовый черновик/i })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the hero product shot fitted inside its column without a clipped edge", () => {
    const css = source("app/landing/detection-scene.module.css");

    expect(css).toMatch(/\.section\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.fieldFigure\s*\{[^}]*width:\s*100%/);
    // Owner verdict 23.09: no Accio-style bleed/expansion — the mock is fully
    // visible at every width, and the hero copy never dims on interaction.
    expect(css).not.toMatch(/translateX/);
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
