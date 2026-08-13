import { assertCrawlerUrlIsPublic } from './crawler-url-security.mjs';

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_REQUESTS_PER_BROWSER = 100;
const DEFAULT_MAX_BROWSER_AGE_MS = 15 * 60_000;
const DEFAULT_IDLE_BROWSER_TIMEOUT_MS = 60_000;
const DEFAULT_PER_HOST_MIN_INTERVAL_MS = 250;
const DEFAULT_PER_HOST_CONCURRENCY = 1;
const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_PROCESS_RSS_BYTES = 1_500 * 1024 * 1024;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_RESET_MS = 60_000;
const DEFAULT_ACCESS_FAILURE_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_THROTTLING_COOLDOWN_MS = 5 * 60_000;

/** Shared bounded Playwright worker pool for web and canonical DB sources. */
export function createPlaywrightBrowserPool(options = {}) {
  const concurrency = readPositiveInteger(
    options.concurrency,
    'PLAYWRIGHT_BROWSER_CONCURRENCY',
    DEFAULT_CONCURRENCY,
    8,
  );
  const maxRequestsPerBrowser = readPositiveInteger(
    options.maxRequestsPerBrowser,
    'PLAYWRIGHT_BROWSER_MAX_REQUESTS',
    DEFAULT_MAX_REQUESTS_PER_BROWSER,
  );
  const maxBrowserAgeMs = readPositiveInteger(
    options.maxBrowserAgeMs,
    'PLAYWRIGHT_BROWSER_MAX_AGE_MS',
    DEFAULT_MAX_BROWSER_AGE_MS,
  );
  const idleBrowserTimeoutMs = readPositiveInteger(
    options.idleBrowserTimeoutMs,
    'PLAYWRIGHT_BROWSER_IDLE_TIMEOUT_MS',
    DEFAULT_IDLE_BROWSER_TIMEOUT_MS,
  );
  const proxyUrls = resolveProxyUrls(options.proxyUrls);
  const perHostMinIntervalMs = readNonNegativeInteger(
    options.perHostMinIntervalMs,
    'PLAYWRIGHT_PER_HOST_MIN_INTERVAL_MS',
    DEFAULT_PER_HOST_MIN_INTERVAL_MS,
    60_000,
  );
  const perHostConcurrency = readPositiveInteger(
    options.perHostConcurrency,
    'PLAYWRIGHT_PER_HOST_CONCURRENCY',
    DEFAULT_PER_HOST_CONCURRENCY,
    concurrency,
  );
  const maxQueueSize = readPositiveInteger(
    options.maxQueueSize,
    'PLAYWRIGHT_BROWSER_MAX_QUEUE_SIZE',
    DEFAULT_MAX_QUEUE_SIZE,
    10_000,
  );
  const maxProcessRssBytes = readPositiveInteger(
    options.maxProcessRssBytes,
    'PLAYWRIGHT_BROWSER_MAX_PROCESS_RSS_BYTES',
    DEFAULT_MAX_PROCESS_RSS_BYTES,
  );
  const gracefulCloseTimeoutMs = readPositiveInteger(
    options.gracefulCloseTimeoutMs,
    'PLAYWRIGHT_BROWSER_GRACEFUL_CLOSE_TIMEOUT_MS',
    10_000,
    60_000,
  );
  const memoryUsage = typeof options.memoryUsage === 'function'
    ? options.memoryUsage
    : () => process.memoryUsage();
  const hostProfiles = buildHostProfiles(options.hostProfiles, {
    maxConcurrency: perHostConcurrency,
    minIntervalMs: perHostMinIntervalMs,
  }, concurrency);
  const circuitFailureThreshold = readPositiveInteger(
    options.circuitFailureThreshold,
    'PLAYWRIGHT_CIRCUIT_FAILURE_THRESHOLD',
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    20,
  );
  const circuitResetMs = readPositiveInteger(
    options.circuitResetMs,
    'PLAYWRIGHT_CIRCUIT_RESET_MS',
    DEFAULT_CIRCUIT_RESET_MS,
    60 * 60_000,
  );
  const accessFailureCooldownMs = readPositiveInteger(
    options.accessFailureCooldownMs,
    'PLAYWRIGHT_ACCESS_FAILURE_COOLDOWN_MS',
    DEFAULT_ACCESS_FAILURE_COOLDOWN_MS,
    24 * 60 * 60_000,
  );
  const throttlingCooldownMs = readPositiveInteger(
    options.throttlingCooldownMs,
    'PLAYWRIGHT_THROTTLING_COOLDOWN_MS',
    DEFAULT_THROTTLING_COOLDOWN_MS,
    24 * 60 * 60_000,
  );
  const workers = Array.from({ length: concurrency }, (_, index) => ({
    index,
    browser: null,
    launchedAt: 0,
    requests: 0,
    busy: false,
  }));
  const waiters = [];
  const hostStates = new Map();
  let idleTimer = null;
  let closed = false;
  let pendingRequests = 0;

  async function fetchPage({
    url,
    timeoutMs = 30_000,
    headers = {},
    previous = {},
    settleMs = readNonNegativeInteger(undefined, 'PLAYWRIGHT_RENDER_SETTLE_MS', 1_500, 15_000),
  }) {
    const releaseQueueSlot = reserveQueueSlot();
    const resolutionCache = new Map();
    let host = null;
    let releaseHost = null;
    let worker = null;
    let context = null;
    try {
      const initial = await assertCrawlerUrlIsPublic(url, {
        lookup: options.dnsLookup,
        resolutionCache,
      });
      host = initial.hostname;
      releaseHost = await awaitHostPermission(host);
      worker = await acquire();
      const browser = await getBrowser(worker);
      context = await browser.newContext({
        extraHTTPHeaders: {
          'accept-language': 'ru,en;q=0.9',
          ...(options.defaultHeaders ?? {}),
          ...buildConditionalHeaders(previous),
          ...headers,
        },
      });
      await context.route('**/*', async (route, request) => {
        try {
          await assertCrawlerUrlIsPublic(request.url(), {
            lookup: options.dnsLookup,
            resolutionCache,
          });
          await route.continue();
        } catch (error) {
          await route.abort('blockedbyclient').catch(() => undefined);
          if (request.isNavigationRequest?.() ?? true) throw error;
        }
      });
      const page = await context.newPage();
      const stuckPageTimeoutMs = readPositiveInteger(
        options.stuckPageTimeoutMs,
        'PLAYWRIGHT_STUCK_PAGE_TIMEOUT_MS',
        Math.min(timeoutMs + settleMs + 5_000, 120_000),
        180_000,
      );
      const rendered = await withDeadline(async () => {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
        if (settleMs > 0 && typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(settleMs);
        }
        const status = response?.status() ?? 200;
        const rawHeaders = response ? await response.allHeaders() : {};
        const finalUrl = response?.url?.() ?? url;
        await assertCrawlerUrlIsPublic(finalUrl, {
          lookup: options.dnsLookup,
          resolutionCache,
        });
        return {
          response,
          status,
          rawHeaders,
          finalUrl,
          html: status === 304 ? null : await page.content(),
        };
      }, stuckPageTimeoutMs, () => buildStuckPageError(host, url, stuckPageTimeoutMs));
      const { response, status, rawHeaders, finalUrl, html } = rendered;
      recordHostOutcome(host, classifyHttpOutcome(status), {
        retryAfterMs: parseRetryAfterMs(rawHeaders['retry-after']),
      });
      return {
        url: finalUrl,
        status,
        html,
        rawHeaders,
        notModified: status === 304,
        validators: {
          etag: boundedHeader(rawHeaders.etag) ?? boundedHeader(previous.etag),
          lastModified: boundedHeader(rawHeaders['last-modified']) ?? boundedHeader(previous.lastModified),
        },
        fetchedAt: new Date().toISOString(),
        warnings: response ? [] : ['Playwright navigation returned no HTTP response'],
      };
    } catch (error) {
      if (host && error?.code !== 'PLAYWRIGHT_CIRCUIT_OPEN') {
        recordHostOutcome(host, 'server-network-failure');
      }
      throw error;
    } finally {
      if (worker) worker.requests += 1;
      if (context) await context.close().catch(() => undefined);
      if (worker) release(worker);
      releaseHost?.();
      releaseQueueSlot();
    }
  }

  async function awaitHostPermission(host) {
    const state = getHostState(host);
    return new Promise((resolve, reject) => {
      state.waiters.push({ resolve, reject });
      void drainHost(host, state);
    });
  }

  function getHostState(host) {
    const state = hostStates.get(host) ?? {
      nextAllowedAt: 0,
      failures: 0,
      openUntil: 0,
      active: 0,
      draining: false,
      waiters: [],
      profile: resolveHostProfile(host, hostProfiles),
    };
    hostStates.set(host, state);
    return state;
  }

  async function drainHost(host, state) {
    if (state.draining) return;
    state.draining = true;
    try {
      while (!closed && state.active < state.profile.maxConcurrency && state.waiters.length > 0) {
        const waiter = state.waiters.shift();
        const now = Date.now();
        if (state.openUntil > now) {
          waiter.reject(buildCircuitOpenError(host, state.openUntil));
          continue;
        }
        if (state.openUntil > 0) {
          state.openUntil = 0;
          state.failures = 0;
        }
        const reservedAt = Math.max(now, state.nextAllowedAt);
        const waitMs = reservedAt - now;
        state.nextAllowedAt = reservedAt + state.profile.minIntervalMs;
        if (waitMs > 0) await delay(waitMs);
        if (closed) {
          waiter.reject(new Error('Playwright browser pool is closed'));
          continue;
        }
        state.active += 1;
        let released = false;
        waiter.resolve(() => {
          if (released) return;
          released = true;
          state.active = Math.max(0, state.active - 1);
          void drainHost(host, state);
        });
      }
    } finally {
      state.draining = false;
      if (!closed && state.active < state.profile.maxConcurrency && state.waiters.length > 0) {
        queueMicrotask(() => void drainHost(host, state));
      }
    }
  }

  function recordHostOutcome(host, outcome, { retryAfterMs = 0 } = {}) {
    const state = hostStates.get(host);
    if (!state) return;
    if (outcome === 'success') {
      state.failures = 0;
      state.openUntil = 0;
      return;
    }
    state.failures += 1;
    if (state.failures >= circuitFailureThreshold) {
      const cooldownMs = outcome === 'auth-access-failure'
        ? accessFailureCooldownMs
        : outcome === 'throttling'
          ? Math.max(throttlingCooldownMs, retryAfterMs)
          : circuitResetMs;
      state.openUntil = Date.now() + cooldownMs;
    }
  }

  async function close() {
    closed = true;
    clearIdleTimer();
    const error = new Error('Playwright browser pool is closed');
    while (waiters.length > 0) waiters.shift()?.reject(error);
    for (const state of hostStates.values()) {
      while (state.waiters.length > 0) state.waiters.shift()?.reject(error);
    }
    await waitForDrain(gracefulCloseTimeoutMs);
    await recycleAllBrowsers();
  }

  async function waitForDrain(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (pendingRequests > 0 && Date.now() < deadline) await delay(10);
  }

  function reserveQueueSlot() {
    if (closed) throw new Error('Playwright browser pool is closed');
    if (pendingRequests >= concurrency + maxQueueSize) {
      const error = new Error(`Playwright browser queue is full (${maxQueueSize} waiting requests)`);
      error.code = 'PLAYWRIGHT_QUEUE_FULL';
      error.maxQueueSize = maxQueueSize;
      throw error;
    }
    pendingRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      pendingRequests = Math.max(0, pendingRequests - 1);
    };
  }

  async function acquire() {
    if (closed) throw new Error('Playwright browser pool is closed');
    clearIdleTimer();
    const available = workers.find((worker) => !worker.busy);
    if (available) {
      available.busy = true;
      return available;
    }
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  function release(worker) {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(worker);
      return;
    }
    worker.busy = false;
    if (!closed && workers.every((candidate) => !candidate.busy)) scheduleIdleRecycle();
  }

  async function getBrowser(worker) {
    if (
      worker.browser
      && (
        worker.requests >= maxRequestsPerBrowser
        || Date.now() - worker.launchedAt >= maxBrowserAgeMs
        || Number(memoryUsage()?.rss) >= maxProcessRssBytes
        || (typeof worker.browser.isConnected === 'function' && !worker.browser.isConnected())
      )
    ) await recycleBrowser(worker);
    if (worker.browser) return worker.browser;

    const { chromium } = await import('playwright');
    const proxyUrl = proxyUrls.length > 0
      ? proxyUrls[worker.index % proxyUrls.length]
      : undefined;
    worker.browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
    });
    worker.launchedAt = Date.now();
    worker.requests = 0;
    return worker.browser;
  }

  async function recycleBrowser(worker) {
    const browser = worker.browser;
    worker.browser = null;
    worker.launchedAt = 0;
    worker.requests = 0;
    if (browser) await browser.close().catch(() => undefined);
  }

  async function recycleAllBrowsers() {
    await Promise.all(workers.map((worker) => recycleBrowser(worker)));
  }

  function scheduleIdleRecycle() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void recycleAllBrowsers();
    }, idleBrowserTimeoutMs);
    idleTimer.unref?.();
  }

  function clearIdleTimer() {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  return { fetchPage, close };
}

