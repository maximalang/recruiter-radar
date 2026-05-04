import type {
  PaymentCheckoutSessionInput,
  PaymentCheckoutSessionResult,
  PaymentProviderAdapter
} from "./payments";

export type StripePaymentSetupState = {
  checkoutConfigured: boolean;
  mode: "test" | "live" | null;
  webhookConfigured: boolean;
};

export function getStripePaymentSetupState(): StripePaymentSetupState {
  return {
    checkoutConfigured: false,
    mode: null,
    webhookConfigured: false
  };
}

export function createStripePaymentAdapter(): PaymentProviderAdapter {
  return {
    code: "stripe",
    isConfigured() {
      return false;
    },
    async createCheckoutSession(
      input: PaymentCheckoutSessionInput
    ): Promise<PaymentCheckoutSessionResult> {
      void input;

      return {
        kind: "unavailable",
        provider: "stripe",
        message: "Stripe checkout is not configured."
      };
    }
  };
}
