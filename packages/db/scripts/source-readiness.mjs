import sourceReadinessContract from '../source-readiness.json' with { type: 'json' };

const IMPLEMENTATION_STATES = new Set(['implemented']);
const TEST_STATES = new Set(['tested', 'not-applicable']);
const CONFIGURATION_MODES = new Set(['not-required', 'launch-required', 'provider-required']);
const LIVE_STATES = new Set(['unverified', 'reachable', 'verified', 'blocked']);
const CONFIDENCE_STATES = new Set(['approved', 'pending', 'not-applicable']);
const ELIGIBILITY_STATES = new Set([
  'digest-eligible',
  'supporting-evidence-only',
  'enrichment-only',
  'context-only',
]);
const LEGAL_REVIEW_STATES = new Set(['not-required', 'required', 'approved']);

export function getSourceReadinessContract() {
  validateSourceReadinessContract(sourceReadinessContract);
  return sourceReadinessContract;
}

export function listEvaluatedSourceReadiness(env = process.env) {
  const contract = getSourceReadinessContract();
  return Object.entries(contract.sources).map(([id, source]) => evaluateSourceReadiness(
    id,
    source,
    contract.pipelineProfiles,
    env,
  ));
}

export function evaluateSourceReadiness(id, source, pipelineProfiles, env = process.env) {
  const configured = source.configuration.mode === 'not-required'
    || source.configuration.acceptedEnvSets.some((envSet) => envSet.every((name) => hasEnvValue(env, name)));
  const liveReachable = source.live.state === 'reachable' || source.live.state === 'verified';
  const liveVerified = source.live.state === 'verified'
    && typeof source.live.verifiedAt === 'string'
    && source.live.verifiedAt.trim() !== ''
    && source.live.evidence.length > 0;
  const providerRequired = source.configuration.mode === 'provider-required';
  const finalState = resolveFinalState({ source, configured, liveVerified, providerRequired });
  const states = [
    'implemented',
    source.fixture === 'tested' ? 'fixture-tested' : null,
    source.contract === 'tested' ? 'contract-tested' : null,
    configured ? 'configured' : null,
    liveReachable ? 'live-reachable' : null,
    liveVerified ? 'live-verified' : null,
    source.confidence === 'approved' ? 'confidence-approved' : null,
    source.eligibility,
    providerRequired ? 'provider-required' : null,
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
    liveVerifiedAt: source.live.verifiedAt,
    liveEvidence: [...source.live.evidence],
    confidence: source.confidence,
    confidenceApproved: source.confidence === 'approved',
    eligibility: source.eligibility,
    providerRequired,
    legalReview: source.legalReview,
    requiresLiveVerification: source.requiresLiveVerification,
    finalState,
    states,
    blockers: [...source.blockers],
    verification: source.verification,
    pipeline: pipelineProfiles[source.pipelineProfile],
  };
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
      || source.live.evidence.length === 0
    )) {
      throw new TypeError(`${id}.live verified state requires verifiedAt and evidence.`);
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

function resolveFinalState({ source, configured, liveVerified, providerRequired }) {
  if (!configured) return providerRequired ? 'provider-required' : 'blocked';
  if (source.legalReview === 'required') return 'legal-review-required';
  if (source.live.state === 'blocked') return 'blocked';
  if (source.requiresLiveVerification && !liveVerified) return 'blocked';
  if (source.confidence === 'pending') return 'blocked';
  return source.eligibility;
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
