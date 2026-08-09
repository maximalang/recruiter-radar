import { getPool } from "@/lib/db";
import { processPaymentWebhook } from "@/lib/payments";
import { logError, logEvent, logWarn } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROCESSING_RECLAIM_TIMEOUT_MINUTES = 10;
const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
};

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  const webhookRequest = request.clone();
  let params: URLSearchParams;

  try {
    params = request.method.toUpperCase() === "GET"
      ? new URL(request.url).searchParams
      : new URLSearchParams(await request.text());
  } catch {
    return text("Invalid notification.", 400);
  }

  const invId = params.get("InvId")?.trim() ?? params.get("InvID")?.trim() ?? "";
  const signature = params.get("SignatureValue")?.trim().toLowerCase() ?? "";
  if (!/^\d+$/.test(invId) || !/^[a-f0-9]{16,128}$/.test(signature)) {
    return text("Invalid notification.", 400);
  }

  const provider = "robokassa";
  const externalEventId = `${invId}:${signature}`;
  const idempotencyKey = externalEventId;
  const payload = Object.fromEntries(params.entries());
  const pool = getPool();

  if (!pool) {
    logWarn("payments.webhook_unavailable", { provider, reasonCode: "database_not_configured" });
    return text("Temporary processing error.", 503);
  }

  await pool.query(
    `INSERT INTO billing_webhook_events (
       provider,
       external_event_id,
       idempotency_key,
       payload
     )
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (provider, idempotency_key) DO NOTHING`,
    [provider, externalEventId, idempotencyKey, JSON.stringify(payload)],
  );

  const claimToken = crypto.randomUUID();
  const claimed = await pool.query(
    `UPDATE billing_webhook_events
     SET status = 'processing',
         error_message = NULL,
         processed_at = NULL,
         claimed_at = NOW(),
         claim_token = $3
     WHERE provider = $1
       AND idempotency_key = $2
       AND (
         status IN ('received', 'failed')
         OR (
           status = 'processing'
           AND (
             claimed_at IS NULL
             OR claimed_at <= NOW() - ($4::int * INTERVAL '1 minute')
           )
         )
       )
     RETURNING id`,
    [provider, idempotencyKey, claimToken, PROCESSING_RECLAIM_TIMEOUT_MINUTES],
  );

  if (claimed.rowCount === 0) {
    const existing = await pool.query<{ status: string }>(
      `SELECT status
       FROM billing_webhook_events
       WHERE provider = $1 AND idempotency_key = $2
       LIMIT 1`,
      [provider, idempotencyKey],
    );

    if (existing.rows[0]?.status === "processed") {
      return text(`OK${invId}`, 200);
    }

    return text("Notification is already processing.", 503);
  }

  try {
    const result = await processPaymentWebhook(provider, webhookRequest);
    const succeeded = result.status >= 200 && result.status < 300;

    await pool.query(
      `UPDATE billing_webhook_events
       SET status = $3,
           error_message = $4,
           processed_at = NOW(),
           claim_token = NULL
       WHERE provider = $1
         AND idempotency_key = $2
         AND claim_token = $5`,
      [
        provider,
        idempotencyKey,
        succeeded ? "processed" : "failed",
        succeeded ? null : result.body.slice(0, 500),
        claimToken,
      ],
    );

    if (succeeded) logEvent("payments.webhook_processed", { provider });
    else logWarn("payments.webhook_failed", { provider, status: result.status });

    return text(result.body, result.status);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "reconciliation_error";

    await pool.query(
      `UPDATE billing_webhook_events
       SET status = 'failed',
           error_message = $3,
           processed_at = NOW(),
           claim_token = NULL
       WHERE provider = $1
         AND idempotency_key = $2
         AND claim_token = $4`,
      [provider, idempotencyKey, message, claimToken],
    );

    logError("payments.webhook_failed", error, { provider });

    return text("Temporary processing error.", 503);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: HEADERS });
}
