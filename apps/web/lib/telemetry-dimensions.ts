// Preregistered observation dimensions for landing demand measurement.
//
// The class taxonomy is fixed BEFORE any future observation window opens
// (protocol §4): values are appended only in a new preregistration, never
// reinterpreted per outcome. Every value must keep passing the telemetry
// metadata privacy guard (SENSITIVE_KEY + product_telemetry_metadata_privacy
// CHECK) — keep values short, lowercase, free of embedded contact data.

export const REFERER_CLASS = {
  relevant: "relevant",
  notRelevant: "not_relevant",
  unknown: "unknown",
} as const;

export type RefererClass =
  (typeof REFERER_CLASS)[keyof typeof REFERER_CLASS];

// Recruiting-relevant Russian/international referral sources. The names are
// coarse COMMUNITIES, never raw URLs: the raw referer string never leaves
// this module.
const RELEVANT_REFERER_HOSTS = new Set([
  "hh.ru",
  "career.habr.com",
  "habr.com",
  "superjob.ru",
  "zarplata.ru",
  "vk.com",
  "t.me",
  "telegram.me",
  "youtube.com",
  "www.youtube.com",
  "habr.career",
  "getmatch.ru",
  "huntly.ru",
  "geekjob.ru",
]);

const NON_RELEVANT_REFERER_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "yandex.ru",
  "ya.ru",
  "duckduckgo.com",
  "bing.com",
  "mail.ru",
  "go.mail.ru",
  "rambler.ru",
  "facebook.com",
  "instagram.com",
  "recruiter-radar.ru",
  "www.recruiter-radar.ru",
]);

export const REFERER_CLASSES = Object.freeze(
  Object.values(REFERER_CLASS),
) as RefererClass[];

export function isRefererClass(value: unknown): value is RefererClass {
  return (
    value === REFERER_CLASS.relevant ||
    value === REFERER_CLASS.notRelevant ||
    value === REFERER_CLASS.unknown
  );
}

function refererHostName(referer: string): string | null {
  try {
    return new URL(referer).hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
  } catch {
    return null;
  }
}

/**
 * Classify a request-time Referer into the fixed preregistered taxonomy.
 * Returns unknown for absent, malformed, or non-matching referers.
 */
export function classifyReferer(
  referer: string | null | undefined,
): RefererClass {
  if (!referer) return REFERER_CLASS.unknown;
  const host = refererHostName(referer);
  if (!host) return REFERER_CLASS.unknown;
  if (RELEVANT_REFERER_HOSTS.has(host)) return REFERER_CLASS.relevant;
  if (NON_RELEVANT_REFERER_HOSTS.has(host)) return REFERER_CLASS.notRelevant;
  return REFERER_CLASS.unknown;
}

export const UTM_SOURCE_CLASS = {
  relevant: "relevant",
  notRelevant: "not_relevant",
  unknown: "unknown",
} as const;

export type UtmSourceClass =
  (typeof UTM_SOURCE_CLASS)[keyof typeof UTM_SOURCE_CLASS];

export const UTM_SOURCE_CLASSES = Object.freeze(
  Object.values(UTM_SOURCE_CLASS),
) as UtmSourceClass[];

export function isUtmSourceClass(value: unknown): value is UtmSourceClass {
  return (
    value === UTM_SOURCE_CLASS.relevant ||
    value === UTM_SOURCE_CLASS.notRelevant ||
    value === UTM_SOURCE_CLASS.unknown
  );
}

// Substrings matched against the lowercase utm_source/utm_campaign value.
// Deliberately coarse: communities and topics relevant to agency recruiters.
const RELEVANT_UTM_MARKERS = [
  "hh",
  "habr",
  "telegram",
  "telega",
  "tg",
  "vk",
  "vpiski",
  "recruiter",
  "recruiting",
  "podbor",
  "hr-",
  "hr_",
  "agency",
];

const NON_RELEVANT_UTM_MARKERS = [
  "google",
  "yandex",
  "ya-",
  "ya_",
  "seo",
  "ads",
  "cpc",
  "context",
  "direct",
  "email",
  "newsletter",
  "unsubscribe",
];

