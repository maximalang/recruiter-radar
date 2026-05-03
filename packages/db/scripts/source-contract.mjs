export const SOURCE_KINDS = Object.freeze([
  'job-board',
  'career-page',
  'professional-network',
  'company-registry',
  'company-site',
  'business-signal',
]);

export const SOURCE_CLASSES = Object.freeze([
  'primary-platform',
  'company-surface',
  'registry-reference',
  'market-signal',
]);

export const EVIDENCE_TIERS = Object.freeze([
  'high-signal',
  'medium-signal',
  'context-only',
]);

export const SOURCE_STATUSES = Object.freeze(['active', 'planned']);
export const SOURCE_STATUS_SEMANTICS = Object.freeze({
  active: Object.freeze({
    runnable: true,
    description: 'Implemented source family with executable actions.',
  }),
  planned: Object.freeze({
    runnable: false,
    description: 'Metadata-only source family placeholder; no executable actions yet.',
  }),
});
export const SOURCE_ACTIONS = Object.freeze(['fetch', 'ingest', 'pipeline']);
export const SOURCE_CAPABILITIES = Object.freeze([...SOURCE_ACTIONS]);
export const SOURCE_ACTION_SEMANTICS = Object.freeze({
  fetch: Object.freeze({
    capability: 'fetch',
    description: 'Collect raw source material without mutating app-layer state.',
  }),
  ingest: Object.freeze({
    capability: 'ingest',
    description: 'Normalize fetched material into recruiter-radar storage contracts.',
  }),
  pipeline: Object.freeze({
    capability: 'pipeline',
    description: 'Run the source family end-to-end orchestration for this source.',
  }),
});

export function defineSource(source) {
  assertSource(source);

  const status = source.status ?? 'active';
  const capabilities = source.capabilities ?? [];
  const sourceClass = source.sourceClass ?? inferSourceClass(source.kind);
  const evidenceTier = source.evidenceTier ?? inferEvidenceTier(source.kind);
  const defaultConfidence = source.defaultConfidence ?? inferDefaultConfidence(source.kind);
  const scripts = freezeRecord(source.scripts ?? {});
  const actionMap = freezeActionMap(
    source.actionMap ?? createActionMap({ status, capabilities, scripts }),
  );

  return Object.freeze({
    ...source,
    status,
    sourceClass,
    evidenceTier,
    defaultConfidence,
    runnable: SOURCE_STATUS_SEMANTICS[status].runnable,
    capabilities: Object.freeze([...capabilities]),
    scripts,
    actionMap,
    runner: Object.freeze({
      ...(source.runner ?? {}),
    }),
  });
}

export function assertSource(source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('Source definition must be an object.');
  }

  assertNonEmptyString(source.id, 'Source id');
  assertNonEmptyString(source.kind, `Source ${source.id} kind`);

  if (!SOURCE_KINDS.includes(source.kind)) {
    throw new TypeError(
      `Source ${source.id} kind must be one of: ${SOURCE_KINDS.join(', ')}.`,
    );
  }

  const status = source.status ?? 'active';

  if (!SOURCE_STATUSES.includes(status)) {
    throw new TypeError(
      `Source ${source.id} status must be one of: ${SOURCE_STATUSES.join(', ')}.`,
    );
  }

  const sourceClass = source.sourceClass ?? inferSourceClass(source.kind);

  if (!SOURCE_CLASSES.includes(sourceClass)) {
    throw new TypeError(
      `Source ${source.id} sourceClass must be one of: ${SOURCE_CLASSES.join(', ')}.`,
    );
  }

  const evidenceTier = source.evidenceTier ?? inferEvidenceTier(source.kind);

  if (!EVIDENCE_TIERS.includes(evidenceTier)) {
    throw new TypeError(
      `Source ${source.id} evidenceTier must be one of: ${EVIDENCE_TIERS.join(', ')}.`,
    );
  }

  assertConfidence(source.defaultConfidence ?? inferDefaultConfidence(source.kind), source.id);

  const capabilities = source.capabilities ?? [];

  if (!Array.isArray(capabilities)) {
    throw new TypeError(`Source ${source.id} capabilities must be an array.`);
  }

  for (const capability of capabilities) {
    assertNonEmptyString(capability, `Source ${source.id} capability`);

    if (!SOURCE_CAPABILITIES.includes(capability)) {
      throw new TypeError(
        `Source ${source.id} capability must be one of: ${SOURCE_CAPABILITIES.join(', ')}.`,
      );
    }
  }

  if (source.runner !== undefined && (!source.runner || typeof source.runner !== 'object')) {
    throw new TypeError(`Source ${source.id} runner must be an object.`);
  }

  for (const action of capabilities) {
    assertRunnerHook(source.id, source.runner?.[action], action);
  }

  if (source.runner) {
    for (const [action, hook] of Object.entries(source.runner)) {
      assertRunnerHook(source.id, hook, action);
    }
  }

  if (source.scripts !== undefined) {
    assertRecordOfStrings(source.id, source.scripts, 'scripts');
  }

  if (source.actionMap !== undefined) {
    assertActionMap(source.id, source.actionMap, capabilities, status);
  }
}

