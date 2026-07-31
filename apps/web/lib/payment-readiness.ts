import { OPERATOR_REQUISITES } from './operatorRequisites'
import { getPaymentProviderSetupState } from './paymentsProvider'

export type MerchantModerationInput = {
  supportEmail: string | null
  phone: string | null
  postalAddress: string | null
  offerPublished: boolean
  privacyPublished: boolean
  requisitesPublished: boolean
  paymentAndDeliveryPublished: boolean
  tariffsPublished: boolean
  digitalFulfillmentDescribed: boolean
}

export type PaymentReadinessReport = {
  provider: 'stripe' | 'yookassa' | null
  mode: 'test' | 'live' | null
  checkoutConfigured: boolean
  webhookConfigured: boolean
  siteUrlConfigured: boolean
  selfServePilotReady: boolean
  merchantModerationReady: boolean
  liveLaunchReady: boolean
  recurringBillingReady: false
  rfProvider: {
    status: 'blocked' | 'ready'
    provider: 'yookassa' | null
    blockers: string[]
  }
  merchantModeration: {
    status: 'blocked' | 'ready'
    publicSupportEmailConfigured: boolean
    publicPhoneConfigured: boolean
    publicPostalAddressConfigured: boolean
    requiredPagesPublished: boolean
    tariffsPublished: boolean
    digitalFulfillmentDescribed: boolean
    blockers: string[]
  }
  launch: {
    status: 'blocked' | 'ready'
    blockers: string[]
  }
  customerFlow: {
    pilot: 'self_service_payment' | 'saved_request'
    monthly: 'sales_request'
    quarterly: 'sales_request'
  }
}

export function getMerchantModerationInput(): MerchantModerationInput {
  return {
    supportEmail: OPERATOR_REQUISITES.email,
    phone: OPERATOR_REQUISITES.phone,
    postalAddress: OPERATOR_REQUISITES.postalAddress,
    offerPublished: true,
    privacyPublished: true,
    requisitesPublished: true,
    paymentAndDeliveryPublished: true,
    tariffsPublished: true,
    digitalFulfillmentDescribed: true,
  }
}

export function buildPaymentReadinessReport(
  setup = getPaymentProviderSetupState(),
  merchant = getMerchantModerationInput(),
): PaymentReadinessReport {
  const yookassaSelected = setup.provider === 'yookassa'
  const selfServePilotReady =
    yookassaSelected && setup.configured && setup.webhookConfigured && setup.siteUrlConfigured
  const providerBlockers: string[] = []

  if (!yookassaSelected) providerBlockers.push('PAYMENTS_PROVIDER must be set to yookassa.')
  if (!setup.configured) providerBlockers.push('YooKassa shop_id and secret key are not configured.')
  if (!setup.webhookConfigured) providerBlockers.push('The public YooKassa webhook URL is not configured.')
  if (!setup.siteUrlConfigured) providerBlockers.push('PAYMENTS_SITE_URL is not configured.')

  const publicSupportEmailConfigured = isPublicSupportEmail(merchant.supportEmail)
  const publicPhoneConfigured = Boolean(merchant.phone?.trim())
  const publicPostalAddressConfigured = Boolean(merchant.postalAddress?.trim())
  const requiredPagesPublished =
    merchant.offerPublished &&
    merchant.privacyPublished &&
    merchant.requisitesPublished &&
    merchant.paymentAndDeliveryPublished
  const merchantBlockers: string[] = []

  if (!publicSupportEmailConfigured) {
    merchantBlockers.push('A real public support email on recruiter-radar.ru is required.')
  }
  if (!publicPhoneConfigured) {
    merchantBlockers.push('A real public support phone is required for YooKassa site moderation.')
  }
  if (!publicPostalAddressConfigured) {
    merchantBlockers.push('A real public postal/contact address is required for YooKassa site moderation.')
  }
  if (!requiredPagesPublished) {
    merchantBlockers.push('Offer, privacy, requisites, and payment/delivery pages must be public.')
  }
  if (!merchant.tariffsPublished) {
    merchantBlockers.push('Real service tariffs and prices must be published.')
  }
  if (!merchant.digitalFulfillmentDescribed) {
    merchantBlockers.push('The digital service fulfillment process must be described.')
  }

  const merchantModerationReady = merchantBlockers.length === 0
  const liveLaunchBlockers = [...providerBlockers, ...merchantBlockers]
  if (setup.mode !== 'live') {
    liveLaunchBlockers.push('YOOKASSA_MODE must be live before production launch.')
  }
  const liveLaunchReady = selfServePilotReady && merchantModerationReady && setup.mode === 'live'

  return {
    provider: setup.provider,
    mode: setup.mode,
    checkoutConfigured: setup.configured,
    webhookConfigured: setup.webhookConfigured,
    siteUrlConfigured: setup.siteUrlConfigured,
    selfServePilotReady,
    merchantModerationReady,
    liveLaunchReady,
    recurringBillingReady: false,
    rfProvider: {
      status: selfServePilotReady ? 'ready' : 'blocked',
      provider: yookassaSelected ? 'yookassa' : null,
      blockers: providerBlockers,
    },
    merchantModeration: {
      status: merchantModerationReady ? 'ready' : 'blocked',
      publicSupportEmailConfigured,
      publicPhoneConfigured,
      publicPostalAddressConfigured,
      requiredPagesPublished,
      tariffsPublished: merchant.tariffsPublished,
      digitalFulfillmentDescribed: merchant.digitalFulfillmentDescribed,
      blockers: merchantBlockers,
    },
    launch: {
      status: liveLaunchReady ? 'ready' : 'blocked',
      blockers: liveLaunchBlockers,
    },
    customerFlow: {
      pilot: selfServePilotReady ? 'self_service_payment' : 'saved_request',
      monthly: 'sales_request',
      quarterly: 'sales_request',
    },
  }
}

function isPublicSupportEmail(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) &&
    !normalized.endsWith('@example.com') &&
    normalized.endsWith('@recruiter-radar.ru')
}
