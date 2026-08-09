import assert from "node:assert/strict";

import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required for the Robokassa billing integration test.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
});

const paidAt = new Date("2026-08-04T12:00:00.000Z");

try {
  await client.connect();
  await client.query("BEGIN");

  const userResult = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, $2)
     RETURNING id`,
    ["robokassa-billing-test@example.invalid", "Robokassa Billing Test"],
  );
  const userId = userResult.rows[0].id;
  const workspaceResult = await client.query(
    `SELECT ensure_auth_user_workspace($1) AS workspace_id`,
    [userId],
  );
  const workspaceId = workspaceResult.rows[0].workspace_id;

  const weekOrder = await createVerifiedOrder({
    userId,
    workspaceId,
    planCode: "pilot",
    amountRub: 2990,
    paidAt,
  });
  await grantEntitlement(weekOrder, 7, paidAt);
  await grantEntitlement(weekOrder, 7, paidAt);

  const weekLedger = await client.query(
    `SELECT COUNT(*)::INT AS count, starts_at, ends_at
     FROM checkout_order_entitlements
     WHERE order_id = $1
     GROUP BY starts_at, ends_at`,
    [weekOrder],
  );
  assert.equal(weekLedger.rows[0].count, 1, "webhook replay must not double-grant access");
  assert.equal(
    new Date(weekLedger.rows[0].ends_at).toISOString(),
    "2026-08-11T12:00:00.000Z",
    "week plan must grant exactly seven days",
  );

  const monthOrder = await createVerifiedOrder({
    userId,
    workspaceId,
    planCode: "monthly",
    amountRub: 9990,
    paidAt: new Date("2026-08-05T12:00:00.000Z"),
  });
  await grantEntitlement(monthOrder, 30, new Date("2026-08-05T12:00:00.000Z"));

  const quarterOrder = await createVerifiedOrder({
    userId,
    workspaceId,
    planCode: "quarterly",
    amountRub: 24990,
    paidAt: new Date("2026-08-06T12:00:00.000Z"),
  });
  await grantEntitlement(quarterOrder, 90, new Date("2026-08-06T12:00:00.000Z"));

  const activeBeforeRefund = await readActiveEnrollment(userId);
  assert.equal(
    activeBeforeRefund.endsAt,
    "2026-12-09T12:00:00.000Z",
    "7 + 30 + 90 day purchases must stack without overlap",
  );

  const firstRefund = await reserveRefund({
    orderId: monthOrder,
    amountMinor: 100_000,
    isFull: false,
  });
  await advanceRefund(firstRefund, "requested");
  await advanceRefund(firstRefund, "succeeded");

  const afterPartial = await client.query(
    `SELECT status FROM checkout_orders WHERE id = $1`,
    [monthOrder],
  );
  assert.equal(afterPartial.rows[0].status, "paid", "partial refund must not revoke access");
  assert.equal((await readActiveEnrollment(userId)).endsAt, activeBeforeRefund.endsAt);

  const secondRefund = await reserveRefund({
    orderId: monthOrder,
    amountMinor: 899_000,
    isFull: false,
  });
  await advanceRefund(secondRefund, "requested");
  await advanceRefund(secondRefund, "processing");
  await advanceRefund(secondRefund, "succeeded");

  const afterFullAggregate = await client.query(
    `SELECT status FROM checkout_orders WHERE id = $1`,
    [monthOrder],
  );
  assert.equal(
    afterFullAggregate.rows[0].status,
    "refunded",
    "successful refund aggregate equal to the order amount must mark the order refunded",
  );

  const revokedMonth = await client.query(
    `SELECT revoked_at, revocation_reason
     FROM checkout_order_entitlements
     WHERE order_id = $1`,
    [monthOrder],
  );
  assert.ok(revokedMonth.rows[0].revoked_at, "fully refunded entitlement must be revoked");
  assert.match(revokedMonth.rows[0].revocation_reason, /full_refund_checkout_order/);

  const activeAfterRefund = await readActiveEnrollment(userId);
  assert.equal(
    activeAfterRefund.endsAt,
    "2026-11-09T12:00:00.000Z",
    "remaining week and quarter purchases must be compacted after refund",
  );

  await expectDatabaseError(
    async () => {
      await reserveRefund({
        orderId: weekOrder,
        amountMinor: 299_001,
        isFull: false,
      });
    },
    /exceeds checkout order/,
    "refund reservations must not exceed the paid amount",
  );

  await expectDatabaseError(
    async () => {
      const badOrder = await client.query(
        `INSERT INTO checkout_orders (
           user_id, purchased_by_user_id, workspace_id, entitlement_owner_id,
           plan_code, amount_rub, currency, status,
           customer_name, customer_contact, payload, provider
         )
         VALUES (
           $1, $1, $2, $1, 'pilot', 2990, 'RUB', 'pending',
           'Bad Plan', 'bad@example.invalid', '{}'::jsonb, 'robokassa'
         )
         RETURNING id`,
        [userId, workspaceId],
      );
      await client.query(
        `UPDATE checkout_orders
         SET status = 'paid',
             paid_at = $2,
             payload = $3::jsonb
         WHERE id = $1`,
        [
          badOrder.rows[0].id,
          paidAt.toISOString(),
          JSON.stringify(verifiedPayload({ amountRub: 2990, planCode: "monthly" })),
        ],
      );
    },
    /plan mismatch/,
    "signed Shp_plan must match the checkout order",
  );

  await client.query("ROLLBACK");
  console.log("Robokassa billing PostgreSQL contract passed.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

async function createVerifiedOrder({
  userId,
  workspaceId,
  planCode,
  amountRub,
  paidAt: paidDate,
}) {
  const inserted = await client.query(
    `INSERT INTO checkout_orders (
       user_id, purchased_by_user_id, workspace_id, entitlement_owner_id,
       plan_code, amount_rub, currency, status,
       customer_name, customer_contact, payload, provider
     )
     VALUES (
       $1, $1, $2, $1, $3, $4, 'RUB', 'pending',
       $5, $6, '{}'::jsonb, 'robokassa'
     )
     RETURNING id`,
    [
      userId,
      workspaceId,
      planCode,
      amountRub,
      `Test ${planCode}`,
      `${planCode}@example.invalid`,
    ],
  );
  const orderId = inserted.rows[0].id;
  await client.query(
    `UPDATE checkout_orders
     SET status = 'paid',
         paid_at = $2,
         provider_payment_id = $3,
         payload = $4::jsonb
     WHERE id = $1`,
    [
      orderId,
      paidDate.toISOString(),
      `robokassa:test:${orderId}`,
      JSON.stringify(verifiedPayload({ amountRub, planCode })),
    ],
  );
  return orderId;
}

function verifiedPayload({ amountRub, planCode }) {
  return {
    paymentProviderPayload: {
      signatureVerified: true,
      verifiedBy: "ResultURL signature",
      amount: { value: `${amountRub}.00`, currency: "RUB" },
      shp: { Shp_plan: planCode },
      opKey: "0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF",
    },
  };
}

async function grantEntitlement(orderId, durationDays, paidDate) {
  const order = await client.query(
    `SELECT user_id, workspace_id, entitlement_owner_id, plan_code
     FROM checkout_orders
     WHERE id = $1`,
    [orderId],
  );
  const {
    user_id: userId,
    workspace_id: workspaceId,
    entitlement_owner_id: entitlementOwnerId,
    plan_code: planCode,
  } = order.rows[0];

  await client.query(
    `WITH access_start AS (
       SELECT GREATEST(
         $2::timestamptz,
         COALESCE(
           MAX(pe.ends_at) FILTER (WHERE pe.status = 'active'),
           $2::timestamptz
         )
       ) AS starts_at
       FROM pilot_enrollments pe
       WHERE pe.user_id = $3
     ),
     inserted AS (
       INSERT INTO checkout_order_entitlements (
         order_id, user_id, workspace_id, entitlement_owner_id,
         plan_code, duration_days, starts_at, ends_at
       )
       SELECT
         $1, $3, $4, $5, $6, $7, ast.starts_at,
         ast.starts_at + ($7::int * INTERVAL '1 day')
       FROM access_start ast
       ON CONFLICT (order_id) DO NOTHING
       RETURNING user_id, starts_at, ends_at
     )
     INSERT INTO pilot_enrollments (
       user_id, status, starts_at, ends_at, activated_by, notes
     )
     SELECT
       inserted.user_id, 'active', inserted.starts_at, inserted.ends_at,
       'payment_webhook', 'checkout_order:' || $1::text
     FROM inserted
     ON CONFLICT (user_id) WHERE status = 'active'
     DO UPDATE SET
       starts_at = LEAST(pilot_enrollments.starts_at, EXCLUDED.starts_at),
       ends_at = GREATEST(pilot_enrollments.ends_at, EXCLUDED.ends_at),
       updated_at = NOW(),
       activated_by = EXCLUDED.activated_by,
       notes = EXCLUDED.notes`,
    [
      orderId,
      paidDate.toISOString(),
      userId,
      workspaceId,
      entitlementOwnerId,
      planCode,
      durationDays,
    ],
  );
}

async function reserveRefund({ orderId, amountMinor, isFull }) {
  const result = await client.query(
    `INSERT INTO payment_refunds (
       order_id, provider, amount_minor, is_full, status, requested_by, provider_payload
     )
     VALUES ($1, 'robokassa', $2, $3, 'creating', 'db-contract', '{}'::jsonb)
     RETURNING id`,
    [orderId, amountMinor, isFull],
  );
  return result.rows[0].id;
}

async function advanceRefund(refundId, status) {
  await client.query(
    `UPDATE payment_refunds
     SET status = $2,
         provider_refund_id = COALESCE(provider_refund_id, $3)
     WHERE id = $1`,
    [refundId, status, `68cd7fa6-1338-4745-ba5c-${String(refundId).padStart(12, "0")}`],
  );
}

async function readActiveEnrollment(userId) {
  const result = await client.query(
    `SELECT starts_at, ends_at
     FROM pilot_enrollments
     WHERE user_id = $1 AND status = 'active'
     LIMIT 1`,
    [userId],
  );
  assert.equal(result.rowCount, 1, "an active enrollment must exist");
  return {
    startsAt: new Date(result.rows[0].starts_at).toISOString(),
    endsAt: new Date(result.rows[0].ends_at).toISOString(),
  };
}

async function expectDatabaseError(operation, pattern, message) {
  const savepoint = `sp_${Math.random().toString(16).slice(2)}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught = null;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert.ok(caught, message);
  assert.match(String(caught.message), pattern, message);
}
