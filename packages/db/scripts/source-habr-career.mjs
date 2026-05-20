import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';

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
  usageText: 'Input: set HABR_CAREER_INPUT_FILE or provider env. Public HTML scraping requires separate legal/robots review.',
  normalizeRecord: (record, context) => normalizeJobPostingRecord(record, context, { defaultBoard: 'habr-career' }),
});

export function resolveHabrCareerInput() {
  const inputFilePath = process.env.HABR_CAREER_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.HABR_CAREER_PROVIDER_API_URL?.trim();
  const providerToken = process.env.HABR_CAREER_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No input configured for habr-career. Set HABR_CAREER_INPUT_FILE or Habr provider env.');
}

export const resolveHabrCareerConfiguredInput = resolveHabrCareerInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runHabrCareerCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveHabrCareerConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHabrCareerCli();
}
