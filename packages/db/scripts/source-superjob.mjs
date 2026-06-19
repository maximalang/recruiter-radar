/**
 * SuperJob source script.
 *
 * Fetch modes:
 *   1. File mode: SUPERJOB_INPUT_FILE → read records from JSON/CSV file
 *   2. Provider mode: SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID → fetch from provider
 *   3. Live API mode: SUPERJOB_API_APP_ID + SUPERJOB_KEYWORD → direct SuperJob API
 *
 * Live API mode uses the SuperJob 2.0 REST API directly:
 *   - Endpoint: https://api.superjob.ru/2.0/vacancies/
 *   - Auth: X-Api-App-Id header
 *   - Rate limit: 120 req/min per IP
 *   - Max 500 results per search (100/page × 5 pages)
 *
 * API response shape:
 *   { objects: [...], total: number, more: boolean }
 *
 * Vacancy object fields used:
 *   - id, profession, firm_name, link, date_published (unixtime)
 *   - town.title, payment_from/payment_to, currency, type_of_work.title
 *   - experience.title, agency.title, address
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchSuperjobVacancyPages, resolveSuperjobSearchConfig } from './adapters/superjob.mjs';
import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import {
  createStandardSourceRuntime,
  loadEnvFile,
} from './adapters/rf-source-runtime.mjs';
import { runScriptCli } from './lib/common-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'superjob';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'job_posting',
  evidenceRole: 'primary_platform',
  sourceRecordType: 'job_posting',
  inputFileEnvName: 'SUPERJOB_INPUT_FILE',
  usageText: 'Input: set SUPERJOB_INPUT_FILE, SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID, or SUPERJOB_API_APP_ID + SUPERJOB_KEYWORD for live API mode.',
  extractProviderRecords: extractSuperjobRecords,
  normalizeRecord: (record, context) => normalizeSuperjobRecord(record, context),
  buildSummaryExtras: (input) => input.inputMode === 'live-public'
    ? {
      liveProvider: 'superjob-api',
      keyword: input.keyword,
      apiTotal: input.apiTotal,
    }
    : {},
});

/**
 * Resolve input from env vars. Returns sync input (file/provider)
 * or a pending live-input descriptor for async resolution.
 */
export function resolveSuperjobInput() {
  const inputFilePath = process.env.SUPERJOB_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.SUPERJOB_PROVIDER_API_URL?.trim();
  const appId = process.env.SUPERJOB_API_APP_ID?.trim();
  if (providerUrl && appId) {
    return runtime.resolveProviderInput({
      providerUrl,
      providerToken: appId,
      providerHeaders: { 'X-Api-App-Id': appId },
      providerLabel: `${SOURCE_ID} provider`,
    });
  }

  // Live API mode — needs async resolution
  if (appId) {
    return {
      inputMode: 'public-pending',
      appId,
      config: resolveSuperjobSearchConfig(),
    };
  }

  throw new Error('No input configured for superjob. Set SUPERJOB_INPUT_FILE, SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID, or SUPERJOB_API_APP_ID + SUPERJOB_KEYWORD for live API mode.');
}

/**
 * Async: resolve live SuperJob API input.
 */
export async function resolveSuperjobLiveInput({ appId, config }) {
  const fetchResult = await fetchSuperjobVacancyPages({ appId, config });
  const records = fetchResult.items;

  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records,
    rejectAllSkipped: true,
    extra: {
      liveProvider: 'superjob-api',
      keyword: config.keyword,
      apiTotal: fetchResult.total,
      pagesFetched: fetchResult.pagesFetched,
    },
  });
}

/**
 * Async: resolve whatever input mode was configured.
 */
export async function resolveSuperjobConfiguredInput() {
  const input = resolveSuperjobInput();

  if (input.inputMode === 'public-pending') {
    return resolveSuperjobLiveInput(input);
  }

  return input;
}

export const buildFetchSummary = runtime.buildFetchSummary;

export async function runSuperjobCli(argv = process.argv.slice(2)) {
  await runScriptCli('source-superjob', async () => {
    await runtime.runCli(argv, resolveSuperjobConfiguredInput);
  });
}

/**
 * Extract records from provider response (generic wrapper).
 */
function extractSuperjobRecords(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.objects)) return body.objects;
  if (Array.isArray(body?.records)) return body.records;
  return [];
}

/**
 * Normalize a SuperJob vacancy object into the standard record shape.
 * Maps SuperJob-specific field names to the generic normalizer contract.
 */
function normalizeSuperjobRecord(record, { fetchedAt, lineNumber }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  // Map SuperJob fields to the generic normalizer's expected field names.
  // Prefer SuperJob-native fields (live API mode), but fall back to the
  // generic names so file mode (SUPERJOB_INPUT_FILE) and provider mode —
  // both of which carry generically-shaped records — normalize correctly.
  const mapped = {
    // Company
    company_name: record.firm_name ?? record.company_name,
    company_domain: record.company_domain ?? record.domain,
    company_website_url: record.company_website_url ?? record.website_url,
    inn: record.client ?? record.inn ?? undefined,
    // Job
    job_title: record.profession ?? record.job_title,
    external_id: record.id ?? record.external_id,
    job_posting_url: record.link ?? record.job_posting_url,
    published_at: record.date_published
      ? new Date(record.date_published * 1000).toISOString()
      : record.published_at,
    // Location
    location: record.town?.title ?? record.location,
    // Salary
    salary: record.payment_from || record.payment_to
      ? [record.payment_from, record.payment_to, record.currency].filter(Boolean).join('–')
      : record.salary,
    salary_from: record.payment_from ?? record.salary_from,
    salary_to: record.payment_to ?? record.salary_to,
    currency: record.currency,
    // Employment
    employment_type: record.type_of_work?.title ?? record.employment_type,
    // Experience
    experience: record.experience?.title ?? record.experience,
    // Agency (direct employer vs recruitment agency)
    agency: record.agency?.title ?? record.agency,
    // Address
    address: record.address?.city ?? record.address?.street ?? record.address,
    // Tags
    tags: record.tags,
    // Source board marker
    source_board: record.source_board ?? 'superjob',
  };

  return normalizeJobPostingRecord(mapped, { fetchedAt, lineNumber, sourceId: SOURCE_ID }, { defaultBoard: 'superjob' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSuperjobCli();
}