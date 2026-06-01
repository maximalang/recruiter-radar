/**
 * Habr Career source script.
 *
 * Fetch modes:
 *   1. File mode: HABR_CAREER_INPUT_FILE → read records from JSON/CSV file
 *   2. Provider mode: HABR_CAREER_PROVIDER_API_URL + token → fetch from partner API
 *   3. Live scraping mode: HABR_CAREER_KEYWORD → scrape career.habr.com search results
 *
 * Habr Career does not have a documented public REST API for vacancy search.
 * Live scraping mode uses HTML parsing of career.habr.com/vacancies search pages.
 * This is slower but works without a partner API token.
 *
 * Scraped fields:
 *   - vacancy ID (from href), title, company name, salary, location, skills/tags
 *   - Each card → normalized record via normalizeJobPostingRecord
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchHabrCareerPages, resolveHabrCareerSearchConfig } from './adapters/habr-career.mjs';
import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import {
  createStandardSourceRuntime,
  loadEnvFile,
} from './adapters/rf-source-runtime.mjs';
import { runScriptCli } from './lib/common-utils.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'habr-career';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'job_posting',
  evidenceRole: 'primary_platform',
  sourceRecordType: 'job_posting',
  inputFileEnvName: 'HABR_CAREER_INPUT_FILE',
  usageText: 'Input: set HABR_CAREER_INPUT_FILE, HABR_CAREER_PROVIDER_API_URL + token, or HABR_CAREER_KEYWORD for live scraping mode.',
  extractProviderRecords: extractHabrCareerRecords,
  normalizeRecord: (record, context) => normalizeJobPostingRecord(record, context, { defaultBoard: 'habr-career' }),
  buildSummaryExtras: (input) => input.inputMode === 'live-scrape'
    ? {
      liveProvider: 'habr-career-scrape',
      keyword: input.keyword,
      pagesFetched: input.pagesFetched,
    }
    : {},
});

/**
 * Resolve input from env vars. Returns sync input (file/provider)
 * or a pending live-input descriptor for async resolution.
 */
export function resolveHabrCareerInput() {
  const inputFilePath = process.env.HABR_CAREER_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.HABR_CAREER_PROVIDER_API_URL?.trim();
  const providerToken = process.env.HABR_CAREER_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  // Live scraping mode — needs async resolution
  const keyword = process.env.HABR_CAREER_KEYWORD?.trim();
  if (keyword) {
    return {
      inputMode: 'public-pending',
      config: resolveHabrCareerSearchConfig(),
    };
  }

  throw new Error('No input configured for habr-career. Set HABR_CAREER_INPUT_FILE, HABR_CAREER_PROVIDER_API_URL + token, or HABR_CAREER_KEYWORD for live scraping mode.');
}

/**
 * Async: resolve live Habr Career scraping input.
 */
export async function resolveHabrCareerLiveInput({ config }) {
  const fetchResult = await fetchHabrCareerPages({ config });
  const records = fetchResult.items;

  return runtime.buildInputFromRecords({
    inputMode: 'live-scrape',
    inputFilePath: null,
    records,
    rejectAllSkipped: true,
    extra: {
      liveProvider: 'habr-career-scrape',
      keyword: config.keyword,
      pagesFetched: fetchResult.pagesFetched,
    },
  });
}

/**
 * Async: resolve whatever input mode was configured.
 */
export async function resolveHabrCareerConfiguredInput() {
  const input = resolveHabrCareerInput();

  if (input.inputMode === 'public-pending') {
    return resolveHabrCareerLiveInput(input);
  }

  return input;
}

export const buildFetchSummary = runtime.buildFetchSummary;

export async function runHabrCareerCli(argv = process.argv.slice(2)) {
  await runScriptCli('source-habr-career', async () => {
    await runtime.runCli(argv, resolveHabrCareerConfiguredInput);
  });
}

/**
 * Extract records from provider response (generic wrapper).
 */
function extractHabrCareerRecords(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.records)) return body.records;
  if (Array.isArray(body?.objects)) return body.objects;
  if (Array.isArray(body?.vacancies)) return body.vacancies;
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHabrCareerCli();
}