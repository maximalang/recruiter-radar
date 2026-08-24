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

// Trudvsem documents `offset` as the PAGE NUMBER (0-based), not an absolute
// record offset. With limit=100, offsets 0,1,2... cover consecutive pages.
// The old implementation used 0,100,200... and therefore skipped 99 pages
// between requests. Keep the page budget bounded but large enough for the
// recent-change window; the loop stops on meta.total or an empty page.
const DEFAULT_LIMIT = 100;
const DEFAULT_PAGES = 50;
const MAX_PAGES = 100;
const DEFAULT_MODIFIED_LOOKBACK_HOURS = 24;
const MAX_MODIFIED_LOOKBACK_HOURS = 168;

// Optional region fan-out remains available for diagnostics or targeted runs.
// The default is now the nationwide official endpoint with modifiedFrom, which
// covers every RF region without the former curated 12-region recall ceiling.
const LEGACY_DEFAULT_REGION_CODES = Object.freeze([
  '7700000000000', '7800000000000', '5000000000000', '6600000000000',
  '5400000000000', '1600000000000', '2300000000000', '0200000000000',
  '7400000000000', '6300000000000', '5200000000000', '6100000000000',
]);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'job_posting',
  evidenceRole: 'primary_platform',
  sourceRecordType: 'job_posting',
  inputFileEnvName: 'RABOTA_ROSSII_INPUT_FILE',
  usageText: 'Input: set RABOTA_ROSSII_INPUT_FILE, or use the credential-free official incremental API (RABOTA_ROSSII_SEARCH_TEXT is optional).',
  extractRecords: extractRabotaRossiiRecords,
  normalizeRecord: normalizeRabotaRossiiRecord,
  buildSummaryExtras: (input) => input.inputMode === 'live-public'
    ? {
      liveProvider: input.liveProvider,
      searchText: input.searchText,
      modifiedFrom: input.modifiedFrom,
      modifiedTo: input.modifiedTo,
      offset: input.offset,
      limit: input.limit,
      pages: input.pages,
      pagesFetched: input.pagesFetched,
      regionsFetched: input.regionsFetched,
      apiTotal: input.apiTotal,
      zeroReason: input.zeroReason ?? undefined,
    }
    : {},
});

export function resolveRabotaRossiiInput({ now = new Date() } = {}) {
  const inputFilePath = process.env.RABOTA_ROSSII_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const searchText = process.env.RABOTA_ROSSII_SEARCH_TEXT?.trim() || null;
  const singleRegion = normalizeRegionCode(process.env.RABOTA_ROSSII_REGION_CODE);
  const rawRegionCodes = process.env.RABOTA_ROSSII_REGION_CODES?.trim();
  const parsedRegionCodes = parseCommaSeparated(rawRegionCodes)
    .map(normalizeRegionCode)
    .filter(Boolean);

  let regionCodes = null;
  if (!singleRegion && rawRegionCodes && /^legacy-major$/i.test(rawRegionCodes)) {
    regionCodes = [...LEGACY_DEFAULT_REGION_CODES];
  } else if (!singleRegion && rawRegionCodes && !/^federal$/i.test(rawRegionCodes)) {
    regionCodes = [...new Set(parsedRegionCodes)];
  }

  const lookbackHours = clampInteger(
    process.env.RABOTA_ROSSII_MODIFIED_LOOKBACK_HOURS,
    DEFAULT_MODIFIED_LOOKBACK_HOURS,
    1,
    MAX_MODIFIED_LOOKBACK_HOURS,
  );
  const explicitModifiedFrom = toTimestampOrNull(process.env.RABOTA_ROSSII_MODIFIED_FROM);
  const explicitModifiedTo = toTimestampOrNull(process.env.RABOTA_ROSSII_MODIFIED_TO);
  const modifiedFrom = explicitModifiedFrom
    ?? new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();

  return {
    inputMode: 'public-pending',
    searchText,
    regionCode: singleRegion,
    regionCodes,
    modifiedFrom,
    modifiedTo: explicitModifiedTo,
    offset: clampInteger(process.env.RABOTA_ROSSII_OFFSET, 0, 0, 100000),
    limit: clampInteger(process.env.RABOTA_ROSSII_LIMIT, DEFAULT_LIMIT, 1, 100),
    pages: clampInteger(process.env.RABOTA_ROSSII_PAGES, DEFAULT_PAGES, 1, MAX_PAGES),
  };
}

