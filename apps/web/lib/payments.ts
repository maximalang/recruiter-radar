import { Pool, type PoolClient } from "pg";

import {
  createPilotApplication,
  findMatchingClientProfileForCheckoutOrder,
  getClientProfileById,
  parseKeywordText,
  saveClientProfile,
  type ClientProfile
} from "./clientProfiles";
import { runDigestForClientProfile, type DigestItem } from "./digest";
import { buildHhDigestText, type HhDigestItem } from "./hhDigest";
import {
  buildCheckoutHref,
  buildPilotApplicationComment,
  getPublicPlanByCode,
  type PublicPlan
} from "./publicProduct";
import {
  createStripePaymentAdapter,
  getStripePaymentSetupState
} from "./paymentsStripe";
import {
  CUSTOMER_CHECKOUT_COPY,
  humanizeCustomerDeliveryIssue
} from "./copy/customer";
import { getTelegramBotToken, sendTelegramTextMessage } from "./telegram";
import { buildTelegramDigestFeedbackReplyMarkup } from "./telegramDigestFeedback";
import { recordClientProfileDigestShownOutcomes } from "./clientProfileSignalOutcomes";

const CHECKOUT_ORDER_STATUSES = [
  "created",
  "pending",
  "paid",
  "canceled",
  "failed",
  "unavailable"
] as const;

type CheckoutOrderStatusTuple = typeof CHECKOUT_ORDER_STATUSES;
const PILOT_ENTITLEMENT_DAYS = 30;


export type CheckoutOrderStatus = CheckoutOrderStatusTuple[number];

const CHECKOUT_ORDER_ONBOARDING_STATUSES = [
  "inactive",
  "in_progress",
  "completed"
] as const;

type CheckoutOrderOnboardingStatusTuple = typeof CHECKOUT_ORDER_ONBOARDING_STATUSES;

export type CheckoutOrderOnboardingStatus = CheckoutOrderOnboardingStatusTuple[number];

const CHECKOUT_ORDER_ONBOARDING_STEPS = [
  "confirm-profile",
  "telegram",
  "preview",
  "complete"
] as const;

type CheckoutOrderOnboardingStepTuple = typeof CHECKOUT_ORDER_ONBOARDING_STEPS;

export type CheckoutOrderOnboardingStep = CheckoutOrderOnboardingStepTuple[number];

export type CheckoutOrderPayload = {
  planName: string;
  planCadence: string;
  specialization: string | null;
  city: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  dailyDigestLimit: number;
  comment: string | null;
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

type CheckoutOrderRow = {
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
  | {
      kind: "sent";
      order: CheckoutOrder;
      chatId: string;
      messageId: number;
      itemsCount: number;
    }
  | {
      kind: "empty";
      order: CheckoutOrder;
      itemsCount: 0;
    };

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
  | {
      kind: "unavailable";
      provider: string;
      message: string;
    };

export type PaymentSyncResult = {
  status: CheckoutOrderStatus;
  providerPaymentId?: string | null;
  paidAt?: string | null;
  payload?: Record<string, unknown> | null;
  message?: string | null;
};

export type PaymentWebhookParseResult = {
  ok: boolean;
  responseStatus: number;
  responseBody: string;
  orderId?: string | null;
  providerPaymentId?: string | null;
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
  provider: "stripe" | null;
  configured: boolean;
  mode: "test" | "live" | null;
  webhookConfigured: boolean;
  siteUrlConfigured: boolean;
};

type StartCheckoutOrderInput = {
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
  siteUrl: string;
};

type UpdateCheckoutOrderInput = {
  status?: CheckoutOrderStatus;
  provider?: string | null;
  providerPaymentId?: string | null;
  payloadPatch?: Partial<CheckoutOrderPayload> | null;
  paidAt?: string | null;
};

type StartCheckoutOrderResult =
  | {
      kind: "redirect";
      order: CheckoutOrder;
      redirectUrl: string;
    }
  | {
      kind: "unavailable";
      order: CheckoutOrder;
      redirectUrl: string;
      message: string;
    };

type PaymentsDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarPaymentsPool?: Pool;
};

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarPaymentsPool) {
    globalForPg.recruiterRadarPaymentsPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarPaymentsPool;
}

