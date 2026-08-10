export const EXTERNAL_AGENCY_PROPENSITY_VERSION =
  'external-agency-propensity-v2' as const

export type ExternalAgencyPropensityLevel =
  | 'high'
  | 'medium'
  | 'low'
  | 'unknown'
  | 'blocked'

export type PropensityComponent = {
  value: number | null
  confidence: number
  coverage: number
  evidenceIds: string[]
}

export type PropensityPolicyFlag = {
  value: boolean | null
  evidenceIds: string[]
}

export type PropensityArchetype = {
  archetype: string
  confidence: number
  evidenceIds: string[]
  eventIds: string[]
}

export type ContributionProvenance = {
  semanticFeatureFamily: string
  evidenceOriginGroup: string
  reasonCode: string
  contribution: number
  derivedFrom: string[]
}

export type ExternalAgencyPropensityInput = {
  hiringNeed: PropensityComponent
  hiringFriction: PropensityComponent
  externalSupportPlausibility: PropensityComponent
  timing: PropensityComponent
  agencyDna: PropensityComponent
  previousAgencyRelationship: PropensityComponent
  internalRecruitingCapacity: PropensityComponent
  timeToFillPressure: PropensityComponent
  procurementBarrier: PropensityComponent
  doNotContact: PropensityPolicyFlag
  conflict: PropensityPolicyFlag
  archetypes: PropensityArchetype[]
  evidenceOriginGroups: Record<string, string>
  convergenceIndependentGroupCount: number
}

export type ExternalAgencyPropensityResult = {
  featureVersion: typeof EXTERNAL_AGENCY_PROPENSITY_VERSION
  propensityLevel: ExternalAgencyPropensityLevel
  propensityScore: number | null
  confidence: number
  coverage: number
  actionability: 'eligible' | 'review' | 'blocked'
  reasonCodes: string[]
  evidenceIds: string[]
  affirmativeEvidenceIds: string[]
  componentValues: Record<string, number | null>
  contributionProvenance: ContributionProvenance[]
}

const COMPONENT_WEIGHTS = {
  hiring_need: 0.24,
  hiring_friction: 0.16,
  external_support_plausibility: 0.2,
  timing: 0.14,
  agency_dna: 0.08,
  previous_agency_relationship: 0.06,
  internal_recruiting_capacity: 0.05,
  time_to_fill_pressure: 0.04,
  procurement_barrier: 0.03,
} as const

type ComponentKey = keyof typeof COMPONENT_WEIGHTS

