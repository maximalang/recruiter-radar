import http from 'node:http';
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class SourceHttpError extends Error {
  constructor(message, { url, status, statusText, attempt, cause } = {}) {
    super(message, { cause });
    this.name = 'SourceHttpError';
    this.url = url;
    this.status = status;
    this.statusText = statusText;
    this.attempt = attempt;
  }
}

export async function fetchJson(url, options = {}) {
  const requestOptions = {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers ?? {}),
    },
  };
  let response;

  if (options.preferNodeHttpFallback) {
    return fetchJsonWithNodeHttpFallback(url, requestOptions);
  }

  try {
    response = await fetchWithSourcePolicy(url, requestOptions);
  } catch (error) {
    if (!options.nodeHttpFallback || !isFetchTransportFailure(error)) {
      throw error;
    }

    return fetchJsonWithNodeHttpFallback(url, requestOptions, error);
  }

  if (!response.ok) {
    throw await buildStatusError(response, options.sourceName);
  }

  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithSourcePolicy(url, {
    ...options,
    headers: {
      accept: 'text/plain',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw await buildStatusError(response, options.sourceName);
  }

  return {
    response,
    body: await response.text(),
  };
}

export async function fetchWithSourcePolicy(url, options = {}) {
  const {
    headers,
    method,
    body,
    signal,
    sourceName = 'source',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    retryStatuses = DEFAULT_RETRY_STATUSES,
    // Optional undici dispatcher (e.g. a SOCKS5 dispatcher from fetch-socks).
    // undici's global fetch ignores http.Agent passed via `agent`; routing
    // through a proxy requires a dispatcher instead. Pulled out explicitly so
    // it is forwarded to fetch() rather than swallowed into ...fetchOptions.
    dispatcher,
    nodeHttpFallback: _nodeHttpFallback,
    preferNodeHttpFallback: _preferNodeHttpFallback,
    ...fetchOptions
  } = options;

  const safeUrl = redactUrl(url);
  const maxAttempts = Math.max(1, Number.isFinite(retries) ? retries + 1 : DEFAULT_RETRIES + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const combinedSignal = combineSignals(signal, controller.signal);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        method,
        body,
        headers,
        signal: combinedSignal,
        ...(dispatcher ? { dispatcher } : {}),
      });

      if (!retryStatuses.has(response.status) || attempt === maxAttempts) {
        return response;
      }

      lastError = await buildStatusError(response, sourceName, attempt);
    } catch (error) {
      if (signal?.aborted && !timedOut) {
        throw new SourceHttpError(
          `${sourceName} request aborted for ${safeUrl}`,
          { url: safeUrl, attempt, cause: error },
        );
      }

      lastError = new SourceHttpError(
        [
          `${sourceName} request failed for ${safeUrl}: ${error?.message ?? String(error)}.`,
          // When a proxy dispatcher is in play, the undici "fetch failed"
          // error gives no hint the proxy was involved — surface it so the
          // operator can debug the SOCKS connection instead of thinking the
          // upstream API is down.
          ...(dispatcher
            ? ['The request was routed through a proxy dispatcher — check that the proxy is reachable and not rejecting connections.']
            : []),
        ].join(' '),
        { url: safeUrl, attempt, cause: error },
      );

      if (attempt === maxAttempts) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }

    await delay(retryDelayMs * attempt);
  }

  throw lastError ?? new SourceHttpError(`${sourceName} request failed for ${safeUrl}`, { url: safeUrl });
}

async function buildStatusError(response, sourceName = 'source', attempt) {
  const safeUrl = redactUrl(response.url);
  const details = await readErrorBody(response);

  return new SourceHttpError(
    `${sourceName} returned HTTP ${response.status} for ${safeUrl}`
      + (details ? `: ${details}` : ''),
    {
      url: safeUrl,
      status: response.status,
      statusText: response.statusText,
      attempt,
    },
  );
}

