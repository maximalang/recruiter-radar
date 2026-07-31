import {
  parseKeywordText,
  VALID_COMPANY_SIZES,
  VALID_INDUSTRIES,
  VALID_ROLES,
  type ClientProfile
} from "./clientProfiles";
import { getPublicPlanByCode, isPublicPlanCode, normalizeLegacyPlanCode, type PublicPlan } from "./publicProduct";
import { CUSTOMER_CHECKOUT_COPY } from "./copy/customer";
import {
  CHECKOUT_ORDER_ONBOARDING_STATUSES,
  CHECKOUT_ORDER_ONBOARDING_STEPS,
  CHECKOUT_ORDER_STATUSES,
  type CheckoutOrder,
  type CheckoutOrderOnboardingStatus,
  type CheckoutOrderOnboardingStep,
  type CheckoutOrderPayload,
  type CheckoutOrderRow,
  type CheckoutOrderStatus,
  type PublicPlanCode
} from "./paymentsTypes";

export function mapCheckoutOrderRow(row: CheckoutOrderRow): CheckoutOrder {
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

function normalizeCheckoutOrderPayload(value: unknown, plan: PublicPlan): CheckoutOrderPayload {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    planName: normalizeOptionalText(readString(payload.planName)) ?? plan.name,
    planCadence: normalizeOptionalText(readString(payload.planCadence)) ?? plan.cadence,
    specialization: normalizeOptionalText(readString(payload.specialization)),
    city: normalizeOptionalText(readString(payload.city)),
    includeKeywords: normalizeKeywordList(payload.includeKeywords),
    excludeKeywords: normalizeKeywordList(payload.excludeKeywords),
    industries: normalizeAllowedList(payload.industries, VALID_INDUSTRIES),
    companySizes: normalizeAllowedList(payload.companySizes, VALID_COMPANY_SIZES),
    dailyDigestLimit: normalizeDailyDigestLimit(readNumber(payload.dailyDigestLimit)),
    roles: normalizeAllowedList(payload.roles, VALID_ROLES),
    excludedIndustries: normalizeAllowedList(payload.excludedIndustries, VALID_INDUSTRIES),
    excludedLocations: normalizeStringList(payload.excludedLocations),
    remoteFriendly: typeof payload.remoteFriendly === "boolean" ? payload.remoteFriendly : false,
    comment: normalizeOptionalText(readString(payload.comment)),
    legalAcceptedAt: normalizeOptionalText(readString(payload.legalAcceptedAt)),
    termsRevision: normalizeOptionalText(readString(payload.termsRevision)),
    privacyRevision: normalizeOptionalText(readString(payload.privacyRevision)),
    personalDataConsentRevision: normalizeOptionalText(readString(payload.personalDataConsentRevision)),
    pilotApplicationId: normalizeOptionalText(readString(payload.pilotApplicationId)),
    clientProfileId: normalizeOptionalText(readString(payload.clientProfileId)),
    onboardingStatus: normalizeCheckoutOrderOnboardingStatus(readString(payload.onboardingStatus)),
    onboardingStep: normalizeCheckoutOrderOnboardingStep(readString(payload.onboardingStep)),
    onboardingActivatedAt: normalizeOptionalText(readString(payload.onboardingActivatedAt)),
    onboardingCompletedAt: normalizeOptionalText(readString(payload.onboardingCompletedAt)),
    onboardingTestDigestSentAt: normalizeOptionalText(readString(payload.onboardingTestDigestSentAt)),
    onboardingTestDigestTelegramMessageId: normalizeOptionalText(readString(payload.onboardingTestDigestTelegramMessageId)),
    customerDigestLastSentAt: normalizeOptionalText(readString(payload.customerDigestLastSentAt)),
    customerDigestLastEmptyAt: normalizeOptionalText(readString(payload.customerDigestLastEmptyAt)),
    customerDigestLastFailedAt: normalizeOptionalText(readString(payload.customerDigestLastFailedAt)),
    paymentMessage: normalizeOptionalText(readString(payload.paymentMessage)),
    paymentProviderPayload: normalizePayloadObject(payload.paymentProviderPayload)
  };
}

