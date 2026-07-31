import { getPaymentProviderSetupState } from './paymentsProvider'

export type PaymentReadinessReport = {
  provider: 'stripe' | 'yookassa' | null
  mode: 'test' | 'live' | null
  checkoutConfigured: boolean
  webhookConfigured: boolean
  siteUrlConfigured: boolean
  selfServePilotReady: boolean
  recurringBillingReady: false
  rfProvider: {
    status: 'blocked' | 'ready'
    provider: 'yookassa' | null
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
  const yookassaSelected = setup.provider === 'yookassa'
  const selfServePilotReady =
    yookassaSelected && setup.configured && setup.webhookConfigured && setup.siteUrlConfigured
  const blockers: string[] = []

  if (!yookassaSelected) blockers.push('PAYMENTS_PROVIDER must be set to yookassa.')
  if (!setup.configured) blockers.push('YooKassa shop_id and secret key are not configured.')
  if (!setup.webhookConfigured) blockers.push('The public YooKassa webhook URL is not configured.')
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
      status: selfServePilotReady ? 'ready' : 'blocked',
      provider: yookassaSelected ? 'yookassa' : null,
      blockers,
    },
    customerFlow: {
      pilot: selfServePilotReady ? 'self_service_payment' : 'saved_request',
      monthly: 'sales_request',
      quarterly: 'sales_request',
    },
  }
}