export function getPaymentProviderSetupState(): PaymentProviderSetupState {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");
  const siteUrlConfigured = normalizeOptionalText(process.env.PAYMENTS_SITE_URL) !== null;

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

export async function startCheckoutOrder(input: StartCheckoutOrderInput): Promise<StartCheckoutOrderResult> {
  const checkoutOwnerId = normalizeCheckoutOrderUserId(input.userId);
  const plan = getPublicPlanByCode(input.productCode);
  let order = await createCheckoutOrder({
    userId: checkoutOwnerId,
    productCode: input.productCode,
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    customerName: input.customerName,
    customerContact: input.customerContact,
    payload: {
      planName: plan.name,
      planCadence: plan.cadence,
      specialization: normalizeOptionalText(input.specialization),
      city: normalizeOptionalText(input.city),
      includeKeywords: parseKeywordText(input.includeKeywords),
      excludeKeywords: parseKeywordText(input.excludeKeywords),
      dailyDigestLimit: normalizeDailyDigestLimit(input.dailyDigestLimit),
      comment: normalizeOptionalText(input.comment),
      pilotApplicationId: null,
      clientProfileId: null,
      onboardingStatus: "inactive",
      onboardingStep: "confirm-profile",
      onboardingActivatedAt: null,
      onboardingCompletedAt: null,
      onboardingTestDigestSentAt: null,
      onboardingTestDigestTelegramMessageId: null,
      customerDigestLastSentAt: null,
      customerDigestLastEmptyAt: null,
      customerDigestLastFailedAt: null,
      paymentMessage: null,
      paymentProviderPayload: null
    }
  });

  const provider = getConfiguredPaymentProvider();
  const successUrl = `${normalizeSiteUrl(input.siteUrl)}/checkout/order/${order.id}/success`;
  const cancelUrl = `${normalizeSiteUrl(input.siteUrl)}/checkout/order/${order.id}/cancel`;

  if (!provider || !provider.isConfigured()) {
    order = await updateCheckoutOrder(order.id, {
      status: "unavailable",
      payloadPatch: {
        paymentMessage: "Оплата пока недоступна. Заявка сохранена, и к ней можно вернуться позже."
      }
    });
    order = await ensurePilotApplicationForOrder(order);

    return {
      kind: "unavailable",
      order,
      redirectUrl: `${cancelUrl}?reason=payment-unavailable`,
      message: "Оплата пока недоступна."
    };
  }

  try {
    const checkoutSession = await provider.createCheckoutSession({
      order,
      successUrl,
      cancelUrl
    });

    if (checkoutSession.kind === "unavailable") {
      order = await updateCheckoutOrder(order.id, {
        status: "unavailable",
        payloadPatch: {
          paymentMessage: checkoutSession.message
        }
      });
      order = await ensurePilotApplicationForOrder(order);

      return {
        kind: "unavailable",
        order,
        redirectUrl: `${cancelUrl}?reason=payment-unavailable`,
        message: checkoutSession.message
      };
    }

    order = await updateCheckoutOrder(order.id, {
      status: "pending",
      provider: checkoutSession.provider,
      providerPaymentId: checkoutSession.providerPaymentId,
      payloadPatch: {
        paymentMessage: null,
        paymentProviderPayload: checkoutSession.payload ?? null
      }
    });

    return {
      kind: "redirect",
      order,
      redirectUrl: checkoutSession.redirectUrl
    };
  } catch (error) {
    order = await updateCheckoutOrder(order.id, {
      status: "failed",
      payloadPatch: {
        paymentMessage: getErrorMessage(error)
      }
    });

    return {
      kind: "unavailable",
      order,
      redirectUrl: `${cancelUrl}?reason=payment-error`,
      message: getErrorMessage(error)
    };
  }
}

export async function getCheckoutOrderById(
  orderId: string | number,
  db?: PaymentsDbClient
): Promise<CheckoutOrder | null> {
  const normalizedOrderId = normalizeCheckoutOrderId(orderId);
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<CheckoutOrderRow>(`
    SELECT
      id::TEXT AS id,
      plan_code AS "productCode",
      (amount_rub * 100) AS "amountMinor",
      currency,
      status,
      customer_name AS "customerName",
      customer_contact AS "customerContact",
      payload,
      provider,
      provider_payment_id AS "providerPaymentId",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      paid_at::TEXT AS "paidAt"
    FROM checkout_orders
    WHERE id = $1
  `, [normalizedOrderId]);

  return result.rowCount === 1 ? mapCheckoutOrderRow(result.rows[0]) : null;
}


async function getCheckoutOrderByIdForOwner(
  orderId: string | number,
  ownerId: string | number
): Promise<CheckoutOrder | null> {
  const normalizedOrderId = normalizeCheckoutOrderId(orderId);
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<CheckoutOrderRow>(`
    SELECT
      id::TEXT AS id,
      plan_code AS "productCode",
      (amount_rub * 100) AS "amountMinor",
      currency,
      status,
      customer_name AS "customerName",
      customer_contact AS "customerContact",
      payload,
      provider,
      provider_payment_id AS "providerPaymentId",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      paid_at::TEXT AS "paidAt"
    FROM checkout_orders
    WHERE id = $1 AND user_id::TEXT = $2
    LIMIT 1
  `, [normalizedOrderId, String(ownerId)]);

  return result.rowCount === 1 ? mapCheckoutOrderRow(result.rows[0]) : null;
}
export async function ensurePilotOrderOnboardingReady(
  orderId: string | number,
  options?: { ownerId?: string | number | null }
): Promise<CheckoutOrder | null> {
  const normalizedOwnerId = options?.ownerId == null ? null : normalizeCheckoutOrderUserId(options.ownerId);
  const order = normalizedOwnerId
    ? await getCheckoutOrderByIdForOwner(orderId, normalizedOwnerId)
    : await getCheckoutOrderById(orderId);

  if (!order) {
    return null;
  }

  return ensurePaidPilotOrderReady(order);
}

export async function getPilotActivationReadiness(
  orderId: string | number
): Promise<PilotActivationReadiness | null> {
  const order = await ensurePilotOrderOnboardingReady(orderId);

  if (!order || order.productCode !== "pilot") {
    return null;
  }

  const profile = order.payload.clientProfileId
    ? await getClientProfileById(order.payload.clientProfileId).catch(() => null)
    : null;
  const profileExists = profile !== null;
  const profileActive = profile?.isActive === true;
  const telegramConnected = Boolean(profile?.telegramChatId);
  const entitlementActive = order.status === "paid";

  return {
    profileExists,
    profileActive,
    telegramConnected,
    entitlementActive,
    canRequestFirstDigest: profileExists && profileActive && telegramConnected && entitlementActive
  };
}

export async function confirmPilotOrderProfile(input: {
  orderId: string | number;
  agencyName: string;
  targetCity?: string | null;
  specialization?: string | null;
  includeKeywords?: readonly string[] | null;
  excludeKeywords?: readonly string[] | null;
  dailyDigestLimit?: number | null;
  ownerId?: string | number | null;
}): Promise<CheckoutOrder> {
  let order = await ensurePilotOrderOnboardingReady(input.orderId, { ownerId: input.ownerId });

  if (!order) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.orderNotFound);
  }

  if (order.productCode !== "pilot") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.pilotOnly);
  }

  if (order.status !== "paid") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.paidOnly);
  }

  const profile = await getRequiredOrderClientProfile(order);
  const savedProfile = await saveClientProfile({
    id: profile.id,
    agencyName: normalizeRequiredText(input.agencyName, "Укажите название."),
    telegramChatId: profile.telegramChatId,
    targetCity: normalizeOptionalText(input.targetCity),
    specialization: normalizeOptionalText(input.specialization),
    includeKeywords: normalizeKeywordList(input.includeKeywords),
    excludeKeywords: normalizeKeywordList(input.excludeKeywords),
    dailyDigestLimit: normalizeDailyDigestLimit(input.dailyDigestLimit),
    isActive: true
  });

  order = await updateCheckoutOrder(order.id, {
    payloadPatch: {
      clientProfileId: savedProfile.id,
      specialization: savedProfile.specialization,
      city: savedProfile.targetCity,
      includeKeywords: savedProfile.includeKeywords,
      excludeKeywords: savedProfile.excludeKeywords,
      dailyDigestLimit: savedProfile.dailyDigestLimit,
      onboardingStatus: "in_progress",
      onboardingStep: savedProfile.telegramChatId ? "preview" : "telegram",
      onboardingActivatedAt: order.payload.onboardingActivatedAt ?? new Date().toISOString(),
      onboardingCompletedAt: null
    }
  });

  return order;
}

