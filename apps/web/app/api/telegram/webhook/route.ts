import { NextResponse } from "next/server";

import { getPool } from "../../../../lib/db";
import { logError, logEvent, requireServerEnv } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackAction = "take" | "badfit" | "later" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "hide_similar";

const ACTION_TO_STATUS: Partial<Record<CallbackAction, string>> = {
  take: "contacted",
  badfit: "badfit",
  later: "snooze",
  snooze: "snooze",
  contacted: "contacted",
  replied: "replied",
  meeting: "replied",
  won: "won"
};

async function answerCallback(botToken: string, callbackId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

export async function POST(request: Request) {
  const secret = requireServerEnv("TELEGRAM_WEBHOOK_SECRET");
  const botToken = requireServerEnv("TELEGRAM_BOT_TOKEN");
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payload = await request.json();
  const callback = payload?.callback_query;
  if (!callback?.id || typeof callback?.data !== "string") {
    return NextResponse.json({ ok: true });
  }

  const action = String(callback.data).split(":")[0] as CallbackAction;
  const eventId = callback.id as string;
  const idempotencyKey = `telegram-callback:${eventId}`;
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const existing = await pool.query(`SELECT id FROM webhook_events WHERE provider='telegram' AND idempotency_key=$1`, [idempotencyKey]);
  if ((existing.rowCount ?? 0) > 0) {
    await answerCallback(botToken, eventId, "Уже обработано");
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await pool.query(
    `INSERT INTO webhook_events (provider, event_type, external_event_id, idempotency_key, payload)
     VALUES ('telegram', 'callback_query', $1, $2, $3::jsonb)`,
    [eventId, idempotencyKey, JSON.stringify(payload)]
  );

  try {
    const leadId = Number(String(callback.data).split(":")[1] ?? "0");
    const status = ACTION_TO_STATUS[action];
    if (status && Number.isInteger(leadId) && leadId > 0) {
      const lead = await pool.query<{ status: string }>(`SELECT status::text AS status FROM leads WHERE id = $1`, [leadId]);
      const prev = lead.rows[0]?.status ?? null;
      await pool.query(`UPDATE leads SET status = $2 WHERE id = $1`, [leadId, status]);
      await pool.query(
        `INSERT INTO lead_status (lead_id, from_status, to_status, changed_by, note)
         VALUES ($1, $2::lead_state, $3::lead_state, 'user', $4)`,
        [leadId, prev, status, `Telegram callback action: ${action}`]
      );
    }

    await pool.query(`UPDATE webhook_events SET status='processed', processed_at=NOW() WHERE provider='telegram' AND idempotency_key=$1`, [idempotencyKey]);
    await answerCallback(botToken, eventId, "Принято ✅");
    logEvent("telegram.callback.processed", { eventId, action });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("telegram.callback.failed", error, { eventId });
    await pool.query(`UPDATE webhook_events SET status='failed', error_message=$2 WHERE provider='telegram' AND idempotency_key=$1`, [idempotencyKey, "processing_failed"]);
    await answerCallback(botToken, eventId, "Ошибка обработки");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
