import { createHash } from 'node:crypto'

export const COMMERCIAL_SIGNAL_EVALUATION_V2_SCHEMA =
  'commercial-signal-evaluation-v2'

export const EVALUATION_V2_MODEL_KEYS = [
  'freshness',
  'vacancy_volume',
  'fiur',
  'opportunity_v2',
  'opportunity_v3',
  'quality_engine_v2',
]

export const MISSED_OPPORTUNITY_SAMPLE_TYPES = [
  'just_below_threshold',
  'random_review_candidate',
  'high_friction_low_rank',
  'high_fit_low_propensity',
]

export const FALSE_NEGATIVE_CATEGORIES = [
  'coverage_gap',
  'source_gap',
  'friction_underestimated',
  'agency_fit_underestimated',
  'propensity_underestimated',
  'timing_decay_too_aggressive',
  'negative_evidence_false_block',
  'contact_path_missing',
  'unknown',
]

const DEFAULT_MINIMUM_SAMPLE = 30
const DEFAULT_MINIMUM_LABELED = 10

export function evaluateCommercialSignalV2(inputRows, options = {}) {
  const rows = inputRows.map(normalizeRow)
    .sort((left, right) => compareText(left.sampleKey, right.sampleKey))
  assertUnique(rows.map((row) => row.sampleKey), 'sample key')
  const minimumSample = positiveInteger(
    options.minimumSample ?? DEFAULT_MINIMUM_SAMPLE,
    'minimum sample',
  )
  const minimumLabeled = positiveInteger(
    options.minimumLabeled ?? DEFAULT_MINIMUM_LABELED,
    'minimum labeled',
  )
  const labeled = rows.filter((row) => row.reviewLabel !== null)
  const dataStatus = rows.length >= minimumSample && labeled.length >= minimumLabeled
    ? 'sufficient_data'
    : 'insufficient_data'
  const models = Object.fromEntries(EVALUATION_V2_MODEL_KEYS.map((model) => [
    model,
    evaluateModel(labeled, model, dataStatus),
  ]))
  const provenance = options.provenance === 'anonymized_real'
    ? 'anonymized_real'
    : 'synthetic_contract'
  const qualifiedWeeks = new Set(rows
    .filter((row) => row.status.startsWith('qualified_'))
    .map((row) => `${row.agencyProfileKey}:${isoWeek(row.decisionAt)}`))
  const profileCount = new Set(rows.map((row) => row.agencyProfileKey)).size
  const weekCount = new Set(rows.map((row) => isoWeek(row.decisionAt))).size

  return {
    schemaVersion: COMMERCIAL_SIGNAL_EVALUATION_V2_SCHEMA,
    dataStatus,
    provenance,
    sampleCount: rows.length,
    labeledCount: labeled.length,
    modelType: 'heuristic',
    calibrationStatus: 'uncalibrated',
    models,
    comparison: compareV3Quality(models, provenance, dataStatus),
    qualityCoverage: metric(
      dataStatus,
      rows.length === 0 ? null : average(rows.map((row) => row.qualityCoverage)),
      { samples: rows.length },
    ),
    strongAcceptableRate: booleanMetric(
      labeled,
      (row) => row.reviewLabel === 'strong' || row.reviewLabel === 'acceptable',
      dataStatus,
    ),
    replyRate: nullableBooleanMetric(rows, 'replied', dataStatus),
    meetingRate: nullableBooleanMetric(rows, 'meeting', dataStatus),
    wonRate: nullableBooleanMetric(rows, 'won', dataStatus),
    qualifiedOpportunitiesPerProfileWeek: metric(
      dataStatus,
      profileCount === 0 || weekCount === 0
        ? null
        : qualifiedWeeks.size / (profileCount * weekCount),
      { qualifiedProfileWeeks: qualifiedWeeks.size, profileCount, weekCount },
    ),
    missedOpportunityAudit: buildMissedOpportunityAudit(rows, options),
    falseNegativeTaxonomy: FALSE_NEGATIVE_CATEGORIES.map((category) => ({
      category,
      count: rows.filter((row) => row.falseNegativeCategory === category).length,
    })),
    excludedFutureEvidenceCount: rows.reduce((total, row) =>
      total + row.excludedFutureEvidenceCount, 0),
    automaticWeightTuning: false,
    productionWrites: false,
    scoreMeaning: 'heuristic_rank_not_deal_probability',
  }
}

