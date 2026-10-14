/**
 * Shared runtime for the 2026-10 public source expansion (16 sources).
 *
 * All sources here are Class A: free public endpoints, no credentials, no
 * paid tiers. Each source is registered in packages/db/scripts/source-registry.mjs,
 * apps/web/lib/sources/source-registry.ts, source-policy.json and
 * source-readiness.json. Every thin script under
 * packages/db/scripts/source-<id>.mjs instantiates one spec from this module.
 *
 * Design rules:
 * - Live fetches go through the centralized transport (adapters/source-http.mjs)
 *   with bounded pages/records, a polite delay between requests and an
 *   identifying User-Agent.
 * - New job boards stay OUT of the daily pipeline (isPrimary false, no daily
 *   stage) and are blocked-from-digest pending confidence gates, mirroring
 *   habr-career/linkedin-company-pages.
 * - Context/registry sources run only in the supporting stage behind explicit
 *   activation env vars, and query-driven sources produce an expected-zero run
 *   when no targets are configured (never untargeted bulk scraping).
 * - File mode accepts a JSON array (or {records: [...]}) of canonical records
 *   in the same shape the live fetchers emit, so fixtures test the exact
 *   normalization path used in production.
 * - Salary fields from international boards are NOT mapped into the RUB-salary
 *   quality fields to avoid mislabeled currency normalization.
 */
import { createStandardSourceRuntime, parseCommaSeparated, clampInteger, toNonEmptyText, toUrlOrNull, toTimestampOrNull, buildCompanyIdentity, normalizeLegalInn, normalizeSourceKeyText } from './rf-source-runtime.mjs';
import { normalizeContextEventRecord, normalizeJobPostingRecord } from './rf-source-normalizers.mjs';
import { fetchJson, fetchText } from './source-http.mjs';
import { parseRssAtomFeed } from './feed-parser.mjs';
import { createGdeltDocClient } from './gdelt-doc-client.mjs';

const REQUEST_DELAY_MS = 450;
const ITEM_DELAY_MS = 200;

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function envInt(name, fallback, min, max) {
  return clampInteger(process.env[name], fallback, min, max);
}

function envList(name) {
  return parseCommaSeparated(process.env[name]);
}

function publicFetchOptions(sourceName) {
  return { sourceName, nodeHttpFallback: true };
}

function asyncJson(url, sourceName, options = {}) {
  return fetchJson(url, { ...publicFetchOptions(sourceName), ...options });
}

async function asyncText(url, sourceName, options = {}) {
  const fetched = await fetchText(url, { ...publicFetchOptions(sourceName), ...options });
  return typeof fetched === 'string' ? fetched : fetched?.body ?? '';
}

function epochSecondsToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function boundedCanonical(records, maxRecords) {
  return records.slice(0, maxRecords);
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : toNonEmptyText(item?.label ?? item?.name ?? item?.title)))
    .filter(Boolean);
}

/**
 * File mode: JSON array, {records: [...]}, or a multi-source smoke fixture
 * keyed by source id ({ "<source-id>": [canonical records...] }).
 */
function extractExpansionRecords(parsed, sourceId) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.records)) return parsed.records;
  if (sourceId && Array.isArray(parsed?.[sourceId])) return parsed[sourceId];
  return [];
}

function requireCompanyContextRecord(record) {
  // Context records must attribute to a named organization; otherwise the
  // generic normalizer would fall back to the publisher domain and merge
  // unrelated articles into one identity.
  return toNonEmptyText(record?.company_name) ? record : null;
}

// ---------------------------------------------------------------------------
// Custom normalizers (registry/market sources that do not fit the two generic
// record families).
// ---------------------------------------------------------------------------

export function normalizeRorOrganizationRecord(record, { fetchedAt, lineNumber, sourceId }) {
  const rorId = toNonEmptyText(record?.ror_id);
  const displayName = toNonEmptyText(record?.company_name);
  if (!rorId || !displayName) return null;
  const websiteUrl = toUrlOrNull(record?.company_website_url);
  const identity = buildCompanyIdentity({
    companyName: displayName,
    companyWebsiteUrl: websiteUrl,
    fallbackName: displayName,
    lineNumber,
  });
  if (!identity) return null;
  const aliases = Array.isArray(record?.aliases)
    ? record.aliases.map((value) => toNonEmptyText(value)).filter(Boolean).slice(0, 12)
    : [];
  return {
    ...identity,
    fetchedAt,
    occurredAt: toTimestampOrNull(record?.updated_at) ?? fetchedAt,
    companyName: displayName,
    companyWebsiteUrl: websiteUrl,
    inn: null,
    ogrn: null,
    orgExternalId: null,
    signalExternalId: `${sourceId}:${rorId}`,
    signalType: 'other',
    evidenceRole: 'enrichment',
    sourceRecordType: 'research_organization_reference',
    headline: displayName,
    recordTitle: displayName,
    sourceUrl: toUrlOrNull(record?.source_url) ?? rorId,
    summary: [displayName, record?.country_code ? `country: ${record.country_code}` : null, record?.status ? `status: ${record.status}` : null].filter(Boolean).join('; '),
    payload: {
      ror_id: rorId,
      aliases,
      country_code: toNonEmptyText(record?.country_code),
      established: toNonEmptyText(record?.established),
      status: toNonEmptyText(record?.status),
      organization_types: stringList(record?.types),
    },
    orgMetadata: {
      ror_id: rorId,
      aliases,
      country_code: toNonEmptyText(record?.country_code),
    },
  };
}

