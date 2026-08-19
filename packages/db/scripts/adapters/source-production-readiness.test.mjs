import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSourceProductionProof } from './source-production-proof.mjs';
import { evaluateSourceReadiness } from '../source-readiness.mjs';

const profiles = {
  hiring: { discover: 'contract-tested' },
};

function sourceFixture(overrides = {}) {
  return {
    implementation: 'implemented',
    fixture: 'tested',
    contract: 'tested',
    configuration: { mode: 'registration-required', acceptedEnvSets: [['API_KEY']] },
    live: {
      state: 'verified',
      verifiedAt: '2026-08-18T12:00:00Z',
      evidence: ['production evidence -> signal -> lineage proof'],
    },
    requiresLiveVerification: true,
    confidence: 'approved',
    eligibility: 'digest-eligible',
    legalReview: 'not-required',
    pipelineProfile: 'hiring',
    blockers: [],
    verification: {},
    ...overrides,
  };
}

test('fresh historical proof remains live-verified', () => {
  const result = evaluateSourceReadiness(
    'example',
    sourceFixture(),
    profiles,
    { API_KEY: 'configured' },
    new Date('2026-08-19T12:00:00Z'),
  );
  assert.equal(result.historicalLiveVerified, true);
  assert.equal(result.liveProofFresh, true);
  assert.equal(result.liveVerified, true);
  assert.equal(result.finalState, 'digest-eligible');
});

test('stale historical proof is retained for audit but loses live status', () => {
  const source = sourceFixture({
    live: {
      state: 'verified',
      verifiedAt: '2026-08-01T00:00:00Z',
      evidence: ['old production evidence -> signal -> lineage proof'],
    },
  });
  const result = evaluateSourceReadiness(
    'example',
    source,
    profiles,
    { API_KEY: 'configured' },
    new Date('2026-08-19T12:00:00Z'),
  );
  assert.equal(result.historicalLiveVerified, true);
  assert.equal(result.liveProofFresh, false);
  assert.equal(result.liveVerified, false);
  assert.equal(result.finalState, 'blocked');
  assert.ok(result.readinessDrift.some((item) => item.code === 'production-proof-stale'));
});

test('runtime credentials surface stale credential blocker as contract drift', () => {
  const source = sourceFixture({
    live: { state: 'blocked', verifiedAt: null, evidence: ['awaiting production proof'] },
    blockers: ['credential-not-supplied'],
  });
  const result = evaluateSourceReadiness(
    'hh',
    source,
    profiles,
    { API_KEY: 'configured' },
    new Date('2026-08-19T12:00:00Z'),
  );
  assert.equal(result.configured, true);
  assert.ok(result.readinessDrift.some((item) => item.code === 'configured-but-credential-blocker-remains'));
});

test('HH production access token is a configured credential set but never a live proof', () => {
  const source = sourceFixture({
    live: { state: 'blocked', verifiedAt: null, evidence: ['awaiting evidence -> signal -> lineage proof'] },
    blockers: ['credential-not-supplied'],
  });
  const result = evaluateSourceReadiness(
    'hh',
    source,
    profiles,
    { HH_USER_AGENT: 'RecruiterRadar test', HH_ACCESS_TOKEN: 'opaque-production-token' },
    new Date('2026-08-19T12:00:00Z'),
  );
  assert.equal(result.configured, true);
  assert.ok(result.acceptedEnvSets.some((envSet) => (
    envSet.includes('HH_USER_AGENT') && envSet.includes('HH_ACCESS_TOKEN')
  )));
  assert.equal(result.liveVerified, false);
  assert.equal(result.finalState, 'blocked');
  assert.ok(result.readinessDrift.some((item) => item.code === 'configured-but-credential-blocker-remains'));
});

test('production proof requires full live evidence-signal-lineage semantics', () => {
  const proof = {
    ok: true,
    source: 'example',
    mode: 'live-fetch-normalize-ingest-evidence-lineage',
    recordsReceived: 20,
    normalizedRecords: 20,
    signals: 20,
    evidence: 20,
    lineage_rows: 20,
    source_urls_preserved: true,
    extraction_preserved: true,
    signal_owner_consistent: true,
    evidence_owner_consistent: true,
    proofAt: '2026-08-19T10:00:00Z',
    transport: 'live-public',
  };
  const result = evaluateSourceProductionProof(proof, { now: new Date('2026-08-19T12:00:00Z') });
  assert.equal(result.pass, true);
});

test('fixture/smoke proof can never promote a source to production-live', () => {
  const result = evaluateSourceProductionProof({
    ok: true,
    source: 'example',
    mode: 'smoke',
    recordsReceived: 1,
    normalizedRecords: 1,
    signals: 1,
    evidence: 1,
    lineage_rows: 1,
    source_urls_preserved: true,
    extraction_preserved: true,
    signal_owner_consistent: true,
    evidence_owner_consistent: true,
    proofAt: '2026-08-19T10:00:00Z',
    transport: 'fixture',
  }, { now: new Date('2026-08-19T12:00:00Z') });
  assert.equal(result.pass, false);
  assert.ok(result.issues.includes('not-live-evidence-signal-lineage-mode'));
  assert.ok(result.issues.includes('non-production-transport'));
});
