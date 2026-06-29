import type { LeadStatus } from "./db";

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

export type TelegramMessageConfig = {
  botToken: string;
  chatId: string;
};

export type TelegramLeadMessage = {
  orgName: string;
  status: LeadStatus;
  score: number | null;
  lastSignalAt: string | null;
  userName: string;
  confidence_gate?: string;
  /** Premium evidence-first fields. When present, the rich HTML card is sent. */
  whyNow?: string | null;
  evidenceTitles?: string[];
  vacanciesCount?: number | null;
  lawfulContactPath?: string | null;
  sourceFamilies?: string[];
  locationNames?: string[];
  /** Domain / career page give a concrete corporate surface line. */
  orgDomain?: string | null;
  careerPageUrl?: string | null;
  /** 2–3 concrete filter criteria this lead satisfies for the agency profile. */
  whyMatch?: string[];
  /** One-line AI-recovered hiring summary, shown with an explicit AI label. */
  aiHint?: string | null;
};

type TelegramSendResult = {
  messageId: number;
};

export type TelegramTextMessageResult = TelegramSendResult & {
  chatId: string;
};

type TelegramApiSuccess = {
  ok: true;
  result: unknown;
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

/**
 * Escape the five characters Telegram's HTML parse mode treats as markup.
 * Applied to every user/company-derived string before it enters the message,
 * so a company name like "Romashka & Co <Group>" can never break the markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type GatePresentation = {
  /** Readiness headline — A/B are ready to reach out, C needs review. */
  readiness: string;
  /** Single restrained status icon. */
  icon: string;
};

/**
 * Map a confidence gate to its delivery presentation. The product contract
 * (CLAUDE.md confidence gates) splits delivery into "ready to reach out" (A/B)
 * vs "review manually" (C). D never reaches a lead, so it is treated as C.
 */
function getGatePresentation(gate: string | undefined): GatePresentation {
  switch (gate) {
    case "A":
      return { readiness: "Готов к контакту", icon: "✅" };
    case "B":
      return { readiness: "Готов к контакту · с пометкой", icon: "✅" };
    case "C":
      return { readiness: "На проверку", icon: "🔍" };
    default:
      return { readiness: "На проверку", icon: "🔍" };
  }
}

function formatScore(score: number | null): string {
  if (score == null) return "—";
  return Number.isInteger(score) ? `${score}.0` : score.toFixed(1);
}

/**
 * FIUR score band for the card header — a one-glance temperature read. The FIUR
 * total is ∈ [0, 4]: ≥3 is a hot lead, ≥2 warm, below that cold. Mirrors the
 * "companies worth contacting today" framing without inventing precision.
 */
function getScoreBand(score: number | null): { label: string; icon: string } {
  if (score == null) return { label: "Холодный", icon: "🔵" };
  if (score >= 3) return { label: "Горячий", icon: "🔥" };
  if (score >= 2) return { label: "Тёплый", icon: "🟠" };
  return { label: "Холодный", icon: "🔵" };
}

/**
 * Whether the lead carries enough evidence to render the premium card.
 * Without it we fall back to the compact safe summary.
 */
function hasRichEvidence(lead: TelegramLeadMessage): boolean {
  return Boolean(
    (lead.whyNow && lead.whyNow.trim()) ||
    (lead.evidenceTitles && lead.evidenceTitles.length > 0) ||
    (lead.lawfulContactPath && lead.lawfulContactPath.trim())
  );
}

/**
 * Premium, mobile-first, evidence-first lead card for Telegram (HTML parse mode).
 * Mirrors the /leads/[id] page hierarchy: company → readiness/score/gate →
 * why now → role signal → safe contact path → sources. Restrained iconography
 * (one glyph per line), tight whitespace, no wall of text. Feedback buttons are
 * attached separately via reply_markup by the caller.
 */
