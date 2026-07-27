import {
  DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  OpportunityScoringService,
  type OpportunityScoringInput,
} from '@/lib/opportunities/opportunity-scoring'
import type { HiringEpisodeCandidate } from '@/lib/opportunities/hiring-episode-detection'

const NOW = new Date('2026-07-26T12:00:00.000Z')

function episode(
  overrides: Partial<HiringEpisodeCandidate> = {},
): HiringEpisodeCandidate {
  return {
    organizationId: '10',
    episodeType: 'vacancy_spike',
    episodeKey: 'vacancy_spike:all:2026-07-20',
    title: 'Компания ускорила найм',
    summary: 'За последние 14 дней опубликовано 8 вакансий.',
    startedAt: '2026-07-15T12:00:00.000Z',
    lastSeenAt: '2026-07-25T12:00:00.000Z',
    signalCount: 8,
    vacancyCount: 8,
    strengthScore: 0.85,
    freshnessScore: 0.95,
    evidenceHash: 'a'.repeat(64),
    engineVersion: 'hiring-episode-v1',
    signalIds: ['s-1', 's-2'],
    evidenceIds: ['e-1', 'e-2'],
    metadata: {
      baselineCount: 2,
      currentCount: 8,
      growthMultiplier: 4,
      roleFamilies: ['backend'],
      regionCount: 1,
      seniorRoleCount: 2,
      recruiterVacancyCount: 0,
      activityTrend: 'rising',
    },
    ...overrides,
  }
}

function input(overrides: Partial<OpportunityScoringInput> = {}): OpportunityScoringInput {
  return {
    episode: episode(),
    fiur: {
      fit: 0.82,
      reachability: 0.74,
      reasons: {
        fit: [{ key: 'fit.role.match' }],
        reachability: [{ key: 'reachability.career-page' }],
      },
    },
    confidenceGate: 'A',
    confidenceScore: 0.9,
    profileExcluded: false,
    now: NOW,
    ...overrides,
  }
}

describe('OpportunityScoringService', () => {
  const service = new OpportunityScoringService()

  it('returns six bounded components and a bounded geometric score', () => {
    const result = service.score(input())

    expect(Object.keys(result.components)).toEqual([
      'agencyFit',
      'hiringIntent',
      'externalSupportNeed',
      'timing',
      'reachability',
      'confidence',
    ])
    for (const component of Object.values(result.components)) {
      expect(Number.isFinite(component.score)).toBe(true)
      expect(component.score).toBeGreaterThanOrEqual(0)
      expect(component.score).toBeLessThanOrEqual(1)
    }
    expect(Number.isFinite(result.opportunityScore)).toBe(true)
    expect(result.opportunityScore).toBeGreaterThanOrEqual(0)
    expect(result.opportunityScore).toBeLessThanOrEqual(1)
    expect(result.scoringVersion).toBe('opportunity-v1')
  })

  it('dismisses a profile exclusion before high hiring intent can compensate', () => {
    const result = service.score(
      input({
        profileExcluded: true,
        fiur: {
          fit: 1,
          reachability: 1,
          reasons: { fit: [], reachability: [] },
        },
      }),
    )

    expect(result.status).toBe('dismissed')
    expect(result.isMorningBriefEligible).toBe(false)
    expect(result.components.agencyFit.score).toBe(0)
  })

  it('blocks low agency fit from the Morning Brief', () => {
    const result = service.score(
      input({
        fiur: {
          fit: DEFAULT_OPPORTUNITY_SCORING_CONFIG.minimumAgencyFit - 0.01,
          reachability: 0.9,
          reasons: { fit: [], reachability: [] },
        },
      }),
    )

    expect(result.status).toBe('dismissed')
    expect(result.isMorningBriefEligible).toBe(false)
  })

  it('never delivers confidence gate D', () => {
    const result = service.score(input({ confidenceGate: 'D', confidenceScore: 1 }))

    expect(result.isMorningBriefEligible).toBe(false)
    expect(result.status).toBe('review')
    expect(result.components.confidence.score).toBeLessThanOrEqual(
      DEFAULT_OPPORTUNITY_SCORING_CONFIG.confidenceGateScores.D,
    )
  })

  it('blocks low external support need even when all other scores are high', () => {
    const result = service.score(
      input({
        episode: episode({
          episodeType: 'new_region',
          vacancyCount: 1,
          signalCount: 1,
          strengthScore: 0.2,
          metadata: { region: 'Казань', regionCount: 1, seniorRoleCount: 0 },
        }),
      }),
    )

    expect(result.components.externalSupportNeed.score).toBeLessThan(
      DEFAULT_OPPORTUNITY_SCORING_CONFIG.minimumExternalSupportNeed,
    )
    expect(result.isMorningBriefEligible).toBe(false)
  })

  it('can raise or lower the final score when evidence-backed episode facts change', () => {
    const weak = service.score(
      input({
        episode: episode({
          vacancyCount: 4,
          strengthScore: 0.45,
          freshnessScore: 0.55,
          metadata: { seniorRoleCount: 0, activityTrend: 'flat' },
        }),
        confidenceScore: 0.65,
      }),
    )
    const strong = service.score(
      input({
        episode: episode({
          vacancyCount: 12,
          strengthScore: 0.95,
          freshnessScore: 1,
          metadata: {
            seniorRoleCount: 4,
            regionCount: 3,
            activityTrend: 'rising',
            repeatedVacancyCount: 2,
          },
        }),
        confidenceScore: 0.95,
      }),
    )

    expect(strong.opportunityScore).toBeGreaterThan(weak.opportunityScore)
  })

  it('marks every reason as evidence-backed or profile-based', () => {
    const result = service.score(input())
    const reasons = Object.values(result.components).flatMap((component) => component.reasons)

    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) {
      expect(['evidence', 'profile']).toContain(reason.basis)
      if (reason.basis === 'evidence') {
        expect(reason.evidenceIds.length).toBeGreaterThan(0)
      }
    }
  })

  it('expires opportunities for closed episodes', () => {
    const result = service.score(input({ episodeStatus: 'closed' }))

    expect(result.status).toBe('expired')
    expect(result.isMorningBriefEligible).toBe(false)
  })
})
