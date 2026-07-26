"use client";

import { useEffect } from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_DOM_EVENT,
  LANDING_ANALYTICS_EVENT,
  isLandingAnalyticsContext,
  isLandingAnalyticsEventName,
  type LandingAnalyticsContext,
  type LandingAnalyticsEventName,
} from "../lib/landing-analytics-contract";

export type LandingAnalyticsDetail = {
  name: LandingAnalyticsEventName;
  context?: LandingAnalyticsContext;
};

export function sendLandingEvent(detail: LandingAnalyticsDetail) {
  const timestamp = Date.now();
  void fetch("/api/landing-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...detail, timestamp }),
    keepalive: true,
  }).catch(() => undefined);
}

export default function LandingAnalytics() {
  useEffect(() => {
    sendLandingEvent({ name: LANDING_ANALYTICS_EVENT.landingViewed });
    const pricing = document.getElementById("pricing");
    let pricingViewed = false;
    const pricingObserver =
      pricing && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            const isMeaningfullyVisible = entries.some(
              (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35,
            );
            if (!isMeaningfullyVisible || pricingViewed) return;
            pricingViewed = true;
            sendLandingEvent({
              name: LANDING_ANALYTICS_EVENT.pricingViewed,
              context: LANDING_ANALYTICS_CONTEXT.pricing,
            });
            pricingObserver?.disconnect();
          }, { threshold: [0.35] })
        : null;
    if (pricing && pricingObserver) pricingObserver.observe(pricing);

    const handleCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<LandingAnalyticsDetail>).detail;
      if (!detail || !isLandingAnalyticsEventName(detail.name)) return;
      if (detail.context !== undefined && !isLandingAnalyticsContext(detail.context)) return;
      sendLandingEvent(detail);
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const analyticsTarget = target.closest<HTMLElement>("[data-analytics-event]");
      const name = analyticsTarget?.dataset.analyticsEvent;
      if (!analyticsTarget || !name) return;
      if (analyticsTarget instanceof HTMLDetailsElement) return;
      if (!isLandingAnalyticsEventName(name)) return;
      const context = analyticsTarget.dataset.analyticsContext;
      if (context !== undefined && !isLandingAnalyticsContext(context)) return;
      sendLandingEvent({
        name,
        ...(context ? { context } : {}),
      });
    };
    const handleToggle = (event: Event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;
      if (details.dataset.analyticsEvent !== LANDING_ANALYTICS_EVENT.faqOpened) return;
      sendLandingEvent({
        name: LANDING_ANALYTICS_EVENT.faqOpened,
        context: LANDING_ANALYTICS_CONTEXT.faq,
      });
    };

    window.addEventListener(LANDING_ANALYTICS_DOM_EVENT, handleCustomEvent);
    document.addEventListener("click", handleClick);
    document.addEventListener("toggle", handleToggle, true);
    return () => {
      window.removeEventListener(LANDING_ANALYTICS_DOM_EVENT, handleCustomEvent);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("toggle", handleToggle, true);
      pricingObserver?.disconnect();
    };
  }, []);

  return null;
}
