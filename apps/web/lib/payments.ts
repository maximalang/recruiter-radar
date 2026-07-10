import {
  getClientProfileById,
  parseKeywordText,
  saveClientProfile,
  resolveHiringMode,
  VALID_COMPANY_SIZES,
  VALID_INDUSTRIES,
  VALID_ROLES
} from "./clientProfiles";
import { runDigestForClientProfile, type DigestItemInput } from "./digest";
import { buildHhDigestText, type HhDigestItem } from "./hhDigest";
import { buildBatchDigestMessages, type BatchLead } from "./telegram/digest-batch";
import { deriveWhyNow, deriveLawfulContactPath, formatLawfulContactPath } from "./leads-data";
import { detectForeignEmployer } from "./scoring/foreign-employer";
import {
  buildCheckoutHref,
  getPublicPlanByCode
} from "./publicProduct";
import {
  CUSTOMER_CHECKOUT_COPY,
  humanizeCustomerDeliveryIssue
} from "./copy/customer";
import { getTelegramBotToken, sendTelegramTextMessage } from "./telegram";
import { buildTelegramDigestFeedbackReplyMarkup } from "./telegramDigestFeedback";
import { recordClientProfileDigestShownOutcomes } from "./clientProfileSignalOutcomes";
import { isDigestEligibleGate } from "./scoring/gate-pipeline";
import { logError } from "./runtime";
import {
  type CheckoutOrder,
  type PaymentsDbClient,
  type PilotActivationReadiness,
  type PilotOrderTestDigestResult,
  type StartCheckoutOrderInput,
  type StartCheckoutOrderResult
} from "./paymentsTypes";
import {
  getErrorMessage,
  normalizeCheckoutOrderUserId,
  normalizeDailyDigestLimit,
  normalizeKeywordList,
  normalizeLinkedClientProfileId,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeSiteUrl
} from "./paymentsNormalize";
import {
  createCheckoutOrder,
  ensurePaidPilotOrderReady,
  ensurePilotApplicationForOrder,
  getCheckoutOrderById,
  getCheckoutOrderByIdForOwner,
  getCheckoutOrderByProviderPaymentId,
  getPool,
  getRequiredOrderClientProfile,
  updateCheckoutOrder
} from "./paymentsRepo";
import {
  getConfiguredPaymentProvider,
  getPaymentProvider,
  getPaymentProviderSetupState
} from "./paymentsProvider";

export { getCheckoutOrderById, getPaymentProviderSetupState };

