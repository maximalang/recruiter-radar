import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchCuratedIndustryFeeds } from './adapters/curated-industry-feeds.mjs';
import { normalizeContextEventRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile, parseJson } from './adapters/rf-source-runtime.mjs';
import { stripBom } from './adapters/source-records.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const DEFAULT_REGISTRY_PATH = resolve(scriptDir, '../industry-media-feed-registry.json');
const SOURCE_ID = 'industry-media';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'industry_media_item',
  inputFileEnvName: 'INDUSTRY_MEDIA_INPUT_FILE',
  usageText: 'Input: automatic curated RSS/Atom mode uses the repository feed registry and tracked companies; reviewed file/provider modes remain available.',
  normalizeRecord: (record, context) => normalizeContextEventRecord(record, context, {
    sourceRecordType: 'industry_media_item',
    defaultEventType: 'industry_context',
    contextOnly: true,
  }),
  buildSummaryExtras: (input) => input.inputMode === 'live-public' || input.inputMode === 'expected-zero'
    ? {
      liveProvider: 'curated-rss-atom',
      feedsProcessed: input.feedsProcessed,
      companiesTracked: input.companiesTracked,
      feedErrors: input.feedErrors,
      zeroReason: input.zeroReason ?? undefined,
    }
    : {},
});

export function resolveIndustryMediaInput() {
  const inputFilePath = process.env.INDUSTRY_MEDIA_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.INDUSTRY_MEDIA_PROVIDER_API_URL?.trim();
  const providerToken = process.env.INDUSTRY_MEDIA_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  const registryPath = resolve(process.cwd(), process.env.INDUSTRY_MEDIA_FEED_REGISTRY_FILE?.trim() || DEFAULT_REGISTRY_PATH);
  const trackedCompanies = parseJson(
    process.env.INDUSTRY_MEDIA_TRACKED_COMPANIES_JSON?.trim() || '[]',
    'INDUSTRY_MEDIA_TRACKED_COMPANIES_JSON',
  );
  return { inputMode: 'live-pending', registryPath, trackedCompanies };
}

export async function resolveIndustryMediaLiveInput({ registryPath, trackedCompanies }, options = {}) {
  if (!existsSync(registryPath)) throw new Error(`Industry-media feed registry does not exist: ${registryPath}`);
  const registry = parseJson(stripBom(readFileSync(registryPath, 'utf8')), registryPath);
  if (!Array.isArray(trackedCompanies) || trackedCompanies.length === 0) {
    return runtime.buildInputFromRecords({
      inputMode: 'expected-zero',
      inputFilePath: null,
      records: [],
      extra: { feedsProcessed: Array.isArray(registry) ? registry.length : 0, companiesTracked: 0, feedErrors: 0, zeroReason: 'no-eligible-company-targets' },
    });
  }

  const fetched = await fetchCuratedIndustryFeeds(registry, trackedCompanies, options);
  const feedErrors = fetched.diagnostics.filter((item) => item.error).length;
  if (fetched.feedsProcessed > 0 && feedErrors === fetched.feedsProcessed) {
    throw new Error(`industry-media could not reach any of ${fetched.feedsProcessed} curated feeds.`);
  }
  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records: fetched.records,
    rejectAllSkipped: true,
    extra: {
      feedsProcessed: fetched.feedsProcessed,
      companiesTracked: fetched.companiesTracked,
      feedErrors,
      zeroReason: fetched.records.length === 0 ? 'no-matched-company-articles' : null,
    },
  });
}

export async function resolveIndustryMediaConfiguredInput(options = {}) {
  const input = await resolveIndustryMediaInput();
  return input.inputMode === 'live-pending' ? resolveIndustryMediaLiveInput(input, options) : input;
}

export const buildFetchSummary = runtime.buildFetchSummary;

export async function runIndustryMediaCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveIndustryMediaConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runIndustryMediaCli();
}
