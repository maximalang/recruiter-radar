import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeContextEventRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'industry-media';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'industry_media_item',
  inputFileEnvName: 'INDUSTRY_MEDIA_INPUT_FILE',
  usageText: 'Input: set INDUSTRY_MEDIA_INPUT_FILE or provider env. Media signals are context-only after manual source review.',
  normalizeRecord: (record, context) => normalizeContextEventRecord(record, context, {
    sourceRecordType: 'industry_media_item',
    defaultEventType: 'industry_context',
    contextOnly: true,
  }),
});

export function resolveIndustryMediaInput() {
  const inputFilePath = process.env.INDUSTRY_MEDIA_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.INDUSTRY_MEDIA_PROVIDER_API_URL?.trim();
  const providerToken = process.env.INDUSTRY_MEDIA_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No input configured for industry-media. Set INDUSTRY_MEDIA_INPUT_FILE or provider env.');
}

export const resolveIndustryMediaConfiguredInput = resolveIndustryMediaInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runIndustryMediaCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveIndustryMediaConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runIndustryMediaCli();
}
