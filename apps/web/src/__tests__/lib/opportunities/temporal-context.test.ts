import {
  summarizeOpportunityTemporalContext,
  temporalContextFromMetadata,
} from '@/lib/opportunities/temporal-context'

test('summarizes lifecycle-backed vacancy change and labels non-hiring events context-only', () => {
  const context = summarizeOpportunityTemporalContext([
    {
      id: '11', subjectType: 'vacancies', eventType: 'hiring_acceleration',
      occurredAt: '2026-01-15T00:00:00.000Z', windowDays: 14,
      delta: { previous: 12, current: 27, change: 15 }, evidenceIds: ['101'],
    },
    {
      id: '12', subjectType: 'government_procurement', eventType: 'new_contract',
      occurredAt: '2026-01-14T00:00:00.000Z', windowDays: 30,
      delta: { change: 1 }, evidenceIds: ['102'],
    },
  ])

  expect(context.strongestAcceleration).toEqual({
    windowDays: 14, previous: 12, current: 27, change: 15,
  })
  expect(context.events[0]?.basis).toBe('hiring-evidence')
  expect(context.events[1]?.basis).toBe('context-only')
})

test('rejects malformed stored acceleration instead of coercing it into scoring', () => {
  const context = temporalContextFromMetadata({
    temporalContext: {
      strongestAcceleration: {
        windowDays: 'soon', previous: 1, current: 100, change: 'huge',
      },
    },
  })
  expect(context.strongestAcceleration).toBeNull()
})
