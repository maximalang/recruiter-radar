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

export function selectTransportStages(configuredStages, health) {
  if (!Array.isArray(configuredStages)) throw new TypeError('configuredStages must be an array');
  const healthy = [];
  const degraded = [];

  for (const stage of configuredStages) {
    const stageHealth = health?.byStage?.[stage];
    if (stageHealth?.stoppedByPolicy) {
      // Access policy is terminal for this acquisition surface. Returning only
      // stages before/including it would be misleading; caller must switch to
      // another lawful surface, not another bypass transport.
      return Object.freeze({ stages: Object.freeze([]), stoppedByPolicy: true, stoppedStage: stage });
    }
    if (stageHealth?.degraded) degraded.push(stage);
    else healthy.push(stage);
  }

  // Healthy stages run first. Degraded transports remain as last-resort probes,
  // preserving the configured capability set and allowing automatic recovery.
  return Object.freeze({
    stages: Object.freeze([...healthy, ...degraded]),
    stoppedByPolicy: false,
    stoppedStage: null,
  });
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
