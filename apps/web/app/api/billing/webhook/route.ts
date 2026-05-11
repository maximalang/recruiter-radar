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

  const result = await pool.query(
    `INSERT INTO billing_webhook_events (provider, external_event_id, idempotency_key, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (provider, idempotency_key) DO NOTHING`,
    [provider, externalEventId, idempotencyKey, JSON.stringify(body)]
  );

  if (result.rowCount === 0) return NextResponse.json({ ok: true, duplicate: true });

  await processPaymentWebhook(provider, webhookRequest);

  return NextResponse.json({ ok: true, reconciled: true });
}
