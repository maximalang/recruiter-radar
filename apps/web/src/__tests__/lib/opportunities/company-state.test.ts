import {
  buildCompanyStateSnapshot,
  type CompanyStateEventInput,
} from '@/lib/opportunities/company-state'

const SNAPSHOT_AT = new Date('2026-08-04T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function event(
  id: number,
  ageDays: number,
  overrides: Partial<CompanyStateEventInput> = {},
): CompanyStateEventInput {
  const occurredAt = new Date(
    SNAPSHOT_AT.getTime() - ageDays * DAY_MS,
  ).toISOString()
  return {
    id: String(id),
    organizationId: '10',
    eventType: 'job_posting',
    occurredAt,
    firstSeenAt: occurredAt,
    lastSeenAt: occurredAt,
    eventFingerprint: id.toString(16).padStart(64, '0'),
    evidenceIds: [String(1000 + id)],
    confidence: 0.9,
    payload: {
      title: `Backend engineer ${id}`,
      region: 'Moscow',
      matchKey: `match-${id}`,
    },
    ...overrides,
  }
}

function historicalPeriods(
  countPerPeriod: number,
  options: { region?: string; startId?: number } = {},
): CompanyStateEventInput[] {
  const records: CompanyStateEventInput[] = []
  let id = options.startId ?? 100
  for (let period = 0; period < 6; period += 1) {
    for (let index = 0; index < countPerPeriod; index += 1) {
      records.push(event(id, 16 + period * 14 + index * 2, {
        payload: {
          title: `Backend engineer ${id}`,
          region: options.region ?? 'Moscow',
          matchKey: `match-${id}`,
        },
      }))
      id += 1
    }
  }
  return records
}

