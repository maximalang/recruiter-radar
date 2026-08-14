export interface OpportunityTemporalEvent {
  id: string
  subjectType: string
  eventType: string
  occurredAt: string
  windowDays: number | null
  delta: Record<string, unknown>
  evidenceIds: string[]
  basis: 'hiring-evidence' | 'context-only'
}

export interface OpportunityTemporalContext {
  events: OpportunityTemporalEvent[]
  activeVacancyCount: number | null
  vacancyDeltas: Partial<Record<'7' | '14' | '30', number>>
  strongestAcceleration: {
    windowDays: number
    previous: number
    current: number
    change: number
  } | null
  newlyOpenedRoles: string[]
  closedRoles: string[]
  reopenedRoles: string[]
  evidenceIds: string[]
}

export function summarizeOpportunityTemporalContext(
  value: unknown,
): OpportunityTemporalContext {
  const events = parseTemporalEvents(value)
  const vacancyDeltas: OpportunityTemporalContext['vacancyDeltas'] = {}
  let activeVacancyCount: number | null = null
  let strongestAcceleration: OpportunityTemporalContext['strongestAcceleration'] = null
  const newlyOpenedRoles: string[] = []
  const closedRoles: string[] = []
  const reopenedRoles: string[] = []

  for (const event of events) {
    if (event.subjectType !== 'vacancies') continue
    const windowDays = event.windowDays
    const change = finiteNumber(event.delta.change)
    const current = finiteNumber(event.delta.current)
    const previous = finiteNumber(event.delta.previous)
    if (
      event.eventType === 'vacancy_count_change' &&
      (windowDays === 7 || windowDays === 14 || windowDays === 30) &&
      change !== null
    ) {
      vacancyDeltas[String(windowDays) as '7' | '14' | '30'] = change
      if (current !== null) activeVacancyCount = current
    }
    if (
      event.eventType === 'hiring_acceleration' && windowDays !== null &&
      previous !== null && current !== null && change !== null &&
      (!strongestAcceleration || change > strongestAcceleration.change)
    ) {
      strongestAcceleration = { windowDays, previous, current, change }
      activeVacancyCount = current
    }
    const role = text(event.delta.role)
    if (!role) continue
    if (event.eventType === 'role_newly_opened') newlyOpenedRoles.push(role)
    if (event.eventType === 'role_closed') closedRoles.push(role)
    if (event.eventType === 'role_reopened') reopenedRoles.push(role)
  }

  return {
    events,
    activeVacancyCount,
    vacancyDeltas,
    strongestAcceleration,
    newlyOpenedRoles: unique(newlyOpenedRoles),
    closedRoles: unique(closedRoles),
    reopenedRoles: unique(reopenedRoles),
    evidenceIds: unique(events.flatMap((event) => event.evidenceIds)),
  }
}

export function temporalContextFromMetadata(
  metadata: Record<string, unknown>,
): OpportunityTemporalContext {
  const value = metadata.temporalContext
  if (!value || typeof value !== 'object') {
    return summarizeOpportunityTemporalContext([])
  }
  const stored = value as Partial<OpportunityTemporalContext>
  return {
    events: parseTemporalEvents(stored.events),
    activeVacancyCount: finiteNumber(stored.activeVacancyCount),
    vacancyDeltas: parseVacancyDeltas(stored.vacancyDeltas),
    strongestAcceleration: parseAcceleration(stored.strongestAcceleration),
    newlyOpenedRoles: strings(stored.newlyOpenedRoles),
    closedRoles: strings(stored.closedRoles),
    reopenedRoles: strings(stored.reopenedRoles),
    evidenceIds: strings(stored.evidenceIds),
  }
}

function parseTemporalEvents(value: unknown): OpportunityTemporalEvent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): OpportunityTemporalEvent[] => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const id = text(item.id)
    const subjectType = text(item.subjectType)
    const eventType = text(item.eventType)
    const occurredAt = text(item.occurredAt)
    if (!id || !subjectType || !eventType || !Number.isFinite(Date.parse(occurredAt))) {
      return []
    }
    const windowDays = finiteNumber(item.windowDays)
    return [{
      id,
      subjectType,
      eventType,
      occurredAt,
      windowDays: windowDays === null ? null : Math.trunc(windowDays),
      delta: item.delta && typeof item.delta === 'object'
        ? item.delta as Record<string, unknown>
        : {},
      evidenceIds: strings(item.evidenceIds),
      basis: subjectType === 'vacancies' ? 'hiring-evidence' : 'context-only',
    }]
  }).sort((left, right) =>
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    right.id.localeCompare(left.id))
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function parseVacancyDeltas(
  value: unknown,
): OpportunityTemporalContext['vacancyDeltas'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const result: OpportunityTemporalContext['vacancyDeltas'] = {}
  for (const window of ['7', '14', '30'] as const) {
    const delta = finiteNumber(record[window])
    if (delta !== null) result[window] = delta
  }
  return result
}

function parseAcceleration(
  value: unknown,
): OpportunityTemporalContext['strongestAcceleration'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const windowDays = finiteNumber(record.windowDays)
  const previous = finiteNumber(record.previous)
  const current = finiteNumber(record.current)
  const change = finiteNumber(record.change)
  if (
    windowDays === null || previous === null || current === null || change === null ||
    ![7, 14, 30].includes(windowDays)
  ) return null
  return { windowDays, previous, current, change }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map(text).filter(Boolean)) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}
