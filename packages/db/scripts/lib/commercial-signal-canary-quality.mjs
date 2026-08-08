import { createHash } from 'node:crypto'

export const COMMERCIAL_SIGNAL_CANARY_RECEIPT_SCHEMA =
  'commercial-signal-canary-run-receipt-v1'
export const COMMERCIAL_SIGNAL_CANARY_QUALITY_SCHEMA =
  'commercial-signal-canary-quality-report-v1'

const MINIMUM_COMPLETED_RUNS = 3
const MINIMUM_REVIEWED_TOP_RANKED = 50
const MINIMUM_PRECISION_AT_5 = 0.8
const LABEL_RELEVANCE = Object.freeze({
  strong: 3,
  acceptable: 2,
  weak: 1,
  not_a_lead: 0,
})

export function finalizeCommercialSignalCanaryReceipt(input) {
  const receipt = normalizeReceipt(input)
  return {
    ...receipt,
    integrity: {
      algorithm: 'sha256',
      value: sha256(stableStringify(receipt)),
    },
  }
}

export function verifyCommercialSignalCanaryReceipt(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, reasonCode: 'INVALID_RECEIPT' }
    }
    const receipt = normalizeReceipt(input)
    const integrity = input.integrity
    if (
      !integrity || integrity.algorithm !== 'sha256' ||
      typeof integrity.value !== 'string' ||
      !/^[a-f0-9]{64}$/.test(integrity.value)
    ) {
      return { ok: false, reasonCode: 'RECEIPT_INTEGRITY_MISSING' }
    }
    const expected = sha256(stableStringify(receipt))
    return expected === integrity.value
      ? { ok: true, receipt }
      : { ok: false, reasonCode: 'RECEIPT_INTEGRITY_MISMATCH' }
  } catch {
    return { ok: false, reasonCode: 'INVALID_RECEIPT' }
  }
}