export function buildExternalAgencyPropensity(
  rawInput: ExternalAgencyPropensityInput,
): ExternalAgencyPropensityResult {
  const input = normalizeInput(rawInput)
  const components: Record<ComponentKey, PropensityComponent> = {
    hiring_need: input.hiringNeed,
    hiring_friction: input.hiringFriction,
    external_support_plausibility: input.externalSupportPlausibility,
    timing: input.timing,
    agency_dna: input.agencyDna,
    previous_agency_relationship: input.previousAgencyRelationship,
    internal_recruiting_capacity: input.internalRecruitingCapacity,
    time_to_fill_pressure: input.timeToFillPressure,
    procurement_barrier: input.procurementBarrier,
  }
  const componentValues = Object.fromEntries(
    Object.entries(components).map(([key, component]) => [key, component.value]),
  )
  const contribution = buildContributions(components, input)
  const coverage = weightedCoverage(components)
  const confidence = weightedConfidence(components)
  const evidenceIds = ids([
    ...Object.values(components).flatMap((item) => item.evidenceIds),
    ...input.doNotContact.evidenceIds,
    ...input.conflict.evidenceIds,
    ...input.archetypes.flatMap((item) => item.evidenceIds),
  ])
  const affirmativeEvidenceIds = ids([
    ...affirmativeComponentEvidence(input.hiringNeed, 0.65),
    ...affirmativeComponentEvidence(input.hiringFriction, 0.6),
    ...affirmativeComponentEvidence(input.externalSupportPlausibility, 0.6),
    ...affirmativeComponentEvidence(input.timing, 0.6),
    ...affirmativeComponentEvidence(input.agencyDna, 0.6),
    ...affirmativeComponentEvidence(input.previousAgencyRelationship, 0.6),
    ...affirmativeComponentEvidence(input.timeToFillPressure, 0.6),
    ...input.archetypes.filter((item) =>
      positiveArchetypePolicy(item.archetype) !== null &&
      item.confidence >= 0.6).flatMap((item) => item.evidenceIds),
  ])
  const reasonCodes: string[] = []

  addPositiveReason(reasonCodes, input.hiringNeed, 0.65, 'HIRING_NEED_EVIDENCED')
  addPositiveReason(
    reasonCodes,
    input.hiringFriction,
    0.6,
    'HIRING_FRICTION_EVIDENCED',
  )
  addPositiveReason(
    reasonCodes,
    input.externalSupportPlausibility,
    0.6,
    'EXTERNAL_SUPPORT_PLAUSIBLE',
  )
  addPositiveReason(reasonCodes, input.timing, 0.6, 'TIMING_WINDOW_ACTIVE')
  addPositiveReason(reasonCodes, input.agencyDna, 0.6, 'AGENCY_DNA_EVIDENCED')
  addPositiveReason(
    reasonCodes,
    input.previousAgencyRelationship,
    0.6,
    'PREVIOUS_AGENCY_RELATIONSHIP_EVIDENCED',
  )
  addPositiveReason(
    reasonCodes,
    input.timeToFillPressure,
    0.6,
    'TIME_TO_FILL_PRESSURE_EVIDENCED',
  )

  if ((input.internalRecruitingCapacity.value ?? 0) >= 0.7) {
    reasonCodes.push('INTERNAL_TA_CAPACITY_HIGH')
  }
  const explicitNoAgencies = input.externalSupportPlausibility.value === 0 &&
    input.externalSupportPlausibility.confidence >= 0.9
  if (explicitNoAgencies) reasonCodes.push('EXPLICIT_NO_AGENCIES')
  const procurementBlocked = (input.procurementBarrier.value ?? 0) >= 0.8 &&
    input.procurementBarrier.confidence >= 0.8
  if (procurementBlocked) reasonCodes.push('PROCUREMENT_BARRIER')
  if (input.doNotContact.value === true) reasonCodes.push('DO_NOT_CONTACT')
  if (input.conflict.value === true) reasonCodes.push('CONFLICT_BLOCK')
  if (input.convergenceIndependentGroupCount >= 2) {
    reasonCodes.push('INDEPENDENT_SIGNAL_CONVERGENCE')
  }
  reasonCodes.push(...contribution.reasonCodes)

  const blocked = explicitNoAgencies || procurementBlocked ||
    input.doNotContact.value === true || input.conflict.value === true
  if (blocked) {
    return result({
      propensityLevel: 'blocked',
      propensityScore: 0,
      confidence,
      coverage,
      actionability: 'blocked',
      reasonCodes,
      evidenceIds,
      affirmativeEvidenceIds,
      componentValues,
      contributionProvenance: contribution.provenance,
    })
  }

  const coreKnown = [
    input.hiringNeed,
    input.hiringFriction,
    input.externalSupportPlausibility,
    input.timing,
  ].filter((item) => item.value !== null).length
  if (coreKnown < 2 || coverage < 0.35) {
    return result({
      propensityLevel: 'unknown',
      propensityScore: null,
      confidence: 0,
      coverage,
      actionability: 'review',
      reasonCodes: [...reasonCodes, 'INSUFFICIENT_COMPLEMENTARY_EVIDENCE'],
      evidenceIds,
      affirmativeEvidenceIds,
      componentValues,
      contributionProvenance: contribution.provenance,
    })
  }

  const score = round(clamp01(
    contribution.baseScore + contribution.archetypeDelta,
  ))
  const archetypeCapsHigh = input.archetypes.some((item) =>
    item.confidence >= 0.6 &&
    ['evergreen_hiring', 'freeze_or_slowdown'].includes(item.archetype))
  const highGate =
    (input.hiringNeed.value ?? 0) >= 0.65 &&
    (input.externalSupportPlausibility.value ?? 0) >= 0.6 &&
    ((input.hiringFriction.value ?? 0) >= 0.6 ||
      (input.timeToFillPressure.value ?? 0) >= 0.6) &&
    (input.timing.value ?? 0) >= 0.6 &&
    input.convergenceIndependentGroupCount >= 2 &&
    coverage >= 0.65 &&
    confidence >= 0.55 &&
    !archetypeCapsHigh
  const propensityLevel: ExternalAgencyPropensityLevel = highGate
    ? 'high'
    : score >= 0.5
      ? 'medium'
      : 'low'

  return result({
    propensityLevel,
    propensityScore: score,
    confidence,
    coverage,
    actionability: propensityLevel === 'low' ? 'review' : 'eligible',
    reasonCodes: highGate
      ? reasonCodes
      : [...reasonCodes, 'HIGH_GATE_NOT_SATISFIED'],
    evidenceIds,
    affirmativeEvidenceIds,
    componentValues,
    contributionProvenance: contribution.provenance,
  })
}

