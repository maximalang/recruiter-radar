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
    expect(screen.getByRole("tab", { name: /Настройте рынок/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Так вы задаёте рынок и признаки спроса")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Промет|Демо|12 мая|10 компаний/i);
  });

  it("lets the visitor inspect every workflow stage", () => {
    render(<HeroProductPreview />);

    fireEvent.click(screen.getByRole("tab", { name: /Получите повод/i }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Каждая компания приходит с причиной написать сейчас");

    fireEvent.click(screen.getByRole("tab", { name: /Подготовьте сообщение/i }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Радар находит повод. Пишете вы.");
  });

  it("advances to the next idea after a comfortable reading interval", () => {
    jest.useFakeTimers();
    const { container } = render(<HeroProductPreview />);
    const workflow = container.querySelector<HTMLElement>("[data-hero-workflow]");
    expect(workflow).not.toBeNull();

    fireEvent.pointerEnter(workflow!);
    act(() => jest.advanceTimersByTime(7_999));
    expect(screen.getByRole("tab", { name: /Настройте рынок/i })).toHaveAttribute("aria-selected", "true");
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("tab", { name: /Радар проверяет/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /Получите повод/i }));
    act(() => jest.advanceTimersByTime(8_000));
    expect(screen.getByRole("tab", { name: /Подготовьте сообщение/i })).toHaveAttribute("aria-selected", "true");
  });

  it("defines an Accio-style clipped state that expands left on hover and keyboard focus", () => {
    const css = source("app/landing/detection-scene.module.css");

    expect(css).toMatch(/\.section\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.productShot\s*\{[\s\S]*?transform:\s*translateX\(/);
    expect(css).toMatch(/\.fieldFigure:hover\s+\.productShot/);
    expect(css).toMatch(/\.fieldFigure:focus-within\s+\.productShot/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none/);
  });

  it("scopes the production audit exceptions to the hero teaser only", () => {
    const audit = source("scripts/verify-landing-production.mjs");

    // The hero CTA now targets the interactive workflow card, and the audit
    // documents why the miniature product shot is exempt from the 44px and
    // viewport-bleed rules. No blanket exemptions for other page controls.
    expect(audit).toContain('assert.equal(new URL(page.url()).hash, "#hero-workflow")');
    expect(audit).toContain('element.closest("[data-hero-workflow]")');
    expect(audit).toContain('element.closest("#scene-detection [data-hero-visual]")');
    expect(audit).toMatch(/От сигнала до сообщения/);
    expect(audit).not.toContain("Компании, которым стоит написать сегодня");
    expect(audit).not.toContain('assert.equal(new URL(page.url()).hash, "#preview-configurator")');
  });
});
