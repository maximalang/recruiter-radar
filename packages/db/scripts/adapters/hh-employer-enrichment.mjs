import { fetch as undiciFetch } from 'undici';

import { fetchJson, SourceHttpError } from './source-http.mjs';
import {
  resetHhApplicationTokenCache,
  resolveHhApplicationAuthorization,
} from './hh-oauth.mjs';
import {
  resolveHhProxyDispatcher,
  resolveHhProxyFetch,
} from './hh.mjs';
import { RateLimiter } from './rate-limiter.mjs';

const HH_EMPLOYERS_URL = 'https://api.hh.ru/employers';
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MAX_EMPLOYERS = 1200;
const MAX_EMPLOYERS = 2000;
const employerRateLimiter = new RateLimiter(30);

/**
 * Return HH employer ids present in vacancy search items. Search results often
 * contain an employer id but not its public site_url. Stable employer detail is
 * therefore an identity-enrichment surface, not a replacement for vacancy
 * hiring evidence.
 */
export function collectHhEmployerIds(vacancies) {
  const counts = new Map();
  for (const vacancy of Array.isArray(vacancies) ? vacancies : []) {
    const id = normalizeEmployerId(vacancy?.employer?.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // Higher-frequency employers are enriched first if a pathological 12h window
  // contains more unique employers than the bounded detail budget.
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
}

export async function fetchHhEmployerDetails({
  employerIds,
  userAgent,
  knownEmployerIds = new Set(),
  env = process.env,
  fetchJsonImpl = fetchJson,
  oauthFetchImpl,
  concurrency = resolveConcurrency(env.HH_EMPLOYER_DETAIL_CONCURRENCY),
  maxEmployers = resolveMaxEmployers(env.HH_EMPLOYER_DETAIL_MAX),
}) {
  const normalizedUserAgent = nonEmptyText(userAgent);
  if (!normalizedUserAgent) throw new Error('HH user agent is required for employer enrichment.');

  const known = knownEmployerIds instanceof Set
    ? knownEmployerIds
    : new Set(Array.from(knownEmployerIds ?? []).map(normalizeEmployerId).filter(Boolean));
  const requestedIds = [...new Set((employerIds ?? []).map(normalizeEmployerId).filter(Boolean))]
    .filter((id) => !known.has(id));
  const selectedIds = requestedIds.slice(0, maxEmployers);
  const details = new Map();
  const failures = [];
  if (selectedIds.length === 0) {
    return {
      details,
      requested: 0,
      enriched: 0,
      failed: 0,
      skippedKnown: (employerIds ?? []).length - requestedIds.length,
      truncated: requestedIds.length > maxEmployers,
      truncatedEmployers: Math.max(0, requestedIds.length - maxEmployers),
      failures,
    };
  }

  const oauthEnv = { ...env, HH_USER_AGENT: normalizedUserAgent };
  let authorization = await resolveHhApplicationAuthorization(oauthEnv, {
    ...(oauthFetchImpl ? { fetchImpl: oauthFetchImpl } : {}),
  });
  const proxyDispatcher = resolveHhProxyDispatcher(env);
  const proxyFetch = resolveHhProxyFetch(env) ?? undiciFetch;

  const queue = [...selectedIds];
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), queue.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return {
    details,
    requested: selectedIds.length,
    enriched: details.size,
    failed: failures.length,
    skippedKnown: (employerIds ?? []).length - requestedIds.length,
    truncated: requestedIds.length > maxEmployers,
    truncatedEmployers: Math.max(0, requestedIds.length - maxEmployers),
    failures,
  };

  async function worker() {
    while (queue.length > 0) {
      const employerId = queue.shift();
      if (!employerId) continue;
      try {
        const detail = await fetchOne(employerId);
        if (detail) details.set(employerId, detail);
      } catch (error) {
        failures.push({
          employerId,
          status: Number.isInteger(error?.status) ? error.status : null,
          category: classifyFailure(error),
        });
      }
    }
  }

  async function fetchOne(employerId) {
    const url = `${HH_EMPLOYERS_URL}/${encodeURIComponent(employerId)}`;
    while (!(await employerRateLimiter.allow('api.hh.ru'))) {
      const waitMs = await employerRateLimiter.msUntilNextAllowed('api.hh.ru');
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const request = () => fetchJsonImpl(url, {
      sourceName: 'hh-employer-detail',
      headers: {
        accept: 'application/json',
        'hh-user-agent': normalizedUserAgent,
        'user-agent': normalizedUserAgent,
        ...(authorization ? { authorization } : {}),
      },
      ...(proxyDispatcher ? { dispatcher: proxyDispatcher, fetchImpl: proxyFetch } : {}),
    });

    let payload;
    try {
      payload = await request();
    } catch (error) {
      if (authorization && error instanceof SourceHttpError && error.status === 401) {
        resetHhApplicationTokenCache();
        authorization = await resolveHhApplicationAuthorization(oauthEnv, {
          ...(oauthFetchImpl ? { fetchImpl: oauthFetchImpl } : {}),
        });
        payload = await request();
      } else {
        throw error;
      }
    }

    if (normalizeEmployerId(payload?.id) !== employerId) {
      throw new Error(`HH employer detail id mismatch for ${employerId}`);
    }
    return normalizeEmployerDetail(payload);
  }
}

export function mergeHhEmployerDetails(vacancies, details) {
  const map = details instanceof Map ? details : new Map(Object.entries(details ?? {}));
  let enrichedVacancies = 0;
  const records = (Array.isArray(vacancies) ? vacancies : []).map((vacancy) => {
    const employerId = normalizeEmployerId(vacancy?.employer?.id);
    const detail = employerId ? map.get(employerId) : null;
    if (!detail) return vacancy;
    enrichedVacancies += 1;
    return {
      ...vacancy,
      employer: {
        ...(vacancy.employer ?? {}),
        name: vacancy.employer?.name ?? detail.name,
        site_url: detail.siteUrl ?? vacancy.employer?.site_url ?? null,
        trusted: detail.trusted ?? vacancy.employer?.trusted ?? null,
        type: detail.type ?? vacancy.employer?.type ?? null,
        open_vacancies: detail.openVacancies ?? vacancy.employer?.open_vacancies ?? null,
        accredited_it_employer: detail.accreditedItEmployer ?? vacancy.employer?.accredited_it_employer ?? null,
        employer_detail_enriched: true,
      },
    };
  });
  return { records, enrichedVacancies };
}

function normalizeEmployerDetail(payload) {
  return Object.freeze({
    id: normalizeEmployerId(payload?.id),
    name: nonEmptyText(payload?.name),
    siteUrl: normalizeHttpUrl(payload?.site_url),
    trusted: typeof payload?.trusted === 'boolean' ? payload.trusted : null,
    type: nonEmptyText(payload?.type),
    openVacancies: nonNegativeInteger(payload?.open_vacancies),
    accreditedItEmployer: typeof payload?.accredited_it_employer === 'boolean'
      ? payload.accredited_it_employer
      : null,
  });
}

function classifyFailure(error) {
  const status = Number(error?.status);
  if (status === 404) return 'not-found';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate-limited';
  if (status === 401) return 'unauthorized';
  if (Number.isInteger(status) && status >= 500) return 'upstream-5xx';
  return 'network-or-contract';
}

function normalizeEmployerId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const text = nonEmptyText(value);
  return text && /^\d+$/.test(text) ? text : null;
}

function normalizeHttpUrl(value) {
  const text = nonEmptyText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function resolveConcurrency(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : DEFAULT_CONCURRENCY;
}

function resolveMaxEmployers(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_EMPLOYERS
    ? parsed
    : DEFAULT_MAX_EMPLOYERS;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function nonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
