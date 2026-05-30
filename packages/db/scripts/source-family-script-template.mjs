import { createSourceActionNotImplementedError } from './source-family-runner.mjs';

export function createPlannedSourceActionEntrypoint({ sourceId, action, scriptPath }) {
  return async () => {
    throw createSourceActionNotImplementedError({
      sourceId,
      action,
      scriptPath,
    });
  };
}
