import { createPlannedSourceActionEntrypoint } from './source-family-script-template.mjs';

export const SOURCE_FAMILY_ID = 'funding-business-signals';
export const SOURCE_FAMILY_KIND = 'business-signal';
export const SOURCE_FAMILY_DESCRIPTION = 'Funding, hiring, growth, and other business signals.';
const SCRIPT_PATH = './packages/db/scripts/source-funding-business-signals.mjs';

export const runFundingBusinessSignalsFetch = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'fetch',
  scriptPath: SCRIPT_PATH,
});

export const runFundingBusinessSignalsIngest = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'ingest',
  scriptPath: SCRIPT_PATH,
});

export const runFundingBusinessSignalsPipeline = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'pipeline',
  scriptPath: SCRIPT_PATH,
});

export default Object.freeze({
  fetch: runFundingBusinessSignalsFetch,
  ingest: runFundingBusinessSignalsIngest,
  pipeline: runFundingBusinessSignalsPipeline,
});
