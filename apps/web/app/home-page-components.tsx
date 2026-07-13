/**
 * Format a vacancy freshness signal from an ISO date — "свежие за N дней/неделю".
 * The latest_published_at field is the most recent vacancy publish date; its
 * distance from "now" is the strongest "why now" signal (a company that posted
 * today is a hotter contact than one that posted a month ago). Returns null for
 * unparseable/absent input so the caller hides the row. Caps at "более месяца"
 * so a stale signal reads as stale, not as a precise-but-meaningless number.
 *
 * Pure + deterministic — safe to render server-side with no locale/timezone
 * surprises (uses UTC day difference, not wall-clock).
 */
export function formatVacancyFreshness(latestPublishedAt: string | null | undefined): string | null {
  if (!latestPublishedAt) return null;
  const published = new Date(latestPublishedAt);
  if (Number.isNaN(published.getTime())) return null;
  const days = Math.max(0, Math.floor((Date.now() - published.getTime()) / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "свежие сегодня";
  if (days === 1) return "свежие за 1 день";
  if (days < 5) return `свежие за ${days} дня`;
  if (days < 7) return "свежие за неделю";
  if (days < 30) return `свежие за ${Math.round(days / 7)} нед.`;
  return "более месяца назад";
}

/**
 * Reduce a list of location names to a single short caption for the card header.
 * Takes the first location (the digest already orders by relevance) and trims
 * "Россия"/common noise. Returns null when there are no locations so the row is
 * hidden rather than showing an empty dot.
 */
export function formatLocationCaption(locationNames: readonly string[]): string | null {
  if (locationNames.length === 0) return null;
  const first = locationNames[0].trim();
  if (first === "") return null;
  // Drop bare "Россия" — it adds no signal for a Russia-first product.
  if (first.toLocaleLowerCase("ru-RU") === "россия") {
    if (locationNames.length > 1) {
      const second = locationNames[1].trim();
      return second === "" ? null : second;
    }
    return null;
  }
  return first;
}

/**
 * Take up to N evidence (vacancy) titles, trimmed + de-duplicated, for the
 * card's evidence row. These are real vacancy names — the proof behind "this
 * company is hiring", not a fabricated summary. Returns [] when absent so the
 * row hides cleanly.
 */
export function pickEvidenceTitles(titles: readonly string[], limit = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const t = raw.trim();
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildFaqItems(paymentConfigured: boolean) {
  return [
    {
      question: "Нужен ли аккаунт, чтобы посмотреть пример?",
      answer: "Нет. Пример открывается сразу, без регистрации и оплаты — и показывает те же данные, что приходят в Telegram."
    },
    {
      question: "Откуда берутся компании в радаре?",
      answer: "Из открытых карьерных страниц и вакансий. Мы подтверждаем найм, оцениваем уверенность — «подтверждено», «скорее подтверждено» или «нужна проверка» — и подбираем безопасный путь контакта. Без агрегаторов «возможно, нанимают»."
    },
    {
      question: "Что будет после оплаты?",
      answer: paymentConfigured
        ? "Настроим профиль под вашу нишу, подключим Telegram — и следующим утром придёт первый радар."
        : "Заказ сохранится. К запуску можно вернуться без повторного ввода профиля."
    }
  ] as const;
}
