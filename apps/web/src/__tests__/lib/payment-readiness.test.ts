import fs from 'node:fs'
import path from 'node:path'

import { buildPaymentReadinessReport } from '@/lib/payment-readiness'
import { OPERATOR_REQUISITES } from '@/lib/operatorRequisites'
import { PUBLIC_PLANS } from '@/lib/pricingCatalog'

describe('payment readiness', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    for (const key of [
      'ROBOKASSA_PASSWORD_3',
      'ROBOKASSA_SMZ_RECEIPTS_ENABLED',
      'OPERATOR_PUBLIC_POSTAL_ADDRESS',
      'ROBOKASSA_SITE_CRITERIA_VERIFIED_AT',
      'ROBOKASSA_TEST_FLOW_VERIFIED_AT',
      'ROBOKASSA_REFUND_FLOW_VERIFIED_AT',
      'ROBOKASSA_NPD_RECEIPT_FLOW_VERIFIED_AT',
      'ROBOKASSA_LIVE_FLOW_VERIFIED_AT',
      'PDN_OPERATOR_NOTIFICATION_VERIFIED_AT',
      'PDN_LOCALIZATION_VERIFIED_AT',
      'PDN_PROCESSORS_VERIFIED_AT',
      'PDN_CROSS_BORDER_VERIFIED_AT',
      'PDN_COMPLIANCE_VERIFIED_AT',
      'TELEGRAM_BOT_TOKEN',
    ]) delete process.env[key]
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

  test('uses the confirmed Ryazan seller location for moderation', () => {
    expect(OPERATOR_REQUISITES.city).toBe('Рязань')
    const report = buildPaymentReadinessReport({
      provider: 'robokassa',
      configured: true,
      mode: 'test',
      webhookConfigured: true,
      siteUrlConfigured: true,
    })
    expect(report.merchantModerationReady).toBe(true)
    expect(report.launch.blockers).not.toContain(
      'A confirmed seller city or actual correspondence address is required before Robokassa moderation.',
    )
  })

  test('requires cross-border verification when Telegram delivery is configured', () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456:test-token'
    const report = buildPaymentReadinessReport({
      provider: 'robokassa',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    })
    expect(report.launch.blockers).toContain(
      'Telegram cross-border transfer prerequisites have not been verified.',
    )
  })

  test('requires all external evidence before reporting live-ready', () => {
    process.env.ROBOKASSA_MODE = 'live'
    process.env.ROBOKASSA_PASSWORD_3 = 'refund-password-three'
    process.env.ROBOKASSA_SMZ_RECEIPTS_ENABLED = 'true'
    process.env.ROBOKASSA_SITE_CRITERIA_VERIFIED_AT = '2026-08-05T18:00:00.000Z'
    process.env.ROBOKASSA_TEST_FLOW_VERIFIED_AT = '2026-08-05T18:10:00.000Z'
    process.env.ROBOKASSA_REFUND_FLOW_VERIFIED_AT = '2026-08-05T18:20:00.000Z'
    process.env.ROBOKASSA_NPD_RECEIPT_FLOW_VERIFIED_AT = '2026-08-05T18:30:00.000Z'
    process.env.PDN_OPERATOR_NOTIFICATION_VERIFIED_AT = '2026-08-05T18:40:00.000Z'
    process.env.PDN_LOCALIZATION_VERIFIED_AT = '2026-08-05T18:50:00.000Z'
    process.env.PDN_PROCESSORS_VERIFIED_AT = '2026-08-05T19:00:00.000Z'
    process.env.PDN_COMPLIANCE_VERIFIED_AT = '2026-08-05T19:10:00.000Z'
    process.env.ROBOKASSA_LIVE_FLOW_VERIFIED_AT = '2026-08-05T19:20:00.000Z'

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
    expect(checkoutPage).toContain('Перейти к оплате {plan.price}')
    expect(checkoutPage).toContain('Откроется платёжная страница Robokassa')
    expect(checkoutPage).toContain('name="payerType"')
    expect(checkoutPage).toContain('name="buyerInn"')
    expect(PUBLIC_PLANS).toHaveLength(3)
    expect(PUBLIC_PLANS.every((plan) => plan.isRecurring === false)).toBe(true)
  })
})
