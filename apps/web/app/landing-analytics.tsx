"use client";

import { useEffect } from "react";

export const LANDING_ANALYTICS_EVENT = "recruiter-radar:landing-event";

const LANDING_EVENT_NAMES = [
  "hero_cta_clicked",
  "live_preview_opened",
  "profile_setup_started",
  "checkout_started",
  "plan_selected",
  "pricing_viewed",
  "faq_opened",
] as const;

export type LandingAnalyticsEventName = (typeof LANDING_EVENT_NAMES)[number];

export type LandingAnalyticsDetail = {
  name: LandingAnalyticsEventName;
  context?: string;
};

const LANDING_EVENT_NAME_SET = new Set<string>(LANDING_EVENT_NAMES);

function emitLandingAnalyticsEvent(detail: LandingAnalyticsDetail) {
  window.dispatchEvent(new CustomEvent<LandingAnalyticsDetail>(LANDING_ANALYTICS_EVENT, { detail }));
}

function emitElementEvents(element: HTMLElement) {
  const context = element.dataset.landingEventContext?.trim() || undefined;
  const names = element.dataset.landingEvents?.split(/\s+/) ?? [];

  for (const name of names) {
    if (!LANDING_EVENT_NAME_SET.has(name)) continue;
    emitLandingAnalyticsEvent({ name: name as LandingAnalyticsEventName, context });
  }
}

/**
 * Provider-neutral conversion instrumentation for the public landing. It emits
 * a stable browser event contract and deliberately reads only static data-*
 * attributes, so profile fields and other personal data never enter analytics.
 */
export default function LandingAnalytics() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>("[data-landing-events]");
      if (!target || target instanceof HTMLFormElement) return;
      emitElementEvents(target);
    };

    const handleSubmit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      if (!event.target.matches("[data-landing-events]")) return;
      emitElementEvents(event.target);
    };

    const faqItems = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-landing-faq]"));
    const handleFaqToggle = (event: Event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLDetailsElement) || !target.open) return;
      emitLandingAnalyticsEvent({
        name: "faq_opened",
        context: target.dataset.landingFaq?.trim() || undefined,
      });
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit, true);
    faqItems.forEach((item) => item.addEventListener("toggle", handleFaqToggle));

    const pricing = document.querySelector<HTMLElement>("[data-landing-pricing]");
    let pricingObserver: IntersectionObserver | undefined;
    if (pricing && "IntersectionObserver" in window) {
      pricingObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        emitLandingAnalyticsEvent({ name: "pricing_viewed", context: "pricing" });
        pricingObserver?.disconnect();
      }, { threshold: 0.35 });
      pricingObserver.observe(pricing);
    }

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("submit", handleSubmit, true);
      faqItems.forEach((item) => item.removeEventListener("toggle", handleFaqToggle));
      pricingObserver?.disconnect();
    };
  }, []);

  return null;
}
