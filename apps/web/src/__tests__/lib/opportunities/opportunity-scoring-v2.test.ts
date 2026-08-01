import {
  OPPORTUNITY_FEATURE_SCHEMA_V2,
  OPPORTUNITY_GATE_VERSION_V2,
  OPPORTUNITY_SCORING_VERSION_V2,
  OpportunityScoringV2Service,
  type OpportunityScoringV2Input,
} from '@/lib/opportunities/opportunity-scoring-v2'
import type { HiringEpisodeCandidate } from '@/lib/opportunities/hiring-episode-detection'

function episode(
  overrides: Partial<HiringEpisodeCandidate> = {},
): HiringEpisodeCandidate {
  return {
    organizationId: '10',
    episodeType: 'vacancy_spike',
    episodeKey: 'vacancy_spike:all:2026-07-20',
    episodeIdentity: '10:vacancy_spike:all',
    episodeGeneration: 1,
    title: 'Компания ускорила найм backend-команды',
    summary: 'За 14 дней опубликовано восемь подтверждённых вакансий.',
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
    now: new Date('2026-07-26T12:00:00.000Z'),
    ...overrides,
  }
}

describe('OpportunityScoringV2Service', () => {
  const service = new OpportunityScoringV2Service()

  it('returns the seven named bounded components and reproducibility versions', () => {
    const result = service.score(input())

    expect(Object.keys(result.components)).toEqual([
      'eligibility',
      'evidenceConfidence',
      'agencyFit',
      'externalSupportNeed',
      'timing',
      'reachability',
      'commercialValue',
    ])
    for (const component of Object.values(result.components)) {
      expect(component.score).toBeGreaterThanOrEqual(0)
      expect(component.score).toBeLessThanOrEqual(1)
    }
    expect(result.rankingScore).toBeGreaterThan(0)
    expect(result.rankingScore).toBeLessThanOrEqual(1)
    expect(result.scoringVersion).toBe(OPPORTUNITY_SCORING_VERSION_V2)
    expect(result.featureSchemaVersion).toBe(OPPORTUNITY_FEATURE_SCHEMA_V2)
    expect(result.gateVersion).toBe(OPPORTUNITY_GATE_VERSION_V2)
    expect(result.modelType).toBe('heuristic')
    expect(result.calibrationStatus).toBe('uncalibrated')
    expect(result).not.toHaveProperty('dealProbability')
  })

  it.each([
    ['profile exclusion', { profileExcluded: true }, 'PROFILE_EXCLUSION'],
    [
      'unverified entity resolution',
      { entityResolutionVerified: false },
      'ENTITY_RESOLUTION_UNVERIFIED',
    ],
    [
      'missing admissible hiring evidence',
      { admissibleHiringEvidence: false },
      'HIRING_EVIDENCE_MISSING',
    ],
    [
      'blocked account restriction',
      { accountRestriction: 'do_not_contact' as const },
      'ACCOUNT_RESTRICTION_BLOCKED',
    ],
    [
      'conflict restriction',
      { accountRestriction: 'conflict' as const },
      'ACCOUNT_RESTRICTION_BLOCKED',
    ],
    [
      'ineligible contact policy',
      { contactPolicyEligible: false },
      'CONTACT_POLICY_BLOCKED',
    ],
  ])('hard-blocks %s before high soft scores can compensate', (_name, override, code) => {
    const result = service.score(input(override))

    expect(result.hardGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, passed: false }),
    ]))
    expect(result.components.eligibility.score).toBe(0)
    expect(result.rankingScore).toBe(0)
    expect(result.isActionQueueEligible).toBe(false)
  })

  it('expires a closed episode and keeps it out of the action queue', () => {
    const result = service.score(input({ episodeStatus: 'closed' }))

    expect(result.status).toBe('expired')
    expect(result.hardGates).toContainEqual(expect.objectContaining({
      code: 'EPISODE_EXPIRED',
      passed: false,
    }))
    expect(result.rankingScore).toBe(0)
  })

  it('allows existing and former client modes when no blocking restriction exists', () => {
    for (const accountRestriction of ['existing_client', 'former_client'] as const) {
      const result = service.score(input({ accountRestriction }))

      expect(result.hardGates.find((gate) =>
        gate.code === 'ACCOUNT_RESTRICTION_BLOCKED')?.passed).toBe(true)
      expect(result.components.eligibility.score).toBe(1)
    }
  })

  it('falls back to the unchanged FIUR fit when Agency DNA has no comparable dimensions', () => {
    const result = service.score(input({ capabilityMatchScore: null }))

    expect(result.components.agencyFit.score).toBe(0.82)
  })

  it('keeps confidence gate D out of the action queue even when hard gates pass', () => {
    const result = service.score(input({ confidenceGate: 'D', confidenceScore: 1 }))

    expect(result.components.eligibility.score).toBe(1)
    expect(result.status).toBe('review')
    expect(result.isActionQueueEligible).toBe(false)
  })

  it('attributes evidence-derived reasons to immutable evidence identifiers', () => {
    const result = service.score(input())
    const reasons = Object.values(result.components)
      .flatMap((component) => component.reasons)

    for (const reason of reasons) {
      if (reason.basis === 'evidence') {
        expect(reason.evidenceIds.length).toBeGreaterThan(0)
      }
    }
  })
})
