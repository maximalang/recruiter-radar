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
const HH_RATE_LIMIT = 30; // HH API: 30 requests/minute
const hhRateLimiter = new RateLimiter(HH_RATE_LIMIT);
const DEFAULT_SEARCH_TEXT = '\u0440\u0435\u043a\u0440\u0443\u0442\u0435\u0440';
const DEFAULT_PER_PAGE = 20;
const DEFAULT_PAGES = 1;
const MAX_PER_PAGE = 100;
const MAX_PAGES = 20;
// HH's official vacancy-search label excludes listings posted by agencies.
// Source: https://api.hh.ru/openapi/redoc#tag/Poisk-vakansij/operation/get-vacancies
const DEFAULT_VACANCY_LABELS = ['not_from_agency'];

/**
 * Thrown when HH's search API answers with HTTP 403 `forbidden`.
 *
 * Keep the status distinct without guessing whether the cause is credentials,
 * permissions, policy, or transport. The authenticated response is the source
 * of truth for operator diagnostics.
 */
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

function isForbiddenError(error) {
  return (
    error instanceof SourceHttpError
    && error.status === 403
    && /forbidden/i.test(error.message)
  );
}

/**
 * Build an undici `Agent` that tunnels HH requests through the SOCKS5 proxy
 * named by HH_PROXY_URL, or null when no proxy is configured.
 *
 * WHY a dispatcher and not `agent`: the HH adapter runs on undici's `fetch`,
 * which ignores the `http.Agent` that socks-proxy-agent produces. undici routes
 * through a proxy only via a `dispatcher`. This is what unblocks the HH-search
 * 403 — see HhAccessForbiddenError — when the runner egresses from a non-RU IP
 * and a SOCKS5 proxy provides an RU-resident exit.
 *
 * WHY we build the Agent from the explicit `undici` package (not fetch-socks):
 * fetch-socks bundles its own undici@8 and builds the dispatcher against undici
 * 8's handler contract. Node's global fetch is undici 6 (Node 22) / 7 (Node 24),
 * so passing an undici-8 Agent into the global fetch throws
 * `invalid onRequestStart method` (UND_ERR_INVALID_ARG). We instead build the
 * SOCKS connector with `socks` + undici's own `buildConnector`, wrap it in
 * undici's `Agent`, and pair it with undici's `fetch` (resolveHhProxyFetch) so
 * dispatcher and fetch come from one undici copy — pinned to ^6 to match the
 * Node 22 runtime. See memory: project_hh_proxy_undici_mismatch.
 *
 * Cached so we open a single connection pool, not one per page.
 */
let cachedProxyDispatcher;

/**
 * undici connector that opens the TCP socket through one or more SOCKS proxies,
 * then hands off to undici's own connector for the (optional) TLS upgrade.
 *
 * This is the minimal port of fetch-socks' `socksConnector`, kept in-tree so we
 * never mix a second undici copy into the runtime fetch. Scoped to this adapter.
 */
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

    // Plain HTTP: the raw SOCKS socket is the connection.
    if (protocol !== 'https:') {
      return callback(null, socket.setNoDelay());
    }

    // HTTPS: hand the established socket to undici for the TLS upgrade.
    return undiciConnect({ ...options, httpSocket: socket }, callback);
  };
}

// socks5h/socks4a are remote-DNS variants; fetch-socks resolves DNS proxy-side
// for SOCKS5 (type 5) and SOCKS4 (type 4) regardless, so both map to the base
// numeric type the `socks` library expects.
const SOCKS_PROTOCOL_TYPES = {
  'socks:': 5,
  'socks5:': 5,
  'socks5h:': 5,
  'socks4:': 4,
  'socks4a:': 4,
};

