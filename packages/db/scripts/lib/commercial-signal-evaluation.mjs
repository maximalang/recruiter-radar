import { createHash } from 'node:crypto'

export const COMMERCIAL_SIGNAL_DATASET_SCHEMA =
  'commercial-signal-evaluation-dataset-v1'
export const COMMERCIAL_SIGNAL_REPORT_SCHEMA =
  'commercial-signal-evaluation-report-v1'

export const DATASET_KINDS = [
  'synthetic_contract',
  'anonymized_labeled',
  'holdout',
  'production_shadow',
]

export const FALSE_POSITIVE_CATEGORIES = [
  'ordinary_hiring',
  'weak_agency_fit',
  'weak_external_need',
  'bad_economics',
  'stale_signal',
  'duplicate_event',
  'unverified_company',
  'wrong_role',
  'wrong_region',
  'internal_recruiting_sufficient',
  'no_actual_change',
]

export const MODEL_KEYS = [
  'recency',
  'vacancy_count',
  'old_fiur',
  'opportunity_v2',
  'opportunity_v3',
]

const DEFAULT_MINIMUM_SAMPLE = 30
const DEFAULT_MINIMUM_LABELED = 10
const CALIBRATION_MINIMUM_REVIEWED = 300
const CALIBRATION_MINIMUM_HOLDOUT = 60

export function evaluateCommercialSignalDatasets(inputDatasets, options = {}) {
  if (!Array.isArray(inputDatasets) || inputDatasets.length === 0) {
    throw new TypeError('At least one evaluation dataset is required.')
  }
  const datasets = inputDatasets.map(normalizeDataset)
  assertUniqueDatasetKinds(datasets)
  assertHoldoutIsolation(datasets)
  const reports = datasets.map((dataset) => evaluateDataset(dataset, options))
  const kindsPresent = new Set(datasets.map((dataset) => dataset.kind))
  const missingDatasetKinds = DATASET_KINDS.filter((kind) => !kindsPresent.has(kind))
  const calibration = calibrationReadiness(reports)

  return {
    schemaVersion: COMMERCIAL_SIGNAL_REPORT_SCHEMA,
    datasetSchemaVersion: COMMERCIAL_SIGNAL_DATASET_SCHEMA,
    requiredDatasetKinds: DATASET_KINDS,
    missingDatasetKinds,
    calibrationStatus: calibration.status,
    calibrationReasonCodes: calibration.reasonCodes,
    calibrationTarget: {
      reviewedOpportunities: CALIBRATION_MINIMUM_REVIEWED,
      holdoutReviewed: CALIBRATION_MINIMUM_HOLDOUT,
      diversityRequirement:
        'multiple agency types, episode types, role families, and industries require explicit review',
    },
    datasets: reports,
    comparison: compareV2V3(reports),
    methodology: {
      rankingUnit: 'agency_profile',
      precisionRelevance: 'manually_qualified_or_accepted_or_later',
      ndcgGrades: {
        qualified: 1,
        accepted: 2,
        contacted: 3,
        replied: 4,
        meeting: 5,
      },
      unavailableMetricValue: null,
      automaticWeightTuning: false,
      scoreMeaning: 'heuristic_rank_not_deal_probability',
      productionWrites: false,
    },
  }
}

function evaluateDataset(dataset, options) {
  const minimumSample = options.minimumSample ?? dataset.minimumSample ??
    DEFAULT_MINIMUM_SAMPLE
  const minimumLabeled = options.minimumLabeled ?? dataset.minimumLabeled ??
    DEFAULT_MINIMUM_LABELED
  if (dataset.status === 'unavailable') {
    return unavailableDatasetReport(dataset, minimumSample, minimumLabeled)
  }
  const labeledRows = dataset.rows.filter(isLabeled)
  const dataStatus = dataset.rows.length >= minimumSample &&
    labeledRows.length >= minimumLabeled
    ? 'sufficient_data'
    : 'insufficient_data'
  const models = Object.fromEntries(MODEL_KEYS.map((model) => [
    model,
    evaluateModel(labeledRows, model, dataStatus),
  ]))

  return {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    kind: dataset.kind,
    status: dataset.status,
    provenance: dataset.provenance,
    dataStatus,
    contentHash: datasetContentHash(dataset),
    limitations: dataset.limitations,
    thresholds: { minimumSample, minimumLabeled },
    absoluteCounts: outcomeCounts(dataset.rows, labeledRows),
    models,
    funnel: funnelMetrics(labeledRows, dataStatus),
    falsePositiveTaxonomy: taxonomyDistribution(labeledRows),
    coveragePerAgencyProfile: coverageBy(
      dataset.rows,
      (row) => row.agencyProfileKey,
    ),
    coveragePerEpisodeType: coverageBy(
      dataset.rows,
      (row) => row.episodeType,
    ),
    sourceYield: yieldBy(
      dataset.rows.flatMap((row) => row.sourceFamilies.map((key) => ({ key, row }))),
      dataStatus,
    ),
    queryPlanYield: yieldBy(
      dataset.rows
        .filter((row) => row.queryPlanKey)
        .map((row) => ({ key: row.queryPlanKey, row })),
      dataStatus,
    ),
  }
}

