import assert from 'node:assert/strict'

import {
  EVALUATION_V2_MODEL_KEYS,
  FALSE_NEGATIVE_CATEGORIES,
  FALSE_POSITIVE_CATEGORIES,
  MISSED_OPPORTUNITY_SAMPLE_TYPES,
  RANKING_CHANGE_REASONS,
  buildTemporalEvaluationSplits,
  evaluateCommercialSignalV2,
} from './lib/commercial-signal-evaluation-v2.mjs'

const hash = (character) => character.repeat(64)
const row = (index, overrides = {}) => ({
  sampleKey: index.toString(16).padStart(64, '0'),
  agencyProfileKey: index % 2 === 0 ? hash('a') : hash('b'),
  decisionAt: `2026-${index <= 9 ? '06' : index <= 19 ? '07' : '08'}-01T00:00:00.000Z`,
  modelLineage: {
    opportunity_v3: {
      candidateId: String(2000 + index),
      candidateGeneration: 1,
      opportunityLineageId: String(4000 + index),
    },
    quality_engine_v2: {
      candidateId: String(2000 + index),
      candidateGeneration: 1,
      opportunityLineageId: String(4000 + index),
    },
  },
  scores: {
    freshness: 1 - index / 40,
    vacancy_volume: index,
    fiur: 1 - index / 50,
    opportunity_v2: 1 - index / 45,
    opportunity_v3: index <= 12 ? 0.9 : 0.2,
    quality_engine_v2: index <= 12 ? 0.95 : 0.15,
  },
  qualityCoverage: 0.9,
  previousQualityCoverage: 0.6,
  previousUnknownFeatureCount: 8,
  unknownFeatureCount: 3,
  qualityConfidence: 0.85,
  reviewLabel: index <= 12 ? 'strong' : 'weak',
  status: index <= 12 ? 'qualified_actionable' : 'review',
  previousStatus: index <= 10 ? 'qualified_actionable' : 'review',
  rankingChangeReasons: index === 11 || index === 12
    ? ['baseline', 'repost'] : [],
  blockedByNegativeState: index === 21,
  friction: index % 3 === 0 ? 0.85 : 0.3,
  agencyFit: index % 4 === 0 ? 0.9 : 0.5,
  propensity: index % 4 === 0 ? 0.3 : 0.7,
  convergence: index % 5 === 0 ? 0.8 : 0.4,
  outcomeProjection: {
    version: 'opportunity-outcome-state-v1',
    candidateId: String(2000 + index),
    opportunityId: String(3000 + index),
    lineageId: String(4000 + index),
    lastEventId: String(1000 + index),
    lastEventAt: `2026-${index <= 9 ? '06' : index <= 19 ? '07' : '08'}-05T00:00:00.000Z`,
    repliedAt: index <= 8
      ? `2026-${index <= 9 ? '06' : '07'}-02T00:00:00.000Z` : null,
    meetingAt: index <= 5 ? '2026-06-03T00:00:00.000Z' : null,
    wonAt: index <= 2 ? '2026-06-04T00:00:00.000Z' : null,
  },
  falseNegativeCategory: index === 20 ? 'coverage_gap' : null,
  falsePositiveCategory: index === 21 ? 'ordinary_hiring' : null,
  evidenceObservedAt: [
    '2026-05-01T00:00:00.000Z',
  ],
  ...overrides,
})

const rows = Array.from({ length: 30 }, (_, index) => row(index + 1))
const report = evaluateCommercialSignalV2(rows, {
  evaluationAt: '2026-09-01T00:00:00.000Z',
})

assert.equal(report.dataStatus, 'sufficient_data')
assert.equal(report.calibrationStatus, 'uncalibrated')
assert.equal(report.automaticWeightTuning, false)
assert.equal(report.productionWrites, false)
assert.equal(report.comparison.status, 'contract_only')
assert.equal(report.comparison.population, 'synthetic_contract')
assert.equal(report.featureCoverageComparison.status, 'contract_only')
assert.equal(report.featureCoverageComparison.coverageBefore.value, 0.6)
assert.equal(report.featureCoverageComparison.coverageAfter.value, 0.9)
assert.equal(report.featureCoverageComparison.coverageDelta, 0.3)
assert.equal(report.featureCoverageComparison.unknownFeaturesBefore.total, 240)
assert.equal(report.featureCoverageComparison.unknownFeaturesAfter.total, 90)
assert.equal(report.rankingChanges.status, 'contract_only')
assert.equal(report.rankingChanges.promoted, 2)
assert.equal(report.rankingChanges.demoted, 0)
assert.equal(report.rankingChanges.unchanged, 28)
assert.equal(report.rankingChanges.byReason.baseline, 2)
assert.equal(report.rankingChanges.byReason.repost, 2)
assert.equal(report.rankingChanges.blockedByNegativeState, 1)
assert.deepEqual(Object.keys(report.rankingChanges.byReason), RANKING_CHANGE_REASONS)
assert.equal(typeof report.comparison.deltas.precisionAt5, 'number')
assert.equal(report.models.opportunity_v3.precisionAt5.status, 'sufficient_data')
assert.equal(report.models.quality_engine_v2.ndcgAt10.status, 'sufficient_data')
assert.deepEqual(Object.keys(report.models), EVALUATION_V2_MODEL_KEYS)
assert.deepEqual(report.missedOpportunityAudit.requiredTypes,
  MISSED_OPPORTUNITY_SAMPLE_TYPES)
