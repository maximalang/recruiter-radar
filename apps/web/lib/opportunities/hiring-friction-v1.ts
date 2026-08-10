export const HIRING_FRICTION_VERSION = 'hiring-friction-v1' as const

export const HIRING_FRICTION_LEVELS = [
  'high',
  'medium',
  'low',
  'unknown',
] as const

export type HiringFrictionLevel = typeof HIRING_FRICTION_LEVELS[number]

export type ObservationState =
  | 'observed'
  | 'unknown'
  | 'not_applicable'
  | 'not_configured'

export type EvidencedMetric = {
  state: ObservationState
  value: number | null
  evidenceIds: string[]
}

export type EvidencedFlag = {
  state: ObservationState
  value: boolean | null
  evidenceIds: string[]
}

export type HiringFrictionRepostCycle = {
  intervalDays: number
  automated: boolean | null
  salaryChanged: boolean | null
  requirementsChanged: boolean | null
  lifecycleClassification?: 'meaningful' | 'routine_republication' | 'unknown'
  sourcePublicationChanged?: boolean | null
  evidenceIds: string[]
}

export type EvidencedRepostCycles = {
  state: ObservationState
  value: HiringFrictionRepostCycle[] | null
  evidenceIds: string[]
}

export type HiringFrictionInput = {
  vacancyAgeDays: EvidencedMetric
  repostCycles: EvidencedRepostCycles
  repostRate: EvidencedMetric
  salaryChange: EvidencedMetric
  requirementsChange: EvidencedMetric
  closeReopenCycles: EvidencedMetric
  roleScarcity: EvidencedMetric
  seniorityComplexity: EvidencedMetric
  multiRoleComplexity: EvidencedMetric
  regionalDifficulty: EvidencedMetric
  internalRecruitingCapacity: EvidencedMetric
  hiringVelocityVsCapacity: EvidencedMetric
  observedVacancyLifetime: EvidencedMetric
  evergreenRole: EvidencedFlag
  massHiring: EvidencedFlag
}

export type HiringFrictionReason = {
  code: string
  evidenceIds: string[]
}

export type HiringFrictionResult = {
  featureVersion: typeof HIRING_FRICTION_VERSION
  frictionLevel: HiringFrictionLevel
  frictionScore: number
  coverage: number
  positiveReasons: HiringFrictionReason[]
  negativeReasons: HiringFrictionReason[]
  evidenceIds: string[]
  componentValues: Record<string, number | null>
  observationStates: Record<string, ObservationState>
}

const WEIGHTS = {
  vacancyAge: 0.08,
  repostCycles: 0.18,
  salaryChange: 0.1,
  requirementsChange: 0.08,
  closeReopenCycles: 0.08,
  roleScarcity: 0.1,
  seniorityComplexity: 0.08,
  multiRoleComplexity: 0.06,
  regionalDifficulty: 0.06,
  internalRecruitingCapacity: 0.08,
  hiringVelocityVsCapacity: 0.1,
  vacancyLifetime: 0.06,
  evergreenRole: 0.04,
  massHiring: 0.04,
} as const

const TOTAL_WEIGHT = Object.values(WEIGHTS)
  .reduce((total, value) => total + value, 0)

