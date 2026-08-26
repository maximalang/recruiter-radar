import { NextResponse } from "next/server";

import { updateDigestOrgStateFeedback } from "@/lib/digestFeedback";
import {
  authorizeTelegramCallbackOrigin,
  bindNotificationEndpoint,
  decryptTelegramAccountCredentials,
  finalizeNotificationInboundEvent,
  getNotificationAccountByPublicId,
  recordNotificationInboundClaim,
  runNotificationInboundTransaction,
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
    message?: {
      chat?: { id?: string | number; type?: "private" | "group" | "supergroup" | "channel" };
    };
  };
};

type InboundClaim = Extract<
  Awaited<ReturnType<typeof recordNotificationInboundClaim>>,
  { ownsClaim: true }
>;

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
  if (update.callback_query) {
    return processCallbackAtomically({ account, credentials, update, providerEventId });
  }
  let claim: Awaited<ReturnType<typeof recordNotificationInboundClaim>>;
  try {
    claim = await recordNotificationInboundClaim({
      accountId: account.id,
      provider: "telegram",
      providerEventId,
      eventType: update.callback_query ? "callback_query" : "message",
      payload: update,
    });
  } catch {
    // Ledger unavailable: tell Telegram to redeliver instead of silently
    // dropping the update.
    return NextResponse.json({ ok: false, retryable: true }, { status: 503 });
  }
  if (!claim.ownsClaim) {
    if (claim.status === "processed" || claim.status === "ignored") {
      // Genuine redelivery of an already-settled event: acknowledge without
      // running bind/feedback side effects a second time.
      return NextResponse.json({ ok: true, duplicate: true });
    }
    // Another worker holds a fresh claim. Answer 409 so Telegram schedules a
    // redelivery; if that worker fails, its own finalize marks the row
    // failed and a later redelivery can take over the stale claim.
    return NextResponse.json(
      { ok: false, retryable: true, error: "Event is already processing." },
      { status: 409 },
    );
  }

  try {
    const result = await processUpdate(update, { account, credentials, claim });
    return NextResponse.json(result);
  } catch (error) {
    await finalizeNotificationInboundEvent({
      accountId: account.id,
      eventId: claim.eventId,
      status: "failed",
      claimToken: claim.claimToken,
      errorMessage: error instanceof Error ? error.message : null,
    }).catch(() => {});
    return NextResponse.json({ ok: false, retryable: true }, { status: 500 });
  }
}

type CallbackTransactionResult = {
  ignored?: boolean;
  feedback?: boolean;
  callbackId: string | null;
  callbackText?: string;
};

async function processCallbackAtomically(input: {
  account: NonNullable<Awaited<ReturnType<typeof getNotificationAccountByPublicId>>>;
  credentials: { botToken: string };
  update: TelegramUpdate;
  providerEventId: string | null;
}): Promise<Response> {
  const callbackId = input.update.callback_query?.id?.trim() || null;
  const callback = verifyDigestFeedbackCallback(input.update.callback_query?.data ?? null);
  const callbackChat = input.update.callback_query?.message?.chat;
  const callbackChatId = callbackChat?.id == null ? null : String(callbackChat.id);
  const actorId = input.update.callback_query?.from?.id == null
    ? null
    : String(input.update.callback_query.from.id);
  const privateSelfOrigin =
    callbackChat?.type === "private"
    && callbackChatId !== null
    && actorId !== null
    && callbackChatId === actorId;

  try {
    const result = await runNotificationInboundTransaction<CallbackTransactionResult>({
      accountId: input.account.id,
      provider: "telegram",
      providerEventId: input.providerEventId,
      eventType: "callback_query",
      payload: input.update,
      semanticKey: input.update.callback_query?.data ?? null,
    }, async (_claim, db) => {
      if (!callbackId || !callback || !privateSelfOrigin) {
        return {
          status: "ignored" as const,
          value: { ignored: true, callbackId, callbackText: undefined },
        };
      }

      const profileMismatch = String(callback.client_profile_id) !== String(input.account.clientProfileId);
      const callbackAuthorized = !profileMismatch
        ? await authorizeTelegramCallbackOrigin({
            accountId: input.account.id,
            clientProfileId: String(input.account.clientProfileId),
            chatId: callbackChatId,
            actorId,
          })
        : false;
      if (profileMismatch || !callbackAuthorized) {
        return {
          status: "ignored" as const,
          value: {
            ignored: true,
            callbackId,
            callbackText: profileMismatch
              ? "Эта карточка относится к другому профилю"
              : "Кнопка недоступна в этом чате",
          },
        };
      }

      if (callback.action !== "shown") {
        if (!(["accepted", "badfit", "dismissed", "snooze", "contacted", "replied", "meeting", "won"] as string[]).includes(callback.action)) {
          return {
            status: "ignored" as const,
            value: { ignored: true, callbackId, callbackText: undefined },
          };
        }
        await updateDigestOrgStateFeedback({
          clientProfileId: callback.client_profile_id,
          orgId: callback.org_id,
          digestCandidateId: callback.digest_candidate_id,
          action: callback.action,
        }, db);
      }
      return {
        status: "processed" as const,
        value: {
          feedback: true,
          callbackId,
          callbackText: callback.action === "shown" ? undefined : "Сохранено",
        },
      };
    });

    if (result.duplicate) return NextResponse.json({ ok: true, duplicate: true });
    if (result.value.callbackId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: result.value.callbackId,
        botToken: input.credentials.botToken,
        text: result.value.callbackText,
      }).catch(() => {});
    }
    return NextResponse.json(result.value);
  } catch {
    if (callbackId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        botToken: input.credentials.botToken,
        text: "Не удалось сохранить фидбек",
      }).catch(() => {});
    }
    return NextResponse.json({ ok: false, retryable: true }, { status: 500 });
  }
}

