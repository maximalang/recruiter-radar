const DEGRADED_OUTCOMES = new Set(['error', 'empty', 'validation-rejected']);
const POLICY_STOP_OUTCOMES = new Set(['blocked', 'deferred']);

export const DEFAULT_TRANSPORT_HEALTH_POLICY = Object.freeze({
  minWindowAttempts: 4,
  degradedFailureRate: 0.5,
  degradedConsecutiveFailures: 3,
  recoverySuccesses: 2,
});

/**
 * Derive acquisition health from bounded recent attempts. This is deliberately
 * transport-centric, so a source can degrade without being declared dead.
 *
 * Policy-stop outcomes (robots/access-control/captcha/WAF/429) are surfaced as
 * stoppedByPolicy and MUST NOT be used as permission to bypass the control with
 * a more aggressive transport.
 */
export function evaluateTransportHealth(attempts = [], policy = DEFAULT_TRANSPORT_HEALTH_POLICY) {
  const normalized = attempts
    .filter(Boolean)
    .map(normalizeAttempt)
    .filter((row) => row.stage && row.outcome)
    .sort((a, b) => a.atMs - b.atMs);

  const byStage = {};
  for (const stage of new Set(normalized.map((row) => row.stage))) {
    const stageAttempts = normalized.filter((row) => row.stage === stage);
    byStage[stage] = evaluateStage(stageAttempts, policy);
  }

  return Object.freeze({
    byStage: Object.freeze(byStage),
    degradedStages: Object.freeze(Object.entries(byStage).filter(([, health]) => health.degraded).map(([stage]) => stage)),
    policyStoppedStages: Object.freeze(Object.entries(byStage).filter(([, health]) => health.stoppedByPolicy).map(([stage]) => stage)),
  });
}

/**
 * Build a health-aware stage order while preserving hard dependencies.
 * `structured-data` consumes the artifact produced by `static-http`, so those
 * stages move as one dependency group. Reordering them independently would make
 * the fallback plan invalid and could manufacture false parser degradation.
 */
export function selectTransportStages(configuredStages, health) {
  if (!Array.isArray(configuredStages)) throw new TypeError('configuredStages must be an array');
  const stages = [...new Set(configuredStages.filter((stage) => typeof stage === 'string' && stage.trim()).map((stage) => stage.trim()))];
  const groups = buildDependencyGroups(stages);
  const healthyGroups = [];
  const degradedGroups = [];

  for (const group of groups) {
    for (const stage of group.stages) {
      const stageHealth = health?.byStage?.[stage];
      if (stageHealth?.stoppedByPolicy) {
        // Access policy is terminal for this acquisition surface. Caller must
        // switch to another lawful surface, not a more aggressive transport.
        return Object.freeze({ stages: Object.freeze([]), stoppedByPolicy: true, stoppedStage: stage });
      }
    }

    const degraded = group.stages.some((stage) => health?.byStage?.[stage]?.degraded === true);
    (degraded ? degradedGroups : healthyGroups).push(group);
  }

  return Object.freeze({
    stages: Object.freeze([...healthyGroups, ...degradedGroups].flatMap((group) => group.stages)),
    stoppedByPolicy: false,
    stoppedStage: null,
  });
}

function buildDependencyGroups(stages) {
  const groups = [];
  const seen = new Set();
  for (const stage of stages) {
    if (seen.has(stage)) continue;
    if (stage === 'static-http' || stage === 'structured-data') {
      const pair = stages.filter((candidate) => candidate === 'static-http' || candidate === 'structured-data');
      for (const item of pair) seen.add(item);
      groups.push({ key: 'static-structured', stages: pair });
      continue;
    }
    seen.add(stage);
    groups.push({ key: stage, stages: [stage] });
  }
  return groups;
}

function evaluateStage(attempts, policy) {
  const window = attempts.slice(-Math.max(policy.minWindowAttempts, 10));
  const policyStops = window.filter((row) => POLICY_STOP_OUTCOMES.has(row.outcome));
  const failures = window.filter((row) => DEGRADED_OUTCOMES.has(row.outcome));
  const successes = window.filter((row) => row.outcome === 'parsed' || row.outcome === 'not-modified');
  const failureRate = window.length > 0 ? failures.length / window.length : 0;
  const consecutiveFailures = countTrailing(window, (row) => DEGRADED_OUTCOMES.has(row.outcome));
  const consecutiveSuccesses = countTrailing(window, (row) => row.outcome === 'parsed' || row.outcome === 'not-modified');
  const enoughEvidence = window.length >= policy.minWindowAttempts;
  const degraded = enoughEvidence && (
    failureRate >= policy.degradedFailureRate
    || consecutiveFailures >= policy.degradedConsecutiveFailures
  ) && consecutiveSuccesses < policy.recoverySuccesses;

  return Object.freeze({
    attempts: window.length,
    successes: successes.length,
    failures: failures.length,
    failureRate,
    consecutiveFailures,
    consecutiveSuccesses,
    degraded,
    stoppedByPolicy: policyStops.length > 0 && POLICY_STOP_OUTCOMES.has(window.at(-1)?.outcome),
    lastOutcome: window.at(-1)?.outcome ?? null,
  });
}

function normalizeAttempt(attempt) {
  const atMs = Number.isFinite(Date.parse(attempt.at)) ? Date.parse(attempt.at) : 0;
  return {
    stage: typeof attempt.stage === 'string' ? attempt.stage.trim() : null,
    outcome: typeof attempt.outcome === 'string' ? attempt.outcome.trim() : null,
    atMs,
  };
}

function countTrailing(rows, predicate) {
  let count = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!predicate(rows[index])) break;
    count += 1;
  }
  return count;
}
