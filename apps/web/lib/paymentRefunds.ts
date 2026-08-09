import {
  createRobokassaRefund,
  getRobokassaRefundState,
} from "./paymentsRobokassaRefunds";
import { getCheckoutOrderByIdForOwner, getPool } from "./paymentsRepo";

export type PaymentRefundStatus =
  | "creating"
  | "requested"
  | "processing"
  | "succeeded"
  | "failed";

export type PaymentRefund = {
  id: string;
  orderId: string;
  provider: string;
  providerRefundId: string | null;
  amountMinor: number;
  isFull: boolean;
  status: PaymentRefundStatus;
  requestedBy: string;
  providerPayload: Record<string, unknown>;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PaymentRefundRow = {
  id: string;
  orderId: string;
  provider: string;
  providerRefundId: string | null;
  amountMinor: string | number;
  isFull: boolean;
  status: PaymentRefundStatus;
  requestedBy: string;
  providerPayload: unknown;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listPaymentRefunds(limit = 100): Promise<PaymentRefund[]> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const result = await pool.query<PaymentRefundRow>(
    `SELECT
       id::TEXT AS id,
       order_id::TEXT AS "orderId",
       provider,
       provider_refund_id AS "providerRefundId",
       amount_minor AS "amountMinor",
       is_full AS "isFull",
       status,
       requested_by AS "requestedBy",
       provider_payload AS "providerPayload",
       error_message AS "errorMessage",
       completed_at::TEXT AS "completedAt",
       created_at::TEXT AS "createdAt",
       updated_at::TEXT AS "updatedAt"
     FROM payment_refunds
     ORDER BY created_at DESC
     LIMIT $1`,
    [normalizedLimit],
  );
  return result.rows.map(mapRefundRow);
}

export async function requestRobokassaRefund(input: {
  orderId: string | number;
  workspaceId: string | number;
  entitlementOwnerId: string | number;
  amountMinor?: number | null;
  requestedBy: string;
}): Promise<PaymentRefund> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const requestedBy = input.requestedBy.trim().slice(0, 160);
  if (!requestedBy) throw new Error("Refund requester is required.");

  const client = await pool.connect();
  let refund: PaymentRefund;
  let opKey: string;
  let orderAmountMinor: number;

  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{
      id: string;
      amountMinor: string | number;
      status: string;
      provider: string | null;
      providerPayload: unknown;
    }>(
      `SELECT
         id::TEXT AS id,
         (amount_rub::BIGINT * 100) AS "amountMinor",
         status,
         provider,
         payload->'paymentProviderPayload' AS "providerPayload"
       FROM checkout_orders
       WHERE id = $1
         AND workspace_id = $2
         AND entitlement_owner_id = $3
       FOR UPDATE`,
      [String(input.orderId), String(input.workspaceId), String(input.entitlementOwnerId)],
    );

    if (orderResult.rowCount !== 1) throw new Error("Заказ не найден.");
    const order = orderResult.rows[0];
    if (order.status !== "paid") throw new Error("Возврат доступен только для оплаченного заказа.");
    if (order.provider !== "robokassa") throw new Error("Заказ оплачен не через Robokassa.");

    orderAmountMinor = Number(order.amountMinor);
    if (!Number.isSafeInteger(orderAmountMinor) || orderAmountMinor <= 0) {
      throw new Error("Некорректная сумма заказа.");
    }

    const providerPayload = normalizeObject(order.providerPayload);
    opKey = typeof providerPayload.opKey === "string" ? providerPayload.opKey.trim() : "";
    if (!opKey) throw new Error("У платежа отсутствует Robokassa OpKey. Сначала выполните live-сверку операции.");

    const amountMinor = input.amountMinor == null
      ? orderAmountMinor
      : normalizePositiveMinor(input.amountMinor);
    const insert = await client.query<PaymentRefundRow>(
      `INSERT INTO payment_refunds (
         order_id,
         provider,
         amount_minor,
         is_full,
         status,
         requested_by,
         provider_payload
       )
       VALUES ($1, 'robokassa', $2, $3, 'creating', $4, $5::jsonb)
       RETURNING
         id::TEXT AS id,
         order_id::TEXT AS "orderId",
         provider,
         provider_refund_id AS "providerRefundId",
         amount_minor AS "amountMinor",
         is_full AS "isFull",
         status,
         requested_by AS "requestedBy",
         provider_payload AS "providerPayload",
         error_message AS "errorMessage",
         completed_at::TEXT AS "completedAt",
         created_at::TEXT AS "createdAt",
         updated_at::TEXT AS "updatedAt"`,
      [
        order.id,
        amountMinor,
        amountMinor === orderAmountMinor,
        requestedBy,
        JSON.stringify({ opKey, requestedAmountMinor: amountMinor }),
      ],
    );
    refund = mapRefundRow(insert.rows[0]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    const created = await createRobokassaRefund({
      opKey,
      orderAmountMinor,
      amountMinor: refund.amountMinor,
    });

    if (!created.ok) {
      return markRefundFailed(refund.id, created.message);
    }

    return updateRefund(refund.id, {
      status: "requested",
      providerRefundId: created.requestId,
      providerPayload: created.providerPayload,
      errorMessage: null,
    });
  } catch (error) {
    return markRefundFailed(
      refund.id,
      error instanceof Error ? error.message : "Robokassa refund request failed.",
    );
  }
}

