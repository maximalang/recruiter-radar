import { type Pool } from "pg";
import { getPool as getSharedPool } from "./db-pool";

import {
  createPilotApplication,
  findMatchingClientProfileForCheckoutOrder,
  getClientProfileById,
  saveClientProfile,
  type ClientProfile
} from "./clientProfiles";
import {
  buildPilotApplicationComment,
  type PublicPlan
} from "./publicProduct";
import { CUSTOMER_CHECKOUT_COPY } from "./copy/customer";
import {
  PILOT_ENTITLEMENT_DAYS,
  type CheckoutOrder,
  type CheckoutOrderPayload,
  type CheckoutOrderRow,
  type PaymentsDbClient,
  type UpdateCheckoutOrderInput
} from "./paymentsTypes";
import {
  buildPaidOrderProfileSeed,
  doesClientProfileNeedSync,
  mapCheckoutOrderRow,
  mergeCheckoutOrderPayload,
  normalizeCheckoutOrderId,
  normalizeCheckoutOrderUserId,
  normalizeCurrency,
  normalizeOptionalText,
  normalizeRequiredText
} from "./paymentsNormalize";

export function getPool(): Pool | null {
  return getSharedPool();
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

export async function getCheckoutOrderByIdForOwner(
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

export async function createCheckoutOrder(input: {
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

export async function updateCheckoutOrder(
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

export async function getCheckoutOrderByProviderPaymentId(
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

export async function ensurePilotEntitlementForPaidOrder(
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

export async function ensurePilotApplicationForOrder(
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

export async function ensurePaidPilotOrderReady(
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

export async function ensureClientProfileForPaidOrder(
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

export async function getRequiredOrderClientProfile(
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
