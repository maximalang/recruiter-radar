import sourceReadinessContract from '../source-readiness.json' with { type: 'json' };
import sourceCredentialsContract from '../source-credentials.json' with { type: 'json' };

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
  const credentialContract = resolveCredentialContract(id);
  const declaredConfigurationMode = source.configuration.mode;
  const configurationMode = resolveEffectiveConfigurationMode(source, credentialContract);
  const acceptedEnvSets = resolveAcceptedEnvSets(id, source);
  const configured = configurationMode === 'not-required'
    || acceptedEnvSets.some((envSet) => envSet.every((name) => hasEnvValue(env, name)));

  const accessModeDrift = configurationMode !== declaredConfigurationMode;
  const credentialProofPending = isCredentialRuntimeProofPending(credentialContract);
  const declaredLiveState = source.live.state;
  const liveState = resolveEffectiveLiveState({
    source,
    credentialContract,
    accessModeDrift,
  });
  const requiresLiveVerification = source.requiresLiveVerification
    || accessModeDrift
    || credentialProofPending;

  const liveReachable = liveState === 'reachable' || liveState === 'verified';
  const historicalLiveVerified = liveState === 'verified'
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
  const providerRequired = configurationMode === 'provider-required';
  const registrationRequired = configurationMode === 'registration-required';
  const readinessDrift = detectSourceReadinessDrift({
    id,
    source,
    configured,
    historicalLiveVerified,
    liveProofFresh,
    credentialContract,
    declaredConfigurationMode,
    configurationMode,
    declaredLiveState,
    liveState,
    credentialProofPending,
  });
  const finalState = resolveFinalState({
    source,
    configured,
    liveVerified,
    providerRequired,
    registrationRequired,
    liveState,
    requiresLiveVerification,
  });
  const blockers = buildEffectiveBlockers({
    source,
    accessModeDrift,
    credentialProofPending,
    requiresLiveVerification,
    liveVerified,
  });
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
    credentialProofPending ? 'production-proof-pending' : null,
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
    configurationMode,
    declaredConfigurationMode,
    acceptedEnvSets,
    accessClass: credentialContract?.accessClass ?? null,
    liveState,
    declaredLiveState,
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
    requiresLiveVerification,
    declaredRequiresLiveVerification: source.requiresLiveVerification,
    credentialProofPending,
    finalState,
    states,
    blockers,
    declaredBlockers: [...source.blockers],
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
  credentialContract = null,
  declaredConfigurationMode = source.configuration.mode,
  configurationMode = declaredConfigurationMode,
  declaredLiveState = source.live.state,
  liveState = declaredLiveState,
  credentialProofPending = false,
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
  if (declaredConfigurationMode !== configurationMode) {
    drift.push({
      code: 'access-mode-contract-drift',
      source: id,
      detail: `Static readiness declares ${declaredConfigurationMode}, while the credential/runtime contract classifies the effective acquisition mode as ${configurationMode} (${credentialContract?.accessClass ?? 'unknown'}).`,
    });
  }
  if (declaredLiveState !== liveState) {
    drift.push({
      code: 'live-state-contract-drift',
      source: id,
      detail: `Static readiness declares live state ${declaredLiveState}, but current free-public runtime semantics reduce that historical access blocker to ${liveState}; production proof is still required.`,
    });
  }
  if (credentialProofPending) {
    drift.push({
      code: 'production-proof-pending',
      source: id,
      detail: 'Credential/runtime contract exposes a lawful production acquisition path but has no timestamped production evidence→signal→lineage proof yet.',
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

function resolveCredentialContract(id) {
  const contract = sourceCredentialsContract.sources?.[id];
  return contract && typeof contract === 'object' ? contract : null;
}

function resolveEffectiveConfigurationMode(source, credentialContract) {
  const declaredMode = source.configuration.mode;
  if (credentialContract?.accessClass !== 'A') return declaredMode;
  if (declaredMode !== 'provider-required') return declaredMode;

  const nonProviderSets = (credentialContract.credentialSets ?? [])
    .map((entry) => entry?.names)
    .filter(Array.isArray)
    .filter((names) => names.length > 0 && names.every((name) => !/_PROVIDER_(?:API_)?(?:URL|TOKEN)$/i.test(name)));
  return nonProviderSets.length > 0 ? 'launch-required' : 'not-required';
}

function resolveEffectiveLiveState({ source, credentialContract, accessModeDrift }) {
  if (
    accessModeDrift
    && credentialContract?.accessClass === 'A'
    && source.live.state === 'blocked'
    && credentialContract?.runtimeAvailability?.state === 'not-required'
  ) {
    return 'unverified';
  }
  return source.live.state;
}

function isCredentialRuntimeProofPending(credentialContract) {
  if (credentialContract?.accessClass !== 'A') return false;
  if (credentialContract?.runtimeAvailability?.state !== 'not-required') return false;
  if (!credentialContract?.verifier) return false;
  const verifiedAt = credentialContract.runtimeAvailability.verifiedAt;
  return !(typeof verifiedAt === 'string' && verifiedAt.trim() && Number.isFinite(Date.parse(verifiedAt)));
}

function buildEffectiveBlockers({
  source,
  accessModeDrift,
  credentialProofPending,
  requiresLiveVerification,
  liveVerified,
}) {
  const blockers = [...source.blockers];
  if (accessModeDrift) {
    blockers.push('static-access-blocker-superseded-by-free-public-runtime-contract');
  }
  if ((credentialProofPending || requiresLiveVerification) && !liveVerified) {
    blockers.push('production-proof-required');
  }
  return [...new Set(blockers)];
}

function resolveAcceptedEnvSets(id, source) {
  const readinessSets = source.configuration.acceptedEnvSets ?? [];
  const credentialSets = sourceCredentialsContract.sources?.[id]?.credentialSets ?? [];
  const combined = [
    ...readinessSets,
    ...credentialSets.map((item) => item?.names).filter(Array.isArray),
  ];
  const seen = new Set();
  const result = [];
  for (const envSet of combined) {
    const normalized = [...new Set(envSet.map((name) => String(name).trim()).filter(Boolean))];
    if (normalized.length === 0) continue;
    const key = [...normalized].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function resolveFinalState({
  source,
  configured,
  liveVerified,
  providerRequired,
  registrationRequired,
  liveState,
  requiresLiveVerification,
}) {
  if (!configured) {
    if (registrationRequired) return 'registration-required';
    return providerRequired ? 'provider-required' : 'blocked';
  }
  if (source.legalReview === 'required') return 'legal-review-required';
  if (liveState === 'blocked') return 'blocked';
  if (requiresLiveVerification && !liveVerified) return 'blocked';
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
