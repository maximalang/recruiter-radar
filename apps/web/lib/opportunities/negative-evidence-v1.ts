export const NEGATIVE_EVIDENCE_VERSION = 'negative-evidence-v1' as const

export const NEGATIVE_EVIDENCE_TYPES = [
  'hiring_freeze',
  'hiring_slowdown',
  'vacancy_removed_without_replacement',
  'explicit_no_agencies',
  'large_internal_ta_capacity',
  'procurement_barrier',
  'budget_pause',
  'ordinary_baseline',
  'evergreen_role',
  'resolved_hiring_need',
  'company_contraction',
] as const

export type NegativeEvidenceType = typeof NEGATIVE_EVIDENCE_TYPES[number]
export type NegativeEvidenceClassification =
  | 'confirmed_negative'
  | 'heuristic_negative'
  | 'unknown'
export type NegativeEvidenceSourceKind =
  | 'direct'
  | 'official'
  | 'heuristic'
  | 'llm'
export type NegativeEvidenceAction =
  | 'none'
  | 'reduce'
  | 'review'
  | 'block'
  | 'close'

export type NegativeEvidenceInput = {
  type: NegativeEvidenceType
  classification: NegativeEvidenceClassification
  sourceKind: NegativeEvidenceSourceKind
  severity: number
  eventIds: string[]
  evidenceIds: string[]
  observedAt: string
  validUntil: string
}

export type NegativeEvidenceReason = {
  code: string
  type: NegativeEvidenceType
  severity: number
  eventIds: string[]
  evidenceIds: string[]
}

export type NegativeEvidenceResult = {
  featureVersion: typeof NEGATIVE_EVIDENCE_VERSION
  action: NegativeEvidenceAction
  scoreMultiplier: number
  confirmedReasons: NegativeEvidenceReason[]
  heuristicReasons: NegativeEvidenceReason[]
  unknownReasons: NegativeEvidenceReason[]
  evidenceIds: string[]
  expiredEvidenceIds: string[]
}

export type NegativeEvidenceApplication = {
  qualityScore: number
  status:
    | 'qualified_actionable'
    | 'qualified_needs_enrichment'
    | 'review'
    | 'blocked'
    | 'expired'
    | 'dismissed'
  reasonCodes: string[]
}

const ACTION_PRIORITY: Record<NegativeEvidenceAction, number> = {
  none: 0,
  reduce: 1,
  review: 2,
  close: 3,
  block: 4,
}

export function evaluateNegativeEvidence(
  rawInput: readonly NegativeEvidenceInput[],
  now: Date,
): NegativeEvidenceResult {
  const evaluatedAt = validDate(now)
  const input = rawInput.map(normalizeInput)
  const active = input.filter((item) =>
    new Date(item.validUntil).getTime() >= evaluatedAt.getTime(),
  )
  const expired = input.filter((item) =>
    new Date(item.validUntil).getTime() < evaluatedAt.getTime(),
  )
  const confirmedReasons: NegativeEvidenceReason[] = []
  const heuristicReasons: NegativeEvidenceReason[] = []
  const unknownReasons: NegativeEvidenceReason[] = []
  let action: NegativeEvidenceAction = 'none'
  let scoreMultiplier = 1

  for (const item of active) {
    const reason = buildReason(item)
    if (item.classification === 'unknown') {
      unknownReasons.push(reason)
      continue
    }
    if (item.classification === 'heuristic_negative') {
      heuristicReasons.push(reason)
      const heuristicAction: NegativeEvidenceAction = item.severity >= 0.65
        ? 'review'
        : 'reduce'
      action = strongerAction(action, heuristicAction)
      scoreMultiplier *= 1 - (0.4 * item.severity)
      continue
    }

    confirmedReasons.push(reason)
    const policy = confirmedPolicy(item)
    action = strongerAction(action, policy.action)
    scoreMultiplier *= policy.multiplier
  }

  return {
    featureVersion: NEGATIVE_EVIDENCE_VERSION,
    action,
    scoreMultiplier: round(clamp01(scoreMultiplier)),
    confirmedReasons: sortReasons(confirmedReasons),
    heuristicReasons: sortReasons(heuristicReasons),
    unknownReasons: sortReasons(unknownReasons),
    evidenceIds: ids(active.flatMap((item) => item.evidenceIds)),
    expiredEvidenceIds: ids(expired.flatMap((item) => item.evidenceIds)),
  }
}

