import { createHash } from "node:crypto";

import {
  createRobokassaPaymentAdapter,
  getRobokassaPaymentSetupState,
} from "../../../lib/paymentsRobokassa";
import type { CheckoutOrder } from "../../../lib/paymentsTypes";

const ORIGINAL_ENV = process.env;

function order(): CheckoutOrder {
  return {
    id: "42",
    productCode: "pilot",
    amountMinor: 299000,
    currency: "RUB",
    status: "created",
    customerName: "Northstar Recruiting",
    customerContact: "buyer@example.com",
    payload: {
      planName: "Неделя",
      planCadence: "7 дней",
      specialization: null,
      city: null,
      includeKeywords: [],
      excludeKeywords: [],
      industries: [],
      companySizes: [],
      dailyDigestLimit: 5,
      roles: [],
      excludedIndustries: [],
      excludedLocations: [],
      remoteFriendly: false,
      comment: null,
      pilotApplicationId: null,
      clientProfileId: null,
      onboardingStatus: "inactive",
      onboardingStep: "confirm-profile",
      onboardingActivatedAt: null,
      onboardingCompletedAt: null,
      onboardingTestDigestSentAt: null,
      onboardingTestDigestTelegramMessageId: null,
      customerDigestLastSentAt: null,
      customerDigestLastEmptyAt: null,
      customerDigestLastFailedAt: null,
      paymentMessage: null,
      paymentProviderPayload: null,
    },
    provider: null,
    providerPaymentId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    paidAt: null,
  };
}

function configure() {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    ROBOKASSA_MODE: "test",
    ROBOKASSA_MERCHANT_LOGIN: "recruiter-radar-test",
    ROBOKASSA_HASH_ALGORITHM: "sha256",
    ROBOKASSA_TEST_PASSWORD_1: "password-one",
    ROBOKASSA_TEST_PASSWORD_2: "password-two",
    ROBOKASSA_RESULT_URL: "https://recruiter-radar.ru/api/billing/webhook/robokassa",
  };
}

function signature(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("Robokassa payment adapter", () => {
  beforeEach(() => configure());
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("reports explicit test readiness", () => {
    expect(getRobokassaPaymentSetupState()).toEqual({
      checkoutConfigured: true,
      mode: "test",
      webhookConfigured: true,
    });
  });

  it("builds a signed one-time payment redirect", async () => {
    const result = await createRobokassaPaymentAdapter().createCheckoutSession({
      order: order(),
      successUrl: "https://recruiter-radar.ru/checkout/order/42/success",
      cancelUrl: "https://recruiter-radar.ru/checkout/order/42/cancel",
    });

    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;

    const url = new URL(result.redirectUrl);
    expect(url.origin + url.pathname).toBe("https://auth.robokassa.ru/Merchant/Index.aspx");
    expect(url.searchParams.get("OutSum")).toBe("2990.00");
    expect(url.searchParams.get("InvId")).toBe("42");
    expect(url.searchParams.get("IsTest")).toBe("1");
    expect(url.searchParams.get("Shp_order_id")).toBe("42");
    expect(url.searchParams.get("Shp_plan")).toBe("pilot");
    expect(url.searchParams.get("Email")).toBe("buyer@example.com");
    expect(url.searchParams.get("SignatureValue")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a correctly signed ResultURL and returns Robokassa acknowledgement", async () => {
    const outSum = "2990.00";
    const invId = "42";
    const shp = "Shp_order_id=42:Shp_plan=pilot";
    const value = signature(`${outSum}:${invId}:password-two:${shp}`);
    const body = new URLSearchParams({
      OutSum: outSum,
      InvId: invId,
      SignatureValue: value,
      Shp_order_id: invId,
      Shp_plan: "pilot",
    });

    const parsed = await createRobokassaPaymentAdapter().parseWebhook?.(
      new Request("https://recruiter-radar.ru/api/billing/webhook/robokassa", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );

    expect(parsed).toMatchObject({
      ok: true,
      responseStatus: 200,
      responseBody: "OK42",
      orderId: "42",
      status: "paid",
    });
    expect(parsed?.payload).toMatchObject({
      signatureVerified: true,
      amount: { value: "2990.00", currency: "RUB" },
    });
  });

  it("rejects a forged callback", async () => {
    const parsed = await createRobokassaPaymentAdapter().parseWebhook?.(
      new Request("https://recruiter-radar.ru/api/billing/webhook/robokassa", {
        method: "POST",
        body: new URLSearchParams({
          OutSum: "2990.00",
          InvId: "42",
          SignatureValue: "deadbeef",
          Shp_order_id: "42",
          Shp_plan: "pilot",
        }),
      }),
    );

    expect(parsed).toMatchObject({ ok: false, responseStatus: 401 });
  });

  it("does not treat a browser return as payment confirmation in test mode", async () => {
    const result = await createRobokassaPaymentAdapter().syncOrderAfterReturn?.({
      order: { ...order(), status: "pending", provider: "robokassa" },
      providerPaymentId: "robokassa:42",
      searchParams: { InvId: "42" },
    });

    expect(result).toMatchObject({ status: "pending" });
  });
});
