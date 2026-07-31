import assert from "node:assert/strict";

import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for the NPD receipt integration test.");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });

function providerPayload({ refunded = false, paymentId }) {
  return {
    planName: "Неделя",
    paymentProviderPayload: {
      id: paymentId,
      status: "succeeded",
      paid: true,
      amount: { value: "2990.00", currency: "RUB" },
      refundedAmount: { value: refunded ? "2990.00" : "0.00", currency: "RUB" },
      test: true,
    },
  };
}

try {
  await client.connect();
  await client.query("BEGIN");

  const user = await client.query(
    `INSERT INTO users (email, full_name)
     VALUES ('npd-receipt-test@example.invalid', 'NPD Receipt Test')
     RETURNING id`,
  );
  const userId = user.rows[0].id;

  const issuedOrder = await client.query(
    `INSERT INTO checkout_orders (
       user_id, plan_code, amount_rub, currency, status,
       customer_name, customer_contact, payload, provider, provider_payment_id
     )
     VALUES ($1, 'pilot', 2990, 'RUB', 'pending', 'Test Agency',
             'buyer@example.invalid', $2::jsonb, 'yookassa', 'payment-npd-issued')
     RETURNING id`,
    [userId, JSON.stringify(providerPayload({ paymentId: "payment-npd-issued" }))],
  );
  const issuedOrderId = issuedOrder.rows[0].id;

  await client.query(
    `UPDATE checkout_orders
     SET status = 'paid', paid_at = NOW()
     WHERE id = $1`,
    [issuedOrderId],
  );

  const queued = await client.query(
    `SELECT status, amount_rub, currency, customer_email, service_name,
            delivery_status, due_at <= NOW() AS due_now
     FROM npd_receipts
     WHERE checkout_order_id = $1`,
    [issuedOrderId],
  );
  assert.deepEqual(
    queued.rows[0],
    {
      status: "pending_issue",
      amount_rub: 2990,
      currency: "RUB",
      customer_email: "buyer@example.invalid",
      service_name: "Неделя",
      delivery_status: "pending",
      due_now: true,
    },
    "paid YooKassa order must enqueue an immediately-due NPD receipt",
  );

  await client.query(
    `UPDATE npd_receipts
     SET status = 'issued',
         receipt_url = 'https://lknpd.nalog.ru/api/v1/receipt/example',
         receipt_number = 'test-receipt-1',
         issued_at = NOW(),
         delivery_status = 'sent',
         delivered_at = NOW()
     WHERE checkout_order_id = $1`,
    [issuedOrderId],
  );

  await client.query(
    `UPDATE checkout_orders
     SET status = 'refunded', payload = $2::jsonb
     WHERE id = $1`,
    [issuedOrderId, JSON.stringify(providerPayload({ refunded: true, paymentId: "payment-npd-issued" }))],
  );

  const cancellationRequired = await client.query(
    `SELECT status, cancellation_reason, receipt_url IS NOT NULL AS keeps_receipt_proof
     FROM npd_receipts
     WHERE checkout_order_id = $1`,
    [issuedOrderId],
  );
  assert.deepEqual(
    cancellationRequired.rows[0],
    {
      status: "cancellation_required",
      cancellation_reason: "Возврат средств",
      keeps_receipt_proof: true,
    },
    "full refund after issuance must require My Tax receipt cancellation and keep evidence",
  );

  await client.query(
    `UPDATE npd_receipts
     SET status = 'canceled', canceled_at = NOW(), cancellation_reason = 'Возврат средств'
     WHERE checkout_order_id = $1`,
    [issuedOrderId],
  );

  const preIssueRefundOrder = await client.query(
    `INSERT INTO checkout_orders (
       user_id, plan_code, amount_rub, currency, status,
       customer_name, customer_contact, payload, provider, provider_payment_id
     )
     VALUES ($1, 'pilot', 2990, 'RUB', 'pending', 'Second Agency',
             'second@example.invalid', $2::jsonb, 'yookassa', 'payment-npd-not-required')
     RETURNING id`,
    [userId, JSON.stringify(providerPayload({ paymentId: "payment-npd-not-required" }))],
  );
  const preIssueRefundOrderId = preIssueRefundOrder.rows[0].id;

  await client.query(
    `UPDATE checkout_orders SET status = 'paid', paid_at = NOW() WHERE id = $1`,
    [preIssueRefundOrderId],
  );
  await client.query(
    `UPDATE checkout_orders
     SET status = 'refunded', payload = $2::jsonb
     WHERE id = $1`,
    [preIssueRefundOrderId, JSON.stringify(providerPayload({ refunded: true, paymentId: "payment-npd-not-required" }))],
  );

  const notRequired = await client.query(
    `SELECT status, delivery_status, receipt_url
     FROM npd_receipts
     WHERE checkout_order_id = $1`,
    [preIssueRefundOrderId],
  );
  assert.deepEqual(
    notRequired.rows[0],
    { status: "not_required", delivery_status: "not_required", receipt_url: null },
    "full refund before receipt issuance must close the task without fabricating a receipt",
  );

  console.log(JSON.stringify({
    ok: true,
    paidQueuesReceipt: true,
    issuedRefundRequiresCancellation: true,
    preIssueRefundClosesTask: true,
    receiptEvidencePreserved: true,
  }));
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end().catch(() => undefined);
}
