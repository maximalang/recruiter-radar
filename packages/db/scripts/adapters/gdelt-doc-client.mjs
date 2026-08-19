import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseRssAtomFeed } from './feed-parser.mjs';
import { fetchJson, fetchText, fetchWithSourcePolicy } from './source-http.mjs';

const DEFAULT_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_MIN_INTERVAL_MS = 6_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_BACKOFF_MS = 10_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_THROTTLE_COOLDOWN_MS = 30 * 60_000;
const GDELT_GAL_RSS_URL = 'https://data.gdeltproject.org/gdeltv3/gal/feed.rss';
const GDELT_GAL_MAX_ITEMS = 2_000;
const GDELT_GAL_MAX_BYTES = 8_000_000;

/** Process-wide bounded GDELT scheduler with persistent response cache. */
export function createGdeltDocClient(options = {}) {
  const cachePath = resolve(
    options.cachePath
      ?? process.env.FUNDING_SIGNALS_GDELT_CACHE_FILE
      ?? 'packages/db/scripts/.cache/gdelt-doc-api.json',
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;
  const minIntervalMs = boundedInteger(
    options.minIntervalMs ?? process.env.FUNDING_SIGNALS_GDELT_MIN_INTERVAL_MS,
    DEFAULT_MIN_INTERVAL_MS,
    5_000,
    60_000,
  );
  const cacheTtlMs = boundedInteger(
    options.cacheTtlMs ?? process.env.FUNDING_SIGNALS_GDELT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    60_000,
    24 * 60 * 60_000,
  );
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? process.env.FUNDING_SIGNALS_GDELT_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
    1,
    6,
  );
  let nextRequestAt = 0;
  let cachePromise = null;
  let persistChain = Promise.resolve();
  let galFeedPromise = null;

  async function request(url, { timeoutMs = 60_000 } = {}) {
    const cache = await loadCache();
    const cacheKey = createHash('sha256').update(String(url)).digest('hex');
    const cached = cache.entries[cacheKey];
    if (cached && now() - cached.storedAt < cacheTtlMs) {
      return { body: cached.body, cacheHit: true, attempts: 0, deferredMs: 0 };
    }
    const persistedNextRequestAt = Number(cache.scheduler?.nextRequestAt) || 0;
    if (persistedNextRequestAt > now()) {
      if (cached?.body) {
        return {
          body: cached.body,
          cacheHit: true,
          staleCache: true,
          attempts: 0,
          deferredMs: 0,
          retryAt: persistedNextRequestAt,
        };
      }
      const fallback = await tryGalFallback(url, timeoutMs);
      if (fallback) {
        cache.entries[cacheKey] = { storedAt: now(), body: fallback.body };
        await persistCache(cache);
        return {
          ...fallback,
          attempts: 0,
          deferredMs: 0,
          retryAt: persistedNextRequestAt,
        };
      }
      throw createDeferredError(persistedNextRequestAt);
    }
    nextRequestAt = Math.max(nextRequestAt, persistedNextRequestAt);

    let deferredMs = 0;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const reservationDelay = Math.max(0, nextRequestAt - now());
      if (reservationDelay > 0) {
        deferredMs += reservationDelay;
        await sleep(reservationDelay);
      }
      nextRequestAt = now() + minIntervalMs;

      let response;
      try {
        response = await (options.requestImpl ?? defaultRequest)(url, timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) break;
        const backoff = computeBackoff(attempt, null, random);
        nextRequestAt = Math.max(nextRequestAt, now() + backoff);
        continue;
      }

      if (response.status === 429) {
        lastError = createHttpError(response, attempt);
        const retryAfter = response.headers?.get?.('retry-after') ?? null;
        const backoff = retryAfter
          ? computeBackoff(attempt, retryAfter, random)
          : computeThrottleCooldown(random);
        nextRequestAt = Math.max(nextRequestAt, now() + backoff);
        cache.scheduler = {
          nextRequestAt,
          lastStatus: 429,
          lastThrottledAt: now(),
        };
        await persistCache(cache);
        lastError.retryAt = nextRequestAt;

        // The DOC endpoint is convenience search, not the only public GDELT
        // transport. Do not burn repeated quota/backoff attempts after a clear
        // throttle: the official GAL RSS stream is a bounded, keyless fallback.
        const fallback = await tryGalFallback(url, timeoutMs);
        if (fallback) {
          cache.entries[cacheKey] = { storedAt: now(), body: fallback.body };
          await persistCache(cache);
          return { ...fallback, attempts: attempt, deferredMs, retryAt: nextRequestAt };
        }
        if (!retryAfter || attempt === maxAttempts) break;
        continue;
      }
      if (response.status >= 500) {
        lastError = createHttpError(response, attempt);
        if (attempt === maxAttempts) break;
        const backoff = computeBackoff(attempt, response.headers?.get?.('retry-after'), random);
        nextRequestAt = Math.max(nextRequestAt, now() + backoff);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`GDELT DOC API returned terminal HTTP ${response.status}`);
      }

      const body = await response.json();
      cache.entries[cacheKey] = { storedAt: now(), body };
      cache.scheduler = { nextRequestAt: 0 };
      await persistCache(cache);
      return { body, cacheHit: false, attempts: attempt, deferredMs, transport: 'gdelt-doc-api' };
    }

    if (cached?.body) {
      return {
        body: cached.body,
        cacheHit: true,
        staleCache: true,
        attempts: maxAttempts,
        deferredMs,
      };
    }

    const fallback = await tryGalFallback(url, timeoutMs);
    if (fallback) {
      cache.entries[cacheKey] = { storedAt: now(), body: fallback.body };
      await persistCache(cache);
      return { ...fallback, attempts: maxAttempts, deferredMs };
    }
    throw lastError ?? new Error('GDELT DOC API request failed');
  }

  async function tryGalFallback(docUrl, timeoutMs) {
    const companyPhrase = extractIdentityPhrase(docUrl);
    if (!companyPhrase) return null;

    try {
      galFeedPromise ??= loadGalFeed(timeoutMs).catch((error) => {
        galFeedPromise = null;
        throw error;
      });
      const items = await galFeedPromise;
      const maxRecords = extractMaxRecords(docUrl);
      const normalizedCompany = normalizeMatchText(companyPhrase);
      const articles = [];

      for (const item of items) {
        const haystack = normalizeMatchText(`${item.title ?? ''} ${item.summary ?? ''}`);
        if (!containsPhrase(haystack, normalizedCompany)) continue;
        if (!hasBusinessContext(item.title, item.summary)) continue;
        const articleUrl = safePublicHttpUrl(item.url);
        if (!articleUrl) continue;

        articles.push({
          title: cleanText(item.title),
          url: articleUrl,
          domain: new URL(articleUrl).hostname.toLowerCase().replace(/^www\./, ''),
          seendate: item.publishedAt ?? new Date(now()).toISOString(),
        });
        if (articles.length >= maxRecords) break;
      }

      return {
        body: { articles },
        cacheHit: false,
        fallback: true,
        transport: 'gdelt-gal-rss',
      };
    } catch {
      return null;
    }
  }

  async function loadGalFeed(timeoutMs) {
    if (options.galItems) return options.galItems;
    if (options.galRequestImpl) return options.galRequestImpl(GDELT_GAL_RSS_URL, timeoutMs);

    const { response, body } = await fetchText(GDELT_GAL_RSS_URL, {
      sourceName: 'funding-business-signals gdelt-gal',
      retries: 1,
      timeoutMs,
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml',
        'user-agent': 'RecruiterRadar/1.0 (funding-business-signals)',
      },
    });
    const responseUrl = new URL(response?.url ?? GDELT_GAL_RSS_URL);
    if (responseUrl.protocol !== 'https:' || responseUrl.hostname !== 'data.gdeltproject.org') {
      throw new Error('GDELT GAL redirect left the approved public host.');
    }
    if (Buffer.byteLength(String(body ?? ''), 'utf8') > GDELT_GAL_MAX_BYTES) {
      throw new Error(`GDELT GAL RSS exceeds ${GDELT_GAL_MAX_BYTES} bytes.`);
    }
    return parseRssAtomFeed(body, GDELT_GAL_RSS_URL, { maxItems: GDELT_GAL_MAX_ITEMS });
  }

  async function loadCache() {
    cachePromise ??= readFile(cachePath, 'utf8')
      .then((value) => JSON.parse(value))
      .then((value) => normalizeCache(value))
      .catch(() => ({ version: 2, entries: {}, scheduler: { nextRequestAt: 0 } }));
    return cachePromise;
  }

  async function persistCache(cache) {
    if (options.persist === false) return;
    persistChain = persistChain.then(async () => {
      await mkdir(dirname(cachePath), { recursive: true });
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(pruneCache(cache, now()), null, 2)}\n`, 'utf8');
      await rename(temporaryPath, cachePath);
    });
    await persistChain;
  }

  return { request };
}

async function defaultRequest(url, timeoutMs) {
  const options = {
    sourceName: 'funding-business-signals gdelt',
    retries: 0,
    timeoutMs,
    headers: {
      accept: 'application/json',
      'user-agent': 'RecruiterRadar/1.0 (funding-business-signals)',
    },
  };
  try {
    return await fetchWithSourcePolicy(url, options);
  } catch (transportError) {
    try {
      const body = await fetchJson(url, { ...options, preferNodeHttpFallback: true });
      return { status: 200, headers: { get: () => null }, json: async () => body };
    } catch (fallbackError) {
      if (Number.isInteger(fallbackError?.status)) {
        return {
          status: fallbackError.status,
          headers: { get: (name) => name.toLowerCase() === 'retry-after' ? fallbackError.retryAfter : null },
          json: async () => ({}),
        };
      }
      throw new AggregateError([transportError, fallbackError], 'GDELT DOC API transports failed.');
    }
  }
}

function extractIdentityPhrase(value) {
  let query;
  try {
    query = new URL(value).searchParams.get('query') ?? '';
  } catch {
    return null;
  }
  const quoted = query.match(/"([^"\\]{2,120})"/);
  return cleanText(quoted?.[1]);
}

function extractMaxRecords(value) {
  try {
    return boundedInteger(new URL(value).searchParams.get('maxrecords'), 10, 1, 250);
  } catch {
    return 10;
  }
}

function containsPhrase(haystack, phrase) {
  if (!phrase || phrase.length < 2) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

function hasBusinessContext(title, summary) {
  const text = normalizeMatchText(`${title ?? ''} ${summary ?? ''}`);
  return /funding|investment|invest|raises|raised|series|seed|venture|capital|acqui|merger|expan|launch|new office|new factory|hiring|recruit|jobs|government contract|restructur|layoff|инвест|финанс|раунд|поглощ|слияни|расшир|запуск|ваканс|найм|сокращ|реструктур/u.test(text);
}

function safePublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function computeBackoff(attempt, retryAfter, random) {
  const retryAfterMs = parseRetryAfter(retryAfter);
  if (retryAfterMs !== null) return Math.min(retryAfterMs, DEFAULT_MAX_BACKOFF_MS);
  const exponential = Math.min(DEFAULT_BASE_BACKOFF_MS * (2 ** (attempt - 1)), DEFAULT_MAX_BACKOFF_MS);
  return Math.floor(exponential * (0.75 + random() * 0.5));
}

function computeThrottleCooldown(random) {
  return Math.floor(DEFAULT_THROTTLE_COOLDOWN_MS * (0.75 + random() * 0.5));
}

function createHttpError(response, attempts) {
  const error = new Error(`GDELT DOC API returned HTTP ${response.status}`);
  error.status = response.status;
  error.retryAfter = response.headers?.get?.('retry-after') ?? null;
  error.attempts = attempts;
  return error;
}

function createDeferredError(retryAt) {
  const error = new Error('GDELT DOC API request deferred by persistent cooldown');
  error.status = 429;
  error.attempts = 0;
  error.deferred = true;
  error.retryAt = retryAt;
  error.retryAfter = null;
  return error;
}

function parseRetryAfter(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function normalizeCache(value) {
  if (value?.entries && typeof value.entries === 'object') {
    return {
      version: 2,
      entries: value.entries,
      scheduler: {
        nextRequestAt: Number(value.scheduler?.nextRequestAt) || 0,
        ...(Number(value.scheduler?.lastStatus) === 429 ? { lastStatus: 429 } : {}),
        ...(Number.isFinite(Number(value.scheduler?.lastThrottledAt))
          ? { lastThrottledAt: Number(value.scheduler.lastThrottledAt) }
          : {}),
      },
    };
  }
  return { version: 2, entries: {}, scheduler: { nextRequestAt: 0 } };
}

function pruneCache(cache, currentTime) {
  const entries = Object.fromEntries(
    Object.entries(cache.entries)
      .filter(([, entry]) => currentTime - Number(entry?.storedAt) < 24 * 60 * 60_000)
      .slice(-500),
  );
  return { version: 2, entries, scheduler: cache.scheduler ?? { nextRequestAt: 0 } };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum
    ? Math.min(Math.floor(number), maximum)
    : fallback;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
