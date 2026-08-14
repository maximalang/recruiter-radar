/**
 * Habr Career source script.
 *
 * Compliant fetch modes:
 *   1. File mode: a reviewed, lawfully obtained snapshot.
 *   2. Provider mode: an explicitly permitted partner API.
 *
 * Direct commercial HTML collection is intentionally disabled. Habr Career's
 * current agreement restricts copying and commercial use without permission;
 * robots.txt path access is not an independent commercial-use grant.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  usageText: 'Input: set HABR_CAREER_INPUT_FILE for a reviewed snapshot, or HABR_CAREER_PROVIDER_API_URL + token for an explicitly permitted provider.',
  extractProviderRecords: extractHabrCareerRecords,
  normalizeRecord: (record, context) => normalizeJobPostingRecord(record, context, { defaultBoard: SOURCE_ID }),
});

/**
 * Resolve a reviewed snapshot or explicitly permitted provider input.
 */
export function resolveHabrCareerInput() {
  const inputFilePath = process.env.HABR_CAREER_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);

  const providerUrl = process.env.HABR_CAREER_PROVIDER_API_URL?.trim();
  const providerToken = process.env.HABR_CAREER_PROVIDER_API_TOKEN?.trim();
  if (providerUrl && providerToken) {
    return runtime.resolveProviderInput({ providerUrl, providerToken, providerLabel: `${SOURCE_ID} provider` });
  }

  throw new Error('No compliant input configured for habr-career. Set HABR_CAREER_INPUT_FILE for a reviewed snapshot, or HABR_CAREER_PROVIDER_API_URL + HABR_CAREER_PROVIDER_API_TOKEN for an explicitly permitted provider. Direct commercial HTML collection is disabled.');
}

export async function resolveHabrCareerConfiguredInput() {
  return resolveHabrCareerInput();
}

export const buildFetchSummary = runtime.buildFetchSummary;

export async function runHabrCareerCli(argv = process.argv.slice(2)) {
  await runScriptCli('source-habr-career', async () => {
    await runtime.runCli(argv, resolveHabrCareerConfiguredInput);
  });
}

/** Extract records from a generic permitted-provider response wrapper. */
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