export function evaluateCommercialSignalCanaryQuality({
  workspaceId,
  receipts,
  annotations,
  evaluatedAt = new Date(),
}) {
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace')
  if (!Array.isArray(receipts) || receipts.length === 0) {
    throw new TypeError('At least one canary receipt is required.')
  }
  if (!Array.isArray(annotations)) {
    throw new TypeError('annotations must be an array.')
  }

  const verified = receipts.map((input) => {
    const result = verifyCommercialSignalCanaryReceipt(input)
    if (!result.ok) throw new Error(`Invalid canary receipt: ${result.reasonCode}.`)
    if (result.receipt.workspaceId !== normalizedWorkspaceId) {
      throw new Error('Canary receipt workspace does not match requested workspace.')
    }
    return { ...result.receipt, receiptHash: input.integrity.value }
  })
  assertDistinctRuns(verified)

  const completed = verified
    .filter((receipt) => receipt.completed && receipt.failedStage === null)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
  const annotationGroups = groupAnnotations(annotations)
  const uniqueReviewed = new Set()
  const runMetrics = completed.map((receipt) => {
    const topFive = receipt.topRanked.slice(0, 5)
    let relevant = 0
    let reviewed = 0
    for (const opportunity of receipt.topRanked) {
      if (annotationGroups.has(opportunity.lineageId)) {
        uniqueReviewed.add(opportunity.lineageId)
      }
    }
    for (const opportunity of topFive) {
      const adjudication = adjudicate(annotationGroups.get(opportunity.lineageId) ?? [])
      if (adjudication.reviewed) reviewed += 1
      if (adjudication.relevant) relevant += 1
    }
    return {
      runId: receipt.runId,
      completedAt: receipt.completedAt,
      requestedK: 5,
      selected: topFive.length,
      reviewed,
      relevant,
      precisionAt5: topFive.length === 5 && reviewed === 5
        ? round(relevant / 5)
        : null,
    }
  })

  const allTopFive = runMetrics.reduce((sum, item) => sum + item.selected, 0)
  const allRelevantTopFive = runMetrics.reduce((sum, item) => sum + item.relevant, 0)
  const precisionAt5 = allTopFive > 0 && runMetrics.every(
    (item) => item.precisionAt5 !== null,
  ) ? round(allRelevantTopFive / allTopFive) : null

  const authoritative = completed.flatMap((receipt) => receipt.topRanked
    .filter((opportunity) => opportunity.candidateStatus === 'qualified_actionable')
    .map((opportunity) => ({ receipt, opportunity })))
  const criticalFalsePositives = authoritative.filter(({ opportunity }) =>
    adjudicate(annotationGroups.get(opportunity.lineageId) ?? []).criticalFalsePositive)
  const incompleteLineage = authoritative.filter(({ opportunity }) =>
    !opportunity.hasExactEvidenceLineage ||
    opportunity.cardStatus !== 'qualified_actionable')
  const missingWhyNow = authoritative.filter(({ opportunity }) =>
    !opportunity.hasWhyNow)
  const missingAgencyDna = authoritative.filter(({ opportunity }) =>
    !opportunity.hasAgencyDnaLineage)
  const rawVacancies = authoritative.filter(({ opportunity }) =>
    opportunity.rawVacancyOnly)
  const duplicateSituations = completed.flatMap((receipt) => {
    const seenSituations = new Set()
    const seenEvidenceSets = new Set()
    const duplicates = []
    for (const opportunity of receipt.topRanked) {
      if (opportunity.candidateStatus !== 'qualified_actionable') continue
      if (seenSituations.has(opportunity.situationKey) ||
          seenEvidenceSets.has(opportunity.evidenceSetKey)) {
        duplicates.push(opportunity.lineageId)
      }
      seenSituations.add(opportunity.situationKey)
      seenEvidenceSets.add(opportunity.evidenceSetKey)
    }
    return duplicates
  })

  const insufficientReasonCodes = []
  if (completed.length < MINIMUM_COMPLETED_RUNS) {
    insufficientReasonCodes.push('COMPLETED_RUNS_LT_3')
  }
  if (uniqueReviewed.size < MINIMUM_REVIEWED_TOP_RANKED) {
    insufficientReasonCodes.push('REVIEWED_TOP_RANKED_LT_50')
  }
  if (runMetrics.some((item) => item.precisionAt5 === null)) {
    insufficientReasonCodes.push('TOP_5_REVIEW_INCOMPLETE')
  }

  const failureReasonCodes = []
  if (runMetrics.some((item) =>
    item.precisionAt5 !== null && item.precisionAt5 < MINIMUM_PRECISION_AT_5)) {
    failureReasonCodes.push('PRECISION_AT_5_BELOW_0_80')
  }
  if (criticalFalsePositives.length > 0) {
    failureReasonCodes.push('CRITICAL_FALSE_POSITIVE_IN_TODAY')
  }
  if (incompleteLineage.length > 0) {
    failureReasonCodes.push('TODAY_LINEAGE_INCOMPLETE')
  }
  if (missingWhyNow.length > 0) failureReasonCodes.push('TODAY_WHY_NOW_MISSING')
  if (missingAgencyDna.length > 0) {
    failureReasonCodes.push('TODAY_AGENCY_DNA_LINEAGE_MISSING')
  }
  if (rawVacancies.length > 0) failureReasonCodes.push('RAW_VACANCY_IN_TODAY')
  if (duplicateSituations.length > 0) {
    failureReasonCodes.push('DUPLICATE_SITUATION_IN_TODAY')
  }
  if (authoritative.length === 0) {
    insufficientReasonCodes.push('AUTHORITATIVE_TODAY_SAMPLE_EMPTY')
  }

  const reasonCodes = [...new Set([
    ...insufficientReasonCodes,
    ...failureReasonCodes,
  ])]
  const status = failureReasonCodes.length > 0
    ? 'failed'
    : insufficientReasonCodes.length > 0
      ? 'insufficient_sample'
      : 'passed'

  return {
    schemaVersion: COMMERCIAL_SIGNAL_CANARY_QUALITY_SCHEMA,
    workspaceId: normalizedWorkspaceId,
    evaluatedAt: validDate(evaluatedAt).toISOString(),
    status,
    reasonCodes,
    thresholds: {
      completedRuns: MINIMUM_COMPLETED_RUNS,
      uniqueReviewedTopRanked: MINIMUM_REVIEWED_TOP_RANKED,
      precisionAt5: MINIMUM_PRECISION_AT_5,
      criticalFalsePositivesInToday: 0,
      todayLineageCoverage: 1,
      todayWhyNowCoverage: 1,
      todayAgencyDnaLineageCoverage: 1,
    },
    sample: {
      suppliedReceipts: verified.length,
      completedRuns: completed.length,
      uniqueReviewedTopRanked: uniqueReviewed.size,
      authoritativeTodayRows: authoritative.length,
    },
    runs: completed.map((receipt) => ({
      runId: receipt.runId,
      completedAt: receipt.completedAt,
      receiptHash: receipt.receiptHash,
      capturedTopRanked: receipt.topRanked.length,
    })),
    metrics: {
      precisionAt5,
      perRun: runMetrics,
      criticalFalsePositivesInToday: criticalFalsePositives.length,
      todayLineageCoverage: coverage(authoritative.length, incompleteLineage.length),
      todayWhyNowCoverage: coverage(authoritative.length, missingWhyNow.length),
      todayAgencyDnaLineageCoverage: coverage(
        authoritative.length,
        missingAgencyDna.length,
      ),
      rawVacancyTodayRows: rawVacancies.length,
      duplicateSituationTodayRows: duplicateSituations.length,
    },
    qualityGatePassed: status === 'passed',
    widerRolloutEligibleForReview: status === 'passed',
    automaticRolloutAuthorized: false,
    automaticWeightTuning: false,
    scoreMeaning: 'heuristic_rank_not_deal_probability',
  }
}

