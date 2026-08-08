import {
  buildHiringProblemArchetypes,
  type HiringProblemArchetypeInput,
  type HiringProblemSignal,
} from '@/lib/opportunities/hiring-problem-archetypes-v1'

function signal<T>(
  value: T,
  eventId: string,
  evidenceId: string,
): HiringProblemSignal<T> {
  return { value, eventIds: [eventId], evidenceIds: [evidenceId] }
}

function input(
  overrides: Partial<HiringProblemArchetypeInput> = {},
): HiringProblemArchetypeInput {
  return {
    friction: {
      level: 'low',
      score: 0.15,
      evidenceIds: ['101'],
    },
    hiringAcceleration: signal<number | null>(null, '201', '101'),
    growthVsBaseline: signal<number | null>(null, '202', '102'),
    repeatedRoleShare: signal<number | null>(null, '203', '103'),
    meaningfulRepostCycles: signal<number | null>(null, '204', '104'),
    roleComplexity: signal<number | null>(null, '205', '105'),
    salaryOrRequirementsChanged: signal<boolean | null>(null, '206', '106'),
    newUnit: signal<boolean | null>(null, '207', '107'),
    newRegion: signal<boolean | null>(null, '208', '108'),
    leadershipChange: signal<boolean | null>(null, '209', '109'),
    recruiterVacancy: signal<boolean | null>(null, '210', '110'),
    massHiring: signal<boolean | null>(false, '211', '111'),
    evergreen: signal<boolean | null>(false, '212', '112'),
    reactivation: signal<boolean | null>(false, '213', '113'),
    freezeOrSlowdown: signal<boolean | null>(false, '214', '114'),
    ...overrides,
  }
}

describe('Hiring Problem Archetype Engine v1', () => {
  it('does not interpret hiring acceleration without a cause as expansion', () => {
    const result = buildHiringProblemArchetypes(input({
      hiringAcceleration: signal(0.9, '201', '101'),
    }))

    expect(result.map((item) => item.archetype)).toEqual(['unknown'])
    expect(result[0]?.reasonCodes).toContain('ACCELERATION_CAUSE_UNKNOWN')
  })

  it('separates replacement turnover from evidenced growth', () => {
    const turnover = buildHiringProblemArchetypes(input({
      repeatedRoleShare: signal(0.9, '203', '103'),
      growthVsBaseline: signal(0.1, '202', '102'),
    }))
    const expansion = buildHiringProblemArchetypes(input({
      hiringAcceleration: signal(0.85, '201', '101'),
      growthVsBaseline: signal(0.8, '202', '102'),
      newUnit: signal(true, '207', '107'),
      repeatedRoleShare: signal(0.1, '203', '103'),
    }))

    expect(turnover.map((item) => item.archetype))
      .toContain('replacement_turnover')
    expect(turnover.map((item) => item.archetype)).not.toContain('expansion')
    expect(expansion.map((item) => item.archetype)).toEqual(
      expect.arrayContaining(['expansion', 'new_unit_buildout']),
    )
    expect(expansion.map((item) => item.archetype))
      .not.toContain('replacement_turnover')
  })

  it('keeps evergreen hiring separate from hard-to-fill despite age-like friction', () => {
    const result = buildHiringProblemArchetypes(input({
      friction: {
        level: 'medium',
        score: 0.55,
        evidenceIds: ['101', '102'],
      },
      evergreen: signal(true, '212', '112'),
      meaningfulRepostCycles: signal(5, '204', '104'),
    }))

    expect(result.map((item) => item.archetype)).toContain('evergreen_hiring')
    expect(result.map((item) => item.archetype)).not.toContain('hard_to_fill')
  })

  it('requires direct capacity evidence for recruiting capacity gap', () => {
    const accelerationOnly = buildHiringProblemArchetypes(input({
      hiringAcceleration: signal(0.95, '201', '101'),
    }))
    const evidencedGap = buildHiringProblemArchetypes(input({
      hiringAcceleration: signal(0.95, '201', '101'),
      recruiterVacancy: signal(true, '210', '110'),
    }))

    expect(accelerationOnly.map((item) => item.archetype))
      .not.toContain('recruiting_capacity_gap')
    const gap = evidencedGap.find((item) =>
      item.archetype === 'recruiting_capacity_gap')
    expect(gap).toMatchObject({
      supportingEventIds: ['201', '210'],
      evidenceIds: ['101', '110'],
    })
  })

  it('classifies hard-to-fill only from a multi-factor friction pattern', () => {
    const result = buildHiringProblemArchetypes(input({
      friction: {
        level: 'high',
        score: 0.82,
        evidenceIds: ['101', '102'],
      },
      meaningfulRepostCycles: signal(3, '204', '104'),
      roleComplexity: signal(0.85, '205', '105'),
      salaryOrRequirementsChanged: signal(true, '206', '106'),
    }))

    const hardToFill = result.find((item) => item.archetype === 'hard_to_fill')
    expect(hardToFill?.confidence).toBeGreaterThanOrEqual(0.75)
    expect(hardToFill?.reasonCodes).toEqual(expect.arrayContaining([
      'HIGH_HIRING_FRICTION',
      'MULTIPLE_MEANINGFUL_REPOSTS',
      'ROLE_REQUIREMENTS_CHANGED',
      'COMPLEX_ROLE',
    ]))
  })

  it('lets an evidenced freeze override positive archetypes', () => {
    const result = buildHiringProblemArchetypes(input({
      hiringAcceleration: signal(0.9, '201', '101'),
      growthVsBaseline: signal(0.9, '202', '102'),
      newRegion: signal(true, '208', '108'),
      freezeOrSlowdown: signal(true, '214', '114'),
    }))

    expect(result.map((item) => item.archetype)).toEqual(['freeze_or_slowdown'])
    expect(result[0]).toMatchObject({
      supportingEventIds: ['214'],
      contradictingEventIds: ['201', '202', '208'],
      evidenceIds: ['101', '102', '108', '114'],
    })
  })
})