function evaluateModel(rows, model, dataStatus) {
  const scoreRows = rows.filter((row) => modelValue(row, model) !== null)
  if (rows.length === 0 || scoreRows.length !== rows.length) {
    return unavailableModelMetric(rows.length, scoreRows.length)
  }
  return {
    status: dataStatus,
    sampleCount: scoreRows.length,
    precisionAt5: precisionAtByProfile(scoreRows, model, 5, dataStatus),
    precisionAt10: precisionAtByProfile(scoreRows, model, 10, dataStatus),
    ndcgAt10: ndcgAtByProfile(scoreRows, model, 10, dataStatus),
  }
}

function precisionAtByProfile(rows, model, limit, status) {
  const groups = groupRows(rows, (row) => row.agencyProfileKey)
  const selected = [...groups.values()].flatMap((group) =>
    sortForModel(group, model).slice(0, limit))
  const relevant = selected.filter((row) => relevanceGrade(row) > 0).length
  return metric(
    status,
    selected.length === 0 ? null : relevant / selected.length,
    { selected: selected.length, relevant, requestedK: limit, groups: groups.size },
  )
}

function ndcgAtByProfile(rows, model, limit, status) {
  const groups = groupRows(rows, (row) => row.agencyProfileKey)
  const values = [...groups.values()].map((group) => {
    const actual = discountedGain(
      sortForModel(group, model).slice(0, limit).map(relevanceGrade),
    )
    const ideal = discountedGain(
      group.map(relevanceGrade).sort((a, b) => b - a).slice(0, limit),
    )
    return ideal === 0 ? null : actual / ideal
  }).filter((value) => value !== null)
  return metric(
    status,
    values.length === 0 ? null : average(values),
    { groups: groups.size, groupsWithGain: values.length, requestedK: limit },
  )
}

function funnelMetrics(rows, status) {
  return {
    qualifiedRate: booleanRate(rows, 'qualified', status),
    acceptedRate: booleanRate(rows, 'accepted', status),
    contactedRate: booleanRate(rows, 'contacted', status),
    replyRate: booleanRate(rows, 'replied', status),
    meetingRate: booleanRate(rows, 'meeting', status),
  }
}

function booleanRate(rows, field, status) {
  const eligible = rows.filter((row) => row.labels[field] !== null)
  const events = eligible.filter((row) => row.labels[field] === true).length
  return metric(
    eligible.length === 0 ? 'unavailable' : status,
    eligible.length === 0 ? null : events / eligible.length,
    { samples: eligible.length, events },
  )
}

function coverageBy(rows, keyFor) {
  return [...groupRows(rows, keyFor).entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, group]) => ({
      key,
      sampleCount: group.length,
      labeledCount: group.filter(isLabeled).length,
      modelCoverage: Object.fromEntries(MODEL_KEYS.map((model) => [
        model,
        group.filter((row) => modelValue(row, model) !== null).length,
      ])),
    }))
}

function yieldBy(entries, status) {
  const groups = new Map()
  for (const { key, row } of entries) {
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, rows]) => ({
      key,
      sampleCount: rows.length,
      qualifiedRate: booleanRate(rows, 'qualified', status),
      acceptedRate: booleanRate(rows, 'accepted', status),
      contactedRate: booleanRate(rows, 'contacted', status),
      replyRate: booleanRate(rows, 'replied', status),
      meetingRate: booleanRate(rows, 'meeting', status),
    }))
}

function taxonomyDistribution(rows) {
  const counts = new Map(FALSE_POSITIVE_CATEGORIES.map((key) => [key, 0]))
  for (const row of rows) {
    if (row.labels.falsePositiveCategory) {
      counts.set(
        row.labels.falsePositiveCategory,
        counts.get(row.labels.falsePositiveCategory) + 1,
      )
    }
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }))
}

