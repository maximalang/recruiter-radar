import { NextResponse } from "next/server";

import { getPool } from "../../../../lib/db";
import { processPaymentWebhook } from "../../../../lib/payments";
import { requireServerEnv } from "../../../../lib/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = requireServerEnv("BILLING_WEBHOOK_SECRET");
  if (request.headers.get("x-billing-secret") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const webhookRequest = request.clone();
  const body = await request.json();
  const provider = String(body?.provider ?? "manual");
  const externalEventId = String(body?.event_id ?? "");
  if (!externalEventId) {
    return NextResponse.json({ ok: false, error: "missing_event_id" }, { status: 400 });
  }

  const idempotencyKey = `${provider}:${externalEventId}`;
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  await pool.query<{ id: string }>(
    `INSERT INTO billing_webhook_events (provider, external_event_id, idempotency_key, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (provider, idempotency_key) DO NOTHING
     RETURNING id::TEXT AS id`,
    [provider, externalEventId, idempotencyKey, JSON.stringify(body)]
  );

  const claimed = await pool.query<{ status: string }>(
    `UPDATE billing_webhook_events
     SET status = 'processing', error_message = NULL, processed_at = NULL
     WHERE provider = $1
       AND idempotency_key = $2
       AND status IN ('received', 'failed')
     RETURNING status`,
    [provider, idempotencyKey]
  );

  if (claimed.rowCount === 0) {
    const existing = await pool.query<{ status: string }>(
      `SELECT status FROM billing_webhook_events
       WHERE provider = $1 AND idempotency_key = $2
       LIMIT 1`,
      [provider, idempotencyKey]
    );
    const status = existing.rowCount === 1 ? existing.rows[0].status : "received";
    return NextResponse.json({ ok: true, duplicate: true, status });
  }

  const event = await processPaymentWebhook(provider, webhookRequest);
  const nextStatus = event.status >= 200 && event.status < 300 ? "processed" : "failed";
  const errorMessage = nextStatus === "failed" ? event.body.slice(0, 500) : null;

  await pool.query(
    `UPDATE billing_webhook_events
     SET status = $3, error_message = $4, processed_at = NOW()
     WHERE provider = $1 AND idempotency_key = $2`,
    [provider, idempotencyKey, nextStatus, errorMessage]
  );

  return NextResponse.json({ ok: event.status >= 200 && event.status < 300, reconciled: event.status >= 200 && event.status < 300, status: nextStatus }, { status: event.status });
}
