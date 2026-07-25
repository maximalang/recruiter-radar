import fs from "node:fs";
import path from "node:path";

import { LANDING_ANALYTICS_EVENT } from "@/lib/landing-analytics-contract";
import { PRODUCT_EVENT_NAMES } from "@/lib/telemetry";

const migrationPath = path.resolve(
  process.cwd(),
  "../../packages/db/migrations/20260723120000_add_landing_telemetry_contract.sql",
);
const transitionFixMigrationPath = path.resolve(
  process.cwd(),
  "../../packages/db/migrations/20260725120000_fix_payment_succeeded_transition.sql",
);
const eventContractMigrationPath = path.resolve(
  process.cwd(),
  "../../packages/db/migrations/20260725121000_update_landing_event_contract.sql",
);

describe("payment success telemetry contract", () => {
  test("records payment_succeeded atomically on the first transition to paid", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(fs.existsSync(transitionFixMigrationPath)).toBe(true);
    expect(fs.existsSync(eventContractMigrationPath)).toBe(true);

    const migration = fs.readFileSync(migrationPath, "utf8");
    const transitionFixMigration = fs.readFileSync(transitionFixMigrationPath, "utf8");
    const eventContractMigration = fs.readFileSync(eventContractMigrationPath, "utf8");

    expect(migration).toContain(`'${LANDING_ANALYTICS_EVENT.paymentSucceeded}'`);
    expect(transitionFixMigration).toContain("OLD.status IS DISTINCT FROM 'paid'");
    expect(transitionFixMigration).toContain("NEW.status = 'paid'");
    expect(transitionFixMigration).not.toContain("OLD.status = 'pending'");
    expect(transitionFixMigration).toContain("'payment-succeeded:' || NEW.id");
    expect(transitionFixMigration).toContain("checkout_order_id");
    expect(transitionFixMigration).toContain("ON CONFLICT (event_key) DO NOTHING");
    expect(transitionFixMigration).not.toContain("EXCEPTION WHEN OTHERS THEN");
    expect(transitionFixMigration).not.toContain("RAISE WARNING");
    for (const eventName of PRODUCT_EVENT_NAMES) {
      expect(`${migration}\n${eventContractMigration}`).toContain(`'${eventName}'`);
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