export function createActionMap(configOrScripts = {}) {
  const { status, capabilities, scripts } = normalizeActionMapConfig(configOrScripts);
  const runnable = SOURCE_STATUS_SEMANTICS[status].runnable;

  return Object.freeze(
    SOURCE_ACTIONS.reduce((actionMap, action) => {
      const supported = capabilities.includes(action);
      actionMap[action] = Object.freeze({
        capability: SOURCE_ACTION_SEMANTICS[action].capability,
        supported,
        runnable: runnable && supported,
        script: supported ? scripts[action] ?? null : null,
      });
      return actionMap;
    }, {}),
  );
}

function freezeActionMap(actionMap) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(actionMap).map(([action, config]) => [
        action,
        Object.freeze({ ...config }),
      ]),
    ),
  );
}

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

function normalizeActionMapConfig(configOrScripts) {
  if (
    configOrScripts
    && typeof configOrScripts === 'object'
    && !Array.isArray(configOrScripts)
    && ('status' in configOrScripts || 'capabilities' in configOrScripts || 'scripts' in configOrScripts)
  ) {
    return {
      status: configOrScripts.status ?? 'active',
      capabilities: configOrScripts.capabilities ?? [],
      scripts: configOrScripts.scripts ?? {},
    };
  }

  return {
    status: 'active',
    capabilities: SOURCE_ACTIONS.filter((action) => Boolean(configOrScripts?.[action])),
    scripts: configOrScripts ?? {},
  };
}

function assertActionMap(sourceId, actionMap, capabilities, status) {
  if (!actionMap || typeof actionMap !== 'object' || Array.isArray(actionMap)) {
    throw new TypeError(`Source ${sourceId} actionMap must be an object.`);
  }

  for (const action of SOURCE_ACTIONS) {
    const config = actionMap[action];

    if (!config || typeof config !== 'object') {
      throw new TypeError(`Source ${sourceId} actionMap.${action} must be an object.`);
    }

    if (config.capability !== SOURCE_ACTION_SEMANTICS[action].capability) {
      throw new TypeError(
        `Source ${sourceId} actionMap.${action}.capability must be ${SOURCE_ACTION_SEMANTICS[action].capability}.`,
      );
    }

    if (typeof config.supported !== 'boolean') {
      throw new TypeError(`Source ${sourceId} actionMap.${action}.supported must be a boolean.`);
    }

    if (config.supported !== capabilities.includes(action)) {
      throw new TypeError(
        `Source ${sourceId} actionMap.${action}.supported must match declared capabilities.`,
      );
    }

    if (typeof config.runnable !== 'boolean') {
      throw new TypeError(`Source ${sourceId} actionMap.${action}.runnable must be a boolean.`);
    }

    if (config.runnable !== (SOURCE_STATUS_SEMANTICS[status].runnable && capabilities.includes(action))) {
      throw new TypeError(
        `Source ${sourceId} actionMap.${action}.runnable must match source status and declared capabilities.`,
      );
    }

    if (config.script !== null && config.script !== undefined) {
      assertNonEmptyString(config.script, `Source ${sourceId} actionMap.${action}.script`);
    }

    if (capabilities.includes(action) && !config.script) {
      throw new TypeError(
        `Source ${sourceId} actionMap.${action}.script must be set for supported actions.`,
      );
    }

    if (!capabilities.includes(action) && config.script) {
      throw new TypeError(
        `Source ${sourceId} actionMap.${action}.script must be null for unsupported actions.`,
      );
    }
  }
}

function inferSourceClass(kind) {
  switch (kind) {
    case 'job-board':
    case 'professional-network':
      return 'primary-platform';
    case 'career-page':
    case 'company-site':
      return 'company-surface';
    case 'company-registry':
      return 'registry-reference';
    case 'business-signal':
      return 'market-signal';
    default:
      throw new TypeError(`Unable to infer sourceClass for kind: ${kind}`);
  }
}

function inferEvidenceTier(kind) {
  switch (kind) {
    case 'career-page':
    case 'company-registry':
      return 'high-signal';
    case 'job-board':
    case 'professional-network':
    case 'company-site':
      return 'medium-signal';
    case 'business-signal':
      return 'context-only';
    default:
      throw new TypeError(`Unable to infer evidenceTier for kind: ${kind}`);
  }
}

function inferDefaultConfidence(kind) {
  switch (kind) {
    case 'career-page':
      return 0.92;
    case 'company-registry':
      return 0.9;
    case 'job-board':
      return 0.74;
    case 'professional-network':
      return 0.72;
    case 'company-site':
      return 0.68;
    case 'business-signal':
      return 0.58;
    default:
      throw new TypeError(`Unable to infer defaultConfidence for kind: ${kind}`);
  }
}

function assertRecordOfStrings(sourceId, record, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(`Source ${sourceId} ${label} must be an object.`);
  }

  for (const [key, value] of Object.entries(record)) {
    assertNonEmptyString(value, `Source ${sourceId} ${label}.${key}`);
  }
}

function assertRunnerHook(sourceId, hook, hookName) {
  if (typeof hook !== 'function') {
    throw new TypeError(`Source ${sourceId} runner.${hookName} must be a function.`);
  }
}

function assertConfidence(value, sourceId) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new TypeError(`Source ${sourceId} defaultConfidence must be a finite number between 0 and 1.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}
