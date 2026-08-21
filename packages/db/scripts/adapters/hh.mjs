import { SocksClient } from 'socks';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

import { fetchJson, SourceHttpError } from './source-http.mjs';
import {
  HhOAuthError,
  resetHhApplicationTokenCache,
  resolveHhApplicationAuthorization,
} from './hh-oauth.mjs';
import { RateLimiter } from './rate-limiter.mjs';

const HH_VACANCIES_URL = 'https://api.hh.ru/vacancies';
const HH_RATE_LIMIT = 30;
const hhRateLimiter = new RateLimiter(HH_RATE_LIMIT);
const DEFAULT_PER_PAGE = 100;
const DEFAULT_PAGES = 20;
const MAX_PER_PAGE = 100;
const MAX_PAGES = 20;
const HH_RESULT_WINDOW_LIMIT = 2000;
const DEFAULT_LOOKBACK_HOURS = 12;
const MAX_LOOKBACK_HOURS = 168;
const DEFAULT_MIN_PARTITION_MINUTES = 10;
const DEFAULT_MAX_PARTITION_DEPTH = 12;
const DEFAULT_VACANCY_LABELS = ['not_from_agency'];

export class HhAccessForbiddenError extends Error {
  constructor(safeUrl, cause) {
    super(
      'HH search API returned HTTP 403 forbidden. Inspect the secret-safe '
        + 'authenticated application diagnostic before assigning a cause.',
      { cause },
    );
    this.name = 'HhAccessForbiddenError';
    this.url = safeUrl;
    this.status = 403;
  }
}

export class HhCoverageTruncationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HhCoverageTruncationError';
    this.code = 'hh_coverage_truncation';
    this.details = details;
  }
}

function isForbiddenError(error) {
  return (
    error instanceof SourceHttpError
    && error.status === 403
    && /forbidden/i.test(error.message)
  );
}

let cachedProxyDispatcher;

function createSocksConnector(proxy, tlsOpts = {}) {
  const { timeout = 10_000 } = tlsOpts;
  const undiciConnect = buildConnector(tlsOpts);

  return async (options, callback) => {
    const { protocol, hostname, port, httpSocket } = options;
    const destinationPort = port
      ? Number.parseInt(port, 10)
      : protocol === 'http:' ? 80 : 443;

    let socket;
    try {
      const result = await SocksClient.createConnection({
        command: 'connect',
        proxy,
        timeout,
        destination: { host: hostname, port: destinationPort },
        existing_socket: httpSocket,
      });
      socket = result.socket;
    } catch (error) {
      return callback(error, null);
    }

    if (protocol !== 'https:') {
      return callback(null, socket.setNoDelay());
    }
    return undiciConnect({ ...options, httpSocket: socket }, callback);
  };
}

const SOCKS_PROTOCOL_TYPES = {
  'socks:': 5,
  'socks5:': 5,
  'socks5h:': 5,
  'socks4:': 4,
  'socks4a:': 4,
};

export function resolveHhProxyDispatcher(env = process.env) {
  if (cachedProxyDispatcher !== undefined) return cachedProxyDispatcher;
  const proxyUrl = toNonEmptyText(env.HH_PROXY_URL);
  if (!proxyUrl) return null;

  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch (_error) {
    throw new Error('HH_PROXY_URL is not a valid URL. Check format: socks5://[user:pass@]host:port.');
  }

  const socksType = SOCKS_PROTOCOL_TYPES[parsed.protocol];
  if (!socksType) {
    throw new Error(
      `HH_PROXY_URL must use a socks scheme (socks://, socks5://, socks5h://, socks4://, socks4a://). Got "${parsed.protocol}".`,
    );
  }

  const port = Number.parseInt(parsed.port, 10);
  if (!parsed.hostname || !Number.isInteger(port) || port <= 0) {
    throw new Error('HH_PROXY_URL must include a host and port, e.g. socks5://host:1080.');
  }

  const proxyConfig = {
    type: socksType,
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
  };
  if (parsed.username) proxyConfig.userId = decodeURIComponent(parsed.username);
  if (parsed.password) proxyConfig.password = decodeURIComponent(parsed.password);

  cachedProxyDispatcher = new Agent({ connect: createSocksConnector(proxyConfig) });
  return cachedProxyDispatcher;
}

