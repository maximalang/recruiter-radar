import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
  isLandingAnalyticsContext,
  isLandingAnalyticsEventName,
} from "@/lib/landing-analytics-contract";
import { PRODUCT_EVENT_NAMES } from "@/lib/telemetry";

describe("landing analytics contract", () => {
  it("shares strict event and context allowlists with runtime guards", () => {
    expect(isLandingAnalyticsEventName(LANDING_ANALYTICS_EVENT.previewGenerated)).toBe(true);
    expect(isLandingAnalyticsEventName(LANDING_ANALYTICS_EVENT.paymentSucceeded)).toBe(true);
    expect(LANDING_ANALYTICS_EVENT.previewResultsClicked).toBe("preview_results_clicked");
    expect(LANDING_ANALYTICS_EVENT.checkoutStarted).toBe("checkout_started");
    expect(LANDING_ANALYTICS_EVENT.continuationCtaClicked).toBe("continuation_cta_clicked");
    expect(isLandingAnalyticsEventName("pilot_cta_clicked")).toBe(false);
    expect(isLandingAnalyticsEventName("closing_cta_clicked")).toBe(false);
    expect(isLandingAnalyticsEventName("preview_checkout_clicked")).toBe(false);
    expect(isLandingAnalyticsEventName("email_captured")).toBe(false);

    expect(isLandingAnalyticsContext(LANDING_ANALYTICS_CONTEXT.motionControl)).toBe(true);
    expect(LANDING_ANALYTICS_CONTEXT.heroPrimary).toBe("hero_primary");
    expect(LANDING_ANALYTICS_CONTEXT.heroSecondary).toBe("hero_secondary");
    expect(LANDING_ANALYTICS_CONTEXT.pricingPilot).toBe("pricing_pilot");
    expect(LANDING_ANALYTICS_CONTEXT.preview).toBe("preview");
    expect(LANDING_ANALYTICS_CONTEXT.landing).toBe("landing");
    expect(LANDING_ANALYTICS_CONTEXT.monthly).toBe("monthly");
    expect(LANDING_ANALYTICS_CONTEXT.quarterly).toBe("quarterly");
    expect(isLandingAnalyticsContext("raw_form_value")).toBe(false);
    expect(isLandingAnalyticsContext("form")).toBe(false);
    expect(isLandingAnalyticsContext("preset")).toBe(false);
  });

  it("does not duplicate shared landing event names in product telemetry", () => {
    expect(new Set(PRODUCT_EVENT_NAMES).size).toBe(PRODUCT_EVENT_NAMES.length);
  });
});