export function normalizeCbrFxSnapshotRecord(record, { fetchedAt, lineNumber, sourceId }) {
  const snapshotDate = toNonEmptyText(record?.snapshot_date);
  const rates = record?.rates && typeof record.rates === 'object' ? record.rates : null;
  if (!snapshotDate || !rates || Object.keys(rates).length === 0) return null;
  const publisherName = 'Bank of Russia';
  const websiteUrl = 'https://www.cbr.ru';
  const identity = buildCompanyIdentity({
    companyName: publisherName,
    companyWebsiteUrl: websiteUrl,
    fallbackName: publisherName,
    lineNumber,
  });
  if (!identity) return null;
  return {
    ...identity,
    fetchedAt,
    occurredAt: toTimestampOrNull(record?.snapshot_date_iso) ?? fetchedAt,
    companyName: publisherName,
    companyWebsiteUrl: websiteUrl,
    inn: null,
    ogrn: null,
    orgExternalId: null,
    signalExternalId: `${sourceId}:${snapshotDate}`,
    signalType: 'other',
    evidenceRole: 'context',
    sourceRecordType: 'fx_daily_snapshot',
    headline: `CBR daily FX snapshot ${snapshotDate}`,
    recordTitle: `CBR daily FX snapshot ${snapshotDate}`,
    sourceUrl: toUrlOrNull(record?.endpoint) ?? websiteUrl,
    summary: `Official CBR daily RUB reference rates snapshot for ${snapshotDate}; ${Object.keys(rates).length} currencies; mirror: ${record?.mirror === true ? 'yes' : 'no'}`,
    payload: {
      event_type: 'market_snapshot',
      base_currency: toNonEmptyText(record?.base_currency) ?? 'RUB',
      snapshot_date: snapshotDate,
      rates,
      mirror: record?.mirror === true,
      context_only: true,
    },
  };
}

const ROSTRUD_PUBLISHER_NAME = 'Федеральная служба по труду и занятости (Роструд)';

