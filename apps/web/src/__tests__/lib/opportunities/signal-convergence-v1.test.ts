import { evaluateNegativeEvidence } from '@/lib/opportunities/negative-evidence-v1'
import {
  buildSignalConvergence,
  type SignalConvergenceEvent,
} from '@/lib/opportunities/signal-convergence-v1'

const NOW = new Date('2026-08-09T12:00:00.000Z')

function event(
  overrides: Partial<SignalConvergenceEvent> = {},
): SignalConvergenceEvent {
  return {
    eventId: '201',
    type: 'leadership_change',
    strength: 0.8,
    occurredAt: '2026-06-01T12:00:00.000Z',
    evidenceIds: ['101'],
    evidenceIndependenceGroup: 'a'.repeat(64),
    ...overrides,
  }
}

describe('Signal Convergence Engine v1', () => {
  it('scores a meaningful sequence above unrelated signals with the same strengths', () => {
    const sequence = buildSignalConvergence({
      events: [
        event(),
        event({
          eventId: '202',
          type: 'new_unit',
          occurredAt: '2026-06-21T12:00:00.000Z',
          evidenceIds: ['102'],
          evidenceIndependenceGroup: 'b'.repeat(64),
        }),
        event({
          eventId: '203',
          type: 'hiring_acceleration',
          occurredAt: '2026-07-01T12:00:00.000Z',
          evidenceIds: ['103'],
          evidenceIndependenceGroup: 'c'.repeat(64),
        }),
        event({
          eventId: '204',
          type: 'senior_role_cluster',
          occurredAt: '2026-07-10T12:00:00.000Z',
          evidenceIds: ['104'],
          evidenceIndependenceGroup: 'd'.repeat(64),
        }),
      ],
      negativeEvidence: null,
      now: NOW,
    })
    const unrelated = buildSignalConvergence({
      events: [
        event({ type: 'vacancy_repost' }),
        event({
          eventId: '202',
          type: 'salary_change',
          occurredAt: '2026-06-21T12:00:00.000Z',
          evidenceIds: ['102'],
          evidenceIndependenceGroup: 'b'.repeat(64),
        }),
        event({
          eventId: '203',
          type: 'requirements_change',
          occurredAt: '2026-07-01T12:00:00.000Z',
          evidenceIds: ['103'],
          evidenceIndependenceGroup: 'c'.repeat(64),
        }),
        event({
          eventId: '204',
          type: 'role_cluster',
          occurredAt: '2026-07-10T12:00:00.000Z',
          evidenceIds: ['104'],
          evidenceIndependenceGroup: 'd'.repeat(64),
        }),
      ],
      negativeEvidence: null,
      now: NOW,
    })

    expect(sequence.components.sequence).toBeGreaterThan(0)
    expect(sequence.convergenceScore).toBeGreaterThan(unrelated.convergenceScore)
    expect(sequence.positiveReasons).toContain('EXPANSION_SEQUENCE_CONVERGENCE')
  })

  it('decays stale evidence using event-specific half-lives', () => {
    const fresh = buildSignalConvergence({
      events: [event({ occurredAt: '2026-08-08T12:00:00.000Z' })],
      negativeEvidence: null,
      now: NOW,
    })
    const stale = buildSignalConvergence({
      events: [event({ occurredAt: '2025-08-08T12:00:00.000Z' })],
      negativeEvidence: null,
      now: NOW,
    })

    expect(fresh.components.recency).toBeGreaterThan(stale.components.recency)
    expect(fresh.convergenceScore).toBeGreaterThan(stale.convergenceScore)
    expect(stale.negativeReasons).toContain('SIGNALS_STALE')
  })

  it('strengthens an episode when a new independent confirming signal arrives', () => {
    const base = buildSignalConvergence({
      events: [event({ occurredAt: '2026-08-01T12:00:00.000Z' })],
      negativeEvidence: null,
      now: NOW,
    })
    const confirmed = buildSignalConvergence({
      events: [
        event({ occurredAt: '2026-08-01T12:00:00.000Z' }),
        event({
          eventId: '202',
          type: 'new_unit',
          occurredAt: '2026-08-05T12:00:00.000Z',
          evidenceIds: ['102'],
          evidenceIndependenceGroup: 'b'.repeat(64),
        }),
      ],
      negativeEvidence: null,
      now: NOW,
    })

    expect(confirmed.independentGroupCount).toBe(2)
    expect(confirmed.convergenceScore).toBeGreaterThan(base.convergenceScore)
  })

  it('lets confirmed negative evidence lower and close a previously strong episode', () => {
    const events = [
      event({ occurredAt: '2026-08-01T12:00:00.000Z' }),
      event({
        eventId: '202',
        type: 'new_unit',
        occurredAt: '2026-08-05T12:00:00.000Z',
        evidenceIds: ['102'],
        evidenceIndependenceGroup: 'b'.repeat(64),
      }),
    ]
    const before = buildSignalConvergence({ events, negativeEvidence: null, now: NOW })
    const negativeEvidence = evaluateNegativeEvidence([{
      type: 'hiring_freeze',
      classification: 'confirmed_negative',
      sourceKind: 'official',
      severity: 1,
      eventIds: ['203'],
      evidenceIds: ['103'],
      observedAt: '2026-08-08T12:00:00.000Z',
      validUntil: '2026-09-08T12:00:00.000Z',
    }], NOW)
    const after = buildSignalConvergence({ events, negativeEvidence, now: NOW })

    expect(after.convergenceScore).toBeLessThan(before.convergenceScore)
    expect(after.status).toBe('closed')
    expect(after.negativeReasons).toContain('HIRING_FREEZE_CONFIRMED')
  })

  it('excludes future evidence from a historical decision', () => {
    const result = buildSignalConvergence({
      events: [
        event({ occurredAt: '2026-08-01T12:00:00.000Z' }),
        event({
          eventId: '202',
          type: 'new_unit',
          occurredAt: '2026-08-10T12:00:00.000Z',
          evidenceIds: ['102'],
          evidenceIndependenceGroup: 'b'.repeat(64),
        }),
      ],
      negativeEvidence: null,
      now: NOW,
    })

    expect(result.eventIds).toEqual(['201'])
    expect(result.excludedFutureEventIds).toEqual(['202'])
    expect(result.negativeReasons).toContain('FUTURE_EVENT_EXCLUDED')
  })

  it('is deterministic and independent of input order', () => {
    const first = event({ occurredAt: '2026-08-01T12:00:00.000Z' })
    const second = event({
      eventId: '202',
      type: 'new_unit',
      occurredAt: '2026-08-05T12:00:00.000Z',
      evidenceIds: ['102'],
      evidenceIndependenceGroup: 'b'.repeat(64),
    })

    expect(buildSignalConvergence({
      events: [first, second],
      negativeEvidence: null,
      now: NOW,
    })).toEqual(buildSignalConvergence({
      events: [second, first],
      negativeEvidence: null,
      now: NOW,
    }))
  })
})
