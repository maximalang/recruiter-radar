export const LANDING_ANALYTICS_EVENT = {
  landingViewed: "landing_viewed",
  previewStarted: "preview_started",
  previewResultsClicked: "preview_results_clicked",
  previewGenerated: "preview_generated",
  checkoutStarted: "checkout_started",
  paymentSucceeded: "payment_succeeded",
  continuationCtaClicked: "continuation_cta_clicked",
  faqOpened: "faq_opened",
  motionPaused: "motion_paused",
  motionResumed: "motion_resumed",
  deliveryChannelSelected: "delivery_channel_selected",
  deliveryFeedbackSelected: "delivery_feedback_selected",
} as const;

export const LANDING_ANALYTICS_CONTEXT = {
  heroPrimary: "hero_primary",
  heroSecondary: "hero_secondary",
  landing: "landing",
  header: "header",
  preset: "preset",
  form: "form",
  preview: "preview",
  pricingPilot: "pricing_pilot",
  closing: "closing",
  checkout: "checkout",
  monthly: "monthly",
  quarterly: "quarterly",
  onboarding: "onboarding",
  motionControl: "motion_control",
  deliveryDemo: "delivery_demo",
  faq: "faq",
} as const;

export const LANDING_ANALYTICS_DOM_EVENT = "landing:analytics";

export const LANDING_ANALYTICS_EVENT_NAMES = Object.freeze(
  Object.values(LANDING_ANALYTICS_EVENT),
);
export const LANDING_ANALYTICS_CONTEXTS = Object.freeze(
  Object.values(LANDING_ANALYTICS_CONTEXT),
);

export type LandingAnalyticsEventName =
  (typeof LANDING_ANALYTICS_EVENT)[keyof typeof LANDING_ANALYTICS_EVENT];
export type LandingAnalyticsContext =
  (typeof LANDING_ANALYTICS_CONTEXT)[keyof typeof LANDING_ANALYTICS_CONTEXT];

const EVENT_NAMES = new Set<string>(LANDING_ANALYTICS_EVENT_NAMES);
const CONTEXTS = new Set<string>(LANDING_ANALYTICS_CONTEXTS);

export function isLandingAnalyticsEventName(
  value: unknown,
): value is LandingAnalyticsEventName {
  return typeof value === "string" && EVENT_NAMES.has(value);
}

export function isLandingAnalyticsContext(
  value: unknown,
): value is LandingAnalyticsContext {
  return typeof value === "string" && CONTEXTS.has(value);
}