export function normalizeTrudvsemDatasetRecord(record, { fetchedAt, lineNumber, sourceId }) {
  const identifier = toNonEmptyText(record?.identifier);
  const title = toNonEmptyText(record?.title);
  if (!identifier || !title) return null;
  const inn = normalizeLegalInn(record?.publisher_inn);
  const identity = buildCompanyIdentity({
    companyName: ROSTRUD_PUBLISHER_NAME,
    companyWebsiteUrl: 'https://trudvsem.ru',
    inn,
    fallbackName: ROSTRUD_PUBLISHER_NAME,
    lineNumber,
  });
  if (!identity) return null;
  return {
    ...identity,
    fetchedAt,
    occurredAt: fetchedAt,
    companyName: ROSTRUD_PUBLISHER_NAME,
    companyWebsiteUrl: 'https://trudvsem.ru',
    inn,
    ogrn: null,
    orgExternalId: inn,
    signalExternalId: `${sourceId}:${identifier}`,
    signalType: 'other',
    evidenceRole: 'context',
    sourceRecordType: 'open_data_catalog_entry',
    headline: title,
    recordTitle: title,
    sourceUrl: toUrlOrNull(record?.link) ?? `https://opendata.trudvsem.ru/${identifier}`,
    summary: `${title}; dataset ${identifier}; format ${toNonEmptyText(record?.format) ?? 'xml'}`,
    payload: {
      event_type: 'open_data_catalog',
      identifier,
      format: toNonEmptyText(record?.format) ?? 'xml',
      catalog: toNonEmptyText(record?.catalog) ?? 'list.xml',
      context_only: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Live fetchers. Each returns canonical records ready for the family
// normalizer (the same shape file-mode fixtures use).
// ---------------------------------------------------------------------------

async function fetchThemuseLive() {
  const maxPages = envInt('THEMUSE_MAX_PAGES', 1, 1, 3);
  const maxRecords = envInt('THEMUSE_MAX_RECORDS', 50, 1, 200);
  const records = [];
  let pagesFetched = 0;
  for (let page = 1; page <= maxPages && records.length < maxRecords; page += 1) {
    if (page > 1) await delay(REQUEST_DELAY_MS);
    const body = await asyncJson(`https://www.themuse.com/api/public/jobs?page=${page}`, 'themuse jobs api');
    pagesFetched += 1;
    for (const item of body?.results ?? []) {
      records.push({
        external_id: toNonEmptyText(item?.id) ?? undefined,
        title: toNonEmptyText(item?.name),
        company_name: toNonEmptyText(item?.company?.name),
        location: stringList((item?.locations ?? []).map((entry) => entry?.name ?? entry)).join('; ') || undefined,
        published_at: toNonEmptyText(item?.publication_date),
        url: toNonEmptyText(item?.refs?.landing_page),
        tags: stringList(item?.tags),
        board: 'themuse',
      });
    }
  }
  return { records: boundedCanonical(records, maxRecords), pagesFetched, totalReported: undefined };
}

async function fetchLandingJobsLive() {
  const maxPages = envInt('LANDINGJOBS_MAX_PAGES', 1, 1, 3);
  const maxRecords = envInt('LANDINGJOBS_MAX_RECORDS', 50, 1, 200);
  const records = [];
  let pagesFetched = 0;
  for (let page = 1; page <= maxPages && records.length < maxRecords; page += 1) {
    if (page > 1) await delay(REQUEST_DELAY_MS);
    const body = await asyncJson(`https://landing.jobs/api/v1/jobs?page=${page}`, 'landing jobs api');
    pagesFetched += 1;
    const items = Array.isArray(body) ? body : body?.jobs ?? [];
    for (const item of items) {
      const url = toNonEmptyText(item?.url);
      let orgSlug = null;
      if (url) {
        try {
          const parts = new URL(url).pathname.split('/').filter(Boolean);
          if (parts[0] === 'at' && parts[1]) orgSlug = decodeURIComponent(parts[1]);
        } catch { /* keep null */ }
      }
      const companyName = toNonEmptyText(item?.organization ?? item?.company)
        ?? (orgSlug ? orgSlug.replaceAll('-', ' ').replaceAll(/\s+/g, ' ').trim() : null);
      records.push({
        external_id: toNonEmptyText(item?.id) ?? undefined,
        title: toNonEmptyText(item?.title),
        company_name: companyName,
        location: stringList((item?.locations ?? []).map((entry) => entry?.name ?? entry)).join('; ') || undefined,
        published_at: toNonEmptyText(item?.published_at ?? item?.created_at),
        url,
        tags: [...stringList(item?.tags), ...(item?.remote === true ? ['remote'] : [])],
        board: 'landingjobs',
      });
    }
  }
  return { records: boundedCanonical(records, maxRecords), pagesFetched };
}

async function fetchArbeitnowLive() {
  const maxPages = envInt('ARBEITNOW_MAX_PAGES', 1, 1, 3);
  const maxRecords = envInt('ARBEITNOW_MAX_RECORDS', 50, 1, 300);
  const records = [];
  let pagesFetched = 0;
  let url = 'https://www.arbeitnow.com/api/job-board-api';
  while (url && pagesFetched < maxPages && records.length < maxRecords) {
    if (pagesFetched > 0) await delay(REQUEST_DELAY_MS);
    const body = await asyncJson(url, 'arbeitnow job board api');
    pagesFetched += 1;
    for (const item of body?.data ?? []) {
      records.push({
        external_id: toNonEmptyText(item?.slug) ?? toNonEmptyText(item?.uuid) ?? undefined,
        title: toNonEmptyText(item?.title),
        company_name: toNonEmptyText(item?.company_name),
        location: toNonEmptyText(item?.location),
        published_at: epochSecondsToIso(item?.created_at),
        url: toNonEmptyText(item?.url) ?? (item?.slug ? `https://www.arbeitnow.com/view/${item.slug}` : undefined),
        tags: [...stringList(item?.tags), ...stringList(item?.job_types), ...(item?.remote === true ? ['remote'] : [])],
        board: 'arbeitnow',
      });
    }
    url = typeof body?.next_page === 'string' && body.next_page.startsWith('http') ? body.next_page : null;
  }
  return { records: boundedCanonical(records, maxRecords), pagesFetched };
}

async function fetchRemoteokLive() {
  const maxRecords = envInt('REMOTEOK_MAX_RECORDS', 50, 1, 100);
  const body = await asyncJson('https://remoteok.com/api', 'remoteok api');
  const items = Array.isArray(body) ? body.slice(1) : [];
  const records = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.legal) continue;
    records.push({
      external_id: toNonEmptyText(item?.id) ?? undefined,
      title: toNonEmptyText(item?.position),
      company_name: toNonEmptyText(item?.company),
      location: toNonEmptyText(item?.location),
      published_at: toNonEmptyText(item?.date) ?? epochSecondsToIso(item?.epoch),
      // RemoteOK API terms require a follow backlink to the RemoteOK listing
      // URL and source attribution; the listing URL is kept as source_url and
      // the board field credits RemoteOK.
      url: toNonEmptyText(item?.url),
      tags: [...stringList(item?.tags), 'remote'],
      board: 'remoteok',
    });
  }
  return { records: boundedCanonical(records, maxRecords), pagesFetched: 1 };
}

async function fetchJobicyLive() {
  const count = envInt('JOBICY_COUNT', 25, 1, 50);
  const maxRecords = envInt('JOBICY_MAX_RECORDS', 50, 1, 100);
  const body = await asyncJson(`https://jobicy.com/api/v2/remote-jobs?count=${count}`, 'jobicy api');
  const records = [];
  for (const item of body?.jobs ?? []) {
    records.push({
      external_id: toNonEmptyText(item?.id) ?? undefined,
      title: toNonEmptyText(item?.jobTitle),
      company_name: toNonEmptyText(item?.companyName),
      location: toNonEmptyText(item?.jobGeo),
      published_at: toNonEmptyText(item?.pubDate),
      // Jobicy API terms require credit and a link to the original listing;
      // the listing URL is kept as source_url and the board field credits it.
      url: toNonEmptyText(item?.url),
      tags: [item?.jobIndustry, item?.jobType, item?.jobLevel].map((value) => toNonEmptyText(value)).filter(Boolean).concat('remote'),
      board: 'jobicy',
    });
  }
  return { records: boundedCanonical(records, maxRecords), pagesFetched: 1, totalReported: body?.jobCount };
}

async function fetchHimalayasLive() {
  const limit = envInt('HIMALAYAS_LIMIT', 20, 1, 50);
  const maxRecords = envInt('HIMALAYAS_MAX_RECORDS', 50, 1, 100);
  const body = await asyncJson(`https://himalayas.app/jobs/api?limit=${limit}`, 'himalayas jobs api');
  const records = [];
  for (const item of body?.jobs ?? []) {
    records.push({
      external_id: toNonEmptyText(item?.guid) ?? toNonEmptyText(item?.slug) ?? undefined,
      title: toNonEmptyText(item?.title),
      company_name: toNonEmptyText(item?.companyName),
      location: stringList(item?.locationRestrictions).join('; ') || undefined,
      published_at: toNonEmptyText(item?.pubDate),
      url: toNonEmptyText(item?.applicationLink) ?? (item?.slug ? `https://himalayas.app/jobs/${item.slug}` : undefined),
      tags: [item?.employmentType, item?.seniority].map((value) => toNonEmptyText(value)).filter(Boolean).concat(stringList(item?.categories), 'remote'),
      board: 'himalayas',
    });
  }
  return { records: boundedCanonical(records, maxRecords), pagesFetched: 1, totalReported: body?.totalCount };
}

async function fetchRemotiveLive() {
  const limit = envInt('REMOTIVE_LIMIT', 25, 1, 100);
  const body = await asyncJson(`https://remotive.com/api/remote-jobs?limit=${limit}`, 'remotive api');
  const records = [];
  for (const item of body?.jobs ?? []) {
    records.push({
      external_id: toNonEmptyText(item?.id) ?? undefined,
      title: toNonEmptyText(item?.title),
      company_name: toNonEmptyText(item?.company_name),
      location: toNonEmptyText(item?.candidate_required_location),
      published_at: toNonEmptyText(item?.publication_date),
      url: toNonEmptyText(item?.url),
      tags: [item?.category, item?.job_type].map((value) => toNonEmptyText(value)).filter(Boolean).concat(stringList(item?.tags), 'remote'),
      board: 'remotive',
    });
  }
  return { records: boundedCanonical(records, limit), pagesFetched: 1, totalReported: body?.['job-count'] };
}

const WEWORKREMOTELY_DEFAULT_CATEGORIES = ['remote-programming-jobs'];

async function fetchWeworkRemotelyLive() {
  const requested = envList('WEWORKREMOTELY_CATEGORIES');
  const categories = (requested.length > 0 ? requested : WEWORKREMOTELY_DEFAULT_CATEGORIES)
    .map((value) => value.replaceAll('/', '').replaceAll('..', ''))
    .filter((value) => /^[a-z0-9-]+$/i.test(value))
    .slice(0, 3);
  const maxItems = envInt('WEWORKREMOTELY_MAX_ITEMS', 25, 1, 100);
  const records = [];
  let feedsFetched = 0;
  for (const category of categories) {
    if (feedsFetched > 0) await delay(REQUEST_DELAY_MS);
    const feedUrl = `https://weworkremotely.com/categories/${category}.rss`;
    const xml = await asyncText(feedUrl, 'weworkremotely rss');
    feedsFetched += 1;
    for (const item of parseRssAtomFeed(xml, feedUrl, { maxItems })) {
      const separatorIndex = item.title.indexOf(':');
      const companyName = separatorIndex > 0 ? item.title.slice(0, separatorIndex).trim() : null;
      const position = separatorIndex > 0 ? item.title.slice(separatorIndex + 1).trim() : item.title;
      if (!companyName) continue;
      records.push({
        external_id: toNonEmptyText(item.externalId),
        title: position,
        company_name: companyName,
        published_at: item.publishedAt,
        url: item.url,
        tags: ['remote', `wwr-category:${category}`],
        board: 'weworkremotely',
      });
    }
  }
  return { records: boundedCanonical(records, maxItems), pagesFetched: feedsFetched };
}

async function fetchHackerNewsJobsLive() {
  const maxItems = envInt('HACKERNEWS_JOBS_MAX_ITEMS', 10, 1, 25);
  const ids = await asyncJson('https://hacker-news.firebaseio.com/v0/jobstories.json', 'hacker news job stories');
  const records = [];
  const list = Array.isArray(ids) ? ids.slice(0, maxItems) : [];
  for (const id of list) {
    if (records.length > 0) await delay(ITEM_DELAY_MS);
    const item = await asyncJson(`https://hacker-news.firebaseio.com/v0/item/${Number(id)}.json`, 'hacker news job story item');
    if (!item || item.type !== 'job') continue;
    const title = toNonEmptyText(item.title) ?? '';
    const match = title.match(/^(.*?)(?:\s*\(YC[^)]*\))?\s+Is Hiring(?:\s+(.*))?$/i);
    const companyName = match ? toNonEmptyText(match[1]) : null;
    if (!companyName) continue;
    records.push({
      external_id: toNonEmptyText(item.id),
      title: toNonEmptyText(match?.[2]) ?? title,
      company_name: companyName,
      published_at: epochSecondsToIso(item.time),
      // The item URL is the posting/company page, but it is often a
      // third-party host (ycombinator.com, framer.website, ...), so it is
      // kept as source_url only and never used for org domain identity.
      url: toUrlOrNull(item.url) ?? `https://news.ycombinator.com/item?id=${Number(item.id)}`,
      tags: [...(title.match(/\(YC[^)]*\)/) ? [title.match(/\(YC[^)]*\)/)[0].slice(1, -1).toLowerCase()] : []), 'hn-jobs'],
      board: 'hackernews-jobs',
    });
  }
  return { records, pagesFetched: 1 + records.length, totalReported: Array.isArray(ids) ? ids.length : undefined };
}

