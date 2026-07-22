/** @jest-environment jsdom */

import { act, render } from "@testing-library/react";

import ScrollReveal from "@/app/scroll-reveal";

describe("safe landing reveal", () => {
  it("never hides server content and disconnects after the first reveal", () => {
    let callback: IntersectionObserverCallback = () => undefined;
    const disconnect = jest.fn();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: jest.fn((nextCallback: IntersectionObserverCallback) => {
        callback = nextCallback;
        return { observe: jest.fn(), disconnect, unobserve: jest.fn() };
      }),
    });

    const { container } = render(<ScrollReveal as="section">Полностью видимый контент</ScrollReveal>);
    const section = container.querySelector("section");

    expect(section).toBeVisible();
    expect(section).not.toHaveStyle({ opacity: "0" });
    act(() => callback([{ isIntersecting: true, target: section } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(section).toHaveAttribute("data-revealed", "true");
    expect(disconnect).toHaveBeenCalled();
  });

  it("does not create reveal observers when reduced motion is requested", () => {
    const observer = jest.fn();
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: observer });

    const { container } = render(<ScrollReveal>Статичный контент</ScrollReveal>);

    expect(container.firstElementChild).toHaveAttribute("data-revealed", "true");
    expect(observer).not.toHaveBeenCalled();
  });
});