export function resolveHhProxyFetch(env = process.env) {
  return resolveHhProxyDispatcher(env) ? undiciFetch : null;
}

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
  ['HH_LABEL', 'label'],
];

/**
 * Default production search is a broad 12-hour incremental window with no text
 * keyword. Explicit HH_SEARCH_TEXT keeps operator/debug behaviour and does not
 * inject a date window unless HH_DATE_FROM/HH_DATE_TO were configured.
 */
export function resolveHhVacancySearchConfig(env = process.env, now = new Date()) {
  const searchText = toNonEmptyText(env.HH_SEARCH_TEXT);
  const perPage = clampInteger(env.HH_PER_PAGE, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const pages = clampInteger(env.HH_PAGES, DEFAULT_PAGES, 1, MAX_PAGES);
  const extraParams = { label: [...DEFAULT_VACANCY_LABELS] };

  for (const [envName, paramName] of ENV_PARAM_MAP) {
    const values = parseMultiValue(env[envName]);
    if (values.length > 0) extraParams[paramName] = values;
  }

  const jsonParams = parseJsonParams(env.HH_SEARCH_PARAMS_JSON);
  for (const [key, value] of Object.entries(jsonParams)) {
    const values = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : parseMultiValue(value);
    if (values.length > 0) extraParams[key] = values;
  }

  const hasExplicitDateFilter = Boolean(extraParams.date_from?.length || extraParams.period?.length);
  const broadIncremental = !searchText && !hasExplicitDateFilter;
  const lookbackHours = clampInteger(
    env.HH_LOOKBACK_HOURS,
    DEFAULT_LOOKBACK_HOURS,
    1,
    MAX_LOOKBACK_HOURS,
  );
  if (broadIncremental) {
    const nowDate = normalizeDate(now) ?? new Date();
    extraParams.date_from = [new Date(nowDate.getTime() - lookbackHours * 3_600_000).toISOString()];
    extraParams.date_to = [nowDate.toISOString()];
    extraParams.order_by ??= ['publication_time'];
  }

  const adaptiveTimePartition = broadIncremental
    || parseBoolean(env.HH_ADAPTIVE_TIME_PARTITION, false);

  return {
    searchText,
    perPage,
    pages,
    extraParams,
    adaptiveTimePartition,
    lookbackHours: broadIncremental ? lookbackHours : null,
    minPartitionMinutes: clampInteger(
      env.HH_MIN_PARTITION_MINUTES,
      DEFAULT_MIN_PARTITION_MINUTES,
      5,
      120,
    ),
    maxPartitionDepth: clampInteger(
      env.HH_MAX_PARTITION_DEPTH,
      DEFAULT_MAX_PARTITION_DEPTH,
      1,
      20,
    ),
  };
}

export function buildHhVacanciesUrl(config, page = 0) {
  const url = new URL(HH_VACANCIES_URL);
  if (toNonEmptyText(config.searchText)) url.searchParams.set('text', config.searchText.trim());
  url.searchParams.set('per_page', String(config.perPage));
  url.searchParams.set('page', String(page));

  for (const [key, values] of Object.entries(config.extraParams ?? {})) {
    for (const value of values) url.searchParams.append(key, value);
  }
  return url;
}

export async function fetchHhVacancyPages({
  userAgent,
  config = resolveHhVacancySearchConfig(),
  env = process.env,
  oauthFetchImpl,
}) {
  const normalizedUserAgent = toNonEmptyText(userAgent);
  if (!normalizedUserAgent) throw new Error('HH user agent is required.');

  const proxyDispatcher = resolveHhProxyDispatcher(env);
  const proxyFetch = resolveHhProxyFetch(env);
  const oauthEnv = { ...env, HH_USER_AGENT: normalizedUserAgent };
  let authorization = await resolveHhApplicationAuthorization(oauthEnv, {
    ...(oauthFetchImpl ? { fetchImpl: oauthFetchImpl } : {}),
  });

  const requestPage = async (pageConfig, page) => {
    const url = buildHhVacanciesUrl(pageConfig, page);
    const host = url.hostname;
    while (!(await hhRateLimiter.allow(host))) {
      const waitMs = await hhRateLimiter.msUntilNextAllowed(host);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const fetchPage = () => fetchJson(url, {
      sourceName: 'hh',
      headers: {
        accept: 'application/json',
        'hh-user-agent': normalizedUserAgent,
        'user-agent': normalizedUserAgent,
        ...(authorization ? { authorization } : {}),
      },
      ...(proxyDispatcher ? { dispatcher: proxyDispatcher, fetchImpl: proxyFetch } : {}),
    });

    try {
      return await fetchPage();
    } catch (error) {
      if (authorization && error instanceof SourceHttpError && error.status === 401) {
        resetHhApplicationTokenCache();
        authorization = await resolveHhApplicationAuthorization(oauthEnv, {
          ...(oauthFetchImpl ? { fetchImpl: oauthFetchImpl } : {}),
        });
        try {
          return await fetchPage();
        } catch (retryError) {
          if (isForbiddenError(retryError)) throw new HhAccessForbiddenError(retryError.url, retryError);
          throw retryError;
        }
      }
      if (isForbiddenError(error)) throw new HhAccessForbiddenError(error.url, error);
      throw error;
    }
  };

  if (config.adaptiveTimePartition) {
    const bounds = resolveTimeBounds(config);
    if (!bounds) {
      throw new HhCoverageTruncationError(
        'HH adaptive partitioning requires both date_from and date_to bounds.',
        { config: summarizeHhSearchConfig(config) },
      );
    }
    const result = await fetchAdaptiveWindow({
      config,
      bounds,
      depth: 0,
      requestPage,
    });
    return {
      ...result,
      config: summarizeHhSearchConfig(config),
      adaptiveTimePartition: true,
    };
  }

  const result = await fetchCompleteWindow({ config, requestPage });
  return {
    ...result,
    config: summarizeHhSearchConfig(config),
    adaptiveTimePartition: false,
  };
}

async function fetchAdaptiveWindow({ config, bounds, depth, requestPage }) {
  const windowConfig = withTimeBounds(config, bounds);
  const firstPayload = await requestPage(windowConfig, 0);
  const found = finiteNonNegative(firstPayload?.found);

  if (found > HH_RESULT_WINDOW_LIMIT) {
    const widthMinutes = (bounds.to.getTime() - bounds.from.getTime()) / 60_000;
    if (depth >= config.maxPartitionDepth || widthMinutes <= config.minPartitionMinutes) {
      throw new HhCoverageTruncationError(
        `HH window still contains ${found} vacancies at the minimum safe partition; refusing silent truncation.`,
        {
          found,
          from: bounds.from.toISOString(),
          to: bounds.to.toISOString(),
          depth,
          widthMinutes,
        },
      );
    }

    const midpoint = new Date(Math.floor((bounds.from.getTime() + bounds.to.getTime()) / 2));
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
      probe: {
        from: bounds.from.toISOString(),
        to: bounds.to.toISOString(),
        found,
        depth,
        split: true,
      },
    });
  }

  return fetchCompleteWindow({
    config: windowConfig,
    requestPage,
    firstPayload,
    partition: {
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
      found,
      depth,
      split: false,
    },
  });
}

