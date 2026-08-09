import {
  buildOutcomeLearningV1,
  type OutcomeLearningCandidate,
  type OutcomeLearningProjection,
} from '@/lib/opportunities/outcome-learning-v1'

const NOW = new Date('2026-08-09T12:00:00.000Z')

function projection(
  overrides: Partial<OutcomeLearningProjection> = {},
): OutcomeLearningProjection {
  return {
    version: 'opportunity-outcome-state-v1',
    candidateId: '101',
    opportunityId: '301',
    lineageId: '401',
    workspaceId: '10',
    lastEventId: '505',
    lastEventAt: '2026-07-08T09:00:00.000Z',
    acceptedAt: '2026-07-02T09:00:00.000Z',
    contactedAt: '2026-07-03T09:00:00.000Z',
    repliedAt: '2026-07-05T09:00:00.000Z',
    meetingAt: '2026-07-08T09:00:00.000Z',
    proposalAt: null,
    wonAt: null,
    lostAt: null,
    lostReasonCode: null,
    ...overrides,
  }
}

function candidate(overrides: Partial<OutcomeLearningCandidate> = {}): OutcomeLearningCandidate {
  return {
    candidateId: '101',
    opportunityId: '301',
    lineageId: '401',
    workspaceId: '10',
    agencyProfileKey: 'agency-a',
    episodeType: 'persistent_hiring',
    archetypes: ['hard_to_fill'],
    frictionScore: 0.7,
    convergencePatterns: ['multi_origin_active'],
    queryPlanKeys: ['plan-a'],
    caseSimilarity: 0.8,
    score: 0.85,
    shownAt: '2026-07-01T09:00:00.000Z',
    outcomeProjection: projection(),
    ...overrides,
  }
}

