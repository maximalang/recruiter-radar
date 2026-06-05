import { fetchJson } from './source-http.mjs';
import { RateLimiter } from './rate-limiter.mjs';

const HH_VACANCIES_URL = 'https://api.hh.ru/vacancies';
const HH_RATE_LIMIT = 30; // HH API: 30 requests/minute
const hhRateLimiter = new RateLimiter(HH_RATE_LIMIT);
const DEFAULT_SEARCH_TEXT = '\u0440\u0435\u043a\u0440\u0443\u0442\u0435\u0440';
const DEFAULT_PER_PAGE = 20;
const DEFAULT_PAGES = 1;
const MAX_PER_PAGE = 100;
const MAX_PAGES = 20;

const ENV_PARAM_MAP = [
  ['HH_AREA', 'area'],
  ['HH_EMPLOYMENT', 'employment'],
  ['HH_SCHEDULE', 'schedule'],
  ['HH_EXPERIENCE', 'experience'],
  ['HH_PROFESSIONAL_ROLE', 'professional_role'],
  ['HH_INDUSTRY', 'industry'],
  ['HH_DATE_FROM', 'date_from'],
  ['HH_DATE_TO', 'date_to'],
  ['HH_ORDER_BY', 'order_by'],
  ['HH_SEARCH_FIELD', 'search_field'],
];

export function resolveHhVacancySearchConfig(env = process.env) {
  const searchText = toNonEmptyText(env.HH_SEARCH_TEXT) ?? DEFAULT_SEARCH_TEXT;
  const perPage = clampInteger(env.HH_PER_PAGE, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const pages = clampInteger(env.HH_PAGES, DEFAULT_PAGES, 1, MAX_PAGES);
  const extraParams = {};

  for (const [envName, paramName] of ENV_PARAM_MAP) {
    const values = parseMultiValue(env[envName]);

    if (values.length > 0) {
      extraParams[paramName] = values;
    }
  }

  const jsonParams = parseJsonParams(env.HH_SEARCH_PARAMS_JSON);

  for (const [key, value] of Object.entries(jsonParams)) {
    const values = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : parseMultiValue(value);

    if (values.length > 0) {
      extraParams[key] = values;
    }
  }

  return {
    searchText,
    perPage,
    pages,
    extraParams,
  };
}

export function buildHhVacanciesUrl(config, page = 0) {
  const url = new URL(HH_VACANCIES_URL);
  url.searchParams.set('text', config.searchText);
  url.searchParams.set('per_page', String(config.perPage));
  url.searchParams.set('page', String(page));

  for (const [key, values] of Object.entries(config.extraParams ?? {})) {
    for (const value of values) {
      url.searchParams.append(key, value);
    }
  }

  return url;
}

export async function fetchHhVacancyPages({ userAgent, config = resolveHhVacancySearchConfig() }) {
  const normalizedUserAgent = toNonEmptyText(userAgent);

  if (!normalizedUserAgent) {
    throw new Error('HH user agent is required.');
  }

  const items = [];
  const pageSummaries = [];
  let found = 0;
  let pagesAvailable = null;

  for (let page = 0; page < config.pages; page += 1) {
    // Rate limiting: wait if we've exceeded 30 req/min
    const url = buildHhVacanciesUrl(config, page);
    const host = new URL(url).hostname;
    while (!(await hhRateLimiter.allow(host))) {
      const waitMs = await hhRateLimiter.msUntilNextAllowed(host);
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
    const payload = await fetchJson(url, {
      sourceName: 'hh',
      headers: {
        accept: 'application/json',
        'hh-user-agent': normalizedUserAgent,
        'user-agent': normalizedUserAgent,
      },
    });
    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    const payloadFound = Number(payload.found);
    const payloadPages = Number(payload.pages);

    if (Number.isFinite(payloadFound)) {
      found = payloadFound;
    }

    if (Number.isFinite(payloadPages)) {
      pagesAvailable = payloadPages;
    }

    pageSummaries.push({
      page,
      items: pageItems.length,
    });
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }

    if (pagesAvailable !== null && page + 1 >= pagesAvailable) {
      break;
    }
  }

  return {
    found,
    pagesAvailable,
    pagesFetched: pageSummaries.length,
    pageSummaries,
    items,
    config: summarizeHhSearchConfig(config),
  };
}

export function summarizeHhSearchConfig(config) {
  return {
    searchText: config.searchText,
    perPage: config.perPage,
    pages: config.pages,
    extraParams: config.extraParams ?? {},
  };
}

function parseJsonParams(value) {
  const normalizedValue = toNonEmptyText(value);

  if (!normalizedValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalizedValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('HH_SEARCH_PARAMS_JSON must be a JSON object.');
  }
}

function parseMultiValue(value) {
  const normalizedValue = toNonEmptyText(value);

  if (!normalizedValue) {
    return [];
  }

  return normalizedValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampInteger(value, defaultValue, minValue, maxValue) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.min(maxValue, Math.max(minValue, parsed));
}

function toNonEmptyText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}