async function fetchCompleteWindow({ config, requestPage, firstPayload = null, partition = null }) {
  const items = [];
  const pageSummaries = [];
  let found = 0;
  let pagesAvailable = null;
  let payload = firstPayload;

  for (let page = 0; page < config.pages; page += 1) {
    if (page > 0 || payload === null) payload = await requestPage(config, page);
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    const payloadFound = Number(payload?.found);
    const payloadPages = Number(payload?.pages);
    if (Number.isFinite(payloadFound)) found = payloadFound;
    if (Number.isFinite(payloadPages)) pagesAvailable = payloadPages;

    pageSummaries.push({
      page,
      items: pageItems.length,
      ...(partition ? { windowFrom: partition.from, windowTo: partition.to } : {}),
    });
    items.push(...pageItems);

    if (pageItems.length === 0) break;
    if (pagesAvailable !== null && page + 1 >= pagesAvailable) break;
  }

  const requiredPages = pagesAvailable ?? Math.ceil(found / config.perPage);
  if (found > HH_RESULT_WINDOW_LIMIT || requiredPages > config.pages) {
    throw new HhCoverageTruncationError(
      `HH query requires ${requiredPages} pages for ${found} results but the configured page budget is ${config.pages}.`,
      {
        found,
        requiredPages,
        configuredPages: config.pages,
        partition,
      },
    );
  }

  return {
    found,
    pagesAvailable,
    pagesFetched: pageSummaries.length,
    pageSummaries,
    partitions: partition ? [partition] : [],
    items,
  };
}

