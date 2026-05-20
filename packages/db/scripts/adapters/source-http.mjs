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
  const response = await fetchWithSourcePolicy(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });

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
        `${sourceName} request failed for ${safeUrl}: ${error?.message ?? String(error)}`,
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