export function mergeCheckoutOrderPayload(
  currentPayload: CheckoutOrderPayload,
  payloadPatch: Partial<CheckoutOrderPayload> | null
): CheckoutOrderPayload {
  if (!payloadPatch) return currentPayload;
  return {
    ...currentPayload,
    ...payloadPatch,
    clientProfileId: optionalPatch(payloadPatch.clientProfileId, currentPayload.clientProfileId),
    legalAcceptedAt: optionalPatch(payloadPatch.legalAcceptedAt, currentPayload.legalAcceptedAt),
    termsRevision: optionalPatch(payloadPatch.termsRevision, currentPayload.termsRevision),
    privacyRevision: optionalPatch(payloadPatch.privacyRevision, currentPayload.privacyRevision),
    personalDataConsentRevision: optionalPatch(payloadPatch.personalDataConsentRevision, currentPayload.personalDataConsentRevision),
    onboardingStatus: payloadPatch.onboardingStatus === undefined ? currentPayload.onboardingStatus : normalizeCheckoutOrderOnboardingStatus(payloadPatch.onboardingStatus),
    onboardingStep: payloadPatch.onboardingStep === undefined ? currentPayload.onboardingStep : normalizeCheckoutOrderOnboardingStep(payloadPatch.onboardingStep),
    onboardingActivatedAt: optionalPatch(payloadPatch.onboardingActivatedAt, currentPayload.onboardingActivatedAt),
    onboardingCompletedAt: optionalPatch(payloadPatch.onboardingCompletedAt, currentPayload.onboardingCompletedAt),
    onboardingTestDigestSentAt: optionalPatch(payloadPatch.onboardingTestDigestSentAt, currentPayload.onboardingTestDigestSentAt),
    onboardingTestDigestTelegramMessageId: optionalPatch(payloadPatch.onboardingTestDigestTelegramMessageId, currentPayload.onboardingTestDigestTelegramMessageId),
    customerDigestLastSentAt: optionalPatch(payloadPatch.customerDigestLastSentAt, currentPayload.customerDigestLastSentAt),
    customerDigestLastEmptyAt: optionalPatch(payloadPatch.customerDigestLastEmptyAt, currentPayload.customerDigestLastEmptyAt),
    customerDigestLastFailedAt: optionalPatch(payloadPatch.customerDigestLastFailedAt, currentPayload.customerDigestLastFailedAt),
    includeKeywords: payloadPatch.includeKeywords === undefined ? currentPayload.includeKeywords : normalizeKeywordList(payloadPatch.includeKeywords),
    excludeKeywords: payloadPatch.excludeKeywords === undefined ? currentPayload.excludeKeywords : normalizeKeywordList(payloadPatch.excludeKeywords),
    industries: payloadPatch.industries === undefined ? currentPayload.industries : normalizeAllowedList(payloadPatch.industries, VALID_INDUSTRIES),
    companySizes: payloadPatch.companySizes === undefined ? currentPayload.companySizes : normalizeAllowedList(payloadPatch.companySizes, VALID_COMPANY_SIZES),
    roles: payloadPatch.roles === undefined ? currentPayload.roles : normalizeAllowedList(payloadPatch.roles, VALID_ROLES),
    excludedIndustries: payloadPatch.excludedIndustries === undefined ? currentPayload.excludedIndustries : normalizeAllowedList(payloadPatch.excludedIndustries, VALID_INDUSTRIES),
    excludedLocations: payloadPatch.excludedLocations === undefined ? currentPayload.excludedLocations : normalizeStringList(payloadPatch.excludedLocations),
    dailyDigestLimit: payloadPatch.dailyDigestLimit === undefined ? currentPayload.dailyDigestLimit : normalizeDailyDigestLimit(payloadPatch.dailyDigestLimit),
    paymentProviderPayload: payloadPatch.paymentProviderPayload === undefined ? currentPayload.paymentProviderPayload : normalizePayloadObject(payloadPatch.paymentProviderPayload)
  };
}

