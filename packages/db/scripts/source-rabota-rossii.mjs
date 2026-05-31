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
    return {
      inputMode: 'public-pending',
      searchText,
      regionCode: process.env.RABOTA_ROSSII_REGION_CODE?.trim() || null,
      offset: clampInteger(process.env.RABOTA_ROSSII_OFFSET, 0, 0, 100000),
      limit: clampInteger(process.env.RABOTA_ROSSII_LIMIT, 50, 1, 100),
    };
  }

  throw new Error(
    'No input configured for rabota-rossii. Set RABOTA_ROSSII_INPUT_FILE for file mode or RABOTA_ROSSII_SEARCH_TEXT for official live-public API mode.',
  );
}

export async function resolveRabotaRossiiLiveInput({ searchText, regionCode, offset, limit }) {
  const url = new URL(API_URL);
  url.searchParams.set('text', searchText);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));

  if (regionCode) {
    url.searchParams.set('region_code', regionCode);
  }

  const body = await fetchJson(url.toString(), {
    sourceName: SOURCE_ID,
    headers: {
      'user-agent': process.env.RABOTA_ROSSII_USER_AGENT?.trim()
        || 'RecruiterRadar/1.0 (rabota-rossii source; contact: ops@example.com)',
    },
  });
  const records = extractRabotaRossiiRecords(body);

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
      apiTotal: body?.meta?.total ?? null,
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
  const occurredAt = toTimestampOrNull(record.published_at ?? record['creation-date'] ?? record.creation_date ?? record.date_modify)
    ?? fetchedAt;
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