export async function savePilotOrderTelegramChat(input: {
  orderId: string | number;
  telegramChatId: string;
  expectedClientProfileId?: string | number | null;
  db?: PaymentsDbClient;
}): Promise<CheckoutOrder> {
  let order = await getCheckoutOrderById(input.orderId, input.db);

  if (!order) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.orderNotFound);
  }

  order = await ensurePaidPilotOrderReady(order, input.db);

  if (order.productCode !== "pilot") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.pilotOnly);
  }

  if (order.status !== "paid") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.paidOnly);
  }

  const profile = await getRequiredOrderClientProfile(order, input.db);

  if (
    input.expectedClientProfileId != null &&
    profile.id !== String(normalizeLinkedClientProfileId(input.expectedClientProfileId))
  ) {
    throw new Error("Telegram connect token does not match the linked client profile.");
  }

  const savedProfile = await saveClientProfile({
    id: profile.id,
    agencyName: profile.agencyName,
    telegramChatId: normalizeRequiredText(input.telegramChatId, "Telegram chat id is required."),
    targetCity: profile.targetCity,
    specialization: profile.specialization,
    includeKeywords: profile.includeKeywords,
    excludeKeywords: profile.excludeKeywords,
    dailyDigestLimit: profile.dailyDigestLimit,
    isActive: true
  }, input.db);

  const nextOnboardingStatus =
    order.payload.onboardingStatus === "completed" ? "completed" : "in_progress";
  const nextOnboardingStep = nextOnboardingStatus === "completed" ? "complete" : "preview";

  order = await updateCheckoutOrder(order.id, {
    payloadPatch: {
      clientProfileId: savedProfile.id,
      onboardingStatus: nextOnboardingStatus,
      onboardingStep: nextOnboardingStep,
      onboardingActivatedAt: order.payload.onboardingActivatedAt ?? new Date().toISOString(),
      onboardingCompletedAt:
        nextOnboardingStatus === "completed"
          ? order.payload.onboardingCompletedAt ?? new Date().toISOString()
          : null
    }
  }, input.db);

  return order;
}

export async function sendPilotOrderTestDigest(
  orderId: string | number,
  options?: { ownerId?: string | number | null }
): Promise<PilotOrderTestDigestResult> {
  let order = await ensurePilotOrderOnboardingReady(orderId, { ownerId: options?.ownerId });

  if (!order) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.orderNotFound);
  }

  if (order.productCode !== "pilot") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.pilotOnly);
  }

  if (order.status !== "paid") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.paidOnly);
  }

  const profile = await getRequiredOrderClientProfile(order);

  if (!profile.telegramChatId) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.connectTelegramFirst);
  }

  const digestRun = await runDigestForClientProfile({
    clientProfileId: profile.id,
    sourceKey: "telegram",
    limit: profile.dailyDigestLimit
  });
  const items = digestRun.items.map(mapDigestItemToTelegramDigestItem);

  if (items.length === 0) {
    order = await updateCheckoutOrder(order.id, {
      payloadPatch: {
        customerDigestLastEmptyAt: new Date().toISOString()
      }
    });

    return {
      kind: "empty",
      order,
      itemsCount: 0
    };
  }

  const { botToken, error } = getTelegramBotToken();
  const telegramConfigMessage =
    humanizeCustomerDeliveryIssue(error) ?? CUSTOMER_CHECKOUT_COPY.telegramNotConfigured;

  if (!botToken) {
    await updateCheckoutOrder(order.id, {
      payloadPatch: {
        customerDigestLastFailedAt: new Date().toISOString()
      }
    });

    throw new Error(telegramConfigMessage);
  }

  const digestText = buildHhDigestText(items);
  const replyMarkup = buildTelegramDigestFeedbackReplyMarkup({
    clientProfileId: profile.id,
    items
  });

  try {
    const telegramResult = await sendTelegramTextMessage(digestText, {
      botToken,
      chatId: profile.telegramChatId
    }, {
      replyMarkup
    });
    const sentAt = new Date().toISOString();

    try {
      await recordClientProfileDigestShownOutcomes({
        clientProfileId: profile.id,
        deliveryKind: "onboarding_test_digest",
        items,
        pipelineRunId: digestRun.run.id,
        messageId: telegramResult.messageId,
        feedbackSource: "telegram"
      });
    } catch (error) {
      console.error("Failed to record shown onboarding digest items.", error);
    }

    order = await updateCheckoutOrder(order.id, {
      payloadPatch: {
        clientProfileId: profile.id,
        onboardingStatus: "completed",
        onboardingStep: "complete",
        onboardingActivatedAt: order.payload.onboardingActivatedAt ?? sentAt,
        onboardingCompletedAt: sentAt,
        onboardingTestDigestSentAt: sentAt,
        onboardingTestDigestTelegramMessageId: String(telegramResult.messageId),
        customerDigestLastSentAt: sentAt
      }
    });

    return {
      kind: "sent",
      order,
      chatId: telegramResult.chatId,
      messageId: telegramResult.messageId,
      itemsCount: items.length
    };
  } catch (error) {
    const message = humanizeCustomerDeliveryIssue(
      error instanceof Error ? error.message : null
    ) ?? CUSTOMER_CHECKOUT_COPY.telegramNotConfigured;

    await updateCheckoutOrder(order.id, {
      payloadPatch: {
        customerDigestLastFailedAt: new Date().toISOString()
      }
    });

    throw new Error(message);
  }
}

