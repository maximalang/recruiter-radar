import type { LeadStatus } from "./db";

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

export type TelegramMessageConfig = {
  botToken: string;
  chatId: string;
};

type TelegramLeadMessage = {
  orgName: string;
  status: LeadStatus;
  score: number | null;
  lastSignalAt: string | null;
  userName: string;
};

type TelegramSendResult = {
  messageId: number;
};

export type TelegramTextMessageResult = TelegramSendResult & {
  chatId: string;
};

type TelegramApiSuccess = {
  ok: true;
  result: {
    message_id: number;
  };
};

type TelegramApiFailure = {
  ok: false;
  description?: string;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatTelegramLeadMessage(lead: TelegramLeadMessage): string {
  return [
    `Компания: ${lead.orgName}`,
    `Статус: ${lead.status}`,
    `Score: ${lead.score ?? "-"}`,
    `Last signal at: ${formatDate(lead.lastSignalAt)}`,
    `Пользователь: ${lead.userName}`
  ].join("\n");
}

function isTelegramApiSuccess(value: unknown): value is TelegramApiSuccess {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<TelegramApiSuccess>;

  return result.ok === true && typeof result.result?.message_id === "number";
}

function getTelegramErrorDescription(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as TelegramApiFailure;

  return typeof result.description === "string" ? result.description : null;
}

export function getTelegramConfig(): {
  config: TelegramConfig | null;
  error: string | null;
} {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const missingEnvVars = [
    !botToken ? "TELEGRAM_BOT_TOKEN" : null,
    !chatId ? "TELEGRAM_CHAT_ID" : null
  ].filter((value): value is string => value !== null);

  if (missingEnvVars.length > 0) {
    return {
      config: null,
      error: `Telegram is not configured. Missing ${missingEnvVars.join(" and ")}.`
    };
  }

  const resolvedBotToken = botToken ?? "";
  const resolvedChatId = chatId ?? "";

  if (!/^-?\d+$/.test(resolvedChatId)) {
    return {
      config: null,
      error: "TELEGRAM_CHAT_ID must be a numeric chat id."
    };
  }

  return {
    config: {
      botToken: resolvedBotToken,
      chatId: resolvedChatId
    },
    error: null
  };
}

export function getTelegramConfigError(): string | null {
  return getTelegramConfig().error;
}

export function getTelegramBotToken(): {
  botToken: string | null;
  error: string | null;
} {
  const { config, error } = getTelegramConfig();

  return {
    botToken: config?.botToken ?? null,
    error
  };
}

export async function getTelegramBotUsername(): Promise<{
  username: string | null;
  error: string | null;
}> {
  const { botToken, error } = getTelegramBotToken();

  if (!botToken) {
    return {
      username: null,
      error
    };
  }

  return {
    username: process.env.TELEGRAM_BOT_USERNAME?.trim() || null,
    error: null
  };
}

export async function sendTelegramTextMessage(
  text: string,
  config: TelegramMessageConfig,
  options?: {
    replyMarkup?: unknown;
  }
): Promise<TelegramTextMessageResult> {
  void options;

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    cache: "no-store",
    body: JSON.stringify({
      chat_id: config.chatId,
      text
    })
  });

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !isTelegramApiSuccess(payload)) {
    const description =
      getTelegramErrorDescription(payload) ??
      `Telegram request failed with status ${response.status}.`;

    throw new Error(description);
  }

  return {
    chatId: config.chatId,
    messageId: payload.result.message_id
  };
}

export async function sendTelegramLeadMessage(
  lead: TelegramLeadMessage,
  config: TelegramConfig
): Promise<TelegramSendResult> {
  const response = await fetch(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      cache: "no-store",
      body: JSON.stringify({
        chat_id: config.chatId,
        text: formatTelegramLeadMessage(lead)
      })
    }
  );

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !isTelegramApiSuccess(payload)) {
    const description =
      getTelegramErrorDescription(payload) ??
      `Telegram request failed with status ${response.status}.`;

    throw new Error(description);
  }

  return {
    messageId: payload.result.message_id
  };
}