export function applyNegativeEvidence(input: {
  qualityScore: number
  status: NegativeEvidenceApplication['status']
  negativeEvidence: NegativeEvidenceResult
}): NegativeEvidenceApplication {
  const qualityScore = round(
    unitInterval(input.qualityScore, 'quality score') *
    input.negativeEvidence.scoreMultiplier,
  )
  const reasonCodes = [
    ...input.negativeEvidence.confirmedReasons,
    ...input.negativeEvidence.heuristicReasons,
  ].map((reason) => reason.code)
  let status = input.status

  if (input.negativeEvidence.action === 'block') status = 'blocked'
  else if (input.negativeEvidence.action === 'close') status = 'expired'
  else if (input.negativeEvidence.action === 'review') status = 'review'
  else if (
    input.negativeEvidence.action === 'reduce' &&
    qualityScore < 0.7 &&
    (status === 'qualified_actionable' || status === 'qualified_needs_enrichment')
  ) status = 'review'

  return {
    qualityScore,
    status,
    reasonCodes: uniqueText(reasonCodes),
  }
}

function normalizeInput(input: NegativeEvidenceInput): NegativeEvidenceInput {
  if (
    input.sourceKind === 'llm' &&
    input.classification !== 'unknown'
  ) {
    throw new Error('LLM output cannot create negative evidence')
  }
  if (
    input.classification === 'confirmed_negative' &&
    input.sourceKind !== 'direct' &&
    input.sourceKind !== 'official'
  ) {
    throw new Error('confirmed negative requires direct or official evidence')
  }
  if (
    input.classification === 'heuristic_negative' &&
    input.sourceKind !== 'heuristic' &&
    input.sourceKind !== 'direct' &&
    input.sourceKind !== 'official'
  ) {
    throw new Error('heuristic negative source is invalid')
  }

  const observedAt = timestamp(input.observedAt, 'observed at')
  const validUntil = timestamp(input.validUntil, 'valid until')
  if (new Date(validUntil).getTime() < new Date(observedAt).getTime()) {
    throw new Error('negative evidence validity precedes observation')
  }
  const requiresEvidence = input.classification !== 'unknown'
  const evidenceIds = ids(input.evidenceIds)
  const eventIds = ids(input.eventIds, 'event id')
  if (requiresEvidence && evidenceIds.length === 0) {
    throw new Error('negative evidence ids are required')
  }
  if (requiresEvidence && eventIds.length === 0) {
    throw new Error('negative evidence event ids are required')
  }

  return {
    ...input,
    severity: unitInterval(input.severity, 'negative severity'),
    eventIds,
    evidenceIds,
    observedAt,
    validUntil,
  }
}

function confirmedPolicy(input: NegativeEvidenceInput): {
  action: NegativeEvidenceAction
  multiplier: number
} {
  switch (input.type) {
    case 'hiring_freeze':
    case 'resolved_hiring_need':
      return { action: 'close', multiplier: 0 }
    case 'explicit_no_agencies':
      return { action: 'block', multiplier: 0 }
    case 'procurement_barrier':
      return input.severity >= 0.8
        ? { action: 'block', multiplier: 0 }
        : { action: 'review', multiplier: 1 - (0.7 * input.severity) }
    case 'budget_pause':
    case 'company_contraction':
    case 'vacancy_removed_without_replacement':
      return input.severity >= 0.8
        ? { action: 'close', multiplier: 0 }
        : { action: 'review', multiplier: 1 - (0.7 * input.severity) }
    case 'hiring_slowdown':
      return input.severity >= 0.65
        ? { action: 'review', multiplier: 1 - (0.65 * input.severity) }
        : { action: 'reduce', multiplier: 1 - (0.5 * input.severity) }
    case 'large_internal_ta_capacity':
      return { action: 'reduce', multiplier: 1 - (0.75 * input.severity) }
    case 'ordinary_baseline':
    case 'evergreen_role':
      return { action: 'reduce', multiplier: 1 - (0.6 * input.severity) }
  }
}

function buildReason(input: NegativeEvidenceInput): NegativeEvidenceReason {
  return {
    code: `${input.type.toUpperCase()}_${classificationSuffix(input.classification)}`,
    type: input.type,
    severity: input.severity,
    eventIds: [...input.eventIds],
    evidenceIds: [...input.evidenceIds],
  }
}

function classificationSuffix(
  classification: NegativeEvidenceClassification,
): string {
  if (classification === 'confirmed_negative') return 'CONFIRMED'
  if (classification === 'heuristic_negative') return 'HEURISTIC'
  return 'UNKNOWN'
}

function strongerAction(
  left: NegativeEvidenceAction,
  right: NegativeEvidenceAction,
): NegativeEvidenceAction {
  return ACTION_PRIORITY[right] > ACTION_PRIORITY[left] ? right : left
}

function sortReasons(
  input: readonly NegativeEvidenceReason[],
): NegativeEvidenceReason[] {
  return [...input].sort((left, right) =>
    left.code.localeCompare(right.code, 'en') ||
    compareIds(left.evidenceIds[0] ?? '0', right.evidenceIds[0] ?? '0'),
  )
}

function ids(values: readonly string[], label = 'evidence id'): string[] {
  return [...new Set(values.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
    return value
  }))].sort(compareIds)
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error('evaluation date is invalid')
  return value
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}
