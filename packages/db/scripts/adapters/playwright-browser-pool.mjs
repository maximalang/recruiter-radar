const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_REQUESTS_PER_BROWSER = 100;
const DEFAULT_MAX_BROWSER_AGE_MS = 15 * 60_000;
const DEFAULT_IDLE_BROWSER_TIMEOUT_MS = 60_000;
const DEFAULT_PER_HOST_MIN_INTERVAL_MS = 250;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_RESET_MS = 60_000;

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

  async function fetchPage({ url, timeoutMs = 30_000, headers = {}, previous = {} }) {
    const host = toPublicHost(url);
    await awaitHostPermission(host);
    const worker = await acquire();
    let context = null;
    try {
      const browser = await getBrowser(worker);
      context = await browser.newContext({
        extraHTTPHeaders: {
          'accept-language': 'ru,en;q=0.9',
          ...(options.defaultHeaders ?? {}),
          ...buildConditionalHeaders(previous),
          ...headers,
        },
      });
      const page = await context.newPage();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      const status = response?.status() ?? 200;
      const rawHeaders = response ? await response.allHeaders() : {};
      recordHostOutcome(host, status < 500 && status !== 429);
      return {
        url: response?.url?.() ?? url,
        status,
        html: status === 304 ? null : await page.content(),
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
      recordHostOutcome(host, false);
      throw error;
    } finally {
      worker.requests += 1;
      if (context) await context.close().catch(() => undefined);
      release(worker);
    }
  }

  async function awaitHostPermission(host) {
    const state = hostStates.get(host) ?? { nextAllowedAt: 0, failures: 0, openUntil: 0 };
    hostStates.set(host, state);
    const now = Date.now();
    if (state.openUntil > now) {
      const error = new Error(`Playwright circuit is open for ${host}`);
      error.code = 'PLAYWRIGHT_CIRCUIT_OPEN';
      error.host = host;
      error.retryAt = new Date(state.openUntil).toISOString();
      throw error;
    }
    if (state.openUntil > 0) {
      state.openUntil = 0;
      state.failures = 0;
    }
    const reservedAt = Math.max(now, state.nextAllowedAt);
    const waitMs = reservedAt - now;
    state.nextAllowedAt = reservedAt + perHostMinIntervalMs;
    if (waitMs > 0) await delay(waitMs);
  }

  function recordHostOutcome(host, success) {
    const state = hostStates.get(host);
    if (!state) return;
    if (success) {
      state.failures = 0;
      state.openUntil = 0;
      return;
    }
    state.failures += 1;
    if (state.failures >= circuitFailureThreshold) {
      state.openUntil = Date.now() + circuitResetMs;
    }
  }

  async function close() {
    closed = true;
    clearIdleTimer();
    const error = new Error('Playwright browser pool is closed');
    while (waiters.length > 0) waiters.shift()?.reject(error);
    await recycleAllBrowsers();
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

function toPublicHost(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Playwright browser pool requires a public HTTP(S) URL');
  }
  return url.hostname.toLowerCase();
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