export function buildRabotaRossiiApiUrl({
  searchText = null,
  regionCode = null,
  offset = 0,
  limit = DEFAULT_LIMIT,
  modifiedFrom = null,
  modifiedTo = null,
} = {}) {
  const normalizedRegion = normalizeRegionCode(regionCode);
  const url = normalizedRegion
    ? new URL(`${API_URL}/region/${normalizedRegion}`)
    : new URL(API_URL);
  const normalizedSearch = toNonEmptyText(searchText);
  if (normalizedSearch) url.searchParams.set('text', normalizedSearch);
  url.searchParams.set('offset', String(clampInteger(offset, 0, 0, 100000)));
  url.searchParams.set('limit', String(clampInteger(limit, DEFAULT_LIMIT, 1, 100)));
  const from = toTimestampOrNull(modifiedFrom);
  const to = toTimestampOrNull(modifiedTo);
  if (from) url.searchParams.set('modifiedFrom', from);
  if (to) url.searchParams.set('modifiedTo', to);
  return url.toString();
}

export function buildRabotaRossiiPageOffsets({ offset = 0, pages = DEFAULT_PAGES } = {}) {
  const firstPage = clampInteger(offset, 0, 0, 100000);
  const pageCount = clampInteger(pages, DEFAULT_PAGES, 1, MAX_PAGES);
  return Array.from({ length: pageCount }, (_, index) => firstPage + index);
}

async function fetchPartitionRecords({
  searchText,
  regionCode,
  modifiedFrom,
  modifiedTo,
  offset,
  limit,
  pages,
  userAgent,
  fetchJsonImpl = fetchJson,
}) {
  const records = [];
  let apiTotal = null;
  let pagesFetched = 0;

  for (const pageOffset of buildRabotaRossiiPageOffsets({ offset, pages })) {
    const url = buildRabotaRossiiApiUrl({
      searchText,
      regionCode,
      offset: pageOffset,
      limit,
      modifiedFrom,
      modifiedTo,
    });
    const body = await fetchJsonImpl(url, {
      sourceName: SOURCE_ID,
      headers: { 'user-agent': userAgent },
    });
    const pageRecords = extractRabotaRossiiRecords(body);
    pagesFetched += 1;

    const total = Number(body?.meta?.total);
    if (Number.isFinite(total) && total >= 0) apiTotal = total;
    if (pageRecords.length === 0) break;

    records.push(...pageRecords);
    // `offset` is page-indexed: page N covers records N*limit...(N+1)*limit-1.
    if (apiTotal !== null && (pageOffset + 1) * limit >= apiTotal) break;
    if (pageRecords.length < limit) break;
  }

  return { records, apiTotal, pagesFetched };
}

