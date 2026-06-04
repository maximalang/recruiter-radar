"use server";

import { updateLeadFeedback } from "@/lib/leads-data";
import { getPool } from "@/lib/db";
import { getTelegramBotToken, sendTelegramTextMessage } from "@/lib/telegram";
import { getOwnerIdFromSession } from "@/lib/session";

/**
 * Verify the current session owns the given client profile.
 *
 * Checks that:
 * 1. The profile exists and is active
 * 2. The session ownerId matches the profile's owner_id
 *    OR the profile has no owner_id (pilot/anonymous — allowed for now)
 *
 * Returns true if access is granted, false otherwise.
 */
async function verifyProfileOwnership(clientProfileId: string): Promise<boolean> {
  const ownerId = await getOwnerIdFromSession();
  // No session → deny
  if (!ownerId) return false;

  const pool = getPool();
  if (!pool) return false;

  // Allow access if:
  // - profile has owner_id matching session ownerId, OR
  // - profile has no owner_id (pilot/anonymous — not yet claimed)
  const result = await pool.query<{ ok: boolean }>(
    `SELECT 1 AS ok FROM client_profiles
     WHERE id = $1
       AND (owner_id = $2 OR owner_id IS NULL)
       AND is_active = true
     LIMIT 1`,
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
 * Verifies ownership, looks up the telegram_chat_id, and sends
 * the text message via the Telegram Bot API.
 * Combines ownership + chat_id lookup into a single query.
 */
export async function sendOutreachToTelegramAction(
  clientProfileId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!message || message.trim().length === 0) {
    return { ok: false, error: "Message is empty." };
  }

  const ownerId = await getOwnerIdFromSession();
  if (!ownerId) {
    return { ok: false, error: "Access denied: no active session." };
  }

  const pool = getPool();
  if (!pool) {
    return { ok: false, error: "Database not configured." };
  }

  // Combine ownership check + chat_id lookup into one query
  const profileResult = await pool.query<{
    ok: boolean;
    telegram_chat_id: string | null;
  }>(
    `SELECT 1 AS ok, telegram_chat_id
     FROM client_profiles
     WHERE id = $1
       AND (owner_id = $2 OR owner_id IS NULL)
       AND is_active = true
     LIMIT 1`,
    [clientProfileId, ownerId],
  );

  if (profileResult.rowCount !== 1) {
    return { ok: false, error: "Access denied: ownership check failed." };
  }

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
