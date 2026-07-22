/** @jest-environment jsdom */

import { act, fireEvent, render } from "@testing-library/react";

import LandingAnalytics, {
  LANDING_ANALYTICS_EVENT,
  type LandingAnalyticsDetail,
} from "@/app/landing-analytics";

describe("landing analytics event layer", () => {
  it("emits provider-neutral events for a conversion click without personal data", () => {
    const received: LandingAnalyticsDetail[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<LandingAnalyticsDetail>).detail);
    };
    window.addEventListener(LANDING_ANALYTICS_EVENT, listener);

    const { getByRole } = render(
      <>
        <LandingAnalytics />
        <a
          href="/checkout"
          data-landing-events="hero_cta_clicked checkout_started"
          data-landing-event-context="hero"
        >
          Собрать мой радар
        </a>
      </>,
    );

    fireEvent.click(getByRole("link", { name: "Собрать мой радар" }));

    expect(received).toEqual([
      { name: "hero_cta_clicked", context: "hero" },
      { name: "checkout_started", context: "hero" },
    ]);
    expect(JSON.stringify(received)).not.toMatch(/email|phone|specialization|targetCity/i);

    window.removeEventListener(LANDING_ANALYTICS_EVENT, listener);
  });

  it("emits profile setup and FAQ events from semantic controls", () => {
    const received: LandingAnalyticsDetail[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<LandingAnalyticsDetail>).detail);
    };
    window.addEventListener(LANDING_ANALYTICS_EVENT, listener);

    const { getByRole, getByText } = render(
      <>
        <LandingAnalytics />
        <form data-landing-events="profile_setup_started" data-landing-event-context="preview">
          <button type="submit">Показать радар</button>
        </form>
        <details data-landing-faq="sources">
          <summary>Откуда берутся компании?</summary>
          <p>Из проверенных источников.</p>
        </details>
      </>,
    );

    fireEvent.submit(getByRole("button", { name: "Показать радар" }).closest("form")!);
    const details = getByText("Откуда берутся компании?").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(received).toEqual([
      { name: "profile_setup_started", context: "preview" },
      { name: "faq_opened", context: "sources" },
    ]);

    window.removeEventListener(LANDING_ANALYTICS_EVENT, listener);
  });

  it("emits the pricing view once when the pricing decision enters the viewport", () => {
    const received: LandingAnalyticsDetail[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<LandingAnalyticsDetail>).detail);
    };
    window.addEventListener(LANDING_ANALYTICS_EVENT, listener);

    let intersectionCallback: IntersectionObserverCallback | undefined;
    const disconnect = jest.fn();
    const observe = jest.fn();
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      disconnect = disconnect;
      observe = observe;
      takeRecords = () => [];
      unobserve = jest.fn();
      root = null;
      rootMargin = "0px";
      thresholds = [0.35];
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: MockIntersectionObserver,
    });

    render(
      <>
        <LandingAnalytics />
        <section data-landing-pricing>Тарифы</section>
      </>,
    );

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(observe).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{ name: "pricing_viewed", context: "pricing" }]);
    expect(disconnect).toHaveBeenCalledTimes(1);

    window.removeEventListener(LANDING_ANALYTICS_EVENT, listener);
    delete (window as Partial<Window>).IntersectionObserver;
  });
});
