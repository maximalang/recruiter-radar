const DEFAULT_MINIMUM_SAMPLE = 30
const DEFAULT_MINIMUM_LABELED = 10
const EXPECTED_HARD_GATE_COUNT = 6
const EPSILON = 1e-9

export function evaluateOpportunityScoringRows(
  inputRows,
  options = {},
) {
  const rows = inputRows.map(normalizeRow)
  const minimumSample = options.minimumSample ?? DEFAULT_MINIMUM_SAMPLE
  const minimumLabeled = options.minimumLabeled ?? DEFAULT_MINIMUM_LABELED
  const labeledRows = rows.filter(isLabeled)
  const labeledCount = labeledRows.length
  const dataStatus = rows.length >= minimumSample &&
    labeledCount >= minimumLabeled
    ? 'sufficient_data'
    : 'insufficient_data'
  const v1 = evaluateModel(labeledRows, 'v1Score', dataStatus)
  const v2 = evaluateModel(labeledRows, 'v2Score', dataStatus)
  const actionQueueSafetyViolations = rows.filter((row) =>
    row.actionQueueEligible && (
      row.hardGates.length !== EXPECTED_HARD_GATE_COUNT ||
      row.hardGates.some((gate) => !gate.passed) ||
      !['A', 'B'].includes(row.confidenceGate)
    ),
  )
  const failedHardGateCount = actionQueueSafetyViolations.filter((row) =>
    row.hardGates.length !== EXPECTED_HARD_GATE_COUNT ||
      row.hardGates.some((gate) => !gate.passed),
  ).length
  const confidenceGateViolationCount = actionQueueSafetyViolations.filter(
    (row) => !['A', 'B'].includes(row.confidenceGate),
  ).length
  const deltas = {
    precisionAt5: round(v2.precisionAt5.value - v1.precisionAt5.value),
    precisionAt10: round(v2.precisionAt10.value - v1.precisionAt10.value),
    ndcgAt10: round(v2.ndcgAt10.value - v1.ndcgAt10.value),
  }
  const comparisonStatus = dataStatus === 'insufficient_data'
    ? 'insufficient_data'
    : actionQueueSafetyViolations.length > 0 ||
        Object.values(deltas).some((delta) => delta < -EPSILON)
      ? 'failed'
      : 'passed'

  return {
    schemaVersion: 'opportunity-scoring-evaluation-v1',
    generatedFrom: 'anonymized_outcomes',
    dataStatus,
    absoluteCounts: {
      samples: rows.length,
      labeled: labeledCount,
      accepted: rows.filter((row) => row.accepted).length,
      contacted: rows.filter((row) => row.contacted).length,
      replied: rows.filter((row) => row.replied).length,
      meetings: rows.filter((row) => row.meeting).length,
    },
    thresholds: { minimumSample, minimumLabeled },
    models: { v1, v2 },
    comparison: {
      status: comparisonStatus,
      deltas,
      safety: {
        actionQueueSafetyViolations: actionQueueSafetyViolations.length,
        failedHardGateCount,
        confidenceGateViolationCount,
      },
    },
    badFitReasonDistribution: countValues(
      labeledRows.map((row) => row.dismissReasonCode).filter(Boolean),
    ),
    falsePositiveTaxonomy: countValues(labeledRows
      .filter((row) =>
        row.v2Score >= 0.8 &&
        !row.accepted &&
        Boolean(row.dismissReasonCode || row.lostReasonCode),
      )
      .map((row) => row.dismissReasonCode || row.lostReasonCode)),
    sourceFamilyPerformance: performanceByGroup(
      labeledRows.flatMap((row) => row.sourceFamilies.map((sourceFamily) => ({
        key: sourceFamily,
        row,
      }))),
      dataStatus,
    ),
    episodeTypePerformance: performanceByGroup(
      labeledRows.map((row) => ({ key: row.episodeType, row })),
      dataStatus,
    ),
    methodology: {
      evaluationPopulation: 'labeled_outcomes_only',
      relevance: 'accepted_or_later',
      ndcgGrades: {
        accepted: 1,
        contacted: 2,
        replied: 3,
        meeting: 4,
      },
      falsePositive:
        'v2_score_at_least_0.8_without_acceptance_and_with_dismiss_or_loss_reason',
      automaticWeightTuning: false,
      scoreMeaning: 'heuristic_rank_not_deal_probability',
    },
  }
}

function evaluateModel(rows, scoreKey, dataStatus) {
  return {
    precisionAt5: precisionAt(rows, scoreKey, 5, dataStatus),
    precisionAt10: precisionAt(rows, scoreKey, 10, dataStatus),
    ndcgAt10: ndcgAt(rows, scoreKey, 10, dataStatus),
    scoreDeciles: scoreDeciles(rows, scoreKey, dataStatus),
  }
}

