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

const PREVIEW_SOURCE_LABELS: Readonly<Record<string, string>> = {
  'career-pages': 'карьерная страница',
  'egrul-fns': 'ЕГРЮЛ',
  'habr-career': 'Хабр Карьера',
  hh: 'hh.ru',
  'rabota-rossii': 'Работа России',
  superjob: 'SuperJob',
};

const CARD_TRANSLITERATION: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const NEAR_DUPLICATE_SIMILARITY = 0.78;

function comparableCardText(value: string): string {
  return Array.from(value.toLocaleLowerCase('ru-RU'))
    .map((character) => CARD_TRANSLITERATION[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]+/g, '');
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function isNearDuplicate(left: string, right: string): boolean {
  if (left === right) return true;
  const maxLength = Math.max(left.length, right.length);
  if (Math.min(left.length, right.length) < 8 || maxLength === 0) return false;
  return 1 - editDistance(left, right) / maxLength >= NEAR_DUPLICATE_SIMILARITY;
}

function containsNearDuplicate(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  const minWindow = Math.max(8, needle.length - 2);
  const maxWindow = Math.min(haystack.length, needle.length + 2);

  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize += 1) {
    for (let start = 0; start + windowSize <= haystack.length; start += 1) {
      if (isNearDuplicate(haystack.slice(start, start + windowSize), needle)) return true;
    }
  }

  return false;
}

/**
 * Build up to three factual evidence lines without repeating copy already used
 * in the prominent "Почему сейчас" block. Source provenance leads the row;
 * vacancy count and titles are included only when they add new information.
 */
export function buildPreviewEvidenceItems(input: {
  whyNow: string;
  vacanciesCaption: string;
  evidenceTitles: readonly string[];
  sourceFamilies: readonly string[];
  limit?: number;
}): string[] {
  const limit = input.limit ?? 3;
  const whyNow = comparableCardText(input.whyNow);
  const sourceLabels = Array.from(new Set(
    input.sourceFamilies
      .map((source) => source.trim())
      .filter(Boolean)
      .map((source) => PREVIEW_SOURCE_LABELS[source] ?? source),
  ));
  const sourceSummary = sourceLabels.length > 0
    ? `${sourceLabels.length > 1 ? 'Источники' : 'Источник'}: ${sourceLabels.slice(0, 2).join(' · ')}`
    : '';
  const candidates = [sourceSummary, input.vacanciesCaption, ...input.evidenceTitles];
  const seen: string[] = [];
  const evidence: string[] = [];

  for (const candidate of candidates) {
    const normalized = comparableCardText(candidate);
    const repeatsEvidence = seen.some((existing) => isNearDuplicate(existing, normalized));
    const repeatsWhyNow = containsNearDuplicate(whyNow, normalized);
    if (!normalized || repeatsEvidence || repeatsWhyNow) continue;
    seen.push(normalized);
    evidence.push(candidate.trim());
    if (evidence.length >= limit) break;
  }

  return evidence;
}

/** Balance malformed registry quotes while preserving the legal display name. */
export function cleanEmployerName(raw: string): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return name;

  let normalized = '';
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index];
    if (character !== '"') {
      normalized += character;
      continue;
    }
    const previous = index > 0 ? name[index - 1] : ' ';
    normalized += /[\s«]/.test(previous) ? '«' : '»';
  }

  let balanced = '';
  let openQuotes = 0;
  for (const character of normalized.replace(/«\s*»/g, '')) {
    if (character === '«') openQuotes += 1;
    if (character === '»') {
      if (openQuotes === 0) continue;
      openQuotes -= 1;
    }
    balanced += character;
  }

  return `${balanced}${'»'.repeat(openQuotes)}`.replace(/\s+/g, ' ').trim() || name;
}

export function buildFaqItems(paymentConfigured: boolean) {
  return [
    {
      question: "Нужен ли аккаунт, чтобы посмотреть пример?",
      answer: "Нет. Пример открывается сразу, без регистрации и оплаты. Если актуальная выдача временно недоступна, мы явно показываем демо той же структуры."
    },
    {
      question: "Откуда берутся компании в радаре?",
      answer: "Из открытых вакансий, карьерных страниц и корпоративных источников. Мы подтверждаем найм, оцениваем уверенность — «подтверждено», «скорее подтверждено» или «нужна проверка» — и подбираем безопасный путь контакта. Платформенная вакансия сама по себе не считается сильным доказательством."
    },
    {
      question: "Что будет после оплаты?",
      answer: paymentConfigured
        ? "Настроим профиль под вашу нишу, подключим Telegram — и следующим утром придёт первый радар."
        : "Заказ сохранится. К запуску можно вернуться без повторного ввода профиля."
    }
  ] as const;
}
