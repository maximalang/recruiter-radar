import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import { extractSourceSection, normalizeRosstatOpenDataRecord } from './adapters/government-open-data.mjs';
import { resolveSnapshotInputFile } from './adapters/snapshot-activation.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));
const runtime = createStandardSourceRuntime({
  sourceId: 'rosstat-open-data', signalType: 'other', evidenceRole: 'context', sourceRecordType: 'aggregate_statistic',
  inputFileEnvName: 'ROSSTAT_OPEN_DATA_INPUT_FILE',
  usageText: 'Set ROSSTAT_OPEN_DATA_INPUT_FILE to a reviewed official aggregate snapshot. Company attribution is prohibited.',
  extractRecords: (parsed) => extractSourceSection(parsed, 'rosstat'),
  normalizeRecord: normalizeRosstatOpenDataRecord,
});
export function resolveRosstatOpenDataInput() { const input = resolveSnapshotInputFile('rosstat-open-data', 'ROSSTAT_OPEN_DATA_INPUT_FILE'); if (input) return runtime.resolveFileInput(input.inputFilePath); throw new Error('No active official Rosstat aggregate snapshot. Run snapshot sync/activation; ROSSTAT_OPEN_DATA_INPUT_FILE is override-only.'); }
export const resolveRosstatOpenDataConfiguredInput = resolveRosstatOpenDataInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runRosstatOpenDataCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveRosstatOpenDataConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runRosstatOpenDataCli();