function normalizeReceipt(input) {
  const topRanked = Array.isArray(input?.topRanked)
    ? input.topRanked.map(normalizeOpportunity)
    : []
  const stages = Array.isArray(input?.stages)
    ? input.stages.map(normalizeStage)
    : []
  const receipt = {
    schemaVersion: String(input?.schemaVersion ?? ''),
    runId: boundedText(input?.runId, 160, 'run id'),
    workspaceId: positiveId(input?.workspaceId, 'workspace'),
    startedAt: validDate(input?.startedAt).toISOString(),
    completedAt: validDate(input?.completedAt).toISOString(),
    targetHost: boundedText(input?.targetHost, 253, 'target host'),
    completed: input?.completed === true,
    failedStage: input?.failedStage == null
      ? null
      : boundedText(input.failedStage, 80, 'failed stage'),
    stages,
    topRanked,
  }
  if (receipt.schemaVersion !== COMMERCIAL_SIGNAL_CANARY_RECEIPT_SCHEMA) {
    throw new TypeError('Invalid canary receipt schema version.')
  }
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    throw new TypeError('Canary receipt completedAt precedes startedAt.')
  }
  const ranks = topRanked.map((row) => row.rank)
  if (new Set(ranks).size !== ranks.length || ranks.some(
    (rank, index) => rank !== index + 1,
  )) throw new TypeError('Canary receipt ranks must be unique and contiguous.')
  if (new Set(topRanked.map((row) => row.lineageId)).size !== topRanked.length) {
    throw new TypeError('Canary receipt lineages must be unique.')
  }
  assertReceiptStageState(receipt)
  return receipt
}

function assertReceiptStageState(receipt) {
  const expected = [
    'query_plan_yield',
    'commercial_signal_canary',
    'corporate_enrichment',
    'top_review_snapshot',
  ]
  if (receipt.completed) {
    if (receipt.failedStage !== null || receipt.stages.length !== expected.length ||
        receipt.stages.some((stage, index) =>
          stage.name !== expected[index] || stage.status !== 'succeeded')) {
      throw new TypeError('Completed canary receipt has an invalid stage chain.')
    }
    return
  }
  const last = receipt.stages.at(-1)
  if (!receipt.failedStage || !last || last.name !== receipt.failedStage ||
      last.status !== 'failed' || receipt.stages.slice(0, -1).some(
        (stage, index) => stage.name !== expected[index] ||
          stage.status !== 'succeeded')) {
    throw new TypeError('Failed canary receipt has an invalid stage chain.')
  }
}

