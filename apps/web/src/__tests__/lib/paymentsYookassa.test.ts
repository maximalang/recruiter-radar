/** @jest-environment node */

import { createYooKassaPaymentAdapter } from '@/lib/paymentsYookassa'
import type { CheckoutOrder } from '@/lib/paymentsTypes'

const originalEnv = { ...process.env }
const originalFetch = global.fetch

function order(): CheckoutOrder {
  return {
    id: '42',
    productCode: 'pilot',
    amountMinor: 299000,
    currency: 'RUB',
    status: 'created',
    customerName: 'Northstar Recruiting',
    customerContact: 'owner@example.com',
    provider: null,
    providerPaymentId: null,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    paidAt: null,
    payload: {
      planName: 'Неделя',
      planCadence: '7 дней',
      specialization: 'IT',
      city: 'Москва',
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
      onboardingStatus: 'inactive',
      onboardingStep: 'confirm-profile',
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
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('YooKassa payment adapter', () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.YOOKASSA_SHOP_ID = 'test-shop'
    process.env.YOOKASSA_SECRET_KEY = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('creates a redirect payment with idempotency and without a 54-FZ receipt payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({
      id: 'payment-1',
      status: 'pending',
      confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract' },
      metadata: { order_id: '42', product_code: 'pilot' },
      amount: { value: '2990.00', currency: 'RUB' },
      test: true,
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await createYooKassaPaymentAdapter().createCheckoutSession({
      order: order(),
      successUrl: 'https://recruiter-radar.ru/checkout/order/42/success',
      cancelUrl: 'https://recruiter-radar.ru/checkout/order/42/cancel',
    })

    expect(result).toMatchObject({
      kind: 'redirect',
      provider: 'yookassa',
      providerPaymentId: 'payment-1',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(headers['Idempotence-Key']).toBe('rr-payment-42')
    expect(headers.Authorization).toMatch(/^Basic /)
    expect(body).toMatchObject({
      amount: { value: '2990.00', currency: 'RUB' },
      capture: true,
      metadata: { order_id: '42', product_code: 'pilot' },
    })
    expect(body).not.toHaveProperty('receipt')
  })

  test('verifies a webhook against the YooKassa API before returning paid', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({
      id: 'payment-1',
      status: 'succeeded',
      paid: true,
      captured_at: '2026-07-31T10:01:00.000Z',
      metadata: { order_id: '42' },
      amount: { value: '2990.00', currency: 'RUB' },
      test: true,
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const request = new Request('https://recruiter-radar.ru/api/billing/webhook/yookassa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'notification',
        event: 'payment.succeeded',
        object: { id: 'payment-1' },
      }),
    })

    const result = await createYooKassaPaymentAdapter().parseWebhook?.(request)

    expect(result).toMatchObject({
      ok: true,
      orderId: '42',
      providerPaymentId: 'payment-1',
      status: 'paid',
      paidAt: '2026-07-31T10:01:00.000Z',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.yookassa.ru/v3/payments/payment-1',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })

  test('fails closed when credentials are absent', async () => {
    delete process.env.YOOKASSA_SHOP_ID
    delete process.env.YOOKASSA_SECRET_KEY

    const result = await createYooKassaPaymentAdapter().createCheckoutSession({
      order: order(),
      successUrl: 'https://recruiter-radar.ru/success',
      cancelUrl: 'https://recruiter-radar.ru/cancel',
    })

    expect(result).toEqual({
      kind: 'unavailable',
      provider: 'yookassa',
      message: 'ЮKassa пока не настроена.',
    })
  })
})
