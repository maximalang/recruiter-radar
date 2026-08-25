import { NextResponse } from "next/server";

import { updateDigestOrgStateFeedback } from "@/lib/digestFeedback";
import {
  bindNotificationEndpoint,
  authorizeTelegramCallbackOrigin,
  decryptTelegramAccountCredentials,
  getNotificationAccountByPublicId,
  recordNotificationInboundEvent,
} from "@/lib/notifications";
import { timingSafeTextEqual } from "@/lib/notification-secrets";
import { answerTelegramCallbackQuery, sendTelegramTextMessage } from "@/lib/telegram";
import { verifyDigestFeedbackCallback } from "@/lib/telegramDigestFeedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id?: string | number;
      type?: "private" | "group" | "supergroup" | "channel";
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
  };
  channel_post?: TelegramUpdate["message"];
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: string | number; username?: string };
    message?: { chat?: { id?: string | number; type?: "private" | "group" | "supergroup" | "channel" } };
  };
};

function parseBindToken(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.trim().match(/^\/(?:start|connect)(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{20,})$/);
  return match?.[1] ?? null;
}

function chatLabel(chat: NonNullable<NonNullable<TelegramUpdate["message"]>["chat"]>): string {
  return (
    chat.title?.trim() ||
    (chat.username ? `@${chat.username}` : "") ||
    [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim() ||
    `Telegram ${chat.id}`
  ).slice(0, 160);
}

function endpointType(type: string | undefined):
  | "telegram_private_chat"
  | "telegram_group"
  | "telegram_channel" {
  if (type === "channel") return "telegram_channel";
  if (type === "group" || type === "supergroup") return "telegram_group";
  return "telegram_private_chat";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const account = await getNotificationAccountByPublicId("telegram", publicId);
  if (!account) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const credentials = decryptTelegramAccountCredentials(account);
  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token")?.trim() ?? "";
  if (!providedSecret || !timingSafeTextEqual(providedSecret, credentials.webhookSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const providerEventId = update.update_id == null ? null : String(update.update_id);
  const accepted = await recordNotificationInboundEvent({
    accountId: account.id,
    provider: "telegram",
    providerEventId,
    eventType: update.callback_query ? "callback_query" : "message",
    payload: update,
    status: "processed",
  });
  if (!accepted) return NextResponse.json({ ok: true, duplicate: true });

  const message = update.message ?? update.channel_post;
  const bindToken = parseBindToken(message?.text);
  const chatId = message?.chat?.id == null ? null : String(message.chat.id);
  if (bindToken && chatId && message?.chat) {
    const bound = await bindNotificationEndpoint({
      account,
      bindToken,
      destinationId: chatId,
      destinationLabel: chatLabel(message.chat),
      endpointType: endpointType(message.chat.type),
    });
    if (bound.status === "bound") {
      await sendTelegramTextMessage(
        "Канал Recruiter Radar подключён. Тестовое и следующее плановое уведомление придут сюда.",
        { botToken: credentials.botToken, chatId },
      ).catch(() => {});
    } else {
      await sendTelegramTextMessage(
        "Ссылка подключения устарела или уже использована. Создайте новую в профиле Recruiter Radar.",
        { botToken: credentials.botToken, chatId },
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true, bindStatus: bound.status });
  }

  const callbackId = update.callback_query?.id?.trim();
  const callback = verifyDigestFeedbackCallback(update.callback_query?.data ?? null);
  if (callbackId && callback) {
    if (String(callback.client_profile_id) !== String(account.clientProfileId)) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        botToken: credentials.botToken,
        text: "Эта карточка относится к другому профилю",
      }).catch(() => {});
      return NextResponse.json({ ok: true, ignored: true });
    }
    const callbackAuthorized = await authorizeTelegramCallbackOrigin({
      accountId: account.id,
      clientProfileId: String(account.clientProfileId),
      chatId:
        update.callback_query?.message?.chat?.id == null
          ? null
          : String(update.callback_query.message.chat.id),
      actorId:
        update.callback_query?.from?.id == null
          ? null
          : String(update.callback_query.from.id),
    });
    if (!callbackAuthorized) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        botToken: credentials.botToken,
        text: "Кнопка недоступна в этом чате",
      }).catch(() => {});
      return NextResponse.json({ ok: true, ignored: true });
    }
    if (callback.action !== "shown") {
      await updateDigestOrgStateFeedback({
        clientProfileId: callback.client_profile_id,
        orgId: callback.org_id,
        action: callback.action,
      });
    }
    await answerTelegramCallbackQuery({
      callbackQueryId: callbackId,
      botToken: credentials.botToken,
      text: callback.action === "shown" ? undefined : "Сохранено",
    }).catch(() => {});
    return NextResponse.json({ ok: true, feedback: true });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
