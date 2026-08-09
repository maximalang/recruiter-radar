import type {
  EconomicsFitResult,
  MarketDifficultyResult,
} from './commercial-fit-v2'
import {
  buildEvidenceIndependence,
  buildOpportunityQuality,
  COMMERCIAL_SIGNAL_QUALITY_VERSION,
  type CommercialSignalEvidenceProvenance,
  type EvidenceIndependenceResult,
  type OpportunityQualityComponent,
  type OpportunityQualityResult,
} from './commercial-signal-quality-v2'
import type {
  ExternalAgencyPropensityResult,
} from './external-agency-propensity-v2'
import type { HiringFrictionResult } from './hiring-friction-v1'
import {
  applyNegativeEvidence,
  type NegativeEvidenceResult,
} from './negative-evidence-v1'
import type { SignalConvergenceResult } from './signal-convergence-v1'

export const COMMERCIAL_SIGNAL_QUALITY_ENGINE_VERSION =
  'commercial-signal-quality-engine-v2' as const

export type CommercialSignalQualityStatus =
  | 'qualified_actionable'
  | 'qualified_needs_enrichment'
  | 'review'
  | 'blocked'
  | 'expired'
  | 'dismissed'

export type CommercialSignalAffirmativeEvidence = Record<
  'hiring_need' | 'hiring_friction' | 'agency_fit' |
  'external_agency_propensity' | 'signal_convergence' |
  'economics_fit' | 'market_difficulty',
  string[]
>

export type CommercialSignalQualityEngineV2Input = {
  decisionAt: string
  decisionSource: 'deterministic' | 'llm'
  componentSources: {
    hiringNeed: 'direct' | 'official' | 'derived_deterministic'
    hiringFriction: 'derived_deterministic'
    agencyFit: 'direct' | 'official' | 'derived_deterministic'
    propensity: 'derived_deterministic'
    convergence: 'derived_deterministic'
    economics: 'derived_deterministic'
    marketDifficulty: 'official' | 'derived_deterministic'
  }
  currentHiringEvidence: {
    present: boolean
    evidenceIds: string[]
  }
  hiringNeed: OpportunityQualityComponent
  hiringFriction: HiringFrictionResult
  agencyFit: OpportunityQualityComponent
  propensity: ExternalAgencyPropensityResult
  convergence: SignalConvergenceResult
  economics: EconomicsFitResult
  marketDifficulty: MarketDifficultyResult
  negativeEvidence: NegativeEvidenceResult
  contact: {
    corporateContactPathAvailable: boolean
    doNotContact: boolean
    conflict: boolean
    evidenceIds: string[]
  }
  evidence: CommercialSignalEvidenceProvenance[]
}

export type CommercialSignalQualityEngineV2Result = {
  engineVersion: typeof COMMERCIAL_SIGNAL_QUALITY_ENGINE_VERSION
  decisionAt: string
  componentSources: CommercialSignalQualityEngineV2Input['componentSources']
  affirmativeEvidenceByComponent: CommercialSignalAffirmativeEvidence
  featureVersions: {
    quality: typeof COMMERCIAL_SIGNAL_QUALITY_VERSION
    friction: HiringFrictionResult['featureVersion']
    propensity: ExternalAgencyPropensityResult['featureVersion']
    convergence: SignalConvergenceResult['featureVersion']
    economics: EconomicsFitResult['featureVersion']
    negativeEvidence: NegativeEvidenceResult['featureVersion']
  }
  quality: OpportunityQualityResult
  status: CommercialSignalQualityStatus
  actionability: 'actionable' | 'needs_enrichment' | 'review' | 'blocked'
  reasonCodes: string[]
  evidenceIds: string[]
  independence: EvidenceIndependenceResult
  actionabilityIndependence: EvidenceIndependenceResult
  decisionEvidence: {
    currentHiringEvidence: boolean
    currentHiringEvidenceIds: string[]
    positiveEvidenceIds: string[]
    negativeEvidenceIds: string[]
    contactEvidenceIds: string[]
  }
  components: Record<string, OpportunityQualityComponent>
  modelType: 'heuristic'
  calibrationStatus: 'uncalibrated'
}

const QUALITY_COMPONENTS = {
  hiring_need: { critical: true, weight: 1.3 },
  hiring_friction: { critical: true, weight: 1 },
  agency_fit: { critical: true, weight: 1.2 },
  external_agency_propensity: { critical: true, weight: 1.2 },
  signal_convergence: { critical: true, weight: 0.8 },
  economics_fit: { critical: false, weight: 0.5 },
  market_difficulty: { critical: false, weight: 0.3 },
} as const

