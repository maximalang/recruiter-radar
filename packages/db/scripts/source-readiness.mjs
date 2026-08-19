import sourceReadinessContract from '../source-readiness.json' with { type: 'json' };

const IMPLEMENTATION_STATES = new Set(['implemented']);
const TEST_STATES = new Set(['tested', 'not-applicable']);
const CONFIGURATION_MODES = new Set(['not-required', 'launch-required', 'registration-required', 'provider-required']);
const LIVE_STATES = new Set(['unverified', 'reachable', 'verified', 'blocked']);
const CONFIDENCE_STATES = new Set(['approved', 'pending', 'not-applicable']);
const ELIGIBILITY_STATES = new Set([
  'digest-eligible',
  'supporting-evidence-only',
  'enrichment-only',
  'context-only',
]);
const LEGAL_REVIEW_STATES = new Set(['not-required', 'required', 'approved']);

// A historical live proof is useful audit evidence but it is not an indefinite
// production-health assertion. Seven days is deliberately conservative for the
// existing registry; faster degradation is handled by runtime transport health.
export const DEFAULT_PRODUCTION_PROOF_MAX_AGE_HOURS = 168;

export function getSourceReadinessContract() {
  validateSourceReadinessContract(sourceReadinessContract);
  return sourceReadinessContract;
}

export function listEvaluatedSourceReadiness(env = process.env, now = new Date()) {
  const contract = getSourceReadinessContract();
  return Object.entries(contract.sources).map(([id, source]) => evaluateSourceReadiness(
    id,
    source,
    contract.pipelineProfiles,
    env,
    now,
  ));
}

export function evaluateSourceReadiness(id, source, pipelineProfiles, env = process.env, now = new Date()) {
  const configured = source.configuration.mode === 'not-required'
    || source.configuration.acceptedEnvSets.some((envSet) => envSet.every((name) => hasEnvValue(env, name)));
  const liveReachable = source.live.state === 'reachable' || source.live.state === 'verified';
  const historicalLiveVerified = source.live.state === 'verified'
    && typeof source.live.verifiedAt === 'string'
    && source.live.verifiedAt.trim() !== ''
    && source.live.evidence.length > 0;
  const liveProofMaxAgeHours = resolveLiveProofMaxAgeHours(source);
  const liveProofAgeHours = historicalLiveVerified
    ? calculateAgeHours(source.live.verifiedAt, now)
    : null;
  const liveProofFresh = historicalLiveVerified
    && Number.isFinite(liveProofAgeHours)
    && liveProofAgeHours >= 0
    && liveProofAgeHours <= liveProofMaxAgeHours;
  const liveVerified = historicalLiveVerified && liveProofFresh;
  const providerRequired = source.configuration.mode === 'provider-required';
  const registrationRequired = source.configuration.mode === 'registration-required';
  const readinessDrift = detectSourceReadinessDrift({
    id,
    source,
    configured,
    historicalLiveVerified,
    liveProofFresh,
  });
  const finalState = resolveFinalState({ source, configured, liveVerified, providerRequired, registrationRequired });
  const states = [
    'implemented',
    source.fixture === 'tested' ? 'fixture-tested' : null,
    source.contract === 'tested' ? 'contract-tested' : null,
    configured ? 'configured' : null,
    liveReachable ? 'live-reachable' : null,
    historicalLiveVerified ? 'historically-live-verified' : null,
    liveVerified ? 'live-verified' : null,
    historicalLiveVerified && liveProofFresh ? 'live-proof-fresh' : null,
    historicalLiveVerified && !liveProofFresh ? 'live-proof-stale' : null,
    readinessDrift.length > 0 ? 'readiness-drift' : null,
    source.confidence === 'approved' ? 'confidence-approved' : null,
    source.eligibility,
    providerRequired ? 'provider-required' : null,
    registrationRequired ? 'registration-required' : null,
    source.legalReview === 'required' ? 'legal-review-required' : null,
    finalState === 'blocked' ? 'blocked' : null,
  ].filter(Boolean);

  return {
    id,
    implementation: source.implementation,
    fixtureTested: source.fixture === 'tested',
    contractTested: source.contract === 'tested',
    configured,
    configurationMode: source.configuration.mode,
    acceptedEnvSets: source.configuration.acceptedEnvSets.map((envSet) => [...envSet]),
    liveState: source.live.state,
    liveReachable,
    liveVerified,
    historicalLiveVerified,
    liveProofFresh,
    liveProofAgeHours,
    liveProofMaxAgeHours,
    liveVerifiedAt: source.live.verifiedAt,
    liveEvidence: [...source.live.evidence],
    readinessDrift,
    confidence: source.confidence,
    confidenceApproved: source.confidence === 'approved',
    eligibility: source.eligibility,
    providerRequired,
    registrationRequired,
    legalReview: source.legalReview,
    requiresLiveVerification: source.requiresLiveVerification,
    finalState,
    states,
    blockers: [...source.blockers],
    verification: source.verification,
    pipeline: pipelineProfiles[source.pipelineProfile],
  };
}

