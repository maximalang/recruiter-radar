import { pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

export const PAYMENT_SUCCESS_RECONCILIATION_SQL = `
  WITH paid_orders AS MATERIALIZED (
    SELECT
      id,
      user_id,
      provider,
      status,
      plan_code,
      currency,
      paid_at,
      updated_at
    FROM checkout_orders
    WHERE status = 'paid'
  ),
  inserted_events AS (
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
      'payment-succeeded:' || paid_order.id,
      paid_order.user_id,
      paid_order.id,
      paid_order.provider,
      paid_order.status,
      jsonb_build_object(
        'planCode', paid_order.plan_code,
        'currency', paid_order.currency
      ),
      COALESCE(paid_order.paid_at, paid_order.updated_at, NOW())
    FROM paid_orders AS paid_order
    WHERE NOT EXISTS (
      SELECT 1
      FROM product_telemetry_events AS telemetry_event
      WHERE telemetry_event.event_key =
        'payment-succeeded:' || paid_order.id
    )
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*)::int FROM paid_orders) AS scanned,
    (SELECT COUNT(*)::int FROM inserted_events) AS inserted
`;

async function runPaymentSuccessTelemetryReconciliation(db) {
  const result = await db.query(PAYMENT_SUCCESS_RECONCILIATION_SQL);
  const scanned = Number(result.rows[0]?.scanned ?? 0);
  const inserted = Number(result.rows[0]?.inserted ?? 0);
  return {
    scanned,
    inserted,
    already_present: Math.max(0, scanned - inserted),
    failed: 0,
  };
}

export async function reconcilePaymentSuccessTelemetry(db) {
  const summary = await runPaymentSuccessTelemetryReconciliation(db);
  return summary.inserted;
}

export async function summarizePaymentSuccessTelemetry(db) {
  return runPaymentSuccessTelemetryReconciliation(db);
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
    statement_timeout: 30_000,
    query_timeout: 35_000,
  });
  try {
    await client.connect();
    const summary = await summarizePaymentSuccessTelemetry(client);
    console.log(JSON.stringify({ ok: true, ...summary }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      JSON.stringify({
        ok: false,
        scanned: 0,
        inserted: 0,
        already_present: 0,
        failed: 1,
      }),
    );
    process.exitCode = 1;
  });
}
