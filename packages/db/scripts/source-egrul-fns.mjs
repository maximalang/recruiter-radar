import { createPlannedSourceActionEntrypoint } from './source-family-script-template.mjs';

export const SOURCE_FAMILY_ID = 'egrul-fns';
export const SOURCE_FAMILY_KIND = 'company-registry';
export const SOURCE_FAMILY_DESCRIPTION = 'EGRUL/FNS company registry data.';
const SCRIPT_PATH = './packages/db/scripts/source-egrul-fns.mjs';

export const runEgrulFnsFetch = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'fetch',
  scriptPath: SCRIPT_PATH,
});

export const runEgrulFnsIngest = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'ingest',
  scriptPath: SCRIPT_PATH,
});

export const runEgrulFnsPipeline = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'pipeline',
  scriptPath: SCRIPT_PATH,
});

export default Object.freeze({
  fetch: runEgrulFnsFetch,
  ingest: runEgrulFnsIngest,
  pipeline: runEgrulFnsPipeline,
});