function utmMarkerMatches(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

/**
 * Classify a request-time utm_source (campaign as fallback) into the fixed
 * preregistered taxonomy.
 */
export function classifyUtmSource(
  utmSource: string | null | undefined,
  utmCampaign?: string | null | undefined,
): UtmSourceClass {
  const source = utmSource?.trim().toLowerCase() ?? "";
  const campaign = utmCampaign?.trim().toLowerCase() ?? "";
  if (!source && !campaign) return UTM_SOURCE_CLASS.unknown;
  const combined = `${source} ${campaign}`.trim();
  if (utmMarkerMatches(combined, RELEVANT_UTM_MARKERS)) {
    return UTM_SOURCE_CLASS.relevant;
  }
  if (utmMarkerMatches(combined, NON_RELEVANT_UTM_MARKERS)) {
    return UTM_SOURCE_CLASS.notRelevant;
  }
  return UTM_SOURCE_CLASS.unknown;
}

export const UA_CLASS = {
  browser: "browser",
  bot: "bot",
  monitoring: "monitoring",
  internal: "internal",
} as const;

export type UaClass = (typeof UA_CLASS)[keyof typeof UA_CLASS];

export const UA_CLASSES = Object.freeze(
  Object.values(UA_CLASS),
) as UaClass[];

export function isUaClass(value: unknown): value is UaClass {
  return (
    value === UA_CLASS.browser ||
    value === UA_CLASS.bot ||
    value === UA_CLASS.monitoring ||
    value === UA_CLASS.internal
  );
}

// Coarse, permanently persistable classification markers: no versioned
// product strings that would make historical rows re-classifiable (§4).
const BOT_UA_MARKERS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "curl/",
  "wget",
  "python-requests",
  "python-urllib",
  "java/",
  "okhttp",
  "go-http-client",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "lighthouse",
];

const MONITORING_UA_MARKERS = [
  "uptime",
  "pingdom",
  "uptimerobot",
  "betteruptime",
  "statuspage",
  "monitor",
  "healthcheck",
  "site24x7",
  "newrelic",
];

/**
 * Classify a request-time User-Agent. Empty/missing UA is treated as a bot:
 * real landing browsers always send a UA.
 */
export function classifyUserAgent(
  userAgent: string | null | undefined,
): UaClass {
  const ua = userAgent?.trim().toLowerCase() ?? "";
  if (!ua) return UA_CLASS.bot;
  if (MONITORING_UA_MARKERS.some((marker) => ua.includes(marker))) {
    return UA_CLASS.monitoring;
  }
  if (BOT_UA_MARKERS.some((marker) => ua.includes(marker))) {
    return UA_CLASS.bot;
  }
  return UA_CLASS.browser;
}

// Client-declared non-public viewing contexts. Values are fixed and coarse.
export const INTERNAL_MARKER = {
  none: "none",
  preview: "preview",
  staff: "staff",
  healthcheck: "healthcheck",
} as const;

export type InternalMarker =
  (typeof INTERNAL_MARKER)[keyof typeof INTERNAL_MARKER];

export const INTERNAL_MARKERS = Object.freeze(
  Object.values(INTERNAL_MARKER),
) as InternalMarker[];

export function isInternalMarker(value: unknown): value is InternalMarker {
  return (
    value === INTERNAL_MARKER.none ||
    value === INTERNAL_MARKER.preview ||
    value === INTERNAL_MARKER.staff ||
    value === INTERNAL_MARKER.healthcheck
  );
}

/** Aggregate-level exclusion rule: internal markers leave demand counts. */
export function isExcludedInternalMarker(marker: InternalMarker): boolean {
  return marker !== INTERNAL_MARKER.none;
}

/** Aggregate-level exclusion rule: non-browser agents leave demand counts. */
export function isExcludedUaClass(uaClass: UaClass): boolean {
  return uaClass !== UA_CLASS.browser;
}

export const VISIT_ID_PATTERN = /^[0-9a-f]{32}$/;

export function isVisitId(value: unknown): value is string {
  return typeof value === "string" && VISIT_ID_PATTERN.test(value);
}