export function formatTelegramLeadMessage(lead: TelegramLeadMessage): string {
  if (!hasRichEvidence(lead)) {
    return formatCompactLeadMessage(lead);
  }

  const gate = getGatePresentation(lead.confidence_gate);
  const band = getScoreBand(lead.score);
  const lines: string[] = [];

  // Header: company + readiness badge line (score band + score + gate letter)
  lines.push(`🏢 <b>${escapeHtml(lead.orgName)}</b>`);
  const gateLetter = lead.confidence_gate ? ` · ${escapeHtml(lead.confidence_gate)}` : "";
  lines.push(`${band.icon} ${band.label} · ${gate.readiness} · ${formatScore(lead.score)}${gateLetter}`);

  // Why now
  if (lead.whyNow && lead.whyNow.trim()) {
    lines.push("");
    lines.push(`🎯 <b>Почему сейчас</b>`);
    lines.push(escapeHtml(lead.whyNow.trim()));
  }

  // Why this match — concrete filter criteria the lead satisfies for the agency.
  if (lead.whyMatch && lead.whyMatch.length > 0) {
    lines.push("");
    lines.push(`🤝 <b>Почему вам</b>`);
    for (const reason of lead.whyMatch.slice(0, 3)) {
      lines.push(`• ${escapeHtml(reason)}`);
    }
  }

  // Role / hiring signal — top evidence titles, compact
  if (lead.evidenceTitles && lead.evidenceTitles.length > 0) {
    const top = lead.evidenceTitles.slice(0, 3).map((t) => escapeHtml(t)).join(", ");
    const more = lead.evidenceTitles.length > 3 ? ` +${lead.evidenceTitles.length - 3}` : "";
    const count = lead.vacanciesCount && lead.vacanciesCount > 0 ? ` (${lead.vacanciesCount} вак.)` : "";
    lines.push("");
    lines.push(`📋 ${top}${more}${count}`);
  }

  // Location (single line, first only — mobile-tight)
  if (lead.locationNames && lead.locationNames.length > 0) {
    lines.push(`📍 ${escapeHtml(lead.locationNames[0])}`);
  }

  // Safe contact path + concrete surface
  if (lead.lawfulContactPath && lead.lawfulContactPath.trim()) {
    lines.push(`📬 ${escapeHtml(lead.lawfulContactPath.trim())}`);
  }
  const surface = lead.careerPageUrl || (lead.orgDomain ? `https://${lead.orgDomain}` : null);
  if (surface) {
    lines.push(`🔗 ${escapeHtml(surface)}`);
  }

  // AI hint — secondary, explicitly labelled. Advisory only; never evidence.
  if (lead.aiHint && lead.aiHint.trim()) {
    lines.push("");
    lines.push(`✨ <i>AI-подсказка: ${escapeHtml(lead.aiHint.trim())}</i>`);
  }

  // Sources (trust)
  if (lead.sourceFamilies && lead.sourceFamilies.length > 0) {
    lines.push("");
    lines.push(`<i>Источники: ${lead.sourceFamilies.map((s) => escapeHtml(s)).join(", ")}</i>`);
  }

  return lines.join("\n");
}

/**
 * Compact fallback when evidence fields are absent (e.g. minimal delivery rows).
 * Still HTML-escaped and premium in tone — never the old raw key:value dump.
 */
function formatCompactLeadMessage(lead: TelegramLeadMessage): string {
  const gate = getGatePresentation(lead.confidence_gate);
  const gateLetter = lead.confidence_gate ? ` · ${escapeHtml(lead.confidence_gate)}` : "";
  const lines = [
    `🏢 <b>${escapeHtml(lead.orgName)}</b>`,
    `${gate.icon} ${gate.readiness} · ${formatScore(lead.score)}${gateLetter}`,
  ];
  if (lead.lastSignalAt) {
    lines.push(`🕔 Сигнал: ${escapeHtml(formatDate(lead.lastSignalAt))}`);
  }
  return lines.join("\n");
}

function isTelegramApiSuccess(value: unknown): value is TelegramApiSuccess {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<TelegramApiSuccess>;

  return result.ok === true && "result" in result;
}

