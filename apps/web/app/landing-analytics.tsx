"use client";

import { useEffect } from "react";

export const LANDING_ANALYTICS_EVENT = "recruiter-radar:landing-event";

const LANDING_EVENT_NAMES = [
  "landing_viewed",
  "preview_started",
  "preview_generated",
  "preview_checkout_clicked",
  "checkout_viewed",
  "payment_started",
  "payment_succeeded",
] as const;

export type LandingAnalyticsEventName = (typeof LANDING_EVENT_NAMES)[number];

export type LandingAnalyticsDetail = {
  name: LandingAnalyticsEventName;
  context?: string;
};

type YandexMetrika = (counterId: number, method: "reachGoal", target: string, params?: Record<string, string>) => void;

declare global {
  interface Window {
    ym?: YandexMetrika;
  }
}

const LANDING_EVENT_NAME_SET = new Set<string>(LANDING_EVENT_NAMES);
function deliverLandingEvent(detail: LandingAnalyticsDetail) {
  const params = detail.context ? { context: detail.context } : undefined;
  const analyticsEndpoint = process.env.NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT?.trim();
  const metrikaCounterId = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID);

  if (Number.isFinite(metrikaCounterId) && metrikaCounterId > 0 && typeof window.ym === "function") {
    try {
      window.ym(metrikaCounterId, "reachGoal", detail.name, params);
    } catch {
      // One optional provider must not block another or affect conversion.
    }
  }

  if (analyticsEndpoint && typeof navigator.sendBeacon === "function") {
    try {
      navigator.sendBeacon(
        analyticsEndpoint,
        new Blob([JSON.stringify({ name: detail.name, ...(params ?? {}) })], { type: "application/json" }),
      );
    } catch {
      // Analytics delivery is best-effort and never blocks the UI.
    }
  }
}

export function emitLandingAnalyticsEvent(detail: LandingAnalyticsDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LandingAnalyticsDetail>(LANDING_ANALYTICS_EVENT, { detail }));
  deliverLandingEvent(detail);
}

export function LandingStageEvent(props: { name: LandingAnalyticsEventName; context?: string }) {
  useEffect(() => {
    emitLandingAnalyticsEvent({ name: props.name, context: props.context });
  }, [props.context, props.name]);

  return null;
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
 * Provider-neutral landing instrumentation. Event payloads are intentionally
 * limited to static stage names and UI context: profile fields never leave the
 * browser through this layer.
 */
export default function LandingAnalytics(props: { initialEvent?: LandingAnalyticsEventName; context?: string }) {
  useEffect(() => {
    emitLandingAnalyticsEvent({
      name: props.initialEvent ?? "landing_viewed",
      context: props.context ?? (props.initialEvent ? undefined : "landing"),
    });

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>("[data-landing-events]");
      if (!target || target instanceof HTMLFormElement) return;
      emitElementEvents(target);
    };

    const handleSubmit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement) || !event.target.matches("[data-landing-events]")) return;
      emitElementEvents(event.target);
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, [props.context, props.initialEvent]);

  return null;
}
