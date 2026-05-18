import { createPlannedSourceActionEntrypoint } from './source-family-script-template.mjs';

export const SOURCE_FAMILY_ID = 'linkedin-company-pages';
export const SOURCE_FAMILY_KIND = 'professional-network';
export const SOURCE_FAMILY_DESCRIPTION = 'LinkedIn company pages and related employer surfaces.';
const SCRIPT_PATH = './packages/db/scripts/source-linkedin-company-pages.mjs';

export const runLinkedinCompanyPagesFetch = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'fetch',
  scriptPath: SCRIPT_PATH,
});

export const runLinkedinCompanyPagesIngest = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'ingest',
  scriptPath: SCRIPT_PATH,
});

export const runLinkedinCompanyPagesPipeline = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'pipeline',
  scriptPath: SCRIPT_PATH,
});

export default Object.freeze({
  fetch: runLinkedinCompanyPagesFetch,
  ingest: runLinkedinCompanyPagesIngest,
  pipeline: runLinkedinCompanyPagesPipeline,
});
