export const HIRING_PROBLEM_ARCHETYPE_VERSION =
  'hiring-problem-archetypes-v1' as const

export const HIRING_PROBLEM_ARCHETYPES = [
  'expansion',
  'replacement_turnover',
  'hard_to_fill',
  'new_unit_buildout',
  'regional_expansion',
  'recruiting_capacity_gap',
  'mass_ramp',
  'executive_change',
  'reactivation',
  'evergreen_hiring',
  'freeze_or_slowdown',
  'unknown',
] as const

export type HiringProblemArchetype = typeof HIRING_PROBLEM_ARCHETYPES[number]

export type HiringProblemSignal<T> = {
  value: T
  eventIds: string[]
  evidenceIds: string[]
}

export type HiringProblemArchetypeInput = {
  friction: {
    level: 'high' | 'medium' | 'low' | 'unknown'
    score: number
    evidenceIds: string[]
  }
  hiringAcceleration: HiringProblemSignal<number | null>
  growthVsBaseline: HiringProblemSignal<number | null>
  repeatedRoleShare: HiringProblemSignal<number | null>
  meaningfulRepostCycles: HiringProblemSignal<number | null>
  roleComplexity: HiringProblemSignal<number | null>
  salaryOrRequirementsChanged: HiringProblemSignal<boolean | null>
  newUnit: HiringProblemSignal<boolean | null>
  newRegion: HiringProblemSignal<boolean | null>
  leadershipChange: HiringProblemSignal<boolean | null>
  recruiterVacancy: HiringProblemSignal<boolean | null>
  massHiring: HiringProblemSignal<boolean | null>
  evergreen: HiringProblemSignal<boolean | null>
  reactivation: HiringProblemSignal<boolean | null>
  freezeOrSlowdown: HiringProblemSignal<boolean | null>
}

export type HiringProblemArchetypeResult = {
  featureVersion: typeof HIRING_PROBLEM_ARCHETYPE_VERSION
  archetype: HiringProblemArchetype
  confidence: number
  supportingEventIds: string[]
  contradictingEventIds: string[]
  evidenceIds: string[]
  reasonCodes: string[]
}

