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
import {
  ANALYTICS_CONSENT_CHANGED_EVENT,
  readAnalyticsConsent,
} from "../lib/analytics-consent";
import {
  isInternalMarker,
  isRefererClass,
  isUaClass,
  isUtmSourceClass,
} from "../lib/telemetry-dimensions";

export type LandingAnalyticsDetail = {
  name: LandingAnalyticsEventName;
  context?: LandingAnalyticsContext;
  attachment?: string;
};

export type LandingAnalyticsProps = {
  /** Server-classified request-time referer class (fixed vocabulary). */
  refererClass?: string;
  /** Server-classified request-time UTM source class (fixed vocabulary). */
  utmSourceClass?: string;
  /** Server-classified request-time user agent class (fixed vocabulary). */
  uaClass?: string;
  /** Client-declared non-public viewing context (fixed vocabulary). */
  internalMarker?: string;
};

// Class vocabularies are re-validated on the client because props cross a
// trust boundary: the values are rendered from server classification, and a
// compromised render context must not be able to smuggle arbitrary strings
// into telemetry. attachment is bounded to 64 safe characters.
function sanitizeDimension(
  value: string | undefined,
  isValid: (candidate: string) => boolean,
): string | undefined {
  return value !== undefined && isValid(value) ? value : undefined;
}

function sanitizeAttachment(value: string | undefined): string | undefined {
  return value !== undefined && /^[0-9a-z_.:-]{1,64}$/.test(value)
    ? value
    : undefined;
}

export function sendLandingEvent(
  detail: LandingAnalyticsDetail,
  dimensions?: {
    refererClass?: string;
    utmSourceClass?: string;
    uaClass?: string;
    internalMarker?: string;
    attachment?: string;
  },
) {
  if (readAnalyticsConsent() !== true) return;
  const timestamp = Date.now();
  void fetch("/api/landing-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...detail, ...dimensions, timestamp }),
    keepalive: true,
  }).catch(() => undefined);
}

export default function LandingAnalytics({
  refererClass,
  utmSourceClass,
  uaClass,
  internalMarker,
}: LandingAnalyticsProps) {
  useEffect(() => {
    const requestDimensions = {
      ...(sanitizeDimension(refererClass, isRefererClass)
        ? { referer_class: refererClass }
        : {}),
      ...(sanitizeDimension(utmSourceClass, isUtmSourceClass)
        ? { utm_source_class: utmSourceClass }
        : {}),
      ...(sanitizeDimension(uaClass, isUaClass)
        ? { ua_class: uaClass }
        : {}),
      ...(sanitizeDimension(internalMarker, isInternalMarker)
        ? { internal_marker: internalMarker }
        : {}),
    };

    sendLandingEvent({
      name: LANDING_ANALYTICS_EVENT.landingViewed,
    }, requestDimensions);

    const handleConsentChanged = () => {
      if (readAnalyticsConsent() === true) {
        sendLandingEvent({
          name: LANDING_ANALYTICS_EVENT.landingViewed,
        }, requestDimensions);
      }
    };

    const handleCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<LandingAnalyticsDetail>).detail;
      if (!detail || !isLandingAnalyticsEventName(detail.name)) return;
      if (detail.context !== undefined && !isLandingAnalyticsContext(detail.context)) return;
      sendLandingEvent(detail, {
        ...requestDimensions,
        ...(detail.attachment
          ? { attachment: sanitizeAttachment(detail.attachment) }
          : {}),
      });
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
      const attachment = sanitizeAttachment(
        analyticsTarget.dataset.analyticsAttachment,
      );
      sendLandingEvent({
        name,
        ...(context ? { context } : {}),
      }, {
        ...requestDimensions,
        ...(attachment ? { attachment } : {}),
      });
    };
    const handleToggle = (event: Event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;
      if (details.dataset.analyticsEvent !== LANDING_ANALYTICS_EVENT.faqOpened) return;
      sendLandingEvent({
        name: LANDING_ANALYTICS_EVENT.faqOpened,
        context: LANDING_ANALYTICS_CONTEXT.faq,
      }, requestDimensions);
    };

    window.addEventListener(LANDING_ANALYTICS_DOM_EVENT, handleCustomEvent);
    window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, handleConsentChanged);
    document.addEventListener("click", handleClick);
    document.addEventListener("toggle", handleToggle, true);
    return () => {
      window.removeEventListener(LANDING_ANALYTICS_DOM_EVENT, handleCustomEvent);
      window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, handleConsentChanged);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("toggle", handleToggle, true);
    };
    // Dimension props are server-derived per request; the listeners are
    // installed once per mount with the current request's snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
