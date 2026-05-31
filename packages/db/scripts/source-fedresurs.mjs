import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeContextEventRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'fedresurs';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'fedresurs_event',
  inputFileEnvName: 'FEDRESURS_INPUT_FILE',
  usageText: 'Input: set FEDRESURS_INPUT_FILE or provider env. Public site scraping is not supported.',
  normalizeRecord: (record, context) => normalizeContextEventRecord(record, context, {
    sourceRecordType: 'fedresurs_event',
    defaultEventType: 'corporate_event',
    contextOnly: true,
    useLegalOrgExternalId: true,
  }),
});

export function resolveFedresursInput() {
  const inputFilePath = process.env.FEDRESURS_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.FEDRESURS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.FEDRESURS_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No input configured for fedresurs. Set FEDRESURS_INPUT_FILE or FEDRESURS_PROVIDER_API_URL + FEDRESURS_PROVIDER_API_TOKEN.');
}

export const resolveFedresursConfiguredInput = resolveFedresursInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runFedresursCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveFedresursConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runFedresursCli();
}