function affirmativeComponentEvidence(
  componentValue: PropensityComponent,
  threshold: number,
): string[] {
  return componentValue.value !== null && componentValue.value >= threshold
    ? componentValue.evidenceIds : []
}

function buildContributions(
  components: Record<ComponentKey, PropensityComponent>,
  input: ExternalAgencyPropensityInput,
): {
  baseScore: number
  archetypeDelta: number
  provenance: ContributionProvenance[]
  reasonCodes: string[]
} {
  const raw: ContributionProvenance[] = []
  let availableWeight = 0
  for (const [key, component] of Object.entries(components) as Array<
    [ComponentKey, PropensityComponent]
  >) {
    if (component.value === null) continue
    const weight = COMPONENT_WEIGHTS[key]
    const value = key === 'internal_recruiting_capacity' ||
      key === 'procurement_barrier'
      ? 1 - component.value
      : component.value
    availableWeight += weight
    const groups = uniqueText(component.evidenceIds.map((id) =>
      input.evidenceOriginGroups[id] ?? 'origin:unknown'))
    const effectiveGroups = groups.length > 0 ? groups : ['origin:unknown']
    for (const group of effectiveGroups) {
      const idsForGroup = component.evidenceIds.filter((id) =>
        (input.evidenceOriginGroups[id] ?? 'origin:unknown') === group)
      raw.push({
        semanticFeatureFamily: semanticFamily(key),
        evidenceOriginGroup: group,
        reasonCode: `EAP_COMPONENT_${key.toUpperCase()}`,
        contribution: round((value * weight) / effectiveGroups.length),
        derivedFrom: idsForGroup.map((id) => `evidence:${id}`),
      })
    }
  }
  const provenance = diminishSharedOrigins(raw)
  const reasonCodes: string[] = []
  let archetypeDelta = 0
  for (const archetype of input.archetypes) {
    const positive = positiveArchetypePolicy(archetype.archetype)
    const negative = negativeArchetypePolicy(archetype.archetype)
    const reasonCode = archetypeReason(archetype.archetype)
    if (reasonCode) reasonCodes.push(reasonCode)
    if (archetype.confidence < 0.6 || archetype.evidenceIds.length === 0) continue
    const rawDelta = positive !== null
      ? positive * archetype.confidence
      : negative !== null
        ? negative * archetype.confidence
        : 0
    if (rawDelta === 0) continue
    const groups = uniqueText(archetype.evidenceIds.map((id) =>
      input.evidenceOriginGroups[id] ?? 'origin:unknown'))
    for (const group of groups) {
      const sharesPositiveOrigin = rawDelta > 0 && provenance.some((item) =>
        item.evidenceOriginGroup === group && item.contribution > 0)
      const delta = round(
        rawDelta / groups.length * (sharesPositiveOrigin ? 0.25 : 1),
      )
      archetypeDelta += delta
      provenance.push({
        semanticFeatureFamily: 'hiring_problem_archetype',
        evidenceOriginGroup: group,
        reasonCode: reasonCode ?? 'ARCHETYPE_NO_SCORE_EFFECT',
        contribution: delta,
        derivedFrom: archetype.evidenceIds
          .filter((id) =>
            (input.evidenceOriginGroups[id] ?? 'origin:unknown') === group)
          .map((id) => `evidence:${id}`),
      })
    }
  }
  return {
    baseScore: availableWeight === 0
      ? 0
      : round(provenance.filter((item) =>
        item.semanticFeatureFamily !== 'hiring_problem_archetype')
        .reduce((sum, item) => sum + item.contribution, 0) / availableWeight),
    archetypeDelta: round(archetypeDelta),
    provenance: sortProvenance(provenance),
    reasonCodes: uniqueText(reasonCodes),
  }
}