async function fetchHnAlgoliaLive() {
  const queries = envList('HN_ALGOLIA_QUERIES').slice(0, 10);
  if (queries.length === 0) return { records: [], zeroReason: 'no-configured-queries' };
  const hitsPerQuery = envInt('HN_ALGOLIA_HITS_PER_QUERY', 5, 1, 20);
  const records = [];
  for (const [index, query] of queries.entries()) {
    if (index > 0) await delay(REQUEST_DELAY_MS);
    const body = await asyncJson(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${hitsPerQuery}`,
      'hn algolia search api',
    );
    for (const hit of body?.hits ?? []) {
      const title = toNonEmptyText(hit?.title) ?? '';
      const url = toUrlOrNull(hit?.url);
      const phrase = query.toLowerCase();
      const matched = title.toLowerCase().includes(phrase) || (url ? url.toLowerCase().includes(phrase) : false);
      if (!matched) continue;
      records.push({
        company_name: query,
        external_id: toNonEmptyText(hit?.objectID),
        headline: title,
        source_url: url ?? `https://news.ycombinator.com/item?id=${toNonEmptyText(hit?.objectID) ?? ''}`,
        published_at: toNonEmptyText(hit?.created_at),
        publisher: 'hn.algolia.com',
        event_type: 'hiring_context',
        summary: `Hacker News story about ${query}; points ${hit?.points ?? 0}; comments ${hit?.num_comments ?? 0}`,
        extraction_method: 'org-name-query-match',
      });
    }
  }
  return { records, queriesRequested: queries.length };
}

async function fetchDevtoLive() {
  const tag = toNonEmptyText(process.env.DEVTO_ARTICLE_TAGS?.split(',')[0]) ?? 'hiring';
  const perPage = envInt('DEVTO_PER_PAGE', 20, 1, 30);
  const body = await asyncJson(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=${perPage}`, 'dev.to articles api');
  const records = [];
  for (const item of Array.isArray(body) ? body : []) {
    const orgName = toNonEmptyText(item?.organization?.name ?? item?.organization?.username);
    if (!orgName) continue;
    records.push({
      company_name: orgName,
      company_website_url: toUrlOrNull(item?.organization?.website_url),
      external_id: toNonEmptyText(item?.id),
      headline: toNonEmptyText(item?.title),
      source_url: toUrlOrNull(item?.url),
      published_at: toNonEmptyText(item?.published_at),
      publisher: 'dev.to',
      event_type: 'engineering_hiring_content',
      summary: `dev.to #${tag} article by organization ${orgName}`,
      extraction_method: 'org-tagged-article',
    });
  }
  return { records, pagesFetched: 1 };
}

