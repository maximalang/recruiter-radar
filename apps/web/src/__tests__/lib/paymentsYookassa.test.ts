/** @jest-environment node */

import { createYooKassaPaymentAdapter, getYooKassaPaymentSetupState } from "@/lib/paymentsYookassa";
import type { CheckoutOrder } from "@/lib/paymentsTypes";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function order(overrides: Partial<CheckoutOrder> = {}): CheckoutOrder {
  return {
    id: "42",
    productCode: "pilot",
    amountMinor: 299000,
    currency: "RUB",
    status: "created",
    customerName: "Northstar Recruiting",
    customerContact: "owner@example.com",
    provider: null,
    providerPaymentId: null,
    createdAt: "2026-07-31T10:00:00.000Z",
    updatedAt: "2026-07-31T10:00:00.000Z",
    paidAt: null,
    payload: {
      planName: "Неделя",
      planCadence: "7 дней",
      specialization: "IT",
      city: "Москва",
      includeKeywords: [],
      excludeKeywords: [],
      industries: [],
      companySizes: [],
      dailyDigestLimit: 10,
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
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    status: "pending",
    paid: false,
    amount: { value: "2990.00", currency: "RUB" },
    refunded_amount: { value: "0.00", currency: "RUB" },
    confirmation: { confirmation_url: "https://yoomoney.ru/checkout/payments/v2/contract" },
    metadata: { order_id: "42", product_code: "pilot", amount_minor: "299000", currency: "RUB" },
    test: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function configure() {
  process.env.YOOKASSA_SHOP_ID = "test-shop";
  process.env.YOOKASSA_SECRET_KEY = "test-secret";
  process.env.YOOKASSA_MODE = "test";
  process.env.PAYMENTS_SITE_URL = "https://recruiter-radar.ru";
  process.env.YOOKASSA_WEBHOOK_URL = "https://recruiter-radar.ru/api/billing/webhook/yookassa";
}

describe("YooKassa payment adapter", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    configure();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("is fail-closed without an explicit mode and canonical URLs", () => {
    delete process.env.YOOKASSA_MODE;
    expect(getYooKassaPaymentSetupState().checkoutConfigured).toBe(false);
    process.env.YOOKASSA_MODE = "test";
    process.env.PAYMENTS_SITE_URL = "https://example.com";
    expect(getYooKassaPaymentSetupState().checkoutConfigured).toBe(false);
  });

  test("creates one-stage redirect payment with idempotence and no saved method or 54-FZ receipt", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(payment()));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createYooKassaPaymentAdapter().createCheckoutSession({
      order: order(),
      successUrl: "https://recruiter-radar.ru/checkout/order/42/success",
      cancelUrl: "https://recruiter-radar.ru/checkout/order/42/cancel",
    });

    expect(result).toMatchObject({ kind: "redirect", provider: "yookassa", providerPaymentId: "payment-1" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(headers["Idempotence-Key"]).toBe("rr-payment-42");
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(body).toMatchObject({
      amount: { value: "2990.00", currency: "RUB" },
      capture: true,
      metadata: { order_id: "42", amount_minor: "299000", currency: "RUB" },
    });
    expect(body).not.toHaveProperty("receipt");
    expect(body).not.toHaveProperty("save_payment_method");
  });

  test("rejects a payment with mismatched amount", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(payment({ amount: { value: "1.00", currency: "RUB" } }))) as unknown as typeof fetch;
    await expect(createYooKassaPaymentAdapter().createCheckoutSession({
      order: order(),
      successUrl: "https://recruiter-radar.ru/success",
      cancelUrl: "https://recruiter-radar.ru/cancel",
    })).rejects.toThrow("Сумма платежа");
  });

  test("verifies payment webhook via API before returning paid", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(payment({ status: "succeeded", paid: true, captured_at: "2026-07-31T10:01:00.000Z" })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const request = new Request("https://recruiter-radar.ru/api/billing/webhook/yookassa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "notification", event: "payment.succeeded", object: { id: "payment-1" } }),
    });

    const result = await createYooKassaPaymentAdapter().parseWebhook?.(request);
    expect(result).toMatchObject({ ok: true, orderId: "42", providerPaymentId: "payment-1", status: "paid", amountMinor: 299000, currency: "RUB", test: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.yookassa.ru/v3/payments/payment-1",
      expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.anything() }),
    );
  });

  test("maps a fully refunded payment to terminal refunded status", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "refund-1", status: "succeeded", payment_id: "payment-1", amount: { value: "2990.00", currency: "RUB" } }))
      .mockResolvedValueOnce(jsonResponse(payment({ status: "succeeded", paid: true, refunded_amount: { value: "2990.00", currency: "RUB" } })));
    global.fetch = fetchMock as unknown as typeof fetch;
    const request = new Request("https://recruiter-radar.ru/api/billing/webhook/yookassa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "notification", event: "refund.succeeded", object: { id: "refund-1" } }),
    });

    const result = await createYooKassaPaymentAdapter().parseWebhook?.(request);
    expect(result).toMatchObject({ ok: true, status: "refunded", providerPaymentId: "payment-1" });
  });
});