function isFetchTransportFailure(error) {
  return error instanceof SourceHttpError
    && (error.cause?.message === 'fetch failed'
      || error.cause?.name === 'AbortError'
      || error.message.includes('fetch failed'));
}

async function fetchJsonWithNodeHttpFallback(url, options, originalError) {
  const retries = Number.isFinite(options.retries) ? options.retries : DEFAULT_RETRIES;
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const maxAttempts = Math.max(1, retries + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJsonOnceWithNodeHttpFallback(url, options, originalError, attempt);
    } catch (error) {
      lastError = error;

      if (!isRetryableNodeHttpFallbackError(error, retryStatuses) || attempt === maxAttempts) {
        throw error;
      }

      await delay((options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * attempt);
    }
  }

  throw lastError ?? new SourceHttpError(`${options.sourceName ?? 'source'} node-http fallback failed for ${redactUrl(url)}`);
}

function isRetryableNodeHttpFallbackError(error, retryStatuses) {
  if (!(error instanceof SourceHttpError)) {
    return false;
  }

  return retryStatuses.has(error.status)
    || error.message.includes('node-http fallback failed')
    || error.message.includes('node-http fallback timed out');
}

function fetchJsonOnceWithNodeHttpFallback(url, options, originalError, attempt) {
  return new Promise((resolvePromise, rejectPromise) => {
    const sourceName = options.sourceName ?? 'source';
    const safeUrl = redactUrl(url);
    const requestUrl = new URL(url);
    const transport = requestUrl.protocol === 'http:' ? http : https;
    const request = transport.request(requestUrl, {
      method: options.method ?? 'GET',
      headers: options.headers,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          rejectPromise(new SourceHttpError(
            `${sourceName} returned HTTP ${response.statusCode} for ${safeUrl}`
              + (body.trim() ? `: ${redactText(body.trim()).slice(0, 500)}` : ''),
            { url: safeUrl, status: response.statusCode, statusText: response.statusMessage, attempt, cause: originalError },
          ));
          return;
        }

        try {
          resolvePromise(JSON.parse(body));
        } catch (error) {
          rejectPromise(new SourceHttpError(
            `${sourceName} returned invalid JSON for ${safeUrl}: ${error?.message ?? String(error)}`,
            { url: safeUrl, cause: error },
          ));
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new SourceHttpError(
        `${sourceName} node-http fallback timed out for ${safeUrl}`,
        { url: safeUrl, cause: originalError },
      ));
    });
    request.on('error', (error) => {
      rejectPromise(error instanceof SourceHttpError
        ? error
        : new SourceHttpError(
          `${sourceName} node-http fallback failed for ${safeUrl}: ${error?.message ?? String(error)}`,
          { url: safeUrl, cause: error },
        ));
    });
    request.end(options.body);
  });
}

function combineSignals(...signals) {
  const activeSignals = signals.filter(Boolean);

  if (activeSignals.length === 0) {
    return undefined;
  }

  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }

    signal.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function readErrorBody(response) {
  try {
    const body = await response.text();
    const trimmed = body.trim();

    if (!trimmed) {
      return '';
    }

    return redactText(trimmed).slice(0, 500);
  } catch {
    return '';
  }
}

function redactUrl(value) {
  try {
    const url = new URL(value);

    if (url.username) {
      url.username = '[redacted]';
    }

    if (url.password) {
      url.password = '[redacted]';
    }

    for (const key of [...url.searchParams.keys()]) {
      if (/(token|key|secret|password|signature|auth)/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }

    return url.toString();
  } catch {
    return '<invalid-url>';
  }
}

function redactText(value) {
  return value
    .replace(/("(?:token|api[_-]?key|secret|password|authorization)"\s*:\s*")([^"]+)(")/gi, '$1[redacted]$3')
    .replace(/((?:token|api[_-]?key|secret|password|authorization)=)([^&\s"]+)/gi, '$1[redacted]');
}
