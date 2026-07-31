/** @jest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render } from "@testing-library/react";

import ScrollProgress from "@/app/scroll-progress";

describe("ScrollProgress", () => {
  beforeEach(() => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(document.documentElement, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    window.cancelAnimationFrame = jest.fn();
    window.scrollTo = jest.fn();
  });

  it("updates the compact progress ring and reveals the back-to-top control", () => {
    const { container } = render(<ScrollProgress />);
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Вернуться наверх"]',
    );
    const ring = container.querySelectorAll<SVGCircleElement>("circle")[1];

    expect(button).not.toBeNull();
    expect(button).toHaveAttribute("aria-hidden", "true");
    expect(ring.style.strokeDashoffset).toBe("100");

    document.documentElement.scrollTop = 750;
    fireEvent.scroll(window);

    expect(ring.style.strokeDashoffset).toBe("25");
    expect(button).toHaveAttribute("aria-hidden", "false");
    expect(button).toHaveAttribute("data-visible", "true");
  });

  it("does not use React state in the scroll path", () => {
    const source = readFileSync(join(process.cwd(), "app", "scroll-progress.tsx"), "utf8");

    expect(source).not.toContain("useState");
    expect(source).not.toContain("setState");
    expect(source).toContain("requestAnimationFrame");
  });

  it("uses instant scrolling when reduced motion is active", () => {
    jest.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
    const { container } = render(<ScrollProgress />);

    fireEvent.click(
      container.querySelector<HTMLButtonElement>('button[aria-label="Вернуться наверх"]')!,
    );

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
