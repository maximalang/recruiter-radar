import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCommercialSignalV2 } from './commercial-signal-evaluation-v2.mjs'
import {
  applyHumanReviews,
  assertNoPii,
  buildBlindReviewPackage,
  buildGoldSetDataset,
  parseDatasetJsonl,
  renderLabelTemplateCsv,
  resolveGoldReviewState,
  serializeDatasetJsonl,
  summarizeReviews,
  toEvaluationV2Rows,
} from './commercial-signal-gold-set-v1.mjs'

const KEY = 'gold-set-contract-key-'.padEnd(40, 'x')
const OPTIONS = {
  workspaceId: '10', profileId: '20', from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-10T00:00:00.000Z', datasetVersion: 'gold-2026-08-v1',
  seed: 'gold-2026-08-v1', anonymizationKey: KEY,
  createdAt: '2026-08-10T00:00:00.000Z',
}

function raw(index, overrides = {}) {
  const v3 = 0.95 - index / 100
  const quality = Math.max(0.05, Math.min(0.99, v3 + (index % 2 ? 0.04 : -0.04)))
  return {
    workspaceId: '10', profileId: '20', organizationId: String(5000 + index),
    qualitySnapshotId: String(1000 + index), candidateId: String(2000 + index),
    candidateGeneration: 1, opportunityLineageId: String(3000 + index),
    decisionAt: '2026-08-05T00:00:00.000Z',
    opportunityV3Version: 'opportunity-v3', opportunityV3Score: v3,
    opportunityV3Status: index % 7 === 0 ? 'qualified_actionable' : 'review',
    opportunityV3UnknownFeatureCount: 0,
    qualityVersion: 'commercial-signal-quality-v2', qualityGeneration: 1,
    qualityIdentity: 'q'.repeat(64), qualityScore: quality,
    qualityStatus: index % 7 === 0 ? 'blocked' : 'review', qualityCoverage: 0.8,
    qualityConfidence: 0.82,
    qualityComponents: {
      hiring_friction: { value: 0.7 }, agency_fit: { value: 0.8 },
      external_agency_propensity: { value: 0.7 }, signal_convergence: { value: 0.65 },
    },
    qualityReasonCodes: index % 7 === 0 ? ['NEGATIVE_STATE_BLOCK'] : ['BASELINE'],
    qualityFeatureSnapshot: {
      status: 'review',
      observationStates: { hiringFriction: 'observed', marketDifficulty: 'unknown' },
    },
    candidateFeatureSnapshot: {
      quality: {
        agencyFitCoverage: 0.75, episodeStage: 'active',
        episodeLastSeenAt: '2026-08-04T00:00:00.000Z',
        organizationIdentityVerified: true, stateChangeConfirmed: true,
      },
      actionability: { corporateContactPathCategories: ['career-page'] },
      evidenceSourceFamilies: ['hh'], directEvidenceCount: 1,
      corroborationEvidenceCount: 1,
    },
    candidateEvidenceIds: [String(4000 + index)],
    agencyProfile: {
      targetCity: 'Москва', specialization: 'IT recruitment', roles: ['backend'],
      industries: ['software'], companySizes: ['100-500'], excludedIndustries: [],
      excludedLocations: [], remoteFriendly: true, hiringMode: 'specialist',
      contactPolicy: 'corporate_only',
    },
    evidence: [{
      evidenceId: String(4000 + index), decisionRole: 'positive', sourceKind: 'direct',
      sourceFamily: 'hh', sourceDomain: 'hh.ru', observedAt: '2026-08-04T00:00:00.000Z',
      independenceGroup: 'a'.repeat(64), correlationReasonCode: 'EVIDENCE_INDEPENDENT',
      canonicalUrl: `https://hh.ru/vacancy/${index}?utm_source=test`,
    }],
    ...overrides,
  }
}

function dataset(rows = Array.from({ length: 30 }, (_, i) => raw(i + 1)), options = OPTIONS) {
  return buildGoldSetDataset(rows, options)
}