function compareV3Quality(models, provenance, dataStatus) {
  const v3 = models.opportunity_v3
  const quality = models.quality_engine_v2
  const values = ['precisionAt5', 'precisionAt10', 'ndcgAt10']
  const comparable = values.every((key) =>
    v3[key].value !== null && quality[key].value !== null)
  if (!comparable) {
    return {
      status: 'unavailable',
      population: provenance,
      deltas: { precisionAt5: null, precisionAt10: null, ndcgAt10: null },
    }
  }
  return {
    status: provenance === 'anonymized_real' && dataStatus === 'sufficient_data'
      ? 'evaluation_only'
      : 'contract_only',
    population: provenance,
    deltas: Object.fromEntries(values.map((key) => [
      key,
      round(quality[key].value - v3[key].value),
    ])),
  }
}

export function buildTemporalEvaluationSplits(inputRows, boundaries) {
  const trainBefore = timestamp(boundaries.trainBefore, 'train boundary')
  const validationBefore = timestamp(
    boundaries.validationBefore,
    'validation boundary',
  )
  const holdoutBefore = timestamp(boundaries.holdoutBefore, 'holdout boundary')
  if (!(trainBefore < validationBefore && validationBefore < holdoutBefore)) {
    throw new TypeError('temporal split boundaries must be strictly increasing')
  }
  const rows = inputRows.map(normalizeRow)
  const result = { train: [], validation: [], holdout: [] }
  for (const row of rows) {
    const decisionAt = Date.parse(row.decisionAt)
    if (decisionAt < trainBefore) result.train.push(row)
    else if (decisionAt < validationBefore) result.validation.push(row)
    else if (decisionAt < holdoutBefore) result.holdout.push(row)
  }
  return result
}

function evaluateModel(rows, model, dataStatus) {
  const available = rows.filter((row) => row.scores[model] !== null)
  if (rows.length === 0 || available.length !== rows.length) {
    return {
      status: 'unavailable',
      sampleCount: available.length,
      missingSampleCount: rows.length - available.length,
      precisionAt5: metric('unavailable', null, { selected: 0, relevant: 0 }),
      precisionAt10: metric('unavailable', null, { selected: 0, relevant: 0 }),
      ndcgAt10: metric('unavailable', null, { groups: 0 }),
    }
  }
  return {
    status: dataStatus,
    sampleCount: available.length,
    missingSampleCount: 0,
    precisionAt5: precisionAt(available, model, 5, dataStatus),
    precisionAt10: precisionAt(available, model, 10, dataStatus),
    ndcgAt10: ndcgAt(available, model, 10, dataStatus),
  }
}

function precisionAt(rows, model, limit, status) {
  const selected = [...groupRows(rows).values()].flatMap((group) =>
    rank(group, model).slice(0, limit))
  const relevant = selected.filter((row) => relevance(row) > 0).length
  return metric(status, selected.length === 0 ? null : relevant / selected.length, {
    selected: selected.length,
    relevant,
    requestedK: limit,
  })
}

function ndcgAt(rows, model, limit, status) {
  const values = [...groupRows(rows).values()].map((group) => {
    const actual = discountedGain(rank(group, model).slice(0, limit).map(relevance))
    const ideal = discountedGain(group.map(relevance).sort((a, b) => b - a)
      .slice(0, limit))
    return ideal === 0 ? null : actual / ideal
  }).filter((value) => value !== null)
  return metric(status, values.length === 0 ? null : average(values), {
    groups: values.length,
    requestedK: limit,
  })
}

function buildMissedOpportunityAudit(rows, options) {
  const limitPerType = positiveInteger(options.shadowSamplePerType ?? 5, 'sample size')
  const threshold = unitInterval(options.qualityThreshold ?? 0.68, 'quality threshold')
  const selected = []
  const add = (type, candidates) => {
    for (const row of candidates.slice(0, limitPerType)) {
      selected.push({ type, sampleKey: row.sampleKey })
    }
  }
  add('just_below_threshold', rows
    .filter((row) => row.scores.quality_engine_v2 !== null &&
      row.scores.quality_engine_v2 < threshold)
    .sort((left, right) =>
      right.scores.quality_engine_v2 - left.scores.quality_engine_v2 ||
      compareText(left.sampleKey, right.sampleKey)))
  add('random_review_candidate', rows
    .filter((row) => row.status === 'review')
    .sort((left, right) => compareText(stableRandom(left), stableRandom(right))))
  add('high_friction_low_rank', rows
    .filter((row) => row.friction >= 0.7 &&
      (row.scores.quality_engine_v2 ?? 0) < threshold)
    .sort((left, right) => right.friction - left.friction ||
      compareText(left.sampleKey, right.sampleKey)))
  add('high_fit_low_propensity', rows
    .filter((row) => row.agencyFit >= 0.75 && row.propensity < 0.5)
    .sort((left, right) => right.agencyFit - left.agencyFit ||
      compareText(left.sampleKey, right.sampleKey)))
  return {
    requiredTypes: MISSED_OPPORTUNITY_SAMPLE_TYPES,
    samples: selected.sort((left, right) =>
      MISSED_OPPORTUNITY_SAMPLE_TYPES.indexOf(left.type) -
        MISSED_OPPORTUNITY_SAMPLE_TYPES.indexOf(right.type) ||
      compareText(left.sampleKey, right.sampleKey)),
    manualReviewRequired: true,
  }
}

