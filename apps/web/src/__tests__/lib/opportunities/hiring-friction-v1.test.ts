import {
  buildHiringFriction,
  type HiringFrictionInput,
  type ObservationState,
} from '@/lib/opportunities/hiring-friction-v1'

function observed<T>(value: T, evidenceIds = ['101']) {
  return { state: 'observed' as const, value, evidenceIds }
}

function unavailable<T>(state: Exclude<ObservationState, 'observed'> = 'unknown') {
  return { state, value: null as T | null, evidenceIds: [] }
}

function input(
  overrides: Partial<HiringFrictionInput> = {},
): HiringFrictionInput {
  return {
    vacancyAgeDays: observed(20),
    repostCycles: observed([]),
    repostRate: unavailable(),
    salaryChange: observed(0),
    requirementsChange: observed(0),
    closeReopenCycles: observed(0),
    roleScarcity: unavailable(),
    seniorityComplexity: observed(0.2),
    multiRoleComplexity: observed(0),
    regionalDifficulty: unavailable(),
    internalRecruitingCapacity: unavailable(),
    hiringVelocityVsCapacity: unavailable(),
    observedVacancyLifetime: unavailable(),
    evergreenRole: observed(false),
    massHiring: observed(false),
    ...overrides,
  }
}

describe('Hiring Friction Index v1', () => {
  it('does not treat one normal 30-day automatic HH republication as failed hiring', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: observed(31),
      repostCycles: observed([{
        intervalDays: 30,
        automated: true,
        salaryChanged: false,
        requirementsChanged: false,
        evidenceIds: ['101', '102'],
      }]),
    }))

    expect(result.frictionLevel).toBe('low')
    expect(result.frictionScore).toBeLessThan(0.25)
    expect(result.positiveReasons.map((reason) => reason.code))
      .not.toContain('MEANINGFUL_REPOST_CYCLES')
    expect(result.negativeReasons.map((reason) => reason.code))
      .toContain('STANDARD_HH_REPUBLICATION')
  })

  it('raises friction for repeated meaningful cycles plus salary and requirements changes', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: observed(96, ['101', '102', '103']),
      repostCycles: observed([
        {
          intervalDays: 44,
          automated: false,
          salaryChanged: true,
          requirementsChanged: false,
          evidenceIds: ['101', '102'],
        },
        {
          intervalDays: 39,
          automated: false,
          salaryChanged: false,
          requirementsChanged: true,
          evidenceIds: ['102', '103'],
        },
      ]),
      salaryChange: observed(1, ['102']),
      requirementsChange: observed(1, ['103']),
      closeReopenCycles: observed(0.5, ['102', '103']),
      roleScarcity: observed(0.8, ['104']),
      seniorityComplexity: observed(0.9),
      hiringVelocityVsCapacity: observed(0.8, ['105']),
      observedVacancyLifetime: observed(0.75, ['106']),
    }))

    expect(result.frictionLevel).toBe('high')
    expect(result.frictionScore).toBeGreaterThanOrEqual(0.68)
    expect(result.positiveReasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        'MEANINGFUL_REPOST_CYCLES',
        'SALARY_CHANGED',
        'REQUIREMENTS_CHANGED',
        'PERSISTENT_DEMAND_COMBINATION',
      ]),
    )
    expect(result.evidenceIds).toEqual([
      '101', '102', '103', '104', '105', '106',
    ])
  })

  it('keeps evergreen vacancies out of hard-to-fill even when old', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: observed(180),
      repostCycles: observed([{
        intervalDays: 30,
        automated: true,
        salaryChanged: false,
        requirementsChanged: false,
        evidenceIds: ['101', '102'],
      }]),
      evergreenRole: observed(true, ['103']),
    }))

    expect(result.frictionLevel).toBe('low')
    expect(result.frictionScore).toBeLessThan(0.25)
    expect(result.negativeReasons.map((reason) => reason.code))
      .toContain('EVERGREEN_ROLE')
  })

  it('classifies mass hiring separately instead of calling volume friction', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: observed(70),
      multiRoleComplexity: observed(1, ['102']),
      hiringVelocityVsCapacity: observed(0.9, ['103']),
      massHiring: observed(true, ['104']),
    }))

    expect(result.frictionLevel).not.toBe('high')
    expect(result.negativeReasons.map((reason) => reason.code))
      .toContain('MASS_HIRING_SEPARATE_ARCHETYPE')
  })

  it('returns unknown rather than a positive score when critical observations are absent', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: unavailable(),
      repostCycles: unavailable(),
      salaryChange: unavailable(),
      requirementsChange: unavailable(),
      closeReopenCycles: unavailable(),
      seniorityComplexity: unavailable(),
      evergreenRole: unavailable(),
      massHiring: unavailable(),
    }))

    expect(result.frictionLevel).toBe('unknown')
    expect(result.frictionScore).toBe(0)
    expect(result.coverage).toBeLessThan(0.25)
    expect(result.observationStates.repost_cycles).toBe('unknown')
  })

  it('counts an observed empty repost history but not an unavailable history', () => {
    const unknown = buildHiringFriction(input({
      vacancyAgeDays: unavailable(),
      repostCycles: unavailable(),
      salaryChange: unavailable(),
      requirementsChange: unavailable(),
      closeReopenCycles: unavailable(),
      roleScarcity: unavailable(),
      seniorityComplexity: unavailable(),
      multiRoleComplexity: unavailable(),
      regionalDifficulty: unavailable(),
      internalRecruitingCapacity: unavailable(),
      hiringVelocityVsCapacity: unavailable(),
      observedVacancyLifetime: unavailable(),
      evergreenRole: unavailable(),
      massHiring: unavailable(),
    }))
    const observedEmpty = buildHiringFriction(input({
      vacancyAgeDays: unavailable(),
      repostCycles: observed([], ['101']),
      salaryChange: unavailable(),
      requirementsChange: unavailable(),
      closeReopenCycles: unavailable(),
      roleScarcity: unavailable(),
      seniorityComplexity: unavailable(),
      multiRoleComplexity: unavailable(),
      regionalDifficulty: unavailable(),
      internalRecruitingCapacity: unavailable(),
      hiringVelocityVsCapacity: unavailable(),
      observedVacancyLifetime: unavailable(),
      evergreenRole: unavailable(),
      massHiring: unavailable(),
    }))

    expect(unknown.coverage).toBe(0)
    expect(observedEmpty.coverage).toBeGreaterThan(0)
    expect(observedEmpty.componentValues.repost_cycles).toBe(0)
    expect(observedEmpty.observationStates.repost_cycles).toBe('observed')
  })

  it('keeps observed zero and false distinct from unknown', () => {
    const result = buildHiringFriction(input({
      salaryChange: observed(0, ['102']),
      evergreenRole: observed(false, ['103']),
    }))

    expect(result.componentValues.salary_change).toBe(0)
    expect(result.observationStates.salary_change).toBe('observed')
    expect(result.observationStates.evergreen_role).toBe('observed')
  })
})
