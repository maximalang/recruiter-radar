import { createPlannedSourceActionEntrypoint } from './source-family-script-template.mjs';

export const SOURCE_FAMILY_ID = 'tech-job-boards';
export const SOURCE_FAMILY_KIND = 'job-board';
export const SOURCE_FAMILY_DESCRIPTION = 'Specialized tech job boards beyond HH.';
const SCRIPT_PATH = './packages/db/scripts/source-tech-job-boards.mjs';

export const runTechJobBoardsFetch = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'fetch',
  scriptPath: SCRIPT_PATH,
});

export const runTechJobBoardsIngest = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'ingest',
  scriptPath: SCRIPT_PATH,
});

export const runTechJobBoardsPipeline = createPlannedSourceActionEntrypoint({
  sourceId: SOURCE_FAMILY_ID,
  action: 'pipeline',
  scriptPath: SCRIPT_PATH,
});

export default Object.freeze({
  fetch: runTechJobBoardsFetch,
  ingest: runTechJobBoardsIngest,
  pipeline: runTechJobBoardsPipeline,
});