export function buildHiringFriction(
  rawInput: HiringFrictionInput,
): HiringFrictionResult {
  const input = normalizeInput(rawInput)
  const repostCycles = input.repostCycles.value ?? []
  const meaningfulCycles = repostCycles.filter(isMeaningfulRepost)
  const standardCycles = repostCycles.filter((cycle) =>
    !isMeaningfulRepost(cycle),
  )
  const repostRateValue = input.repostRate.value
  const repostValue = input.repostCycles.state === 'observed'
    ? clamp01(meaningfulCycles.length / 2)
    : null
  const componentValues: Record<string, number | null> = {
    vacancy_age: input.vacancyAgeDays.value === null
      ? null
      : clamp01((input.vacancyAgeDays.value - 30) / 90),
    repost_cycles: repostValue === null
      ? repostRateValue
      : repostRateValue === null ? repostValue : Math.max(repostValue, repostRateValue),
    repost_rate: repostRateValue,
    salary_change: input.salaryChange.value,
    requirements_change: input.requirementsChange.value,
    close_reopen_cycle: input.closeReopenCycles.value,
    role_scarcity: input.roleScarcity.value,
    seniority_complexity: input.seniorityComplexity.value,
    multi_role_complexity: input.multiRoleComplexity.value,
    regional_difficulty: input.regionalDifficulty.value,
    internal_recruiting_capacity: input.internalRecruitingCapacity.value,
    hiring_velocity_vs_capacity: input.hiringVelocityVsCapacity.value,
    vacancy_lifetime: input.observedVacancyLifetime.value,
  }
  const positiveReasons: HiringFrictionReason[] = []
  const negativeReasons: HiringFrictionReason[] = []
  let score = 0

  score += contribution(componentValues.vacancy_age, WEIGHTS.vacancyAge)
  score += contribution(componentValues.repost_cycles, WEIGHTS.repostCycles)
  score += contribution(componentValues.salary_change, WEIGHTS.salaryChange)
  score += contribution(
    componentValues.requirements_change,
    WEIGHTS.requirementsChange,
  )
  score += contribution(
    componentValues.close_reopen_cycle,
    WEIGHTS.closeReopenCycles,
  )
  score += contribution(componentValues.role_scarcity, WEIGHTS.roleScarcity)
  score += contribution(
    componentValues.seniority_complexity,
    WEIGHTS.seniorityComplexity,
  )
  score += contribution(
    componentValues.multi_role_complexity,
    WEIGHTS.multiRoleComplexity,
  )
  score += contribution(
    componentValues.regional_difficulty,
    WEIGHTS.regionalDifficulty,
  )
  score += contribution(
    componentValues.hiring_velocity_vs_capacity,
    WEIGHTS.hiringVelocityVsCapacity,
  )
  score += contribution(
    componentValues.vacancy_lifetime,
    WEIGHTS.vacancyLifetime,
  )
  score -= contribution(
    componentValues.internal_recruiting_capacity,
    WEIGHTS.internalRecruitingCapacity,
  )

  if (standardCycles.length > 0) {
    negativeReasons.push(reason(
      'STANDARD_HH_REPUBLICATION',
      standardCycles.flatMap((cycle) => cycle.evidenceIds),
    ))
  }
  if (meaningfulCycles.length > 0) {
    positiveReasons.push(reason(
      'MEANINGFUL_REPOST_CYCLES',
      meaningfulCycles.flatMap((cycle) => cycle.evidenceIds),
    ))
  }
  if ((input.repostRate.value ?? 0) > 0) {
    positiveReasons.push(reason('REPOST_RATE_EVIDENCED', input.repostRate.evidenceIds))
  }
  if ((input.salaryChange.value ?? 0) > 0) {
    positiveReasons.push(reason('SALARY_CHANGED', input.salaryChange.evidenceIds))
  }
  if ((input.requirementsChange.value ?? 0) > 0) {
    positiveReasons.push(reason(
      'REQUIREMENTS_CHANGED',
      input.requirementsChange.evidenceIds,
    ))
  }
  if ((input.closeReopenCycles.value ?? 0) > 0) {
    positiveReasons.push(reason(
      'CLOSE_REOPEN_CYCLE',
      input.closeReopenCycles.evidenceIds,
    ))
  }
  if ((input.roleScarcity.value ?? 0) >= 0.6) {
    positiveReasons.push(reason('ROLE_SCARCITY_EVIDENCED', input.roleScarcity.evidenceIds))
  }
  if ((input.hiringVelocityVsCapacity.value ?? 0) >= 0.6) {
    positiveReasons.push(reason(
      'HIRING_VELOCITY_EXCEEDS_CAPACITY',
      input.hiringVelocityVsCapacity.evidenceIds,
    ))
  }
  if ((input.internalRecruitingCapacity.value ?? 0) >= 0.7) {
    negativeReasons.push(reason(
      'LARGE_INTERNAL_RECRUITING_CAPACITY',
      input.internalRecruitingCapacity.evidenceIds,
    ))
  }

  const hasPersistentCombination =
    meaningfulCycles.length >= 2 &&
    ((input.salaryChange.value ?? 0) > 0 ||
      (input.requirementsChange.value ?? 0) > 0) &&
    (input.vacancyAgeDays.value ?? 0) > 60
  if (hasPersistentCombination) {
    score += 0.18
    positiveReasons.push(reason('PERSISTENT_DEMAND_COMBINATION', [
      ...input.vacancyAgeDays.evidenceIds,
      ...meaningfulCycles.flatMap((cycle) => cycle.evidenceIds),
      ...input.salaryChange.evidenceIds,
      ...input.requirementsChange.evidenceIds,
    ]))
  }

  if (input.evergreenRole.value === true) {
    score = Math.min(score, 0.2)
    negativeReasons.push(reason('EVERGREEN_ROLE', input.evergreenRole.evidenceIds))
  }
  if (input.massHiring.value === true) {
    score = Math.min(score, 0.49)
    negativeReasons.push(reason(
      'MASS_HIRING_SEPARATE_ARCHETYPE',
      input.massHiring.evidenceIds,
    ))
  }

  const coverage = calculateCoverage(input)
  const frictionScore = coverage < 0.25 ? 0 : round(clamp01(score))
  const frictionLevel: HiringFrictionLevel = coverage < 0.25
    ? 'unknown'
    : frictionScore >= 0.68
      ? 'high'
      : frictionScore >= 0.35
        ? 'medium'
        : 'low'

  return {
    featureVersion: HIRING_FRICTION_VERSION,
    frictionLevel,
    frictionScore,
    coverage,
    positiveReasons: sortReasons(positiveReasons),
    negativeReasons: sortReasons(negativeReasons),
    evidenceIds: uniqueIds(allEvidenceIds(input)),
    componentValues,
    observationStates: observationStates(input),
  }
}

