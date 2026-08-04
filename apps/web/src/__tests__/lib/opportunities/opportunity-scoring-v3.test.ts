import {
  OPPORTUNITY_SCORING_VERSION_V3,
  buildOpportunityScoringV3,
  type OpportunityScoringV3Input,
} from '@/lib/opportunities/opportunity-scoring-v3'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)

function input(
  overrides: Partial<OpportunityScoringV3Input> = {},
): OpportunityScoringV3Input {
  return {
    organizationId: '10',
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    agencyDnaMatchSnapshotId: '50',
    agencyDnaMatchGeneration: 3,
    agencyDnaMatchIdentity: HASH_A,
    agencyDnaMatchInputHash: HASH_B,
    propensitySnapshotId: '60',
    propensityGeneration: 2,
    commercialThesisId: '70',
    commercialThesisGeneration: 2,
    signalEpisodeId: '80',
    signalEpisodeGeneration: 4,
    companyStateSnapshotId: '90',
    agencyDnaVersion: 5,
    agencyDnaSnapshotHash: HASH_C,
    evidenceHash: HASH_D,
    evidenceIds: ['101', '102'],
    evidenceSourceFamilies: ['career-pages', 'hh'],
    directEvidenceCount: 2,
    corroborationEvidenceCount: 0,
    organizationIdentityVerified: true,
    stateChangeConfirmed: true,
    companyStateConfidence: 0.9,
    episodeStage: 'active',
    episodeIntensity: 0.86,
    episodeLastSeenAt: '2026-08-03T12:00:00.000Z',
    episodeValidUntil: '2026-09-03T12:00:00.000Z',
    profileExcluded: false,
    accountRestriction: null,
    opportunityMode: 'find',
    agencyFitScore: 0.86,
    agencyFitCoverage: 0.72,
    minimumAgencyFitScore: 0.58,
    minimumAgencyFitCoverage: 0.35,
    propensityScore: 0.82,
    propensityLevel: 'high',
    economicsOutcome: 'unknown',
    currentCapacity: 'normal',
    corporateContactPathCategories: [],
    decisionMakerFunctions: ['head-of-talent'],
    contactPolicy: 'corporate_only',
    enrichmentCompleteness: 0.5,
    rolloutMode: 'shadow',
    fallbackScoringVersion: 'opportunity-v2',
    now: new Date('2026-08-04T12:00:00.000Z'),
    ...overrides,
  }
}

