export const DEFAULT_VACANCY_TTL_DAYS = 14
export const DEFAULT_MINIMUM_SUCCESSFUL_ABSENCES = 2

export type VacancyLifecycleEventType = 'opened' | 'closed' | 'reopened'

export interface VacancyLifecycleState {
  status: 'active' | 'closed'
  firstSeenAt: string
  lastSeenAt: string
  lastSourceSeenAt: string
  closedAt: string | null
  reopenedAt: string | null
  reopenedCount: number
  successfulAbsenceObservationIds: number[]
}

export interface VacancyLifecycleObservation {
  observedAt: Date
  present: boolean
  successfulObservationIds: number[]
  ttlDays?: number
  minimumSuccessfulAbsences?: number
}

export interface VacancyLifecycleResult {
  state: VacancyLifecycleState
  event: VacancyLifecycleEventType | null
}

export function reconcileVacancyLifecycle(
  current: VacancyLifecycleState | null,
  observation: VacancyLifecycleObservation,
): VacancyLifecycleResult {
  const observedAt = observation.observedAt.toISOString()
  if (!current) {
    if (!observation.present) {
      throw new Error('A canonical vacancy cannot start with an absent observation.')
    }
    return {
      state: {
        status: 'active',
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        lastSourceSeenAt: observedAt,
        closedAt: null,
        reopenedAt: null,
        reopenedCount: 0,
        successfulAbsenceObservationIds: [],
      },
      event: 'opened',
    }
  }

  if (observation.present) {
    const reopened = current.status === 'closed'
    return {
      state: {
        ...current,
        status: 'active',
        lastSeenAt: maxTimestamp(current.lastSeenAt, observedAt),
        lastSourceSeenAt: maxTimestamp(current.lastSourceSeenAt, observedAt),
        reopenedAt: reopened ? observedAt : current.reopenedAt,
        reopenedCount: current.reopenedCount + (reopened ? 1 : 0),
        successfulAbsenceObservationIds: [],
      },
      event: reopened ? 'reopened' : null,
    }
  }

  if (current.status === 'closed') return { state: current, event: null }

  const successfulAbsenceObservationIds = uniquePositiveIntegers([
    ...current.successfulAbsenceObservationIds,
    ...observation.successfulObservationIds,
  ])
  const ttlDays = finitePositive(
    observation.ttlDays,
    DEFAULT_VACANCY_TTL_DAYS,
  )
  const minimumSuccessfulAbsences = Math.max(
    1,
    Math.trunc(finitePositive(
      observation.minimumSuccessfulAbsences,
      DEFAULT_MINIMUM_SUCCESSFUL_ABSENCES,
    )),
  )
  const ageMs = observation.observedAt.getTime() -
    Date.parse(current.lastSourceSeenAt)
  const ttlElapsed = ageMs >= ttlDays * 86_400_000
  const enoughSuccessfulAbsences =
    successfulAbsenceObservationIds.length >= minimumSuccessfulAbsences
  if (!ttlElapsed || !enoughSuccessfulAbsences) {
    return {
      state: { ...current, successfulAbsenceObservationIds },
      event: null,
    }
  }

  return {
    state: {
      ...current,
      status: 'closed',
      closedAt: observedAt,
      successfulAbsenceObservationIds,
    },
    event: 'closed',
  }
}

function uniquePositiveIntegers(values: number[]): number[] {
  return [...new Set(values
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right)
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function maxTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}
