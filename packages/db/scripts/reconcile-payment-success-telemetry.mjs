import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

export const PAYMENT_SUCCESS_RECONCILIATION_SQL = `
  INSERT INTO product_telemetry_events (
    event_name,
    event_key,
    owner_id,
    checkout_order_id,
    provider,
    outcome,
    metadata,
    occurred_at
  )
  SELECT
    'payment_succeeded',
    'payment-succeeded:' || checkout_order.id,
    checkout_order.user_id,
    checkout_order.id,
    checkout_order.provider,
    checkout_order.status,
    jsonb_build_object(
      'planCode', checkout_order.plan_code,
      'currency', checkout_order.currency
    ),
    COALESCE(checkout_order.paid_at, checkout_order.updated_at, NOW())
  FROM checkout_orders AS checkout_order
  WHERE checkout_order.status = 'paid'
    AND NOT EXISTS (
      SELECT 1
      FROM product_telemetry_events AS telemetry_event
      WHERE telemetry_event.event_key =
        'payment-succeeded:' || checkout_order.id
    )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id
`;

export async function reconcilePaymentSuccessTelemetry(db) {
  const result = await db.query(PAYMENT_SUCCESS_RECONCILIATION_SQL);
  return result.rowCount ?? 0;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for payment telemetry reconciliation.",
    );
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const insertedCount = await reconcilePaymentSuccessTelemetry(client);
    console.log(JSON.stringify({ ok: true, insertedCount }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Payment telemetry reconciliation failed: ${reason}`);
    process.exitCode = 1;
  });
}
