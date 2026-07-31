import { type Pool, type PoolClient } from "pg";

import type { PublicPlan, PublicPlanCode } from "./publicProduct";

export const CHECKOUT_ORDER_STATUSES = [
  "created",
  "pending",
  "paid",
  "refunded",
  "canceled",
  "failed",
  "unavailable"
] as const;

type CheckoutOrderStatusTuple = typeof CHECKOUT_ORDER_STATUSES;
export type CheckoutOrderStatus = CheckoutOrderStatusTuple[number];

export const PILOT_ENTITLEMENT_DAYS = 7;

export const CHECKOUT_ORDER_ONBOARDING_STATUSES = ["inactive", "in_progress", "completed"] as const;
type CheckoutOrderOnboardingStatusTuple = typeof CHECKOUT_ORDER_ONBOARDING_STATUSES;
export type CheckoutOrderOnboardingStatus = CheckoutOrderOnboardingStatusTuple[number];

export const CHECKOUT_ORDER_ONBOARDING_STEPS = ["confirm-profile", "telegram", "preview", "complete"] as const;
type CheckoutOrderOnboardingStepTuple = typeof CHECKOUT_ORDER_ONBOARDING_STEPS;
export type CheckoutOrderOnboardingStep = CheckoutOrderOnboardingStepTuple[number];

export type CheckoutOrderPayload = {
  planName: string;
  planCadence: string;
  specialization: string | null;
  city: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  industries: string[];
  companySizes: string[];
  dailyDigestLimit: number;
  roles: string[];
  excludedIndustries: string[];
  excludedLocations: string[];
  remoteFriendly: boolean;
  comment: string | null;
  legalAcceptedAt?: string | null;
  termsRevision?: string | null;
  privacyRevision?: string | null;
  personalDataConsentRevision?: string | null;
  pilotApplicationId: string | null;
  clientProfileId: string | null;
  onboardingStatus: CheckoutOrderOnboardingStatus;
  onboardingStep: CheckoutOrderOnboardingStep;
  onboardingActivatedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingTestDigestSentAt: string | null;
  onboardingTestDigestTelegramMessageId: string | null;
  customerDigestLastSentAt: string | null;
  customerDigestLastEmptyAt: string | null;
  customerDigestLastFailedAt: string | null;
  paymentMessage: string | null;
  paymentProviderPayload: Record<string, unknown> | null;
};

export type CheckoutOrderRow = {
  id: string;
  productCode: string;
  amountMinor: number;
  currency: string;
  status: string;
  customerName: string | null;
  customerContact: string | null;
  payload: unknown;
  provider: string | null;
  providerPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
};

export type CheckoutOrder = {
  id: string;
  productCode: PublicPlan["code"];
  amountMinor: number;
  currency: string;
  status: CheckoutOrderStatus;
  customerName: string | null;
  customerContact: string | null;
  payload: CheckoutOrderPayload;
  provider: string | null;
  providerPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
};

export type PilotOrderTestDigestResult =
  | { kind: "sent"; order: CheckoutOrder; chatId: string; messageId: number; itemsCount: number }
  | { kind: "empty"; order: CheckoutOrder; itemsCount: 0 };

export type PilotActivationReadiness = {
  profileExists: boolean;
  profileActive: boolean;
  telegramConnected: boolean;
  entitlementActive: boolean;
  canRequestFirstDigest: boolean;
};

export type PaymentCheckoutSessionInput = {
  order: CheckoutOrder;
  successUrl: string;
  cancelUrl: string;
};

export type PaymentCheckoutSessionResult =
  | {
      kind: "redirect";
      provider: string;
      providerPaymentId: string;
      redirectUrl: string;
      payload?: Record<string, unknown> | null;
    }
  | { kind: "unavailable"; provider: string; message: string };

export type VerifiedProviderState = {
  providerPaymentId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  test?: boolean | null;
};

export type PaymentSyncResult = VerifiedProviderState & {
  status: CheckoutOrderStatus;
  paidAt?: string | null;
  payload?: Record<string, unknown> | null;
  message?: string | null;
};

export type PaymentWebhookParseResult = VerifiedProviderState & {
  ok: boolean;
  responseStatus: number;
  responseBody: string;
  orderId?: string | null;
  status?: CheckoutOrderStatus;
  paidAt?: string | null;
  payload?: Record<string, unknown> | null;
  message?: string | null;
};

export type PaymentProviderAdapter = {
  code: string;
  isConfigured(): boolean;
  createCheckoutSession(input: PaymentCheckoutSessionInput): Promise<PaymentCheckoutSessionResult>;
  syncOrderAfterReturn?(input: {
    order: CheckoutOrder;
    providerPaymentId?: string | null;
    searchParams?: Record<string, string | string[] | undefined>;
  }): Promise<PaymentSyncResult | null>;
  parseWebhook?(request: Request): Promise<PaymentWebhookParseResult>;
};

export type PaymentProviderSetupState = {
  provider: "stripe" | "yookassa" | null;
  configured: boolean;
  mode: "test" | "live" | null;
  webhookConfigured: boolean;
  siteUrlConfigured: boolean;
};

export type StartCheckoutOrderInput = {
  userId: string | number;
  productCode: PublicPlan["code"];
  customerName: string;
  customerContact: string;
  specialization?: string | null;
  city?: string | null;
  includeKeywords?: string | null;
  excludeKeywords?: string | null;
  dailyDigestLimit?: number | null;
  comment?: string | null;
  legalAcceptance?: {
    acceptedAt: string;
    termsRevision: string;
    privacyRevision: string;
    personalDataConsentRevision: string;
  } | null;
  siteUrl: string;
};

export type UpdateCheckoutOrderInput = {
  status?: CheckoutOrderStatus;
  provider?: string | null;
  providerPaymentId?: string | null;
  payloadPatch?: Partial<CheckoutOrderPayload> | null;
  paidAt?: string | null;
};

export type StartCheckoutOrderResult =
  | { kind: "redirect"; order: CheckoutOrder; redirectUrl: string }
  | { kind: "unavailable"; order: CheckoutOrder; redirectUrl: string; message: string };

export type PaymentsDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type { PublicPlanCode };