function parseGdeltContextQueries() {
  const rawJson = process.env.GDELT_CONTEXT_QUERIES_JSON?.trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    const queries = Array.isArray(parsed) ? parsed : parsed?.queries;
    if (!Array.isArray(queries)) {
      throw new Error('GDELT_CONTEXT_QUERIES_JSON must be a JSON array or {"queries": [...]} object.');
    }
    return queries.map((entry) => normalizeGdeltContextQuery(entry));
  }
  return parseCommaSeparated(process.env.GDELT_CONTEXT_QUERIES)
    .map((entry) => normalizeGdeltContextQuery(entry));
}

function normalizeGdeltContextQuery(value) {
  const query = typeof value === 'string' ? value.trim() : toNonEmptyText(value?.query);
  if (!query) throw new Error('GDELT context query must have a non-empty query.');
  return {
    query,
    companyName: (typeof value === 'object' ? toNonEmptyText(value?.companyName ?? value?.company_name) : null) ?? query,
    companyDomain: typeof value === 'object' ? toNonEmptyText(value?.companyDomain ?? value?.company_domain) : null,
    maxRecords: clampInteger(typeof value === 'object' ? value?.maxRecords ?? value?.max_records : process.env.GDELT_CONTEXT_MAX_RECORDS, 10, 1, 100),
    timespan: (typeof value === 'object' ? toNonEmptyText(value?.timespan) : null) ?? toNonEmptyText(process.env.GDELT_CONTEXT_TIMESPAN) ?? '30d',
  };
}

let gdeltContextClient = null;

async function fetchGdeltContextLive() {
  const queries = parseGdeltContextQueries().slice(0, 10);
  if (queries.length === 0) return { records: [], zeroReason: 'no-configured-queries' };
  gdeltContextClient ??= createGdeltDocClient({
    cachePath: process.env.GDELT_CONTEXT_GDELT_CACHE_FILE ?? 'packages/db/scripts/.cache/gdelt-context-doc-api.json',
    minIntervalMs: clampInteger(process.env.GDELT_CONTEXT_GDELT_MIN_INTERVAL_MS, 5000, 5000, 60000),
  });
  const records = [];
  for (const [index, queryConfig] of queries.entries()) {
    if (index > 0) await delay(REQUEST_DELAY_MS);
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.searchParams.set('query', queryConfig.query);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(queryConfig.maxRecords));
    url.searchParams.set('timespan', queryConfig.timespan);
    url.searchParams.set('sort', 'datedesc');
    const fetched = await gdeltContextClient.request(url, { timeoutMs: 60000 });
    for (const article of fetched?.body?.articles ?? []) {
      const title = toNonEmptyText(article?.title);
      const articleUrl = toUrlOrNull(article?.url);
      if (!title || !articleUrl) continue;
      records.push({
        company_name: queryConfig.companyName,
        company_domain: queryConfig.companyDomain ?? undefined,
        external_id: articleUrl,
        headline: title,
        source_url: articleUrl,
        published_at: toNonEmptyText(article?.seendate),
        publisher: toNonEmptyText(article?.domain),
        event_type: 'hiring_context',
        summary: toNonEmptyText(article?.title),
        extraction_method: 'gdelt-doc-query',
      });
    }
  }
  return { records, queriesRequested: queries.length };
}

async function fetchOpenAlexLive() {
  const terms = envList('OPENALEX_SEARCH_TERMS').slice(0, 10);
  if (terms.length === 0) return { records: [], zeroReason: 'no-configured-terms' };
  const perTerm = envInt('OPENALEX_PER_TERM', 5, 1, 25);
  const mailto = toNonEmptyText(process.env.OPENALEX_MAILTO);
  const records = [];
  for (const [index, term] of terms.entries()) {
    if (index > 0) await delay(REQUEST_DELAY_MS);
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', term);
    url.searchParams.set('per-page', String(perTerm));
    if (mailto) url.searchParams.set('mailto', mailto);
    const body = await asyncJson(url.toString(), 'openalex works api');
    for (const work of body?.results ?? []) {
      const institutions = (work?.authorships ?? []).flatMap((authorship) => authorship?.institutions ?? []);
      const lowerTerm = term.toLowerCase();
      const institution = institutions.find((entry) => toNonEmptyText(entry?.display_name)?.toLowerCase().includes(lowerTerm))
        ?? institutions[0];
      const institutionName = toNonEmptyText(institution?.display_name);
      if (!institutionName) continue;
      records.push({
        company_name: institutionName,
        external_id: toNonEmptyText(work?.id),
        headline: toNonEmptyText(work?.display_name),
        source_url: toUrlOrNull(work?.doi) ?? toUrlOrNull(work?.id),
        published_at: toNonEmptyText(work?.publication_date),
        publisher: 'openalex.org',
        event_type: 'research_output',
        category: toNonEmptyText(institution?.ror),
        summary: `OpenAlex work for search term "${term}"; cited_by_count ${work?.cited_by_count ?? 0}`,
        extraction_method: 'work-institution-match',
      });
    }
  }
  return { records, queriesRequested: terms.length };
}

async function fetchRorLive() {
  const names = envList('ROR_ORGANIZATIONS').slice(0, 10);
  if (names.length === 0) return { records: [], zeroReason: 'no-configured-organizations' };
  const perQuery = envInt('ROR_PER_QUERY', 5, 1, 20);
  const records = [];
  for (const [index, name] of names.entries()) {
    if (index > 0) await delay(REQUEST_DELAY_MS);
    const url = new URL('https://api.ror.org/v2/organizations');
    url.searchParams.set('query', name);
    const body = await asyncJson(url.toString(), 'ror organizations api v2');
    const items = body?.items ?? [];
    for (const item of items.slice(0, perQuery)) {
      const displayName = (item?.names ?? []).find((entry) => entry?.types?.includes('ror_display'))?.value
        ?? (item?.names ?? []).find((entry) => toNonEmptyText(entry?.value))?.value;
      const website = (item?.links ?? []).find((link) => link?.type === 'website' && toNonEmptyText(link?.value))?.value;
      records.push({
        company_name: toNonEmptyText(displayName),
        company_website_url: toUrlOrNull(website),
        ror_id: toNonEmptyText(item?.id),
        country_code: toNonEmptyText(item?.country_code),
        established: item?.established != null ? String(item.established) : null,
        status: toNonEmptyText(item?.status),
        types: (item?.types ?? []).map((entry) => toNonEmptyText(entry)).filter(Boolean),
        aliases: (item?.names ?? []).map((entry) => toNonEmptyText(entry?.value)).filter(Boolean),
        source_url: toNonEmptyText(item?.id),
        updated_at: toNonEmptyText(item?.admin?.last_modified?.date),
      });
    }
  }
  return { records, queriesRequested: names.length };
}

