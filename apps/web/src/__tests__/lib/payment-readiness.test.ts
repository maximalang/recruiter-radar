import fs from 'node:fs'
import path from 'node:path'

import { buildPaymentReadinessReport } from '@/lib/payment-readiness'

describe('payment readiness', () => {
  test('reports sales-assisted state when no provider is configured', () => {
    expect(buildPaymentReadinessReport({
      provider: null,
      configured: false,
      mode: null,
      webhookConfigured: false,
      siteUrlConfigured: true,
    })).toMatchObject({
      selfServePilotReady: false,
      recurringBillingReady: false,
      customerFlow: {
        pilot: 'saved_request',
        monthly: 'sales_request',
        quarterly: 'sales_request',
      },
      rfProvider: { status: 'blocked', provider: null },
    })
  })

  test('marks only the pilot as self-service when YooKassa is fully configured', () => {
    expect(buildPaymentReadinessReport({
      provider: 'yookassa',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    })).toMatchObject({
      selfServePilotReady: true,
      recurringBillingReady: false,
      customerFlow: {
        pilot: 'self_service_payment',
        monthly: 'sales_request',
        quarterly: 'sales_request',
      },
      rfProvider: { status: 'ready', provider: 'yookassa', blockers: [] },
    })
  })

  test('does not treat Stripe as a Russia-ready provider', () => {
    expect(buildPaymentReadinessReport({
      provider: 'stripe',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    })).toMatchObject({
      selfServePilotReady: false,
      rfProvider: { status: 'blocked', provider: null },
    })
  })

  test('checkout copy does not imply automatic recurring billing', () => {
    const checkoutPage = fs.readFileSync(path.resolve(process.cwd(), 'app/checkout/page.tsx'), 'utf8')
    const payments = fs.readFileSync(path.resolve(process.cwd(), 'lib/payments.ts'), 'utf8')

    expect(checkoutPage).toContain('без автоматического списания')
    expect(checkoutPage).toContain('Оставить заявку')
    expect(checkoutPage).toContain('legalAccepted')
    expect(payments).toContain('Recurring plans must NEVER reach the payment provider')
    expect(payments).toContain('status: "unavailable"')
  })
})
