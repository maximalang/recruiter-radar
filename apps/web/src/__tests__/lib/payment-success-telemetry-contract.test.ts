import fs from "node:fs";
import path from "node:path";

import { LANDING_ANALYTICS_EVENT } from "@/lib/landing-analytics-contract";
import { PRODUCT_EVENT_NAMES } from "@/lib/telemetry";

describe("payment success telemetry contract", () => {
  test("shares one payment_succeeded name across analytics and product telemetry", () => {
    expect(PRODUCT_EVENT_NAMES).toContain(
      LANDING_ANALYTICS_EVENT.paymentSucceeded,
    );
    expect(
      PRODUCT_EVENT_NAMES.filter(
        (eventName) => eventName === LANDING_ANALYTICS_EVENT.paymentSucceeded,
      ),
    ).toHaveLength(1);
  });

  test("has no client-side payment success emitter left in the onboarding path", () => {
    const onboardingPage = fs.readFileSync(
      path.resolve(process.cwd(), "app/onboarding/pilot/[orderId]/page.tsx"),
      "utf8",
    );

    expect(onboardingPage).not.toContain("PaymentSuccessAnalytics");
    expect(fs.existsSync(path.resolve(process.cwd(), "app/payment-success-analytics.tsx"))).toBe(false);
  });
});
