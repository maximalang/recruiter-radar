import { getPool } from "./paymentsRepo";

export type RefundableRobokassaOrder = {
  id: string;
  workspaceId: string;
  entitlementOwnerId: string;
  productCode: string;
  planName: string;
  amountMinor: number;
  reservedMinor: number;
  succeededMinor: number;
  availableMinor: number;
  status: "paid" | "refunded";
  customerName: string | null;
  customerContact: string | null;
  paidAt: string | null;
  opKey: string | null;
};

type RefundableOrderRow = {
  id: string;
  workspaceId: string;
  entitlementOwnerId: string;
  productCode: string;
  planName: string | null;
  amountMinor: string | number;
  reservedMinor: string | number;
  succeededMinor: string | number;
  status: "paid" | "refunded";
  customerName: string | null;
  customerContact: string | null;
  paidAt: string | null;
  opKey: string | null;
};

export async function listRefundableRobokassaOrders(limit = 100): Promise<RefundableRobokassaOrder[]> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);

  const result = await pool.query<RefundableOrderRow>(
    `SELECT
       checkout.id::TEXT AS id,
       checkout.workspace_id::TEXT AS "workspaceId",
       checkout.entitlement_owner_id::TEXT AS "entitlementOwnerId",
       checkout.plan_code AS "productCode",
       checkout.payload->>'planName' AS "planName",
       (checkout.amount_rub::BIGINT * 100) AS "amountMinor",
       COALESCE(SUM(refund.amount_minor) FILTER (
         WHERE refund.status IN ('creating', 'requested', 'processing', 'succeeded')
       ), 0) AS "reservedMinor",
       COALESCE(SUM(refund.amount_minor) FILTER (
         WHERE refund.status = 'succeeded'
       ), 0) AS "succeededMinor",
       checkout.status,
       checkout.customer_name AS "customerName",
       checkout.customer_contact AS "customerContact",
       checkout.paid_at::TEXT AS "paidAt",
       checkout.payload->'paymentProviderPayload'->>'opKey' AS "opKey"
     FROM checkout_orders AS checkout
     LEFT JOIN payment_refunds AS refund ON refund.order_id = checkout.id
     WHERE checkout.provider = 'robokassa'
       AND checkout.status IN ('paid', 'refunded')
     GROUP BY checkout.id
     ORDER BY checkout.paid_at DESC NULLS LAST, checkout.id DESC
     LIMIT $1`,
    [normalizedLimit],
  );

  return result.rows.map((row) => {
    const amountMinor = toSafeMinor(row.amountMinor);
    const reservedMinor = toSafeMinor(row.reservedMinor);
    const succeededMinor = toSafeMinor(row.succeededMinor);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      entitlementOwnerId: row.entitlementOwnerId,
      productCode: row.productCode,
      planName: row.planName?.trim() || row.productCode,
      amountMinor,
      reservedMinor,
      succeededMinor,
      availableMinor: Math.max(0, amountMinor - reservedMinor),
      status: row.status,
      customerName: row.customerName,
      customerContact: row.customerContact,
      paidAt: row.paidAt,
      opKey: row.opKey?.trim() || null,
    };
  });
}

function toSafeMinor(value: string | number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid payment amount returned from database.");
  }
  return number;
}
