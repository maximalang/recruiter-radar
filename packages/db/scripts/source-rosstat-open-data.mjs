import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import { extractSourceSection, normalizeRosstatOpenDataRecord } from './adapters/government-open-data.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));
const runtime = createStandardSourceRuntime({
  sourceId: 'rosstat-open-data', signalType: 'other', evidenceRole: 'context', sourceRecordType: 'aggregate_statistic',
  inputFileEnvName: 'ROSSTAT_OPEN_DATA_INPUT_FILE',
  usageText: 'Set ROSSTAT_OPEN_DATA_INPUT_FILE to a reviewed official aggregate snapshot. Company attribution is prohibited.',
  extractRecords: (parsed) => extractSourceSection(parsed, 'rosstat'),
  normalizeRecord: normalizeRosstatOpenDataRecord,
});
export function resolveRosstatOpenDataInput() { const path = process.env.ROSSTAT_OPEN_DATA_INPUT_FILE?.trim(); if (path) return runtime.resolveFileInput(path); throw new Error('No official Rosstat aggregate snapshot configured. Set ROSSTAT_OPEN_DATA_INPUT_FILE.'); }
export const resolveRosstatOpenDataConfiguredInput = resolveRosstatOpenDataInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runRosstatOpenDataCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveRosstatOpenDataConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runRosstatOpenDataCli();
