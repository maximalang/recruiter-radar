import fs from 'node:fs'
import path from 'node:path'

import {
  buildPaymentReadinessReport,
  type MerchantModerationInput,
} from '@/lib/payment-readiness'

const completeMerchant: MerchantModerationInput = {
  supportEmail: 'support@recruiter-radar.ru',
  phone: '+7 900 000-00-00',
  postalAddress: 'Реальный адрес для корреспонденции',
  offerPublished: true,
  privacyPublished: true,
  requisitesPublished: true,
  paymentAndDeliveryPublished: true,
  tariffsPublished: true,
  digitalFulfillmentDescribed: true,
}

function compactSource(value: string): string {
  return value.replace(/\s+/g, ' ')
}

describe('payment readiness', () => {
  test('reports sales-assisted state when no provider is configured', () => {
    expect(buildPaymentReadinessReport({
      provider: null,
      configured: false,
      mode: null,
      webhookConfigured: false,
      siteUrlConfigured: true,
    }, completeMerchant)).toMatchObject({
      selfServePilotReady: false,
      liveLaunchReady: false,
      recurringBillingReady: false,
      customerFlow: {
        pilot: 'saved_request',
        monthly: 'sales_request',
        quarterly: 'sales_request',
      },
      rfProvider: { status: 'blocked', provider: null },
      merchantModeration: { status: 'ready' },
    })
  })

  test('marks the pilot and live launch ready when YooKassa and storefront are complete', () => {
    expect(buildPaymentReadinessReport({
      provider: 'yookassa',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    }, completeMerchant)).toMatchObject({
      selfServePilotReady: true,
      merchantModerationReady: true,
      liveLaunchReady: true,
      recurringBillingReady: false,
      customerFlow: {
        pilot: 'self_service_payment',
        monthly: 'sales_request',
        quarterly: 'sales_request',
      },
      rfProvider: { status: 'ready', provider: 'yookassa', blockers: [] },
      merchantModeration: { status: 'ready', blockers: [] },
      launch: { status: 'ready', blockers: [] },
    })
  })

  test('blocks live launch when public phone or postal address is missing', () => {
    const report = buildPaymentReadinessReport({
      provider: 'yookassa',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    }, {
      ...completeMerchant,
      phone: null,
      postalAddress: null,
    })

    expect(report).toMatchObject({
      selfServePilotReady: true,
      merchantModerationReady: false,
      liveLaunchReady: false,
      merchantModeration: {
        status: 'blocked',
        publicPhoneConfigured: false,
        publicPostalAddressConfigured: false,
      },
      launch: { status: 'blocked' },
    })
    expect(report.merchantModeration.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('support phone'),
      expect.stringContaining('postal/contact address'),
    ]))
  })

  test('does not treat Stripe as a Russia-ready provider', () => {
    expect(buildPaymentReadinessReport({
      provider: 'stripe',
      configured: true,
      mode: 'live',
      webhookConfigured: true,
      siteUrlConfigured: true,
    }, completeMerchant)).toMatchObject({
      selfServePilotReady: false,
      liveLaunchReady: false,
      rfProvider: { status: 'blocked', provider: null },
    })
  })

  test('merchant pages contain tariffs, fulfillment, receipts and refunds', () => {
    const checkoutSource = compactSource(
      fs.readFileSync(path.resolve(process.cwd(), 'app/checkout/page.tsx'), 'utf8'),
    )
    const paymentSource = compactSource(
      fs.readFileSync(path.resolve(process.cwd(), 'app/payment-and-delivery/page.tsx'), 'utf8'),
    )
    const footerSource = compactSource(
      fs.readFileSync(path.resolve(process.cwd(), 'app/ui/site-footer.tsx'), 'utf8'),
    )

    expect(checkoutSource).toContain('без автоматического списания')
    expect(checkoutSource).toContain('Оплатить ${plan.price} через ЮKassa')
    expect(checkoutSource).toContain('legalAccepted')
    expect(paymentSource).toMatch(/Неделя<\/strong>\s*—\s*2 990 ₽/)
    expect(paymentSource).toContain('Физической доставки нет')
    expect(paymentSource).toContain('приложении «Мой налог»')
    expect(paymentSource).toContain('Отмена заказа и возврат')
    expect(footerSource).toContain('/payment-and-delivery')
  })
})