export async function completePilotOrderOnboarding(
  orderId: string | number,
  options?: { ownerId?: string | number | null }
): Promise<CheckoutOrder> {
  let order = await ensurePilotOrderOnboardingReady(orderId, { ownerId: options?.ownerId });

  if (!order) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.orderNotFound);
  }

  if (order.productCode !== "pilot") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.pilotOnly);
  }

  if (order.status !== "paid") {
    throw new Error(CUSTOMER_CHECKOUT_COPY.paidOnly);
  }

  const profile = await getRequiredOrderClientProfile(order);

  if (!profile.telegramChatId) {
    throw new Error("Telegram chat id is required before activation.");
  }

  order = await updateCheckoutOrder(order.id, {
    payloadPatch: {
      clientProfileId: profile.id,
      onboardingStatus: "completed",
      onboardingStep: "complete",
      onboardingActivatedAt: order.payload.onboardingActivatedAt ?? new Date().toISOString(),
      onboardingCompletedAt: order.payload.onboardingCompletedAt ?? new Date().toISOString()
    }
  });

  return order;
}

export async function syncCheckoutOrderAfterSuccessReturn(input: {
  orderId: string | number;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<CheckoutOrder | null> {
  let order = await getCheckoutOrderById(input.orderId);

  if (!order) {
    return null;
  }

  if (order.status === "paid") {
    return ensurePaidPilotOrderReady(order);
  }

  const provider = getPaymentProvider(order.provider);

  if (!provider?.syncOrderAfterReturn) {
    return order;
  }

  const syncResult = await provider.syncOrderAfterReturn({
    order,
    providerPaymentId: order.providerPaymentId,
    searchParams: input.searchParams
  });

  if (!syncResult) {
    return order;
  }

  order = await updateCheckoutOrder(order.id, {
    status: syncResult.status,
    providerPaymentId: syncResult.providerPaymentId ?? order.providerPaymentId,
    paidAt: syncResult.paidAt ?? (syncResult.status === "paid" ? new Date().toISOString() : null),
    payloadPatch: {
      paymentMessage: syncResult.message ?? order.payload.paymentMessage,
      paymentProviderPayload: syncResult.payload ?? order.payload.paymentProviderPayload
    }
  });

  if (order.status === "paid") {
    order = await ensurePaidPilotOrderReady(order);
  }

  return order;
}

export async function markCheckoutOrderCanceled(
  orderId: string | number,
  reason: string | null = null
): Promise<CheckoutOrder | null> {
  const order = await getCheckoutOrderById(orderId);

  if (!order || order.status === "paid") {
    return order;
  }

  return updateCheckoutOrder(order.id, {
    status: order.status === "unavailable" ? "unavailable" : "canceled",
    payloadPatch: reason
      ? {
          paymentMessage: reason
        }
      : null
  });
}

export async function processPaymentWebhook(
  providerCode: string,
  request: Request
): Promise<{ status: number; body: string }> {
  const provider = getPaymentProvider(providerCode);

  if (!provider?.parseWebhook) {
    return {
      status: 404,
      body: "Payment provider not found."
    };
  }

  const parsedWebhook = await provider.parseWebhook(request);

  if (!parsedWebhook.ok) {
    return {
      status: parsedWebhook.responseStatus,
      body: parsedWebhook.responseBody
    };
  }

  let order = parsedWebhook.orderId
    ? await getCheckoutOrderById(parsedWebhook.orderId)
    : await getCheckoutOrderByProviderPaymentId(parsedWebhook.providerPaymentId ?? null);

  if (!order) {
    return {
      status: parsedWebhook.responseStatus,
      body: parsedWebhook.responseBody
    };
  }

  const pool = getPool();

  if (!pool) {
    return { status: 500, body: "DATABASE_URL is not set." };
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    order = await updateCheckoutOrder(order.id, {
      status: parsedWebhook.status ?? order.status,
      provider: provider.code,
      providerPaymentId: parsedWebhook.providerPaymentId ?? order.providerPaymentId,
      paidAt:
        parsedWebhook.status === "paid"
          ? parsedWebhook.paidAt ?? new Date().toISOString()
          : order.paidAt,
      payloadPatch: {
        paymentMessage: parsedWebhook.message ?? order.payload.paymentMessage,
        paymentProviderPayload: parsedWebhook.payload ?? order.payload.paymentProviderPayload
      }
    }, client);

    if (order.status === "paid") {
      await ensurePaidPilotOrderReady(order, client);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    status: parsedWebhook.responseStatus,
    body: parsedWebhook.responseBody
  };
}

export function buildCheckoutRetryHref(order: CheckoutOrder): string {
  return buildCheckoutHref({
    specialization: order.payload.specialization ?? "",
    targetCity: order.payload.city ?? "",
    includeKeywords: order.payload.includeKeywords.join(", "),
    excludeKeywords: order.payload.excludeKeywords.join(", "),
    dailyDigestLimit: order.payload.dailyDigestLimit
  });
}

async function createCheckoutOrder(input: {
  userId: string | number;
  productCode: PublicPlan["code"];
  amountMinor: number;
  currency: string;
  customerName: string;
  customerContact: string;
  payload: CheckoutOrderPayload;
}): Promise<CheckoutOrder> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const customerName = normalizeRequiredText(input.customerName, "Name is required.");
  const customerContact = normalizeRequiredText(input.customerContact, "Contact is required.");
  const result = await pool.query<CheckoutOrderRow>(`
    INSERT INTO checkout_orders (
      user_id,
      plan_code,
      amount_rub,
      currency,
      status,
      customer_name,
      customer_contact,
      payload
    )
    VALUES ($1, $2, ($3 / 100), $4, 'created', $5, $6, $7::jsonb)
    RETURNING
      id::TEXT AS id,
      plan_code AS "productCode",
      (amount_rub * 100) AS "amountMinor",
      currency,
      status,
      customer_name AS "customerName",
      customer_contact AS "customerContact",
      payload,
      provider,
      provider_payment_id AS "providerPaymentId",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      paid_at::TEXT AS "paidAt"
  `, [
    normalizeCheckoutOrderUserId(input.userId),
    input.productCode,
    input.amountMinor,
    normalizeCurrency(input.currency),
    customerName,
    customerContact,
    JSON.stringify(input.payload)
  ]);


  if (result.rowCount !== 1) {
    throw new Error("Failed to create checkout order.");
  }

  return mapCheckoutOrderRow(result.rows[0]);
}

async function updateCheckoutOrder(
  orderId: string | number,
  input: UpdateCheckoutOrderInput,
  db?: PaymentsDbClient
): Promise<CheckoutOrder> {
  const normalizedOrderId = normalizeCheckoutOrderId(orderId);
  const existingOrder = await getCheckoutOrderById(normalizedOrderId, db);

  if (!existingOrder) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.orderNotFound);
  }

  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const nextStatus = input.status ?? existingOrder.status;
  const nextProvider = input.provider === undefined ? existingOrder.provider : normalizeOptionalText(input.provider);
  const nextProviderPaymentId =
    input.providerPaymentId === undefined
      ? existingOrder.providerPaymentId
      : normalizeOptionalText(input.providerPaymentId);
  const nextPaidAt =
    input.paidAt === undefined
      ? existingOrder.paidAt
      : normalizeOptionalText(input.paidAt);
  const nextPayload = mergeCheckoutOrderPayload(existingOrder.payload, input.payloadPatch ?? null);

  const result = await pool.query<CheckoutOrderRow>(`
    UPDATE checkout_orders
    SET
      status = $2,
      provider = $3,
      provider_payment_id = $4,
      payload = $5::jsonb,
      paid_at = $6
    WHERE id = $1
    RETURNING
      id::TEXT AS id,
      plan_code AS "productCode",
      (amount_rub * 100) AS "amountMinor",
      currency,
      status,
      customer_name AS "customerName",
      customer_contact AS "customerContact",
      payload,
      provider,
      provider_payment_id AS "providerPaymentId",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      paid_at::TEXT AS "paidAt"
  `, [
    normalizedOrderId,
    nextStatus,
    nextProvider,
    nextProviderPaymentId,
    JSON.stringify(nextPayload),
    nextPaidAt
  ]);

  if (result.rowCount !== 1) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.updateOrderFailed);
  }

  return mapCheckoutOrderRow(result.rows[0]);
}

