import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import { extractSourceSection, normalizeRospatentOpenDataRecord, parseGovernmentEnrichmentInns } from './adapters/government-open-data.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));
const runtime = createStandardSourceRuntime({
  sourceId: 'rospatent-open-data', signalType: 'other', evidenceRole: 'context', sourceRecordType: 'intellectual_property_record',
  inputFileEnvName: 'ROSPATENT_OPEN_DATA_INPUT_FILE',
  usageText: 'Set ROSPATENT_OPEN_DATA_INPUT_FILE to one reviewed official registry snapshot; tracked legal-entity INNs are selected automatically.',
  extractRecords: (parsed) => extractSourceSection(parsed, 'rospatent', parseGovernmentEnrichmentInns()),
  normalizeRecord: normalizeRospatentOpenDataRecord,
});
export function resolveRospatentOpenDataInput() { const path = process.env.ROSPATENT_OPEN_DATA_INPUT_FILE?.trim(); if (path) return runtime.resolveFileInput(path); throw new Error('No official Rospatent snapshot configured. Set ROSPATENT_OPEN_DATA_INPUT_FILE; per-company JSON files are not supported.'); }
export const resolveRospatentOpenDataConfiguredInput = resolveRospatentOpenDataInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runRospatentOpenDataCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveRospatentOpenDataConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runRospatentOpenDataCli();