export async function resolveRabotaRossiiLiveInput({
  searchText = null,
  regionCode = null,
  regionCodes = null,
  modifiedFrom = null,
  modifiedTo = null,
  offset = 0,
  limit = DEFAULT_LIMIT,
  pages = DEFAULT_PAGES,
  fetchJsonImpl = fetchJson,
}) {
  const userAgent = process.env.RABOTA_ROSSII_USER_AGENT?.trim()
    || 'RecruiterRadar/1.0 (rabota-rossii source; contact: ops@example.com)';
  const regions = Array.isArray(regionCodes) && regionCodes.length > 0
    ? regionCodes.map(normalizeRegionCode).filter(Boolean)
    : [normalizeRegionCode(regionCode)];

  const records = [];
  let apiTotal = 0;
  let pagesFetched = 0;
  for (const region of regions) {
    const result = await fetchPartitionRecords({
      searchText,
      regionCode: region,
      modifiedFrom,
      modifiedTo,
      offset,
      limit,
      pages,
      userAgent,
      fetchJsonImpl,
    });
    records.push(...result.records);
    pagesFetched += result.pagesFetched;
    if (result.apiTotal !== null) apiTotal += result.apiTotal;
  }

  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records,
    rejectAllSkipped: true,
    extra: {
      liveProvider: 'trudvsem-opendata',
      searchText,
      modifiedFrom,
      modifiedTo,
      offset,
      limit,
      pages,
      pagesFetched,
      regionsFetched: regions.length,
      apiTotal,
      zeroReason: records.length === 0 ? 'no-vacancies-in-incremental-window' : null,
    },
  });
}

export async function resolveRabotaRossiiConfiguredInput() {
  const input = resolveRabotaRossiiInput();
  if (input.inputMode === 'public-pending') return resolveRabotaRossiiLiveInput(input);
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
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.records)) return body.records;
  if (Array.isArray(body?.results?.vacancies)) return body.results.vacancies;
  return [];
}

function normalizeRabotaRossiiRecord(record, { fetchedAt, lineNumber }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;

  // API responses normally wrap each item as { vacancy: {...} }. Accept both
  // wrapped live records and flat reviewed snapshots without weakening schema.
  const raw = record.vacancy && typeof record.vacancy === 'object' && !Array.isArray(record.vacancy)
    ? record.vacancy
    : record;
  const company = raw.company && typeof raw.company === 'object' ? raw.company : {};
  const companyName = toNonEmptyText(raw.company_name ?? raw.org_name ?? company.name);
  const inn = normalizeLegalInn(raw.inn ?? company.inn);
  const ogrn = normalizeLegalOgrn(raw.ogrn ?? company.ogrn ?? company.companycode);
  const companyWebsiteUrl = toUrlOrNull(raw.company_website_url ?? raw.website_url ?? company.site);
  const companyDomain = normalizeDomain(raw.company_domain ?? raw.domain);
  const jobTitle = toNonEmptyText(raw.job_title ?? raw['job-name'] ?? raw.job_name ?? raw.name);
  const externalId = toNonEmptyText(raw.external_id ?? raw.id);
  const sourceUrl = toUrlOrNull(raw.job_posting_url ?? raw.vac_url ?? raw.url);
  const occurredAt = toTimestampOrNull(raw.date_modify ?? raw.published_at ?? raw['creation-date'] ?? raw.creation_date)
    ?? fetchedAt;
  const creationDateRaw = toTimestampOrNull(raw['creation-date'] ?? raw.creation_date);
  const location = toNonEmptyText(raw.location ?? raw.region?.name);
  const salaryText = toNonEmptyText(raw.salary);
  const salaryMin = toNonEmptyText(raw.salary_min);
  const salaryMax = toNonEmptyText(raw.salary_max);
  const currency = toNonEmptyText(raw.currency);
  const schedule = toNonEmptyText(raw.schedule);
  const category = toNonEmptyText(raw.category?.specialisation ?? raw.category);
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

  if (!jobTitle) return null;
  const identity = buildCompanyIdentity({
    companyName,
    companyDomain,
    companyWebsiteUrl,
    inn,
    ogrn,
    fallbackName: companyName,
    lineNumber,
  });
  if (!identity) return null;

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
      region_code: toNonEmptyText(raw.region?.region_code),
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
      creation_date_raw: creationDateRaw,
      quality_penalties: rfQuality.qualityPenalties,
    },
  };
}

function normalizeRegionCode(value) {
  const text = toNonEmptyText(value);
  return text && /^\d{13}$/.test(text) ? text : null;
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
