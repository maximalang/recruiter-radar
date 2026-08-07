jest.mock('@/lib/opportunities/opportunity-scoring-v3-repository', () => ({
  persistOpportunityCandidate: jest.fn(),
}))

import {
  OpportunityScoringV3ApplyScopeRequiredError,
  buildOpportunityScoringV3Job,
  type OpportunityScoringV3JobDb,
} from '@/lib/opportunities/opportunity-scoring-v3-job'
import { persistOpportunityCandidate } from '@/lib/opportunities/opportunity-scoring-v3-repository'

const mockedPersist = jest.mocked(persistOpportunityCandidate)
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)

function candidateRow(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

function database(rows: Record<string, unknown>[] = [candidateRow()]) {
  const statements: Array<{ sql: string; values?: unknown[] }> = []
  const query = jest.fn(async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values })
    if (sql.includes('WITH latest_match')) return { rows, rowCount: rows.length }
    return { rows: [], rowCount: 0 }
  })
  return {
    db: { query } as unknown as OpportunityScoringV3JobDb,
    query,
    statements,
  }
}

describe('Opportunity Scoring v3 dark job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockResolvedValue({
      candidateId: '901',
      candidateGeneration: 1,
      inserted: true,
      evidenceAttached: 2,
    })
  })

  it('stays fail-closed without its independent flag', async () => {
    const { db, query } = database()

    await expect(buildOpportunityScoringV3Job({ env: {} }, db)).resolves
      .toMatchObject({ enabled: false, scanned: 0, persisted: 0 })
    expect(query).not.toHaveBeenCalled()
  })

  it('previews a quality candidate without suppressing missing contact', async () => {
    const { db, statements } = database()

    await expect(buildOpportunityScoringV3Job({
      env: { OPPORTUNITY_SCORING_V3_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
      now: new Date('2026-08-04T12:00:00.000Z'),
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      built: 1,
      qualifiedActionable: 0,
      qualifiedNeedsEnrichment: 1,
      persisted: 0,
      failed: 0,
    })
    const load = statements.find((item) => item.sql.includes('WITH latest_match'))
    expect(load?.sql).toContain('agency_dna_match_snapshots')
    expect(load?.sql).toContain('external_agency_propensity_snapshots')
    expect(load?.sql).toContain('commercial_theses')
    expect(load?.sql).toContain('signal_episode_state_changes')
    expect(load?.sql).toContain('company_state_snapshots')
    expect(load?.sql).toContain('company_event_publications')
    expect(load?.sql).toContain("'career-page'")
    expect(load?.sql).not.toContain("path->>'value'")
    expect(load?.sql).not.toMatch(/\bFROM opportunities\b/)
    expect(mockedPersist).not.toHaveBeenCalled()
  })

  it('does not build a candidate when no Agency DNA Match exists', async () => {
    const { db } = database([])

    await expect(buildOpportunityScoringV3Job({
      env: { OPPORTUNITY_SCORING_V3_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 0,
      built: 0,
      persisted: 0,
      failed: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
  })

  it('requires exact workspace and organization scope before apply', async () => {
    const { db, query } = database()

    await expect(buildOpportunityScoringV3Job({
      env: { OPPORTUNITY_SCORING_V3_ENABLED: 'true' },
      dryRun: false,
      workspaceId: '20',
    }, db)).rejects.toBeInstanceOf(
      OpportunityScoringV3ApplyScopeRequiredError,
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('persists only to the candidate repository when explicitly applied', async () => {
    const { db } = database()

    await expect(buildOpportunityScoringV3Job({
      env: { OPPORTUNITY_SCORING_V3_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
      dryRun: false,
      now: new Date('2026-08-04T12:00:00.000Z'),
    }, db)).resolves.toMatchObject({ persisted: 1, failed: 0 })
    expect(mockedPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'qualified_needs_enrichment',
        rolloutMode: 'shadow',
        fallbackScoringVersion: 'opportunity-v2',
      }),
      db,
    )
  })

  it('isolates malformed source rows instead of weakening gates', async () => {
    const { db } = database([
      candidateRow({ agencyDnaMatchSnapshotId: 'bad' }),
      candidateRow(),
    ])

    await expect(buildOpportunityScoringV3Job({
      env: { OPPORTUNITY_SCORING_V3_ENABLED: 'true' },
      now: new Date('2026-08-04T12:00:00.000Z'),
    }, db)).resolves.toMatchObject({
      scanned: 2,
      built: 1,
      qualifiedNeedsEnrichment: 1,
      failed: 1,
    })
  })
})
