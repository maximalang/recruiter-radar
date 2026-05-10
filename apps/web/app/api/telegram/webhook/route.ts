import { NextResponse } from "next/server";

import {
  isDigestFeedbackAction,
  updateDigestOrgStateFeedback,
  type DigestFeedbackAction
} from "../../../../lib/digestFeedback";
import { answerTelegramCallbackQuery, getTelegramBotToken } from "../../../../lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramWebhookUpdate = {
  callback_query?: {
    id?: string;
    data?: string;
  };
};

type ParsedDigestFeedbackCallback = {
  clientProfileId: string;
  orgId: string;
  action: DigestFeedbackAction | "shown";
};

export async function POST(request: Request) {
  const { botToken, error } = getTelegramBotToken();

  if (!botToken) {
    return NextResponse.json({ error: error ?? "TELEGRAM_BOT_TOKEN is not configured." }, { status: 500 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const update = body as TelegramWebhookUpdate;
  const callbackQueryId = normalizeNonEmptyString(update?.callback_query?.id);
  const parsedCallback = parseDigestFeedbackCallbackData(update?.callback_query?.data);

  if (!callbackQueryId || !parsedCallback) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (parsedCallback.action === "shown") {
    await answerTelegramCallbackQuery({
      callbackQueryId,
      botToken
    });

    return NextResponse.json({ ok: true, ignored: true, action: parsedCallback.action });
  }

  try {
    const state = await updateDigestOrgStateFeedback({
      clientProfileId: parsedCallback.clientProfileId,
      orgId: parsedCallback.orgId,
      action: parsedCallback.action
    });

    await answerTelegramCallbackQuery({
      callbackQueryId,
      botToken,
      text: getDigestFeedbackConfirmationText(parsedCallback.action)
    });

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    await answerTelegramCallbackQuery({
      callbackQueryId,
      botToken,
      text: "Не удалось сохранить фидбек"
    }).catch(() => {});

    const message = error instanceof Error ? error.message : "Failed to process Telegram callback feedback.";
    const status = message.startsWith("Invalid ") || message.includes("is required") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export function parseDigestFeedbackCallbackData(value: string | null | undefined): ParsedDigestFeedbackCallback | null {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    return null;
  }

  const [prefix, clientProfileId, orgId, action, ...rest] = normalizedValue.split(":");

  if (prefix !== "dgf" || rest.length > 0) {
    return null;
  }

  if (!isPositiveIntegerString(clientProfileId) || !isPositiveIntegerString(orgId)) {
    return null;
  }

  if (action === "shown") {
    return {
      clientProfileId,
      orgId,
      action
    };
  }

  if (!isDigestFeedbackAction(action)) {
    return null;
  }

  return {
    clientProfileId,
    orgId,
    action
  };
}

function getDigestFeedbackConfirmationText(action: DigestFeedbackAction): string {
  switch (action) {
    case "accepted":
      return "Отмечено: беру";
    case "badfit":
      return "Отмечено: мимо";
    case "snooze":
      return "Отмечено: позже";
    case "dismissed":
      return "Отмечено: скрыто";
    case "contacted":
      return "Отмечено: contacted";
    case "replied":
      return "Отмечено: replied";
    case "won":
      return "Отмечено: won";
  }
}

function isPositiveIntegerString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === "" ? null : normalizedValue;
}
