import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateCommercialSignalCanaryQuality,
  finalizeCommercialSignalCanaryReceipt,
  verifyCommercialSignalCanaryReceipt,
} from './commercial-signal-canary-quality.mjs'

function opportunity(run, rank, overrides = {}) {
  const ordinal = (run - 1) * 20 + rank
  return {
    rank,
    lineageId: String(10_000 + ordinal),
    clientProfileId: '17',
    organizationId: String(20_000 + ordinal),
    signalEpisodeId: String(30_000 + ordinal),
    situationKey: `17:${30_000 + ordinal}`,
    evidenceSetKey: `17:${40_000 + ordinal}`,
    candidateStatus: 'qualified_actionable',
    cardStatus: 'qualified_actionable',
    hasExactEvidenceLineage: true,
    hasWhyNow: true,
    hasAgencyDnaLineage: true,
    rawVacancyOnly: false,
    ...overrides,
  }
}

function receipt(run, overrides = {}) {
  return finalizeCommercialSignalCanaryReceipt({
    schemaVersion: 'commercial-signal-canary-run-receipt-v1',
    runId: `run-${run}`,
    workspaceId: '7',
    startedAt: `2026-08-0${run}T10:00:00.000Z`,
    completedAt: `2026-08-0${run}T10:05:00.000Z`,
    targetHost: 'radar.example.test',
    completed: true,
    failedStage: null,
    stages: [
      { name: 'query_plan_yield', status: 'succeeded' },
      { name: 'commercial_signal_canary', status: 'succeeded' },
      { name: 'corporate_enrichment', status: 'succeeded' },
      { name: 'top_review_snapshot', status: 'succeeded' },
    ],
    topRanked: Array.from({ length: 20 }, (_, index) =>
      opportunity(run, index + 1)),
    ...overrides,
  })
}

function annotations(receipts, mutate = (annotation) => annotation) {
  return receipts.flatMap((item) => item.topRanked.map((row) => mutate({
    lineageId: row.lineageId,
    label: 'strong',
    reasonCode: 'other',
    reviewSet: 'canary',
  }, row, item)))
}

test('passes only after three complete runs, 50 reviewed rows, and P@5 >= 0.80', () => {
  const receipts = [receipt(1), receipt(2), receipt(3)]
  const report = evaluateCommercialSignalCanaryQuality({
    workspaceId: '7',
    receipts,
    annotations: annotations(receipts, (annotation, row) => ({
      ...annotation,
      label: row.rank === 5 ? 'acceptable' : 'strong',
    })),
  })

  assert.equal(report.status, 'passed')
  assert.equal(report.sample.completedRuns, 3)
  assert.equal(report.sample.uniqueReviewedTopRanked, 60)
  assert.equal(report.metrics.precisionAt5, 1)
  assert.deepEqual(report.reasonCodes, [])
  assert.equal(report.qualityGatePassed, true)
  assert.equal(report.widerRolloutEligibleForReview, true)
  assert.equal(report.automaticRolloutAuthorized, false)
})

test('fails closed when the reviewed sample or run count is too small', () => {
  const receipts = [receipt(1), receipt(2)]
  const report = evaluateCommercialSignalCanaryQuality({
    workspaceId: '7',
    receipts,
    annotations: annotations(receipts),
  })

  assert.equal(report.status, 'insufficient_sample')
  assert.ok(report.reasonCodes.includes('COMPLETED_RUNS_LT_3'))
  assert.ok(report.reasonCodes.includes('REVIEWED_TOP_RANKED_LT_50'))
})

test('fails quality when any run has Precision@5 below 0.80', () => {
  const receipts = [receipt(1), receipt(2), receipt(3)]
  const report = evaluateCommercialSignalCanaryQuality({
    workspaceId: '7',
    receipts,
    annotations: annotations(receipts, (annotation, row, item) => ({
      ...annotation,
      label: item.runId === 'run-2' && row.rank <= 2
        ? 'not_a_lead'
        : 'strong',
      reasonCode: item.runId === 'run-2' && row.rank <= 2
        ? 'ordinary_hiring'
        : 'other',
    })),
  })

  assert.equal(report.status, 'failed')
  assert.ok(report.reasonCodes.includes('PRECISION_AT_5_BELOW_0_80'))
  assert.ok(report.reasonCodes.includes('CRITICAL_FALSE_POSITIVE_IN_TODAY'))
})

test('fails closed on missing lineage, raw-vacancy-only Today, or duplicate situation', () => {
  const broken = receipt(3)
  broken.topRanked[0].hasExactEvidenceLineage = false
  broken.topRanked[1].rawVacancyOnly = true
  broken.topRanked[2].situationKey = broken.topRanked[3].situationKey
  broken.topRanked[4].evidenceSetKey = broken.topRanked[5].evidenceSetKey
  const receipts = [receipt(1), receipt(2), finalizeCommercialSignalCanaryReceipt({
    ...broken,
    integrity: undefined,
  })]
  const report = evaluateCommercialSignalCanaryQuality({
    workspaceId: '7',
    receipts,
    annotations: annotations(receipts),
  })

  assert.equal(report.status, 'failed')
  assert.ok(report.reasonCodes.includes('TODAY_LINEAGE_INCOMPLETE'))
  assert.ok(report.reasonCodes.includes('RAW_VACANCY_IN_TODAY'))
  assert.ok(report.reasonCodes.includes('DUPLICATE_SITUATION_IN_TODAY'))
})

test('rejects a tampered or cross-workspace receipt', () => {
  const valid = receipt(1)
  assert.equal(verifyCommercialSignalCanaryReceipt(valid).ok, true)

  const tampered = structuredClone(valid)
  tampered.topRanked[0].organizationId = '999'
  assert.equal(verifyCommercialSignalCanaryReceipt(tampered).ok, false)

  assert.throws(() => evaluateCommercialSignalCanaryQuality({
    workspaceId: '8',
    receipts: [valid],
    annotations: [],
  }), /workspace/i)
})

test('rejects a receipt whose completed state contradicts its stage chain', () => {
  assert.throws(() => finalizeCommercialSignalCanaryReceipt({
    ...receipt(1),
    integrity: undefined,
    stages: [{ name: 'query_plan_yield', status: 'failed' }],
  }), /stage chain/i)
})
