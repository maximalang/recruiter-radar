import {
  reconcileVacancyLifecycle,
  type VacancyLifecycleState,
} from '@/lib/opportunities/canonical-vacancy-lifecycle'

const firstSeen = new Date('2026-01-01T00:00:00.000Z')

function activeState(
  overrides: Partial<VacancyLifecycleState> = {},
): VacancyLifecycleState {
  return {
    status: 'active',
    firstSeenAt: firstSeen.toISOString(),
    lastSeenAt: firstSeen.toISOString(),
    lastSourceSeenAt: firstSeen.toISOString(),
    closedAt: null,
    reopenedAt: null,
    reopenedCount: 0,
    successfulAbsenceObservationIds: [],
    ...overrides,
  }
}

test('opens a newly observed canonical vacancy', () => {
  const result = reconcileVacancyLifecycle(null, {
    observedAt: firstSeen,
    present: true,
    successfulObservationIds: [101],
  })

  expect(result.state).toEqual(activeState())
  expect(result.event).toBe('opened')
})

test('keeps a vacancy active after TTL until two distinct successful absences', () => {
  const afterFirst = reconcileVacancyLifecycle(activeState(), {
    observedAt: new Date('2026-01-20T00:00:00.000Z'),
    present: false,
    successfulObservationIds: [201],
    ttlDays: 14,
    minimumSuccessfulAbsences: 2,
  })
  expect(afterFirst.state.status).toBe('active')
  expect(afterFirst.event).toBeNull()

  const rerun = reconcileVacancyLifecycle(afterFirst.state, {
    observedAt: new Date('2026-01-20T01:00:00.000Z'),
    present: false,
    successfulObservationIds: [201],
    ttlDays: 14,
    minimumSuccessfulAbsences: 2,
  })
  expect(rerun.state.status).toBe('active')
  expect(rerun.state.successfulAbsenceObservationIds).toEqual([201])

  const closed = reconcileVacancyLifecycle(rerun.state, {
    observedAt: new Date('2026-01-21T00:00:00.000Z'),
    present: false,
    successfulObservationIds: [201, 202],
    ttlDays: 14,
    minimumSuccessfulAbsences: 2,
  })
  expect(closed.state.status).toBe('closed')
  expect(closed.state.closedAt).toBe('2026-01-21T00:00:00.000Z')
  expect(closed.event).toBe('closed')
})

test('does not treat failed or rate-limited crawls as absence evidence', () => {
  const result = reconcileVacancyLifecycle(activeState(), {
    observedAt: new Date('2026-02-01T00:00:00.000Z'),
    present: false,
    successfulObservationIds: [],
  })

  expect(result.state).toEqual(activeState())
  expect(result.event).toBeNull()
})

test('reopens only after a persisted closed state and preserves history', () => {
  const previous = activeState({
    status: 'closed',
    closedAt: '2026-01-21T00:00:00.000Z',
    successfulAbsenceObservationIds: [201, 202],
  })
  const result = reconcileVacancyLifecycle(previous, {
    observedAt: new Date('2026-02-05T00:00:00.000Z'),
    present: true,
    successfulObservationIds: [301],
  })

  expect(result.state).toMatchObject({
    status: 'active',
    firstSeenAt: firstSeen.toISOString(),
    lastSeenAt: '2026-02-05T00:00:00.000Z',
    reopenedAt: '2026-02-05T00:00:00.000Z',
    reopenedCount: 1,
    successfulAbsenceObservationIds: [],
  })
  expect(result.event).toBe('reopened')
})
