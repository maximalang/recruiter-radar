/**
 * SuperJob API adapter.
 *
 * Uses the SuperJob 2.0 REST API to search vacancies.
 * Auth: X-Api-App-Id header (secret key from app registration).
 * No user-level OAuth needed for vacancy search (only for contact details).
 *
 * API docs: https://api.superjob.ru/
 * Rate limit: 120 req/min per IP.
 * Pagination: max 500 results total (100 per page × 5 pages).
 */

import { fetchJson } from './source-http.mjs';
import {
  toNonEmptyText,
  clampInteger,
  parseCommaSeparated,
} from './rf-source-runtime.mjs';

const SUPERJOB_VACANCIES_URL = 'https://api.superjob.ru/2.0/vacancies/';
const DEFAULT_KEYWORD = 'рекрутер';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_PAGES = 5; // max 500 results (100 × 5)
const MAX_PER_PAGE = 100;
const MAX_PAGES = 5;

const ENV_PARAM_MAP = [
  ['SUPERJOB_TOWN', 'town'],
  ['SUPERJOB_CATALOGUES', 'catalogues'],
  ['SUPERJOB_TYPE_OF_WORK', 'type_of_work'],
  ['SUPERJOB_EXPERIENCE', 'experience'],
  ['SUPERJOB_PAYMENT_FROM', 'payment_from'],
  ['SUPERJOB_PAYMENT_TO', 'payment_to'],
  ['SUPERJOB_PERIOD', 'period'],
  ['SUPERJOB_ORDER_FIELD', 'order_field'],
  ['SUPERJOB_ORDER_DIRECTION', 'order_direction'],
];

/**
 * Resolve search config from env vars.
 */
export function resolveSuperjobSearchConfig(env = process.env) {
  const keyword = toNonEmptyText(env.SUPERJOB_KEYWORD) ?? DEFAULT_KEYWORD;
  const perPage = clampInteger(env.SUPERJOB_PER_PAGE, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const pages = clampInteger(env.SUPERJOB_PAGES, DEFAULT_PAGES, 1, MAX_PAGES);
  const extraParams = {};

  for (const [envName, paramName] of ENV_PARAM_MAP) {
    const value = toNonEmptyText(env[envName]);
    if (value) {
      extraParams[paramName] = value;
    }
  }

  return {
    keyword,
    perPage,
    pages,
    extraParams,
  };
}

/**
 * Build the SuperJob vacancies URL for a given page.
 */
export function buildSuperjobVacanciesUrl(config, page = 0) {
  const url = new URL(SUPERJOB_VACANCIES_URL);
  url.searchParams.set('keyword', config.keyword);
  url.searchParams.set('count', String(config.perPage));
  url.searchParams.set('page', String(page));

  for (const [key, value] of Object.entries(config.extraParams ?? {})) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

/**
 * Fetch vacancy pages from the SuperJob API.
 */
export async function fetchSuperjobVacancyPages({ appId, config = resolveSuperjobSearchConfig() }) {
  const normalizedAppId = toNonEmptyText(appId);

  if (!normalizedAppId) {
    throw new Error('SuperJob X-Api-App-Id is required.');
  }

  const items = [];
  const pageSummaries = [];
  let total = 0;

  for (let page = 0; page < config.pages; page += 1) {
    const url = buildSuperjobVacanciesUrl(config, page);
    const payload = await fetchJson(url.toString(), {
      sourceName: 'superjob',
      headers: {
        'X-Api-App-Id': normalizedAppId,
        'user-agent': 'RecruiterRadar/1.0 (superjob source; contact: ops@example.com)',
      },
    });

    const pageItems = Array.isArray(payload.objects) ? payload.objects : [];
    total = Number(payload.total) || total;

    pageSummaries.push({
      page,
      items: pageItems.length,
    });
    items.push(...pageItems);

    // No more results — stop early
    if (pageItems.length === 0 || !payload.more) {
      break;
    }
  }

  return {
    total,
    pagesFetched: pageSummaries.length,
    pageSummaries,
    items,
    config: summarizeSuperjobSearchConfig(config),
  };
}

function summarizeSuperjobSearchConfig(config) {
  return {
    keyword: config.keyword,
    perPage: config.perPage,
    pages: config.pages,
    extraParams: config.extraParams ?? {},
  };
}