function review(sampleId, reviewerId = 'reviewer-a', overrides = {}) {
  return {
    sampleId, reviewerId, revision: 1, reviewLabel: 'strong', actionable: true,
    agencyDnaFit: 'fit', externalSupportNeed: 'high', evidenceCompleteness: 'complete',
    evidenceFreshness: 'fresh', independentCorroboration: 'confirmed',
    directHiringProof: 'confirmed', negativeEvidence: 'absent', observationSupport: 'observed',
    provenanceStatus: 'verified', reviewerConfidence: 'high', falsePositiveCategory: null,
    falseNegativeCategory: null, reviewedAt: '2026-08-10T00:00:00.000Z',
    revisionReason: null, adjudication: false, ...overrides,
  }
}

test('sampling is deterministic and order-independent', () => {
  const rows = Array.from({ length: 30 }, (_, i) => raw(i + 1))
  assert.deepEqual(
    dataset(rows).rows.map((row) => row.sampleId),
    dataset([...rows].reverse()).rows.map((row) => row.sampleId),
  )
})

test('blind package hides scores, ranks, statuses and sampling buckets', () => {
  const blind = buildBlindReviewPackage(dataset())
  const text = JSON.stringify(blind)
  assert.equal(text.includes('opportunityV3'), false)
  assert.equal(text.includes('qualityScore'), false)
  assert.equal(text.includes('samplingBuckets'), false)
  assertNoPii(blind)
})

test('tenant/profile isolation fails closed', () => {
  assert.throws(() => dataset([raw(1), raw(2, { profileId: '21' })]), /outside requested tenant\/profile scope/)
})

test('future evidence, missing lineage, and evidence-universe drift are rejected', () => {
  assert.throws(() => dataset([raw(1, {
    evidence: [{ ...raw(1).evidence[0], observedAt: '2026-08-06T00:00:00.000Z' }],
  })]), /future evidence/)
  assert.throws(() => dataset([raw(1, { opportunityLineageId: null })]), /opportunity lineage id is invalid/)
  assert.throws(() => dataset([raw(1, { candidateEvidenceIds: ['4999'] })]), /exact evidence universe/)
})

test('PII-looking profile values and model reviewer identities are rejected', () => {
  assert.throws(() => dataset([raw(1, {
    agencyProfile: { ...raw(1).agencyProfile, specialization: 'john@example.com' },
  })]), /PII/)
  const base = dataset()
  assert.throws(() => applyHumanReviews(base, [review(base.rows[0].sampleId, 'model:quality-v2')]), /model output/)
})

test('review revisions are append-only and corrections require reason', () => {
  const base = dataset(); const sampleId = base.rows[0].sampleId
  const r1 = applyHumanReviews(base, [review(sampleId)])
  assert.equal(base.rows[0].reviews.length, 0)
  assert.equal(r1.rows.find((row) => row.sampleId === sampleId).reviews.length, 1)
  assert.throws(() => applyHumanReviews(r1, [review(sampleId, 'reviewer-a', {
    revision: 2, reviewLabel: 'weak',
  })]), /revision reason/)
  const r2 = applyHumanReviews(r1, [review(sampleId, 'reviewer-a', {
    revision: 2, reviewLabel: 'weak', actionable: false,
    revisionReason: 'rechecked evidence',
  })])
  assert.equal(
    resolveGoldReviewState(r2.rows.find((row) => row.sampleId === sampleId)).finalReview.reviewLabel,
    'weak',
  )
})

test('double-review disagreement requires adjudication', () => {
  const base = dataset(); const id = base.rows[0].sampleId
  const a = applyHumanReviews(base, [review(id, 'reviewer-a')])
  const b = applyHumanReviews(a, [review(id, 'reviewer-b', {
    reviewLabel: 'weak', actionable: false,
  })])
  assert.equal(resolveGoldReviewState(b.rows.find((row) => row.sampleId === id)).finalReview, null)
  assert.equal(resolveGoldReviewState(b.rows.find((row) => row.sampleId === id)).disagreement, true)
  const c = applyHumanReviews(b, [review(id, 'adjudicator', {
    reviewLabel: 'acceptable', adjudication: true,
  })])
  assert.equal(resolveGoldReviewState(c.rows.find((row) => row.sampleId === id)).resolution, 'adjudicated')
})

