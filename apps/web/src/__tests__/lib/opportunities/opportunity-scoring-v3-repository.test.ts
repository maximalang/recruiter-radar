import type { QueryResult } from 'pg'

import {
  buildOpportunityScoringV3,
  type OpportunityScoringV3Input,
  type OpportunityScoringV3Result,
} from '@/lib/opportunities/opportunity-scoring-v3'
import {
  OpportunityCandidateProvenanceError,
  OpportunityCandidateReplayConflictError,
  persistOpportunityCandidate,
  type OpportunityCandidateDb,
} from '@/lib/opportunities/opportunity-scoring-v3-repository'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
  rowCount = rows.length,
): QueryResult<Row> {
  return { rowCount, rows }
}

type QueryImplementation = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<Record<string, unknown>>>

function createDb(
  implementation: QueryImplementation = async () => queryResult(),
): { db: OpportunityCandidateDb; query: jest.Mock } {
  const query = jest.fn(implementation)
  return {
    db: {
      query: <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        values?: unknown[],
      ) => query(sql, values) as Promise<QueryResult<Row>>,
    },
    query,
  }
}

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

function candidate(
  overrides: Partial<OpportunityScoringV3Input> = {},
): OpportunityScoringV3Result {
  return buildOpportunityScoringV3(input(overrides))
}

describe('Opportunity Scoring v3 repository', () => {
  it('persists a qualified enrichment candidate and evidence atomically', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(candidate_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO opportunity_candidates')) {
        return queryResult([{ id: '901', candidateGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO opportunity_candidate_evidence')) {
        return queryResult([], 2)
      }
      return queryResult()
    })

    await expect(persistOpportunityCandidate(candidate(), db)).resolves.toEqual({
      candidateId: '901',
      candidateGeneration: 1,
      inserted: true,
      evidenceAttached: 2,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO opportunity_candidates'),
      expect.stringContaining('INSERT INTO opportunity_candidate_evidence'),
    ]))
    expect(statements.join('\n')).not.toMatch(/INSERT INTO opportunities\b/)
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles an exact replay without allocating another generation', async () => {
    const statements: string[] = []
    const draft = candidate()
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('FROM opportunity_candidates') &&
          sql.includes('input_hash')) {
        return queryResult([replayRow(draft)])
      }
      return queryResult()
    })

    await expect(persistOpportunityCandidate(draft, db)).resolves.toEqual({
      candidateId: '901',
      candidateGeneration: 1,
      inserted: false,
      evidenceAttached: 0,
    })
    expect(statements.some((sql) => sql.includes('MAX(candidate_generation)')))
      .toBe(false)
  })

  it('allocates a new immutable generation for a changed evidence input', async () => {
    const { db } = createDb(async (sql) => {
      if (sql.includes('SELECT COALESCE(MAX(candidate_generation)')) {
        return queryResult([{ nextGeneration: 3 }])
      }
      if (sql.includes('INSERT INTO opportunity_candidates')) {
        return queryResult([{ id: '903', candidateGeneration: 3 }])
      }
      return queryResult()
    })

    await expect(persistOpportunityCandidate(candidate({
      evidenceHash: HASH_A,
      propensityScore: 0.3,
      propensityLevel: 'low',
    }), db)).resolves.toMatchObject({
      candidateId: '903',
      candidateGeneration: 3,
      inserted: true,
    })
  })

  it('rejects a tampered score or evidence snapshot before BEGIN', async () => {
    const { db, query } = createDb()
    const valid = candidate()

    await expect(persistOpportunityCandidate({
      ...valid,
      qualityScore: 1,
    }, db)).rejects.toBeInstanceOf(OpportunityCandidateProvenanceError)
    await expect(persistOpportunityCandidate({
      ...valid,
      evidenceSnapshot: {
        ...valid.evidenceSnapshot,
        evidenceIds: ['999'],
      },
    }, db)).rejects.toBeInstanceOf(OpportunityCandidateProvenanceError)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a replay hash that resolves to different tenant lineage', async () => {
    const draft = candidate()
    const { db } = createDb(async (sql) => {
      if (sql.includes('FROM opportunity_candidates') &&
          sql.includes('input_hash')) {
        return queryResult([{
          ...replayRow(draft),
          ownerId: '999',
          agencyDnaMatchSnapshotId: '999',
        }])
      }
      return queryResult()
    })

    await expect(persistOpportunityCandidate(draft, db))
      .rejects.toBeInstanceOf(OpportunityCandidateReplayConflictError)
  })

  it('rolls back the generation when evidence attachment fails', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(candidate_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO opportunity_candidates')) {
        return queryResult([{ id: '901', candidateGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO opportunity_candidate_evidence')) {
        throw new Error('evidence tenant mismatch')
      }
      return queryResult()
    })

    await expect(persistOpportunityCandidate(candidate(), db))
      .rejects.toThrow('evidence tenant mismatch')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })
})

function replayRow(result: OpportunityScoringV3Result) {
  return {
    id: '901',
    candidateGeneration: 1,
    candidateIdentity: result.candidateIdentity,
    ownerId: result.ownerId,
    opportunityMode: result.opportunityMode,
    agencyDnaMatchSnapshotId:
      result.featureSnapshot.source.agencyDnaMatchSnapshotId,
    agencyDnaMatchGeneration:
      result.featureSnapshot.source.agencyDnaMatchGeneration,
    propensitySnapshotId: result.featureSnapshot.source.propensitySnapshotId,
    propensityGeneration: result.featureSnapshot.source.propensityGeneration,
    commercialThesisId: result.featureSnapshot.source.commercialThesisId,
    commercialThesisGeneration:
      result.featureSnapshot.source.commercialThesisGeneration,
    signalEpisodeId: result.featureSnapshot.source.signalEpisodeId,
    signalEpisodeGeneration: result.featureSnapshot.source.signalEpisodeGeneration,
    companyStateSnapshotId: result.featureSnapshot.source.companyStateSnapshotId,
    evidenceHash: result.evidenceHash,
  }
}