function normalizeInput(input: HiringFrictionInput): HiringFrictionInput {
  return {
    vacancyAgeDays: metric(input.vacancyAgeDays, 'vacancy age', false),
    repostCycles: repostObservation(input.repostCycles),
    repostRate: metric(input.repostRate, 'repost rate'),
    salaryChange: metric(input.salaryChange, 'salary change'),
    requirementsChange: metric(input.requirementsChange, 'requirements change'),
    closeReopenCycles: metric(input.closeReopenCycles, 'close reopen cycles'),
    roleScarcity: metric(input.roleScarcity, 'role scarcity'),
    seniorityComplexity: metric(input.seniorityComplexity, 'seniority complexity'),
    multiRoleComplexity: metric(input.multiRoleComplexity, 'multi role complexity'),
    regionalDifficulty: metric(input.regionalDifficulty, 'regional difficulty'),
    internalRecruitingCapacity: metric(
      input.internalRecruitingCapacity,
      'internal recruiting capacity',
    ),
    hiringVelocityVsCapacity: metric(
      input.hiringVelocityVsCapacity,
      'hiring velocity vs capacity',
    ),
    observedVacancyLifetime: metric(
      input.observedVacancyLifetime,
      'observed vacancy lifetime',
    ),
    evergreenRole: flag(input.evergreenRole, 'evergreen role'),
    massHiring: flag(input.massHiring, 'mass hiring'),
  }
}

function calculateCoverage(input: HiringFrictionInput): number {
  let covered = input.repostCycles.state === 'observed' ||
      input.repostRate.state === 'observed'
    ? WEIGHTS.repostCycles
    : 0
  const metrics: Array<[EvidencedMetric, number]> = [
    [input.vacancyAgeDays, WEIGHTS.vacancyAge],
    [input.salaryChange, WEIGHTS.salaryChange],
    [input.requirementsChange, WEIGHTS.requirementsChange],
    [input.closeReopenCycles, WEIGHTS.closeReopenCycles],
    [input.roleScarcity, WEIGHTS.roleScarcity],
    [input.seniorityComplexity, WEIGHTS.seniorityComplexity],
    [input.multiRoleComplexity, WEIGHTS.multiRoleComplexity],
    [input.regionalDifficulty, WEIGHTS.regionalDifficulty],
    [input.internalRecruitingCapacity, WEIGHTS.internalRecruitingCapacity],
    [input.hiringVelocityVsCapacity, WEIGHTS.hiringVelocityVsCapacity],
    [input.observedVacancyLifetime, WEIGHTS.vacancyLifetime],
  ]
  for (const [item, weight] of metrics) {
    if (item.state === 'observed') covered += weight
  }
  if (input.evergreenRole.state === 'observed') covered += WEIGHTS.evergreenRole
  if (input.massHiring.state === 'observed') covered += WEIGHTS.massHiring
  return round(covered / TOTAL_WEIGHT)
}

function allEvidenceIds(input: HiringFrictionInput): string[] {
  return [
    ...input.vacancyAgeDays.evidenceIds,
    ...input.repostCycles.evidenceIds,
    ...(input.repostCycles.value ?? []).flatMap((cycle) => cycle.evidenceIds),
    ...input.repostRate.evidenceIds,
    ...input.salaryChange.evidenceIds,
    ...input.requirementsChange.evidenceIds,
    ...input.closeReopenCycles.evidenceIds,
    ...input.roleScarcity.evidenceIds,
    ...input.seniorityComplexity.evidenceIds,
    ...input.multiRoleComplexity.evidenceIds,
    ...input.regionalDifficulty.evidenceIds,
    ...input.internalRecruitingCapacity.evidenceIds,
    ...input.hiringVelocityVsCapacity.evidenceIds,
    ...input.observedVacancyLifetime.evidenceIds,
    ...input.evergreenRole.evidenceIds,
    ...input.massHiring.evidenceIds,
  ]
}

