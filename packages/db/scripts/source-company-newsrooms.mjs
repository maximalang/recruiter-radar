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
      crawlSuccesses: input.crawlSuccesses,
      crawlErrors: input.crawlErrors,
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

export async function resolveCompanyNewsroomsLiveInput({ targetsFilePath }) {
  const { fetchCompanyPages } = await import('./adapters/company-site-crawl.mjs');
  const resolvedPath = resolve(process.cwd(), targetsFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`COMPANY_NEWSROOMS_TARGETS_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const targets = parseJson(rawContent, resolvedPath);

  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('COMPANY_NEWSROOMS_TARGETS_FILE must contain a non-empty JSON array.');
  }

  const crawlResults = await fetchCompanyPages(targets);
  const crawlErrors = crawlResults.filter((result) => result.error).length;
  const records = crawlResults
    .filter((result) => result.record !== null)
    .map((result) => mapCrawledNewsroomRecord(result.record));

  if (records.length === 0) {
    throw new Error(`company-newsrooms live crawl produced 0 usable pages from ${targets.length} targets.`);
  }

  return runtime.buildInputFromRecords({
    inputMode: 'live-public',
    inputFilePath: null,
    records,
    rejectAllSkipped: true,
    extra: {
      liveProvider: 'curated-company-newsrooms',
      targetsFilePath: resolvedPath,
      crawlSuccesses: records.length,
      crawlErrors,
    },
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

function mapCrawledNewsroomRecord(record) {
  return {
    company_name: record.company_name,
    company_domain: record.company_domain,
    company_website_url: record.company_website_url,
    source_url: record.page_url,
    headline: record.page_title,
    title: record.page_title,
    summary: record.summary,
    event_type: inferNewsroomEventType(record.signals),
    publisher: 'company-newsroom',
  };
}

function inferNewsroomEventType(signals) {
  return Array.isArray(signals) && signals.length > 0 ? signals[0] : 'company_news';
}
