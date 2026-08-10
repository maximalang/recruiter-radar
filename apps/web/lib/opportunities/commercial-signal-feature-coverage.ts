export const COMMERCIAL_SIGNAL_COVERAGE_FEATURES = [
  'repost_cycles',
  'salary_change',
  'requirements_change',
  'vacancy_lifetime',
  'role_scarcity',
  'seniority_complexity',
  'multi_role_complexity',
  'regional_expansion',
  'regional_difficulty',
  'hiring_velocity',
  'internal_recruiting_capacity',
  'recruiter_pressure',
  'market_difficulty',
  'procurement',
  'external_agency_history',
  'economics',
  'contact_path',
] as const

export type CommercialSignalCoverageFeature =
  typeof COMMERCIAL_SIGNAL_COVERAGE_FEATURES[number]
export type CommercialSignalFeatureObservation =
  'observed' | 'unknown' | 'not_supported' | 'not_applicable'

export type CommercialSignalFeatureCoverageCounts = {
  observed: number
  unknown: number
  not_supported: number
  not_applicable: number
  coverage: number
}

type FeatureCounts = Record<
  CommercialSignalCoverageFeature,
  CommercialSignalFeatureCoverageCounts
>

export type CommercialSignalFeatureCoverageReport = {
  features: FeatureCounts
  bySource: Record<string, FeatureCounts>
  byProfile: Record<string, FeatureCounts>
  byIndustry: Record<string, FeatureCounts>
  byRegion: Record<string, FeatureCounts>
  byRoleFamily: Record<string, FeatureCounts>
}

export type CommercialSignalFeatureCoverageSample = {
  features: Record<CommercialSignalCoverageFeature, CommercialSignalFeatureObservation>
  dimensions: {
    sources: string[]
    profile: string
    industry: string
    region: string
    roleFamily: string
  }
}

type BuiltForCoverage = {
  clientProfileId: string
  organizationIndustry?: string | null
  archetypes: string[]
  input: {
    evidence: Array<{ sourceFamily: string }>
    stateLineage?: {
      snapshot: {
        hiringBaseline: { sufficientHistory: boolean }
        currentHiringVelocity: { baselineDeviation14d: number | null }
        roleDistribution: { current: Record<string, number> }
        regionDistribution: {
          current: Record<string, number>
          newRegions: string[]
        }
      }
    }
    hiringFriction: {
      observationStates: Record<
        string,
        'observed' | 'unknown' | 'not_applicable' | 'not_configured'
      >
    }
    propensity: { componentValues: Record<string, number | null> }
    economics: { componentValue: number | null }
    marketDifficulty: { componentValue: number | null }
    contact: { corporateContactPathAvailable: boolean }
  }
}

const EXPLICITLY_UNSUPPORTED = new Set<CommercialSignalCoverageFeature>([
  'requirements_change',
  'regional_difficulty',
  'internal_recruiting_capacity',
  'market_difficulty',
  'procurement',
  'external_agency_history',
])

export function buildCommercialSignalFeatureCoverageSample(
  built: BuiltForCoverage,
): CommercialSignalFeatureCoverageSample {
  const friction = built.input.hiringFriction.observationStates
  const state = built.input.stateLineage?.snapshot
  const featureStates: Partial<Record<
    CommercialSignalCoverageFeature,
    CommercialSignalFeatureObservation
  >> = {
    repost_cycles: combinedFrictionState(friction, ['repost_cycles', 'repost_rate']),
    salary_change: frictionState(friction.salary_change),
    requirements_change: frictionState(friction.requirements_change),
    vacancy_lifetime: frictionState(friction.vacancy_lifetime),
    role_scarcity: frictionState(friction.role_scarcity),
    seniority_complexity: frictionState(friction.seniority_complexity),
    multi_role_complexity: frictionState(friction.multi_role_complexity),
    regional_expansion: state?.hiringBaseline.sufficientHistory &&
      Object.keys(state.regionDistribution.current).length > 0
      ? 'observed' : 'unknown',
    regional_difficulty: frictionState(friction.regional_difficulty),
    hiring_velocity: state ? 'observed' : 'unknown',
    internal_recruiting_capacity: frictionState(
      friction.internal_recruiting_capacity,
    ),
    recruiter_pressure: frictionState(friction.hiring_velocity_vs_capacity),
    market_difficulty: built.input.marketDifficulty.componentValue !== null
      ? 'observed' : 'unknown',
    procurement: built.input.propensity.componentValues.procurement_barrier !== null
      ? 'observed' : 'unknown',
    external_agency_history: 'unknown',
    economics: built.input.economics.componentValue !== null
      ? 'observed' : 'unknown',
    contact_path: built.input.contact.corporateContactPathAvailable
      ? 'observed' : 'unknown',
  }
  const features = Object.fromEntries(COMMERCIAL_SIGNAL_COVERAGE_FEATURES.map(
    (feature) => {
      const stateValue = featureStates[feature] ?? 'unknown'
      return [feature, stateValue === 'unknown' && EXPLICITLY_UNSUPPORTED.has(feature)
        ? 'not_supported' : stateValue]
    },
  )) as CommercialSignalFeatureCoverageSample['features']
  return {
    features,
    dimensions: {
      sources: unique(built.input.evidence.map((item) => item.sourceFamily)),
      profile: normalizeDimension(built.clientProfileId),
      industry: normalizeDimension(built.organizationIndustry),
      region: dominantKnownKey(state?.regionDistribution.current),
      roleFamily: dominantKnownKey(state?.roleDistribution.current),
    },
  }
}

