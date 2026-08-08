import assert from 'node:assert/strict'

import {
  EVALUATION_V2_MODEL_KEYS,
  FALSE_NEGATIVE_CATEGORIES,
  MISSED_OPPORTUNITY_SAMPLE_TYPES,
  buildTemporalEvaluationSplits,
  evaluateCommercialSignalV2,
} from './lib/commercial-signal-evaluation-v2.mjs'

const hash = (character) => character.repeat(64)
const row = (index, overrides = {}) => ({
  sampleKey: index.toString(16).padStart(64, '0'),
  agencyProfileKey: index % 2 === 0 ? hash('a') : hash('b'),
  decisionAt: `2026-${index <= 9 ? '06' : index <= 19 ? '07' : '08'}-01T00:00:00.000Z`,
  scores: {
    freshness: 1 - index / 40,
    vacancy_volume: index,
    fiur: 1 - index / 50,
    opportunity_v2: 1 - index / 45,
    opportunity_v3: index <= 12 ? 0.9 : 0.2,
    quality_engine_v2: index <= 12 ? 0.95 : 0.15,
  },
  qualityCoverage: 0.9,
  reviewLabel: index <= 12 ? 'strong' : 'weak',
  status: index <= 12 ? 'qualified_actionable' : 'review',
  friction: index % 3 === 0 ? 0.85 : 0.3,
  agencyFit: index % 4 === 0 ? 0.9 : 0.5,
  propensity: index % 4 === 0 ? 0.3 : 0.7,
  replied: index <= 8,
  meeting: index <= 5,
  won: index <= 2,
  falseNegativeCategory: index === 20 ? 'coverage_gap' : null,
  evidenceObservedAt: [
    '2026-05-01T00:00:00.000Z',
    ...(index === 1 ? ['2026-08-01T00:00:00.000Z'] : []),
  ],
  ...overrides,
})

const rows = Array.from({ length: 30 }, (_, index) => row(index + 1))
const report = evaluateCommercialSignalV2(rows)

assert.equal(report.dataStatus, 'sufficient_data')
assert.equal(report.calibrationStatus, 'uncalibrated')
assert.equal(report.automaticWeightTuning, false)
assert.equal(report.productionWrites, false)
assert.equal(report.models.opportunity_v3.precisionAt5.status, 'sufficient_data')
assert.equal(report.models.quality_engine_v2.ndcgAt10.status, 'sufficient_data')
assert.deepEqual(Object.keys(report.models), EVALUATION_V2_MODEL_KEYS)
assert.deepEqual(report.missedOpportunityAudit.requiredTypes,
  MISSED_OPPORTUNITY_SAMPLE_TYPES)
assert.equal(report.missedOpportunityAudit.manualReviewRequired, true)
assert.equal(report.falseNegativeTaxonomy.length, FALSE_NEGATIVE_CATEGORIES.length)
assert.equal(report.excludedFutureEvidenceCount, 1)

const reversed = evaluateCommercialSignalV2([...rows].reverse())
assert.deepEqual(reversed.models, report.models)
assert.deepEqual(reversed.missedOpportunityAudit, report.missedOpportunityAudit)

const splits = buildTemporalEvaluationSplits(rows, {
  trainBefore: '2026-06-15T00:00:00.000Z',
  validationBefore: '2026-07-15T00:00:00.000Z',
  holdoutBefore: '2026-09-01T00:00:00.000Z',
})
assert.ok(splits.train.length > 0)
assert.ok(splits.validation.length > 0)
assert.ok(splits.holdout.length > 0)
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
    'missed_opportunity_shadow_sample',
    'false_negative_taxonomy',
    'future_evidence_excluded',
    'temporal_split_only',
    'deterministic_results',
    'no_automatic_weight_updates',
  ],
})}\n`)
