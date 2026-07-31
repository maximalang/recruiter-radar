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

async function expectStatementFailure({ savepoint, sql, params, messagePattern }) {
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await client.query(sql, params);
  } catch (error) {
    rejected = true;
    assert.match(
      error instanceof Error ? error.message : String(error),
      messagePattern,
      `${savepoint} must fail for the expected database invariant`,
    );
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
  assert.equal(rejected, true, `${savepoint} unexpectedly succeeded`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
}

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

  const yookassaUserResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, $2)
     RETURNING id`,
    ["yookassa-contract-test@example.invalid", "YooKassa Contract User"],
  );
  const yookassaUserId = yookassaUserResult.rows[0].id;

  for (const initialStatus of initialStatuses) {
    const orderResult = await client.query(
      `INSERT INTO checkout_orders (
         user_id,
         plan_code,
         amount_rub,
         currency,
         status,
         customer_name,
         customer_contact,
         payload,
         provider
       )
       VALUES ($1, 'pilot', 1000, 'RUB', $2, $3, $4, $5::jsonb, 'test-provider')
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

  const verifiedYooKassaPayload = {
    paymentProviderPayload: {
      id: "payment-yookassa-verified",
      status: "succeeded",
      paid: true,
      amount: { value: "2990.00", currency: "RUB" },
      refundedAmount: { value: "0.00", currency: "RUB" },
      test: true,
    },
  };
  const yooKassaOrderResult = await client.query(
    `INSERT INTO checkout_orders (
       user_id,
       plan_code,
       amount_rub,
       currency,
       status,
       customer_name,
       customer_contact,
       payload,
       provider,
       provider_payment_id
     )
     VALUES ($1, 'pilot', 2990, 'RUB', 'pending', $2, $3, $4::jsonb, 'yookassa', 'payment-yookassa-verified')
     RETURNING id`,
    [
      yookassaUserId,
      "YooKassa Contract Test",
      "yookassa-contract@example.invalid",
      JSON.stringify(verifiedYooKassaPayload),
    ],
  );
  const yooKassaOrderId = yooKassaOrderResult.rows[0].id;

  await client.query(
    `UPDATE checkout_orders
     SET status = 'paid', paid_at = NOW()
     WHERE id = $1`,
    [yooKassaOrderId],
  );
  const verifiedPaidOrder = await client.query(
    `SELECT status, amount_rub, currency
     FROM checkout_orders
     WHERE id = $1`,
    [yooKassaOrderId],
  );
  assert.deepEqual(
    verifiedPaidOrder.rows[0],
    { status: "paid", amount_rub: 2990, currency: "RUB" },
    "verified YooKassa amount and currency must permit pending -> paid",
  );

  await expectStatementFailure({
    savepoint: "paid_downgrade_guard",
    sql: "UPDATE checkout_orders SET status = 'pending' WHERE id = $1",
    params: [yooKassaOrderId],
    messagePattern: /cannot be downgraded/,
  });

  const enrollmentResult = await client.query(
    `INSERT INTO pilot_enrollments (user_id, status, starts_at, ends_at, activated_by, notes)
     VALUES ($1, 'active', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '6 days', 'yookassa_contract_test', 'before_full_refund')
     RETURNING id`,
    [yookassaUserId],
  );
  const enrollmentId = enrollmentResult.rows[0].id;

  const refundedPayload = {
    ...verifiedYooKassaPayload,
    paymentProviderPayload: {
      ...verifiedYooKassaPayload.paymentProviderPayload,
      refundedAmount: { value: "2990.00", currency: "RUB" },
      refund: {
        id: "refund-yookassa-verified",
        status: "succeeded",
        amount: { value: "2990.00", currency: "RUB" },
      },
    },
  };
  await client.query(
    `UPDATE checkout_orders
     SET status = 'refunded', payload = $2::jsonb
     WHERE id = $1`,
    [yooKassaOrderId, JSON.stringify(refundedPayload)],
  );

  const refundState = await client.query(
    `SELECT o.status AS order_status, e.status::text AS enrollment_status, e.activated_by
     FROM checkout_orders o
     JOIN pilot_enrollments e ON e.id = $2
     WHERE o.id = $1`,
    [yooKassaOrderId, enrollmentId],
  );
  assert.deepEqual(
    refundState.rows[0],
    {
      order_status: "refunded",
      enrollment_status: "canceled",
      activated_by: "refund_reconciliation",
    },
    "full YooKassa refund must become terminal and revoke the final active pilot entitlement",
  );

  await expectStatementFailure({
    savepoint: "refunded_terminal_guard",
    sql: "UPDATE checkout_orders SET status = 'paid' WHERE id = $1",
    params: [yooKassaOrderId],
    messagePattern: /refunded checkout order .* is terminal/,
  });

  const badAmountOrder = await client.query(
    `INSERT INTO checkout_orders (
       user_id,
       plan_code,
       amount_rub,
       currency,
       status,
       customer_name,
       customer_contact,
       payload,
       provider
     )
     VALUES ($1, 'pilot', 2990, 'RUB', 'pending', 'Bad Amount', 'bad-amount@example.invalid', $2::jsonb, 'yookassa')
     RETURNING id`,
    [
      yookassaUserId,
      JSON.stringify({
        paymentProviderPayload: {
          amount: { value: "1.00", currency: "RUB" },
        },
      }),
    ],
  );
  await expectStatementFailure({
    savepoint: "yookassa_amount_guard",
    sql: "UPDATE checkout_orders SET status = 'paid' WHERE id = $1",
    params: [badAmountOrder.rows[0].id],
    messagePattern: /YooKassa amount mismatch/,
  });

  const badCurrencyOrder = await client.query(
    `INSERT INTO checkout_orders (
       user_id,
       plan_code,
       amount_rub,
       currency,
       status,
       customer_name,
       customer_contact,
       payload,
       provider
     )
     VALUES ($1, 'pilot', 2990, 'RUB', 'pending', 'Bad Currency', 'bad-currency@example.invalid', $2::jsonb, 'yookassa')
     RETURNING id`,
    [
      yookassaUserId,
      JSON.stringify({
        paymentProviderPayload: {
          amount: { value: "2990.00", currency: "USD" },
        },
      }),
    ],
  );
  await expectStatementFailure({
    savepoint: "yookassa_currency_guard",
    sql: "UPDATE checkout_orders SET status = 'paid' WHERE id = $1",
    params: [badCurrencyOrder.rows[0].id],
    messagePattern: /YooKassa currency mismatch/,
  });

  const failureOrderResult = await client.query(
    `INSERT INTO checkout_orders (
       user_id,
       plan_code,
       amount_rub,
       currency,
       status,
       customer_name,
       customer_contact,
       payload,
       provider
     )
     VALUES ($1, 'pilot', 1000, 'RUB', 'pending', $2, $3, '{}'::jsonb, 'test-provider')
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
      yookassaDatabaseContract: {
        verifiedPendingToPaid: true,
        paidDowngradeRejected: true,
        fullRefundTerminal: true,
        finalEntitlementRevoked: true,
        amountMismatchRejected: true,
        currencyMismatchRejected: true,
      },
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
