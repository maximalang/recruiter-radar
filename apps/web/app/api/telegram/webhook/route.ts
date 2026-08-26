import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { checkTelegramChatOwnsClientProfile, getPool } from "../../../../lib/db";
import { isDigestFeedbackAction, updateDigestOrgStateFeedback, type DigestFeedbackAction } from "../../../../lib/digestFeedback";
import { answerTelegramCallbackQuery, getTelegramBotToken, sendTelegramTextMessage } from "../../../../lib/telegram";
import { consumeTelegramConnectToken } from "../../../../lib/telegramConnect";
import { verifyDigestFeedbackCallback } from "../../../../lib/telegramDigestFeedback";
import { sanitizeTelegramWebhookError } from "../../../../lib/telegram-webhook-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramWebhookUpdate = {
  update_id?: number;
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number | string };
    message?: { chat?: { id?: number | string; type?: string } };
  };
  message?: { chat?: { id?: number | string }; text?: string }
};
const STALE_CLAIM_SECONDS = 90;
const PUBLIC_PROCESSING_ERROR = "Unable to process Telegram webhook.";
const PUBLIC_STORAGE_ERROR = "Telegram webhook storage is unavailable.";

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token")?.trim();
  if (!secret || providedSecret !== secret) return NextResponse.json({ error: "Unauthorized webhook request." }, { status: 401 });
  const { botToken } = getTelegramBotToken();
  if (!botToken) return NextResponse.json({ error: "Telegram service is not configured." }, { status: 500 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const update = body as TelegramWebhookUpdate;
  if (update?.callback_query) {
    return processTelegramCallbackAtomically({ update, body, botToken });
  }
  const callbackQueryId: string | null = normalizeNonEmptyString(update?.callback_query?.id ?? null);
  const parsedCallback = verifyDigestFeedbackCallback(update?.callback_query?.data ?? null);
  const senderChatId = normalizeTelegramChatId(update?.callback_query?.from?.id ?? null);
  // F3 fail-closed origin gate: feedback callbacks are honored only when the
  // callback message's chat is a private chat whose id equals the pressing
  // user's id. A group/channel repost of a keyboard therefore can never
  // mutate another chat's profile state even if the signed data is valid.
  const callbackChatId = normalizeTelegramChatId(update?.callback_query?.message?.chat?.id ?? null);
  const callbackChatType = update?.callback_query?.message?.chat?.type ?? null;
  const isPrivateSelfOrigin =
    callbackChatType === "private" &&
    callbackChatId !== null &&
    senderChatId !== null &&
    callbackChatId === senderChatId;
  const idempotencyKey = `tg:${update?.update_id ?? "na"}:${callbackQueryId ?? "na"}`;
  const claimToken = randomUUID();

  const pool = getPool();
  if (!pool) return NextResponse.json({ error: PUBLIC_STORAGE_ERROR }, { status: 503 });

  let claim: { rows: Array<{ id: number; ownsClaim: boolean; status: string }> };
  try {
    claim = await pool.query<{ id: number; ownsClaim: boolean; status: string }>(`
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
      RETURNING id, status::TEXT AS status, processing_claim_token = $4 AS "ownsClaim"
    `, [callbackQueryId ?? idempotencyKey, idempotencyKey, JSON.stringify(body), claimToken, STALE_CLAIM_SECONDS]);
  } catch (error) {
    console.error("Failed to claim Telegram webhook event:", sanitizeTelegramWebhookError(getErrorMessage(error)));
    return NextResponse.json({ error: PUBLIC_STORAGE_ERROR }, { status: 503 });
  }

  const eventRow = claim.rows[0];
  if (!eventRow) {
    console.error("Telegram webhook claim returned no event row.");
    return NextResponse.json({ error: PUBLIC_STORAGE_ERROR }, { status: 503 });
  }
  if (!eventRow.ownsClaim) {
    if (eventRow.status === "processed" || eventRow.status === "ignored") {
      return NextResponse.json({ ok: true, replaySafe: true, duplicate: true });
    }
    return NextResponse.json({ ok: false, retryable: true, error: "Event is already processing." }, { status: 409 });
  }

  try {
    if (!callbackQueryId || !parsedCallback) {
      const startToken = parseStartToken(update?.message?.text);
      const chatId = normalizeTelegramChatId(update?.message?.chat?.id);

      if (startToken && chatId) {
        const consume = await consumeTelegramConnectToken({ token: startToken, telegramChatId: chatId });
        await pool.query(`UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error_message = NULL WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
        return NextResponse.json({ ok: true, startHandled: true, connectStatus: consume.status });
      }

      // /start without token — register chat_id for SaaS multi-user delivery
      const isPlainStart = update?.message?.text?.trim().startsWith("/start") && !startToken;
      if (isPlainStart && chatId) {
        try {
          const telegramUsername = normalizeNonEmptyString(
            (update?.message as { from?: { username?: string } } | undefined)?.from?.username ?? null
          );
          await pool.query(
            `INSERT INTO users (telegram_chat_id, telegram_username, email, full_name)
             VALUES ($1::bigint, $2, $3, $4)
             ON CONFLICT (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL
             DO UPDATE SET telegram_username = EXCLUDED.telegram_username, updated_at = NOW()`,
            [chatId, telegramUsername, `tg:${chatId}@telegram`, telegramUsername]
          );
          await sendTelegramTextMessage(
            "Радар активирован. Ежедневный дайджест будет приходить сюда.\n\nЧтобы подключить профиль агентства, используйте ссылку из личного кабинета.",
            { botToken, chatId }
          ).catch(() => {});
        } catch (error) {
          console.error("Failed to register /start chat_id:", sanitizeTelegramWebhookError(getErrorMessage(error)));
        }
        await pool.query(`UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error_message = NULL WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
        return NextResponse.json({ ok: true, startHandled: true, connectStatus: "registered" });
      }

      if (callbackQueryId) {
        await answerTelegramCallbackQuery({ callbackQueryId, botToken }).catch(() => {});
      }

      await pool.query(`UPDATE webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!senderChatId) {
      await pool.query(`UPDATE webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
      await answerTelegramCallbackQuery({ callbackQueryId, botToken }).catch(() => {});
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (!isPrivateSelfOrigin) {
      await pool.query(`UPDATE webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
      await answerTelegramCallbackQuery({ callbackQueryId, botToken }).catch(() => {});
      return NextResponse.json({ ok: true, ignored: true });
    }

    const ownsProfile = await checkTelegramChatOwnsClientProfile(senderChatId, parsedCallback.client_profile_id);
    if (!ownsProfile) {
      await pool.query(`UPDATE webhook_events SET status = 'ignored', processed_at = NOW() WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
      await answerTelegramCallbackQuery({ callbackQueryId, botToken }).catch(() => {});
      return NextResponse.json({ ok: true, ignored: true });
    }
    if (parsedCallback.action !== "shown") {
      if (!isDigestFeedbackAction(parsedCallback.action)) {
        // Unrecognised callback action — ignore safely instead of casting
        await pool.query(`UPDATE webhook_events SET status = 'ignored', processed_at = NOW(), error_message = 'unrecognised_action' WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
        await answerTelegramCallbackQuery({ callbackQueryId, botToken }).catch(() => {});
        return NextResponse.json({ ok: true, ignored: true, reason: "unrecognised_action" });
      }
      await updateDigestOrgStateFeedback({ clientProfileId: parsedCallback.client_profile_id, orgId: parsedCallback.org_id, action: parsedCallback.action });
    }
    await answerTelegramCallbackQuery({ callbackQueryId, botToken, text: parsedCallback.action === "shown" ? undefined : getDigestFeedbackConfirmationText(parsedCallback.action) });
    await pool.query(`UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error_message = NULL WHERE id = $1 AND processing_claim_token = $2`, [eventRow.id, claimToken]);
    return NextResponse.json({ ok: true, replaySafe: true });
  } catch (error) {
    const message = getErrorMessage(error);
    try {
      await pool.query(`UPDATE webhook_events SET status = 'failed', processed_at = NOW(), error_message = LEFT($2, 1000) WHERE id = $1 AND processing_claim_token = $3`, [eventRow.id, sanitizeTelegramWebhookError(message), claimToken]);
    } catch (persistenceError) {
      console.error("Failed to persist Telegram webhook failure state:", sanitizeTelegramWebhookError(getErrorMessage(persistenceError)));
    }
    if (callbackQueryId) {
      await answerTelegramCallbackQuery({ callbackQueryId, botToken, text: "Не удалось сохранить фидбек" }).catch(() => {});
    }
    console.error("Failed to process Telegram webhook:", sanitizeTelegramWebhookError(message));
    return NextResponse.json({ error: PUBLIC_PROCESSING_ERROR }, { status: 500 });
  }
}

async function processTelegramCallbackAtomically(input: {
  update: TelegramWebhookUpdate;
  body: unknown;
  botToken: string;
}): Promise<Response> {
  const callbackQueryId = normalizeNonEmptyString(input.update.callback_query?.id ?? null);
  const parsedCallback = verifyDigestFeedbackCallback(input.update.callback_query?.data ?? null);
  const senderChatId = normalizeTelegramChatId(input.update.callback_query?.from?.id ?? null);
  const callbackChatId = normalizeTelegramChatId(input.update.callback_query?.message?.chat?.id ?? null);
  const callbackChatType = input.update.callback_query?.message?.chat?.type ?? null;
  const privateSelfOrigin =
    callbackChatType === "private"
    && callbackChatId !== null
    && senderChatId !== null
    && callbackChatId === senderChatId;
  const idempotencyKey = buildTelegramFeedbackIdempotencyKey(input.update, parsedCallback, callbackQueryId);
  const claimToken = randomUUID();
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: PUBLIC_STORAGE_ERROR }, { status: 503 });

  const poolClient = typeof (pool as { connect?: unknown }).connect === "function"
    ? await pool.connect()
    : null;
  const db = poolClient ?? pool;
  let transactionOpen = poolClient !== null;
  const closeTransaction = async (commit: boolean): Promise<void> => {
    if (!transactionOpen || !poolClient) return;
    await poolClient.query(commit ? "COMMIT" : "ROLLBACK");
    transactionOpen = false;
    poolClient.release();
  };
  const ignored = async (text?: string): Promise<Response> => {
    await db.query(
      `UPDATE webhook_events
       SET status = 'ignored', processed_at = NOW(), error_message = $2
       WHERE id = $1 AND processing_claim_token = $3`,
      [eventRowId, text ?? null, claimToken],
    );
    await closeTransaction(true);
    if (callbackQueryId) {
      await answerTelegramCallbackQuery({ callbackQueryId, botToken: input.botToken }).catch(() => {});
    }
    return NextResponse.json({ ok: true, ignored: true });
  };

  let eventRowId: string | number | null = null;
  try {
    if (poolClient) await db.query("BEGIN");
    const claim = await db.query<{
      id: string;
      ownsClaim: boolean;
      status: string;
    }>(`
      INSERT INTO webhook_events (
        provider, event_type, external_event_id, idempotency_key, payload, status,
        processing_claimed_at, processing_claim_token
      )
      VALUES ('telegram', 'callback_query', $1, $2, $3::jsonb, 'processing', NOW(), $4)
      ON CONFLICT (provider, idempotency_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        processing_claimed_at = NOW(),
        processing_claim_token = $4,
        status = 'processing'
      WHERE webhook_events.status NOT IN ('processed', 'ignored')
        AND (
          webhook_events.status IN ('received', 'failed')
          OR webhook_events.processing_claimed_at IS NULL
          OR webhook_events.processing_claimed_at
               < NOW() - ($5::int * INTERVAL '1 second')
        )
      RETURNING id, status::TEXT AS status,
        processing_claim_token = $4 AS "ownsClaim"
    `, [
      input.update.update_id ?? idempotencyKey,
      idempotencyKey,
      JSON.stringify(input.body),
      claimToken,
      STALE_CLAIM_SECONDS,
    ]);

    const eventRow = claim.rows[0];
    if (!eventRow) {
      const existing = await db.query<{ id: string; status: string }>(
        `SELECT id, status::TEXT AS status
         FROM webhook_events
         WHERE provider = 'telegram' AND idempotency_key = $1
         LIMIT 1`,
        [idempotencyKey],
      );
      if (!existing.rows[0]) throw new Error("Telegram callback claim returned no event row.");
      eventRowId = existing.rows[0].id;
      await closeTransaction(true);
      if (existing.rows[0].status === "processed" || existing.rows[0].status === "ignored") {
        return NextResponse.json({ ok: true, replaySafe: true, duplicate: true });
      }
      return NextResponse.json({ ok: false, retryable: true, error: "Event is already processing." }, { status: 409 });
    }
    eventRowId = eventRow.id;
    if (!eventRow.ownsClaim) {
      await closeTransaction(true);
      return NextResponse.json({ ok: true, replaySafe: true, duplicate: true });
    }

    if (!callbackQueryId || !parsedCallback || !privateSelfOrigin) {
      return ignored(!privateSelfOrigin ? "invalid_callback_origin" : undefined);
    }

    const ownsProfile = await checkTelegramChatOwnsClientProfile(senderChatId!, parsedCallback.client_profile_id);
    if (!ownsProfile) return ignored("unauthorized_callback_profile");

    if (parsedCallback.action !== "shown") {
      if (!isDigestFeedbackAction(parsedCallback.action)) return ignored("unrecognised_action");
      await updateDigestOrgStateFeedback({
        clientProfileId: parsedCallback.client_profile_id,
        orgId: parsedCallback.org_id,
        digestCandidateId: parsedCallback.digest_candidate_id,
        action: parsedCallback.action,
      }, db);
    }

    await db.query(
      `UPDATE webhook_events
       SET status = 'processed', processed_at = NOW(), error_message = NULL
       WHERE id = $1 AND processing_claim_token = $2`,
      [eventRow.id, claimToken],
    );
    await closeTransaction(true);
    await answerTelegramCallbackQuery({
      callbackQueryId,
      botToken: input.botToken,
      text: parsedCallback.action === "shown" ? undefined : getDigestFeedbackConfirmationText(parsedCallback.action),
    }).catch(() => {});
    return NextResponse.json({ ok: true, replaySafe: true });
  } catch (error) {
    await closeTransaction(false).catch(() => {});
    const message = getErrorMessage(error);
    if (eventRowId !== null) {
      try {
        await pool.query(
          `UPDATE webhook_events
           SET status = 'failed', processed_at = NOW(), error_message = LEFT($2, 1000)
           WHERE id = $1 AND processing_claim_token = $3`,
          [eventRowId, sanitizeTelegramWebhookError(message), claimToken],
        );
      } catch (persistenceError) {
        console.error("Failed to persist Telegram webhook failure state:", sanitizeTelegramWebhookError(getErrorMessage(persistenceError)));
      }
    }
    if (callbackQueryId) {
      await answerTelegramCallbackQuery({ callbackQueryId, botToken: input.botToken, text: "Не удалось сохранить фидбек" }).catch(() => {});
    }
    console.error("Failed to process Telegram callback:", sanitizeTelegramWebhookError(message));
    return NextResponse.json({ error: PUBLIC_PROCESSING_ERROR }, { status: 500 });
  }
}

function buildTelegramFeedbackIdempotencyKey(
  update: TelegramWebhookUpdate,
  callback: ReturnType<typeof verifyDigestFeedbackCallback>,
  callbackQueryId: string | null,
): string {
  if (callback) {
    const identity = callback.digest_candidate_id ?? callback.org_id ?? callback.sig;
    return `tg:feedback:${callback.client_profile_id}:${identity}:${callback.action}:${callback.nonce ?? callback.sig}`;
  }
  return `tg:${update.update_id ?? "na"}:${callbackQueryId ?? "na"}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Telegram webhook error.";
}

function getDigestFeedbackConfirmationText(action: DigestFeedbackAction): string {
  switch (action) {
    case "accepted": return "Отмечено: беру";
    case "badfit": return "Отмечено: мимо";
    case "snooze": return "Отмечено: позже";
    case "dismissed": return "Отмечено: скрыто";
    case "contacted": return "Отмечено: написал";
    case "replied": return "Отмечено: ответили";
    case "meeting": return "Отмечено: созвон";
    case "won": return "Отмечено: клиент";
  }
}
function normalizeNonEmptyString(value: string | null | undefined): string | null { if (typeof value !== "string") return null; const normalizedValue = value.trim(); return normalizedValue === "" ? null : normalizedValue; }
function parseStartToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized.startsWith("/start")) return null;
  const token = normalized.slice(6).trim();
  return token === "" ? null : token;
}

function normalizeTelegramChatId(value: string | number | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}