export type {
  CheckoutOrder,
  CheckoutOrderOnboardingStatus,
  CheckoutOrderOnboardingStep,
  CheckoutOrderPayload,
  CheckoutOrderStatus,
  PaymentCheckoutSessionInput,
  PaymentCheckoutSessionResult,
  PaymentProviderAdapter,
  PaymentProviderSetupState,
  PaymentSyncResult,
  PaymentWebhookParseResult,
  PilotActivationReadiness,
  PilotOrderTestDigestResult
} from "./paymentsTypes";

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
      industries: [],
      companySizes: [],
      dailyDigestLimit: normalizeDailyDigestLimit(input.dailyDigestLimit),
      roles: [],
      excludedIndustries: [],
      excludedLocations: [],
      remoteFriendly: false,
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
  // Recurring plans (monthly, premium) have no self-serve subscription flow — we
  // capture them as a sales request, never as a pilot and never as a payment.
  const isRecurringPlan = plan.isRecurring;
  const unavailableReason = isRecurringPlan ? "request-received" : "payment-unavailable";
  const unavailablePaymentMessage = isRecurringPlan
    ? "Заявка получена. Мы свяжемся, чтобы подключить тариф и согласовать оплату."
    : "Оплата пока недоступна. Заявка сохранена, и к ней можно вернуться позже.";

  // Recurring plans must NEVER reach the payment provider: there is no
  // subscription flow, so createCheckoutSession would attempt a one-off charge
  // for the full monthly amount. Short-circuit to a saved sales request,
  // regardless of whether a provider is configured.
  if (isRecurringPlan || !provider || !provider.isConfigured()) {
    order = await updateCheckoutOrder(order.id, {
      status: "unavailable",
      payloadPatch: {
        paymentMessage: unavailablePaymentMessage
      }
    });
    // Pilot funnel (application + onboarding) is pilot-only. Recurring sales
    // requests stay as a saved order without a pilot application.
    if (order.productCode === "pilot") {
      order = await ensurePilotApplicationForOrder(order);
    }

    return {
      kind: "unavailable",
      order,
      redirectUrl: `${cancelUrl}?reason=${unavailableReason}`,
      message: unavailablePaymentMessage
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
      if (order.productCode === "pilot") {
        order = await ensurePilotApplicationForOrder(order);
      }

      return {
        kind: "unavailable",
        order,
        redirectUrl: `${cancelUrl}?reason=${unavailableReason}`,
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
  orderId: string | number,
  options: { ownerId: string | number }
): Promise<PilotActivationReadiness | null> {
  const order = await ensurePilotOrderOnboardingReady(orderId, { ownerId: options.ownerId });

  if (!order || order.productCode !== "pilot") {
    return null;
  }

  const profile = order.payload.clientProfileId
    ? await getClientProfileById(order.payload.clientProfileId, options.ownerId).catch(() => null)
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
  industries?: readonly string[] | null;
  companySizes?: readonly string[] | null;
  dailyDigestLimit?: number | null;
  contactPolicy?: 'corporate_only' | 'no_personal' | 'unrestricted' | null;
  roles?: readonly string[] | null;
  excludedIndustries?: readonly string[] | null;
  excludedLocations?: readonly string[] | null;
  remoteFriendly?: boolean | null;
  ownerId: string | number;
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
    industries: input.industries?.filter((s): s is string => VALID_INDUSTRIES.has(s)) ?? [],
    companySizes: input.companySizes?.filter((s): s is string => VALID_COMPANY_SIZES.has(s)) ?? [],
    dailyDigestLimit: normalizeDailyDigestLimit(input.dailyDigestLimit),
    isActive: true,
    contactPolicy: input.contactPolicy ?? 'corporate_only',
    roles: input.roles?.filter((s): s is string => VALID_ROLES.has(s)) ?? [],
    excludedIndustries: input.excludedIndustries?.filter((s): s is string => VALID_INDUSTRIES.has(s)) ?? [],
    excludedLocations: input.excludedLocations ?? [],
    remoteFriendly: input.remoteFriendly ?? false,
  });

  order = await updateCheckoutOrder(order.id, {
    payloadPatch: {
      clientProfileId: savedProfile.id,
      specialization: savedProfile.specialization,
      city: savedProfile.targetCity,
      includeKeywords: savedProfile.includeKeywords,
      excludeKeywords: savedProfile.excludeKeywords,
      industries: savedProfile.industries,
      companySizes: savedProfile.companySizes,
      dailyDigestLimit: savedProfile.dailyDigestLimit,
      roles: savedProfile.roles,
      excludedIndustries: savedProfile.excludedIndustries,
      excludedLocations: savedProfile.excludedLocations,
      remoteFriendly: savedProfile.remoteFriendly,
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
  options: { ownerId: string | number }
): Promise<PilotOrderTestDigestResult> {
  let order = await ensurePilotOrderOnboardingReady(orderId, { ownerId: options.ownerId });

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

  if (order.payload.onboardingTestDigestSentAt) {
    throw new Error("Тестовый дайджест уже был отправлен для этого заказа.");
  }

  const digestRun = await runDigestForClientProfile({
    clientProfileId: profile.id,
    sourceKey: "telegram",
    limit: profile.dailyDigestLimit,
    skipStateWrite: true
  });
  const items = digestRun.items
    .filter(isDigestEligibleGate)
    .map(mapDigestItemToTelegramDigestItem);

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

  // First-impression parity: the pilot's onboarding test digest must read exactly
  // like a real daily digest — the same premium batch card, not the legacy
  // debug-style buildHhDigestText ("HH digest" / "score 332.0"). Map the digest
  // items to the same BatchLead shape the daily delivery uses. The resolved
  // hiring mode is threaded through so the test digest is mode-aware too — the
  // first impression an agency gets matches the daily radar's framing.
  const resolvedHiringMode = resolveHiringMode(profile);
  const batchLeads: BatchLead[] = items.map((item) => {
    const foreign = detectForeignEmployer({
      sourceDisplayName: item.employer_name,
      sourceExternalId: item.hh_employer_id,
      candidateSourceKeys: item.candidate_source_keys,
      evidenceTitles: item.evidence_titles,
      locationNames: item.location_names,
    });
    return {
      orgId: item.org_id,
      orgName: item.employer_name,
      score: item.total_score,
      confidenceGate: item.confidence_gate,
      vacanciesCount: item.vacancies_count,
      evidenceTitles: item.evidence_titles,
      locationNames: item.location_names,
      whyLine: deriveWhyNow(item.reasons) || null,
      latestPublishedAt: item.latest_published_at || null,
      hiringMode: resolvedHiringMode,
      isForeignEmployer: foreign.isForeign,
      contactPathLabel: formatLawfulContactPath(
        deriveLawfulContactPath(item.reasons, item.source_families),
      ),
      sourceFamilies: item.source_families,
    };
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
  const batch = buildBatchDigestMessages({
    leads: batchLeads,
    leadsUrl: baseUrl ? `${baseUrl}/leads` : "/leads",
  });
  const digestText = batch.messages[0] ?? buildHhDigestText(items);
  const replyMarkup = buildTelegramDigestFeedbackReplyMarkup({
    clientProfileId: profile.id,
    items
  });

  try {
    const telegramResult = await sendTelegramTextMessage(digestText, {
      botToken,
      chatId: profile.telegramChatId
    }, {
      parseMode: "HTML",
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
      logError("payments.onboarding_digest_shown_record_failed", error);
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
  options: { ownerId: string | number }
): Promise<CheckoutOrder> {
  let order = await ensurePilotOrderOnboardingReady(orderId, { ownerId: options.ownerId });

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
  ownerId: string | number;
  searchParams?: Record<string, string | string[] | undefined>;
}): Promise<CheckoutOrder | null> {
  let order = await getCheckoutOrderByIdForOwner(input.orderId, input.ownerId);

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
  reason: string | null = null,
  options: { ownerId: string | number }
): Promise<CheckoutOrder | null> {
  const normalizedOwnerId = normalizeCheckoutOrderUserId(options.ownerId);
  const order = await getCheckoutOrderByIdForOwner(orderId, normalizedOwnerId);

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
    dailyDigestLimit: order.payload.dailyDigestLimit,
    planCode: order.productCode
  });
}


function mapDigestItemToTelegramDigestItem(item: DigestItemInput): HhDigestItem {
  return {
    rank: item.rank,
    org_id: item.org_id,
    hh_employer_id: item.source_external_id,
    employer_name: item.source_display_name,
    vacancies_count: item.vacancies_count,
    distinct_vacancy_names_count: item.distinct_vacancy_names_count,
    latest_published_at: item.latest_published_at,
    total_score: item.total_score,
    reasons: item.reasons,
    opener: item.opener,
    source_families: item.source_families,
    evidence_titles: item.evidence_titles,
    candidate_source_keys: item.candidate_source_keys,
    location_names: item.location_names
  };
}