function mergeWindowResults(left, right, { probe }) {
  const itemMap = new Map();
  for (const item of [...left.items, ...right.items]) {
    const key = toNonEmptyText(item?.id) ?? JSON.stringify(item);
    if (!itemMap.has(key)) itemMap.set(key, item);
  }
  return {
    found: left.found + right.found,
    pagesAvailable: null,
    pagesFetched: left.pagesFetched + right.pagesFetched + 1,
    pageSummaries: [...left.pageSummaries, ...right.pageSummaries],
    partitions: [probe, ...left.partitions, ...right.partitions],
    items: [...itemMap.values()],
  };
}

function resolveTimeBounds(config) {
  const fromRaw = config.extraParams?.date_from?.[0];
  const toRaw = config.extraParams?.date_to?.[0];
  const from = normalizeDate(fromRaw);
  const to = normalizeDate(toRaw);
  if (!from || !to || to.getTime() <= from.getTime()) return null;
  return { from, to };
}

function withTimeBounds(config, bounds) {
  return {
    ...config,
    extraParams: {
      ...(config.extraParams ?? {}),
      date_from: [bounds.from.toISOString()],
      date_to: [bounds.to.toISOString()],
    },
  };
}

export function describeHhFailure(error) {
  const status = Number.isInteger(error?.status)
    ? error.status
    : Number.isInteger(error?.cause?.status) ? error.cause.status : null;
  const message = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof HhOAuthError
    ? error.type
    : error instanceof HhCoverageTruncationError
      ? 'coverage_truncation'
      : extractHhErrorType(message) ?? (error instanceof HhAccessForbiddenError ? 'forbidden' : 'unknown');

  return {
    status,
    errorType,
    captcha: /captcha/i.test(errorType) || /captcha/i.test(message),
    oauthFailure: error instanceof HhOAuthError || status === 401 || errorType === 'oauth',
    rateLimit: status === 429 || /rate.?limit/i.test(errorType),
    accessForbidden: error instanceof HhAccessForbiddenError,
    coverageTruncation: error instanceof HhCoverageTruncationError,
    networkFailure: status === null && !(error instanceof HhOAuthError) && !(error instanceof HhCoverageTruncationError),
  };
}

function extractHhErrorType(message) {
  const match = String(message).match(/(?:"type"\s*:\s*"|\btype[=: ]+)([a-z0-9_.-]{1,80})/i);
  return match?.[1] ?? null;
}

export function summarizeHhSearchConfig(config) {
  return {
    searchText: config.searchText,
    perPage: config.perPage,
    pages: config.pages,
    extraParams: config.extraParams ?? {},
    adaptiveTimePartition: config.adaptiveTimePartition === true,
    lookbackHours: config.lookbackHours ?? null,
    minPartitionMinutes: config.minPartitionMinutes ?? null,
    maxPartitionDepth: config.maxPartitionDepth ?? null,
  };
}

function parseJsonParams(value) {
  const normalizedValue = toNonEmptyText(value);
  if (!normalizedValue) return {};
  try {
    const parsed = JSON.parse(normalizedValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('HH_SEARCH_PARAMS_JSON must be a JSON object.');
  }
}

function parseMultiValue(value) {
  const normalizedValue = toNonEmptyText(value);
  if (!normalizedValue) return [];
  return normalizedValue.split(',').map((item) => item.trim()).filter(Boolean);
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

function clampInteger(value, defaultValue, minValue, maxValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(maxValue, Math.max(minValue, parsed));
}

function toNonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}