function diminishSharedOrigins(
  input: ContributionProvenance[],
): ContributionProvenance[] {
  const byGroup = new Map<string, ContributionProvenance[]>()
  for (const item of input) {
    byGroup.set(item.evidenceOriginGroup, [
      ...(byGroup.get(item.evidenceOriginGroup) ?? []),
      item,
    ])
  }
  return [...byGroup.values()].flatMap((items) => items
    .sort((left, right) =>
      right.contribution - left.contribution ||
      left.reasonCode.localeCompare(right.reasonCode, 'en'))
    .map((item, index) => ({
      ...item,
      contribution: round(item.contribution * (index === 0 ? 1 : 0.25)),
    })))
}

function semanticFamily(key: ComponentKey): string {
  if (key === 'hiring_need') return 'real_hiring_need'
  if (key === 'hiring_friction' || key === 'time_to_fill_pressure') {
    return 'hiring_friction'
  }
  if (key === 'agency_dna') return 'agency_fit'
  if (key === 'internal_recruiting_capacity') return 'recruiting_capacity'
  return key
}

function positiveArchetypePolicy(archetype: string): number | null {
  if (['hard_to_fill', 'recruiting_capacity_gap'].includes(archetype)) return 0.06
  if (['new_unit_buildout', 'regional_expansion'].includes(archetype)) return 0.04
  return null
}

function negativeArchetypePolicy(archetype: string): number | null {
  if (archetype === 'evergreen_hiring') return -0.1
  if (archetype === 'freeze_or_slowdown') return -0.3
  return null
}

function archetypeReason(archetype: string): string | null {
  const reasons: Record<string, string> = {
    hard_to_fill: 'ARCHETYPE_HARD_TO_FILL_SUPPORT',
    recruiting_capacity_gap: 'ARCHETYPE_CAPACITY_GAP_SUPPORT',
    new_unit_buildout: 'ARCHETYPE_NEW_UNIT_SUPPORT',
    regional_expansion: 'ARCHETYPE_REGIONAL_EXPANSION_SUPPORT',
    evergreen_hiring: 'ARCHETYPE_EVERGREEN_DEMOTION',
    freeze_or_slowdown: 'ARCHETYPE_FREEZE_SLOWDOWN_DEMOTION',
    replacement_turnover: 'ARCHETYPE_REPLACEMENT_TURNOVER_DISTINCT',
    unknown: 'ARCHETYPE_UNKNOWN_NO_BONUS',
  }
  return reasons[archetype] ?? null
}

function sortProvenance(
  input: ContributionProvenance[],
): ContributionProvenance[] {
  return [...input].sort((left, right) =>
    left.evidenceOriginGroup.localeCompare(right.evidenceOriginGroup, 'en') ||
    left.semanticFeatureFamily.localeCompare(right.semanticFeatureFamily, 'en') ||
    left.reasonCode.localeCompare(right.reasonCode, 'en'))
}

function weightedCoverage(
  components: Record<ComponentKey, PropensityComponent>,
): number {
  return round((Object.entries(components) as Array<
    [ComponentKey, PropensityComponent]
  >).reduce((total, [key, component]) =>
    total + (COMPONENT_WEIGHTS[key] * component.coverage), 0))
}

