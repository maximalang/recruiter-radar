/**
 * SuperJob API adapter.
 *
 * Uses the official SuperJob 2.0 vacancy-search API. The default production
 * mode is broad incremental discovery: no keyword, direct employers only,
 * last 12 hours, count=100. SuperJob caps list queries at 500 entities, so
 * windows that exceed 500 are recursively split by publication time instead of
 * being silently truncated.
 */

import { fetchJson } from './source-http.mjs';
import {
  toNonEmptyText,
  clampInteger,
} from './rf-source-runtime.mjs';

const SUPERJOB_VACANCIES_URL = 'https://api.superjob.ru/2.0/vacancies/';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_PAGES = 5;
const MAX_PER_PAGE = 100;
const MAX_PAGES = 5;
const SUPERJOB_RESULT_WINDOW_LIMIT = 500;
const DEFAULT_LOOKBACK_HOURS = 12;
const MAX_LOOKBACK_HOURS = 168;
const DEFAULT_MIN_PARTITION_MINUTES = 10;
const DEFAULT_MAX_PARTITION_DEPTH = 12;
const DIRECT_EMPLOYER_AGENCY_ID = '1';

const ENV_PARAM_MAP = [
  ['SUPERJOB_TOWN', 'town'],
  ['SUPERJOB_CATALOGUES', 'catalogues'],
  ['SUPERJOB_TYPE_OF_WORK', 'type_of_work'],
  ['SUPERJOB_EXPERIENCE', 'experience'],
  ['SUPERJOB_PAYMENT_FROM', 'payment_from'],
  ['SUPERJOB_PAYMENT_TO', 'payment_to'],
  ['SUPERJOB_PERIOD', 'period'],
  ['SUPERJOB_DATE_PUBLISHED_FROM', 'date_published_from'],
  ['SUPERJOB_DATE_PUBLISHED_TO', 'date_published_to'],
  ['SUPERJOB_ORDER_FIELD', 'order_field'],
  ['SUPERJOB_ORDER_DIRECTION', 'order_direction'],
  ['SUPERJOB_AGENCY', 'agency'],
];

export class SuperjobCoverageTruncationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SuperjobCoverageTruncationError';
    this.code = 'superjob_coverage_truncation';
    this.details = details;
  }
}

