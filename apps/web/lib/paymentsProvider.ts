import {
  createStripePaymentAdapter,
  getStripePaymentSetupState
} from "./paymentsStripe";
import {
  createYooKassaPaymentAdapter,
  getYooKassaPaymentSetupState
} from "./paymentsYookassa";
import { normalizeOptionalText } from "./paymentsNormalize";
import {
  type PaymentProviderAdapter,
  type PaymentProviderSetupState
} from "./paymentsTypes";

export function getPaymentProviderSetupState(): PaymentProviderSetupState {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");
  const siteUrlConfigured = normalizeOptionalText(process.env.PAYMENTS_SITE_URL) !== null;

  if (providerCode === "yookassa") {
    const yookassaSetup = getYooKassaPaymentSetupState();

    return {
      provider: "yookassa",
      configured: yookassaSetup.checkoutConfigured,
      mode: yookassaSetup.mode,
      webhookConfigured: yookassaSetup.webhookConfigured,
      siteUrlConfigured
    };
  }

  if (providerCode === "stripe") {
    const stripeSetup = getStripePaymentSetupState();

    return {
      provider: "stripe",
      configured: stripeSetup.checkoutConfigured,
      mode: stripeSetup.mode,
      webhookConfigured: stripeSetup.webhookConfigured,
      siteUrlConfigured
    };
  }

  return {
    provider: null,
    configured: false,
    mode: null,
    webhookConfigured: false,
    siteUrlConfigured
  };
}

export function getConfiguredPaymentProvider(): PaymentProviderAdapter | null {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");

  if (providerCode === "yookassa") {
    return createYooKassaPaymentAdapter();
  }

  if (providerCode === "stripe") {
    return createStripePaymentAdapter();
  }

  return null;
}

export function getPaymentProvider(providerCode: string | null): PaymentProviderAdapter | null {
  const normalizedProviderCode = normalizeOptionalText(providerCode)?.toLocaleLowerCase("en-US");

  if (!normalizedProviderCode) {
    return null;
  }

  if (normalizedProviderCode === "yookassa") {
    return createYooKassaPaymentAdapter();
  }

  if (normalizedProviderCode === "stripe") {
    return createStripePaymentAdapter();
  }

  return null;
}