export function resolveHhProxyDispatcher(env = process.env) {
  if (cachedProxyDispatcher !== undefined) {
    return cachedProxyDispatcher;
  }

  const proxyUrl = toNonEmptyText(env.HH_PROXY_URL);

  if (!proxyUrl) {
    // No proxy configured — this is the common case and is not cached so
    // tests can call resolveHhProxyDispatcher with different env objects.
    return null;
  }

  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch (_error) {
    throw new Error(
      'HH_PROXY_URL is not a valid URL. Check format: socks5://[user:pass@]host:port.',
    );
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
    // URL.hostname includes brackets for IPv6 (e.g. "[::1]"); the socks
    // library expects a raw address — strip them.
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
  };

  if (parsed.username) {
    // URL.username is raw percent-encoded; decode to get the actual value.
    proxyConfig.userId = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    // URL.password likewise — single decode, never double.
    proxyConfig.password = decodeURIComponent(parsed.password);
  }

  cachedProxyDispatcher = new Agent({ connect: createSocksConnector(proxyConfig) });
  return cachedProxyDispatcher;
}

/**
 * The `fetch` that MUST be used with the dispatcher from
 * resolveHhProxyDispatcher: undici's own `fetch`, from the same undici copy
 * that built the Agent. Pairing them avoids the "two undici" handler mismatch.
 * Returns undici's fetch only when a proxy is active; null otherwise (callers
 * then fall through to Node's global fetch for the direct, non-proxy path).
 */
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

export function resolveHhVacancySearchConfig(env = process.env) {
  const searchText = toNonEmptyText(env.HH_SEARCH_TEXT) ?? DEFAULT_SEARCH_TEXT;
  const perPage = clampInteger(env.HH_PER_PAGE, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);
  const pages = clampInteger(env.HH_PAGES, DEFAULT_PAGES, 1, MAX_PAGES);
  const extraParams = { label: [...DEFAULT_VACANCY_LABELS] };

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

export async function fetchHhVacancyPages({
  userAgent,
  config = resolveHhVacancySearchConfig(),
  env = process.env,
  oauthFetchImpl,
}) {
  const normalizedUserAgent = toNonEmptyText(userAgent);

  if (!normalizedUserAgent) {
    throw new Error('HH user agent is required.');
  }

  const items = [];
  const pageSummaries = [];
  let found = 0;
  let pagesAvailable = null;
  const proxyDispatcher = resolveHhProxyDispatcher();
  // Pair the dispatcher with undici's own fetchImpl (same undici copy) — see
  // resolveHhProxyFetch. null when no proxy: the direct path stays on global fetch.
  const proxyFetch = resolveHhProxyFetch();
  const oauthEnv = { ...env, HH_USER_AGENT: normalizedUserAgent };
  let authorization = await resolveHhApplicationAuthorization(oauthEnv, {
    ...(oauthFetchImpl ? { fetchImpl: oauthFetchImpl } : {}),
  });

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
    let payload;
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
      payload = await fetchPage();
    } catch (error) {
      if (authorization && error instanceof SourceHttpError && error.status === 401) {
        resetHhApplicationTokenCache();
        authorization = await resolveHhApplicationAuthorization(oauthEnv, {
          ...(oauthFetchImpl ? { fetchImpl: oauthFetchImpl } : {}),
        });
        try {
          payload = await fetchPage();
        } catch (retryError) {
          if (isForbiddenError(retryError)) {
            throw new HhAccessForbiddenError(retryError.url, retryError);
          }
          throw retryError;
        }
      } else if (isForbiddenError(error)) {
        throw new HhAccessForbiddenError(error.url, error);
      } else {
        throw error;
      }
    }
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

export function describeHhFailure(error) {
  const status = Number.isInteger(error?.status)
    ? error.status
    : Number.isInteger(error?.cause?.status) ? error.cause.status : null;
  const message = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof HhOAuthError
    ? error.type
    : extractHhErrorType(message) ?? (error instanceof HhAccessForbiddenError ? 'forbidden' : 'unknown');

  return {
    status,
    errorType,
    captcha: /captcha/i.test(errorType) || /captcha/i.test(message),
    oauthFailure: error instanceof HhOAuthError || status === 401,
    rateLimit: status === 429 || /rate.?limit/i.test(errorType),
    accessForbidden: error instanceof HhAccessForbiddenError,
    networkFailure: status === null && !(error instanceof HhOAuthError),
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