function normalizeStage(value) {
  const status = String(value?.status ?? '')
  if (!['succeeded', 'failed', 'skipped'].includes(status)) {
    throw new TypeError('Invalid canary stage status.')
  }
  return {
    name: boundedText(value?.name, 80, 'stage name'),
    status,
    summary: normalizeSummary(value?.summary),
  }
}

function normalizeSummary(value) {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid canary stage summary.')
  }
  const entries = Object.entries(value)
  if (entries.length > 40) throw new TypeError('Canary stage summary is too large.')
  return Object.fromEntries(entries.sort(([left], [right]) =>
    left.localeCompare(right)).map(([key, item]) => {
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key)) {
      throw new TypeError('Invalid canary stage summary key.')
    }
    if (typeof item === 'boolean' || item === null) return [key, item]
    if (typeof item === 'number' && Number.isFinite(item)) return [key, item]
    if (typeof item === 'string' && item.length <= 200) return [key, item]
    throw new TypeError('Invalid canary stage summary value.')
  }))
}

function normalizeOpportunity(value) {
  const status = String(value?.candidateStatus ?? '')
  if (!['qualified_actionable', 'qualified_needs_enrichment'].includes(status)) {
    throw new TypeError('Invalid canary opportunity status.')
  }
  return {
    rank: boundedInteger(value?.rank, 1, 100, 'rank'),
    lineageId: positiveId(value?.lineageId, 'lineage'),
    clientProfileId: positiveId(value?.clientProfileId, 'client profile'),
    organizationId: positiveId(value?.organizationId, 'organization'),
    signalEpisodeId: positiveId(value?.signalEpisodeId, 'signal episode'),
    situationKey: boundedText(value?.situationKey, 200, 'situation key'),
    evidenceSetKey: boundedText(value?.evidenceSetKey, 500, 'evidence set key'),
    candidateStatus: status,
    cardStatus: String(value?.cardStatus ?? ''),
    hasExactEvidenceLineage: value?.hasExactEvidenceLineage === true,
    hasWhyNow: value?.hasWhyNow === true,
    hasAgencyDnaLineage: value?.hasAgencyDnaLineage === true,
    rawVacancyOnly: value?.rawVacancyOnly === true,
  }
}

function groupAnnotations(annotations) {
  const groups = new Map()
  for (const annotation of annotations) {
    if (annotation?.reviewSet !== 'canary') continue
    const lineageId = positiveId(annotation.lineageId, 'annotation lineage')
    if (!Object.hasOwn(LABEL_RELEVANCE, annotation.label)) {
      throw new TypeError(`Invalid annotation label: ${annotation.label}.`)
    }
    const group = groups.get(lineageId) ?? []
    group.push({
      label: annotation.label,
      reasonCode: String(annotation.reasonCode ?? ''),
    })
    groups.set(lineageId, group)
  }
  return groups
}

function adjudicate(group) {
  if (group.length === 0) {
    return { reviewed: false, relevant: false, criticalFalsePositive: false }
  }
  const average = group.reduce((sum, annotation) =>
    sum + LABEL_RELEVANCE[annotation.label], 0) / group.length
  return {
    reviewed: true,
    relevant: average >= LABEL_RELEVANCE.acceptable,
    criticalFalsePositive: group.some((annotation) =>
      annotation.label === 'not_a_lead'),
  }
}

function assertDistinctRuns(receipts) {
  if (new Set(receipts.map((receipt) => receipt.runId)).size !== receipts.length) {
    throw new Error('Canary receipt run ids must be unique.')
  }
  if (new Set(receipts.map((receipt) => receipt.integrity?.value ??
    sha256(stableStringify(receipt)))).size !== receipts.length) {
    throw new Error('Duplicate canary receipts are not separate runs.')
  }
  if (new Set(receipts.map((receipt) => receipt.completedAt)).size !==
      receipts.length) {
    throw new Error('Canary receipt completion timestamps must be unique.')
  }
}

function coverage(total, failures) {
  return total === 0 ? null : round((total - failures) / total)
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > 9223372036854775807n) {
    throw new TypeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

function boundedText(value, maximum, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return normalized
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`Invalid ${label}.`)
  }
  return number
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid timestamp.')
  return date
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value))
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortValue(value[key]),
  ]))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}
