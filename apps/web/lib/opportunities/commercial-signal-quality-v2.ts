import { createHash } from 'node:crypto'

export const COMMERCIAL_SIGNAL_QUALITY_VERSION =
  'commercial-signal-quality-v2' as const

export const EVIDENCE_INDEPENDENCE_REASON_CODES = [
  'EVIDENCE_INDEPENDENT',
  'EVIDENCE_CORRELATED',
  'EVIDENCE_REPUBLICATION',
  'EVIDENCE_SAME_UPSTREAM',
  'EVIDENCE_ORIGIN_UNKNOWN',
] as const

export type EvidenceIndependenceReasonCode =
  typeof EVIDENCE_INDEPENDENCE_REASON_CODES[number]

export type CommercialSignalEvidenceProvenance = {
  evidenceId: string
  sourceKind: 'direct' | 'official' | 'approved_context' | 'derived_deterministic'
  sourceFamily: string
  sourceDomain: string
  upstreamOrigin: string | null
  canonicalUrl: string | null
  vacancyFingerprint: string | null
  publicationFingerprint: string | null
  organizationDomain: string | null
  contentFingerprint: string | null
  observedAt: string
}

export type EvidenceIndependenceGroup = {
  evidenceIndependenceGroup: string
  evidenceIds: string[]
  sourceFamilies: string[]
  sourceDomains: string[]
  reasonCodes: EvidenceIndependenceReasonCode[]
}

export type EvidenceIndependenceResult = {
  groups: EvidenceIndependenceGroup[]
  independentGroupCount: number
  coverage: number
  confidence: number
  reasonCodes: EvidenceIndependenceReasonCode[]
  excludedFutureEvidenceIds: string[]
}

export type OpportunityQualityComponent = {
  value: number | null
  confidence: number
  coverage: number
  reasonCodes: string[]
  evidenceIds: string[]
}

export type OpportunityQualityInput = {
  components: Array<{
    key: string
    critical: boolean
    weight: number
    component: OpportunityQualityComponent
  }>
  minimumCriticalCoverage: number
  minimumQualityCoverage: number
  minimumQualityScore?: number
}

export type OpportunityQualityResult = {
  qualityScore: number
  qualityCoverage: number
  qualityConfidence: number
  criticalCoverage: number
  actionable: boolean
  reasonCodes: string[]
  evidenceIds: string[]
}

type NormalizedEvidence = CommercialSignalEvidenceProvenance & {
  correlationTokens: string[]
  originKnown: boolean
}

export function unknownQualityComponent(
  reasonCode: string,
): OpportunityQualityComponent {
  return {
    value: null,
    confidence: 0,
    coverage: 0,
    reasonCodes: [requiredText(reasonCode, 'reason code')],
    evidenceIds: [],
  }
}

export function buildEvidenceIndependence(
  input: readonly CommercialSignalEvidenceProvenance[],
  asOf: Date,
): EvidenceIndependenceResult {
  const decisionAt = validDate(asOf, 'evidence decision clock')
  const normalized = input.map(normalizeEvidence)
    .sort((left, right) => compareBigintText(left.evidenceId, right.evidenceId))
  const evidence = normalized.filter((item) =>
    Date.parse(item.observedAt) <= decisionAt.getTime())
  const future = normalized.filter((item) =>
    Date.parse(item.observedAt) > decisionAt.getTime())
  const parents = evidence.map((_, index) => index)

  for (let left = 0; left < evidence.length; left += 1) {
    for (let right = left + 1; right < evidence.length; right += 1) {
      if (hasSharedToken(evidence[left]!, evidence[right]!)) {
        union(parents, left, right)
      }
    }
  }

  const grouped = new Map<number, NormalizedEvidence[]>()
  evidence.forEach((item, index) => {
    const root = find(parents, index)
    grouped.set(root, [...(grouped.get(root) ?? []), item])
  })

  const groups = [...grouped.values()].map(buildGroup)
    .sort((left, right) =>
      left.evidenceIndependenceGroup.localeCompare(
        right.evidenceIndependenceGroup,
        'en',
      ),
    )
  const knownCount = evidence.filter((item) => item.originKnown).length
  const knownGroups = groups.filter((group) =>
    !group.reasonCodes.includes('EVIDENCE_ORIGIN_UNKNOWN'))
  const coverage = ratio(knownCount, evidence.length)
  const confidence = round(coverage * Math.min(1, knownGroups.length / 2))
  const reasonCodes = uniqueSorted(groups.flatMap((group) => group.reasonCodes))

  if (knownGroups.length >= 2) reasonCodes.push('EVIDENCE_INDEPENDENT')

  return {
    groups,
    independentGroupCount: knownGroups.length,
    coverage,
    confidence,
    reasonCodes: uniqueSorted(reasonCodes),
    excludedFutureEvidenceIds: uniqueBigintIds(future.map((item) => item.evidenceId)),
  }
}

