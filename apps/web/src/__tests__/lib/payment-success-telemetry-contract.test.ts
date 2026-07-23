import fs from "node:fs";
import path from "node:path";

import { LANDING_ANALYTICS_EVENT } from "@/lib/landing-analytics-contract";
import { PRODUCT_EVENT_NAMES } from "@/lib/telemetry";

const migrationPath = path.resolve(
  process.cwd(),
  "../../packages/db/migrations/20260723120000_add_landing_telemetry_contract.sql",
);

describe("payment success telemetry contract", () => {
  test("records payment_succeeded atomically on the first pending-to-paid transition", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain(`'${LANDING_ANALYTICS_EVENT.paymentSucceeded}'`);
    expect(migration).toContain("OLD.status = 'pending'");
    expect(migration).toContain("NEW.status = 'paid'");
    expect(migration).toContain("'payment_succeeded:' || NEW.id");
    expect(migration).toContain("ON CONFLICT (event_key) DO NOTHING");
    for (const eventName of PRODUCT_EVENT_NAMES) {
      expect(migration).toContain(`'${eventName}'`);
    }
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
