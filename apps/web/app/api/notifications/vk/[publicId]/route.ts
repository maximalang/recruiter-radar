import { NextResponse } from "next/server";

import { sendVkNotification } from "@/lib/notification-providers";
import { timingSafeTextEqual } from "@/lib/notification-secrets";
import {
  bindNotificationEndpoint,
  decryptVkAccountCredentials,
  getNotificationAccountByPublicId,
  recordNotificationInboundEvent,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VkCallback = {
  type?: string;
  group_id?: number | string;
  event_id?: string;
  secret?: string;
  object?: {
    message?: {
      id?: number | string;
      peer_id?: number | string;
      text?: string;
      from_id?: number | string;
      conversation_message_id?: number | string;
    };
  };
};

function parseConnectToken(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.trim().match(/^\/connect\s+([A-Za-z0-9_-]{20,})$/i);
  return match?.[1] ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const account = await getNotificationAccountByPublicId("vk", publicId);
  if (!account) return new NextResponse("not found", { status: 404 });

  let payload: VkCallback;
  try {
    payload = (await request.json()) as VkCallback;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  const credentials = decryptVkAccountCredentials(account);
  const providedSecret = payload.secret?.trim() ?? "";
  if (!providedSecret || !timingSafeTextEqual(providedSecret, credentials.callbackSecret)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (String(payload.group_id ?? "") !== String(credentials.groupId)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  if (payload.type === "confirmation") {
    await recordNotificationInboundEvent({
      accountId: account.id,
      provider: "vk",
      providerEventId: payload.event_id ?? null,
      eventType: "confirmation",
      payload,
      status: "processed",
    });
    return new NextResponse(credentials.confirmationCode, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const accepted = await recordNotificationInboundEvent({
    accountId: account.id,
    provider: "vk",
    providerEventId: payload.event_id ?? null,
    eventType: payload.type ?? "unknown",
    payload,
    status: "processed",
  });
  if (!accepted) return new NextResponse("ok", { status: 200 });

  const message = payload.object?.message;
  const bindToken = parseConnectToken(message?.text);
  const peerId = message?.peer_id == null ? null : String(message.peer_id);
  if (payload.type === "message_new" && bindToken && peerId) {
    const bound = await bindNotificationEndpoint({
      account,
      bindToken,
      destinationId: peerId,
      destinationLabel: `VK диалог ${peerId}`,
      endpointType: "vk_peer",
    });
    await sendVkNotification({
      token: credentials.token,
      peerId,
      text:
        bound.status === "bound"
          ? "Канал Recruiter Radar подключён. Следующая подборка придёт в этот диалог."
          : "Код подключения устарел или уже использован. Создайте новый код в профиле Recruiter Radar.",
      randomId: Math.floor(Date.now() % 2_147_483_647),
    }).catch(() => {});
  }

  return new NextResponse("ok", { status: 200 });
}