export function detectSourceReadinessDrift({
  id,
  source,
  configured,
  historicalLiveVerified,
  liveProofFresh,
}) {
  const drift = [];
  if (configured && source.blockers.includes('credential-not-supplied')) {
    drift.push({
      code: 'configured-but-credential-blocker-remains',
      source: id,
      detail: 'Runtime configuration satisfies an accepted credential set but the static readiness contract still declares credential-not-supplied.',
    });
  }
  if (historicalLiveVerified && !liveProofFresh) {
    drift.push({
      code: 'production-proof-stale',
      source: id,
      detail: 'Historical live evidence exceeded its maximum production-proof age and must be refreshed before the source is considered live-verified.',
    });
  }
  return drift;
}

export function validateSourceReadinessContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new TypeError('Source readiness contract must be an object.');
  }
  if (!contract.pipelineProfiles || typeof contract.pipelineProfiles !== 'object') {
    throw new TypeError('Source readiness contract must define pipelineProfiles.');
  }
  if (!contract.sources || typeof contract.sources !== 'object') {
    throw new TypeError('Source readiness contract must define sources.');
  }

  for (const [id, source] of Object.entries(contract.sources)) {
    assertEnum(source.implementation, IMPLEMENTATION_STATES, `${id}.implementation`);
    assertEnum(source.fixture, TEST_STATES, `${id}.fixture`);
    assertEnum(source.contract, new Set(['tested']), `${id}.contract`);
    assertEnum(source.configuration?.mode, CONFIGURATION_MODES, `${id}.configuration.mode`);
    assertEnvSets(source.configuration?.acceptedEnvSets, `${id}.configuration.acceptedEnvSets`);
    assertEnum(source.live?.state, LIVE_STATES, `${id}.live.state`);
    if (!Array.isArray(source.live?.evidence)) {
      throw new TypeError(`${id}.live.evidence must be an array.`);
    }
    if (source.live.state === 'verified' && (
      typeof source.live.verifiedAt !== 'string'
      || source.live.verifiedAt.trim() === ''
      || !Number.isFinite(Date.parse(source.live.verifiedAt))
      || source.live.evidence.length === 0
    )) {
      throw new TypeError(`${id}.live verified state requires a parseable verifiedAt and evidence.`);
    }
    if (source.live.maxAgeHours !== undefined && (
      !Number.isFinite(source.live.maxAgeHours) || source.live.maxAgeHours <= 0
    )) {
      throw new TypeError(`${id}.live.maxAgeHours must be a positive finite number when present.`);
    }
    assertEnum(source.confidence, CONFIDENCE_STATES, `${id}.confidence`);
    assertEnum(source.eligibility, ELIGIBILITY_STATES, `${id}.eligibility`);
    assertEnum(source.legalReview, LEGAL_REVIEW_STATES, `${id}.legalReview`);
    if (typeof source.requiresLiveVerification !== 'boolean') {
      throw new TypeError(`${id}.requiresLiveVerification must be a boolean.`);
    }
    if (!contract.pipelineProfiles[source.pipelineProfile]) {
      throw new TypeError(`${id}.pipelineProfile must reference a known pipeline profile.`);
    }
    if (!Array.isArray(source.blockers)) {
      throw new TypeError(`${id}.blockers must be an array.`);
    }
  }

  return true;
}

function resolveFinalState({ source, configured, liveVerified, providerRequired, registrationRequired }) {
  if (!configured) {
    if (registrationRequired) return 'registration-required';
    return providerRequired ? 'provider-required' : 'blocked';
  }
  if (source.legalReview === 'required') return 'legal-review-required';
  if (source.live.state === 'blocked') return 'blocked';
  if (source.requiresLiveVerification && !liveVerified) return 'blocked';
  if (source.confidence === 'pending') return 'blocked';
  return source.eligibility;
}

function resolveLiveProofMaxAgeHours(source) {
  return Number.isFinite(source.live?.maxAgeHours) && source.live.maxAgeHours > 0
    ? source.live.maxAgeHours
    : DEFAULT_PRODUCTION_PROOF_MAX_AGE_HOURS;
}

function calculateAgeHours(verifiedAt, now) {
  const verifiedMs = Date.parse(verifiedAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(verifiedMs) || !Number.isFinite(nowMs)) return null;
  return (nowMs - verifiedMs) / 3_600_000;
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new TypeError(`${label} must be one of: ${[...allowed].join(', ')}.`);
  }
}

function assertEnvSets(value, label) {
  if (!Array.isArray(value) || value.some((envSet) => (
    !Array.isArray(envSet)
    || envSet.length === 0
    || envSet.some((name) => typeof name !== 'string' || name.trim() === '')
  ))) {
    throw new TypeError(`${label} must be an array of non-empty environment-name arrays.`);
  }
}

function hasEnvValue(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}