function calibrationReadiness(reports) {
  const labeledReal = reports.find((report) =>
    report.kind === 'anonymized_labeled' && report.provenance === 'anonymized_real')
  const holdout = reports.find((report) =>
    report.kind === 'holdout' && report.provenance === 'anonymized_real')
  const reviewed = (labeledReal?.absoluteCounts?.labeled ?? 0) +
    (holdout?.absoluteCounts?.labeled ?? 0)
  const holdoutReviewed = holdout?.absoluteCounts?.labeled ?? 0
  const reasonCodes = []
  if (reviewed < CALIBRATION_MINIMUM_REVIEWED) {
    reasonCodes.push('CALIBRATION_REVIEWED_LT_300')
  }
  if (holdoutReviewed < CALIBRATION_MINIMUM_HOLDOUT) {
    reasonCodes.push('CALIBRATION_HOLDOUT_LT_60')
  }
  if (reasonCodes.length > 0) {
    return { status: 'insufficient_data', reasonCodes }
  }
  return {
    status: 'review_required',
    reasonCodes: ['CALIBRATION_DIVERSITY_REVIEW_REQUIRED'],
  }
}

function compareV2V3(reports) {
  const comparable = reports.filter((report) =>
    report.status === 'ready' &&
    ['precisionAt5', 'precisionAt10', 'ndcgAt10'].every((metricName) =>
      report.models.opportunity_v2[metricName].value !== null &&
      report.models.opportunity_v3[metricName].value !== null))
  const realComparable = comparable.filter((report) =>
    report.provenance === 'anonymized_real' &&
    report.dataStatus === 'sufficient_data')
  const population = realComparable.length > 0 ? realComparable : comparable
  if (population.length === 0) {
    return {
      status: 'unavailable',
      population: 'none',
      datasetCount: 0,
      deltas: { precisionAt5: null, precisionAt10: null, ndcgAt10: null },
    }
  }
  const deltas = {
    precisionAt5: averageDelta(population, 'precisionAt5'),
    precisionAt10: averageDelta(population, 'precisionAt10'),
    ndcgAt10: averageDelta(population, 'ndcgAt10'),
  }
  return {
    status: realComparable.length > 0 ? 'evaluation_only' : 'contract_only',
    population: realComparable.length > 0
      ? 'sufficient_anonymized_real_datasets'
      : 'synthetic_or_insufficient_datasets',
    datasetCount: population.length,
    deltas,
  }
}

