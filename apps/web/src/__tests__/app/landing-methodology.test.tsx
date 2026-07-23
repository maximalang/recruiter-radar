/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import { LandingMotionProvider } from "@/app/landing-motion/landing-motion-provider";
import LandingMethodology from "@/app/landing-methodology";

describe("LandingMethodology", () => {
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    jest.useFakeTimers();
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "0px";
      thresholds = [0.4];
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: TestIntersectionObserver,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderMethodology() {
    return render(
      <LandingMotionProvider>
        <LandingMethodology />
      </LandingMotionProvider>,
    );
  }

  function setIntersection(ratio: number) {
    act(() => intersectionCallback([
      {
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
      } as IntersectionObserverEntry,
    ], {} as IntersectionObserver));
  }

  it("rotates only while at least 40% visible and stops after interaction", () => {
    renderMethodology();

    const first = screen.getByRole("button", { name: /Соответствие/ });
    expect(first).toHaveAttribute("aria-pressed", "true");
    act(() => jest.advanceTimersByTime(2600));
    expect(first).toHaveAttribute("aria-pressed", "true");

    setIntersection(0.39);
    act(() => jest.advanceTimersByTime(1300));
    expect(first).toHaveAttribute("aria-pressed", "true");

    setIntersection(0.4);
    act(() => jest.advanceTimersByTime(1300));
    const second = screen.getByRole("button", { name: /Намерение/ });
    expect(second).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseEnter(screen.getByTestId("landing-methodology"));
    act(() => jest.advanceTimersByTime(2600));
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("announces only a short status after manual selection", () => {
    renderMethodology();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    setIntersection(0.8);
    act(() => jest.advanceTimersByTime(1300));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: /Доступность/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Этап 4 из 4: Доступность");
    expect(screen.getByRole("button", { name: /Доступность/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pauses when the document becomes hidden", () => {
    renderMethodology();
    setIntersection(0.8);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    act(() => jest.advanceTimersByTime(2600));

    expect(screen.getByRole("button", { name: /Соответствие/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
