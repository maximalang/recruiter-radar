import {
  buildSignalEpisodes,
  signalEpisodeStageAt,
  type SignalEpisodeEventInput,
  type SignalEpisodeStateChangeInput,
} from '@/lib/opportunities/signal-episode'
import type { CompanyStateChangeType } from '@/lib/opportunities/company-state'

const NOW = new Date('2026-08-04T12:00:00.000Z')

function event(
  id: number,
  eventType: SignalEpisodeEventInput['eventType'] = 'job_posting',
  overrides: Partial<SignalEpisodeEventInput> = {},
): SignalEpisodeEventInput {
  return {
    id: String(id),
    organizationId: '10',
    eventType,
    occurredAt: `2026-08-${String(Math.max(1, id)).padStart(2, '0')}T08:00:00.000Z`,
    firstSeenAt: `2026-08-${String(Math.max(1, id)).padStart(2, '0')}T09:00:00.000Z`,
    lastSeenAt: `2026-08-${String(Math.max(1, id)).padStart(2, '0')}T10:00:00.000Z`,
    eventFingerprint: id.toString(16).padStart(64, '0'),
    evidenceIds: [String(100 + id)],
    confidence: 0.9,
    payload: {
      title: id % 2 === 0 ? 'Senior Backend Engineer' : 'Backend Engineer',
      region: 'Moscow',
    },
    ...overrides,
  }
}

function change(
  id: number,
  changeType: CompanyStateChangeType = 'hiring_acceleration',
  overrides: Partial<SignalEpisodeStateChangeInput> = {},
): SignalEpisodeStateChangeInput {
  const eventIds = overrides.eventIds ?? ['1', '2', '3', '4']
  return {
    id: String(id),
    snapshotId: String(500 + id),
    organizationId: '10',
    snapshotAt: '2026-08-04T00:00:00.000Z',
    changeType,
    direction: changeType === 'new_region' ? 'new' : 'up',
    dimension: changeType === 'role_mix_shift' ? 'engineering' : 'all',
    magnitude: 4,
    baselineDeviation: changeType === 'hiring_acceleration' ? 1.5 : null,
    confidence: 0.85,
    eventIds,
    evidenceIds: eventIds.map((eventId) => String(100 + Number(eventId))),
    changeFingerprint: id.toString(16).padStart(64, 'f'),
    payload: {},
    ...overrides,
  }
}

function fourVacancies() {
  return [event(1), event(2), event(3), event(4)]
}

function contextEvent(
  id: number,
  eventType: SignalEpisodeEventInput['eventType'],
): SignalEpisodeEventInput {
  return event(id, eventType, {
    occurredAt: `2026-08-0${id - 2}T08:00:00.000Z`,
    firstSeenAt: `2026-08-0${id - 2}T09:00:00.000Z`,
    lastSeenAt: `2026-08-0${id - 2}T10:00:00.000Z`,
  })
}

