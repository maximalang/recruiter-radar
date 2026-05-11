import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getPool } from "../../../../lib/db";
import { isDigestFeedbackAction, updateDigestOrgStateFeedback, type DigestFeedbackAction } from "../../../../lib/digestFeedback";
import { answerTelegramCallbackQuery, getTelegramBotToken } from "../../../../lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramWebhookUpdate = { update_id?: number; callback_query?: { id?: string; data?: string } };
type ParsedDigestFeedbackCallback = { clientProfileId: string; orgId: string; action: DigestFeedbackAction | "shown" };
const STALE_CLAIM_SECONDS = 90;

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token")?.trim();
  if (!secret || providedSecret !== secret) return NextResponse.json({ error: "Unauthorized webhook request." }, { status: 401 });
  const { botToken, error } = getTelegramBotToken();
  if (!botToken) return NextResponse.json({ error: error ?? "TELEGRAM_BOT_TOKEN is not configured." }, { status: 500 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const update = body as TelegramWebhookUpdate;
  const callbackQueryId = normalizeNonEmptyString(update?.callback_query?.id);
  const parsedCallback = parseDigestFeedbackCallbackData(update?.callback_query?.data);
  const idempotencyKey = `tg:${update?.update_id ?? "na"}:${callbackQueryId ?? "na"}`;
  const claimToken = randomUUID();

  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 500 });

  const claim = await pool.query<{ id: number; ownsClaim: boolean }>(`
    INSERT INTO webhook_events (
      provider, event_type, external_event_id, idempotency_key, payload, status, processing_claimed_at, processing_claim_token
    )
    VALUES ('telegram', 'callback_query', $1, $2, $3::jsonb, 'processing', NOW(), $4)
    ON CONFLICT (provider, idempotency_key)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      processing_claimed_at = CASE
        WHEN webhook_events.status IN ('received', 'failed')
          OR (webhook_events.status = 'processing' AND webhook_events.processing_claimed_at < NOW() - ($5::int * INTERVAL '1 second'))
        THEN NOW() ELSE webhook_events.processing_claimed_at END,
      processing_claim_token = CASE
        WHEN webhook_events.status IN ('received', 'failed')
          OR (webhook_events.status = 'processing' AND webhook_events.processing_claimed_at < NOW() - ($5::int * INTERVAL '1 second'))
        THEN EXCLUDED.processing_claim_token ELSE webhook_events.processing_claim_token END,
      status = CASE
        WHEN webhook_events.status IN ('received', 'failed')
          OR (webhook_events.status = 'processing' AND webhook_events.processing_claimed_at < NOW() - ($5::int * INTERVAL '1 second'))
        THEN 'processing' ELSE webhook_events.status END
    RETURNING id, processing_claim_token = $4 AS "ownsClaim"
  `, [callbackQueryId ?? idempotencyKey, idempotencyKey, JSON.stringify(body), claimToken, STALE_CLAIM_SECONDS]);

  const eventRow = claim.rows[0];
  if (!eventRow.ownsClaim) return NextResponse.json({ ok: true, replaySafe: true, duplicate: true });

  if (!callbackQueryId || !parsedCallback) {
    await pool.query(`UPDATE webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    if (parsedCallback.action !== "shown") await updateDigestOrgStateFeedback({ clientProfileId: parsedCallback.clientProfileId, orgId: parsedCallback.orgId, action: parsedCallback.action });
    await answerTelegramCallbackQuery({ callbackQueryId, botToken, text: parsedCallback.action === "shown" ? undefined : getDigestFeedbackConfirmationText(parsedCallback.action) });
    await pool.query(`UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error_message = NULL WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
    return NextResponse.json({ ok: true, replaySafe: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process Telegram callback feedback.";
    await pool.query(`UPDATE webhook_events SET status = 'failed', processed_at = NOW(), error_message = LEFT($2, 1000) WHERE id = $1 AND processing_claim_token = $3`, [eventRow.id, sanitizeError(message), claimToken]);
    await answerTelegramCallbackQuery({ callbackQueryId, botToken, text: "Не удалось сохранить фидбек" }).catch(() => {});
    return NextResponse.json({ error: message }, { status: message.startsWith("Invalid ") || message.includes("is required") ? 400 : 500 });
  }
}

export function parseDigestFeedbackCallbackData(value: string | null | undefined): ParsedDigestFeedbackCallback | null { const normalizedValue = normalizeNonEmptyString(value); if (!normalizedValue) return null; const [prefix, clientProfileId, orgId, action, ...rest] = normalizedValue.split(":"); if (prefix !== "dgf" || rest.length > 0) return null; if (!isPositiveIntegerString(clientProfileId) || !isPositiveIntegerString(orgId)) return null; if (action === "shown") return { clientProfileId, orgId, action }; if (!isDigestFeedbackAction(action)) return null; return { clientProfileId, orgId, action }; }
function getDigestFeedbackConfirmationText(action: DigestFeedbackAction): string { switch (action) { case "accepted": return "Отмечено: беру"; case "badfit": return "Отмечено: мимо"; case "snooze": return "Отмечено: позже"; case "dismissed": return "Отмечено: скрыто"; case "contacted": return "Отмечено: contacted"; case "replied": return "Отмечено: replied"; case "won": return "Отмечено: won"; } }
function isPositiveIntegerString(value: string | null | undefined): value is string { return typeof value === "string" && /^\d+$/.test(value); }
function normalizeNonEmptyString(value: string | null | undefined): string | null { if (typeof value !== "string") return null; const normalizedValue = value.trim(); return normalizedValue === "" ? null : normalizedValue; }
function sanitizeError(value: string): string { return value.replace(/bot\d+:[A-Za-z0-9_-]+/g, "[redacted-token]"); }
