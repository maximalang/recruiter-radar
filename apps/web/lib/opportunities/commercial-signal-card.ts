export const COMMERCIAL_SIGNAL_CARD_VERSION =
  'commercial-signal-card-v1' as const

export const COMMERCIAL_SIGNAL_CARD_STATUSES = [
  'qualified_actionable',
  'qualified_needs_enrichment',
  'review',
  'blocked',
  'expired',
  'dismissed',
] as const

export type CommercialSignalCardStatus =
  (typeof COMMERCIAL_SIGNAL_CARD_STATUSES)[number]

export type CommercialSignalCardConclusion = {
  text: string
  basis: 'evidence' | 'heuristic'
  evidenceIds: string[]
}

export type CommercialSignalCardMetric = {
  value: number
  reasonCodes: string[]
}

export type CommercialSignalCard = {
  version: typeof COMMERCIAL_SIGNAL_CARD_VERSION
  scoreVersion: 'opportunity-v3'
  status: CommercialSignalCardStatus
  whatChanged: CommercialSignalCardConclusion
  whyNotOrdinaryHiring: CommercialSignalCardConclusion
  whyAgency: CommercialSignalCardConclusion
  whyThisAgency: CommercialSignalCardConclusion
  whyNow: CommercialSignalCardConclusion
  metrics: {
    externalAgencyPropensity: CommercialSignalCardMetric
    agencyFit: CommercialSignalCardMetric
    opportunityQuality: CommercialSignalCardMetric
    actionability: CommercialSignalCardMetric
  }
  recommendedAction: CommercialSignalCardConclusion
  constraints: CommercialSignalCardConclusion[]
}

const TOP_LEVEL_KEYS = [
  'version',
  'scoreVersion',
  'status',
  'whatChanged',
  'whyNotOrdinaryHiring',
  'whyAgency',
  'whyThisAgency',
  'whyNow',
  'metrics',
  'recommendedAction',
  'constraints',
] as const

const METRIC_KEYS = [
  'externalAgencyPropensity',
  'agencyFit',
  'opportunityQuality',
  'actionability',
] as const

export function parseCommercialSignalCard(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string>,
): CommercialSignalCard | null {
  if (!hasExactKeys(value, TOP_LEVEL_KEYS)) return null
  if (value.version !== COMMERCIAL_SIGNAL_CARD_VERSION) return null
  if (value.scoreVersion !== 'opportunity-v3') return null
  if (!COMMERCIAL_SIGNAL_CARD_STATUSES.includes(
    value.status as CommercialSignalCardStatus,
  )) return null

  const whatChanged = conclusion(value.whatChanged, allowedEvidenceIds)
  const whyNotOrdinaryHiring = conclusion(
    value.whyNotOrdinaryHiring,
    allowedEvidenceIds,
  )
  const whyAgency = conclusion(value.whyAgency, allowedEvidenceIds)
  const whyThisAgency = conclusion(value.whyThisAgency, allowedEvidenceIds)
  const whyNow = conclusion(value.whyNow, allowedEvidenceIds)
  const recommendedAction = conclusion(
    value.recommendedAction,
    allowedEvidenceIds,
  )
  if (
    !whatChanged || !whyNotOrdinaryHiring || !whyAgency ||
    !whyThisAgency || !whyNow || !recommendedAction
  ) return null

  if (!hasExactKeys(value.metrics, METRIC_KEYS)) return null
  const externalAgencyPropensity = metric(
    value.metrics.externalAgencyPropensity,
  )
  const agencyFit = metric(value.metrics.agencyFit)
  const opportunityQuality = metric(value.metrics.opportunityQuality)
  const actionability = metric(value.metrics.actionability)
  if (
    !externalAgencyPropensity || !agencyFit ||
    !opportunityQuality || !actionability
  ) return null

  if (!Array.isArray(value.constraints) || value.constraints.length < 1 ||
      value.constraints.length > 8) return null
  const constraints = value.constraints.map((item) => (
    conclusion(item, allowedEvidenceIds)
  ))
  if (constraints.some((item) => item === null)) return null

  return {
    version: COMMERCIAL_SIGNAL_CARD_VERSION,
    scoreVersion: 'opportunity-v3',
    status: value.status as CommercialSignalCardStatus,
    whatChanged,
    whyNotOrdinaryHiring,
    whyAgency,
    whyThisAgency,
    whyNow,
    metrics: {
      externalAgencyPropensity,
      agencyFit,
      opportunityQuality,
      actionability,
    },
    recommendedAction,
    constraints: constraints as CommercialSignalCardConclusion[],
  }
}

function conclusion(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string>,
): CommercialSignalCardConclusion | null {
  if (!hasExactKeys(value, ['text', 'basis', 'evidenceIds'])) return null
  const text = boundedText(value.text, 600)
  if (!text || (value.basis !== 'evidence' && value.basis !== 'heuristic')) {
    return null
  }
  if (!Array.isArray(value.evidenceIds) || value.evidenceIds.length > 32) {
    return null
  }
  const evidenceIds = value.evidenceIds.map((id) => String(id).trim())
  if (new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some(
    (id) => !/^[1-9]\d*$/.test(id) || !allowedEvidenceIds.has(id),
  )) return null
  if (value.basis === 'evidence' && evidenceIds.length === 0) return null
  if (value.basis === 'heuristic' && evidenceIds.length !== 0) return null
  return { text, basis: value.basis, evidenceIds }
}

function metric(value: unknown): CommercialSignalCardMetric | null {
  if (!hasExactKeys(value, ['value', 'reasonCodes'])) return null
  if (typeof value.value !== 'number' || !Number.isFinite(value.value) ||
      value.value < 0 || value.value > 1) return null
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length < 1 ||
      value.reasonCodes.length > 12) return null
  const reasonCodes = value.reasonCodes.map((code) => String(code).trim())
  if (new Set(reasonCodes).size !== reasonCodes.length || reasonCodes.some(
    (code) => !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(code),
  )) return null
  return { value: value.value, reasonCodes }
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maximumLength ? normalized : null
}
