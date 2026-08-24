import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPromotionExternalId,
  classifyCandidateCorroboration,
  evaluateCandidatePromotionEligibility,
  promoteRfHiringCandidate,
} from './rf-hiring-candidate-reconciliation.mjs';

const FRESH_PROOF = {
  ok: true,
  source: 'rabota-ru',
  mode: 'live-fetch-normalize-ingest-evidence-lineage',
  verifiedAt: new Date().toISOString(),
  recordsReceived: 10,
  normalizedRecords: 10,
  signalUpsertsCompleted: 10,
  evidenceUpsertsCompleted: 10,
  lineageCreated: 10,
  source_urls_preserved: true,
  extraction_preserved: true,
  signal_owner_consistent: true,
  evidence_owner_consistent: true,
  transport: 'live-public',
};

test('company-owned direct career evidence independently corroborates hiring', () => {
  const result = classifyCandidateCorroboration([
    {
      source: 'career-pages',
      source_family: 'company-owned-career',
      signal_payload_snapshot: {},
    },
  ], 'rabota-ru');

  assert.equal(result.directEmployerEvidence, true);
  assert.equal(result.atsEvidence, false);
  assert.equal(result.independentHiringCorroboration, true);
  assert.deepEqual(result.hiringFamilies, ['hiring:direct-career']);
});

test('hosted ATS evidence is distinguished by provider family', () => {
  const result = classifyCandidateCorroboration([
    {
      source: 'career-pages',
      source_family: 'company-owned-career',
      signal_payload_snapshot: { hosted_ats_family: 'huntflow' },
    },
    {
      source: 'career-pages',
      source_family: 'company-owned-career',
      signal_payload_snapshot: { hosted_ats_family: 'FriendWork' },
    },
  ], 'rabota-ru');

  assert.equal(result.atsEvidence, true);
  assert.equal(result.independentHiringCorroboration, true);
  assert.deepEqual(result.hiringFamilies, ['hiring:ats:friendwork', 'hiring:ats:huntflow']);
});

test('FNS legal evidence strengthens identity but never pretends to be hiring corroboration', () => {
  const result = classifyCandidateCorroboration([
    {
      source: 'egrul-fns',
      source_family: 'fns-official-registry',
      signal_payload_snapshot: { hiring_proof: false },
    },
  ], 'rabota-ru');

  assert.equal(result.legalIdentityCorroboration, true);
  assert.equal(result.independentHiringCorroboration, false);
  assert.deepEqual(result.identityFamilies, ['identity:legal:fns-official-registry']);
  assert.deepEqual(result.hiringFamilies, []);
});

test('another job board helps cross-post analysis but is not independent-family corroboration', () => {
  const result = classifyCandidateCorroboration([
    { source: 'hh', source_family: 'job-board', signal_payload_snapshot: {} },
    { source: 'rabota-ru', source_family: 'job-board', signal_payload_snapshot: {} },
  ], 'rabota-ru');

  assert.equal(result.independentHiringCorroboration, false);
  assert.deepEqual(result.crossPostedJobBoardSources, ['hh']);
  assert.deepEqual(result.families, []);
});

test('resolved candidate still cannot promote while family contract is candidate', () => {
  const eligibility = evaluateCandidatePromotionEligibility({
    candidate: {
      id: '1',
      source_family: 'rabota-ru',
      identity_status: 'resolved',
      resolved_org_id: '42',
      job_title: 'Backend developer',
      vacancy_url: 'https://www.rabota.ru/vacancy/42',
    },
    family: { id: 'rabota-ru', productionState: 'candidate' },
    productionProof: FRESH_PROOF,
  });

  assert.equal(eligibility.pass, false);
  assert.ok(eligibility.issues.includes('family-not-production-live'));
});

test('live family requires its own fresh evidence-signal-lineage proof', () => {
  const candidate = {
    id: '1',
    source_family: 'rabota-ru',
    identity_status: 'resolved',
    resolved_org_id: '42',
    job_title: 'Backend developer',
    vacancy_url: 'https://www.rabota.ru/vacancy/42',
  };
  const family = { id: 'rabota-ru', productionState: 'live' };

  const missingProof = evaluateCandidatePromotionEligibility({ candidate, family, productionProof: null });
  assert.equal(missingProof.pass, false);
  assert.ok(missingProof.issues.some((issue) => issue.startsWith('production-proof:')));

  const validProof = evaluateCandidatePromotionEligibility({ candidate, family, productionProof: FRESH_PROOF });
  assert.equal(validProof.pass, true);
});

test('proof from a different source cannot authorize promotion', () => {
  const eligibility = evaluateCandidatePromotionEligibility({
    candidate: {
      id: '1',
      source_family: 'rabota-ru',
      identity_status: 'resolved',
      resolved_org_id: '42',
      job_title: 'Backend developer',
      vacancy_url: 'https://www.rabota.ru/vacancy/42',
    },
    family: { id: 'rabota-ru', productionState: 'live' },
    productionProof: { ...FRESH_PROOF, source: 'getmatch' },
  });

  assert.equal(eligibility.pass, false);
  assert.ok(eligibility.issues.includes('production-proof:source-mismatch'));
});

test('promotion rejection performs no writes', async () => {
  const client = {
    query: async () => {
      throw new Error('writer must not run when promotion gate fails');
    },
  };
  const result = await promoteRfHiringCandidate(client, {
    candidate: {
      id: '1',
      source_family: 'rabota-ru',
      identity_status: 'resolved',
      resolved_org_id: '42',
      job_title: 'Backend developer',
      vacancy_url: 'https://www.rabota.ru/vacancy/42',
    },
    family: { id: 'rabota-ru', productionState: 'candidate' },
    productionProof: FRESH_PROOF,
    corroboration: {},
  });
  assert.equal(result.promoted, false);
});

test('promotion external id prefers board id and has deterministic vacancy-key fallback', () => {
  assert.equal(buildPromotionExternalId({ external_vacancy_id: '777', vacancy_key: 'url:https://example' }), '777');
  assert.equal(buildPromotionExternalId({ external_vacancy_id: null, vacancy_key: 'url:https://example' }), 'url:https://example');
});
