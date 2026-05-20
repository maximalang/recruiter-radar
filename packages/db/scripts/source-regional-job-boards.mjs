import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'regional-job-boards';

loadEnvFile(rootEnvPath);

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'job_posting',
  evidenceRole: 'primary_platform',
  sourceRecordType: 'job_posting',
  inputFileEnvName: 'REGIONAL_JOB_BOARDS_INPUT_FILE',
  usageText: 'Input: set REGIONAL_JOB_BOARDS_INPUT_FILE or provider env after legal/robots review.',
  normalizeRecord: (record, context) => normalizeJobPostingRecord(record, context, { defaultBoard: 'regional-job-board' }),
});

export function resolveRegionalJobBoardsInput() {
  const inputFilePath = process.env.REGIONAL_JOB_BOARDS_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.REGIONAL_JOB_BOARDS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.REGIONAL_JOB_BOARDS_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No input configured for regional-job-boards. Set REGIONAL_JOB_BOARDS_INPUT_FILE or provider env.');
}

export const resolveRegionalJobBoardsConfiguredInput = resolveRegionalJobBoardsInput;
export const buildFetchSummary = runtime.buildFetchSummary;

export async function runRegionalJobBoardsCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveRegionalJobBoardsConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRegionalJobBoardsCli();
}
