import {
  buildOutcomeLearningV1,
  type OutcomeLearningCandidate,
} from '@/lib/opportunities/outcome-learning-v1'

const NOW = new Date('2026-08-09T12:00:00.000Z')

function candidate(
  overrides: Partial<OutcomeLearningCandidate> = {},
): OutcomeLearningCandidate {
  return {
    candidateId: '101',
    opportunityId: '301',
    lineageId: '401',
    workspaceId: '10',
    agencyProfileKey: 'agency-a',
    episodeType: 'persistent_hiring',
    archetypes: ['hard_to_fill'],
    queryPlanKeys: ['plan-a'],
    caseSimilarity: 0.8,
    score: 0.85,
    shownAt: '2026-07-01T09:00:00.000Z',
    outcomes: [
      event('501', 'shown', '2026-07-01T09:00:00.000Z'),
      event('502', 'accepted', '2026-07-02T09:00:00.000Z'),
      event('503', 'contacted', '2026-07-03T09:00:00.000Z'),
      event('504', 'replied', '2026-07-05T09:00:00.000Z'),
      event('505', 'meeting', '2026-07-08T09:00:00.000Z'),
    ],
    ...overrides,
  }
}

describe('Outcome Learning v1', () => {
  it('keeps outcomes from another workspace out of analytics', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [
        candidate(),
        candidate({ candidateId: '102', workspaceId: '20', score: 0.1 }),
      ],
      now: NOW,
    })

    expect(result.sampleCount).toBe(1)
    expect(result.candidateIds).toEqual(['101'])
  })

  it('does not count no reply as negative before the maturity window', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({
        shownAt: '2026-08-01T09:00:00.000Z',
        outcomes: [
          event('501', 'shown', '2026-08-01T09:00:00.000Z'),
          event('502', 'contacted', '2026-08-05T09:00:00.000Z'),
        ],
      })],
      now: NOW,
      replyMaturityDays: 21,
    })

    expect(result.funnel.noReplyMatured.denominator).toBe(0)
    expect(result.funnel.noReplyMatured.rate).toBeNull()
  })

  it('counts no reply only after the contacted outcome matures', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({
        outcomes: [
          event('501', 'shown', '2026-07-01T09:00:00.000Z'),
          event('502', 'contacted', '2026-07-03T09:00:00.000Z'),
        ],
      })],
      now: NOW,
      replyMaturityDays: 21,
    })

    expect(result.funnel.noReplyMatured).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    })
  })

  it('excludes future outcomes from historical analytics', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({
        outcomes: [
          event('501', 'shown', '2026-07-01T09:00:00.000Z'),
          event('502', 'won', '2026-08-10T09:00:00.000Z'),
        ],
      })],
      now: NOW,
    })

    expect(result.funnel.won.numerator).toBe(0)
    expect(result.excludedFutureOutcomeCount).toBe(1)
  })

  it('excludes corrected outcomes and candidates not yet shown', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [
        candidate({
          outcomes: [
            event('501', 'shown', '2026-07-01T09:00:00.000Z'),
            event('502', 'won', '2026-07-20T09:00:00.000Z', null, false),
          ],
        }),
        candidate({
          candidateId: '102',
          opportunityId: '302',
          lineageId: '402',
          shownAt: '2026-08-10T09:00:00.000Z',
          outcomes: [event('503', 'shown', '2026-08-10T09:00:00.000Z')],
        }),
      ],
      now: NOW,
    })

    expect(result.sampleCount).toBe(1)
    expect(result.funnel.won.numerator).toBe(0)
    expect(result.excludedCorrectedOutcomeCount).toBe(1)
    expect(result.excludedFutureCandidateCount).toBe(1)
  })

  it('rejects an outcome that precedes the shown lineage', () => {
    expect(() => buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({
        outcomes: [event('501', 'accepted', '2026-06-30T09:00:00.000Z')],
      })],
      now: NOW,
    })).toThrow(/precede shown/i)
  })

  it('retains controlled lost and bad-fit reason codes', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({
        outcomes: [
          event('501', 'shown', '2026-07-01T09:00:00.000Z'),
          event('502', 'lost', '2026-07-20T09:00:00.000Z', 'bad_economics'),
        ],
      })],
      now: NOW,
    })

    expect(result.lostReasons).toEqual([{ reasonCode: 'bad_economics', count: 1 }])
  })

  it('produces shadow slices but no learned weights on a small sample', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate()],
      now: NOW,
    })

    expect(result.slices.episodeType).toHaveLength(1)
    expect(result.slices.archetype).toHaveLength(1)
    expect(result.slices.queryPlan).toHaveLength(1)
    expect(result.slices.caseSimilarityBand).toHaveLength(1)
    expect(result.slices.scoreDecile).toHaveLength(1)
    expect(result.learningStatus).toBe('insufficient_data')
    expect(result.shadowRecommendations).toEqual([])
    expect(result.automaticWeightUpdates).toBe(false)
  })
})

function event(
  eventId: string,
  type: OutcomeLearningCandidate['outcomes'][number]['type'],
  occurredAt: string,
  reasonCode: string | null = null,
  effective = true,
): OutcomeLearningCandidate['outcomes'][number] {
  return { eventId, type, occurredAt, reasonCode, effective }
}
