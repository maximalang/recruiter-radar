import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("production observability contract", () => {
  it("covers auth request, email, callback and session outcomes without email metadata", () => {
    const auth = source("lib/auth-v2/challenges.ts");
    for (const event of [
      "auth_v2.login_requested",
      "auth_v2.login_email_sent",
      "auth_v2.login_email_failed",
      "auth_v2.login_confirmation_failed",
      "auth_v2.session_created",
    ]) expect(auth).toContain(event);
    expect(auth).not.toMatch(/log(?:Event|Warn|Error)\([^\n]+\{[^}]*email/i);
  });

  it("covers checkout, webhook and entitlement reconciliation with bounded metadata", () => {
    const payments = source("lib/payments.ts");
    const webhook = source("app/api/billing/webhook/robokassa/route.ts");
    for (const event of [
      "payments.checkout_created",
      "payments.checkout_provider_failed",
      "payments.webhook_rejected",
      "payments.paid_entitlement_reconciled",
      "payments.webhook_reconciliation_failed",
    ]) expect(payments).toContain(event);
    expect(webhook).toContain("payments.webhook_processed");
    expect(webhook).toContain("payments.webhook_failed");
    expect(`${payments}\n${webhook}`).not.toMatch(/log(?:Event|Warn|Error)\([^\n]+\{[^}]*(customer|payload|signature|secret)/i);
  });

  it("covers radar outcomes, zero-result anomalies and per-channel delivery", () => {
    const radar = source("app/api/cron/daily-radar/route.ts");
    const delivery = source("lib/digest/deliver-candidates.ts");
    expect(radar).toContain("daily_radar.run");
    expect(radar).toContain("daily_radar.pipeline_failed");
    expect(radar).toContain("daily_radar.source_ingest_completed");
    expect(radar).toContain("daily_radar.source_ingest_failed");
    expect(radar).toContain("daily_radar.zero_opportunity_anomaly");
    expect(delivery).toContain("digest.delivery_attempted");
    expect(delivery).toContain("digest.telegram_sent");
    expect(delivery).toContain("digest.telegram_failed");
    expect(delivery).toContain("delivery_succeeded");
    expect(delivery).toContain("delivery_failed");
  });
});