const CBR_FX_OFFICIAL_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
const CBR_FX_MIRROR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

export function parseCbrFxMirrorJson(body, endpoint) {
  const dateIso = toNonEmptyText(body?.Date);
  const valute = body?.Valute ?? {};
  const rates = {};
  for (const [code, entry] of Object.entries(valute)) {
    const value = Number(entry?.Value);
    const nominal = Number(entry?.Nominal);
    if (Number.isFinite(value) && Number.isFinite(nominal) && nominal > 0) {
      rates[toNonEmptyText(entry?.CharCode) ?? code] = { nominal, value };
    }
  }
  if (!dateIso || Object.keys(rates).length === 0) return null;
  return {
    snapshot_date: dateIso.slice(0, 10),
    snapshot_date_iso: dateIso,
    base_currency: 'RUB',
    rates,
    endpoint,
    mirror: true,
  };
}

export function parseCbrFxOfficialXml(xml, endpoint) {
  const dateMatch = String(xml).match(/<ValCurs[^>]*Date="([^"]+)"/i);
  const rates = {};
  for (const block of String(xml).matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/gi)) {
    const charCode = block[1].match(/<CharCode>([\s\S]*?)<\/CharCode>/i)?.[1]?.trim();
    const nominal = Number(block[1].match(/<Nominal>([\s\S]*?)<\/Nominal>/i)?.[1]?.trim());
    const rawValue = block[1].match(/<Value>([\s\S]*?)<\/Value>/i)?.[1]?.trim().replace(',', '.');
    const value = Number(rawValue);
    if (charCode && Number.isFinite(nominal) && Number.isFinite(value)) {
      rates[charCode] = { nominal, value };
    }
  }
  if (Object.keys(rates).length === 0) return null;
  const snapshotIso = dateMatch ? new Date(dateMatch[1]).toISOString() : null;
  return {
    snapshot_date: snapshotIso ? snapshotIso.slice(0, 10) : new Date().toISOString().slice(0, 10),
    snapshot_date_iso: snapshotIso,
    base_currency: 'RUB',
    rates,
    endpoint,
    mirror: false,
  };
}

async function fetchCbrFxDailyLive() {
  const endpoint = toNonEmptyText(process.env.CBR_FX_DAILY_API_URL) ?? CBR_FX_OFFICIAL_URL;
  const body = await asyncText(endpoint, 'cbr fx daily endpoint');
  const trimmed = body.trim();
  const snapshot = trimmed.startsWith('{')
    ? parseCbrFxMirrorJson(JSON.parse(trimmed), endpoint)
    : parseCbrFxOfficialXml(trimmed, endpoint);
  if (!snapshot) return { records: [], zeroReason: 'empty-rate-payload', liveProvider: endpoint };
  return { records: [snapshot], pagesFetched: 1, liveProvider: endpoint };
}

