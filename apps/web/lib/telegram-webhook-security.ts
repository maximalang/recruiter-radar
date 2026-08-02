// Redacts Telegram bot tokens in both forms: URL-embedded ("bot<id>:<auth>")
// and bare ("<id>:<auth>"). Length floors avoid redacting benign key/value text.
export function sanitizeTelegramWebhookError(value: string): string {
  return value.replace(
    /(?:bot)?\d{8,}:[A-Za-z0-9_-]{35,}/g,
    "[redacted-token]",
  );
}
