import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildRfJobQuality,
} from './adapters/rf-source-normalizers.mjs';
import {
  buildCompanyIdentity,
  clampInteger,
  createStandardSourceRuntime,
  normalizeDomain,
  normalizeLegalInn,
  normalizeLegalOgrn,
  parseCommaSeparated,
  toNonEmptyText,
  toTimestampOrNull,
  toUrlOrNull,
} from './adapters/rf-source-runtime.mjs';
import { runScriptCli } from './lib/common-utils.mjs';
import { fetchJson } from './adapters/source-http.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'rabota-rossii';
const API_URL = 'https://opendata.trudvsem.ru/api/v1/vacancies';
// trudvsem open-data caps a single response at 100 records but exposes the full
// match count via meta.total (often thousands). One page therefore surfaces a
// tiny slice of the available hiring signal, so we page through up to
// RABOTA_ROSSII_PAGES windows of `limit` records each, advancing the offset and
// stopping early once meta.total is exhausted or the API returns an empty page.
const DEFAULT_PAGES = 5;
const MAX_PAGES = 50;


const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'job_posting',
  evidenceRole: 'primary_platform',
  sourceRecordType: 'job_posting',
  inputFileEnvName: 'RABOTA_ROSSII_INPUT_FILE',
  usageText: 'Input: set RABOTA_ROSSII_INPUT_FILE or RABOTA_ROSSII_SEARCH_TEXT.',
  extractRecords: extractRabotaRossiiRecords,
  normalizeRecord: normalizeRabotaRossiiRecord,
  buildSummaryExtras: (input) => input.inputMode === 'live-public'
    ? {
      liveProvider: input.liveProvider,
      searchText: input.searchText,
      offset: input.offset,
      limit: input.limit,
      pages: input.pages,
      pagesFetched: input.pagesFetched,
      regionsFetched: input.regionsFetched,
      apiTotal: input.apiTotal,
    }
    : {},
});

export function resolveRabotaRossiiInput() {
  const inputFilePath = process.env.RABOTA_ROSSII_INPUT_FILE?.trim();

  if (inputFilePath) {
    return runtime.resolveFileInput(inputFilePath);
  }

  const searchText = process.env.RABOTA_ROSSII_SEARCH_TEXT?.trim();

  if (searchText) {
    // trudvsem caps the GLOBAL (region-less) result window at offset < 50 — once
    // the offset reaches 50 the feed returns an empty page regardless of how
    // large meta.total is. Region-scoped queries each expose their own
    // independent window, so iterating region codes (RABOTA_ROSSII_REGION_CODES)
    // is the real coverage lever, far more than offset paging on the federal feed.
    const regionCodes = parseCommaSeparated(process.env.RABOTA_ROSSII_REGION_CODES);
    return {
      inputMode: 'public-pending',
      searchText,
      regionCode: process.env.RABOTA_ROSSII_REGION_CODE?.trim() || null,
      regionCodes: regionCodes.length > 0 ? regionCodes : null,
      offset: clampInteger(process.env.RABOTA_ROSSII_OFFSET, 0, 0, 100000),
      limit: clampInteger(process.env.RABOTA_ROSSII_LIMIT, 50, 1, 100),
      pages: clampInteger(process.env.RABOTA_ROSSII_PAGES, DEFAULT_PAGES, 1, MAX_PAGES),
    };
  }

  throw new Error(
    'No input configured for rabota-rossii. Set RABOTA_ROSSII_INPUT_FILE for file mode or RABOTA_ROSSII_SEARCH_TEXT for official live-public API mode.',
  );
}

/**
 * Fetch one region's (or the federal feed's) records, paging through
 * `limit`-sized offset windows until meta.total is covered, the page budget is
 * spent, or the API returns an empty page. Returns the raw records plus the
 * meta.total the feed reported and how many pages were actually requested.
 */
async function fetchRegionRecords({ searchText, regionCode, offset, limit, pages, userAgent }) {
  const records = [];
  let apiTotal = null;
  let pagesFetched = 0;

  for (let page = 0; page < pages; page += 1) {
    const pageOffset = offset + page * limit;
    const url = new URL(API_URL);
    url.searchParams.set('text', searchText);
    url.searchParams.set('offset', String(pageOffset));
    url.searchParams.set('limit', String(limit));

    if (regionCode) {
      url.searchParams.set('region_code', regionCode);
    }

    const body = await fetchJson(url.toString(), {
      sourceName: SOURCE_ID,
      headers: { 'user-agent': userAgent },
    });

    const pageRecords = extractRabotaRossiiRecords(body);
    pagesFetched += 1;

    const total = Number(body?.meta?.total);
    if (Number.isFinite(total)) {
      apiTotal = total;
    }

    if (pageRecords.length === 0) {
      break;
    }

    records.push(...pageRecords);

    if (apiTotal !== null && pageOffset + pageRecords.length >= apiTotal) {
      break;
    }
  }

  return { records, apiTotal, pagesFetched };
}

export async function resolveRabotaRossiiLiveInput({ searchText, regionCode, regionCodes = null, offset, limit, pages = DEFAULT_PAGES }) {
  const userAgent = process.env.RABOTA_ROSSII_USER_AGENT?.trim()
    || 'RecruiterRadar/1.0 (rabota-rossii source; contact: ops@example.com)';

  // Multi-region mode: iterate each supplied region's independent window. Single
  // region (or federal) mode preserves the original single-window behaviour the
  // confidence verifier and existing callers depend on.
  const regions = Array.isArray(regionCodes) && regionCodes.length > 0
    ? regionCodes
    : [regionCode ?? null];

  const records = [];
  let apiTotal = 0;
  let pagesFetched = 0;

  for (const region of regions) {
    const result = await fetchRegionRecords({ searchText, regionCode: region, offset, limit, pages, userAgent });
    records.push(...result.records);
    pagesFetched += result.pagesFetched;
    if (result.apiTotal !== null) {
      apiTotal += result.apiTotal;
    }
  }

  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records,
    rejectAllSkipped: true,
    extra: {
      liveProvider: 'trudvsem-opendata',
      searchText,
      offset,
      limit,
      pages,
      pagesFetched,
      regionsFetched: regions.length,
      apiTotal,
    },
  });
}