function getTelegramErrorDescription(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as TelegramApiFailure;

  return typeof result.description === "string" ? result.description : null;
}

export function getTelegramConfig(): {
  botToken: string | null;
  error: string | null;
} {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    return {
      botToken: null,
      error: "Telegram is not configured. Missing TELEGRAM_BOT_TOKEN."
    };
  }

  return {
    botToken,
    error: null
  };
}

export function getTelegramBotToken(): {
  botToken: string | null;
  error: string | null;
} {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    return {
      botToken: null,
      error: "Telegram is not configured. Missing TELEGRAM_BOT_TOKEN."
    };
  }

  return {
    botToken,
    error: null
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

  const username = process.env.TELEGRAM_BOT_USERNAME?.trim() || null;

  if (!username) {
    return {
      username: null,
      error: "TELEGRAM_BOT_USERNAME is not configured. Set it to your bot's @username (without @) to enable Telegram connect deep links."
    };
  }

  return {
    username,
    error: null
  };
}

const TELEGRAM_RETRY_DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff with full jitter: rand(0, min(maxDelay, base * 2^attempt))
  const cap = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  return Math.random() * cap;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function callTelegramApiWithRetry<T>(
  method: string,
  config: Pick<TelegramMessageConfig, "botToken">,
  body: Record<string, unknown>,
  retryOptions?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...TELEGRAM_RETRY_DEFAULTS,
    ...retryOptions,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = computeBackoffDelay(attempt - 1, baseDelayMs, maxDelayMs);
      await sleep(delayMs);
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify(body)
      });

      let payload: unknown = null;

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (isTelegramApiSuccess(payload)) {
        return payload.result as T;
      }

      const description =
        getTelegramErrorDescription(payload) ??
        `Telegram request failed with status ${response.status}.`;

      // Non-retryable client errors (4xx except 429) fail immediately
      if (response.ok || (!isRetryableStatus(response.status))) {
        throw new Error(description);
      }

      lastError = new Error(description);
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error("Unknown Telegram API error");
      }
    }
  }

  throw lastError ?? new Error("Telegram API request failed after retries");
}

async function callTelegramApi<T>(
  method: string,
  config: Pick<TelegramMessageConfig, "botToken">,
  body: Record<string, unknown>
): Promise<T> {
  return callTelegramApiWithRetry<T>(method, config, body);
}

const TELEGRAM_MESSAGE_CHAR_LIMIT = 4096;

export async function sendTelegramTextMessage(
  text: string,
  config: TelegramMessageConfig,
  options?: {
    replyMarkup?: unknown;
  }
): Promise<TelegramTextMessageResult> {
  const safeText = text.length > TELEGRAM_MESSAGE_CHAR_LIMIT
    ? text.slice(0, TELEGRAM_MESSAGE_CHAR_LIMIT - 1) + "…"
    : text;
  const result = await callTelegramApi<{ message_id: number }>("sendMessage", config, {
    chat_id: config.chatId,
    text: safeText,
    ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {})
  });

  return {
    chatId: config.chatId,
    messageId: result.message_id
  };
}

export async function answerTelegramCallbackQuery(input: {
  callbackQueryId: string;
  botToken: string;
  text?: string;
}): Promise<void> {
  await callTelegramApi("answerCallbackQuery", { botToken: input.botToken }, {
    callback_query_id: input.callbackQueryId,
    ...(input.text ? { text: input.text } : {})
  });
}

export async function sendTelegramLeadMessage(
  lead: TelegramLeadMessage,
  config: TelegramConfig,
  options?: { replyMarkup?: unknown }
): Promise<TelegramSendResult> {
  const result = await callTelegramApi<{ message_id: number }>("sendMessage", config, {
    chat_id: config.chatId,
    text: formatTelegramLeadMessage(lead),
    parse_mode: "HTML",
    ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {})
  });

  return {
    messageId: result.message_id
  };
}
