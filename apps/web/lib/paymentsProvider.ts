import { createStripePaymentAdapter, getStripePaymentSetupState } from "./paymentsStripe";
import { createYooKassaPaymentAdapter, getYooKassaPaymentSetupState } from "./paymentsYookassa";
import { normalizeOptionalText } from "./paymentsNormalize";
import { type PaymentProviderAdapter, type PaymentProviderSetupState } from "./paymentsTypes";

export function getPaymentProviderSetupState(): PaymentProviderSetupState {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");

  if (providerCode === "yookassa") {
    const setup = getYooKassaPaymentSetupState();
    return {
      provider: "yookassa",
      configured: setup.checkoutConfigured,
      mode: setup.mode,
      webhookConfigured: setup.webhookConfigured,
      siteUrlConfigured: setup.siteUrlConfigured,
    };
  }

  if (providerCode === "stripe") {
    const setup = getStripePaymentSetupState();
    return {
      provider: "stripe",
      configured: setup.checkoutConfigured,
      mode: setup.mode,
      webhookConfigured: setup.webhookConfigured,
      siteUrlConfigured: normalizeOptionalText(process.env.PAYMENTS_SITE_URL) !== null,
    };
  }

  return { provider: null, configured: false, mode: null, webhookConfigured: false, siteUrlConfigured: false };
}

export function getConfiguredPaymentProvider(): PaymentProviderAdapter | null {
  return getPaymentProvider(normalizeOptionalText(process.env.PAYMENTS_PROVIDER));
}

export function getPaymentProvider(providerCode: string | null): PaymentProviderAdapter | null {
  const normalized = normalizeOptionalText(providerCode)?.toLocaleLowerCase("en-US");
  if (normalized === "yookassa") return createYooKassaPaymentAdapter();
  if (normalized === "stripe") return createStripePaymentAdapter();
  return null;
}