function normalizeDataset(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Evaluation dataset must be an object.')
  }
  if (input.schemaVersion !== COMMERCIAL_SIGNAL_DATASET_SCHEMA) {
    throw new TypeError('Unsupported evaluation dataset schema.')
  }
  if (!DATASET_KINDS.includes(input.kind)) {
    throw new TypeError('Unsupported evaluation dataset kind.')
  }
  const status = input.status === 'ready' ? 'ready'
    : input.status === 'unavailable' ? 'unavailable' : null
  if (!status) throw new TypeError('Dataset status must be ready or unavailable.')
  const provenance = input.provenance === 'synthetic' ? 'synthetic'
    : input.provenance === 'anonymized_real' ? 'anonymized_real'
      : null
  if (!provenance) throw new TypeError('Dataset provenance is invalid.')
  if (input.kind === 'synthetic_contract' && provenance !== 'synthetic') {
    throw new TypeError('Synthetic contract data must declare synthetic provenance.')
  }
  if (input.kind !== 'synthetic_contract' && provenance === 'synthetic') {
    throw new TypeError('Synthetic rows cannot satisfy a real dataset kind.')
  }
  const rows = Array.isArray(input.rows)
    ? input.rows.map(normalizeRow)
      .sort((left, right) => compareText(left.sampleKey, right.sampleKey))
    : []
  if (status === 'unavailable' && rows.length > 0) {
    throw new TypeError('Unavailable datasets cannot contain rows.')
  }
  if (status === 'ready' && rows.length === 0) {
    throw new TypeError('Ready datasets require rows.')
  }
  const sampleKeys = new Set()
  for (const row of rows) {
    if (sampleKeys.has(row.sampleKey)) throw new TypeError('Duplicate sampleKey.')
    sampleKeys.add(row.sampleKey)
  }
  const minimumSample = optionalPositiveInteger(input.minimumSample)
  const minimumLabeled = optionalPositiveInteger(input.minimumLabeled)
  return {
    schemaVersion: input.schemaVersion,
    datasetId: identifier(input.datasetId, 'datasetId'),
    datasetVersion: identifier(input.datasetVersion, 'datasetVersion'),
    kind: input.kind,
    status,
    provenance,
    splitGroup: identifier(input.splitGroup, 'splitGroup'),
    exclusionSplitGroups: stringArray(input.exclusionSplitGroups),
    minimumSample,
    minimumLabeled,
    limitations: stringArray(input.limitations),
    unavailableReason: status === 'unavailable'
      ? requiredText(input.unavailableReason, 'unavailableReason')
      : null,
    rows,
  }
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') throw new TypeError('Row must be an object.')
  const labels = row.labels && typeof row.labels === 'object' ? row.labels : {}
  const normalized = {
    sampleKey: hash(row.sampleKey, 'sampleKey'),
    agencyProfileKey: hash(row.agencyProfileKey, 'agencyProfileKey'),
    episodeType: identifier(row.episodeType, 'episodeType'),
    sourceFamilies: stringArray(row.sourceFamilies),
    queryPlanKey: row.queryPlanKey == null ? null : hash(row.queryPlanKey, 'queryPlanKey'),
    observedAt: timestamp(row.observedAt),
    vacancyCount: row.vacancyCount == null
      ? null
      : nonNegativeNumber(row.vacancyCount, 'vacancyCount'),
    scores: {
      oldFiur: optionalFiniteNumber(row.scores?.oldFiur),
      opportunityV2: optionalFiniteNumber(row.scores?.opportunityV2),
      opportunityV3: optionalFiniteNumber(row.scores?.opportunityV3),
    },
    labels: {
      qualified: optionalBoolean(labels.qualified),
      accepted: optionalBoolean(labels.accepted),
      contacted: optionalBoolean(labels.contacted),
      replied: optionalBoolean(labels.replied),
      meeting: optionalBoolean(labels.meeting),
      falsePositiveCategory: normalizeFalsePositiveCategory(
        labels.falsePositiveCategory,
      ),
    },
  }
  if (normalized.labels.falsePositiveCategory &&
      !FALSE_POSITIVE_CATEGORIES.includes(normalized.labels.falsePositiveCategory)) {
    throw new TypeError('Unknown false-positive category.')
  }
  assertOutcomeOrder(normalized.labels)
  if (normalized.labels.falsePositiveCategory &&
      relevanceGrade(normalized) > 0) {
    throw new TypeError('A relevant row cannot be labeled as a false positive.')
  }
  return normalized
}

function normalizeFalsePositiveCategory(value) {
  if (value == null) return null
  const normalized = identifier(value, 'falsePositiveCategory')
  return normalized === 'internal_only'
    ? 'internal_recruiting_sufficient'
    : normalized
}

function assertOutcomeOrder(labels) {
  const fields = ['qualified', 'accepted', 'contacted', 'replied', 'meeting']
  for (let index = 1; index < fields.length; index += 1) {
    if (labels[fields[index]] === true && labels[fields[index - 1]] === false) {
      throw new TypeError('Outcome labels must be monotonic.')
    }
  }
}

function assertUniqueDatasetKinds(datasets) {
  const kinds = new Set()
  for (const dataset of datasets) {
    if (kinds.has(dataset.kind)) throw new TypeError('Duplicate dataset kind.')
    kinds.add(dataset.kind)
  }
}

function assertHoldoutIsolation(datasets) {
  const holdout = datasets.find((dataset) => dataset.kind === 'holdout')
  if (!holdout || holdout.status === 'unavailable') return
  const forbiddenGroups = new Set(holdout.exclusionSplitGroups)
  const forbiddenKeys = new Set(datasets
    .filter((dataset) => forbiddenGroups.has(dataset.splitGroup))
    .flatMap((dataset) => dataset.rows.map((row) => row.sampleKey)))
  if (holdout.rows.some((row) => forbiddenKeys.has(row.sampleKey))) {
    throw new TypeError('Holdout sample overlaps an excluded split group.')
  }
}

