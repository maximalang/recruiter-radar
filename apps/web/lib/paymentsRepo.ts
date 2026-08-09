import { type Pool } from "pg";
import { getPool as getSharedPool } from "./db-pool";

import {
  createPilotApplication,
  findMatchingClientProfileForCheckoutOrder,
  getClientProfileById,
  saveClientProfile,
  type ClientProfile
} from "./clientProfiles";
import { buildPilotApplicationComment } from "./publicProduct";
import {
  type PublicPlan
} from "./pricingCatalog";
import { CUSTOMER_CHECKOUT_COPY } from "./copy/customer";
import {
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
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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
  input: { workspaceId: string | number; entitlementOwnerId: string | number },
): Promise<CheckoutOrder | null> {
  const normalizedOrderId = normalizeCheckoutOrderId(orderId);
  const workspaceId = normalizeCheckoutOrderUserId(input.workspaceId);
  const entitlementOwnerId = normalizeCheckoutOrderUserId(input.entitlementOwnerId);
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<CheckoutOrderRow>(`
    SELECT
      id::TEXT AS id,
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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
      AND workspace_id = $2
      AND entitlement_owner_id = $3
    LIMIT 1
  `, [normalizedOrderId, workspaceId, entitlementOwnerId]);

  return result.rowCount === 1 ? mapCheckoutOrderRow(result.rows[0]) : null;
}

export async function listCheckoutOrdersForOwner(
  input: {
    workspaceId: string | number;
    entitlementOwnerId: string | number;
    limit?: number;
  },
): Promise<CheckoutOrder[]> {
  const workspaceId = normalizeCheckoutOrderUserId(input.workspaceId);
  const entitlementOwnerId = normalizeCheckoutOrderUserId(input.entitlementOwnerId);
  const normalizedLimit = Number.isInteger(input.limit) && input.limit! > 0 && input.limit! <= 100
    ? input.limit!
    : 20;
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query<CheckoutOrderRow>(`
    SELECT
      id::TEXT AS id,
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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
    WHERE workspace_id = $1
      AND entitlement_owner_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
  `, [workspaceId, entitlementOwnerId, normalizedLimit]);

  return result.rows.map(mapCheckoutOrderRow);
}

export async function listCheckoutOrdersForAccess(input: {
  workspaceId: string | number;
  entitlementOwnerId: string | number;
  limit?: number;
}): Promise<CheckoutOrder[]> {
  const workspaceId = normalizeCheckoutOrderUserId(input.workspaceId);
  const entitlementOwnerId = normalizeCheckoutOrderUserId(input.entitlementOwnerId);
  const limit = Number.isInteger(input.limit) && input.limit! > 0 && input.limit! <= 100
    ? input.limit!
    : 20;
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query<CheckoutOrderRow>(`
    SELECT
      id::TEXT AS id,
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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
    WHERE workspace_id = $1 AND entitlement_owner_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
  `, [workspaceId, entitlementOwnerId, limit]);

  return result.rows.map(mapCheckoutOrderRow);
}

export async function createCheckoutOrder(input: {
  purchasedByUserId: string | number;
  workspaceId: string | number;
  entitlementOwnerId: string | number;
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
      purchased_by_user_id,
      workspace_id,
      entitlement_owner_id,
      plan_code,
      amount_rub,
      currency,
      status,
      customer_name,
      customer_contact,
      payload
    )
    VALUES ($3, $1, $2, $3, $4, ($5 / 100), $6, 'created', $7, $8, $9::jsonb)
    RETURNING
      id::TEXT AS id,
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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
    normalizeCheckoutOrderUserId(input.purchasedByUserId),
    normalizeCheckoutOrderUserId(input.workspaceId),
    normalizeCheckoutOrderUserId(input.entitlementOwnerId),
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
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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
      purchased_by_user_id::TEXT AS "purchasedByUserId",
      workspace_id::TEXT AS "workspaceId",
      entitlement_owner_id::TEXT AS "entitlementOwnerId",
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

export async function ensurePaidOrderEntitlement(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<void> {
  if (order.status !== "paid") {
    return;
  }

  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await pool.query(`
    WITH paid_order AS MATERIALIZED (
      SELECT
        id,
        workspace_id,
        entitlement_owner_id,
        plan_code,
        paid_at,
        CASE plan_code
          WHEN 'pilot' THEN 7
          WHEN 'monthly' THEN 30
          WHEN 'quarterly' THEN 90
          ELSE NULL
        END AS duration_days
      FROM checkout_orders
      WHERE id = $1
        AND status = 'paid'
        AND paid_at IS NOT NULL
      LIMIT 1
    ),
    locked_order AS MATERIALIZED (
      SELECT
        paid_order.*,
        pg_advisory_xact_lock(
          hashtextextended(
            'checkout-entitlement:' || paid_order.workspace_id::TEXT || ':'
              || paid_order.entitlement_owner_id::TEXT,
            0::BIGINT
          )
        ) AS owner_lock
      FROM paid_order
      WHERE duration_days IS NOT NULL
    ),
    access_start AS (
      SELECT GREATEST(
        locked_order.paid_at,
        COALESCE(
          MAX(entitlement.ends_at) FILTER (
            WHERE entitlement.revoked_at IS NULL
              AND checkout.status = 'paid'
          ),
          locked_order.paid_at
        )
      ) AS starts_at
      FROM locked_order
      LEFT JOIN checkout_order_entitlements entitlement
        ON entitlement.workspace_id = locked_order.workspace_id
       AND entitlement.entitlement_owner_id = locked_order.entitlement_owner_id
      LEFT JOIN checkout_orders checkout ON checkout.id = entitlement.order_id
      GROUP BY locked_order.paid_at
    )
    INSERT INTO checkout_order_entitlements (
      order_id,
      user_id,
      workspace_id,
      entitlement_owner_id,
      plan_code,
      duration_days,
      starts_at,
      ends_at
    )
    SELECT
      locked_order.id,
      locked_order.entitlement_owner_id,
      locked_order.workspace_id,
      locked_order.entitlement_owner_id,
      locked_order.plan_code,
      locked_order.duration_days,
      ast.starts_at,
      ast.starts_at + (locked_order.duration_days * INTERVAL '1 day')
    FROM locked_order
    CROSS JOIN access_start ast
    ON CONFLICT (order_id) DO NOTHING
  `, [normalizeCheckoutOrderId(order.id)]);
}

export async function ensurePilotApplicationForOrder(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<CheckoutOrder> {
  if (order.productCode !== "pilot" || order.payload.pilotApplicationId) {
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

/**
 * Legacy name retained for the current onboarding URLs. Any paid plan receives
 * its entitlement and linked profile through the same verified payment flow.
 */
export async function ensurePaidPilotOrderReady(
  order: CheckoutOrder,
  db?: PaymentsDbClient
): Promise<CheckoutOrder> {
  if (order.status !== "paid") {
    return order;
  }

  await ensurePaidOrderEntitlement(order, db);
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
    ? await getClientProfileById(order.payload.clientProfileId, null, db).catch(() => null)
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

  const profile = await getClientProfileById(clientProfileId, null, db);

  if (!profile) {
    throw new Error("Client profile not found.");
  }

  return profile;
}
