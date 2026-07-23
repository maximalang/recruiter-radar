import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
  isLandingAnalyticsContext,
  isLandingAnalyticsEventName,
} from "@/lib/landing-analytics-contract";

describe("landing analytics contract", () => {
  it("shares strict event and context allowlists with runtime guards", () => {
    expect(isLandingAnalyticsEventName(LANDING_ANALYTICS_EVENT.previewGenerated)).toBe(true);
    expect(isLandingAnalyticsEventName(LANDING_ANALYTICS_EVENT.paymentSucceeded)).toBe(true);
    expect(isLandingAnalyticsEventName("email_captured")).toBe(false);

    expect(isLandingAnalyticsContext(LANDING_ANALYTICS_CONTEXT.motionControl)).toBe(true);
    expect(isLandingAnalyticsContext("motion_control")).toBe(false);
  });
});
