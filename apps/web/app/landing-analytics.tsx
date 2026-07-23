"use client";

import { useEffect } from "react";

export type LandingAnalyticsDetail = {
  name: string;
  context?: string;
};

const ANALYTICS_EVENT = "landing:analytics";

export function sendLandingEvent(detail: LandingAnalyticsDetail) {
  const timestamp = Date.now();
  try {
    const counterId = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID);
    if (Number.isInteger(counterId) && counterId > 0 && typeof window.ym === "function") {
      window.ym(
        counterId,
        "reachGoal",
        detail.name,
        detail.context ? { context: detail.context } : undefined,
      );
    }
  } catch {
    // Analytics must never interrupt navigation or checkout.
  }

  void fetch("/api/landing-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...detail, timestamp }),
    keepalive: true,
  }).catch(() => undefined);
}

export default function LandingAnalytics() {
  useEffect(() => {
    sendLandingEvent({ name: "landing_viewed" });

    const handleCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<LandingAnalyticsDetail>).detail;
      if (!detail || typeof detail.name !== "string") return;
      sendLandingEvent(detail);
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const analyticsTarget = target.closest<HTMLElement>("[data-analytics-event]");
      const name = analyticsTarget?.dataset.analyticsEvent;
      if (!analyticsTarget || !name) return;
      sendLandingEvent({
        name,
        ...(analyticsTarget.dataset.analyticsContext
          ? { context: analyticsTarget.dataset.analyticsContext }
          : {}),
      });
    };
    const handleToggle = (event: Event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;
      if (details.dataset.analyticsEvent !== "faq_opened") return;
      sendLandingEvent({ name: "faq_opened", context: "faq" });
    };

    window.addEventListener(ANALYTICS_EVENT, handleCustomEvent);
    document.addEventListener("click", handleClick);
    document.addEventListener("toggle", handleToggle, true);
    return () => {
      window.removeEventListener(ANALYTICS_EVENT, handleCustomEvent);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("toggle", handleToggle, true);
    };
  }, []);

  return null;
}