export async function syncRobokassaRefund(refundId: string | number): Promise<PaymentRefund> {
  const refund = await getPaymentRefund(refundId);
  if (!refund) throw new Error("Возврат не найден.");
  if (!refund.providerRefundId) throw new Error("У возврата отсутствует requestId Robokassa.");
  if (refund.status === "succeeded" || refund.status === "failed") return refund;

  try {
    const state = await getRobokassaRefundState(refund.providerRefundId);
    if (state.finished) {
      if (state.amountMinor !== null && state.amountMinor !== refund.amountMinor) {
        return markRefundFailed(refund.id, "Robokassa вернула другую сумму возврата.");
      }
      return updateRefund(refund.id, {
        status: "succeeded",
        providerPayload: { ...refund.providerPayload, state },
        errorMessage: null,
      });
    }
    if (state.failed) {
      return markRefundFailed(refund.id, state.message ?? `Robokassa refund state: ${state.label}`);
    }
    return updateRefund(refund.id, {
      status: "processing",
      providerPayload: { ...refund.providerPayload, state },
      errorMessage: null,
    });
  } catch (error) {
    return updateRefund(refund.id, {
      status: refund.status === "requested" ? "requested" : "processing",
      providerPayload: refund.providerPayload,
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Refund state check failed.",
    });
  }
}

export async function getPaymentRefund(refundId: string | number): Promise<PaymentRefund | null> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<PaymentRefundRow>(
    `SELECT
       id::TEXT AS id,
       order_id::TEXT AS "orderId",
       provider,
       provider_refund_id AS "providerRefundId",
       amount_minor AS "amountMinor",
       is_full AS "isFull",
       status,
       requested_by AS "requestedBy",
       provider_payload AS "providerPayload",
       error_message AS "errorMessage",
       completed_at::TEXT AS "completedAt",
       created_at::TEXT AS "createdAt",
       updated_at::TEXT AS "updatedAt"
     FROM payment_refunds
     WHERE id = $1
     LIMIT 1`,
    [String(refundId)],
  );
  return result.rowCount === 1 ? mapRefundRow(result.rows[0]) : null;
}

async function markRefundFailed(refundId: string, message: string): Promise<PaymentRefund> {
  return updateRefund(refundId, {
    status: "failed",
    providerPayload: null,
    errorMessage: message.slice(0, 500),
  });
}

async function updateRefund(
  refundId: string,
  input: {
    status: PaymentRefundStatus;
    providerRefundId?: string | null;
    providerPayload: Record<string, unknown> | null;
    errorMessage: string | null;
  },
): Promise<PaymentRefund> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<PaymentRefundRow>(
    `UPDATE payment_refunds
     SET status = $2,
         provider_refund_id = COALESCE($3, provider_refund_id),
         provider_payload = CASE
           WHEN $4::jsonb IS NULL THEN provider_payload
           ELSE provider_payload || $4::jsonb
         END,
         error_message = $5
     WHERE id = $1
     RETURNING
       id::TEXT AS id,
       order_id::TEXT AS "orderId",
       provider,
       provider_refund_id AS "providerRefundId",
       amount_minor AS "amountMinor",
       is_full AS "isFull",
       status,
       requested_by AS "requestedBy",
       provider_payload AS "providerPayload",
       error_message AS "errorMessage",
       completed_at::TEXT AS "completedAt",
       created_at::TEXT AS "createdAt",
       updated_at::TEXT AS "updatedAt"`,
    [
      refundId,
      input.status,
      input.providerRefundId ?? null,
      input.providerPayload ? JSON.stringify(input.providerPayload) : null,
      input.errorMessage,
    ],
  );
  if (result.rowCount !== 1) throw new Error("Не удалось обновить возврат.");
  return mapRefundRow(result.rows[0]);
}

function mapRefundRow(row: PaymentRefundRow): PaymentRefund {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    providerRefundId: row.providerRefundId,
    amountMinor: Number(row.amountMinor),
    isFull: row.isFull,
    status: row.status,
    requestedBy: row.requestedBy,
    providerPayload: normalizeObject(row.providerPayload),
    errorMessage: row.errorMessage,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizePositiveMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Сумма возврата должна быть положительным целым числом копеек.");
  }
  return value;
}

export async function getRefundableOrder(input: {
  orderId: string | number;
  workspaceId: string | number;
  entitlementOwnerId: string | number;
}) {
  return getCheckoutOrderByIdForOwner(input.orderId, input);
}
