import assert from 'node:assert/strict'

import { evaluateOpportunityScoringRows } from './lib/opportunity-scoring-evaluation.mjs'

const passingRows = Array.from({ length: 40 }, (_, index) => {
  const strongV2 = index < 10
  const accepted = strongV2 || index === 30 || index === 31
  const contacted = index < 8
  const replied = index < 5
  const meeting = index < 3

  return {
    sampleKey: (index + 1).toString(16).padStart(64, '0'),
    v1Score: index < 10 ? 0.4 + index / 100 : (40 - index) / 100,
    v2Score: strongV2 ? 1 - index / 100 : (40 - index) / 100,
    actionQueueEligible: strongV2,
    confidenceGate: strongV2 ? 'A' : 'C',
    hardGates: Array.from({ length: 6 }, (_, gateIndex) => ({
      code: `GATE_${gateIndex + 1}`,
      passed: true,
    })),
    accepted,
    contacted,
    replied,
    meeting,
    dismissReasonCode: accepted ? null : index % 2 === 0 ? 'BAD_FIT' : null,
    lostReasonCode: accepted || index % 2 === 0 ? null : 'NO_REPLY',
    sourceFamilies: [index % 2 === 0 ? 'career' : 'procurement'],
    episodeType: index % 2 === 0 ? 'vacancy_spike' : 'new_region',
  }
})

const report = evaluateOpportunityScoringRows(passingRows)
assert.equal(report.dataStatus, 'sufficient_data')
assert.equal(report.comparison.status, 'passed')
assert.equal(report.comparison.safety.actionQueueSafetyViolations, 0)
assert.equal(report.models.v2.precisionAt5.value, 1)
assert.equal(report.models.v2.precisionAt10.value, 1)
assert.ok(
  report.models.v2.ndcgAt10.value >= report.models.v1.ndcgAt10.value,
)
assert.equal(report.models.v2.scoreDeciles.length, 10)
assert.equal(report.sourceFamilyPerformance.length, 2)
assert.equal(report.episodeTypePerformance.length, 2)
assert.ok(report.badFitReasonDistribution.length > 0)
assert.equal(report.methodology.automaticWeightTuning, false)

const unlabeledHighScore = {
  ...passingRows[0],
  sampleKey: 'f'.repeat(64),
  v1Score: 1,
  v2Score: 1,
  actionQueueEligible: false,
  confidenceGate: 'C',
  accepted: false,
  contacted: false,
  replied: false,
  meeting: false,
  dismissReasonCode: null,
  lostReasonCode: null,
}
const labeledPopulationReport = evaluateOpportunityScoringRows(
  [passingRows[0], unlabeledHighScore],
  { minimumSample: 1, minimumLabeled: 1 },
)
assert.equal(labeledPopulationReport.absoluteCounts.samples, 2)
assert.equal(labeledPopulationReport.absoluteCounts.labeled, 1)
assert.deepEqual(
  labeledPopulationReport.models.v2.precisionAt5.absoluteCounts,
  { selected: 1, relevant: 1, requestedK: 5 },
)
assert.equal(labeledPopulationReport.models.v2.precisionAt5.value, 1)

const tiedRows = Array.from({ length: 6 }, (_, index) => ({
  ...passingRows[0],
  sampleKey: (index + 101).toString(16).padStart(64, '0'),
  v1Score: 0.5,
  v2Score: 0.5,
  actionQueueEligible: false,
  confidenceGate: 'C',
  accepted: index < 5,
  contacted: false,
  replied: false,
  meeting: false,
  dismissReasonCode: index < 5 ? null : 'BAD_FIT',
  lostReasonCode: null,
}))
const tiedForward = evaluateOpportunityScoringRows(
  tiedRows,
  { minimumSample: 1, minimumLabeled: 1 },
)
const tiedReverse = evaluateOpportunityScoringRows(
  [...tiedRows].reverse(),
  { minimumSample: 1, minimumLabeled: 1 },
)
assert.deepEqual(tiedForward.models, tiedReverse.models)

const smallSample = evaluateOpportunityScoringRows(passingRows.slice(0, 3))
assert.equal(smallSample.dataStatus, 'insufficient_data')
assert.equal(smallSample.comparison.status, 'insufficient_data')
assert.deepEqual(smallSample.absoluteCounts, {
  samples: 3,
  labeled: 3,
  accepted: 3,
  contacted: 3,
  replied: 3,
  meetings: 3,
})

const unsafeRows = passingRows.map((row, index) => index === 0
  ? {
      ...row,
      confidenceGate: 'C',
      hardGates: [{ code: 'ELIGIBLE', passed: false }],
    }
  : row)
const unsafeReport = evaluateOpportunityScoringRows(unsafeRows)
assert.equal(unsafeReport.comparison.status, 'failed')
assert.equal(unsafeReport.comparison.safety.actionQueueSafetyViolations, 1)
assert.equal(unsafeReport.comparison.safety.failedHardGateCount, 1)
assert.equal(unsafeReport.comparison.safety.confidenceGateViolationCount, 1)

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: [
    'required_metrics',
    'absolute_counts',
    'labeled_outcomes_only',
    'deterministic_score_ties',
    'small_sample_status',
    'no_automatic_tuning',
    'evidence_safety_gate',
  ],
})}\n`)