describe('Outcome Learning v1', () => {
  it('keeps canonical projections from another workspace out of analytics', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate(), candidate({
        candidateId: '102', opportunityId: '302', lineageId: '402', workspaceId: '20',
        outcomeProjection: projection({
          candidateId: '102', opportunityId: '302', lineageId: '402',
          workspaceId: '20', lastEventId: '506',
        }),
      })],
      now: NOW,
    })
    expect(result.sampleCount).toBe(1)
    expect(result.candidateIds).toEqual(['101'])
  })

  it('does not count no reply before maturity and counts it afterwards', () => {
    const recent = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({
        shownAt: '2026-08-01T09:00:00.000Z',
        outcomeProjection: projection({
          lastEventId: '502', lastEventAt: '2026-08-05T09:00:00.000Z',
          acceptedAt: null, contactedAt: '2026-08-05T09:00:00.000Z',
          repliedAt: null, meetingAt: null,
        }),
      })],
      now: NOW,
    })
    expect(recent.funnel.noReplyMatured.rate).toBeNull()

    const mature = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({ outcomeProjection: projection({
        lastEventId: '502', lastEventAt: '2026-07-03T09:00:00.000Z',
        acceptedAt: null, contactedAt: '2026-07-03T09:00:00.000Z',
        repliedAt: null, meetingAt: null,
      }) })],
      now: NOW,
    })
    expect(mature.funnel.noReplyMatured).toMatchObject({ numerator: 1, denominator: 1, rate: 1 })
  })

  it('rejects a projection from after the fixed clock', () => {
    expect(() => buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({ outcomeProjection: projection({
          lastEventId: '506', lastEventAt: '2026-08-10T09:00:00.000Z',
          wonAt: '2026-08-10T09:00:00.000Z',
        }) })],
      now: NOW,
    })).toThrow(/fixed learning clock/i)
  })

  it('excludes candidates not yet shown', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate(), candidate({
          candidateId: '102', opportunityId: '302', lineageId: '402',
          shownAt: '2026-08-10T09:00:00.000Z',
          outcomeProjection: projection({
            candidateId: '102', opportunityId: '302', lineageId: '402',
            lastEventId: '507', lastEventAt: '2026-08-10T09:00:00.000Z',
            acceptedAt: null, contactedAt: null, repliedAt: null, meetingAt: null,
          }),
        })],
      now: NOW,
    })
    expect(result.excludedFutureCandidateCount).toBe(1)
  })

  it('rejects milestones outside the canonical projection boundary', () => {
    expect(() => buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({ outcomeProjection: projection({
        acceptedAt: '2026-06-30T09:00:00.000Z',
      }) })],
      now: NOW,
    })).toThrow(/precede shown/i)

    expect(() => buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({ outcomeProjection: projection({
        lastEventAt: '2026-07-07T09:00:00.000Z',
      }) })],
      now: NOW,
    })).toThrow(/effective projection boundary/i)
  })

  it('retains controlled lost reason codes from the projection', () => {
    const result = buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate({ outcomeProjection: projection({
        lastEventId: '506', lastEventAt: '2026-07-20T09:00:00.000Z',
        lostAt: '2026-07-20T09:00:00.000Z', lostReasonCode: 'bad_economics',
      }) })],
      now: NOW,
    })
    expect(result.lostReasons).toEqual([{ reasonCode: 'bad_economics', count: 1 }])
  })

  it('produces shadow slices but never learned weights for a small sample', () => {
    const result = buildOutcomeLearningV1({ workspaceId: '10', candidates: [candidate()], now: NOW })
    expect(result.slices.episodeType).toHaveLength(1)
    expect(result.slices.archetype).toHaveLength(1)
    expect(result.slices.archetypeByProfile[0]?.key)
      .toBe('agency-a|hard_to_fill')
    expect(result.slices.frictionBandByProfile[0]?.key)
      .toBe('agency-a|high')
    expect(result.slices.convergencePattern[0]?.key)
      .toBe('multi_origin_active')
    expect(result.slices.queryPlan).toHaveLength(1)
    expect(result.learningStatus).toBe('insufficient_data')
    expect(result.shadowRecommendations).toEqual([])
    expect(result.automaticWeightUpdates).toBe(false)
  })

  it('requires mature outcomes inside each slice before recommending it', () => {
    const candidates = Array.from({ length: 30 }, (_, offset) => {
      const index = offset + 1
      const mature = index <= 10
      return candidate({
        candidateId: String(100 + index),
        opportunityId: String(300 + index),
        lineageId: String(400 + index),
        queryPlanKeys: [mature ? 'plan-mature' : 'plan-immature'],
        outcomeProjection: projection({
          candidateId: String(100 + index),
          opportunityId: String(300 + index),
          lineageId: String(400 + index),
          lastEventId: String(500 + index),
          lastEventAt: '2026-07-08T09:00:00.000Z',
          repliedAt: mature ? '2026-07-05T09:00:00.000Z' : null,
          meetingAt: mature ? '2026-07-08T09:00:00.000Z' : null,
        }),
      })
    })
    const result = buildOutcomeLearningV1({ workspaceId: '10', candidates, now: NOW })
    const queryPlanRecommendations = result.shadowRecommendations
      .filter((item) => item.dimension === 'queryPlan')

    expect(result.learningStatus).toBe('shadow_review_ready')
    expect(queryPlanRecommendations).toEqual([
      expect.objectContaining({ key: 'plan-mature' }),
    ])
    expect(result.slices.queryPlan.find((item) => item.key === 'plan-immature'))
      .toMatchObject({ sampleCount: 20, matureOutcomes: 0 })
  })

  it('rejects one canonical projection attached to multiple lineages', () => {
    expect(() => buildOutcomeLearningV1({
      workspaceId: '10',
      candidates: [candidate(), candidate({
        candidateId: '102', opportunityId: '302', lineageId: '402',
        outcomeProjection: projection({
          candidateId: '102', opportunityId: '302', lineageId: '402',
        }),
      })],
      now: NOW,
    })).toThrow(/globally unique/i)
  })
})