export function resolveSuperjobSearchConfig(env = process.env, now = new Date()) {
  const keyword = toNonEmptyText(env.SUPERJOB_KEYWORD);
  const perPage = clampInteger(env.SUPERJOB_PER_PAGE, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const pages = clampInteger(env.SUPERJOB_PAGES, DEFAULT_PAGES, 1, MAX_PAGES);
  const extraParams = {};

  for (const [envName, paramName] of ENV_PARAM_MAP) {
    const value = toNonEmptyText(env[envName]);
    if (value) extraParams[paramName] = value;
  }

  const explicitTemporalFilter = Boolean(
    extraParams.period
    || extraParams.date_published_from
    || extraParams.date_published_to,
  );
  const broadIncremental = !keyword && !explicitTemporalFilter;
  const lookbackHours = clampInteger(
    env.SUPERJOB_LOOKBACK_HOURS,
    DEFAULT_LOOKBACK_HOURS,
    1,
    MAX_LOOKBACK_HOURS,
  );

  // In discovery mode we only need attributable end-employer demand. Filtering
  // at the official API boundary avoids spending the 500-result search window on
  // recruiting agencies, outsourcing firms and aggregators that are rejected by
  // downstream candidate_eligible semantics anyway. An explicit SUPERJOB_AGENCY
  // always wins; explicit keyword mode remains unfiltered by default so the live
  // verifier can still exercise publisher classification across agency types.
  if (!keyword && extraParams.agency === undefined) {
    extraParams.agency = DIRECT_EMPLOYER_AGENCY_ID;
  }

  if (broadIncremental) {
    const nowDate = normalizeDate(now) ?? new Date();
    extraParams.date_published_from = String(Math.floor((nowDate.getTime() - lookbackHours * 3_600_000) / 1000));
    extraParams.date_published_to = String(Math.floor(nowDate.getTime() / 1000));
    extraParams.order_field ??= 'date';
    extraParams.order_direction ??= 'desc';
  }

  return {
    keyword,
    perPage,
    pages,
    extraParams,
    adaptiveTimePartition: broadIncremental || parseBoolean(env.SUPERJOB_ADAPTIVE_TIME_PARTITION, false),
    lookbackHours: broadIncremental ? lookbackHours : null,
    minPartitionMinutes: clampInteger(
      env.SUPERJOB_MIN_PARTITION_MINUTES,
      DEFAULT_MIN_PARTITION_MINUTES,
      1,
      120,
    ),
    maxPartitionDepth: clampInteger(
      env.SUPERJOB_MAX_PARTITION_DEPTH,
      DEFAULT_MAX_PARTITION_DEPTH,
      1,
      20,
    ),
  };
}

export function buildSuperjobVacanciesUrl(config, page = 0) {
  const url = new URL(SUPERJOB_VACANCIES_URL);
  if (toNonEmptyText(config.keyword)) url.searchParams.set('keyword', config.keyword.trim());
  url.searchParams.set('count', String(config.perPage));
  url.searchParams.set('page', String(page));

  for (const [key, value] of Object.entries(config.extraParams ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

export async function fetchSuperjobVacancyPages({
  appId,
  config = resolveSuperjobSearchConfig(),
  fetchJsonImpl = fetchJson,
}) {
  const normalizedAppId = toNonEmptyText(appId);
  if (!normalizedAppId) throw new Error('SuperJob X-Api-App-Id is required.');

  const requestPage = async (pageConfig, page) => {
    const url = buildSuperjobVacanciesUrl(pageConfig, page);
    return fetchJsonImpl(url.toString(), {
      sourceName: 'superjob',
      headers: {
        'X-Api-App-Id': normalizedAppId,
        'user-agent': 'RecruiterRadar/1.0 (superjob source; contact: ops@example.com)',
      },
    });
  };

  if (config.adaptiveTimePartition) {
    const bounds = resolveTimeBounds(config);
    if (!bounds) {
      throw new SuperjobCoverageTruncationError(
        'SuperJob adaptive partitioning requires date_published_from and date_published_to.',
        { config: summarizeSuperjobSearchConfig(config) },
      );
    }
    const result = await fetchAdaptiveWindow({ config, bounds, depth: 0, requestPage });
    return {
      ...result,
      config: summarizeSuperjobSearchConfig(config),
      adaptiveTimePartition: true,
    };
  }

  const result = await fetchCompleteWindow({ config, requestPage });
  return {
    ...result,
    config: summarizeSuperjobSearchConfig(config),
    adaptiveTimePartition: false,
  };
}

async function fetchAdaptiveWindow({ config, bounds, depth, requestPage }) {
  const windowConfig = withTimeBounds(config, bounds);
  const firstPayload = await requestPage(windowConfig, 0);
  const total = finiteNonNegative(firstPayload?.total);

  if (total > SUPERJOB_RESULT_WINDOW_LIMIT) {
    const widthMinutes = (bounds.to - bounds.from) / 60;
    if (depth >= config.maxPartitionDepth || widthMinutes <= config.minPartitionMinutes) {
      throw new SuperjobCoverageTruncationError(
        `SuperJob window still contains ${total} vacancies at the minimum safe partition; refusing silent truncation.`,
        { total, from: bounds.from, to: bounds.to, depth, widthMinutes },
      );
    }

    const midpoint = Math.floor((bounds.from + bounds.to) / 2);
    const left = await fetchAdaptiveWindow({
      config,
      bounds: { from: bounds.from, to: midpoint },
      depth: depth + 1,
      requestPage,
    });
    const right = await fetchAdaptiveWindow({
      config,
      bounds: { from: midpoint, to: bounds.to },
      depth: depth + 1,
      requestPage,
    });
    return mergeWindowResults(left, right, {
      probe: { from: bounds.from, to: bounds.to, total, depth, split: true },
    });
  }

  return fetchCompleteWindow({
    config: windowConfig,
    requestPage,
    firstPayload,
    partition: { from: bounds.from, to: bounds.to, total, depth, split: false },
  });
}

async function fetchCompleteWindow({ config, requestPage, firstPayload = null, partition = null }) {
  const items = [];
  const pageSummaries = [];
  let total = 0;
  let payload = firstPayload;

  for (let page = 0; page < config.pages; page += 1) {
    if (page > 0 || payload === null) payload = await requestPage(config, page);
    const pageItems = Array.isArray(payload?.objects) ? payload.objects : [];
    total = finiteNonNegative(payload?.total) || total;
    pageSummaries.push({
      page,
      items: pageItems.length,
      ...(partition ? { windowFrom: partition.from, windowTo: partition.to } : {}),
    });
    items.push(...pageItems);
    if (pageItems.length === 0 || !payload?.more) break;
  }

  if (config.adaptiveTimePartition && total > SUPERJOB_RESULT_WINDOW_LIMIT) {
    throw new SuperjobCoverageTruncationError(
      `SuperJob query contains ${total} results above the 500-entity API window.`,
      { total, partition },
    );
  }

  return {
    total,
    pagesFetched: pageSummaries.length,
    pageSummaries,
    partitions: partition ? [partition] : [],
    items,
  };
}

function mergeWindowResults(left, right, { probe }) {
  const itemMap = new Map();
  for (const item of [...left.items, ...right.items]) {
    const key = toNonEmptyText(String(item?.id ?? '')) ?? JSON.stringify(item);
    if (!itemMap.has(key)) itemMap.set(key, item);
  }
  return {
    total: left.total + right.total,
    pagesFetched: left.pagesFetched + right.pagesFetched + 1,
    pageSummaries: [...left.pageSummaries, ...right.pageSummaries],
    partitions: [probe, ...left.partitions, ...right.partitions],
    items: [...itemMap.values()],
  };
}

function resolveTimeBounds(config) {
  const from = Number(config.extraParams?.date_published_from);
  const to = Number(config.extraParams?.date_published_to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from: Math.floor(from), to: Math.floor(to) };
}

function withTimeBounds(config, bounds) {
  return {
    ...config,
    extraParams: {
      ...(config.extraParams ?? {}),
      date_published_from: String(bounds.from),
      date_published_to: String(bounds.to),
    },
  };
}

export function summarizeSuperjobSearchConfig(config) {
  return {
    keyword: config.keyword,
    perPage: config.perPage,
    pages: config.pages,
    extraParams: config.extraParams ?? {},
    adaptiveTimePartition: config.adaptiveTimePartition === true,
    lookbackHours: config.lookbackHours ?? null,
    minPartitionMinutes: config.minPartitionMinutes ?? null,
    maxPartitionDepth: config.maxPartitionDepth ?? null,
  };
}

function parseBoolean(value, fallback) {
  const text = toNonEmptyText(value)?.toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(Date.parse(value));
}
