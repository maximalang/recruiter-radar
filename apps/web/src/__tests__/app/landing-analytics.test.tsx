/** @jest-environment jsdom */

import { fireEvent, render } from "@testing-library/react";

import LandingAnalytics, { sendLandingEvent } from "@/app/landing-analytics";
import LandingCheckoutAnalytics from "@/app/landing-checkout-analytics";

describe("landing funnel analytics", () => {
  const fetchMock = jest.fn().mockResolvedValue({ status: 204 });
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
    sessionStorage.clear();
    delete window.ym;
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
      thresholds = [0.35];
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: TestIntersectionObserver,
    });
  });

  it("keeps conversion events in first-party telemetry", () => {
    const previousCounterId = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    window.ym = jest.fn();

    sendLandingEvent({
      name: "checkout_started",
      context: "pricing_pilot",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toContain(
      '"name":"checkout_started"',
    );
    expect(window.ym).not.toHaveBeenCalled();
    if (previousCounterId === undefined) {
      delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    } else {
      process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = previousCounterId;
    }
  });

  it("tracks checkout view and uses submit semantics for payment and continuation", () => {
    const { unmount } = render(
      <>
        <form data-checkout-form />
        <LandingCheckoutAnalytics submitEvent="payment_started" />
      </>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.submit(document.querySelector("[data-checkout-form]")!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"name":"payment_started"');
    unmount();

    fetchMock.mockClear();
    render(
      <>
        <form data-checkout-form />
        <LandingCheckoutAnalytics submitEvent="continuation_requested" />
      </>,
    );
    fireEvent.submit(document.querySelector("[data-checkout-form]")!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"name":"checkout_viewed"');
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"name":"continuation_requested"');
    expect(fetchMock.mock.calls[1][1]?.body).not.toContain('"name":"payment_started"');
  });

  it("tracks FAQ only on each closed-to-open transition without click duplication", () => {
    render(
      <>
        <details data-analytics-event="faq_opened">
          <summary>Как это работает?</summary>
          <p>Ответ</p>
        </details>
        <LandingAnalytics />
      </>,
    );
    const details = document.querySelector("details")!;
    const summary = document.querySelector("summary")!;
    fetchMock.mockClear();

    fireEvent.click(summary);
    expect(fetchMock).not.toHaveBeenCalled();

    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    details.open = false;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records pricing_viewed once when pricing becomes meaningfully visible", () => {
    render(
      <>
        <section id="pricing">Тарифы</section>
        <LandingAnalytics />
      </>,
    );
    fetchMock.mockClear();
    const pricing = document.getElementById("pricing")!;

    intersectionCallback([{
      target: pricing,
      isIntersecting: true,
      intersectionRatio: 0.6,
    } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    intersectionCallback([{
      target: pricing,
      isIntersecting: true,
      intersectionRatio: 0.8,
    } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"name":"pricing_viewed"');
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"context":"pricing"');
  });
});