async function getCheckoutOrderByProviderPaymentId(
  providerPaymentId: string | null
): Promise<CheckoutOrder | null> {
  const normalizedProviderPaymentId = normalizeOptionalText(providerPaymentId);

  if (!normalizedProviderPaymentId) {
    return null;
  }

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<CheckoutOrderRow>(`
    SELECT
      id::TEXT AS id,
      plan_code AS "productCode",
      (amount_rub * 100) AS "amountMinor",
      currency,
      status,
      customer_name AS "customerName",
      customer_contact AS "customerContact",
      payload,
      provider,
      provider_payment_id AS "providerPaymentId",
      created_at::TEXT AS "createdAt",
      updated_at::TEXT AS "updatedAt",
      paid_at::TEXT AS "paidAt"
    FROM checkout_orders
    WHERE provider_payment_id = $1
  `, [normalizedProviderPaymentId]);

  return result.rowCount === 1 ? mapCheckoutOrderRow(result.rows[0]) : null;
}


async function ensurePilotEntitlementForPaidOrder(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<void> {
  if (order.productCode !== "pilot" || order.status !== "paid") {
    return;
  }

  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const paidAtIso = order.paidAt ?? new Date().toISOString();
  const ownerResult = await pool.query<{ userId: string }>(
    `SELECT user_id::TEXT AS "userId" FROM checkout_orders WHERE id = $1 LIMIT 1`,
    [normalizeCheckoutOrderId(order.id)]
  );

  if (ownerResult.rowCount !== 1) {
    throw new Error("Checkout order owner not found.");
  }

  const userId = normalizeCheckoutOrderUserId(ownerResult.rows[0].userId);
  const enrollmentNote = `checkout_order:${order.id}`;

  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM pilot_enrollments WHERE user_id = $1 AND notes = $2 LIMIT 1`,
    [userId, enrollmentNote]
  );

  if (existing.rowCount === 1) {
    return;
  }

  await pool.query(`
    INSERT INTO pilot_enrollments (
      user_id,
      status,
      starts_at,
      ends_at,
      activated_by,
      notes
    )
    VALUES ($1, 'active', $2::timestamptz, ($2::timestamptz + ($3::int * INTERVAL '1 day')), 'payment_webhook', $4)
    ON CONFLICT (user_id) WHERE status = 'active'
    DO UPDATE SET
      starts_at = LEAST(pilot_enrollments.starts_at, EXCLUDED.starts_at),
      ends_at = GREATEST(
        COALESCE(pilot_enrollments.ends_at, '-infinity'::timestamptz),
        EXCLUDED.ends_at
      ),
      updated_at = NOW(),
      activated_by = EXCLUDED.activated_by,
      notes = EXCLUDED.notes
  `, [userId, paidAtIso, PILOT_ENTITLEMENT_DAYS, enrollmentNote]);
}

async function ensurePilotApplicationForOrder(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<CheckoutOrder> {
  if (order.payload.pilotApplicationId) {
    return order;
  }

  const pilotApplication = await createPilotApplication({
    name: order.customerName ?? "Recruiter Radar customer",
    telegram: order.customerContact ?? "not-provided",
    specialization: order.payload.specialization,
    city: order.payload.city,
    comment: buildPilotApplicationComment({
      baseComment: order.payload.comment ?? "",
      includeKeywords: order.payload.includeKeywords.join(", "),
      excludeKeywords: order.payload.excludeKeywords.join(", "),
      dailyDigestLimit: order.payload.dailyDigestLimit
    })
  }, db);

  return updateCheckoutOrder(order.id, {
    payloadPatch: {
      pilotApplicationId: pilotApplication.id
    }
  }, db);
}

async function ensurePaidPilotOrderReady(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<CheckoutOrder> {
  if (order.productCode !== "pilot" || order.status !== "paid") {
    return order;
  }

  await ensurePilotEntitlementForPaidOrder(order, db);
  order = await ensurePilotApplicationForOrder(order, db);

  const profile = await ensureClientProfileForPaidOrder(order, db);
  const nextOnboardingStatus =
    order.payload.onboardingStatus === "completed" ? "completed" : "in_progress";
  const nextOnboardingStep =
    nextOnboardingStatus === "completed"
      ? "complete"
      : order.payload.onboardingStatus === "inactive"
        ? "confirm-profile"
        : order.payload.onboardingStep === "complete"
          ? "preview"
          : order.payload.onboardingStep === "telegram" && profile.telegramChatId
            ? "preview"
          : order.payload.onboardingStep;
  const nextActivatedAt = order.payload.onboardingActivatedAt ?? new Date().toISOString();
  const nextCompletedAt =
    nextOnboardingStatus === "completed"
      ? order.payload.onboardingCompletedAt ?? new Date().toISOString()
      : null;

  if (
    order.payload.clientProfileId === profile.id &&
    order.payload.onboardingStatus === nextOnboardingStatus &&
    order.payload.onboardingStep === nextOnboardingStep &&
    order.payload.onboardingActivatedAt === nextActivatedAt &&
    order.payload.onboardingCompletedAt === nextCompletedAt
  ) {
    return order;
  }

  return updateCheckoutOrder(order.id, {
    payloadPatch: {
      clientProfileId: profile.id,
      onboardingStatus: nextOnboardingStatus,
      onboardingStep: nextOnboardingStep,
      onboardingActivatedAt: nextActivatedAt,
      onboardingCompletedAt: nextCompletedAt
    }
  }, db);
}

async function ensureClientProfileForPaidOrder(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<ClientProfile> {
  const profileSeed = buildPaidOrderProfileSeed(order);
  const linkedProfile = order.payload.clientProfileId
    ? await getClientProfileById(order.payload.clientProfileId, db).catch(() => null)
    : null;
  const matchedProfile =
    linkedProfile ??
    (await findMatchingClientProfileForCheckoutOrder({
      checkoutOrderId: order.id,
      agencyName: profileSeed.agencyName,
      telegramChatId: profileSeed.telegramChatId,
      targetCity: profileSeed.targetCity,
      specialization: profileSeed.specialization,
      includeKeywords: profileSeed.includeKeywords,
      excludeKeywords: profileSeed.excludeKeywords,
      dailyDigestLimit: profileSeed.dailyDigestLimit
    }, db));
  const nextTelegramChatId = matchedProfile?.telegramChatId ?? profileSeed.telegramChatId;

  if (
    matchedProfile &&
    !doesClientProfileNeedSync(matchedProfile, {
      agencyName: profileSeed.agencyName,
      telegramChatId: nextTelegramChatId,
      targetCity: profileSeed.targetCity,
      specialization: profileSeed.specialization,
      includeKeywords: profileSeed.includeKeywords,
      excludeKeywords: profileSeed.excludeKeywords,
      dailyDigestLimit: profileSeed.dailyDigestLimit
    })
  ) {
    return matchedProfile;
  }

  return saveClientProfile({
    id: matchedProfile?.id ?? null,
    agencyName: profileSeed.agencyName,
    telegramChatId: nextTelegramChatId,
    targetCity: profileSeed.targetCity,
    specialization: profileSeed.specialization,
    includeKeywords: profileSeed.includeKeywords,
    excludeKeywords: profileSeed.excludeKeywords,
    dailyDigestLimit: profileSeed.dailyDigestLimit,
    isActive: true
  }, db);
}

async function getRequiredOrderClientProfile(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<ClientProfile> {
  const clientProfileId = order.payload.clientProfileId;

  if (!clientProfileId) {
    throw new Error("Client profile is not linked to this order yet.");
  }

  const profile = await getClientProfileById(clientProfileId, db);

  if (!profile) {
    throw new Error("Client profile not found.");
  }

  return profile;
}

function buildPaidOrderProfileSeed(order: CheckoutOrder): {
  agencyName: string;
  telegramChatId: string | null;
  targetCity: string | null;
  specialization: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  dailyDigestLimit: number;
} {
  return {
    agencyName: order.customerName ?? "Recruiter Radar customer",
    telegramChatId: normalizeTelegramChatIdCandidate(order.customerContact),
    targetCity: order.payload.city,
    specialization: order.payload.specialization,
    includeKeywords: order.payload.includeKeywords,
    excludeKeywords: order.payload.excludeKeywords,
    dailyDigestLimit: order.payload.dailyDigestLimit
  };
}

function doesClientProfileNeedSync(
  profile: ClientProfile,
  target: {
    agencyName: string;
    telegramChatId: string | null;
    targetCity: string | null;
    specialization: string | null;
    includeKeywords: readonly string[];
    excludeKeywords: readonly string[];
    dailyDigestLimit: number;
  }
): boolean {
  return (
    profile.agencyName !== target.agencyName ||
    profile.telegramChatId !== target.telegramChatId ||
    profile.targetCity !== target.targetCity ||
    profile.specialization !== target.specialization ||
    profile.dailyDigestLimit !== target.dailyDigestLimit ||
    !profile.isActive ||
    !areKeywordListsEqual(profile.includeKeywords, target.includeKeywords) ||
    !areKeywordListsEqual(profile.excludeKeywords, target.excludeKeywords)
  );
}

function getConfiguredPaymentProvider(): PaymentProviderAdapter | null {
  const providerCode = normalizeOptionalText(process.env.PAYMENTS_PROVIDER)?.toLocaleLowerCase("en-US");

  if (providerCode === "stripe") {
    return createStripePaymentAdapter();
  }

  return null;
}

function getPaymentProvider(providerCode: string | null): PaymentProviderAdapter | null {
  const normalizedProviderCode = normalizeOptionalText(providerCode)?.toLocaleLowerCase("en-US");

  if (!normalizedProviderCode) {
    return null;
  }

  if (normalizedProviderCode === "stripe") {
    return createStripePaymentAdapter();
  }

  return null;
}

function mapCheckoutOrderRow(row: CheckoutOrderRow): CheckoutOrder {
  const plan = getPublicPlanByCode(normalizeProductCode(row.productCode));

  return {
    id: row.id,
    productCode: plan.code,
    amountMinor: row.amountMinor,
    currency: normalizeCurrency(row.currency),
    status: normalizeCheckoutOrderStatus(row.status),
    customerName: normalizeOptionalText(row.customerName),
    customerContact: normalizeOptionalText(row.customerContact),
    payload: normalizeCheckoutOrderPayload(row.payload, plan),
    provider: normalizeOptionalText(row.provider),
    providerPaymentId: normalizeOptionalText(row.providerPaymentId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paidAt: normalizeOptionalText(row.paidAt)
  };
}

function normalizeCheckoutOrderPayload(
  value: unknown,
  plan: PublicPlan
): CheckoutOrderPayload {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    planName: normalizeOptionalText(readString(payload.planName)) ?? plan.name,
    planCadence: normalizeOptionalText(readString(payload.planCadence)) ?? plan.cadence,
    specialization: normalizeOptionalText(readString(payload.specialization)),
    city: normalizeOptionalText(readString(payload.city)),
    includeKeywords: normalizeKeywordList(payload.includeKeywords),
    excludeKeywords: normalizeKeywordList(payload.excludeKeywords),
    dailyDigestLimit: normalizeDailyDigestLimit(readNumber(payload.dailyDigestLimit)),
    comment: normalizeOptionalText(readString(payload.comment)),
    pilotApplicationId: normalizeOptionalText(readString(payload.pilotApplicationId)),
    clientProfileId: normalizeOptionalText(readString(payload.clientProfileId)),
    onboardingStatus: normalizeCheckoutOrderOnboardingStatus(readString(payload.onboardingStatus)),
    onboardingStep: normalizeCheckoutOrderOnboardingStep(readString(payload.onboardingStep)),
    onboardingActivatedAt: normalizeOptionalText(readString(payload.onboardingActivatedAt)),
    onboardingCompletedAt: normalizeOptionalText(readString(payload.onboardingCompletedAt)),
    onboardingTestDigestSentAt: normalizeOptionalText(readString(payload.onboardingTestDigestSentAt)),
    onboardingTestDigestTelegramMessageId: normalizeOptionalText(
      readString(payload.onboardingTestDigestTelegramMessageId)
    ),
    customerDigestLastSentAt: normalizeOptionalText(readString(payload.customerDigestLastSentAt)),
    customerDigestLastEmptyAt: normalizeOptionalText(readString(payload.customerDigestLastEmptyAt)),
    customerDigestLastFailedAt: normalizeOptionalText(readString(payload.customerDigestLastFailedAt)),
    paymentMessage: normalizeOptionalText(readString(payload.paymentMessage)),
    paymentProviderPayload: normalizePayloadObject(payload.paymentProviderPayload)
  };
}

function mergeCheckoutOrderPayload(
  currentPayload: CheckoutOrderPayload,
  payloadPatch: Partial<CheckoutOrderPayload> | null
): CheckoutOrderPayload {
  if (!payloadPatch) {
    return currentPayload;
  }

  return {
    ...currentPayload,
    ...payloadPatch,
    clientProfileId:
      payloadPatch.clientProfileId === undefined
        ? currentPayload.clientProfileId
        : normalizeOptionalText(payloadPatch.clientProfileId),
    onboardingStatus:
      payloadPatch.onboardingStatus === undefined
        ? currentPayload.onboardingStatus
        : normalizeCheckoutOrderOnboardingStatus(payloadPatch.onboardingStatus),
    onboardingStep:
      payloadPatch.onboardingStep === undefined
        ? currentPayload.onboardingStep
        : normalizeCheckoutOrderOnboardingStep(payloadPatch.onboardingStep),
    onboardingActivatedAt:
      payloadPatch.onboardingActivatedAt === undefined
        ? currentPayload.onboardingActivatedAt
        : normalizeOptionalText(payloadPatch.onboardingActivatedAt),
    onboardingCompletedAt:
      payloadPatch.onboardingCompletedAt === undefined
        ? currentPayload.onboardingCompletedAt
        : normalizeOptionalText(payloadPatch.onboardingCompletedAt),
    onboardingTestDigestSentAt:
      payloadPatch.onboardingTestDigestSentAt === undefined
        ? currentPayload.onboardingTestDigestSentAt
        : normalizeOptionalText(payloadPatch.onboardingTestDigestSentAt),
    onboardingTestDigestTelegramMessageId:
      payloadPatch.onboardingTestDigestTelegramMessageId === undefined
        ? currentPayload.onboardingTestDigestTelegramMessageId
        : normalizeOptionalText(payloadPatch.onboardingTestDigestTelegramMessageId),
    customerDigestLastSentAt:
      payloadPatch.customerDigestLastSentAt === undefined
        ? currentPayload.customerDigestLastSentAt
        : normalizeOptionalText(payloadPatch.customerDigestLastSentAt),
    customerDigestLastEmptyAt:
      payloadPatch.customerDigestLastEmptyAt === undefined
        ? currentPayload.customerDigestLastEmptyAt
        : normalizeOptionalText(payloadPatch.customerDigestLastEmptyAt),
    customerDigestLastFailedAt:
      payloadPatch.customerDigestLastFailedAt === undefined
        ? currentPayload.customerDigestLastFailedAt
        : normalizeOptionalText(payloadPatch.customerDigestLastFailedAt),
    includeKeywords:
      payloadPatch.includeKeywords === undefined
        ? currentPayload.includeKeywords
        : normalizeKeywordList(payloadPatch.includeKeywords),
    excludeKeywords:
      payloadPatch.excludeKeywords === undefined
        ? currentPayload.excludeKeywords
        : normalizeKeywordList(payloadPatch.excludeKeywords),
    dailyDigestLimit:
      payloadPatch.dailyDigestLimit === undefined
        ? currentPayload.dailyDigestLimit
        : normalizeDailyDigestLimit(payloadPatch.dailyDigestLimit),
    paymentProviderPayload:
      payloadPatch.paymentProviderPayload === undefined
        ? currentPayload.paymentProviderPayload
        : normalizePayloadObject(payloadPatch.paymentProviderPayload)
  };
}

function normalizeCheckoutOrderId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(CUSTOMER_CHECKOUT_COPY.invalidOrderId);
  }

  return normalizedValue;
}

function normalizeCheckoutOrderStatus(value: string): CheckoutOrderStatus {
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");

  if ((CHECKOUT_ORDER_STATUSES as readonly string[]).includes(normalizedValue)) {
    return normalizedValue as CheckoutOrderStatus;
  }

  return "failed";
}

function normalizeLinkedClientProfileId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error("Invalid client profile id.");
  }

  return normalizedValue;
}

function normalizeCheckoutOrderOnboardingStatus(
  value: string | CheckoutOrderOnboardingStatus | null | undefined
): CheckoutOrderOnboardingStatus {
  if (typeof value !== "string") {
    return "inactive";
  }

  const normalizedValue = value.trim().toLocaleLowerCase("en-US");

  if ((CHECKOUT_ORDER_ONBOARDING_STATUSES as readonly string[]).includes(normalizedValue)) {
    return normalizedValue as CheckoutOrderOnboardingStatus;
  }

  return "inactive";
}

function normalizeCheckoutOrderOnboardingStep(
  value: string | CheckoutOrderOnboardingStep | null | undefined
): CheckoutOrderOnboardingStep {
  if (typeof value !== "string") {
    return "confirm-profile";
  }

  const normalizedValue = value.trim().toLocaleLowerCase("en-US");

  if ((CHECKOUT_ORDER_ONBOARDING_STEPS as readonly string[]).includes(normalizedValue)) {
    return normalizedValue as CheckoutOrderOnboardingStep;
  }

  return "confirm-profile";
}

function normalizeProductCode(value: string): PublicPlan["code"] {
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");

  if (normalizedValue === "pilot" || normalizedValue === "monthly") {
    return normalizedValue;
  }

  throw new Error(`Unknown product code: ${value}`);
}

function normalizeSiteUrl(value: string): string {
  const normalizedValue = normalizeRequiredText(value, "Site URL is required.");
  return normalizedValue.replace(/\/+$/, "");
}

function normalizeCurrency(value: string): string {
  return normalizeRequiredText(value, "Currency is required.").toLocaleUpperCase("en-US");
}

function normalizeRequiredText(value: string | null | undefined, message: string): string {
  const normalizedValue = normalizeOptionalText(value);

  if (!normalizedValue) {
    throw new Error(message);
  }

  return normalizedValue;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeTelegramChatIdCandidate(value: string | null | undefined): string | null {
  const normalizedValue = normalizeOptionalText(value);

  if (!normalizedValue || !/^-?\d+$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function normalizeDailyDigestLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }

  const normalizedValue = Math.trunc(value);

  if (normalizedValue <= 0) {
    return 5;
  }

  return Math.min(normalizedValue, 10);
}

function normalizeKeywordList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return parseKeywordText(value.join(","));
  }

  if (typeof value === "string") {
    return parseKeywordText(value);
  }

  return [];
}

function areKeywordListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

function normalizePayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapDigestItemToTelegramDigestItem(item: DigestItem): HhDigestItem {
  return {
    rank: item.rank,
    orgId: item.orgId,
    hh_employer_id: item.sourceExternalId,
    employer_name: item.sourceDisplayName,
    vacancies_count: item.vacanciesCount,
    distinct_vacancy_names_count: item.distinctVacancyNamesCount,
    latest_published_at: item.latestPublishedAt,
    total_score: item.totalScore,
    reasons: item.reasons,
    opener: item.opener,
    sourceFamilies: item.sourceFamilies,
    evidenceTitles: item.evidenceTitles,
    candidateSourceKeys: item.candidateSourceKeys,
    locationNames: item.locationNames
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const normalizedMessage = error.message.trim();
    return normalizedMessage === "" ? "Не получилось открыть оплату." : normalizedMessage;
  }

  return "Не получилось открыть оплату.";
}

function normalizeCheckoutOrderUserId(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Invalid checkout order owner.");
  return parsed;
}