function weightedConfidence(
  components: Record<ComponentKey, PropensityComponent>,
): number {
  let weighted = 0
  let covered = 0
  for (const [key, component] of Object.entries(components) as Array<
    [ComponentKey, PropensityComponent]
  >) {
    if (component.value === null) continue
    const effectiveWeight = COMPONENT_WEIGHTS[key] * component.coverage
    weighted += effectiveWeight * component.confidence
    covered += effectiveWeight
  }
  return round(covered === 0 ? 0 : weighted / covered)
}

function normalizeInput(
  input: ExternalAgencyPropensityInput,
): ExternalAgencyPropensityInput {
  if (!Number.isInteger(input.convergenceIndependentGroupCount) ||
    input.convergenceIndependentGroupCount < 0) {
    throw new Error('independent convergence group count must be non-negative')
  }
  return {
    ...input,
    hiringNeed: component(input.hiringNeed, 'hiring need'),
    hiringFriction: component(input.hiringFriction, 'hiring friction'),
    externalSupportPlausibility: component(
      input.externalSupportPlausibility,
      'external support plausibility',
    ),
    timing: component(input.timing, 'timing'),
    agencyDna: component(input.agencyDna, 'agency DNA'),
    previousAgencyRelationship: component(
      input.previousAgencyRelationship,
      'previous agency relationship',
    ),
    internalRecruitingCapacity: component(
      input.internalRecruitingCapacity,
      'internal recruiting capacity',
    ),
    timeToFillPressure: component(input.timeToFillPressure, 'time to fill pressure'),
    procurementBarrier: component(input.procurementBarrier, 'procurement barrier'),
    doNotContact: flag(input.doNotContact, 'do not contact'),
    conflict: flag(input.conflict, 'conflict'),
    archetypes: normalizeArchetypes(input.archetypes),
    evidenceOriginGroups: Object.fromEntries(Object.entries(
      input.evidenceOriginGroups,
    ).sort(([left], [right]) => compareIds(left, right))),
  }
}

function normalizeArchetypes(input: PropensityArchetype[]): PropensityArchetype[] {
  return input.map((item) => ({
    archetype: item.archetype.trim(),
    confidence: unitInterval(item.confidence, 'archetype confidence'),
    evidenceIds: item.archetype === 'unknown'
      ? ids(item.evidenceIds)
      : requiredIds(item.evidenceIds, 'archetype evidence'),
    eventIds: ids(item.eventIds),
  })).sort((left, right) =>
    left.archetype.localeCompare(right.archetype, 'en') ||
    left.evidenceIds.join(',').localeCompare(right.evidenceIds.join(','), 'en'))
}

function component(input: PropensityComponent, label: string): PropensityComponent {
  if (input.value === null) {
    if (input.confidence !== 0 || input.coverage !== 0) {
      throw new Error(`${label} unknown value requires zero confidence and coverage`)
    }
    return { value: null, confidence: 0, coverage: 0, evidenceIds: [] }
  }
  const evidenceIds = requiredIds(input.evidenceIds, `${label} evidence`)
  return {
    value: unitInterval(input.value, label),
    confidence: unitInterval(input.confidence, `${label} confidence`),
    coverage: unitInterval(input.coverage, `${label} coverage`),
    evidenceIds,
  }
}

function flag(input: PropensityPolicyFlag, label: string): PropensityPolicyFlag {
  if (input.value === null) return { value: null, evidenceIds: [] }
  return { value: input.value, evidenceIds: requiredIds(input.evidenceIds, label) }
}

function addPositiveReason(
  reasons: string[],
  componentValue: PropensityComponent,
  threshold: number,
  code: string,
): void {
  if ((componentValue.value ?? 0) >= threshold) reasons.push(code)
}

function result(
  input: Omit<ExternalAgencyPropensityResult, 'featureVersion'>,
): ExternalAgencyPropensityResult {
  return {
    featureVersion: EXTERNAL_AGENCY_PROPENSITY_VERSION,
    ...input,
    reasonCodes: uniqueText(input.reasonCodes),
  }
}

function requiredIds(values: readonly string[], label: string): string[] {
  const result = ids(values)
  if (result.length === 0) throw new Error(`${label} is required`)
  return result
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

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