function observationStates(
  input: HiringFrictionInput,
): Record<string, ObservationState> {
  return {
    vacancy_age: input.vacancyAgeDays.state,
    repost_cycles: input.repostCycles.state,
    repost_rate: input.repostRate.state,
    salary_change: input.salaryChange.state,
    requirements_change: input.requirementsChange.state,
    close_reopen_cycle: input.closeReopenCycles.state,
    role_scarcity: input.roleScarcity.state,
    seniority_complexity: input.seniorityComplexity.state,
    multi_role_complexity: input.multiRoleComplexity.state,
    regional_difficulty: input.regionalDifficulty.state,
    internal_recruiting_capacity: input.internalRecruitingCapacity.state,
    hiring_velocity_vs_capacity: input.hiringVelocityVsCapacity.state,
    vacancy_lifetime: input.observedVacancyLifetime.state,
    evergreen_role: input.evergreenRole.state,
    mass_hiring: input.massHiring.state,
  }
}

function isMeaningfulRepost(cycle: HiringFrictionRepostCycle): boolean {
  if (cycle.lifecycleClassification) {
    return cycle.lifecycleClassification === 'meaningful' ||
      cycle.salaryChanged === true || cycle.requirementsChanged === true
  }
  const standardLifecycle = cycle.intervalDays >= 25 && cycle.intervalDays <= 35
  return cycle.salaryChanged || cycle.requirementsChanged ||
    cycle.automated === false || !standardLifecycle
}

function metric(
  input: EvidencedMetric,
  label: string,
  unit = true,
): EvidencedMetric {
  assertObservation(input, label)
  if (input.state !== 'observed') {
    return { state: input.state, value: null, evidenceIds: [] }
  }
  const value = unit
    ? unitInterval(input.value as number, label)
    : nonNegative(input.value as number, label)
  return {
    state: 'observed',
    value,
    evidenceIds: requiredIds(input.evidenceIds, `${label} evidence`),
  }
}

function flag(input: EvidencedFlag, label: string): EvidencedFlag {
  assertObservation(input, label)
  if (input.state !== 'observed') {
    return { state: input.state, value: null, evidenceIds: [] }
  }
  return {
    state: 'observed',
    value: input.value as boolean,
    evidenceIds: requiredIds(input.evidenceIds, `${label} evidence`),
  }
}

function repostObservation(input: EvidencedRepostCycles): EvidencedRepostCycles {
  assertObservation(input, 'repost cycles')
  if (input.state !== 'observed') {
    return { state: input.state, value: null, evidenceIds: [] }
  }
  return {
    state: 'observed',
    evidenceIds: requiredIds(input.evidenceIds, 'repost observation evidence'),
    value: (input.value as HiringFrictionRepostCycle[]).map((cycle) => ({
      intervalDays: nonNegative(cycle.intervalDays, 'repost interval'),
      automated: cycle.automated,
      salaryChanged: cycle.salaryChanged,
      requirementsChanged: cycle.requirementsChanged,
      evidenceIds: requiredIds(cycle.evidenceIds, 'repost evidence'),
    })),
  }
}

function assertObservation(
  input: { state: ObservationState; value: unknown; evidenceIds: string[] },
  label: string,
): void {
  const observed = input.state === 'observed'
  if (observed && input.value === null) {
    throw new Error(`${label} observed value is required`)
  }
  if (!observed && input.value !== null) {
    throw new Error(`${label} unavailable value must be null`)
  }
  if (!observed && input.evidenceIds.length > 0) {
    throw new Error(`${label} unavailable evidence must be empty`)
  }
}

function reason(code: string, evidenceIds: readonly string[]): HiringFrictionReason {
  return { code, evidenceIds: requiredIds(evidenceIds, `${code} evidence`) }
}

function sortReasons(reasons: readonly HiringFrictionReason[]): HiringFrictionReason[] {
  return [...reasons].sort((left, right) => left.code.localeCompare(right.code, 'en'))
}

function requiredIds(values: readonly string[], label: string): string[] {
  const ids = uniqueIds(values)
  if (ids.length === 0) throw new Error(`${label} is required`)
  return ids
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error('evidence id must be positive')
    return value
  }))].sort(compareIds)
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function contribution(value: number | null, weight: number): number {
  return value === null ? 0 : value * weight
}

function unitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`)
  }
  return value
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative`)
  }
  return value
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}
