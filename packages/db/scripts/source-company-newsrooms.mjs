import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeContextEventRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile, parseJson } from './adapters/rf-source-runtime.mjs';
import { stripBom } from './adapters/source-records.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'company-newsrooms';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'company_newsroom_item',
  inputFileEnvName: 'COMPANY_NEWSROOMS_INPUT_FILE',
  usageText: 'Input: set COMPANY_NEWSROOMS_INPUT_FILE, COMPANY_NEWSROOMS_TARGETS_FILE, or provider env.',
  normalizeRecord: (record, context) => normalizeContextEventRecord(record, context, {
    sourceRecordType: 'company_newsroom_item',
    defaultEventType: 'company_news',
    contextOnly: true,
  }),
  buildSummaryExtras: (input) => input.inputMode === 'live-public'
    ? {
      liveProvider: input.liveProvider,
      targetsFilePath: input.targetsFilePath,
      targetsProcessed: input.targetsProcessed,
      crawlSuccesses: input.crawlSuccesses,
      crawlErrors: input.crawlErrors,
      newsroomPagesDiscovered: input.newsroomPagesDiscovered,
      feedsDiscovered: input.feedsDiscovered,
      pagesFetched: input.pagesFetched,
      feedsFetched: input.feedsFetched,
      zeroReason: input.zeroReason ?? undefined,
    }
    : {},
});

export function resolveCompanyNewsroomsInput() {
  const inputFilePath = process.env.COMPANY_NEWSROOMS_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const targetsFilePath = process.env.COMPANY_NEWSROOMS_TARGETS_FILE?.trim();
  if (targetsFilePath) return { inputMode: 'live-pending', targetsFilePath };

  const providerUrl = process.env.COMPANY_NEWSROOMS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.COMPANY_NEWSROOMS_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No input configured for company-newsrooms. Set COMPANY_NEWSROOMS_INPUT_FILE, COMPANY_NEWSROOMS_TARGETS_FILE, or provider env.');
}

export async function resolveCompanyNewsroomsLiveInput({ targetsFilePath }, { dependencies = {} } = {}) {
  const { fetchCompanyNewsrooms } = await import('./adapters/company-newsroom-crawl.mjs');
  const resolvedPath = resolve(process.cwd(), targetsFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`COMPANY_NEWSROOMS_TARGETS_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const targets = parseJson(rawContent, resolvedPath);

  if (!Array.isArray(targets)) {
    throw new Error('COMPANY_NEWSROOMS_TARGETS_FILE must contain a JSON array.');
  }

  if (targets.length === 0) {
    return runtime.buildInputFromRecords({
      inputMode: 'live-public',
      inputFilePath: null,
      records: [],
      extra: buildLiveExtras(resolvedPath, [], 'no-eligible-company-targets'),
    });
  }

  const crawlResults = await fetchCompanyNewsrooms(targets, { dependencies });
  const records = crawlResults.flatMap((result) => result.records);
  const reachableTargets = crawlResults.filter((result) => result.rootFetched).length;
  const resourcesDiscovered = sum(crawlResults, 'pagesDiscovered') + sum(crawlResults, 'feedsDiscovered');
  const resourcesFetched = sum(crawlResults, 'pagesFetched') + sum(crawlResults, 'feedsFetched');

  if (reachableTargets === 0) {
    const details = crawlResults
      .flatMap((result) => result.errors)
      .filter(Boolean)
      .slice(0, 3)
      .join('; ');
    throw new Error(
      `company-newsrooms live crawl could not reach any of ${targets.length} targets.`
        + (details ? ` ${details}` : ''),
    );
  }

  if (records.length === 0 && resourcesDiscovered > 0 && resourcesFetched === 0) {
    throw new Error(
      `company-newsrooms discovered ${resourcesDiscovered} newsroom resources, but all were unreachable.`,
    );
  }

  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records,
    rejectAllSkipped: true,
    extra: buildLiveExtras(
      resolvedPath,
      crawlResults,
      records.length === 0 ? 'no-company-newsroom-items' : null,
    ),
  });
}

export async function resolveCompanyNewsroomsConfiguredInput() {
  const input = resolveCompanyNewsroomsInput();

  if (input.inputMode === 'live-pending') {
    return resolveCompanyNewsroomsLiveInput(input);
  }

  return input;
}
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runCompanyNewsroomsCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveCompanyNewsroomsConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCompanyNewsroomsCli();
}

function buildLiveExtras(targetsFilePath, crawlResults, zeroReason) {
  return {
    liveProvider: 'company-owned-newsroom-discovery',
    targetsFilePath,
    targetsProcessed: crawlResults.length,
    crawlSuccesses: crawlResults.filter((result) => result.rootFetched).length,
    crawlErrors: crawlResults.reduce(
      (total, result) => total + (Array.isArray(result.errors) ? result.errors.length : 0),
      0,
    ),
    newsroomPagesDiscovered: sum(crawlResults, 'pagesDiscovered'),
    feedsDiscovered: sum(crawlResults, 'feedsDiscovered'),
    pagesFetched: sum(crawlResults, 'pagesFetched'),
    feedsFetched: sum(crawlResults, 'feedsFetched'),
    zeroReason,
  };
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}
