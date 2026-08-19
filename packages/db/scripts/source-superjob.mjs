/**
 * SuperJob source script.
 *
 * Fetch modes:
 *   1. File mode: SUPERJOB_INPUT_FILE → reviewed JSON/CSV records
 *   2. Provider mode: SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID
 *   3. Live API mode: SUPERJOB_API_APP_ID → official SuperJob API
 *
 * Production live mode is broad incremental by default: direct employers only,
 * no keyword, last 12 hours, adaptive time partitions around SuperJob's 500-row
 * search ceiling. SUPERJOB_KEYWORD is optional and intended for bounded
 * diagnostics/verifiers, not the production discovery default.
 *
 * Native agency=2/3/4 records are rejected at the source boundary before a
 * signal/evidence row can be created. This prevents recruiting-agency,
 * outsourcing and aggregator publications from contaminating canonical hiring
 * demand even if an operator explicitly runs an unfiltered diagnostic query.
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
  usageText: 'Input: set SUPERJOB_INPUT_FILE, SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID, or SUPERJOB_API_APP_ID for official broad incremental live API mode. SUPERJOB_KEYWORD is optional.',
  extractProviderRecords: extractSuperjobRecords,
  normalizeRecord: (record, context) => normalizeSuperjobRecord(record, context),
  buildSummaryExtras: (input) => input.inputMode === 'live-public'
    ? {
      liveProvider: 'superjob-api',
      keyword: input.keyword,
      agency: input.agency,
      datePublishedFrom: input.datePublishedFrom,
      datePublishedTo: input.datePublishedTo,
      apiTotal: input.apiTotal,
      pagesFetched: input.pagesFetched,
      partitions: input.partitions,
      adaptiveTimePartition: input.adaptiveTimePartition,
    }
    : {},
});

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

  if (appId) {
    return {
      inputMode: 'public-pending',
      appId,
      config: resolveSuperjobSearchConfig(),
    };
  }

  throw new Error('No input configured for superjob. Set SUPERJOB_INPUT_FILE, SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID, or SUPERJOB_API_APP_ID for official live API mode.');
}

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
      agency: config.extraParams?.agency ?? null,
      datePublishedFrom: config.extraParams?.date_published_from ?? null,
      datePublishedTo: config.extraParams?.date_published_to ?? null,
      apiTotal: fetchResult.total,
      pagesFetched: fetchResult.pagesFetched,
      partitions: fetchResult.partitions ?? [],
      adaptiveTimePartition: fetchResult.adaptiveTimePartition === true,
    },
  });
}

export async function resolveSuperjobConfiguredInput() {
  const input = resolveSuperjobInput();
  if (input.inputMode === 'public-pending') return resolveSuperjobLiveInput(input);
  return input;
}

export const buildFetchSummary = runtime.buildFetchSummary;

export async function runSuperjobCli(argv = process.argv.slice(2)) {
  await runScriptCli('source-superjob', async () => {
    await runtime.runCli(argv, resolveSuperjobConfiguredInput);
  });
}

function extractSuperjobRecords(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.objects)) return body.objects;
  if (Array.isArray(body?.records)) return body.records;
  return [];
}

export function normalizeSuperjobRecord(record, { fetchedAt, lineNumber }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;

  const publisher = classifySuperjobPublisher(record.agency);
  // SuperJob's native agency classifier is authoritative when present. Never
  // create hiring demand for known agency/outsourcing/aggregator publishers.
  if (publisher.id !== null && !publisher.candidateEligible) return null;
  if (record.candidate_eligible === false) return null;

  const mapped = {
    company_name: record.firm_name ?? record.company_name,
    company_domain: record.company_domain ?? record.domain,
    company_website_url: record.company_website_url ?? record.website_url,
    inn: record.client ?? record.inn ?? undefined,
    job_title: record.profession ?? record.job_title,
    external_id: record.id ?? record.external_id,
    job_posting_url: record.link ?? record.job_posting_url,
    published_at: record.date_published
      ? new Date(record.date_published * 1000).toISOString()
      : record.published_at,
    location: record.town?.title ?? record.location,
    salary: record.payment_from || record.payment_to
      ? [record.payment_from, record.payment_to, record.currency].filter(Boolean).join('–')
      : record.salary,
    salary_from: record.payment_from ?? record.salary_from,
    salary_to: record.payment_to ?? record.salary_to,
    currency: record.currency,
    employment_type: record.type_of_work?.title ?? record.employment_type,
    experience: record.experience?.title ?? record.experience,
    publisher_type: publisher.type,
    publisher_type_id: publisher.id,
    publisher_type_label: publisher.label,
    // Native agency=1 is direct employer. For reviewed generic snapshots where
    // agency metadata is absent, preserve an explicit candidate_eligible value;
    // otherwise leave the record conservative (false) downstream.
    candidate_eligible: publisher.id !== null
      ? publisher.candidateEligible
      : record.candidate_eligible === true,
    address: record.address?.city ?? record.address?.street ?? record.address,
    tags: record.tags,
    source_board: record.source_board ?? 'superjob',
  };

  return normalizeJobPostingRecord(mapped, { fetchedAt, lineNumber, sourceId: SOURCE_ID }, { defaultBoard: 'superjob' });
}

export function classifySuperjobPublisher(agency) {
  const id = Number.isInteger(Number(agency?.id)) ? Number(agency.id) : null;
  const label = typeof agency?.title === 'string' && agency.title.trim() !== ''
    ? agency.title.trim()
    : null;
  const type = new Map([
    [1, 'direct-employer'],
    [2, 'recruitment-agency'],
    [3, 'outsourcing'],
    [4, 'aggregator'],
  ]).get(id) ?? 'unknown';

  return {
    id,
    label,
    type,
    candidateEligible: type === 'direct-employer',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSuperjobCli();
}
