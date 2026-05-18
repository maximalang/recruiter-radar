import { SOURCE_ACTIONS, createActionMap } from './source-contract.mjs';

export function createPlannedSourceFamily({ id, kind, description, scripts }) {
  return {
    id,
    kind,
    status: 'planned',
    description,
    capabilities: SOURCE_ACTIONS,
    scripts,
    actionMap: createActionMap(scripts),
    runner: createPlannedFamilyRunner({ id, scripts }),
  };
}

export function createPlannedFamilyRunner({ id, scripts }) {
  return Object.freeze(
    SOURCE_ACTIONS.reduce((runner, action) => {
      runner[action] = () => {
        throw createSourceActionNotImplementedError({
          sourceId: id,
          action,
          scriptPath: scripts[action],
        });
      };
      return runner;
    }, {}),
  );
}

export function createSourceActionNotImplementedError({ sourceId, action, scriptPath }) {
  const error = new Error(
    `Source ${sourceId} action ${action} is scaffolded only and must be implemented in ${scriptPath}.`,
  );

  error.code = 'SOURCE_ACTION_NOT_IMPLEMENTED';
  error.sourceId = sourceId;
  error.action = action;
  error.scriptPath = scriptPath;

  return error;
}