function normalizeRow(input) {
  const decisionAt = isoTimestamp(input.decisionAt, 'decision at')
  const evidenceObservedAt = stringArray(input.evidenceObservedAt)
    .map((value) => isoTimestamp(value, 'evidence observed at'))
  const futureEvidence = evidenceObservedAt.filter((value) => value > decisionAt)
  if (futureEvidence.length > 0) {
    throw new TypeError('future evidence cannot enter an evaluated score row')
  }
  return {
    sampleKey: hash(input.sampleKey, 'sample key'),
    agencyProfileKey: hash(input.agencyProfileKey, 'agency profile key'),
    decisionAt,
    scores: Object.fromEntries(EVALUATION_V2_MODEL_KEYS.map((key) => [
      key,
      optionalFinite(input.scores?.[key]),
    ])),
    qualityCoverage: unitInterval(input.qualityCoverage, 'quality coverage'),
    reviewLabel: input.reviewLabel == null ? null
      : enumValue(input.reviewLabel, ['strong', 'acceptable', 'weak'], 'review label'),
    status: enumValue(input.status, [
      'qualified_actionable',
      'qualified_needs_enrichment',
      'review',
      'blocked',
      'expired',
      'dismissed',
    ], 'status'),
    friction: unitInterval(input.friction, 'friction'),
    agencyFit: unitInterval(input.agencyFit, 'agency fit'),
    propensity: unitInterval(input.propensity, 'propensity'),
    replied: optionalBoolean(input.replied),
    meeting: optionalBoolean(input.meeting),
    won: optionalBoolean(input.won),
    falseNegativeCategory: input.falseNegativeCategory == null ? null
      : enumValue(
        input.falseNegativeCategory,
        FALSE_NEGATIVE_CATEGORIES,
        'false negative category',
      ),
    evidenceObservedAt,
    excludedFutureEvidenceCount: 0,
  }
}

function groupRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    groups.set(row.agencyProfileKey, [
      ...(groups.get(row.agencyProfileKey) ?? []),
      row,
    ])
  }
  return groups
}

function rank(rows, model) {
  return [...rows].sort((left, right) =>
    right.scores[model] - left.scores[model] ||
    compareText(left.sampleKey, right.sampleKey))
}

function relevance(row) {
  if (row.won === true) return 7
  if (row.meeting === true) return 5
  if (row.replied === true) return 4
  if (row.reviewLabel === 'strong') return 2
  if (row.reviewLabel === 'acceptable') return 1
  return 0
}

function discountedGain(values) {
  return values.reduce((sum, value, index) =>
    sum + (2 ** value - 1) / Math.log2(index + 2), 0)
}

function nullableBooleanMetric(rows, field, status) {
  const known = rows.filter((row) => row[field] !== null)
  return booleanMetric(known, (row) => row[field] === true, status)
}

function booleanMetric(rows, predicate, status) {
  const events = rows.filter(predicate).length
  return metric(rows.length === 0 ? 'unavailable' : status,
    rows.length === 0 ? null : events / rows.length,
    { samples: rows.length, events })
}

function metric(status, value, counts) {
  return { status, value: value === null ? null : round(value), counts }
}

function stableRandom(row) {
  return createHash('sha256').update(row.sampleKey).digest('hex')
}

function isoWeek(value) {
  const date = new Date(value)
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  return `${date.getUTCFullYear()}-${Math.floor((date.getTime() - start) /
    (7 * 86_400_000))}`
}

function hash(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${label} must be a SHA-256 hash`)
  }
  return normalized
}

function isoTimestamp(value, label) {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`)
  return new Date(parsed).toISOString()
}

function timestamp(value, label) {
  return Date.parse(isoTimestamp(value, label))
}

function optionalFinite(value) {
  if (value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw new TypeError('score must be finite or null')
  return number
}

function optionalBoolean(value) {
  if (value == null) return null
  if (typeof value !== 'boolean') throw new TypeError('outcome must be boolean or null')
  return value
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function stringArray(value) {
  if (!Array.isArray(value)) throw new TypeError('expected an array')
  return [...new Set(value.map(String))].sort(compareText)
}

function unitInterval(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError(`${label} must be between 0 and 1`)
  }
  return number
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return number
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`duplicate ${label}`)
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function round(value) {
  return Math.round(value * 10_000) / 10_000
}
