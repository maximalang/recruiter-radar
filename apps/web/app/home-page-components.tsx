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
  'company-site': 'сайт компании',
  'company-newsrooms': 'корпоративные новости',
  'egrul-fns': 'ЕГРЮЛ',
  'habr-career': 'Хабр Карьера',
  hh: 'hh.ru',
  'rabota-rossii': 'Работа России',
  superjob: 'SuperJob',
  'transparent-business-fns': 'ФНС',
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
/**
 * Russian legal-form prefixes that precede the trading name in registry data
 * (АО, ООО, ПАО, ГУП, МУП, ГБУ/ГБУЗ/ГКУ, ФГБОУ ВО / ФГБОУ / ФГБНУ, ГАУ, ИП …).
 * They read as boilerplate noise on a public lead card — the hero example
 * shows "Производственная компания", not "ООО «Производственная компания»", so
 * a real lead should match that register. Stripping the prefix is display-only:
 * the full legal name still lives on the org record and in the digest; this is
 * the public-facing card label. The list is anchored on the org-form tokens that
 * actually appear in prod lead names (sampled from the live preview).
 */
const LEGAL_FORM_PREFIX = /^(?:ФГБОУ ВО|ФГБОУ|ФГБНУ|ФГАНУ|ФГБУ|ФГУП|ФГУ|ГБПОУ ВО|ГБПОУ|ГБУЗ|ГБУ|ГБОУ|ГКУК|ГКУ|ГАУК|ГАУ|ГПО|ГУП|МУП|ФКУ|ПАО|НАО|ОАО|ЗАО|ООО|ОДО|АНО|НОП|НКО|ТОО|КФХ|БФ|ИП|АО|НО|НП|УК|РГП|Фонд)\s+/i;

export function cleanEmployerName(raw: string): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return name;

  // 1) Strip the leading legal-form prefix FIRST so the quote logic below works
  //    on the trading name, not "АО «…»". Registry writes the prefix outside the
  //    quotes ("АО "ГОСТИНИЦА "СОВЕТСКАЯ""), so removing it leaves
  //    `"ГОСТИНИЦА "СОВЕТСКАЯ""` — the descriptive lead + a nested brand.
  //    Apply repeatedly in case a name carries two prefixes (rare).
  let dePrefixed = name;
  for (let guard = 0; guard < 3; guard += 1) {
    const next = dePrefixed.replace(LEGAL_FORM_PREFIX, '');
    if (next === dePrefixed) break;
    dePrefixed = next;
  }

  // 2) Convert straight quotes to guillemets (opening after whitespace/«,
  //    closing otherwise).
  let normalized = '';
  for (let index = 0; index < dePrefixed.length; index += 1) {
    const character = dePrefixed[index];
    if (character !== '"') {
      normalized += character;
      continue;
    }
    const previous = index > 0 ? dePrefixed[index - 1] : ' ';
    normalized += /[\s«]/.test(previous) ? '«' : '»';
  }

  // 3) Drop empty quote pairs, then balance any dangling open quotes.
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
  balanced = `${balanced}${'»'.repeat(openQuotes)}`.replace(/\s+/g, ' ').trim() || name;

  // 4) Collapse a double-nested quote: `«ГОСТИНИЦА «СОВЕТСКАЯ»»` (the registry
  //    writes the trading name once as a wrapper, once as the brand inside) →
  //    `ГОСТИНИЦА «СОВЕТСКАЯ»`. Keep the descriptive lead + the innermost quoted
  //    brand at a single clean level. If there's only one quote level, unchanged.
  const doubleNested = balanced.match(/^«([^«»]*)«([^«»]+)»»$/);
  if (doubleNested) {
    const lead = doubleNested[1].trim();
    const brand = doubleNested[2].trim();
    balanced = lead ? `${lead} «${brand}»` : `«${brand}»`;
    balanced = balanced.replace(/\s+/g, ' ').trim();
  }

  return balanced || name;
}

export function buildFaqItems(paymentConfigured: boolean) {
  return [
    {
      question: "Нужен ли аккаунт, чтобы посмотреть пример?",
      answer: "Нет. Пример открывается сразу, без регистрации и оплаты. Демонстрационные карточки обезличены и сохраняют структуру, шкалу оценки и логику проверки продукта."
    },
    {
      question: "Откуда берутся компании в радаре?",
      answer: "В клиентскую выдачу допускаются сигналы с hh.ru, Работы России и прямых карьерных страниц. Сайт компании и ЕГРЮЛ/ФНС подтверждают юрлицо, домен и безопасный корпоративный путь контакта, а корпоративные события и отраслевые публикации добавляют контекст. Эти вспомогательные источники сами по себе лид не создают."
    },
    {
      question: "Почему оценке можно доверять?",
      answer: "Оценка складывается из соответствия вашему профилю, силы и свежести сигнала, доступности контакта. Рядом остаются исходные факты, даты и источники — вывод можно проверить до первого обращения."
    },
    {
      question: "Радар ищет личные контакты или рассылает сообщения?",
      answer: "Нет. Мы используем корпоративные формы, публичные общие адреса и официальные каналы. Recruiter Radar не отправляет сообщения автоматически: решение и финальный текст всегда остаются за вами."
    },
    {
      question: "Куда приходит радар?",
      answer: "Telegram — основной канал пилота. Email подключается по запросу; остальные способы доставки не входят в публичное обещание тарифа."
    },
    {
      question: paymentConfigured ? "Что будет после оплаты?" : "Что будет после заявки?",
      answer: paymentConfigured
        ? "Настроим профиль под вашу нишу, подключим Telegram — и следующим утром придёт первый радар."
        : "Заявка и настройки профиля сохранятся. После подключения оплаты к запуску можно будет вернуться без повторного ввода данных."
    }
  ] as const;
}