export function buildCommercialSignalQualityEngineV2(
  input: CommercialSignalQualityEngineV2Input,
): CommercialSignalQualityEngineV2Result {
  if (input.decisionSource === 'llm') {
    throw new Error('LLM cannot determine score, archetype, or eligibility')
  }
  for (const source of Object.values(input.componentSources)) {
    if (!['direct', 'official', 'derived_deterministic'].includes(source)) {
      throw new Error('quality components require a non-LLM evidence source')
    }
  }
  const decisionAt = new Date(input.decisionAt)
  if (!Number.isFinite(decisionAt.getTime())) {
    throw new Error('quality decision clock is invalid')
  }
  const provenanceIds = new Set(input.evidence.map((item) => item.evidenceId))
  const components = buildComponents(input)
  const affirmativeEvidenceByComponent = buildAffirmativeEvidence(input, components)
  const currentHiringEvidenceIds = ids(input.currentHiringEvidence.evidenceIds)
  if (input.currentHiringEvidence.present !== (currentHiringEvidenceIds.length > 0)) {
    throw new Error('current hiring evidence requires exact evidence lineage')
  }
  const contactEvidenceIds = ids(input.contact.evidenceIds)
  const positiveEvidenceIds = ids([
    ...Object.values(affirmativeEvidenceByComponent).flat(),
    ...currentHiringEvidenceIds,
  ])
  const explicitNegativeEvidenceIds = ids(input.negativeEvidence.evidenceIds)
  if (explicitNegativeEvidenceIds.some((id) =>
    positiveEvidenceIds.includes(id) || contactEvidenceIds.includes(id))) {
    throw new Error('explicit negative decision evidence roles must be disjoint')
  }
  const negativeEvidenceIds = ids([
    ...explicitNegativeEvidenceIds,
    ...Object.values(components).flatMap((item) => item.evidenceIds)
      .filter((id) =>
        !positiveEvidenceIds.includes(id) && !contactEvidenceIds.includes(id)),
  ])
  for (const [leftName, leftIds, rightName, rightIds] of [
    ['positive', positiveEvidenceIds, 'negative', negativeEvidenceIds],
    ['positive', positiveEvidenceIds, 'contact', contactEvidenceIds],
    ['negative', negativeEvidenceIds, 'contact', contactEvidenceIds],
  ] as const) {
    if (leftIds.some((id) => rightIds.includes(id))) {
      throw new Error(`${leftName} and ${rightName} decision evidence roles must be disjoint`)
    }
  }
  const usedEvidenceIds = ids([
    ...Object.values(components).flatMap((item) => item.evidenceIds),
    ...currentHiringEvidenceIds,
    ...negativeEvidenceIds,
    ...contactEvidenceIds,
  ])
  if (new Set(input.evidence.map((item) => item.evidenceId)).size !==
    input.evidence.length) {
    throw new Error('exact evidence lineage contains duplicate evidence ids')
  }

  const providedEvidenceIds = ids([...provenanceIds])
  if (!sameIds(providedEvidenceIds, usedEvidenceIds)) {
    throw new Error('exact evidence lineage must equal the decision evidence set')
  }
  const independence = buildEvidenceIndependence(input.evidence, decisionAt)
  const groupedEvidenceIds = ids(independence.groups.flatMap((group) => group.evidenceIds))
  if (
    independence.excludedFutureEvidenceIds.length > 0 ||
    !sameIds(groupedEvidenceIds, usedEvidenceIds)
  ) {
    throw new Error('future evidence cannot enter the decision evidence set')
  }
  validateComponentSources(input, components)
  const positiveEvidence = input.evidence.filter((item) =>
    positiveEvidenceIds.includes(item.evidenceId))
  const actionabilityIndependence = buildEvidenceIndependence(
    positiveEvidence,
    decisionAt,
  )
  const currentHiringSources = input.evidence.filter((item) =>
    currentHiringEvidenceIds.includes(item.evidenceId))
  if (currentHiringSources.some((item) =>
    item.sourceKind !== 'direct' && item.sourceKind !== 'official')) {
    throw new Error('current hiring evidence requires direct or official provenance')
  }
  const baseQuality = buildOpportunityQuality({
    components: Object.entries(components).map(([key, component]) => ({
      key,
      ...QUALITY_COMPONENTS[key as keyof typeof QUALITY_COMPONENTS],
      component,
    })),
    minimumCriticalCoverage: 0.8,
    minimumQualityCoverage: 0.7,
    minimumQualityScore: 0.68,
  })
  const independencePassed = actionabilityIndependence.independentGroupCount >= 2
  const baseActionable = baseQuality.actionable && independencePassed
  const baseStatus: CommercialSignalQualityStatus = baseActionable
    ? input.contact.corporateContactPathAvailable
      ? 'qualified_actionable'
      : 'qualified_needs_enrichment'
    : 'review'
  const negative = applyNegativeEvidence({
    qualityScore: baseQuality.qualityScore,
    status: baseStatus,
    negativeEvidence: input.negativeEvidence,
  })
  const policyBlocked = input.contact.doNotContact || input.contact.conflict ||
    input.propensity.actionability === 'blocked'
  const currentHiringMissing = !input.currentHiringEvidence.present
  const status: CommercialSignalQualityStatus = policyBlocked
    ? 'blocked'
    : currentHiringMissing
      ? 'review'
      : negative.status
  const actionable = baseActionable && !currentHiringMissing &&
    negative.qualityScore >= 0.68 &&
    status !== 'blocked' && status !== 'expired' && status !== 'dismissed' &&
    status !== 'review'
  const quality: OpportunityQualityResult = {
    ...baseQuality,
    qualityScore: negative.qualityScore,
    actionable,
  }
  const reasonCodes = [
    ...baseQuality.reasonCodes,
    ...negative.reasonCodes,
    ...input.propensity.reasonCodes,
  ]
  if (!input.contact.corporateContactPathAvailable) {
    reasonCodes.push('CORPORATE_CONTACT_PATH_MISSING')
  }
  if (input.contact.doNotContact) reasonCodes.push('DO_NOT_CONTACT')
  if (input.contact.conflict) reasonCodes.push('CONFLICT_BLOCK')
  if (currentHiringMissing) reasonCodes.push('CURRENT_HIRING_EVIDENCE_MISSING')
  if (!independencePassed) reasonCodes.push('QUALITY_INDEPENDENT_ORIGINS_LOW')

  return {
    engineVersion: COMMERCIAL_SIGNAL_QUALITY_ENGINE_VERSION,
    decisionAt: decisionAt.toISOString(),
    componentSources: { ...input.componentSources },
    affirmativeEvidenceByComponent,
    featureVersions: {
      quality: COMMERCIAL_SIGNAL_QUALITY_VERSION,
      friction: input.hiringFriction.featureVersion,
      propensity: input.propensity.featureVersion,
      convergence: input.convergence.featureVersion,
      economics: input.economics.featureVersion,
      negativeEvidence: input.negativeEvidence.featureVersion,
    },
    quality,
    status,
    actionability: resolveActionability(status),
    reasonCodes: uniqueText(reasonCodes),
    evidenceIds: usedEvidenceIds,
    independence,
    actionabilityIndependence,
    decisionEvidence: {
      currentHiringEvidence: input.currentHiringEvidence.present,
      currentHiringEvidenceIds,
      positiveEvidenceIds,
      negativeEvidenceIds,
      contactEvidenceIds,
    },
    components,
    modelType: 'heuristic',
    calibrationStatus: 'uncalibrated',
  }
}

