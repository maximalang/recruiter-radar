/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import { LandingMotionProvider } from "@/app/landing-motion/landing-motion-provider";
import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    window.sessionStorage.clear();
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "-80px 0px -55% 0px";
      thresholds = [0, 0.15, 0.4, 0.75];
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: TestIntersectionObserver,
    });
  });

  function renderHeader(children?: React.ReactNode) {
    return render(
      <LandingMotionProvider>
        <LandingHeader activationHref="/checkout?plan=pilot" />
        {children}
      </LandingMotionProvider>,
    );
  }

  it("offers a clear activation path without hiding account access", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Попробовать неделю" })).toHaveAttribute(
      "href",
      "/checkout?plan=pilot",
    );
    expect(screen.getByRole("link", { name: "Войти" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Проверка" })).toHaveAttribute(
      "href",
      "#quality",
    );
  });

  it("closes the mobile menu with Escape and restores focus to the trigger", () => {
    renderHeader();

    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile menu on an outside pointer interaction", () => {
    renderHeader(<button type="button">Вне меню</button>);

    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Вне меню" }));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the observed section active and updates immediately on click", () => {
    renderHeader(
      <>
        <section id="preview" />
        <section id="how-it-works" />
        <section id="quality" />
        <section id="pricing" />
        <section id="faq" />
      </>,
    );

    act(() => intersectionCallback([
      {
        target: document.getElementById("quality"),
        isIntersecting: true,
        intersectionRatio: 0.8,
        boundingClientRect: { top: 120 },
      } as unknown as IntersectionObserverEntry,
    ], {} as IntersectionObserver));

    expect(screen.getAllByRole("link", { name: "Проверка" })[0]).toHaveAttribute(
      "aria-current",
      "location",
    );

    fireEvent.click(screen.getAllByRole("link", { name: "Тарифы" })[0]);
    expect(screen.getAllByRole("link", { name: "Тарифы" })[0]).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("prefers the section nearest the sticky header over a smaller section with a higher ratio", () => {
    renderHeader(
      <>
        <section id="preview" />
        <section id="how-it-works" />
        <section id="quality" />
        <section id="pricing" />
        <section id="faq" />
      </>,
    );

    act(() => intersectionCallback([
      {
        target: document.getElementById("how-it-works"),
        isIntersecting: true,
        intersectionRatio: 0.75,
        boundingClientRect: { top: -420 },
      },
      {
        target: document.getElementById("quality"),
        isIntersecting: true,
        intersectionRatio: 0.35,
        boundingClientRect: { top: 96 },
      },
    ] as IntersectionObserverEntry[], {} as IntersectionObserver));

    expect(screen.getAllByRole("link", { name: "Проверка" })[0]).toHaveAttribute(
      "aria-current",
      "location",
    );
  });
});
