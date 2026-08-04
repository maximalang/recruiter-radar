import type { QueryResult } from 'pg'

import type { ExternalAgencyPropensityDraft } from '@/lib/opportunities/external-agency-propensity'
import {
  ExternalAgencyPropensityProvenanceError,
  ExternalAgencyPropensityReplayConflictError,
  persistExternalAgencyPropensity,
  type ExternalAgencyPropensityDb,
} from '@/lib/opportunities/external-agency-propensity-repository'

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
): { db: ExternalAgencyPropensityDb; query: jest.Mock } {
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

function propensity(
  overrides: Partial<ExternalAgencyPropensityDraft> = {},
): ExternalAgencyPropensityDraft {
  return {
    organizationId: '10',
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    commercialThesisId: '801',
    commercialThesisGeneration: 1,
    agencyDnaVersion: 2,
    agencyDnaSnapshotHash: 'a'.repeat(64),
    propensityIdentity: 'b'.repeat(64),
    score: 0.82,
    level: 'high',
    positiveReasons: [{
      code: 'VACANCY_ACCELERATION',
      message: 'Hiring accelerated relative to baseline.',
      basis: 'evidence',
      contribution: 0.28,
      evidenceIds: ['201', '202'],
    }],
    negativeReasons: [],
    evidenceIds: ['201', '202'],
    featureSnapshot: {
      episodeType: 'vacancy_acceleration',
      episodeStage: 'active',
      episodeIntensity: 0.82,
      roleFamilies: ['backend', 'platform'],
      roleFamilyCount: 2,
      seniorityDistribution: { senior: 2 },
      hasComplexSeniority: true,
      evidenceCount: 2,
      evidenceSourceFamilies: ['career_page', 'hh'],
      evidenceSourceFamilyCount: 2,
      accountRestriction: null,
      opportunityMode: 'new',
    },
    thesisEvidenceHash: 'c'.repeat(64),
    inputHash: 'd'.repeat(64),
    featureVersion: 'external-agency-propensity-v1',
    ...overrides,
  }
}

describe('External Agency Propensity repository', () => {
  it('persists one tenant-scoped generation and evidence atomically', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(propensity_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO external_agency_propensity_snapshots')) {
        return queryResult([{ id: '901', propensityGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO external_agency_propensity_evidence')) {
        return queryResult([], 2)
      }
      return queryResult()
    })

    await expect(persistExternalAgencyPropensity(propensity(), db)).resolves.toEqual({
      propensitySnapshotId: '901',
      propensityGeneration: 1,
      inserted: true,
      evidenceAttached: 2,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO external_agency_propensity_evidence'),
    ]))
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles exact replay without allocating another generation', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('FROM external_agency_propensity_snapshots') &&
          sql.includes('input_hash')) {
        return queryResult([{
          id: '901',
          propensityGeneration: 1,
          propensityIdentity: 'b'.repeat(64),
          ownerId: '30',
          commercialThesisId: '801',
          commercialThesisGeneration: 1,
          agencyDnaVersion: 2,
          agencyDnaSnapshotHash: 'a'.repeat(64),
          evidenceHash: 'c'.repeat(64),
        }])
      }
      return queryResult()
    })

    await expect(persistExternalAgencyPropensity(propensity(), db)).resolves.toEqual({
      propensitySnapshotId: '901',
      propensityGeneration: 1,
      inserted: false,
      evidenceAttached: 0,
    })
    expect(statements.some((sql) => sql.includes('MAX(propensity_generation)')))
      .toBe(false)
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('allocates the next immutable generation for changed thesis input', async () => {
    const { db } = createDb(async (sql) => {
      if (sql.includes('SELECT COALESCE(MAX(propensity_generation)')) {
        return queryResult([{ nextGeneration: 2 }])
      }
      if (sql.includes('INSERT INTO external_agency_propensity_snapshots')) {
        return queryResult([{ id: '902', propensityGeneration: 2 }])
      }
      return queryResult()
    })

    await expect(persistExternalAgencyPropensity(propensity({
      commercialThesisGeneration: 2,
      inputHash: 'e'.repeat(64),
    }), db)).resolves.toMatchObject({
      propensitySnapshotId: '902',
      propensityGeneration: 2,
      inserted: true,
    })
  })

  it('rejects unsupported or masquerading provenance before BEGIN', async () => {
    const { db, query } = createDb()

    await expect(persistExternalAgencyPropensity(propensity({
      evidenceIds: [],
    }), db)).rejects.toBeInstanceOf(ExternalAgencyPropensityProvenanceError)
    await expect(persistExternalAgencyPropensity(propensity({
      positiveReasons: [{
        code: 'VACANCY_ACCELERATION',
        message: 'Unsupported evidence.',
        basis: 'evidence',
        contribution: 0.28,
        evidenceIds: ['999'],
      }],
    }), db)).rejects.toBeInstanceOf(ExternalAgencyPropensityProvenanceError)
    await expect(persistExternalAgencyPropensity(propensity({
      negativeReasons: [{
        code: 'DO_NOT_CONTACT',
        message: 'Policy restriction.',
        basis: 'policy',
        contribution: -1,
        evidenceIds: ['201'],
      }],
    }), db)).rejects.toBeInstanceOf(ExternalAgencyPropensityProvenanceError)
    await expect(persistExternalAgencyPropensity(propensity({
      featureSnapshot: {
        ...propensity().featureSnapshot,
        evidenceCount: 1,
      },
    }), db)).rejects.toBeInstanceOf(ExternalAgencyPropensityProvenanceError)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a replay hash that resolves to a different source', async () => {
    const { db } = createDb(async (sql) => {
      if (sql.includes('FROM external_agency_propensity_snapshots') &&
          sql.includes('input_hash')) {
        return queryResult([{
          id: '901',
          propensityGeneration: 1,
          propensityIdentity: 'f'.repeat(64),
          ownerId: '30',
          commercialThesisId: '999',
          commercialThesisGeneration: 1,
          agencyDnaVersion: 2,
          agencyDnaSnapshotHash: 'a'.repeat(64),
          evidenceHash: 'c'.repeat(64),
        }])
      }
      return queryResult()
    })

    await expect(persistExternalAgencyPropensity(propensity(), db))
      .rejects.toBeInstanceOf(ExternalAgencyPropensityReplayConflictError)
  })

  it('rolls back the generation when evidence attachment fails', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(propensity_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO external_agency_propensity_snapshots')) {
        return queryResult([{ id: '901', propensityGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO external_agency_propensity_evidence')) {
        throw new Error('evidence tenant mismatch')
      }
      return queryResult()
    })

    await expect(persistExternalAgencyPropensity(propensity(), db))
      .rejects.toThrow('evidence tenant mismatch')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })
})
