/**
 * Canonical source extraction escalation contract.
 *
 * Stages are intentionally capability-oriented rather than vendor-oriented.
 * A caller may supply an official API/feed, static fetch, structured parser,
 * rendered DOM worker, and Crawl4AI/Firecrawl extractor. Access denial and
 * upstream rate limiting are terminal policy outcomes: later stages are not a
 * mechanism for bypassing robots, terms, WAF, captcha, or access controls.
 */

export const SOURCE_ESCALATION_STAGES = Object.freeze([
  'official-feed',
  'static-http',
  'structured-data',
  'rendered-dom',
  'extraction',
]);

const ACCESS_DENIED_STATUSES = new Set([401, 403, 407, 451]);

export async function runSourceEscalation({
  stages,
  validateRecord,
  context = {},
  stageOrder,
}) {
  if (!stages || typeof stages !== 'object') {
    throw new TypeError('source escalation requires a stages object');
  }
  if (typeof validateRecord !== 'function') {
    throw new TypeError('source escalation requires deterministic validateRecord');
  }

  const attempts = [];
  let artifact = null;
  const resolvedStageOrder = resolveStageOrder(stages, stageOrder);

  for (const stage of resolvedStageOrder) {
    const handler = stages[stage];
    if (typeof handler !== 'function') continue;

    let response;
    try {
      response = normalizeResponse(await handler({
        ...context,
        artifact,
        attempts: [...attempts],
        stage,
      }));
    } catch (error) {
      const httpStatus = Number.isInteger(Number(error?.status)) ? Number(error.status) : null;
      const blocked = Boolean(
        error?.accessDenied
        || error?.captcha
        || error?.waf
        || ACCESS_DENIED_STATUSES.has(httpStatus),
      );
      const deferred = httpStatus === 429;
      attempts.push({
        stage,
        outcome: blocked ? 'blocked' : deferred ? 'deferred' : 'error',
        httpStatus,
        records: 0,
        rejectedRecords: 0,
        reason: boundedReason(error?.message),
      });
      if (blocked || deferred) return emptyResult(attempts, artifact, true);
      continue;
    }

    if (response.artifact !== undefined && response.artifact !== null) {
      artifact = response.artifact;
    }

    const terminalOutcome = resolveTerminalOutcome(response);
    if (terminalOutcome) {
      attempts.push(buildAttempt(stage, terminalOutcome, response, 0, 0));
      return emptyResult(attempts, artifact, terminalOutcome !== 'not-modified');
    }

    const candidates = Array.isArray(response.records) ? response.records : [];
    const accepted = [];
    let rejectedRecords = 0;
    for (const record of candidates) {
      let valid = false;
      try {
        valid = validateRecord(record, { stage, context }) === true;
      } catch {
        valid = false;
      }
      if (valid) accepted.push(record);
      else rejectedRecords += 1;
    }

    if (accepted.length > 0) {
      attempts.push(buildAttempt(stage, 'parsed', response, accepted.length, rejectedRecords));
      return {
        selectedStage: stage,
        records: accepted,
        attempts,
        artifact,
        stoppedByPolicy: false,
      };
    }

    const outcome = candidates.length > 0
      ? 'validation-rejected'
      : response.status === 'error'
        ? 'error'
        : artifact !== null
          ? 'artifact-only'
          : 'empty';
    attempts.push(buildAttempt(stage, outcome, response, 0, rejectedRecords));
    if (response.terminal === true) return emptyResult(attempts, artifact, true);
  }

  return emptyResult(attempts, artifact, false);
}

function resolveStageOrder(stages, stageOrder) {
  const activeStages = SOURCE_ESCALATION_STAGES.filter((stage) => typeof stages[stage] === 'function');
  if (stageOrder === undefined || stageOrder === null) return activeStages;
  if (!Array.isArray(stageOrder)) throw new TypeError('source escalation stageOrder must be an array');

  const normalized = [];
  const seen = new Set();
  for (const stage of stageOrder) {
    if (!SOURCE_ESCALATION_STAGES.includes(stage)) {
      throw new TypeError(`source escalation stageOrder contains unsupported stage: ${stage}`);
    }
    if (!seen.has(stage)) {
      seen.add(stage);
      normalized.push(stage);
    }
  }

  const missing = activeStages.filter((stage) => !seen.has(stage));
  if (missing.length > 0) {
    throw new TypeError(`source escalation stageOrder must include every active stage: missing ${missing.join(', ')}`);
  }
  return normalized;
}

function normalizeResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function resolveTerminalOutcome(response) {
  const httpStatus = Number(response.httpStatus);
  if (response.status === 'not-modified') return 'not-modified';
  if (response.status === 'deferred' || httpStatus === 429) return 'deferred';
  if (
    response.status === 'blocked'
    || ACCESS_DENIED_STATUSES.has(httpStatus)
    || response.accessPolicy === 'denied'
    || response.robotsAllowed === false
    || response.captcha === true
    || response.waf === true
    || response.accessControl === true
  ) return 'blocked';
  return null;
}

function buildAttempt(stage, outcome, response, records, rejectedRecords) {
  return {
    stage,
    outcome,
    httpStatus: Number.isInteger(Number(response.httpStatus)) ? Number(response.httpStatus) : null,
    records,
    rejectedRecords,
    reason: boundedReason(response.reason),
  };
}

function emptyResult(attempts, artifact, stoppedByPolicy) {
  return {
    selectedStage: null,
    records: [],
    attempts,
    artifact,
    stoppedByPolicy,
  };
}

function boundedReason(value) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason ? reason.slice(0, 240) : null;
}
