import assert from "node:assert/strict";

import pg from "pg";

import {
  reconcilePaymentSuccessTelemetry,
  summarizePaymentSuccessTelemetry,
} from "./reconcile-payment-success-telemetry.mjs";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required for the payment telemetry integration test.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
});

const initialStatuses = ["pending", "canceled", "failed", "processing"];

try {
  await client.connect();
  await client.query("BEGIN");

  const emptySummary = await summarizePaymentSuccessTelemetry(client);
  assert.deepEqual(
    emptySummary,
    {
      scanned: 0,
      inserted: 0,
      already_present: 0,
      failed: 0,
    },
    "reconciliation must succeed when there are no paid orders",
  );

  const userResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, $2)
     RETURNING id`,
    ["payment-telemetry-test@example.invalid", "Telemetry Test User"],
  );
  const userId = userResult.rows[0].id;

  for (const initialStatus of initialStatuses) {
    const orderResult = await client.query(
      `INSERT INTO checkout_orders (
         user_id,
         purchased_by_user_id,
         entitlement_owner_id,
         plan_code,
         amount_rub,
         currency,
         status,
         customer_name,
         customer_contact,
         payload,
         provider
       )
       VALUES ($1, $1, $1, 'pilot', 1000, 'RUB', $2, $3, $4, $5::jsonb, 'test-provider')
       RETURNING id`,
      [
        userId,
        initialStatus,
        "Sensitive Test Name",
        "sensitive@example.invalid",
        JSON.stringify({
          specialization: "industrial recruitment",
          geography: "Moscow",
          includeKeywords: ["private keyword"],
        }),
      ],
    );
    const checkoutOrderId = orderResult.rows[0].id;

    await client.query(
      `UPDATE checkout_orders
       SET status = 'paid', paid_at = NOW()
       WHERE id = $1`,
      [checkoutOrderId],
    );

    const firstTransition = await client.query(
      `SELECT event_name, event_key, checkout_order_id, metadata
       FROM product_telemetry_events
       WHERE event_name = 'payment_succeeded'
         AND checkout_order_id = $1`,
      [checkoutOrderId],
    );

    assert.equal(
      firstTransition.rowCount,
      1,
      `${initialStatus} -> paid must create exactly one payment_succeeded event`,
    );
    assert.equal(
      firstTransition.rows[0].event_key,
      `payment-succeeded:${checkoutOrderId}`,
    );
    assert.equal(
      String(firstTransition.rows[0].checkout_order_id),
      String(checkoutOrderId),
    );

    const serializedEvent = JSON.stringify(firstTransition.rows[0]);
    for (const forbiddenValue of [
      "Sensitive Test Name",
      "sensitive@example.invalid",
      "industrial recruitment",
      "Moscow",
      "private keyword",
    ]) {
      assert.equal(
        serializedEvent.includes(forbiddenValue),
        false,
        `telemetry must not copy personal/profile value: ${forbiddenValue}`,
      );
    }

    await client.query(
      `UPDATE checkout_orders
       SET status = 'paid'
       WHERE id = $1`,
      [checkoutOrderId],
    );
    await client.query(
      `UPDATE checkout_orders
       SET status = 'paid', provider_payment_id = 'replayed-webhook'
       WHERE id = $1`,
      [checkoutOrderId],
    );

    const repeatedTransition = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM product_telemetry_events
       WHERE event_name = 'payment_succeeded'
         AND checkout_order_id = $1`,
      [checkoutOrderId],
    );
    assert.equal(
      repeatedTransition.rows[0].count,
      1,
      "paid -> paid and webhook replay must not create duplicate telemetry",
    );
  }

  const failureOrderResult = await client.query(
    `INSERT INTO checkout_orders (
       user_id,
       purchased_by_user_id,
       entitlement_owner_id,
       plan_code,
       amount_rub,
       currency,
       status,
       customer_name,
       customer_contact,
       payload,
       provider
     )
     VALUES ($1, $1, $1, 'pilot', 1000, 'RUB', 'pending', $2, $3, '{}'::jsonb, 'test-provider')
     RETURNING id`,
    [
      userId,
      "Telemetry Failure Test",
      "telemetry-failure@example.invalid",
    ],
  );
  const failureOrderId = failureOrderResult.rows[0].id;

  await client.query(`
    CREATE OR REPLACE FUNCTION pg_temp.reject_payment_success_telemetry()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.checkout_order_id = '${failureOrderId}'::bigint THEN
        RAISE EXCEPTION 'controlled payment telemetry insert failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await client.query(`
    CREATE TRIGGER test_reject_payment_success_telemetry
    BEFORE INSERT ON product_telemetry_events
    FOR EACH ROW
    WHEN (NEW.event_name = 'payment_succeeded')
    EXECUTE FUNCTION pg_temp.reject_payment_success_telemetry()
  `);

  await client.query(
    `UPDATE checkout_orders
     SET status = 'paid', paid_at = NOW()
     WHERE id = $1`,
    [failureOrderId],
  );
  const paidDespiteTelemetryFailure = await client.query(
    `SELECT status
     FROM checkout_orders
     WHERE id = $1`,
    [failureOrderId],
  );
  assert.equal(
    paidDespiteTelemetryFailure.rows[0].status,
    "paid",
    "a telemetry insert failure must not roll back the paid transition",
  );

  await client.query(
    "DROP TRIGGER test_reject_payment_success_telemetry ON product_telemetry_events",
  );
  const missingBeforeReconciliation = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM product_telemetry_events
     WHERE event_key = $1`,
    [`payment-succeeded:${failureOrderId}`],
  );
  assert.equal(missingBeforeReconciliation.rows[0].count, 0);

  const firstReconciliationCount =
    await reconcilePaymentSuccessTelemetry(client);
  const secondReconciliationCount =
    await reconcilePaymentSuccessTelemetry(client);
  assert.equal(
    firstReconciliationCount,
    1,
    "reconciliation must restore the missing payment telemetry event",
  );
  assert.equal(
    secondReconciliationCount,
    0,
    "reconciliation must be idempotent",
  );
  const finalSummary = await summarizePaymentSuccessTelemetry(client);
  assert.deepEqual(
    finalSummary,
    {
      scanned: initialStatuses.length + 1,
      inserted: 0,
      already_present: initialStatuses.length + 1,
      failed: 0,
    },
    "reconciliation summary must be count-only and idempotent",
  );

  console.log(
    JSON.stringify({
      ok: true,
      transitions: initialStatuses.map((status) => `${status}->paid`),
      duplicateProtection: ["paid->paid", "webhook-replay"],
      telemetryFailureDoesNotBlockPayment: true,
      reconciliation: {
        emptySummary,
        firstRunInserted: firstReconciliationCount,
        secondRunInserted: secondReconciliationCount,
        finalSummary,
      },
      privacyValuesCopied: false,
    }),
  );
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end().catch(() => undefined);
}
