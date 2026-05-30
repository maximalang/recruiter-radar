import { pathToFileURL } from 'node:url';

import { SOURCE_ACTIONS } from './source-contract.mjs';
import { executeSourceAction, listSourceSummaries } from './source-registry.mjs';

export function formatSourceActionResult(command, source, result) {
  if (source.id === 'hh' && command === 'pipeline') {
    return [
      `source: ${source.id}`,
      `vacancies ingested: ${result.summary.vacanciesIngested}`,
      `digest companies count: ${result.summary.digestCompaniesCount}`,
    ];
  }

  if (source.id === 'career-pages' && result.summary && typeof result.summary === 'object') {
    return [JSON.stringify(result.summary, null, 2)];
  }

  return [];
}

export async function runSourceActionCli(argv = process.argv.slice(2)) {
  const requestedCommand = argv[0]?.trim();
  const requestedSourceId = argv[1]?.trim() || 'hh';
  let sourceIdForError = requestedSourceId;

  if (!requestedCommand) {
    console.error(
      'Usage: node packages/db/scripts/run-source-action.mjs <list|fetch|ingest|pipeline> [sourceId=hh]\nTip: run `npm run source:list` to inspect source ids, statuses, and action support.',
    );
    process.exitCode = 1;
    return;
  }

  if (requestedCommand === 'list') {
    console.log(JSON.stringify(listSourceSummaries(), null, 2));
    return;
  }

  if (!SOURCE_ACTIONS.includes(requestedCommand)) {
    console.error(
      `Unknown source command: ${requestedCommand}. Run \`npm run source:list\` for valid source ids and capabilities.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const { source, result } = await executeSourceAction(requestedSourceId, requestedCommand);
    sourceIdForError = source.id;

    for (const line of formatSourceActionResult(requestedCommand, source, result)) {
      console.log(line);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${sourceIdForError.toUpperCase()} ${requestedCommand} failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSourceActionCli();
}
