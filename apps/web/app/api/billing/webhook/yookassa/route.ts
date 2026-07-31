import { NextResponse } from "next/server";

import { getPool } from "../../../../../lib/db";
import { processPaymentWebhook } from "../../../../../lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROCESSING_RECLAIM_TIMEOUT_MINUTES = 10;

export async function POST(request: Request) {
  const webhookRequest = request.clone();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const notification = body as { type?: unknown; event?: unknown; object?: { id?: unknown } };
  if (notification.type !== "notification") {
    return NextResponse.json({ ok: false, error: "invalid_type" }, { status: 400 });
  }

  const event = typeof notification.event === "string" ? notification.event : "";
  const objectId = typeof notification.object?.id === "string" ? notification.object.id : "";
  if (!event || !objectId) {
    return NextResponse.json({ ok: false, error: "missing_event_or_object" }, { status: 400 });
  }

  const provider = "yookassa";
  const externalEventId = `${event}:${objectId}`;
  const idempotencyKey = `${provider}:${externalEventId}`;
  const pool = getPool();
  if (!pool) return NextResponse.json({ ok: false, error: "database_unavailable" }, { status: 503 });

  await pool.query(
    `INSERT INTO billing_webhook_events (provider, external_event_id, idempotency_key, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (provider, idempotency_key) DO NOTHING`,
    [provider, externalEventId, idempotencyKey, JSON.stringify(body)]
  );

  const claimToken = crypto.randomUUID();
  const claimed = await pool.query(
    `UPDATE billing_webhook_events
     SET status = 'processing', error_message = NULL, processed_at = NULL,
         claimed_at = NOW(), claim_token = $3
     WHERE provider = $1 AND idempotency_key = $2
       AND (
         status IN ('received', 'failed')
         OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at <= NOW() - ($4::int * INTERVAL '1 minute')))
       )
     RETURNING status`,
    [provider, idempotencyKey, claimToken, PROCESSING_RECLAIM_TIMEOUT_MINUTES]
  );

  if (claimed.rowCount === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    // processPaymentWebhook получает статус только после повторного GET-запроса
    // к API ЮKassa с секретными учётными данными магазина.
    const result = await processPaymentWebhook(provider, webhookRequest);
    const processed = result.status >= 200 && result.status < 300;

    await pool.query(
      `UPDATE billing_webhook_events
       SET status = $3, error_message = $4, processed_at = NOW(), claim_token = NULL
       WHERE provider = $1 AND idempotency_key = $2 AND claim_token = $5`,
      [provider, idempotencyKey, processed ? "processed" : "failed", processed ? null : result.body.slice(0, 500), claimToken]
    );

    return NextResponse.json({ ok: processed }, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "reconciliation_error";
    await pool.query(
      `UPDATE billing_webhook_events
       SET status = 'failed', error_message = $3, processed_at = NOW(), claim_token = NULL
       WHERE provider = $1 AND idempotency_key = $2 AND claim_token = $4`,
      [provider, idempotencyKey, message, claimToken]
    );
    return NextResponse.json({ ok: false, error: "reconciliation_error" }, { status: 500 });
  }
}
