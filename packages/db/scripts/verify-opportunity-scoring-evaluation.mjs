import assert from 'node:assert/strict'

import { evaluateOpportunityScoringRows } from './lib/opportunity-scoring-evaluation.mjs'

const passingRows = Array.from({ length: 40 }, (_, index) => {
  const strongV2 = index < 10
  const accepted = strongV2 || index === 30 || index === 31
  const contacted = index < 8
  const replied = index < 5
  const meeting = index < 3

  return {
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
    'small_sample_status',
    'no_automatic_tuning',
    'evidence_safety_gate',
  ],
})}\n`)
