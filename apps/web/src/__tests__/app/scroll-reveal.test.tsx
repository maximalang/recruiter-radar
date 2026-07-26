/** @jest-environment jsdom */

import { act, render, screen } from "@testing-library/react";

import { LandingMotionProvider } from "../../../app/landing-motion/landing-motion-provider";
import ScrollReveal from "../../../app/scroll-reveal";

describe("ScrollReveal", () => {
  let intersectionCallback: IntersectionObserverCallback;
  const animate = jest.fn();

  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 2_000,
      top: 2_000,
      right: 100,
      bottom: 2_100,
      left: 0,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    animate.mockClear();
    animate.mockReturnValue({
      cancel: jest.fn(),
      finished: Promise.resolve(),
    });
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "0px 0px -8%";
      thresholds = [0.12];
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: TestIntersectionObserver,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  function renderReveal(label: string) {
    return render(
      <LandingMotionProvider>
        <ScrollReveal><p>{label}</p></ScrollReveal>
      </LandingMotionProvider>,
    );
  }

  it("keeps content visible when the intersection callback has not fired", () => {
    renderReveal("Важный контент");

    expect(screen.getByText("Важный контент").parentElement).toHaveStyle({
      opacity: "1",
      transform: "none",
    });
  });

  it("progressively animates once and leaves content visible", async () => {
    renderReveal("Контент");
    const wrapper = screen.getByText("Контент").parentElement!;

    await act(async () => {
      intersectionCallback([
        { target: wrapper, isIntersecting: true, intersectionRatio: 0.5 } as unknown as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
      await Promise.resolve();
    });
    act(() => intersectionCallback([
      { target: wrapper, isIntersecting: true, intersectionRatio: 0.8 } as unknown as IntersectionObserverEntry,
    ], {} as IntersectionObserver));

    expect(animate).toHaveBeenCalledTimes(1);
    expect(wrapper).toHaveStyle({ opacity: "1", transform: "none" });
  });
});
