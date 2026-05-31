import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';

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
  usageText: 'Input: set SUPERJOB_INPUT_FILE or SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID.',
  extractProviderRecords: extractSuperjobRecords,
  normalizeRecord: (record, context) => normalizeJobPostingRecord(record, context, { defaultBoard: 'superjob' }),
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

  throw new Error('No input configured for superjob. Set SUPERJOB_INPUT_FILE or SUPERJOB_PROVIDER_API_URL + SUPERJOB_API_APP_ID.');
}

export const resolveSuperjobConfiguredInput = resolveSuperjobInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runSuperjobCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveSuperjobConfiguredInput);
}

function extractSuperjobRecords(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.records)) return body.records;
  if (Array.isArray(body?.objects)) return body.objects;
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSuperjobCli();
}