describe('Company State v1', () => {
  it('does not classify four ordinary vacancies as acceleration for a company whose own baseline is four', () => {
    const current = [1, 3, 5, 7].map((age, index) => event(index + 1, age))
    const result = buildCompanyStateSnapshot(
      [...historicalPeriods(4), ...current],
      { organizationId: '10', snapshotAt: SNAPSHOT_AT },
    )

    expect(result.snapshot).not.toBeNull()
    expect(result.snapshot?.hiringBaseline.vacancies14d).toBe(4)
    expect(result.snapshot?.currentHiringVelocity.vacancies14d).toBe(4)
    expect(result.snapshot?.stateClassification).toBe('steady')
    expect(result.changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ changeType: 'hiring_acceleration' }),
    ]))
  })

  it('detects a company-specific acceleration when four vacancies strongly exceed a low baseline', () => {
    const current = [1, 3, 5, 7].map((age, index) => event(index + 1, age))
    const result = buildCompanyStateSnapshot(
      [...historicalPeriods(1), ...current],
      { organizationId: '10', snapshotAt: SNAPSHOT_AT },
    )

    expect(result.snapshot?.hiringBaseline.vacancies14d).toBe(1)
    expect(result.snapshot?.currentHiringVelocity.vacancies14d).toBe(4)
    expect(result.snapshot?.currentHiringVelocity.baselineDeviation14d).toBe(3)
    expect(result.snapshot?.stateClassification).toBe('accelerating')
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeType: 'hiring_acceleration',
        direction: 'up',
        baselineDeviation: 3,
      }),
    ]))
  })

  it('uses a cautious low-confidence fallback when history is insufficient', () => {
    const result = buildCompanyStateSnapshot(
      [1, 3, 5, 7].map((age, index) => event(index + 1, age)),
      { organizationId: '10', snapshotAt: SNAPSHOT_AT },
    )

    expect(result.snapshot?.hiringBaseline.sufficientHistory).toBe(false)
    expect(result.snapshot?.hiringBaseline.fallbackReason).toBe(
      'insufficient_history',
    )
    expect(result.snapshot?.stateClassification).toBe('insufficient_history')
    expect(result.snapshot?.stateConfidence).toBeLessThanOrEqual(0.35)
    expect(result.changes).toHaveLength(0)
  })

  it('identifies a new region only relative to the company history', () => {
    const current = [
      event(1, 2, { payload: { title: 'Backend engineer', region: 'Kazan' } }),
      event(2, 5, { payload: { title: 'QA engineer', region: 'Kazan' } }),
      event(3, 7, { payload: { title: 'Data analyst', region: 'Moscow' } }),
    ]
    const result = buildCompanyStateSnapshot(
      [...historicalPeriods(1, { region: 'moscow' }), ...current],
      { organizationId: '10', snapshotAt: SNAPSHOT_AT },
    )

    expect(result.snapshot?.regionDistribution.newRegions).toEqual(['Kazan'])
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeType: 'new_region',
        direction: 'new',
        dimension: 'Kazan',
      }),
    ]))
  })

  it('is deterministic, idempotent, tenant-scoped, and evidence-required', () => {
    const valid = [...historicalPeriods(1), event(1, 2)]
    const invalid: CompanyStateEventInput[] = [
      event(900, 3, { organizationId: '99' }),
      event(901, 3, { evidenceIds: [] }),
      event(902, -1),
    ]
    const first = buildCompanyStateSnapshot(
      [...valid, valid[0], ...invalid],
      { organizationId: '10', snapshotAt: SNAPSHOT_AT },
    )
    const second = buildCompanyStateSnapshot(
      [...invalid.reverse(), ...valid.reverse()],
      { organizationId: '10', snapshotAt: SNAPSHOT_AT },
    )

    expect(first.snapshot).toEqual(second.snapshot)
    expect(first.changes).toEqual(second.changes)
    expect(first.snapshot?.eventIds).toHaveLength(valid.length)
    expect(first.snapshot?.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.snapshot?.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.rejections.map((item) => item.reasonCode).sort()).toEqual([
      'COMPANY_STATE_EVENT_FUTURE',
      'COMPANY_STATE_EVIDENCE_MISSING',
      'COMPANY_STATE_ORGANIZATION_MISMATCH',
    ])
  })

  it('does not infer high source confidence when event confidence is unavailable', () => {
    const records = [...historicalPeriods(1), event(1, 2)]
      .map((item) => ({ ...item, confidence: null }))
    const result = buildCompanyStateSnapshot(records, {
      organizationId: '10',
      snapshotAt: SNAPSHOT_AT,
    })

    expect(result.snapshot?.hiringBaseline.sufficientHistory).toBe(true)
    expect(result.snapshot?.stateConfidence).toBeLessThanOrEqual(0.5)
  })

  it('rejects observations learned after the requested as-of timestamp', () => {
    const result = buildCompanyStateSnapshot([
      event(1, 2, {
        lastSeenAt: new Date(
          SNAPSHOT_AT.getTime() + DAY_MS,
        ).toISOString(),
      }),
    ], {
      organizationId: '10',
      snapshotAt: SNAPSHOT_AT,
    })

    expect(result.snapshot).toBeNull()
    expect(result.rejections).toEqual([{
      eventIds: ['1'],
      reasonCode: 'COMPANY_STATE_EVENT_FUTURE',
    }])
  })

  it('changes the input hash when same-day event evidence advances', () => {
    const original = event(1, 2)
    const advanced = {
      ...original,
      evidenceIds: [...original.evidenceIds, '2001'],
      lastSeenAt: new Date(
        SNAPSHOT_AT.getTime() - 60 * 60 * 1000,
      ).toISOString(),
    }
    const first = buildCompanyStateSnapshot([original], {
      organizationId: '10',
      snapshotAt: SNAPSHOT_AT,
    })
    const second = buildCompanyStateSnapshot([advanced], {
      organizationId: '10',
      snapshotAt: SNAPSHOT_AT,
    })

    expect(second.snapshot?.inputHash).not.toBe(first.snapshot?.inputHash)
    expect(second.snapshot?.evidenceHash).not.toBe(first.snapshot?.evidenceHash)
  })

  it('classifies Russian seniority and recruiting-capacity titles', () => {
    const result = buildCompanyStateSnapshot([
      ...historicalPeriods(1),
      event(1, 2, {
        payload: {
          title: 'Ведущий рекрутер',
          region: 'Moscow',
          matchKey: 'russian-recruiter',
        },
      }),
    ], {
      organizationId: '10',
      snapshotAt: SNAPSHOT_AT,
    })

    expect(result.snapshot?.seniorityDistribution.current.senior).toBe(1)
    expect(result.snapshot?.recruitingCapacitySignals.currentRecruiterVacancies)
      .toBe(1)
  })
})
