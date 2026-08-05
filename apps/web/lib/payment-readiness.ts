import { OPERATOR_REQUISITES } from './operatorRequisites'
import { getPaymentProviderSetupState } from './paymentsProvider'
import { getRobokassaRefundSetupState } from './paymentsRobokassaRefunds'
import type { PaymentProviderCode, PaymentProviderSetupState } from './paymentsTypes'

export type PaymentReadinessReport = {
  provider: PaymentProviderCode | null
  mode: 'test' | 'live' | null
  checkoutConfigured: boolean
  webhookConfigured: boolean
  siteUrlConfigured: boolean
  selfServeCheckoutReady: boolean
  /** Backward-compatible alias used by existing health surfaces. */
  selfServePilotReady: boolean
  recurringBillingReady: false
  refundsConfigured: boolean
  npdReceiptsConfigured: boolean
  merchantModerationReady: boolean
  liveLaunchReady: boolean
  integration: {
    status: 'ready' | 'blocked'
    blockers: string[]
  }
  launch: {
    status: 'live-ready' | 'registration-ready' | 'blocked'
    blockers: string[]
  }
  rfProvider: {
    status: 'ready' | 'blocked'
    provider: 'robokassa' | null
    blockers: string[]
  }
  customerFlow: {
    pilot: 'self_service_payment' | 'saved_request'
    monthly: 'self_service_payment' | 'saved_request'
    quarterly: 'self_service_payment' | 'saved_request'
  }
}

export function buildPaymentReadinessReport(
  setup: PaymentProviderSetupState = getPaymentProviderSetupState(),
): PaymentReadinessReport {
  const robokassaSelected = setup.provider === 'robokassa'
  const integrationBlockers: string[] = []

  if (!robokassaSelected) integrationBlockers.push('PAYMENTS_PROVIDER must be set to robokassa.')
  if (!setup.configured) integrationBlockers.push('Robokassa merchant login and test/live Password1/Password2 are not configured.')
  if (!setup.webhookConfigured) integrationBlockers.push('ROBOKASSA_RESULT_URL is not configured.')
  if (!setup.siteUrlConfigured) integrationBlockers.push('PAYMENTS_SITE_URL is not configured.')

  const selfServeCheckoutReady = integrationBlockers.length === 0
  const refundSetup = getRobokassaRefundSetupState()
  const refundsConfigured = refundSetup.configured
  const npdReceiptsConfigured = process.env.ROBOKASSA_SMZ_RECEIPTS_ENABLED?.trim().toLowerCase() === 'true'
  const sellerLocationConfigured = Boolean(OPERATOR_REQUISITES.city || OPERATOR_REQUISITES.postalAddress)
  const merchantModerationReady = selfServeCheckoutReady && sellerLocationConfigured

  const launchBlockers = [...integrationBlockers]
  if (!sellerLocationConfigured) launchBlockers.push('A confirmed seller city or actual correspondence address is required before Robokassa moderation.')
  if (setup.mode !== 'live') launchBlockers.push('ROBOKASSA_MODE must be live for production launch.')
  if (!refundsConfigured) launchBlockers.push('ROBOKASSA_PASSWORD_3 and Refund JWT configuration are required for live refunds.')
  if (!npdReceiptsConfigured) launchBlockers.push('Robocheck SMZ / My Tax receipt integration must be connected and explicitly enabled.')
  if (!isIsoTimestamp(process.env.ROBOKASSA_SITE_CRITERIA_VERIFIED_AT)) launchBlockers.push('Public Robokassa site criteria have not been verified against the deployed origin.')
  if (!isIsoTimestamp(process.env.ROBOKASSA_TEST_FLOW_VERIFIED_AT)) launchBlockers.push('A real Robokassa test payment flow has not been verified.')
  if (!isIsoTimestamp(process.env.ROBOKASSA_REFUND_FLOW_VERIFIED_AT)) launchBlockers.push('The Robokassa full/partial refund flow has not been verified.')
  if (!isIsoTimestamp(process.env.ROBOKASSA_NPD_RECEIPT_FLOW_VERIFIED_AT)) launchBlockers.push('The NPD receipt issue/correction flow has not been verified.')
  if (!isIsoTimestamp(process.env.PDN_OPERATOR_NOTIFICATION_VERIFIED_AT)) launchBlockers.push('The applicable Roskomnadzor operator notification has not been verified.')
  if (!isIsoTimestamp(process.env.PDN_LOCALIZATION_VERIFIED_AT)) launchBlockers.push('Russian primary-database localization has not been verified.')
  if (!isIsoTimestamp(process.env.PDN_PROCESSORS_VERIFIED_AT)) launchBlockers.push('Processor agreements and public disclosure have not been verified.')
  if (process.env.TELEGRAM_BOT_TOKEN?.trim() && !isIsoTimestamp(process.env.PDN_CROSS_BORDER_VERIFIED_AT)) {
    launchBlockers.push('Telegram cross-border transfer prerequisites have not been verified.')
  }
  if (!isIsoTimestamp(process.env.PDN_COMPLIANCE_VERIFIED_AT)) launchBlockers.push('The complete personal-data compliance review has not been signed off.')
  if (!isIsoTimestamp(process.env.ROBOKASSA_LIVE_FLOW_VERIFIED_AT)) launchBlockers.push('A live control payment and refund have not been verified.')

  const liveLaunchReady = launchBlockers.length === 0
  const customerFlow = selfServeCheckoutReady ? 'self_service_payment' : 'saved_request'

  return {
    provider: setup.provider,
    mode: setup.mode,
    checkoutConfigured: setup.configured,
    webhookConfigured: setup.webhookConfigured,
    siteUrlConfigured: setup.siteUrlConfigured,
    selfServeCheckoutReady,
    selfServePilotReady: selfServeCheckoutReady,
    recurringBillingReady: false,
    refundsConfigured,
    npdReceiptsConfigured,
    merchantModerationReady,
    liveLaunchReady,
    integration: {
      status: selfServeCheckoutReady ? 'ready' : 'blocked',
      blockers: integrationBlockers,
    },
    launch: {
      status: liveLaunchReady ? 'live-ready' : merchantModerationReady ? 'registration-ready' : 'blocked',
      blockers: launchBlockers,
    },
    rfProvider: {
      status: selfServeCheckoutReady ? 'ready' : 'blocked',
      provider: robokassaSelected ? 'robokassa' : null,
      blockers: integrationBlockers,
    },
    customerFlow: {
      pilot: customerFlow,
      monthly: customerFlow,
      quarterly: customerFlow,
    },
  }
}

function isIsoTimestamp(value: string | undefined): boolean {
  const normalized = value?.trim()
  if (!normalized) return false
  const parsed = new Date(normalized)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === normalized
}