test('evaluation adapter preserves exact model lineage and only human label', () => {
  const base = dataset(); const id = base.rows[0].sampleId
  const labeled = applyHumanReviews(base, [review(id)])
  const row = toEvaluationV2Rows(labeled).find((item) => item.sampleKey === id)
  assert.deepEqual(row.modelLineage.opportunity_v3, row.modelLineage.quality_engine_v2)
  assert.equal(row.reviewLabel, 'strong')
  assert.equal(row.outcomeProjection, null)
})

test('JSONL remains frozen and label template has stable columns', () => {
  const base = dataset()
  assert.equal(
    parseDatasetJsonl(serializeDatasetJsonl(base)).manifest.frozenFingerprint,
    base.manifest.frozenFingerprint,
  )
  const reviewPackage = buildBlindReviewPackage(base)
  const lines = renderLabelTemplateCsv(reviewPackage).trimEnd().split('\n')
  assert.equal(lines[0].split(',').length, lines[1].split(',').length)
})

test('small human-reviewed population stays insufficient_data', () => {
  const base = dataset(); const id = base.rows[0].sampleId
  const labeled = applyHumanReviews(base, [review(id)])
  assert.equal(summarizeReviews([labeled]).operationalStatus, 'insufficient_data')
  assert.equal(summarizeReviews([labeled]).qualityValidated, false)
})

test('existing evaluation-v2 accepts human-reviewed population without changing its contract', () => {
  const base = dataset(); const id = base.rows[0].sampleId
  const labeled = applyHumanReviews(base, [review(id)])
  const evaluation = evaluateCommercialSignalV2(toEvaluationV2Rows(labeled), {
    provenance: 'anonymized_real',
    evaluationAt: '2026-08-10T00:00:00.000Z',
    minimumSample: 1,
    minimumLabeled: 1,
  })
  assert.equal(evaluation.provenance, 'anonymized_real')
  assert.equal(evaluation.comparison.status, 'evaluation_only')
  assert.equal(evaluation.automaticWeightTuning, false)
  assert.equal(evaluation.productionWrites, false)
})

test('existing evaluation-v2 rejects broken exact lineage', () => {
  const rows = toEvaluationV2Rows(dataset())
  rows[0].modelLineage.quality_engine_v2.candidateId = '999999'
  assert.throws(() => evaluateCommercialSignalV2(rows, {
    provenance: 'anonymized_real', evaluationAt: '2026-08-10T00:00:00.000Z',
  }), /share exact candidate lineage/)
})

test('future outcome cannot leak into a gold evaluation row', () => {
  const base = dataset(); const id = base.rows[0].sampleId
  const labeled = applyHumanReviews(base, [review(id)])
  const rows = toEvaluationV2Rows(labeled)
  const target = rows.find((row) => row.sampleKey === id)
  target.outcomeProjection = {
    version: 'opportunity-outcome-state-v1',
    candidateId: target.modelLineage.opportunity_v3.candidateId,
    opportunityId: '800000000000000001',
    lineageId: target.modelLineage.opportunity_v3.opportunityLineageId,
    lastEventId: '800000000000000002',
    lastEventAt: '2026-08-11T00:00:00.000Z',
    repliedAt: '2026-08-11T00:00:00.000Z', meetingAt: null, wonAt: null,
  }
  assert.throws(() => evaluateCommercialSignalV2(rows, {
    provenance: 'anonymized_real',
    evaluationAt: '2026-08-10T00:00:00.000Z',
    minimumSample: 1,
    minimumLabeled: 1,
  }), /future outcome projection/)
})
