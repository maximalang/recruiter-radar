/** @jest-environment jsdom */

import { fireEvent, render } from "@testing-library/react";

import LandingAnalytics, {
  LANDING_ANALYTICS_EVENT,
  LandingStageEvent,
  type LandingAnalyticsDetail,
} from "@/app/landing-analytics";

describe("landing analytics event layer", () => {
  it("keeps the preview-first funnel provider-neutral and free of profile data", () => {
    const received: LandingAnalyticsDetail[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent<LandingAnalyticsDetail>).detail);
    window.addEventListener(LANDING_ANALYTICS_EVENT, listener);

    const { getByRole } = render(
      <>
        <LandingAnalytics />
        <a href="#preview" data-landing-events="preview_started" data-landing-event-context="hero">Собрать мой радар</a>
        <a href="/checkout?plan=pilot" data-landing-events="preview_checkout_clicked" data-landing-event-context="preview">Запустить пилот</a>
      </>,
    );

    fireEvent.click(getByRole("link", { name: "Собрать мой радар" }));
    fireEvent.click(getByRole("link", { name: "Запустить пилот" }));

    expect(received).toEqual([
      { name: "landing_viewed", context: "landing" },
      { name: "preview_started", context: "hero" },
      { name: "preview_checkout_clicked", context: "preview" },
    ]);
    expect(JSON.stringify(received)).not.toMatch(/email|phone|specialization|targetCity/i);
    window.removeEventListener(LANDING_ANALYTICS_EVENT, listener);
  });

  it("uses Yandex Metrika only when it is present and never lets delivery break UI", () => {
    const ym = jest.fn();
    Object.assign(window, { ym });
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "123";
    const { emitLandingAnalyticsEvent } = jest.requireActual("@/app/landing-analytics") as typeof import("@/app/landing-analytics");

    emitLandingAnalyticsEvent({ name: "payment_started", context: "checkout" });

    expect(ym).toHaveBeenCalledWith(123, "reachGoal", "payment_started", { context: "checkout" });
    delete (window as Partial<Window>).ym;
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
  });

  it("falls back to the configured beacon endpoint when another provider fails", () => {
    const sendBeacon = jest.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
    Object.assign(window, { ym: jest.fn(() => { throw new Error("provider unavailable"); }) });
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "123";
    process.env.NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT = "/api/landing-events";
    const { emitLandingAnalyticsEvent } = jest.requireActual("@/app/landing-analytics") as typeof import("@/app/landing-analytics");

    expect(() => emitLandingAnalyticsEvent({ name: "checkout_viewed", context: "checkout" })).not.toThrow();
    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/landing-events",
      expect.objectContaining({ type: "application/json" }),
    );

    delete (window as Partial<Window>).ym;
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    delete process.env.NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT;
    delete (navigator as Partial<Navigator>).sendBeacon;
  });

  it("emits generated preview only after the result stage is mounted", () => {
    const received: LandingAnalyticsDetail[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent<LandingAnalyticsDetail>).detail);
    window.addEventListener(LANDING_ANALYTICS_EVENT, listener);

    render(<LandingStageEvent name="preview_generated" context="preview" />);

    expect(received).toEqual([{ name: "preview_generated", context: "preview" }]);
    window.removeEventListener(LANDING_ANALYTICS_EVENT, listener);
  });
});