function buildAffirmativeEvidence(
  input: CommercialSignalQualityEngineV2Input,
  components: Record<keyof typeof QUALITY_COMPONENTS, OpportunityQualityComponent>,
): CommercialSignalAffirmativeEvidence {
  const result = {
    hiring_need: positiveComponentEvidence(components.hiring_need),
    hiring_friction: ids(input.hiringFriction.positiveReasons.flatMap(
      (reason) => reason.evidenceIds,
    )),
    agency_fit: positiveComponentEvidence(components.agency_fit),
    external_agency_propensity: ids(input.propensity.affirmativeEvidenceIds),
    signal_convergence: ids(input.convergence.affirmativeEvidenceIds),
    economics_fit: positiveComponentEvidence(components.economics_fit),
    market_difficulty: input.marketDifficulty.marketDifficulty === 'high' ||
        input.marketDifficulty.marketDifficulty === 'medium'
      ? ids(components.market_difficulty.evidenceIds) : [],
  }
  for (const key of Object.keys(QUALITY_COMPONENTS) as Array<keyof typeof QUALITY_COMPONENTS>) {
    if (result[key].some((id) => !components[key].evidenceIds.includes(id))) {
      throw new Error(`${key} affirmative evidence must belong to its component lineage`)
    }
  }
  return result
}

