import { getPaymentProviderSetupState } from './paymentsProvider'

export type PaymentReadinessReport = {
  provider: 'stripe' | null
  mode: 'test' | 'live' | null
  checkoutConfigured: boolean
  webhookConfigured: boolean
  siteUrlConfigured: boolean
  selfServePilotReady: boolean
  recurringBillingReady: false
  rfProvider: {
    status: 'blocked'
    provider: null
    blockers: string[]
  }
  customerFlow: {
    pilot: 'self_service_payment' | 'saved_request'
    monthly: 'sales_request'
    quarterly: 'sales_request'
  }
}

export function buildPaymentReadinessReport(
  setup = getPaymentProviderSetupState(),
): PaymentReadinessReport {
  const selfServePilotReady =
    setup.configured && setup.webhookConfigured && setup.siteUrlConfigured

  return {
    provider: setup.provider,
    mode: setup.mode,
    checkoutConfigured: setup.configured,
    webhookConfigured: setup.webhookConfigured,
    siteUrlConfigured: setup.siteUrlConfigured,
    selfServePilotReady,
    recurringBillingReady: false,
    rfProvider: {
      status: 'blocked',
      provider: null,
      blockers: [
        'RF payment provider has not been selected and implemented.',
        'Production merchant credentials and sandbox/live webhook verification are absent from application code.',
        'Receipt, refund, cancellation and accounting requirements need provider-specific legal review.',
      ],
    },
    customerFlow: {
      pilot: selfServePilotReady ? 'self_service_payment' : 'saved_request',
      monthly: 'sales_request',
      quarterly: 'sales_request',
    },
  }
}