function unavailableDatasetReport(dataset, minimumSample, minimumLabeled) {
  const unavailableMetric = metric('unavailable', null, { samples: 0, events: 0 })
  const model = unavailableModelMetric(0, 0)
  return {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    kind: dataset.kind,
    status: dataset.status,
    provenance: dataset.provenance,
    dataStatus: 'unavailable',
    contentHash: datasetContentHash(dataset),
    unavailableReason: dataset.unavailableReason,
    limitations: dataset.limitations,
    thresholds: { minimumSample, minimumLabeled },
    absoluteCounts: outcomeCounts([], []),
    models: Object.fromEntries(MODEL_KEYS.map((key) => [key, model])),
    funnel: {
      qualifiedRate: unavailableMetric,
      acceptedRate: unavailableMetric,
      contactedRate: unavailableMetric,
      replyRate: unavailableMetric,
      meetingRate: unavailableMetric,
    },
    falsePositiveTaxonomy: FALSE_POSITIVE_CATEGORIES
      .map((key) => ({ key, count: 0 })),
    coveragePerAgencyProfile: [],
    coveragePerEpisodeType: [],
    sourceYield: [],
    queryPlanYield: [],
  }
}

function unavailableModelMetric(total, available) {
  const unavailable = metric('unavailable', null, {
    selected: 0,
    relevant: 0,
    requestedK: null,
  })
  return {
    status: 'unavailable',
    sampleCount: available,
    missingSampleCount: total - available,
    precisionAt5: unavailable,
    precisionAt10: unavailable,
    ndcgAt10: unavailable,
  }
}

function outcomeCounts(rows, labeledRows) {
  return {
    samples: rows.length,
    labeled: labeledRows.length,
    qualified: rows.filter((row) => row.labels.qualified === true).length,
    accepted: rows.filter((row) => row.labels.accepted === true).length,
    contacted: rows.filter((row) => row.labels.contacted === true).length,
    replied: rows.filter((row) => row.labels.replied === true).length,
    meetings: rows.filter((row) => row.labels.meeting === true).length,
  }
}

function datasetContentHash(dataset) {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: dataset.schemaVersion,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    kind: dataset.kind,
    status: dataset.status,
    provenance: dataset.provenance,
    splitGroup: dataset.splitGroup,
    exclusionSplitGroups: dataset.exclusionSplitGroups,
    rows: dataset.rows,
  })).digest('hex')
}

function modelValue(row, model) {
  if (model === 'recency') return Date.parse(row.observedAt)
  if (model === 'vacancy_count') return row.vacancyCount
  if (model === 'old_fiur') return row.scores.oldFiur
  if (model === 'opportunity_v2') return row.scores.opportunityV2
  if (model === 'opportunity_v3') return row.scores.opportunityV3
  throw new TypeError(`Unknown model: ${model}`)
}

function sortForModel(rows, model) {
  return [...rows].sort((left, right) => {
    const difference = modelValue(right, model) - modelValue(left, model)
    return difference === 0
      ? compareText(left.sampleKey, right.sampleKey)
      : difference
  })
}

function relevanceGrade(row) {
  if (row.labels.meeting) return 5
  if (row.labels.replied) return 4
  if (row.labels.contacted) return 3
  if (row.labels.accepted) return 2
  if (row.labels.qualified) return 1
  return 0
}

function isLabeled(row) {
  return Object.values(row.labels).some((value) => value !== null)
}

function discountedGain(grades) {
  return grades.reduce((sum, grade, index) =>
    sum + (2 ** grade - 1) / Math.log2(index + 2), 0)
}

function groupRows(rows, keyFor) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFor(row)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return groups
}

function metric(status, value, absoluteCounts) {
  return {
    status,
    value: value === null ? null : round(value),
    absoluteCounts,
  }
}

function averageDelta(reports, metricName) {
  return round(average(reports.map((report) =>
    report.models.opportunity_v3[metricName].value -
    report.models.opportunity_v2[metricName].value)))
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) throw new TypeError('observedAt is invalid.')
  return new Date(parsed).toISOString()
}

function optionalBoolean(value) {
  if (value == null) return null
  if (typeof value !== 'boolean') throw new TypeError('Label must be boolean or null.')
  return value
}

function optionalFiniteNumber(value) {
  if (value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw new TypeError('Score must be finite or null.')
  return number
}

function nonNegativeNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be non-negative.`)
  }
  return number
}

function optionalPositiveInteger(value) {
  if (value == null) return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('Minimum sample threshold must be a positive integer.')
  }
  return number
}

function hash(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hash.`)
  }
  return normalized
}

function identifier(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return normalized
}

function requiredText(value, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new TypeError(`${label} is required.`)
  return normalized
}

function stringArray(value) {
  if (!Array.isArray(value)) throw new TypeError('Expected an array of strings.')
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    .sort(compareText)
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function round(value) {
  return Math.round(value * 10_000) / 10_000
}