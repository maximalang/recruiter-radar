import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStandardSourceRuntime, loadEnvFile } from './adapters/rf-source-runtime.mjs';
import {
  deriveGovernmentProcurementEvents,
  extractSourceSection,
  normalizeGovernmentProcurementRecord,
  parseGovernmentEnrichmentInns,
} from './adapters/government-open-data.mjs';
import { resolveSnapshotInputFile } from './adapters/snapshot-activation.mjs';

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
  const input = resolveSnapshotInputFile(SOURCE_ID, 'GOVERNMENT_PROCUREMENT_INPUT_FILE');
  if (input) return { ...runtime.resolveFileInput(input.inputFilePath), inputMode: input.mode === 'active-snapshot' ? input.mode : 'file' };
  throw new Error('No active official EIS/Treasury snapshot. Run snapshot sync/activation; GOVERNMENT_PROCUREMENT_INPUT_FILE is override-only.');
}
export const resolveGovernmentProcurementConfiguredInput = resolveGovernmentProcurementInput;
export const buildFetchSummary = runtime.buildFetchSummary;
export async function runGovernmentProcurementCli(argv = process.argv.slice(2)) { await runtime.runCli(argv, resolveGovernmentProcurementConfiguredInput); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runGovernmentProcurementCli();