describe('Opportunity Scoring v3', () => {
  it('keeps strong quality without a contact path and queues enrichment', () => {
    const result = buildOpportunityScoringV3(input())

    expect(result.qualityScore).toBeGreaterThan(0.7)
    expect(result.actionabilityScore).toBe(0)
    expect(result.rankingScore).toBe(result.qualityScore)
    expect(result.status).toBe('qualified_needs_enrichment')
    expect(result.legacyStatusProjection).toBe('review')
    expect(result.qualityComponents).not.toHaveProperty('reachability')
    expect(result.actionabilityComponents.corporateContactPath.score).toBe(0)
  })

  it('marks the same quality as actionable when safe route and function exist', () => {
    const result = buildOpportunityScoringV3(input({
      corporateContactPathCategories: ['hr-email', 'contact-form'],
      enrichmentCompleteness: 0.85,
    }))

    expect(result.status).toBe('qualified_actionable')
    expect(result.legacyStatusProjection).toBe('new')
    expect(result.qualityScore).toBeGreaterThan(0.7)
    expect(result.actionabilityScore).toBeGreaterThan(0.8)
  })

  it('does not let strong evidence compensate for agency fit below the gate', () => {
    const result = buildOpportunityScoringV3(input({
      agencyFitScore: 0.3,
      companyStateConfidence: 1,
      episodeIntensity: 1,
      propensityScore: 1,
      economicsOutcome: 'match',
    }))

    expect(result.hardGates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'AGENCY_FIT_BELOW_THRESHOLD',
        passed: false,
      }),
    ]))
    expect(result.qualityScore).toBe(0)
    expect(result.status).toBe('review')
  })

  it.each(['do_not_contact', 'conflict'] as const)(
    'blocks commercial action for %s regardless of other scores',
    (accountRestriction) => {
      const result = buildOpportunityScoringV3(input({
        accountRestriction,
        opportunityMode: 'blocked',
        corporateContactPathCategories: ['hr-email'],
        enrichmentCompleteness: 1,
      }))

      expect(result.status).toBe('blocked')
      expect(result.qualityScore).toBe(0)
      expect(result.actionabilityScore).toBe(0)
      expect(result.reasons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: accountRestriction === 'do_not_contact'
            ? 'DO_NOT_CONTACT'
            : 'ACCOUNT_CONFLICT',
          basis: 'policy',
        }),
      ]))
    },
  )

  it('expires current scoring when the source episode is no longer active', () => {
    const result = buildOpportunityScoringV3(input({
      episodeStage: 'expired',
      now: new Date('2026-10-04T12:00:00.000Z'),
    }))

    expect(result.status).toBe('expired')
    expect(result.qualityScore).toBe(0)
    expect(result.hardGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EPISODE_NOT_ACTIVE', passed: false }),
    ]))
  })

  it('keeps low external propensity out of qualified statuses', () => {
    const result = buildOpportunityScoringV3(input({
      propensityScore: 0.3,
      propensityLevel: 'low',
    }))

    expect(result.status).toBe('review')
    expect(result.qualityScore).toBe(0)
    expect(result.hardGates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'EXTERNAL_AGENCY_PROPENSITY_BELOW_THRESHOLD',
        passed: false,
      }),
    ]))
  })

  it('fails the economics gate only for an evidenced contradiction', () => {
    const unknown = buildOpportunityScoringV3(input({ economicsOutcome: 'unknown' }))
    const mismatch = buildOpportunityScoringV3(input({ economicsOutcome: 'mismatch' }))

    expect(unknown.hardGates.find((item) =>
      item.code === 'ECONOMICS_CONTRADICTS_AGENCY')?.passed).toBe(true)
    expect(mismatch.hardGates.find((item) =>
      item.code === 'ECONOMICS_CONTRADICTS_AGENCY')?.passed).toBe(false)
    expect(mismatch.status).toBe('review')
  })

  it('does not qualify an ordinary event without a confirmed state change', () => {
    const result = buildOpportunityScoringV3(input({
      stateChangeConfirmed: false,
    }))

    expect(result.status).toBe('review')
    expect(result.hardGates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'COMPANY_STATE_CHANGE_UNCONFIRMED',
        passed: false,
      }),
    ]))
  })

  it('supports Find, Grow, and Reactivate without merging their identity', () => {
    const find = buildOpportunityScoringV3(input({ opportunityMode: 'find' }))
    const grow = buildOpportunityScoringV3(input({
      opportunityMode: 'grow',
      accountRestriction: 'existing_client',
    }))
    const reactivate = buildOpportunityScoringV3(input({
      opportunityMode: 'reactivate',
      accountRestriction: 'former_client',
    }))

    expect(new Set([
      find.candidateIdentity,
      grow.candidateIdentity,
      reactivate.candidateIdentity,
    ]).size).toBe(3)
    expect([find.opportunityMode, grow.opportunityMode, reactivate.opportunityMode])
      .toEqual(['find', 'grow', 'reactivate'])
  })

  it('is reproducible and changes the input hash for negative evidence', () => {
    const first = buildOpportunityScoringV3(input())
    const replay = buildOpportunityScoringV3(input())
    const downgraded = buildOpportunityScoringV3(input({
      evidenceHash: HASH_A,
      propensityScore: 0.3,
      propensityLevel: 'low',
    }))

    expect(replay).toEqual(first)
    expect(first.scoreVersion).toBe(OPPORTUNITY_SCORING_VERSION_V3)
    expect(downgraded.inputHash).not.toBe(first.inputHash)
    expect(downgraded.status).toBe('review')
    expect(downgraded.qualityScore).toBeLessThan(first.qualityScore)
    expect(first.featureSnapshot.actionability).not.toHaveProperty('contactValues')
  })
})