async function processUpdate(
  update: TelegramUpdate,
  env: {
    account: NonNullable<Awaited<ReturnType<typeof getNotificationAccountByPublicId>>>;
    credentials: { botToken: string };
    claim: InboundClaim;
  },
): Promise<Record<string, unknown>> {
  const message = update.message ?? update.channel_post;
  const bindToken = parseBindToken(message?.text);
  const chatId = message?.chat?.id == null ? null : String(message.chat.id);

  if (bindToken && chatId && message?.chat) {
    const bound = await bindNotificationEndpoint({
      account: env.account,
      bindToken,
      destinationId: chatId,
      destinationLabel: chatLabel(message.chat),
      endpointType: endpointType(message.chat.type),
    });
    await sendTelegramTextMessage(
      bound.status === "bound"
        ? "Канал Recruiter Radar подключён. Тестовое и следующее плановое уведомление придут сюда."
        : "Ссылка подключения устарела или уже использована. Создайте новую в профиле Recruiter Radar.",
      { botToken: env.credentials.botToken, chatId },
    ).catch(() => {});
    await settle("processed");
    return { ok: true, bindStatus: bound.status };
  }

  const callbackId = update.callback_query?.id?.trim() || null;
  const callbackChatId =
    update.callback_query?.message?.chat?.id == null
      ? null
      : String(update.callback_query.message.chat.id);
  const actorId =
    update.callback_query?.from?.id == null ? null : String(update.callback_query.from.id);
  const callback = verifyDigestFeedbackCallback(update.callback_query?.data ?? null);

  if (callbackId && callback) {
    // Fail-closed origin gate: only a private chat whose id equals the
    // pressing user's id, verified against the bound private-chat endpoint
    // for this account/profile, may mutate feedback state.
    const profileMismatch =
      String(callback.client_profile_id) !== String(env.account.clientProfileId);
    const isPrivateOrigin = callbackChatId !== null && callbackChatId === actorId;
    const callbackAuthorized = isPrivateOrigin
      ? await authorizeTelegramCallbackOrigin({
          accountId: env.account.id,
          clientProfileId: String(env.account.clientProfileId),
          chatId: callbackChatId,
          actorId,
        })
      : false;

    if (profileMismatch || !callbackAuthorized) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackId,
        botToken: env.credentials.botToken,
        text: profileMismatch
          ? "Эта карточка относится к другому профилю"
          : "Кнопка недоступна в этом чате",
      }).catch(() => {});
      await settle("ignored");
      return { ok: true, ignored: true };
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
      botToken: env.credentials.botToken,
      text: callback.action === "shown" ? undefined : "Сохранено",
    }).catch(() => {});
    await settle("processed");
    return { ok: true, feedback: true };
  }

  // Not a bind command and not a valid signed callback: answer silently and
  // record why nothing was applied.
  if (callbackId) {
    await answerTelegramCallbackQuery({
      callbackQueryId: callbackId,
      botToken: env.credentials.botToken,
    }).catch(() => {});
  }
  await settle("ignored");
  return { ok: true, ignored: true };

  async function settle(target: "processed" | "ignored"): Promise<void> {
    await finalizeNotificationInboundEvent({
      accountId: env.account.id,
      eventId: env.claim.eventId,
      status: target,
      claimToken: env.claim.claimToken,
    });
  }
}