export function buildHiringProblemArchetypes(
  rawInput: HiringProblemArchetypeInput,
): HiringProblemArchetypeResult[] {
  const input = normalizeInput(rawInput)
  if (input.freezeOrSlowdown.value === true) {
    const contradictions = positiveSituationSignals(input)
    return [archetype({
      archetype: 'freeze_or_slowdown',
      confidence: 0.95,
      supporting: [input.freezeOrSlowdown],
      contradicting: contradictions,
      reasonCodes: ['CONFIRMED_FREEZE_OR_SLOWDOWN'],
    })]
  }

  const results: HiringProblemArchetypeResult[] = []
  const accelerated = (input.hiringAcceleration.value ?? 0) >= 0.6
  const growing = (input.growthVsBaseline.value ?? 0) >= 0.6
  const expansionContext = [
    input.newUnit,
    input.newRegion,
    input.leadershipChange,
  ].filter((item) => item.value === true)

  if (accelerated && growing && expansionContext.length > 0) {
    results.push(archetype({
      archetype: 'expansion',
      confidence: average([
        input.hiringAcceleration.value ?? 0,
        input.growthVsBaseline.value ?? 0,
        0.9,
      ]),
      supporting: [
        input.hiringAcceleration,
        input.growthVsBaseline,
        ...expansionContext,
      ],
      reasonCodes: [
        'GROWTH_ABOVE_BASELINE',
        'HIRING_ACCELERATION_EVIDENCED',
        'EXPANSION_CONTEXT_EVIDENCED',
      ],
    }))
  }

  if (accelerated && input.newUnit.value === true) {
    results.push(archetype({
      archetype: 'new_unit_buildout',
      confidence: average([input.hiringAcceleration.value ?? 0, 0.9]),
      supporting: [input.hiringAcceleration, input.newUnit],
      reasonCodes: ['NEW_UNIT_EVIDENCED', 'HIRING_ACCELERATION_EVIDENCED'],
    }))
  }

  if (accelerated && input.newRegion.value === true) {
    results.push(archetype({
      archetype: 'regional_expansion',
      confidence: average([input.hiringAcceleration.value ?? 0, 0.9]),
      supporting: [input.hiringAcceleration, input.newRegion],
      reasonCodes: ['NEW_REGION_EVIDENCED', 'HIRING_ACCELERATION_EVIDENCED'],
    }))
  }

  if (
    (input.repeatedRoleShare.value ?? 0) >= 0.7 &&
    !growing &&
    expansionContext.length === 0
  ) {
    results.push(archetype({
      archetype: 'replacement_turnover',
      confidence: average([
        input.repeatedRoleShare.value ?? 0,
        1 - (input.growthVsBaseline.value ?? 0.5),
      ]),
      supporting: [input.repeatedRoleShare],
      contradicting: input.growthVsBaseline.value === null
        ? []
        : [input.growthVsBaseline],
      reasonCodes: ['REPEATED_SAME_ROLE_PATTERN', 'EXPANSION_EVIDENCE_ABSENT'],
    }))
  }

  const hardToFill =
    input.friction.level === 'high' &&
    (input.meaningfulRepostCycles.value ?? 0) >= 2 &&
    input.salaryOrRequirementsChanged.value === true &&
    (input.roleComplexity.value ?? 0) >= 0.6 &&
    input.evergreen.value !== true
  if (hardToFill) {
    results.push(archetype({
      archetype: 'hard_to_fill',
      confidence: average([
        input.friction.score,
        Math.min(1, (input.meaningfulRepostCycles.value ?? 0) / 3),
        input.roleComplexity.value ?? 0,
        1,
      ]),
      supporting: [
        input.meaningfulRepostCycles,
        input.salaryOrRequirementsChanged,
        input.roleComplexity,
      ],
      extraEvidenceIds: input.friction.evidenceIds,
      reasonCodes: [
        'HIGH_HIRING_FRICTION',
        'MULTIPLE_MEANINGFUL_REPOSTS',
        'ROLE_REQUIREMENTS_CHANGED',
        'COMPLEX_ROLE',
      ],
    }))
  }

  if (accelerated && input.recruiterVacancy.value === true) {
    results.push(archetype({
      archetype: 'recruiting_capacity_gap',
      confidence: average([input.hiringAcceleration.value ?? 0, 1]),
      supporting: [input.hiringAcceleration, input.recruiterVacancy],
      reasonCodes: [
        'HIRING_VELOCITY_PRESSURE',
        'RECRUITER_VACANCY_DIRECT_EVIDENCE',
      ],
    }))
  }

  if (input.massHiring.value === true) {
    results.push(archetype({
      archetype: 'mass_ramp',
      confidence: 0.9,
      supporting: [input.massHiring],
      reasonCodes: ['MASS_HIRING_EVIDENCED'],
    }))
  }

  if (input.leadershipChange.value === true) {
    results.push(archetype({
      archetype: 'executive_change',
      confidence: 0.7,
      supporting: [input.leadershipChange],
      reasonCodes: ['LEADERSHIP_CHANGE_EVIDENCED'],
    }))
  }

  if (input.reactivation.value === true) {
    results.push(archetype({
      archetype: 'reactivation',
      confidence: 0.85,
      supporting: [input.reactivation],
      reasonCodes: ['HIRING_REACTIVATION_EVIDENCED'],
    }))
  }

  if (input.evergreen.value === true) {
    results.push(archetype({
      archetype: 'evergreen_hiring',
      confidence: 0.95,
      supporting: [input.evergreen],
      contradicting: [input.meaningfulRepostCycles],
      reasonCodes: ['EVERGREEN_PATTERN_EVIDENCED'],
    }))
  }

  if (results.length === 0) {
    const accelerationUnknown = accelerated
    return [archetype({
      archetype: 'unknown',
      confidence: 0,
      supporting: accelerationUnknown ? [input.hiringAcceleration] : [],
      reasonCodes: [accelerationUnknown
        ? 'ACCELERATION_CAUSE_UNKNOWN'
        : 'ARCHETYPE_EVIDENCE_INSUFFICIENT'],
    })]
  }

  return results.sort((left, right) =>
    HIRING_PROBLEM_ARCHETYPES.indexOf(left.archetype) -
    HIRING_PROBLEM_ARCHETYPES.indexOf(right.archetype),
  )
}

