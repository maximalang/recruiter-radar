import fs from 'node:fs'
import path from 'node:path'

import { buildPaymentReadinessReport } from '@/lib/payment-readiness'
import { PUBLIC_PLANS } from '@/lib/pricingCatalog'

describe('payment readiness', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ROBOKASSA_PASSWORD_3
    delete process.env.ROBOKASSA_SMZ_RECEIPTS_ENABLED
    delete process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS
    delete process.env.ROBOKASSA_TEST_FLOW_VERIFIED_AT
    delete process.env.ROBOKASSA_REFUND_FLOW_VERIFIED_AT
    delete process.env.ROBOKASSA_NPD_RECEIPT_FLOW_VERIFIED_AT
    delete process.env.PDN_COMPLIANCE_VERIFIED_AT
    delete process.env.ROBOKASSA_LIVE_FLOW_VERIFIED_AT
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('reports saved requests when no provider is configured', () => {
    expect(buildPaymentReadinessReport({
      provider: null,
      configured: false,
      mode: null,
      webhookConfigured: false,
      siteUrlConfigured: true,
    })).toMatchObject({
      selfServeCheckoutReady: false,
      selfServePilotReady: false,
      recurringBillingReady: false,
      liveLaunchReady: false,
      customerFlow: {
        pilot: 'saved_request',
        monthly: 'saved_request',
        quarterly: 'saved_request',
      },
      rfProvider: { status: 'blocked', provider: null },
    })
  })

  test('marks every one-off tariff self-service when Robokassa integration is configured', () => {
    expect(buildPaymentReadinessReport({
      provider: 'robokassa',
      configured: true,
      mode: 'test',
      webhookConfigured: true,
      siteUrlConfigured: true,
    })).toMatchObject({
      selfServeCheckoutReady: true,
      selfServePilotReady: true,
      recurringBillingReady: false,
      liveLaunchReady: false,
      customerFlow: {
        pilot: 'self_service_payment',
        monthly: 'self_service_payment',
        quarterly: 'self_service_payment',
      },
      rfProvider: { status: 'ready', provider: 'robokassa' },
    })
  })

  test('requires external evidence before reporting live-ready', () => {
    process.env.OPERATOR_PUBLIC_POSTAL_ADDRESS = '123456, Россия, г. Тестовый, ул. Тестовая, д. 1'
    process.env.ROBOKASSA_MODE = 'live'
    process.env.ROBOKASSA_PASSWORD_3 = 'refund-password-three'
    process.env.ROBOKASSA_SMZ_RECEIPTS_ENABLED = 'true'
    process.env.ROBOKASSA_TEST_FLOW_VERIFIED_AT = '2026-08-04T18:00:00.000Z'
    process.env.ROBOKASSA_REFUND_FLOW_VERIFIED_AT = '2026-08-04T18:10:00.000Z'
    process.env.ROBOKASSA_NPD_RECEIPT_FLOW_VERIFIED_AT = '2026-08-04T18:20:00.000Z'
    process.env.PDN_COMPLIANCE_VERIFIED_AT = '2026-08-04T18:30:00.000Z'
    process.env.ROBOKASSA_LIVE_FLOW_VERIFIED_AT = '2026-08-04T18:40:00.000Z'

    const report = buildPaymentReadinessReport({
      provider: 'robokassa',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    })

    expect(report).toMatchObject({
      refundsConfigured: true,
      npdReceiptsConfigured: true,
      merchantModerationReady: true,
      liveLaunchReady: true,
      launch: { status: 'live-ready', blockers: [] },
    })
  })

  test('checkout and tariff catalog explicitly disable recurring charges', () => {
    const checkoutPage = fs.readFileSync(path.resolve(process.cwd(), 'app/checkout/page.tsx'), 'utf8')

    expect(checkoutPage).toContain('Автопродления и скрытых списаний нет')
    expect(checkoutPage).toContain('Оплатить {plan.price} через Robokassa')
    expect(PUBLIC_PLANS).toHaveLength(3)
    expect(PUBLIC_PLANS.every((plan) => plan.isRecurring === false)).toBe(true)
  })
})