function resolveProxyUrls(explicit) {
  if (Array.isArray(explicit) && explicit.length > 0) return explicit.filter(Boolean);
  const envValue = process.env.CRAWLEE_PROXY_URLS?.trim();
  if (!envValue) return [];
  return envValue.split(',').map((value) => value.trim()).filter(Boolean);
}

function buildHostProfiles(explicit, defaults, maximumConcurrency) {
  const profiles = [
    { pattern: 'boards.greenhouse.io', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: 'jobs.lever.co', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: 'jobs.ashbyhq.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.recruitee.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: 'apply.workable.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.myworkdayjobs.com', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.teamtailor.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.jobs.personio.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.jobs.personio.de', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.bamboohr.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.pinpointhq.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.breezy.hr', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.comeet.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.applytojob.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.icims.com', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.taleo.net', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.oraclecloud.com', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.successfactors.com', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.successfactors.eu', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: 'careers.smartrecruiters.com', maxConcurrency: 1, minIntervalMs: 1_500 },
    { pattern: '*.potok.io', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.huntflow.io', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: 'jobs.friend.work', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: '*.skillaz.ru', maxConcurrency: 1, minIntervalMs: 2_000 },
    { pattern: 'talantix.ru', maxConcurrency: 1, minIntervalMs: 2_000 },
  ];
  for (const [pattern, profile] of Object.entries(explicit ?? {})) {
    if (!pattern.trim() || !profile || typeof profile !== 'object') continue;
    profiles.push({
      pattern: pattern.trim().toLowerCase(),
      maxConcurrency: readBoundedNumber(profile.maxConcurrency, defaults.maxConcurrency, 1, maximumConcurrency),
      minIntervalMs: readBoundedNumber(profile.minIntervalMs, defaults.minIntervalMs, 0, 60_000),
    });
  }
  return { defaults, profiles };
}

function resolveHostProfile(host, configured) {
  let result = configured.defaults;
  for (const profile of configured.profiles) {
    if (matchesHostPattern(host, profile.pattern)) result = profile;
  }
  return result;
}

function matchesHostPattern(host, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

function readBoundedNumber(value, fallback, minimum, maximum) {
  const candidate = Number(value);
  return Number.isFinite(candidate)
    ? Math.min(Math.max(Math.floor(candidate), minimum), maximum)
    : fallback;
}

function buildCircuitOpenError(host, openUntil) {
  const error = new Error(`Playwright circuit is open for ${host}`);
  error.code = 'PLAYWRIGHT_CIRCUIT_OPEN';
  error.host = host;
  error.retryAt = new Date(openUntil).toISOString();
  return error;
}

function buildStuckPageError(host, url, timeoutMs) {
  const error = new Error(`Playwright page exceeded ${timeoutMs}ms for ${url}`);
  error.code = 'PLAYWRIGHT_PAGE_STUCK';
  error.host = host;
  error.url = url;
  error.timeoutMs = timeoutMs;
  return error;
}

async function withDeadline(task, timeoutMs, buildError) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(buildError()), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readPositiveInteger(explicit, envName, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const envValue = process.env[envName]?.trim();
  const candidate = explicit ?? (envValue ? Number(envValue) : fallback);
  if (!Number.isFinite(candidate) || candidate < 1) return fallback;
  return Math.min(Math.floor(candidate), maximum);
}

function readNonNegativeInteger(explicit, envName, fallback, maximum) {
  const envValue = process.env[envName]?.trim();
  const candidate = explicit ?? (envValue ? Number(envValue) : fallback);
  if (!Number.isFinite(candidate) || candidate < 0) return fallback;
  return Math.min(Math.floor(candidate), maximum);
}

function buildConditionalHeaders(previous) {
  const headers = {};
  const etag = boundedHeader(previous?.etag);
  const lastModified = boundedHeader(previous?.lastModified);
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  return headers;
}

function boundedHeader(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= 512
    && !/[\r\n]/.test(value)
    ? value.trim()
    : null;
}

function classifyHttpOutcome(status) {
  if ((status >= 200 && status < 400) || status === 404 || status === 410) return 'success';
  if ([401, 403, 407, 451].includes(status)) return 'auth-access-failure';
  if (status === 429) return 'throttling';
  if (status >= 500) return 'server-network-failure';
  return 'server-network-failure';
}

function parseRetryAfterMs(value) {
  const normalized = boundedHeader(value);
  if (!normalized) return 0;
  if (/^\d+$/.test(normalized)) return Math.min(Number(normalized) * 1_000, 24 * 60 * 60_000);
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt)
    ? Math.min(Math.max(0, retryAt - Date.now()), 24 * 60 * 60_000)
    : 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