export function buildOpportunityQuality(
  input: OpportunityQualityInput,
): OpportunityQualityResult {
  const components = input.components.map((item) => ({
    key: requiredText(item.key, 'component key'),
    critical: item.critical,
    weight: positiveNumber(item.weight, 'component weight'),
    component: normalizeComponent(item.component),
  }))
  if (components.length === 0) throw new Error('quality components are required')

  const minimumCriticalCoverage = unitInterval(
    input.minimumCriticalCoverage,
    'minimum critical coverage',
  )
  const minimumQualityCoverage = unitInterval(
    input.minimumQualityCoverage,
    'minimum quality coverage',
  )
  const minimumQualityScore = unitInterval(
    input.minimumQualityScore ?? 0.7,
    'minimum quality score',
  )
  const totalWeight = sum(components.map((item) => item.weight))
  const coveredWeight = sum(components.map((item) =>
    item.weight * effectiveCoverage(item.component),
  ))
  const qualityCoverage = round(coveredWeight / totalWeight)
  const qualityConfidence = round(sum(components.map((item) =>
    item.weight * item.component.confidence,
  )) / totalWeight)
  const critical = components.filter((item) => item.critical)
  const criticalWeight = sum(critical.map((item) => item.weight))
  const criticalCoverage = criticalWeight === 0
    ? 1
    : round(sum(critical.map((item) =>
      item.weight * effectiveCoverage(item.component),
    )) / criticalWeight)
  const knownValues = components
    .filter((item) => item.component.value !== null)
    .map((item) => ({
      value: item.component.value as number,
      weight: item.weight,
    }))
  const rawScore = weightedGeometricMean(knownValues)
  const coveragePassed =
    criticalCoverage >= minimumCriticalCoverage &&
    qualityCoverage >= minimumQualityCoverage
  const qualityScore = coveragePassed ? rawScore : 0
  const reasonCodes = uniqueSorted(components.flatMap(
    (item) => item.component.reasonCodes,
  ))

  if (criticalCoverage < minimumCriticalCoverage) {
    reasonCodes.push('QUALITY_CRITICAL_COVERAGE_LOW')
  }
  if (qualityCoverage < minimumQualityCoverage) {
    reasonCodes.push('QUALITY_COVERAGE_LOW')
  }
  if (components.some((item) =>
    !item.critical && item.component.value === null,
  )) {
    reasonCodes.push('QUALITY_NONCRITICAL_DATA_MISSING')
  }

  return {
    qualityScore,
    qualityCoverage,
    qualityConfidence,
    criticalCoverage,
    actionable: coveragePassed && qualityScore >= minimumQualityScore,
    reasonCodes: uniqueSorted(reasonCodes),
    evidenceIds: uniqueBigintIds(components.flatMap(
      (item) => item.component.evidenceIds,
    )),
  }
}

function normalizeEvidence(
  input: CommercialSignalEvidenceProvenance,
): NormalizedEvidence {
  const evidenceId = positiveBigintText(input.evidenceId, 'evidence id')
  const sourceKind = enumValue(input.sourceKind, [
    'direct', 'official', 'approved_context', 'derived_deterministic',
  ], 'evidence source kind')
  const sourceFamily = requiredText(input.sourceFamily, 'source family')
  const sourceDomain = requiredText(input.sourceDomain, 'source domain')
  const upstreamOrigin = optionalText(input.upstreamOrigin)
  const canonicalUrl = optionalText(input.canonicalUrl)
  const vacancyFingerprint = optionalText(input.vacancyFingerprint)
  const publicationFingerprint = optionalText(input.publicationFingerprint)
  const organizationDomain = optionalText(input.organizationDomain)
  const contentFingerprint = optionalText(input.contentFingerprint)
  const observedAt = validTimestamp(input.observedAt, 'observed at')
  const correlationTokens = uniqueSorted([
    token('upstream', upstreamOrigin),
    token('vacancy', vacancyFingerprint),
    token('publication', publicationFingerprint),
    token('content', contentFingerprint),
    token('canonical', canonicalUrl),
  ].filter((value): value is string => value !== null))
  const originKnown = correlationTokens.length > 0

  if (!originKnown) {
    correlationTokens.push(
      `unknown:${organizationDomain ?? 'unknown'}:${sourceFamily}`,
    )
  }

  return {
    evidenceId,
    sourceKind,
    sourceFamily,
    sourceDomain,
    upstreamOrigin,
    canonicalUrl,
    vacancyFingerprint,
    publicationFingerprint,
    organizationDomain,
    contentFingerprint,
    observedAt,
    correlationTokens,
    originKnown,
  }
}