function normalizeInput(
  input: HiringProblemArchetypeInput,
): HiringProblemArchetypeInput {
  const frictionScore = unitInterval(input.friction.score, 'friction score')
  return {
    friction: {
      level: input.friction.level,
      score: frictionScore,
      evidenceIds: ids(input.friction.evidenceIds),
    },
    hiringAcceleration: unitSignal(input.hiringAcceleration, 'hiring acceleration'),
    growthVsBaseline: unitSignal(input.growthVsBaseline, 'growth vs baseline'),
    repeatedRoleShare: unitSignal(input.repeatedRoleShare, 'repeated role share'),
    meaningfulRepostCycles: countSignal(
      input.meaningfulRepostCycles,
      'meaningful repost cycles',
    ),
    roleComplexity: unitSignal(input.roleComplexity, 'role complexity'),
    salaryOrRequirementsChanged: booleanSignal(input.salaryOrRequirementsChanged),
    newUnit: booleanSignal(input.newUnit),
    newRegion: booleanSignal(input.newRegion),
    leadershipChange: booleanSignal(input.leadershipChange),
    recruiterVacancy: booleanSignal(input.recruiterVacancy),
    massHiring: booleanSignal(input.massHiring),
    evergreen: booleanSignal(input.evergreen),
    reactivation: booleanSignal(input.reactivation),
    freezeOrSlowdown: booleanSignal(input.freezeOrSlowdown),
  }
}

function archetype(input: {
  archetype: HiringProblemArchetype
  confidence: number
  supporting: Array<HiringProblemSignal<unknown>>
  contradicting?: Array<HiringProblemSignal<unknown>>
  extraEvidenceIds?: string[]
  reasonCodes: string[]
}): HiringProblemArchetypeResult {
  const contradicting = input.contradicting ?? []
  return {
    featureVersion: HIRING_PROBLEM_ARCHETYPE_VERSION,
    archetype: input.archetype,
    confidence: round(unitInterval(input.confidence, 'archetype confidence')),
    supportingEventIds: ids(input.supporting.flatMap((item) => item.eventIds)),
    contradictingEventIds: ids(contradicting.flatMap((item) => item.eventIds)),
    evidenceIds: ids([
      ...input.supporting.flatMap((item) => item.evidenceIds),
      ...contradicting.flatMap((item) => item.evidenceIds),
      ...(input.extraEvidenceIds ?? []),
    ]),
    reasonCodes: uniqueText(input.reasonCodes),
  }
}

function positiveSituationSignals(
  input: HiringProblemArchetypeInput,
): Array<HiringProblemSignal<unknown>> {
  return [
    input.hiringAcceleration,
    input.growthVsBaseline,
    input.newUnit,
    input.newRegion,
    input.leadershipChange,
    input.recruiterVacancy,
    input.massHiring,
    input.reactivation,
  ].filter((item) =>
    item.value === true ||
    (typeof item.value === 'number' && item.value >= 0.6),
  )
}

function unitSignal(
  input: HiringProblemSignal<number | null>,
  label: string,
): HiringProblemSignal<number | null> {
  return normalizeSignal(input, (value) => unitInterval(value, label))
}

function countSignal(
  input: HiringProblemSignal<number | null>,
  label: string,
): HiringProblemSignal<number | null> {
  return normalizeSignal(input, (value) => {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new Error(`${label} must be a non-negative integer`)
    }
    return value
  })
}

function booleanSignal(
  input: HiringProblemSignal<boolean | null>,
): HiringProblemSignal<boolean | null> {
  return normalizeSignal(input, (value) => value)
}

function normalizeSignal<T>(
  input: HiringProblemSignal<T | null>,
  normalize: (value: T) => T,
): HiringProblemSignal<T | null> {
  if (input.value === null) return { value: null, eventIds: [], evidenceIds: [] }
  return {
    value: normalize(input.value),
    eventIds: ids(input.eventIds, 'event id'),
    evidenceIds: ids(input.evidenceIds),
  }
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
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}
