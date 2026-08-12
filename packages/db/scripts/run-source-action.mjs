import { pathToFileURL } from 'node:url';

import { SOURCE_ACTIONS } from './source-contract.mjs';
import {
  executeSourceAction,
  listPrimaryIngestionSourceIds,
  listSourceSummaries,
} from './source-registry.mjs';
import { recordSourceActionTelemetry } from './lib/product-telemetry.mjs';

export function formatSourceActionResult(command, source, result) {
  if (source.id === 'hh' && command === 'pipeline') {
    return [
      `source: ${source.id}`,
      `vacancies ingested: ${result.summary.vacanciesIngested}`,
      `digest companies count: ${result.summary.digestCompaniesCount}`,
    ];
  }

  if (result.summary && typeof result.summary === 'object') {
    return [JSON.stringify(result.summary, null, 2)];
  }

  if (typeof result.stdout === 'string' && result.stdout.trim() !== '') {
    return [result.stdout.trimEnd()];
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

  if (requestedSourceId === 'primary') {
    const sourceIds = listPrimaryIngestionSourceIds();
    const results = await Promise.all(sourceIds.map((sourceId) => (
      executeAndRecordSourceAction(sourceId, requestedCommand)
    )));
    const ok = results.every((result) => result.ok);

    console.log(JSON.stringify({
      action: requestedCommand,
      scope: 'primary',
      ok,
      sourceCount: results.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      sources: results,
    }, null, 2));

    if (!ok) process.exitCode = 1;
    return;
  }

  try {
    const actionResult = await executeAndRecordSourceAction(requestedSourceId, requestedCommand);
    sourceIdForError = actionResult.source;

    if (!actionResult.ok) {
      throw new Error(actionResult.error);
    }

    for (const line of actionResult.output) {
      console.log(line);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${sourceIdForError.toUpperCase()} ${requestedCommand} failed: ${message}`);
    process.exitCode = 1;
  }
}

async function executeAndRecordSourceAction(sourceId, action) {
  const startedAt = Date.now();

  try {
    const { source, result } = await executeSourceAction(sourceId, action);
    await recordSourceActionTelemetry({
      sourceId: source.id,
      action,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
    return {
      source: source.id,
      ok: true,
      summary: result.summary ?? null,
      output: formatSourceActionResult(action, source, result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSourceActionTelemetry({
      sourceId,
      action,
      ok: false,
      durationMs: Date.now() - startedAt,
    });
    return { source: sourceId, ok: false, error: message, output: [] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSourceActionCli();
}
