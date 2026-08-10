import {
  DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG,
  OpportunityScoringV2Service,
  type OpportunityScoringV2Config,
  type OpportunityScoringV2Input,
} from '@/lib/opportunities/opportunity-scoring-v2'
import type { HiringEpisodeCandidate } from '@/lib/opportunities/hiring-episode-detection'

const NOW = new Date('2026-08-02T12:00:00.000Z')
const EPSILON = 0.00001

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

function weakExternalSupportInput(): OpportunityScoringV2Input {
  return input({
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
  })
}

function weakAgencyFitInput(): OpportunityScoringV2Input {
  return input({
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
  })
}

function config(
  overrides: Partial<OpportunityScoringV2Config>,
): OpportunityScoringV2Config {
  return {
    ...DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG,
    ...overrides,
  }
}

describe('Opportunity v2 commercial status contract', () => {
  const service = new OpportunityScoringV2Service()

  it('keeps current default commercial thresholds unchanged', () => {
    expect(DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG).toMatchObject({
      minimumAgencyFit: 0.35,
      minimumExternalSupportNeed: 0.35,
      minimumEvidenceConfidence: 0.55,
    })
  })

  it('keeps a strong evidence-backed commercial opportunity as new', () => {
    const result = service.score(input())

    expect(result.components.agencyFit.score).toBeGreaterThanOrEqual(0.35)
    expect(result.components.externalSupportNeed.score).toBeGreaterThanOrEqual(0.35)
    expect(result.status).toBe('new')
  })

  it('keeps confidence A in review when external-support need is weak', () => {
    const result = service.score(weakExternalSupportInput())

    expect(result.confidenceGate).toBe('A')
    expect(result.components.externalSupportNeed.score).toBeLessThan(0.35)
    expect(result.status).toBe('review')
    expect(result.isActionQueueEligible).toBe(false)
  })

  it('keeps confidence A in review when Agency Fit is weak', () => {
    const result = service.score(weakAgencyFitInput())

    expect(result.confidenceGate).toBe('A')
    expect(result.components.agencyFit.score).toBeLessThan(0.35)
    expect(result.status).toBe('review')
    expect(result.isActionQueueEligible).toBe(false)
  })

  it('returns review when Agency Fit is below the configured threshold', () => {
    const baseline = service.score(input())
    const minimumAgencyFit = baseline.components.agencyFit.score + EPSILON
    const result = new OpportunityScoringV2Service(config({ minimumAgencyFit }))
      .score(input())

    expect(result.components.agencyFit.score).toBeLessThan(minimumAgencyFit)
    expect(result.status).toBe('review')
  })

  it('keeps new when Agency Fit equals the configured threshold', () => {
    const baseline = service.score(input())
    const result = new OpportunityScoringV2Service(config({
      minimumAgencyFit: baseline.components.agencyFit.score,
    })).score(input())

    expect(result.components.agencyFit.score)
      .toBe(baseline.components.agencyFit.score)
    expect(result.status).toBe('new')
  })

  it('keeps new when Agency Fit is above the configured threshold', () => {
    const baseline = service.score(input())
    const minimumAgencyFit = baseline.components.agencyFit.score - EPSILON
    const result = new OpportunityScoringV2Service(config({ minimumAgencyFit }))
      .score(input())

    expect(result.components.agencyFit.score).toBeGreaterThan(minimumAgencyFit)
    expect(result.status).toBe('new')
  })

  it('returns review when External Support Need is below the configured threshold', () => {
    const baseline = service.score(input())
    const minimumExternalSupportNeed =
      baseline.components.externalSupportNeed.score + EPSILON
    const result = new OpportunityScoringV2Service(config({
      minimumExternalSupportNeed,
    })).score(input())

    expect(result.components.externalSupportNeed.score)
      .toBeLessThan(minimumExternalSupportNeed)
    expect(result.status).toBe('review')
  })

  it('keeps new when External Support Need equals the configured threshold', () => {
    const baseline = service.score(input())
    const result = new OpportunityScoringV2Service(config({
      minimumExternalSupportNeed: baseline.components.externalSupportNeed.score,
    })).score(input())

    expect(result.components.externalSupportNeed.score)
      .toBe(baseline.components.externalSupportNeed.score)
    expect(result.status).toBe('new')
  })

  it('keeps new when External Support Need is above the configured threshold', () => {
    const baseline = service.score(input())
    const minimumExternalSupportNeed =
      baseline.components.externalSupportNeed.score - EPSILON
    const result = new OpportunityScoringV2Service(config({
      minimumExternalSupportNeed,
    })).score(input())

    expect(result.components.externalSupportNeed.score)
      .toBeGreaterThan(minimumExternalSupportNeed)
    expect(result.status).toBe('new')
  })

  it('uses baseline Agency Fit when capability match is null without NaN or artificial zero', () => {
    const result = service.score(input({ capabilityMatchScore: null }))

    expect(Number.isFinite(result.components.agencyFit.score)).toBe(true)
    expect(result.components.agencyFit.score).toBeGreaterThan(0)
    expect(result.components.agencyFit.reasons.map((reason) => reason.code))
      .not.toContain('AGENCY_DNA_CAPABILITY_MATCH')
  })

  it.each(['C', 'D'] as const)(
    'keeps confidence gate %s in review',
    (confidenceGate) => {
      const result = service.score(input({ confidenceGate }))

      expect(result.status).toBe('review')
    },
  )

  it('keeps hard-gate dismissal semantics unchanged', () => {
    const result = service.score(input({ contactPolicyEligible: false }))
    const gate = result.hardGates.find(({ code }) =>
      code === 'CONTACT_POLICY_BLOCKED')

    expect(gate?.passed).toBe(false)
    expect(result.status).toBe('dismissed')
    expect(result.isActionQueueEligible).toBe(false)
  })

  it('keeps closed episodes expired', () => {
    const result = service.score(input({ episodeStatus: 'closed' }))

    expect(result.status).toBe('expired')
    expect(result.isActionQueueEligible).toBe(false)
  })
})