export async function resolveRabotaRossiiConfiguredInput() {
  const input = resolveRabotaRossiiInput();

  if (input.inputMode === 'public-pending') {
    return resolveRabotaRossiiLiveInput(input);
  }

  return input;
}

export function buildFetchSummary(input) {
  return runtime.buildFetchSummary(input);
}

export async function runRabotaRossiiCli(argv = process.argv.slice(2)) {
  await runScriptCli('source-rabota-rossii', async () => {
    await runtime.runCli(argv, resolveRabotaRossiiConfiguredInput);
  });
}

function extractRabotaRossiiRecords(body) {
  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body?.records)) {
    return body.records;
  }

  if (Array.isArray(body?.results?.vacancies)) {
    return body.results.vacancies;
  }

  return [];
}

function normalizeRabotaRossiiRecord(record, { fetchedAt, lineNumber }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const company = record.company && typeof record.company === 'object' ? record.company : {};
  const companyName = toNonEmptyText(record.company_name ?? record.org_name ?? company.name);
  const inn = normalizeLegalInn(record.inn ?? company.inn);
  const ogrn = normalizeLegalOgrn(record.ogrn ?? company.ogrn ?? company.companycode);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url ?? company.site);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const jobTitle = toNonEmptyText(record.job_title ?? record['job-name'] ?? record.job_name ?? record.name);
  const externalId = toNonEmptyText(record.external_id ?? record.id);
  const sourceUrl = toUrlOrNull(record.job_posting_url ?? record.vac_url ?? record.url);
  // Freshness signal = last time the employer re-confirmed the posting, not when
  // it was first created. trudvsem keeps long-lived vacancies whose `creation-date`
  // is often 6–18 months old while `date_modify` tracks the employer's most recent
  // update — that re-confirmation is the real hiring-actuality signal for the radar.
  // Prioritising `date_modify` (then created-date fallbacks) is what lets the live
  // feed clear the 60% active-30d freshness gate honestly; the original creation
  // date is preserved separately below for downstream urgency (long-standing roles).
  const occurredAt = toTimestampOrNull(record.date_modify ?? record.published_at ?? record['creation-date'] ?? record.creation_date)
    ?? fetchedAt;
  const creationDateRaw = toTimestampOrNull(record['creation-date'] ?? record.creation_date);
  const location = toNonEmptyText(record.location ?? record.region?.name);
  const salaryText = toNonEmptyText(record.salary);
  const salaryMin = toNonEmptyText(record.salary_min);
  const salaryMax = toNonEmptyText(record.salary_max);
  const currency = toNonEmptyText(record.currency);
  const schedule = toNonEmptyText(record.schedule);
  const category = toNonEmptyText(record.category?.specialisation ?? record.category);
  const rfQuality = buildRfJobQuality({
    companyName,
    jobTitle,
    location,
    salary: salaryText ?? [salaryMin, salaryMax, currency].filter(Boolean).join(' '),
    employmentType: schedule,
    occurredAt,
    fetchedAt,
    board: SOURCE_ID,
  });

  if (!jobTitle) {
    return null;
  }

  const identity = buildCompanyIdentity({
    companyName,
    companyDomain,
    companyWebsiteUrl,
    inn,
    ogrn,
    fallbackName: companyName,
    lineNumber,
  });

  if (!identity) {
    return null;
  }

  return {
    ...identity,
    fetchedAt,
    occurredAt,
    companyName,
    companyWebsiteUrl,
    inn,
    ogrn,
    orgExternalId: inn ?? ogrn ?? null,
    signalExternalId: externalId ? `${SOURCE_ID}:${externalId}` : `job-url:${sourceUrl ?? identity.primarySourceKey}:${lineNumber}`,
    headline: jobTitle,
    summary: buildSummary({ companyName, location, salaryText }),
    sourceUrl,
    recordTitle: jobTitle,
    sourceRecordType: 'job_posting',
    jobTitle,
    payload: {
      vacancy_id: externalId,
      job_title: jobTitle,
      job_posting_url: sourceUrl,
      location,
      region_code: toNonEmptyText(record.region?.region_code),
      salary: salaryText,
      salary_min: salaryMin,
      salary_max: salaryMax,
      currency,
      schedule,
      category,
      employer_url: toUrlOrNull(company.url),
      region_raw: location,
      region_canonical: rfQuality.regionCanonical,
      salary_rub_min: rfQuality.salaryRub.min,
      salary_rub_max: rfQuality.salaryRub.max,
      salary_currency: rfQuality.salaryRub.currency ?? currency,
      is_remote: rfQuality.workModeFlags.remote,
      is_hybrid: rfQuality.workModeFlags.hybrid,
      is_rotational: rfQuality.workModeFlags.rotational,
      vacancy_freshness: rfQuality.freshness,
      // Original creation date retained alongside freshness so downstream urgency
      // scoring can still see long-standing / repeatedly-reposted roles even though
      // freshness is now driven by date_modify.
      creation_date_raw: creationDateRaw,
      quality_penalties: rfQuality.qualityPenalties,
    },
  };
}

function buildSummary({ companyName, location, salaryText }) {
  return [companyName, location, salaryText]
    .map(toNonEmptyText)
    .filter(Boolean)
    .join('; ') || 'Rabota Rossii vacancy';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRabotaRossiiCli();
}
