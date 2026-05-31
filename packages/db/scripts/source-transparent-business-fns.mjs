import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeRegistryRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'transparent-business-fns';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'enrichment',
  sourceRecordType: 'registry_reference',
  inputFileEnvName: 'TRANSPARENT_BUSINESS_FNS_INPUT_FILE',
  usageText: 'Input: set TRANSPARENT_BUSINESS_FNS_INPUT_FILE or provider env. Direct pb.nalog.ru scraping is not supported.',
  normalizeRecord: (record, context) => normalizeRegistryRecord(record, context, {
    sourceRecordType: 'transparent_business_reference',
  }),
});

export function resolveTransparentBusinessFnsInput() {
  const inputFilePath = process.env.TRANSPARENT_BUSINESS_FNS_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No input configured for transparent-business-fns. Set TRANSPARENT_BUSINESS_FNS_INPUT_FILE or TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL + TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN.');
}

export const resolveTransparentBusinessFnsConfiguredInput = resolveTransparentBusinessFnsInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runTransparentBusinessFnsCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveTransparentBusinessFnsConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runTransparentBusinessFnsCli();
}
