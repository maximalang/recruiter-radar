import {
  createRobokassaPaymentAdapter,
  getRobokassaPaymentSetupState,
} from "./paymentsRobokassa";
import {
  createStripePaymentAdapter,
  getStripePaymentSetupState,
} from "./paymentsStripe";
import { normalizeOptionalText } from "./paymentsNormalize";
import type {
  PaymentProviderAdapter,
  PaymentProviderSetupState,
} from "./paymentsTypes";

export function getPaymentProviderSetupState(): PaymentProviderSetupState {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");
  const siteUrlConfigured = normalizeOptionalText(process.env.PAYMENTS_SITE_URL) !== null;

  if (providerCode === "robokassa") {
    const setup = getRobokassaPaymentSetupState();
    return {
      provider: "robokassa",
      configured: setup.checkoutConfigured,
      mode: setup.mode,
      webhookConfigured: setup.webhookConfigured,
      siteUrlConfigured,
    };
  }

  if (providerCode === "stripe") {
    const setup = getStripePaymentSetupState();
    return {
      provider: "stripe",
      configured: setup.checkoutConfigured,
      mode: setup.mode,
      webhookConfigured: setup.webhookConfigured,
      siteUrlConfigured,
    };
  }

  return {
    provider: providerCode === "yookassa" ? "yookassa" : null,
    configured: false,
    mode: null,
    webhookConfigured: false,
    siteUrlConfigured,
  };
}

export function getConfiguredPaymentProvider(): PaymentProviderAdapter | null {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");
  if (providerCode === "robokassa") return createRobokassaPaymentAdapter();
  if (providerCode === "stripe") return createStripePaymentAdapter();
  return null;
}

export function getPaymentProvider(providerCode: string | null): PaymentProviderAdapter | null {
  const normalized = normalizeOptionalText(providerCode)?.toLocaleLowerCase("en-US");
  if (normalized === "robokassa") return createRobokassaPaymentAdapter();
  if (normalized === "stripe") return createStripePaymentAdapter();
  return null;
}
