/**
 * Escape the three characters Telegram's HTML parse mode treats as markup.
 * Applied to every user/company-derived string before it enters a message,
 * so a company name like "Romashka & Co <Group>" can never break the markup.
 *
 * Note: Telegram HTML mode only requires `& < >` to be escaped (unlike full
 * HTML, which also needs quotes). Do not widen this without a reason — the
 * email path has its own broader escaper for real HTML documents.
 */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