function positiveComponentEvidence(component: OpportunityQualityComponent): string[] {
  return (component.value ?? 0) > 0 ? ids(component.evidenceIds) : []
}

function validateComponentSources(
  input: CommercialSignalQualityEngineV2Input,
  components: Record<keyof typeof QUALITY_COMPONENTS, OpportunityQualityComponent>,
): void {
  const provenance = new Map(input.evidence.map((item) => [item.evidenceId, item]))
  const declarations: Array<[
    keyof CommercialSignalQualityEngineV2Input['componentSources'],
    keyof typeof QUALITY_COMPONENTS,
  ]> = [
    ['hiringNeed', 'hiring_need'],
    ['hiringFriction', 'hiring_friction'],
    ['agencyFit', 'agency_fit'],
    ['propensity', 'external_agency_propensity'],
    ['convergence', 'signal_convergence'],
    ['economics', 'economics_fit'],
    ['marketDifficulty', 'market_difficulty'],
  ]
  for (const [sourceKey, componentKey] of declarations) {
    const declared = input.componentSources[sourceKey]
    const allowedKinds = declared === 'derived_deterministic'
      ? ['direct', 'official', 'derived_deterministic']
      : [declared]
    if (components[componentKey].evidenceIds.some((id) => {
      const kind = provenance.get(id)?.sourceKind
      return kind === undefined || !allowedKinds.includes(kind as never)
    })) {
      throw new Error(`${componentKey} evidence does not match its declared source`)
    }
  }
}

function buildComponents(
  input: CommercialSignalQualityEngineV2Input,
): Record<keyof typeof QUALITY_COMPONENTS, OpportunityQualityComponent> {
  return {
    hiring_need: input.hiringNeed,
    hiring_friction: {
      value: input.hiringFriction.frictionLevel === 'unknown'
        ? null
        : input.hiringFriction.frictionScore,
      confidence: input.hiringFriction.frictionLevel === 'unknown'
        ? 0
        : input.hiringFriction.coverage,
      coverage: input.hiringFriction.coverage,
      reasonCodes: [
        ...input.hiringFriction.positiveReasons.map((item) => item.code),
        ...input.hiringFriction.negativeReasons.map((item) => item.code),
      ],
      evidenceIds: input.hiringFriction.evidenceIds,
    },
    agency_fit: input.agencyFit,
    external_agency_propensity: {
      value: input.propensity.propensityScore,
      confidence: input.propensity.confidence,
      coverage: input.propensity.coverage,
      reasonCodes: input.propensity.reasonCodes,
      evidenceIds: input.propensity.evidenceIds,
    },
    signal_convergence: {
      value: input.convergence.convergenceScore,
      confidence: input.convergence.confidence,
      coverage: input.convergence.coverage,
      reasonCodes: [
        ...input.convergence.positiveReasons,
        ...input.convergence.negativeReasons,
      ],
      evidenceIds: input.convergence.evidenceIds,
    },
    economics_fit: {
      value: input.economics.componentValue,
      confidence: input.economics.componentConfidence,
      coverage: input.economics.coverage,
      reasonCodes: input.economics.reasons,
      evidenceIds: input.economics.evidenceIds,
    },
    market_difficulty: {
      value: input.marketDifficulty.componentValue,
      confidence: input.marketDifficulty.componentConfidence,
      coverage: input.marketDifficulty.componentValue === null ? 0 : 1,
      reasonCodes: [input.marketDifficulty.componentValue === null
        ? 'MARKET_DIFFICULTY_UNKNOWN'
        : `MARKET_DIFFICULTY_${input.marketDifficulty.marketDifficulty.toUpperCase()}`],
      evidenceIds: input.marketDifficulty.evidenceIds,
    },
  }
}

function resolveActionability(
  status: CommercialSignalQualityStatus,
): CommercialSignalQualityEngineV2Result['actionability'] {
  if (status === 'qualified_actionable') return 'actionable'
  if (status === 'qualified_needs_enrichment') return 'needs_enrichment'
  if (status === 'blocked' || status === 'expired' || status === 'dismissed') {
    return 'blocked'
  }
  return 'review'
}

function ids(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error('evidence id must be positive')
    return value
  }))].sort(compareIds)
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
