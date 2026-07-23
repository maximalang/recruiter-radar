export const LANDING_ANALYTICS_EVENT = {
  landingViewed: "landing_viewed",
  previewStarted: "preview_started",
  previewGenerated: "preview_generated",
  previewCheckoutClicked: "preview_checkout_clicked",
  checkoutViewed: "checkout_viewed",
  paymentStarted: "payment_started",
  paymentSucceeded: "payment_succeeded",
  pilotCtaClicked: "pilot_cta_clicked",
  closingCtaClicked: "closing_cta_clicked",
  continuationRequested: "continuation_requested",
  faqOpened: "faq_opened",
  motionPaused: "motion_paused",
  motionResumed: "motion_resumed",
  deliveryChannelSelected: "delivery_channel_selected",
  deliveryFeedbackSelected: "delivery_feedback_selected",
} as const;

export const LANDING_ANALYTICS_CONTEXT = {
  heroPrimary: "hero-primary",
  heroResults: "hero-results",
  header: "header",
  preset: "preset",
  previewForm: "preview-form",
  preview: "preview",
  pricing: "pricing",
  closing: "closing",
  checkoutForm: "checkout-form",
  onboarding: "onboarding",
  motionControl: "motion-control",
  deliveryDemo: "delivery-demo",
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
