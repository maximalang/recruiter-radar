import { createPlannedSourceActionEntrypoint } from './source-family-script-template.mjs';

export const SOURCE_FAMILY_ID = 'company-site';
export const SOURCE_FAMILY_KIND = 'company-site';
export const SOURCE_FAMILY_DESCRIPTION = 'Direct company websites outside dedicated careers sections.';
const SCRIPT_PATH = './packages/db/scripts/source-company-site.mjs';

export const runCompanySiteFetch = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'fetch',
  scriptPath: SCRIPT_PATH,
});

export const runCompanySiteIngest = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'ingest',
  scriptPath: SCRIPT_PATH,
});

export const runCompanySitePipeline = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'pipeline',
  scriptPath: SCRIPT_PATH,
});

export default Object.freeze({
  fetch: runCompanySiteFetch,
  ingest: runCompanySiteIngest,
  pipeline: runCompanySitePipeline,
});
