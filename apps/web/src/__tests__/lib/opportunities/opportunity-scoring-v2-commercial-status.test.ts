import {
  OpportunityScoringV2Service,
  type OpportunityScoringV2Input,
} from '@/lib/opportunities/opportunity-scoring-v2'
import type { HiringEpisodeCandidate } from '@/lib/opportunities/hiring-episode-detection'

const NOW = new Date('2026-08-02T12:00:00.000Z')

function episode(
  overrides: Partial<HiringEpisodeCandidate> = {},
): HiringEpisodeCandidate {
  return {
    organizationId: '10',
    episodeType: 'vacancy_spike',
    episodeKey: '10:vacancy_spike:all:g1',
    episodeIdentity: '10:vacancy_spike:all',
    episodeGeneration: 1,
    title: 'Компания ускорила найм backend-команды',
    summary: 'За 14 дней опубликовано восемь подтверждённых вакансий.',
    startedAt: '2026-07-25T12:00:00.000Z',
    lastSeenAt: '2026-08-01T12:00:00.000Z',
    signalCount: 8,
    vacancyCount: 8,
    strengthScore: 0.85,
    freshnessScore: 0.95,
    evidenceHash: 'a'.repeat(64),
    engineVersion: 'hiring-episode-v1',
    signalIds: ['s-1', 's-2'],
    evidenceIds: ['e-1', 'e-2'],
    metadata: {
      activityTrend: 'rising',
      regionCount: 1,
      seniorRoleCount: 2,
      roleFamilies: ['backend'],
    },
    ...overrides,
  }
}

function input(
  overrides: Partial<OpportunityScoringV2Input> = {},
): OpportunityScoringV2Input {
  return {
    episode: episode(),
    fiur: {
      fit: 0.82,
      reachability: 0.74,
      reasons: {
        fit: [{ key: 'fit.role.match', component: 'fit' }],
        reachability: [{
          key: 'reachability.career-page',
          component: 'reachability',
        }],
      },
    },
    confidenceGate: 'A',
    confidenceScore: 0.9,
    profileExcluded: false,
    entityResolutionVerified: true,
    admissibleHiringEvidence: true,
    accountRestriction: null,
    contactPolicyEligible: true,
    capabilityMatchScore: 0.8,
    now: NOW,
    ...overrides,
  }
}

describe('Opportunity v2 commercial status contract', () => {
  const service = new OpportunityScoringV2Service()

  it('keeps a strong evidence-backed commercial opportunity as new', () => {
    const result = service.score(input())

    expect(result.components.agencyFit.score).toBeGreaterThanOrEqual(0.35)
    expect(result.components.externalSupportNeed.score).toBeGreaterThanOrEqual(0.35)
    expect(result.status).toBe('new')
  })

  it('keeps a parsed hiring pattern in review when external-support need is weak', () => {
    const result = service.score(input({
      episode: episode({
        episodeType: 'role_cluster',
        title: 'Компания формирует кластер ролей backend',
        summary: 'Одновременно опубликованы три вакансии одной функции.',
        vacancyCount: 3,
        signalCount: 3,
        strengthScore: 0.55,
        metadata: {
          roleFamily: 'backend',
          roleFamilies: ['backend'],
          roleCount: 3,
          seniorRoleCount: 0,
        },
      }),
    }))

    expect(result.components.externalSupportNeed.score).toBeLessThan(0.35)
    expect(result.status).toBe('review')
    expect(result.isActionQueueEligible).toBe(false)
  })

  it('keeps a hiring signal in review when it does not fit Agency DNA', () => {
    const result = service.score(input({
      fiur: {
        fit: 0.2,
        reachability: 0.74,
        reasons: {
          fit: [{ key: 'fit.role.mismatch', component: 'fit' }],
          reachability: [{
            key: 'reachability.career-page',
            component: 'reachability',
          }],
        },
      },
      capabilityMatchScore: 0.2,
    }))

    expect(result.components.agencyFit.score).toBeLessThan(0.35)
    expect(result.status).toBe('review')
    expect(result.isActionQueueEligible).toBe(false)
  })
})
