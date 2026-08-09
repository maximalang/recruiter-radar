/** @jest-environment jsdom */

import { fireEvent, render } from "@testing-library/react";

import LandingAnalytics, { sendLandingEvent } from "@/app/landing-analytics";
import { storeAnalyticsConsent } from "@/lib/analytics-consent";

describe("landing funnel analytics", () => {
  const fetchMock = jest.fn().mockResolvedValue({ status: 204 });

  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as typeof fetch;
    sessionStorage.clear();
    localStorage.clear();
    storeAnalyticsConsent(true);
    delete window.ym;
  });

  it("stops first-party analytics before consent and after withdrawal", () => {
    localStorage.clear();
    storeAnalyticsConsent(false);
    sendLandingEvent({ name: "checkout_started", context: "pricing_pilot" });
    expect(fetchMock).not.toHaveBeenCalled();

    storeAnalyticsConsent(true);
    sendLandingEvent({ name: "checkout_started", context: "pricing_pilot" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    storeAnalyticsConsent(false);
    sendLandingEvent({ name: "checkout_started", context: "pricing_pilot" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
});
