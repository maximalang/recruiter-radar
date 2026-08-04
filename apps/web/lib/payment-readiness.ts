import { getPaymentProviderSetupState } from './paymentsProvider'
import type { PaymentProviderCode } from './paymentsTypes'

export type PaymentReadinessReport = {
  provider: PaymentProviderCode | null
  mode: 'test' | 'live' | null
  checkoutConfigured: boolean
  webhookConfigured: boolean
  siteUrlConfigured: boolean
  selfServePilotReady: boolean
  recurringBillingReady: false
  rfProvider: {
    status: 'ready' | 'blocked'
    provider: 'robokassa' | null
    blockers: string[]
  }
  customerFlow: {
    pilot: 'self_service_payment' | 'saved_request'
    monthly: 'self_service_payment' | 'sales_request'
    quarterly: 'self_service_payment' | 'sales_request'
  }
}

export function buildPaymentReadinessReport(
  setup = getPaymentProviderSetupState(),
): PaymentReadinessReport {
  const robokassaSelected = setup.provider === 'robokassa'
  const selfServePilotReady =
    robokassaSelected && setup.configured && setup.webhookConfigured && setup.siteUrlConfigured
  const blockers: string[] = []

  if (!robokassaSelected) blockers.push('PAYMENTS_PROVIDER must be set to robokassa.')
  if (!setup.configured) blockers.push('Robokassa merchant login and test/live passwords are not configured.')
  if (!setup.webhookConfigured) blockers.push('ROBOKASSA_RESULT_URL is not configured.')
  if (!setup.siteUrlConfigured) blockers.push('PAYMENTS_SITE_URL is not configured.')

  return {
    provider: setup.provider,
    mode: setup.mode,
    checkoutConfigured: setup.configured,
    webhookConfigured: setup.webhookConfigured,
    siteUrlConfigured: setup.siteUrlConfigured,
    selfServePilotReady,
    recurringBillingReady: false,
    rfProvider: {
      status: blockers.length === 0 ? 'ready' : 'blocked',
      provider: robokassaSelected ? 'robokassa' : null,
      blockers,
    },
    customerFlow: {
      pilot: selfServePilotReady ? 'self_service_payment' : 'saved_request',
      monthly: 'sales_request',
      quarterly: 'sales_request',
    },
  }
}
