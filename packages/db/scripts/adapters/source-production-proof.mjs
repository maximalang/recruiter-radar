const LIVE_PIPELINE_MODES = new Set([
  'live-fetch-normalize-ingest-evidence-lineage',
  'production-live-fetch-normalize-ingest-evidence-lineage',
]);

export const DEFAULT_PRODUCTION_PIPELINE_PROOF_MAX_AGE_HOURS = 168;

/**
 * Validate the artifact produced by a live source verifier before it is allowed
 * to promote a discovery family to production-live. Smoke/fixture reachability
 * is deliberately insufficient.
 */
export function evaluateSourceProductionProof(proof, {
  now = new Date(),
  maxAgeHours = DEFAULT_PRODUCTION_PIPELINE_PROOF_MAX_AGE_HOURS,
} = {}) {
  const issues = [];
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return failed(['proof-missing-or-invalid']);
  }

  if (proof.ok !== true) issues.push('proof-not-ok');
  if (!LIVE_PIPELINE_MODES.has(proof.mode)) issues.push('not-live-evidence-signal-lineage-mode');
  if (!nonEmptyText(proof.source)) issues.push('source-missing');

  requirePositive(proof, ['recordsReceived', 'records_received'], 'records-missing', issues);
  requirePositive(proof, ['normalizedRecords', 'normalized_records'], 'normalized-records-missing', issues);
  requirePositive(proof, ['signalUpsertsCompleted', 'signals', 'signal_count'], 'signals-missing', issues);
  requirePositive(proof, ['evidenceUpsertsCompleted', 'evidence', 'evidence_count'], 'evidence-missing', issues);
  requirePositive(proof, ['lineageCreated', 'lineage_rows', 'lineage'], 'lineage-missing', issues);

  requireTrue(proof, ['source_urls_preserved', 'sourceUrlsPreserved'], 'source-url-lineage-unproven', issues);
  requireTrue(proof, ['signal_owner_consistent', 'signalOwnerConsistent'], 'signal-owner-unproven', issues);
  requireTrue(proof, ['evidence_owner_consistent', 'evidenceOwnerConsistent'], 'evidence-owner-unproven', issues);

  const proofAt = firstDate(proof, ['verifiedAt', 'verified_at', 'proofAt', 'proof_at', 'generatedAt', 'generated_at']);
  if (!proofAt) {
    issues.push('proof-timestamp-missing');
  } else {
    const ageHours = (toMs(now) - Date.parse(proofAt)) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours < 0) issues.push('proof-timestamp-invalid');
    else if (ageHours > maxAgeHours) issues.push('production-proof-stale');
  }

  const transport = nonEmptyText(proof.transport ?? proof.extraction_method ?? proof.extractionMethod);
  if (transport && /fixture|smoke|mock|synthetic/i.test(transport)) {
    issues.push('non-production-transport');
  }

  return Object.freeze({
    pass: issues.length === 0,
    source: nonEmptyText(proof.source),
    proofAt,
    issues: Object.freeze(issues),
  });
}

function requirePositive(object, keys, issue, issues) {
  const value = firstValue(object, keys);
  if (!(Number(value) > 0)) issues.push(issue);
}

function requireTrue(object, keys, issue, issues) {
  const value = firstValue(object, keys);
  if (value !== true && value !== 'true') issues.push(issue);
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function firstDate(object, keys) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function toMs(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function failed(issues) {
  return Object.freeze({ pass: false, source: null, proofAt: null, issues: Object.freeze(issues) });
}
