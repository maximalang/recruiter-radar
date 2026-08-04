import type { QueryResult } from 'pg'

import {
  buildAgencyDnaMatch,
  type AgencyDnaMatchDraft,
  type AgencyDnaMatchInput,
} from '@/lib/opportunities/agency-dna-match'
import {
  AgencyDnaMatchProvenanceError,
  AgencyDnaMatchReplayConflictError,
  persistAgencyDnaMatch,
  type AgencyDnaMatchDb,
} from '@/lib/opportunities/agency-dna-match-repository'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

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
): { db: AgencyDnaMatchDb; query: jest.Mock } {
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

function matchInput(
  overrides: Partial<AgencyDnaMatchInput> = {},
): AgencyDnaMatchInput {
  return {
    organizationId: '10',
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    propensitySnapshotId: '50',
    propensityGeneration: 2,
    propensityIdentity: HASH_A,
    propensityInputHash: HASH_B,
    propensityEvidenceHash: HASH_C,
    propensityFeatureVersion: 'external-agency-propensity-v1',
    propensityScore: 0.82,
    propensityLevel: 'high',
    episodeStage: 'active',
    evidenceSourceFamilyCount: 2,
    evidenceIds: ['101', '102'],
    roleFamilies: ['data'],
    seniorityDistribution: { senior: 2 },
    episodeRegions: ['moscow'],
    organizationIndustry: 'fintech',
    organizationCity: 'moscow',
    organizationCountry: 'ru',
    evidencedTechnologyQualificationTags: ['python'],
    evidencedServiceTypes: ['permanent'],
    evidencedEngagementTypes: [],
    remoteStatus: null,
    companySizeBucket: null,
    estimatedFeeMinor: null,
    estimatedOpportunityValueMinor: null,
    agencyDnaVersion: 7,
    agencyDnaSnapshotHash: HASH_A,
    agencyDnaSourceSnapshot: {
      profile: { roles: ['data'], currentCapacity: 'normal' },
      accountRestrictions: [],
    },
    specialization: 'data',
    roles: ['data'],
    technologyQualificationTags: ['python'],
    industries: ['fintech'],
    targetCity: 'moscow',
    preferredRegions: ['moscow'],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: true,
    serviceTypes: ['permanent'],
    targetSeniorities: ['senior'],
    minimumFeeMinor: null,
    averageFeeMinor: null,
    minimumOpportunityValueMinor: null,
    preferredEngagementTypes: [],
    companySizes: [],
    hiringMode: 'specialist',
    undesirableHiringTypes: [],
    currentCapacity: 'normal',
    caseStudies: [],
    accountRestriction: null,
    ...overrides,
  }
}

function match(overrides: Partial<AgencyDnaMatchDraft> = {}): AgencyDnaMatchDraft {
  return { ...buildAgencyDnaMatch(matchInput()), ...overrides }
}

describe('Agency DNA Match v2 repository', () => {
  it('persists one tenant-scoped generation and evidence atomically', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(match_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO agency_dna_match_snapshots')) {
        return queryResult([{ id: '901', matchGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO agency_dna_match_evidence')) {
        return queryResult([], 2)
      }
      return queryResult()
    })

    await expect(persistAgencyDnaMatch(match(), db)).resolves.toEqual({
      matchSnapshotId: '901',
      matchGeneration: 1,
      inserted: true,
      evidenceAttached: 2,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('agency_dna_snapshot'),
      expect.stringContaining('INSERT INTO agency_dna_match_evidence'),
    ]))
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles an exact replay without allocating another generation', async () => {
    const statements: string[] = []
    const draft = match()
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('FROM agency_dna_match_snapshots') &&
          sql.includes('input_hash')) {
        return queryResult([{
          id: '901',
          matchGeneration: 1,
          matchIdentity: draft.matchIdentity,
          ownerId: '30',
          propensitySnapshotId: '50',
          propensityGeneration: 2,
          agencyDnaVersion: 7,
          agencyDnaSnapshotHash: HASH_A,
          evidenceHash: HASH_C,
        }])
      }
      return queryResult()
    })

    await expect(persistAgencyDnaMatch(draft, db)).resolves.toEqual({
      matchSnapshotId: '901',
      matchGeneration: 1,
      inserted: false,
      evidenceAttached: 0,
    })
    expect(statements.some((sql) => sql.includes('MAX(match_generation)')))
      .toBe(false)
  })

  it('allocates the next immutable generation for changed input', async () => {
    const { db } = createDb(async (sql) => {
      if (sql.includes('SELECT COALESCE(MAX(match_generation)')) {
        return queryResult([{ nextGeneration: 3 }])
      }
      if (sql.includes('INSERT INTO agency_dna_match_snapshots')) {
        return queryResult([{ id: '903', matchGeneration: 3 }])
      }
      return queryResult()
    })

    await expect(persistAgencyDnaMatch(match({ inputHash: 'd'.repeat(64) }), db))
      .resolves.toMatchObject({
        matchSnapshotId: '903',
        matchGeneration: 3,
        inserted: true,
      })
  })

  it('rejects masquerading provenance and inconsistent policy before BEGIN', async () => {
    const { db, query } = createDb()
    const valid = match()

    await expect(persistAgencyDnaMatch(match({ evidenceIds: [] }), db))
      .rejects.toBeInstanceOf(AgencyDnaMatchProvenanceError)
    await expect(persistAgencyDnaMatch(match({
      reasons: [{
        ...valid.reasons[0],
        basis: 'evidence',
        evidenceIds: ['999'],
      }],
    }), db)).rejects.toBeInstanceOf(AgencyDnaMatchProvenanceError)
    await expect(persistAgencyDnaMatch(match({
      unknownDimensions: ['role_family'],
    }), db)).rejects.toBeInstanceOf(AgencyDnaMatchProvenanceError)
    await expect(persistAgencyDnaMatch(match({
      selectionPolicy: { ...valid.selectionPolicy, minimumFitScore: 0.1 },
    }), db)).rejects.toBeInstanceOf(AgencyDnaMatchProvenanceError)
    await expect(persistAgencyDnaMatch(match({
      featureSnapshot: {
        ...valid.featureSnapshot,
        propensity: { ...valid.featureSnapshot.propensity, snapshotId: '999' },
      },
    }), db)).rejects.toBeInstanceOf(AgencyDnaMatchProvenanceError)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a replay hash that resolves to a different source', async () => {
    const draft = match()
    const { db } = createDb(async (sql) => {
      if (sql.includes('FROM agency_dna_match_snapshots') &&
          sql.includes('input_hash')) {
        return queryResult([{
          id: '901',
          matchGeneration: 1,
          matchIdentity: 'f'.repeat(64),
          ownerId: '999',
          propensitySnapshotId: '999',
          propensityGeneration: 2,
          agencyDnaVersion: 7,
          agencyDnaSnapshotHash: HASH_A,
          evidenceHash: HASH_C,
        }])
      }
      return queryResult()
    })

    await expect(persistAgencyDnaMatch(draft, db))
      .rejects.toBeInstanceOf(AgencyDnaMatchReplayConflictError)
  })

  it('rolls back the generation when evidence attachment fails', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(match_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO agency_dna_match_snapshots')) {
        return queryResult([{ id: '901', matchGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO agency_dna_match_evidence')) {
        throw new Error('evidence tenant mismatch')
      }
      return queryResult()
    })

    await expect(persistAgencyDnaMatch(match(), db))
      .rejects.toThrow('evidence tenant mismatch')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })
})