function optionalPatch(value: string | null | undefined, current: string | null): string | null {
  return value === undefined ? current : normalizeOptionalText(value);
}

function normalizeAllowedList(value: unknown, allowed: ReadonlySet<string>): string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string" && allowed.has(item))
    : [];
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : [];
}

export function normalizeCheckoutOrderId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) throw new Error(CUSTOMER_CHECKOUT_COPY.invalidOrderId);
  return normalizedValue;
}

function normalizeCheckoutOrderStatus(value: string): CheckoutOrderStatus {
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");
  return (CHECKOUT_ORDER_STATUSES as readonly string[]).includes(normalizedValue)
    ? (normalizedValue as CheckoutOrderStatus)
    : "failed";
}

export function normalizeLinkedClientProfileId(value: string | number): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) throw new Error("Invalid client profile id.");
  return normalizedValue;
}

function normalizeCheckoutOrderOnboardingStatus(value: string | CheckoutOrderOnboardingStatus | null | undefined): CheckoutOrderOnboardingStatus {
  if (typeof value !== "string") return "inactive";
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");
  return (CHECKOUT_ORDER_ONBOARDING_STATUSES as readonly string[]).includes(normalizedValue)
    ? (normalizedValue as CheckoutOrderOnboardingStatus)
    : "inactive";
}

function normalizeCheckoutOrderOnboardingStep(value: string | CheckoutOrderOnboardingStep | null | undefined): CheckoutOrderOnboardingStep {
  if (typeof value !== "string") return "confirm-profile";
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");
  return (CHECKOUT_ORDER_ONBOARDING_STEPS as readonly string[]).includes(normalizedValue)
    ? (normalizedValue as CheckoutOrderOnboardingStep)
    : "confirm-profile";
}

function normalizeProductCode(value: string): PublicPlanCode {
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");
  if (isPublicPlanCode(normalizedValue)) return normalizedValue;
  return normalizeLegacyPlanCode(normalizedValue);
}

export function normalizeSiteUrl(value: string): string {
  return normalizeRequiredText(value, "Site URL is required.").replace(/\/+$/, "");
}

export function normalizeCurrency(value: string): string {
  return normalizeRequiredText(value, "Currency is required.").toLocaleUpperCase("en-US");
}

export function normalizeRequiredText(value: string | null | undefined, message: string): string {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) throw new Error(message);
  return normalizedValue;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalizedValue = value.trim();
  return normalizedValue === "" ? null : normalizedValue;
}

export function normalizeTelegramChatIdCandidate(value: string | null | undefined): string | null {
  const normalizedValue = normalizeOptionalText(value);
  return normalizedValue && /^-?\d+$/.test(normalizedValue) ? normalizedValue : null;
}

export function normalizeDailyDigestLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  const normalizedValue = Math.trunc(value);
  return normalizedValue <= 0 ? 5 : Math.min(normalizedValue, 10);
}

export function normalizeKeywordList(value: unknown): string[] {
  if (Array.isArray(value)) return parseKeywordText(value.join(","));
  if (typeof value === "string") return parseKeywordText(value);
  return [];
}

export function areKeywordListsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizePayloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const normalizedMessage = error.message.trim();
    return normalizedMessage === "" ? "Не получилось открыть оплату." : normalizedMessage;
  }
  return "Не получилось открыть оплату.";
}

export function normalizeCheckoutOrderUserId(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Invalid checkout order owner.");
  return parsed;
}

export function buildPaidOrderProfileSeed(order: CheckoutOrder): {
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

export function doesClientProfileNeedSync(
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
