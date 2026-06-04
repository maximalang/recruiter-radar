"use server";

import { updateLeadFeedback } from "@/lib/leads-data";
import { getPool } from "@/lib/db";
import { getTelegramBotToken, sendTelegramTextMessage } from "@/lib/telegram";
import { getOwnerIdFromSession } from "@/lib/session";

/**
 * Verify the current session owns the given client profile.
 * Returns true if ownership is confirmed, false otherwise.
 */
async function verifyProfileOwnership(clientProfileId: string): Promise<boolean> {
  const ownerId = await getOwnerIdFromSession();
  if (!ownerId) return false;

  const pool = getPool();
  if (!pool) return false;

  const result = await pool.query<{ ok: boolean }>(
    "SELECT 1 AS ok FROM client_profiles WHERE id = $1 AND owner_id = $2 LIMIT 1",
    [clientProfileId, ownerId],
  );
  return result.rowCount === 1;
}

export async function updateLeadFeedbackAction(
  orgId: string,
  clientProfileId: string,
  feedbackStatus: string,
  feedbackNote?: string | null,
) {
  const isOwner = await verifyProfileOwnership(clientProfileId);
  if (!isOwner) {
    throw new Error("Access denied: ownership check failed for this client profile.");
  }

  const result = await updateLeadFeedback({
    orgId,
    clientProfileId,
    feedbackStatus,
    feedbackNote,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Send an outreach message to the client's Telegram chat.
 *
 * Looks up the telegram_chat_id for the given client profile,
 * verifies ownership, then sends the text message via the Telegram Bot API.
 */
export async function sendOutreachToTelegramAction(
  clientProfileId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!message || message.trim().length === 0) {
    return { ok: false, error: "Message is empty." };
  }

  const isOwner = await verifyProfileOwnership(clientProfileId);
  if (!isOwner) {
    return { ok: false, error: "Access denied: ownership check failed." };
  }

  const pool = getPool();
  if (!pool) {
    return { ok: false, error: "Database not configured." };
  }

  // Look up telegram chat id
  const profileResult = await pool.query<{ telegram_chat_id: string | null }>(
    "SELECT telegram_chat_id FROM client_profiles WHERE id = $1",
    [clientProfileId],
  );

  const chatId = profileResult.rows[0]?.telegram_chat_id;
  if (!chatId) {
    return { ok: false, error: "У профиля нет подключённого Telegram чата." };
  }

  const { botToken, error } = getTelegramBotToken();
  if (!botToken) {
    return { ok: false, error: `Telegram не настроен: ${error ?? "unknown"}` };
  }

  try {
    await sendTelegramTextMessage(message, { botToken, chatId });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ошибка отправки в Telegram",
    };
  }
}