assert.equal(report.missedOpportunityAudit.manualReviewRequired, true)
assert.equal(report.falseNegativeTaxonomy.length, FALSE_NEGATIVE_CATEGORIES.length)
assert.equal(report.falsePositiveTaxonomy.length, FALSE_POSITIVE_CATEGORIES.length)
assert.equal(report.qualityConfidence.status, 'sufficient_data')
assert.equal(report.excludedFutureEvidenceCount, 0)
assert.throws(() => evaluateCommercialSignalV2([
  row(1, { evidenceObservedAt: ['2026-08-01T00:00:00.000Z'] }),
], { evaluationAt: '2026-09-01T00:00:00.000Z' }), /future evidence/)
assert.throws(() => evaluateCommercialSignalV2([
  row(1, { decisionAt: '2026-09-02T00:00:00.000Z' }),
], { evaluationAt: '2026-09-01T00:00:00.000Z' }), /future decision/)
assert.throws(() => evaluateCommercialSignalV2([
  row(11, { rankingChangeReasons: [] }),
], { evaluationAt: '2026-09-01T00:00:00.000Z' }), /ranking change reason/)
assert.throws(() => evaluateCommercialSignalV2([
  row(1, {
    modelLineage: {
      opportunity_v3: {
        candidateId: '2001', candidateGeneration: 1,
        opportunityLineageId: '4001',
      },
      quality_engine_v2: {
        candidateId: '9999', candidateGeneration: 1,
        opportunityLineageId: '4001',
      },
    },
  }),
], { evaluationAt: '2026-09-01T00:00:00.000Z' }), /share exact candidate lineage/)
assert.throws(() => evaluateCommercialSignalV2([
  row(1, {
    outcomeProjection: {
      version: 'opportunity-outcome-state-v1',
      candidateId: '9001',
      opportunityId: '9002',
      lineageId: '9003',
      lastEventId: '9999',
      lastEventAt: '2026-09-02T00:00:00.000Z',
      repliedAt: null,
      meetingAt: null,
      wonAt: '2026-09-02T00:00:00.000Z',
    },
  }),
], { evaluationAt: '2026-09-01T00:00:00.000Z' }), /future outcome projection/)

const reversed = evaluateCommercialSignalV2([...rows].reverse(), {
  evaluationAt: '2026-09-01T00:00:00.000Z',
})
assert.deepEqual(reversed.models, report.models)
assert.deepEqual(reversed.missedOpportunityAudit, report.missedOpportunityAudit)
assert.deepEqual(reversed.featureCoverageComparison,
  report.featureCoverageComparison)
assert.deepEqual(reversed.rankingChanges, report.rankingChanges)

const splits = buildTemporalEvaluationSplits(rows, {
  trainBefore: '2026-06-15T00:00:00.000Z',
  validationBefore: '2026-07-15T00:00:00.000Z',
  holdoutBefore: '2026-09-01T00:00:00.000Z',
})
assert.ok(splits.train.length > 0)
assert.ok(splits.validation.length > 0)
assert.ok(splits.holdout.length > 0)
assert.throws(() => buildTemporalEvaluationSplits([
  row(1, {
    outcomeProjection: {
      ...row(1).outcomeProjection,
      lastEventAt: '2026-06-20T00:00:00.000Z',
      repliedAt: '2026-06-20T00:00:00.000Z',
      meetingAt: null,
      wonAt: null,
    },
  }),
], {
  trainBefore: '2026-06-15T00:00:00.000Z',
  validationBefore: '2026-07-15T00:00:00.000Z',
  holdoutBefore: '2026-09-01T00:00:00.000Z',
}), /future outcome projection/)
assert.throws(() => buildTemporalEvaluationSplits(rows, {
  trainBefore: '2026-07-15T00:00:00.000Z',
  validationBefore: '2026-06-15T00:00:00.000Z',
  holdoutBefore: '2026-08-01T00:00:00.000Z',
}), /strictly increasing/)

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: [
    'six_required_baselines',
    'precision_5_10_and_ndcg_10',
    'coverage_and_commercial_yield',
    'coverage_and_confidence',
    'feature_coverage_before_after',
    'unknown_feature_counts_before_after',
    'ranking_change_reasons',
    'promoted_demoted_and_negative_state_blocks',
    'missed_opportunity_shadow_sample',
    'false_negative_taxonomy',
    'false_positive_taxonomy',
    'future_evidence_excluded',
    'future_decisions_excluded',
    'temporal_split_specific_outcome_cutoffs',
    'same_exact_lineage_universe',
    'deterministic_results',
    'no_automatic_weight_updates',
    'v3_quality_v2_contract_only_comparison',
  ],
})}\n`)