function frictionState(
  value: 'observed' | 'unknown' | 'not_applicable' | 'not_configured' | undefined,
): CommercialSignalFeatureObservation {
  if (value === 'observed' || value === 'not_applicable') return value
  return value === 'not_configured' ? 'not_supported' : 'unknown'
}

function combinedFrictionState(
  states: BuiltForCoverage['input']['hiringFriction']['observationStates'],
  keys: string[],
): CommercialSignalFeatureObservation {
  const values = keys.map((key) => frictionState(states[key]))
  if (values.includes('observed')) return 'observed'
  if (values.every((value) => value === 'not_applicable')) return 'not_applicable'
  if (values.every((value) => value === 'not_supported')) return 'not_supported'
  return 'unknown'
}

export function emptyCommercialSignalFeatureCoverageReport():
CommercialSignalFeatureCoverageReport {
  return {
    features: emptyFeatureCounts(),
    bySource: {},
    byProfile: {},
    byIndustry: {},
    byRegion: {},
    byRoleFamily: {},
  }
}

export function addCommercialSignalFeatureCoverageSample(
  report: CommercialSignalFeatureCoverageReport,
  sample: CommercialSignalFeatureCoverageSample,
): void {
  addToCounts(report.features, sample.features)
  for (const source of sample.dimensions.sources.length > 0
    ? sample.dimensions.sources : ['unknown']) {
    addToSlice(report.bySource, source, sample.features)
  }
  addToSlice(report.byProfile, sample.dimensions.profile, sample.features)
  addToSlice(report.byIndustry, sample.dimensions.industry, sample.features)
  addToSlice(report.byRegion, sample.dimensions.region, sample.features)
  addToSlice(report.byRoleFamily, sample.dimensions.roleFamily, sample.features)
}

function addToSlice(
  slice: Record<string, FeatureCounts>,
  rawKey: string,
  features: CommercialSignalFeatureCoverageSample['features'],
): void {
  const key = normalizeDimension(rawKey)
  slice[key] ??= emptyFeatureCounts()
  addToCounts(slice[key], features)
}

function addToCounts(
  counts: FeatureCounts,
  features: CommercialSignalFeatureCoverageSample['features'],
): void {
  for (const feature of COMMERCIAL_SIGNAL_COVERAGE_FEATURES) {
    counts[feature][features[feature]] += 1
    const applicable = counts[feature].observed + counts[feature].unknown +
      counts[feature].not_supported
    counts[feature].coverage = applicable === 0
      ? 0
      : round(counts[feature].observed / applicable)
  }
}

function emptyFeatureCounts(): FeatureCounts {
  return Object.fromEntries(COMMERCIAL_SIGNAL_COVERAGE_FEATURES.map((feature) => [
    feature,
    { observed: 0, unknown: 0, not_supported: 0, not_applicable: 0, coverage: 0 },
  ])) as FeatureCounts
}

function dominantKnownKey(values: Record<string, number> | undefined): string {
  if (!values) return 'unknown'
  return Object.entries(values)
    .filter(([key, value]) => normalizeDimension(key) !== 'unknown' && value > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key]) => normalizeDimension(key))[0] ?? 'unknown'
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeDimension))].sort()
}

function normalizeDimension(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  return normalized || 'unknown'
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
