import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import {
  deriveFnsOpenDataEvents,
  extractSourceSection,
  normalizeFnsOpenDataRecord,
  parseGovernmentEnrichmentInns,
} from './adapters/government-open-data.mjs';
import { resolveSnapshotInputFile } from './adapters/snapshot-activation.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));
const SOURCE_ID = 'fns-open-data';

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'fns_open_data_context',
  inputFileEnvName: 'FNS_OPEN_DATA_INPUT_FILE',
  usageText: 'Set FNS_OPEN_DATA_INPUT_FILE to one reviewed bulk snapshot covering all tracked companies; GOVERNMENT_ENRICHMENT_INNS is derived from the database.',
  extractRecords: (parsed) => deriveFnsOpenDataEvents(
    extractSourceSection(parsed, 'fns', parseGovernmentEnrichmentInns()),
  ),
  normalizeRecord: normalizeFnsOpenDataRecord,
});

export function resolveFnsOpenDataInput() {
  const input = resolveSnapshotInputFile(SOURCE_ID, 'FNS_OPEN_DATA_INPUT_FILE');
  if (input) return runtime.resolveFileInput(input.inputFilePath);
  throw new Error('No active official FNS bulk snapshot. Run snapshot sync/activation; FNS_OPEN_DATA_INPUT_FILE is override-only.');
}

export const resolveFnsOpenDataConfiguredInput = resolveFnsOpenDataInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runFnsOpenDataCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveFnsOpenDataConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runFnsOpenDataCli();
