import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import {
  deriveGovernmentProcurementEvents,
  extractSourceSection,
  normalizeGovernmentProcurementRecord,
  parseGovernmentEnrichmentInns,
} from './adapters/government-open-data.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));
const SOURCE_ID = 'government-procurement';

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'government_contract_event',
  inputFileEnvName: 'GOVERNMENT_PROCUREMENT_INPUT_FILE',
  usageText: 'Set GOVERNMENT_PROCUREMENT_INPUT_FILE to one reviewed EIS/Treasury bulk snapshot; tracked supplier INNs are selected automatically.',
  extractRecords: (parsed) => deriveGovernmentProcurementEvents(
    extractSourceSection(parsed, 'procurement', parseGovernmentEnrichmentInns()),
    { largeContractThreshold: process.env.GOVERNMENT_PROCUREMENT_LARGE_RUB },
  ),
  normalizeRecord: normalizeGovernmentProcurementRecord,
});

export function resolveGovernmentProcurementInput() {
  const inputFilePath = process.env.GOVERNMENT_PROCUREMENT_INPUT_FILE?.trim();
  if (inputFilePath) return runtime.resolveFileInput(inputFilePath);
  throw new Error('No official EIS/Treasury bulk snapshot configured. Set GOVERNMENT_PROCUREMENT_INPUT_FILE; per-company JSON files are not supported.');
}
export const resolveGovernmentProcurementConfiguredInput = resolveGovernmentProcurementInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runGovernmentProcurementCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveGovernmentProcurementConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runGovernmentProcurementCli();
