import {
  buildHiringFriction,
  type HiringFrictionInput,
} from '@/lib/opportunities/hiring-friction-v1'

function input(
  overrides: Partial<HiringFrictionInput> = {},
): HiringFrictionInput {
  return {
    vacancyAgeDays: { value: 20, evidenceIds: ['101'] },
    repostCycles: [],
    salaryChange: { value: 0, evidenceIds: ['101'] },
    requirementsChange: { value: 0, evidenceIds: ['101'] },
    closeReopenCycles: { value: 0, evidenceIds: ['101'] },
    roleScarcity: { value: null, evidenceIds: [] },
    seniorityComplexity: { value: 0.2, evidenceIds: ['101'] },
    multiRoleComplexity: { value: 0, evidenceIds: ['101'] },
    regionalDifficulty: { value: null, evidenceIds: [] },
    internalRecruitingCapacity: { value: null, evidenceIds: [] },
    hiringVelocityVsCapacity: { value: null, evidenceIds: [] },
    timeToFillHistory: { value: null, evidenceIds: [] },
    evergreenRole: { value: false, evidenceIds: ['101'] },
    massHiring: { value: false, evidenceIds: ['101'] },
    ...overrides,
  }
}

describe('Hiring Friction Index v1', () => {
  it('does not treat one normal 30-day automatic HH republication as failed hiring', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: { value: 31, evidenceIds: ['101'] },
      repostCycles: [{
        intervalDays: 30,
        automated: true,
        salaryChanged: false,
        requirementsChanged: false,
        evidenceIds: ['101', '102'],
      }],
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
      vacancyAgeDays: { value: 96, evidenceIds: ['101', '102', '103'] },
      repostCycles: [
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
      ],
      salaryChange: { value: 1, evidenceIds: ['102'] },
      requirementsChange: { value: 1, evidenceIds: ['103'] },
      closeReopenCycles: { value: 0.5, evidenceIds: ['102', '103'] },
      roleScarcity: { value: 0.8, evidenceIds: ['104'] },
      seniorityComplexity: { value: 0.9, evidenceIds: ['101'] },
      hiringVelocityVsCapacity: { value: 0.8, evidenceIds: ['105'] },
      timeToFillHistory: { value: 0.75, evidenceIds: ['106'] },
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
      vacancyAgeDays: { value: 180, evidenceIds: ['101'] },
      repostCycles: [{
        intervalDays: 30,
        automated: true,
        salaryChanged: false,
        requirementsChanged: false,
        evidenceIds: ['101', '102'],
      }],
      evergreenRole: { value: true, evidenceIds: ['103'] },
    }))

    expect(result.frictionLevel).toBe('low')
    expect(result.frictionScore).toBeLessThan(0.25)
    expect(result.negativeReasons.map((reason) => reason.code))
      .toContain('EVERGREEN_ROLE')
  })

  it('classifies mass hiring separately instead of calling volume friction', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: { value: 70, evidenceIds: ['101'] },
      multiRoleComplexity: { value: 1, evidenceIds: ['102'] },
      hiringVelocityVsCapacity: { value: 0.9, evidenceIds: ['103'] },
      massHiring: { value: true, evidenceIds: ['104'] },
    }))

    expect(result.frictionLevel).not.toBe('high')
    expect(result.negativeReasons.map((reason) => reason.code))
      .toContain('MASS_HIRING_SEPARATE_ARCHETYPE')
  })

  it('returns unknown rather than a positive score when critical observations are absent', () => {
    const result = buildHiringFriction(input({
      vacancyAgeDays: { value: null, evidenceIds: [] },
      salaryChange: { value: null, evidenceIds: [] },
      requirementsChange: { value: null, evidenceIds: [] },
      closeReopenCycles: { value: null, evidenceIds: [] },
      seniorityComplexity: { value: null, evidenceIds: [] },
      evergreenRole: { value: null, evidenceIds: [] },
      massHiring: { value: null, evidenceIds: [] },
    }))

    expect(result.frictionLevel).toBe('unknown')
    expect(result.frictionScore).toBe(0)
    expect(result.coverage).toBeLessThan(0.25)
  })
})
