/** Redact Telegram bot tokens before errors reach persisted fields or logs. */
export function sanitizeTelegramError(value: string): string {
  return value.replace(/(?:bot)?\d{8,}:[A-Za-z0-9_-]{35,}/g, "[redacted-token]");
}