async function fetchTrudvsemDatasetsLive() {
  const endpoint = toNonEmptyText(process.env.TRUDVSEM_DATASETS_CATALOG_URL) ?? 'https://opendata.trudvsem.ru/list.xml';
  const xml = await asyncText(endpoint, 'trudvsem open data catalog');
  const records = [];
  for (const block of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const identifier = block[1].match(/<identifier>([\s\S]*?)<\/identifier>/i)?.[1]?.trim();
    const title = block[1].match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const link = block[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    const format = block[1].match(/<format>([\s\S]*?)<\/format>/i)?.[1]?.trim();
    if (!identifier || !title) continue;
    const innMatch = identifier.match(/^(\d{10})-/);
    records.push({
      identifier,
      title,
      link: toNonEmptyText(link),
      format: toNonEmptyText(format) ?? 'xml',
      publisher_inn: innMatch ? innMatch[1] : null,
      catalog: endpoint,
    });
  }
  return { records, pagesFetched: 1, liveProvider: endpoint };
}

// ---------------------------------------------------------------------------
// Spec catalog
// ---------------------------------------------------------------------------

const JOB_BOARD_BASE = Object.freeze({
  signalType: 'job_posting',
  evidenceRole: 'primary_platform',
  sourceRecordType: 'job_posting',
  family: 'job-board',
});

const CONTEXT_BASE = Object.freeze({
  signalType: 'other',
  evidenceRole: 'context',
  family: 'context',
});

export const PUBLIC_EXPANSION_SPECS = Object.freeze({
  themuse: {
    ...JOB_BOARD_BASE,
    displayName: 'The Muse',
    inputFileEnvName: 'THEMUSE_INPUT_FILE',
    usageText: 'Set THEMUSE_INPUT_FILE for reviewed file mode, or run without it for live-public The Muse jobs API mode (THEMUSE_MAX_PAGES/THEMUSE_MAX_RECORDS bound the fetch).',
    fetchLive: fetchThemuseLive,
    liveProvider: 'themuse-public-jobs-api',
  },
  landingjobs: {
    ...JOB_BOARD_BASE,
    displayName: 'Landing Jobs',
    inputFileEnvName: 'LANDINGJOBS_INPUT_FILE',
    usageText: 'Set LANDINGJOBS_INPUT_FILE for reviewed file mode, or run without it for live-public Landing Jobs API mode (LANDINGJOBS_MAX_PAGES/LANDINGJOBS_MAX_RECORDS bound the fetch).',
    fetchLive: fetchLandingJobsLive,
    liveProvider: 'landing-jobs-public-api',
  },
  arbeitnow: {
    ...JOB_BOARD_BASE,
    displayName: 'Arbeitnow',
    inputFileEnvName: 'ARBEITNOW_INPUT_FILE',
    usageText: 'Set ARBEITNOW_INPUT_FILE for reviewed file mode, or run without it for live-public Arbeitnow job board API mode (ARBEITNOW_MAX_PAGES/ARBEITNOW_MAX_RECORDS bound the fetch).',
    fetchLive: fetchArbeitnowLive,
    liveProvider: 'arbeitnow-job-board-api',
  },
  remoteok: {
    ...JOB_BOARD_BASE,
    displayName: 'RemoteOK',
    inputFileEnvName: 'REMOTEOK_INPUT_FILE',
    usageText: 'Set REMOTEOK_INPUT_FILE for reviewed file mode, or run without it for live-public RemoteOK API mode (REMOTEOK_MAX_RECORDS bounds the fetch). RemoteOK terms require a follow backlink to the listing URL; the adapter keeps the RemoteOK listing URL as source_url and credits the board.',
    fetchLive: fetchRemoteokLive,
    liveProvider: 'remoteok-public-api',
  },
  jobicy: {
    ...JOB_BOARD_BASE,
    displayName: 'Jobicy',
    inputFileEnvName: 'JOBICY_INPUT_FILE',
    usageText: 'Set JOBICY_INPUT_FILE for reviewed file mode, or run without it for live-public Jobicy API v2 mode (JOBICY_COUNT/JOBICY_MAX_RECORDS bound the fetch). Jobicy terms require credit and a link to the original listing; both are preserved.',
    fetchLive: fetchJobicyLive,
    liveProvider: 'jobicy-api-v2',
  },
  himalayas: {
    ...JOB_BOARD_BASE,
    displayName: 'Himalayas',
    inputFileEnvName: 'HIMALAYAS_INPUT_FILE',
    usageText: 'Set HIMALAYAS_INPUT_FILE for reviewed file mode, or run without it for live-public Himalayas jobs API mode (HIMALAYAS_LIMIT/HIMALAYAS_MAX_RECORDS bound the fetch).',
    fetchLive: fetchHimalayasLive,
    liveProvider: 'himalayas-jobs-api',
  },
  remotive: {
    ...JOB_BOARD_BASE,
    displayName: 'Remotive',
    inputFileEnvName: 'REMOTIVE_INPUT_FILE',
    usageText: 'Set REMOTIVE_INPUT_FILE for reviewed file mode, or run without it for live-public Remotive API mode (REMOTIVE_LIMIT bounds the fetch).',
    fetchLive: fetchRemotiveLive,
    liveProvider: 'remotive-public-api',
  },
  weworkremotely: {
    ...JOB_BOARD_BASE,
    displayName: 'We Work Remotely',
    inputFileEnvName: 'WEWORKREMOTELY_INPUT_FILE',
    usageText: 'Set WEWORKREMOTELY_INPUT_FILE for reviewed file mode, or run without it for live-public WWR category RSS mode (WEWORKREMOTELY_CATEGORIES/WEWORKREMOTELY_MAX_ITEMS bound the fetch).',
    fetchLive: fetchWeworkRemotelyLive,
    liveProvider: 'weworkremotely-category-rss',
  },
  'hackernews-jobs': {
    ...JOB_BOARD_BASE,
    displayName: 'Hacker News job stories',
    inputFileEnvName: 'HACKERNEWS_JOBS_INPUT_FILE',
    usageText: 'Set HACKERNEWS_JOBS_INPUT_FILE for reviewed file mode, or run without it for live-public Hacker News Firebase job stories mode (HACKERNEWS_JOBS_MAX_ITEMS bounds the fetch).',
    fetchLive: fetchHackerNewsJobsLive,
    liveProvider: 'hacker-news-firebase-jobstories',
  },
  'hn-algolia': {
    ...CONTEXT_BASE,
    sourceRecordType: 'hiring_context_story',
    displayName: 'Hacker News (Algolia search)',
    inputFileEnvName: 'HN_ALGOLIA_INPUT_FILE',
    usageText: 'Set HN_ALGOLIA_INPUT_FILE for reviewed file mode, or set HN_ALGOLIA_QUERIES (comma-separated organization names) for live-public Algolia search mode. Without queries the live run is an expected-zero no-op.',
    fetchLive: fetchHnAlgoliaLive,
    liveProvider: 'hn-algolia-search-api',
    requireCompanyName: true,
  },
  devto: {
    ...CONTEXT_BASE,
    sourceRecordType: 'engineering_hiring_article',
    displayName: 'DEV Community articles',
    inputFileEnvName: 'DEVTO_INPUT_FILE',
    usageText: 'Set DEVTO_INPUT_FILE for reviewed file mode, or run without it for live-public dev.to articles API mode (DEVTO_ARTICLE_TAGS default hiring, DEVTO_PER_PAGE bounds the fetch). Only articles with an organization attribution are kept.',
    fetchLive: fetchDevtoLive,
    liveProvider: 'devto-articles-api',
    requireCompanyName: true,
  },
  'gdelt-context': {
    ...CONTEXT_BASE,
    sourceRecordType: 'hiring_context_article',
    displayName: 'GDELT context news',
    inputFileEnvName: 'GDELT_CONTEXT_INPUT_FILE',
    usageText: 'Set GDELT_CONTEXT_INPUT_FILE for reviewed file mode, or set GDELT_CONTEXT_QUERIES / GDELT_CONTEXT_QUERIES_JSON (same convention as funding-business-signals) for live-public GDELT DOC API mode. Without queries the live run is an expected-zero no-op.',
    fetchLive: fetchGdeltContextLive,
    liveProvider: 'gdelt-doc-api',
    requireCompanyName: true,
  },
  openalex: {
    ...CONTEXT_BASE,
    sourceRecordType: 'research_work',
    displayName: 'OpenAlex research works',
    inputFileEnvName: 'OPENALEX_INPUT_FILE',
    usageText: 'Set OPENALEX_INPUT_FILE for reviewed file mode, or set OPENALEX_SEARCH_TERMS (comma-separated) for live-public OpenAlex works API mode. Without terms the live run is an expected-zero no-op.',
    fetchLive: fetchOpenAlexLive,
    liveProvider: 'openalex-works-api',
    requireCompanyName: true,
  },
  ror: {
    ...CONTEXT_BASE,
    evidenceRole: 'enrichment',
    sourceRecordType: 'research_organization_reference',
    displayName: 'ROR organization registry',
    inputFileEnvName: 'ROR_INPUT_FILE',
    usageText: 'Set ROR_INPUT_FILE for reviewed file mode, or set ROR_ORGANIZATIONS (comma-separated names) for live-public ROR v2 API mode. Without names the live run is an expected-zero no-op.',
    fetchLive: fetchRorLive,
    liveProvider: 'ror-organizations-api-v2',
    normalize: normalizeRorOrganizationRecord,
  },
  'cbr-fx-daily': {
    ...CONTEXT_BASE,
    sourceRecordType: 'fx_daily_snapshot',
    displayName: 'CBR daily FX reference rates',
    inputFileEnvName: 'CBR_FX_DAILY_INPUT_FILE',
    usageText: 'Set CBR_FX_DAILY_INPUT_FILE for reviewed file mode, or run live-public mode against the official CBR endpoint (default https://www.cbr.ru/scripts/XML_daily.asp). CBR_FX_DAILY_API_URL may point at the documented public mirror (https://www.cbr-xml-daily.ru/daily_json.js) when the official endpoint is unreachable from the runtime network.',
    fetchLive: fetchCbrFxDailyLive,
    liveProvider: 'cbr-daily-fx-endpoint',
    normalize: normalizeCbrFxSnapshotRecord,
  },
  'trudvsem-opendata-datasets': {
    ...CONTEXT_BASE,
    sourceRecordType: 'open_data_catalog_entry',
    displayName: 'Rabota Rossii open data catalog',
    inputFileEnvName: 'TRUDVSEM_DATASETS_INPUT_FILE',
    usageText: 'Set TRUDVSEM_DATASETS_INPUT_FILE for reviewed file mode, or run without it for live-public mode against the official opendata.trudvsem.ru list.xml catalog (standard RF open data 3.0 registry). TRUDVSEM_DATASETS_CATALOG_URL overrides the catalog endpoint.',
    fetchLive: fetchTrudvsemDatasetsLive,
    liveProvider: 'trudvsem-opendata-list-xml',
    normalize: normalizeTrudvsemDatasetRecord,
  },
});

export const PUBLIC_EXPANSION_SOURCE_IDS = Object.freeze(Object.keys(PUBLIC_EXPANSION_SPECS));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function requireCompanyJobRecord(record) {
  // Job-board records must carry an explicit employer and a posting URL.
  // Inferring identity from the posting URL domain would merge unrelated
  // postings under the board's own domain (ycombinator.com, remoteok.com,
  // ...), and a posting without a link has no source evidence.
  const companyName = toNonEmptyText(
    record?.company_name
    ?? (typeof record?.company === 'string' ? record.company : record?.company?.name),
  );
  const postingUrl = toUrlOrNull(record?.job_posting_url ?? record?.job_url ?? record?.url ?? record?.link);
  return companyName && postingUrl ? record : null;
}

function makeNormalizer(spec) {
  if (typeof spec.normalize === 'function') return spec.normalize;
  if (spec.family === 'job-board') {
    return (record, meta) => {
      const candidate = requireCompanyJobRecord(record);
      if (!candidate) return null;
      return normalizeJobPostingRecord(candidate, meta, { defaultBoard: spec.displayName });
    };
  }
  const contextNormalizer = (record, meta) => {
    const candidate = spec.requireCompanyName ? requireCompanyContextRecord(record) : record;
    if (!candidate) return null;
    return normalizeContextEventRecord(candidate, meta, {
      sourceRecordType: spec.sourceRecordType,
      defaultEventType: 'context_event',
      contextOnly: true,
    });
  };
  return contextNormalizer;
}

export function createPublicExpansionSource(sourceId) {
  const spec = PUBLIC_EXPANSION_SPECS[sourceId];
  if (!spec) {
    throw new Error(`Unknown public expansion source: ${sourceId}`);
  }

  const runtime = createStandardSourceRuntime({
    sourceId,
    scriptName: `packages/db/scripts/source-${sourceId}.mjs`,
    signalType: spec.signalType,
    evidenceRole: spec.evidenceRole,
    sourceRecordType: spec.sourceRecordType,
    inputFileEnvName: spec.inputFileEnvName,
    usageText: spec.usageText,
    extractRecords: (parsed) => extractExpansionRecords(parsed, sourceId),
    normalizeRecord: makeNormalizer(spec),
    buildSummaryExtras: (input) => ({
      liveProvider: input.liveProvider ?? undefined,
      queriesRequested: input.queriesRequested ?? undefined,
      pagesFetched: input.pagesFetched ?? undefined,
      totalReported: input.totalReported ?? undefined,
      zeroReason: input.zeroReason ?? undefined,
    }),
  });

  async function resolveInput() {
    const inputFilePath = process.env[spec.inputFileEnvName]?.trim();
    if (inputFilePath) {
      return runtime.resolveFileInput(inputFilePath);
    }
    const live = await spec.fetchLive();
    return runtime.buildInputFromRecords({
      inputMode: live.zeroReason ? 'expected-zero' : 'live-public',
      inputFilePath: null,
      records: live.records,
      extra: {
        liveProvider: live.liveProvider ?? spec.liveProvider,
        queriesRequested: live.queriesRequested,
        pagesFetched: live.pagesFetched,
        totalReported: live.totalReported,
        zeroReason: live.zeroReason,
      },
    });
  }

  return {
    spec,
    runtime,
    resolveInput,
    resolveConfiguredInput: resolveInput,
    buildFetchSummary: runtime.buildFetchSummary,
    async runCli(argv = process.argv.slice(2)) {
      await runtime.runCli(argv, resolveInput);
    },
  };
}

export { CBR_FX_OFFICIAL_URL, CBR_FX_MIRROR_URL, ROSTRUD_PUBLISHER_NAME };