function precisionAt(rows, scoreKey, limit, status) {
  const selected = sortByScore(rows, scoreKey).slice(0, limit)
  const relevant = selected.filter((row) => row.accepted).length
  return {
    status,
    value: selected.length === 0 ? 0 : round(relevant / selected.length),
    absoluteCounts: {
      selected: selected.length,
      relevant,
      requestedK: limit,
    },
  }
}

function ndcgAt(rows, scoreKey, limit, status) {
  const selected = sortByScore(rows, scoreKey).slice(0, limit)
  const actual = discountedGain(selected.map(relevanceGrade))
  const ideal = discountedGain(
    rows.map(relevanceGrade).sort((a, b) => b - a).slice(0, limit),
  )
  return {
    status,
    value: ideal === 0 ? 0 : round(actual / ideal),
    absoluteCounts: {
      selected: selected.length,
      totalGain: selected.reduce((sum, row) => sum + relevanceGrade(row), 0),
      requestedK: limit,
    },
  }
}

function scoreDeciles(rows, scoreKey, status) {
  return Array.from({ length: 10 }, (_, index) => {
    const decile = index + 1
    const bucket = rows.filter((row) => scoreDecile(row[scoreKey]) === decile)
    return {
      decile,
      scoreRange: {
        minimumInclusive: round(index / 10),
        maximumInclusive: round((index + 1) / 10),
      },
      sampleCount: bucket.length,
      acceptanceRate: rateMetric(bucket, 'accepted', status),
      contactRate: rateMetric(bucket, 'contacted', status),
      replyRate: rateMetric(bucket, 'replied', status),
      meetingRate: rateMetric(bucket, 'meeting', status),
    }
  })
}

function performanceByGroup(entries, status) {
  const grouped = new Map()
  for (const entry of entries) {
    if (!entry.key) continue
    const bucket = grouped.get(entry.key) ?? []
    bucket.push(entry.row)
    grouped.set(entry.key, bucket)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, rows]) => ({
      key,
      sampleCount: rows.length,
      acceptanceRate: rateMetric(rows, 'accepted', status),
      contactRate: rateMetric(rows, 'contacted', status),
      replyRate: rateMetric(rows, 'replied', status),
      meetingRate: rateMetric(rows, 'meeting', status),
    }))
}

function rateMetric(rows, field, status) {
  const events = rows.filter((row) => row[field]).length
  return {
    status,
    value: rows.length === 0 ? 0 : round(events / rows.length),
    absoluteCounts: { samples: rows.length, events },
  }
}

function normalizeRow(row) {
  return {
    sampleKey: normalizeSampleKey(row.sampleKey),
    v1Score: clamp01(row.v1Score),
    v2Score: clamp01(row.v2Score),
    actionQueueEligible: row.actionQueueEligible === true,
    confidenceGate: ['A', 'B', 'C', 'D'].includes(row.confidenceGate)
      ? row.confidenceGate
      : 'D',
    hardGates: Array.isArray(row.hardGates)
      ? row.hardGates.map((gate) => ({
        code: String(gate?.code ?? 'UNKNOWN'),
        passed: gate?.passed === true,
      }))
      : [],
    accepted: row.accepted === true,
    contacted: row.contacted === true,
    replied: row.replied === true,
    meeting: row.meeting === true,
    dismissReasonCode: normalizeLabel(row.dismissReasonCode),
    lostReasonCode: normalizeLabel(row.lostReasonCode),
    sourceFamilies: Array.isArray(row.sourceFamilies)
      ? [...new Set(row.sourceFamilies.map(normalizeLabel).filter(Boolean))]
      : [],
    episodeType: normalizeLabel(row.episodeType) ?? 'unknown',
  }
}

function isLabeled(row) {
  return row.accepted || Boolean(row.dismissReasonCode || row.lostReasonCode)
}

function sortByScore(rows, scoreKey) {
  return [...rows].sort((left, right) => {
    const scoreDifference = right[scoreKey] - left[scoreKey]
    return scoreDifference === 0
      ? left.sampleKey.localeCompare(right.sampleKey)
      : scoreDifference
  })
}

function relevanceGrade(row) {
  if (row.meeting) return 4
  if (row.replied) return 3
  if (row.contacted) return 2
  if (row.accepted) return 1
  return 0
}

function discountedGain(grades) {
  return grades.reduce((sum, grade, index) =>
    sum + (2 ** grade - 1) / Math.log2(index + 2), 0)
}

function scoreDecile(score) {
  if (score >= 1) return 10
  return Math.floor(clamp01(score) * 10) + 1
}

function countValues(values) {
  const counts = new Map()
  for (const value of values) {
    const normalized = normalizeLabel(value)
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({ key, count }))
}

function normalizeLabel(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

function normalizeSampleKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Evaluation sampleKey must be a lowercase SHA-256 hash')
  }
  return normalized
}

function clamp01(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function round(value) {
  return Math.round(value * 10_000) / 10_000
}