describe('Signal Episode v2', () => {
  it('does not turn ordinary vacancy volume into an episode without a state change', () => {
    const result = buildSignalEpisodes(
      { stateChanges: [], events: fourVacancies() },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('creates a baseline-aware acceleration episode for the same four vacancies', () => {
    const result = buildSignalEpisodes(
      { stateChanges: [change(1)], events: fourVacancies() },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]).toMatchObject({
      episodeType: 'vacancy_acceleration',
      stage: 'active',
      direction: 'up',
      baselineDeviation: 1.5,
      roleFamilies: ['backend'],
      regions: ['Moscow'],
      stateChangeIds: ['1'],
      eventIds: ['1', '2', '3', '4'],
      evidenceIds: ['101', '102', '103', '104'],
      problemHypotheses: ['delivery_capacity_pressure'],
      engineVersion: 'signal-episode-v2',
    })
    expect(result.episodes[0].intensity).toBeGreaterThan(0.5)
  })

  it('keeps a new CTO as context when hiring evidence has not changed', () => {
    const cto = event(1, 'leadership_change', {
      payload: { title: 'Chief Technology Officer', region: 'Moscow' },
    })
    const result = buildSignalEpisodes(
      { stateChanges: [], events: [cto] },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toEqual([])
  })

  it('combines a CTO change and technical acceleration into one episode', () => {
    const events = [
      ...fourVacancies(),
      event(5, 'leadership_change', {
        occurredAt: '2026-08-03T08:00:00.000Z',
        firstSeenAt: '2026-08-03T09:00:00.000Z',
        lastSeenAt: '2026-08-03T10:00:00.000Z',
        payload: { title: 'CTO', region: 'Moscow' },
      }),
    ]
    const result = buildSignalEpisodes(
      { stateChanges: [change(1)], events },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]).toMatchObject({
      episodeType: 'leadership_led_expansion',
      stateChangeIds: ['1'],
      eventIds: ['1', '2', '3', '4', '5'],
      problemHypotheses: ['leadership_mandate_delivery_gap'],
    })
  })

  it('prefers a recruiting capacity gap over a generic acceleration card', () => {
    const recruiterVacancy = event(5, 'recruiter_vacancy', {
      occurredAt: '2026-08-03T08:00:00.000Z',
      firstSeenAt: '2026-08-03T09:00:00.000Z',
      lastSeenAt: '2026-08-03T10:00:00.000Z',
      payload: { title: 'Internal Recruiter', region: 'Moscow' },
    })
    const result = buildSignalEpisodes(
      { stateChanges: [change(1)], events: [...fourVacancies(), recruiterVacancy] },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0].episodeType).toBe('recruiting_capacity_gap')
  })

  it('consolidates acceleration, role, and region changes into one situation', () => {
    const changes = [
      change(1),
      change(2, 'role_mix_shift', {
        eventIds: ['1', '2', '3', '4'],
        evidenceIds: ['101', '102', '103', '104'],
      }),
      change(3, 'new_region', {
        dimension: 'Kazan',
        eventIds: ['3', '4'],
        evidenceIds: ['103', '104'],
      }),
    ]
    const result = buildSignalEpisodes(
      { stateChanges: changes, events: fourVacancies() },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0].stateChangeIds).toEqual(['1', '2', '3'])
    expect(result.episodes[0].regions).toEqual(['Kazan', 'Moscow'])
  })

  it('rejects cross-organization and evidence-free provenance', () => {
    const result = buildSignalEpisodes(
      {
        stateChanges: [
          change(1, 'hiring_acceleration', { organizationId: '20' }),
          change(2, 'hiring_acceleration', { evidenceIds: [] }),
        ],
        events: fourVacancies(),
      },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toEqual([])
    expect(result.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stateChangeIds: ['1'],
        reasonCode: 'SIGNAL_EPISODE_ORGANIZATION_MISMATCH',
      }),
      expect.objectContaining({
        stateChangeIds: ['2'],
        reasonCode: 'SIGNAL_EPISODE_EVIDENCE_MISSING',
      }),
    ]))
  })

  it('fails closed when a state change references an unavailable event', () => {
    const result = buildSignalEpisodes(
      {
        stateChanges: [change(1, 'hiring_acceleration', {
          eventIds: ['1', '999'],
          evidenceIds: ['101', '1099'],
        })],
        events: [event(1)],
      },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toEqual([])
    expect(result.rejections).toContainEqual({
      stateChangeIds: ['1'],
      eventIds: ['999'],
      reasonCode: 'SIGNAL_EPISODE_EVENT_MISSING',
    })
  })

  it('is deterministic across input order and duplicate replay', () => {
    const stateChanges = [change(1), change(2, 'role_mix_shift')]
    const events = fourVacancies()
    const first = buildSignalEpisodes(
      { stateChanges, events },
      { organizationId: '10', now: NOW },
    )
    const second = buildSignalEpisodes(
      {
        stateChanges: [stateChanges[1], stateChanges[0], stateChanges[0]],
        events: [events[3], events[1], events[0], events[2], events[0]],
      },
      { organizationId: '10', now: NOW },
    )

    expect(second).toEqual(first)
  })

  it('derives cooling and expired stages from valid_until', () => {
    const episode = buildSignalEpisodes(
      { stateChanges: [change(1)], events: fourVacancies() },
      { organizationId: '10', now: NOW },
    ).episodes[0]

    expect(signalEpisodeStageAt(episode, new Date('2026-08-21T00:00:00Z'))).toBe('cooling')
    expect(signalEpisodeStageAt(episode, new Date('2026-09-01T00:00:00Z'))).toBe('expired')
  })

  it('builds a stale situation as expired instead of reviving it', () => {
    const oldEvents = fourVacancies().map((item) => ({
      ...item,
      occurredAt: '2026-06-30T08:00:00.000Z',
      firstSeenAt: '2026-06-30T09:00:00.000Z',
      lastSeenAt: '2026-07-01T10:00:00.000Z',
    }))
    const result = buildSignalEpisodes(
      {
        stateChanges: [change(1, 'hiring_acceleration', {
          snapshotAt: '2026-07-01T00:00:00.000Z',
        })],
        events: oldEvents,
      },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes[0].stage).toBe('expired')
  })

  it.each([
    {
      expected: 'vacancy_acceleration',
      changes: [change(1)],
      context: [],
    },
    {
      expected: 'persistent_hiring_problem',
      changes: [change(1)],
      context: [contextEvent(5, 'vacancy_repost'), contextEvent(6, 'vacancy_repost')],
    },
    {
      expected: 'role_cluster',
      changes: [change(1, 'role_mix_shift')],
      context: [],
    },
    {
      expected: 'new_region_expansion',
      changes: [change(1, 'new_region', { dimension: 'Kazan' })],
      context: [],
    },
    {
      expected: 'hiring_restart',
      changes: [change(1, 'hiring_restart')],
      context: [],
    },
    {
      expected: 'sustained_hiring',
      changes: [
        change(1, 'hiring_acceleration', { snapshotAt: '2026-07-20T00:00:00.000Z' }),
        change(2),
      ],
      context: [],
    },
    {
      expected: 'leadership_led_expansion',
      changes: [change(1)],
      context: [contextEvent(5, 'leadership_change')],
    },
    {
      expected: 'recruiting_capacity_gap',
      changes: [change(1)],
      context: [contextEvent(5, 'recruiter_vacancy')],
    },
    {
      expected: 'new_unit_buildout',
      changes: [change(1)],
      context: [contextEvent(5, 'new_business_unit')],
    },
    {
      expected: 'business_expansion',
      changes: [change(1)],
      context: [contextEvent(5, 'funding_or_investment')],
    },
    {
      expected: 'reactivation_window',
      changes: [
        change(1, 'hiring_slowdown', {
          snapshotAt: '2026-07-20T00:00:00.000Z',
          direction: 'down',
        }),
        change(2, 'hiring_restart'),
      ],
      context: [],
    },
  ] as const)('supports $expected without emitting a second generic card', ({
    expected,
    changes,
    context,
  }) => {
    const result = buildSignalEpisodes(
      { stateChanges: changes, events: [...fourVacancies(), ...context] },
      { organizationId: '10', now: NOW },
    )

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0].episodeType).toBe(expected)
  })
})