function buildGroup(items: readonly NormalizedEvidence[]): EvidenceIndependenceGroup {
  const evidenceIds = uniqueBigintIds(items.map((item) => item.evidenceId))
  const sourceFamilies = uniqueSorted(items.map((item) => item.sourceFamily))
  const sourceDomains = uniqueSorted(items.map((item) => item.sourceDomain))
  const reasonCodes: EvidenceIndependenceReasonCode[] = []
  const sharedTokens = commonTokens(items)

  if (items.some((item) => !item.originKnown)) {
    reasonCodes.push('EVIDENCE_ORIGIN_UNKNOWN')
  }
  if (items.length === 1 && items[0]?.originKnown) {
    reasonCodes.push('EVIDENCE_INDEPENDENT')
  }
  if (items.length > 1) {
    if (sharedTokens.some((value) => value.startsWith('upstream:'))) {
      reasonCodes.push('EVIDENCE_SAME_UPSTREAM')
    }
    if (
      sourceDomains.length > 1 &&
      sharedTokens.some((value) =>
        value.startsWith('vacancy:') || value.startsWith('content:'),
      )
    ) {
      reasonCodes.push('EVIDENCE_REPUBLICATION')
    }
    if (reasonCodes.length === 0) reasonCodes.push('EVIDENCE_CORRELATED')
  }

  return {
    evidenceIndependenceGroup: sha256(items.flatMap(
      (item) => item.correlationTokens,
    ).sort()),
    evidenceIds,
    sourceFamilies,
    sourceDomains,
    reasonCodes: uniqueSorted(reasonCodes),
  }
}

function normalizeComponent(
  input: OpportunityQualityComponent,
): OpportunityQualityComponent {
  const value = input.value === null ? null : unitInterval(input.value, 'component value')
  const confidence = unitInterval(input.confidence, 'component confidence')
  const evidenceIds = uniqueBigintIds(input.evidenceIds)
  if (value === null && confidence !== 0) {
    throw new Error('unknown component requires zero confidence')
  }
  if (value !== null && evidenceIds.length === 0) {
    throw new Error('known component requires evidence')
  }
  return {
    value,
    confidence,
    coverage: unitInterval(input.coverage, 'component coverage'),
    reasonCodes: uniqueSorted(input.reasonCodes.map((value) =>
      requiredText(value, 'reason code'),
    )),
    evidenceIds,
  }
}

function effectiveCoverage(component: OpportunityQualityComponent): number {
  return component.value === null ? 0 : component.coverage
}

function commonTokens(items: readonly NormalizedEvidence[]): string[] {
  if (items.length === 0) return []
  return items[0]!.correlationTokens.filter((tokenValue) =>
    items.every((item) => item.correlationTokens.includes(tokenValue)),
  )
}

function hasSharedToken(left: NormalizedEvidence, right: NormalizedEvidence): boolean {
  return left.correlationTokens.some((value) =>
    right.correlationTokens.includes(value),
  )
}

function find(parents: number[], index: number): number {
  if (parents[index] !== index) parents[index] = find(parents, parents[index]!)
  return parents[index]!
}

function union(parents: number[], left: number, right: number): void {
  const leftRoot = find(parents, left)
  const rightRoot = find(parents, right)
  if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
}

function weightedGeometricMean(
  values: readonly { value: number; weight: number }[],
): number {
  if (values.length === 0) return 0
  const weight = sum(values.map((item) => item.weight))
  if (values.some((item) => item.value <= 0)) return 0
  return round(Math.exp(sum(values.map((item) =>
    Math.log(item.value) * item.weight,
  )) / weight))
}

function token(prefix: string, value: string | null): string | null {
  return value === null ? null : `${prefix}:${value.toLowerCase()}`
}

function validTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a timestamp`)
  return parsed.toISOString()
}

function validDate(value: Date, label: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`)
  return value
}

function positiveBigintText(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive id`)
  return value
}

function uniqueBigintIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => positiveBigintText(value, 'evidence id')))]
    .sort(compareBigintText)
}

function compareBigintText(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function optionalText(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
  return value
}

function enumValue<T extends string>(
  value: T,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value)) throw new Error(`${label} is invalid`)
  return value
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator)
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}

function sha256(values: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}
