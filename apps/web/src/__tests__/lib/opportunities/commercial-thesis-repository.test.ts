import type { QueryResult } from 'pg'

import type { CommercialThesisDraft } from '@/lib/opportunities/commercial-thesis'
import {
  persistCommercialThesis,
  CommercialThesisProvenanceError,
  type CommercialThesisDb,
} from '@/lib/opportunities/commercial-thesis-repository'

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
): { db: CommercialThesisDb; query: jest.Mock } {
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

function thesis(
  overrides: Partial<CommercialThesisDraft> = {},
): CommercialThesisDraft {
  const supported = [{
    classification: 'confirmed_fact' as const,
    code: 'vacancy_acceleration_observed',
    text: 'Hiring activity accelerated relative to baseline.',
    evidenceRefs: ['201'],
  }]
  const unknown = [{
    classification: 'unknown' as const,
    code: 'agency_context_not_evaluated',
    text: 'Agency fit is unknown.',
    evidenceRefs: [],
  }]
  return {
    organizationId: '10',
    signalEpisodeId: '701',
    signalEpisodeGeneration: 1,
    thesisIdentity: 'a'.repeat(64),
    whatChanged: supported,
    whyItMatters: supported,
    probableHiringProblem: supported,
    whyExternalAgencyMayBeNeeded: supported,
    whyThisAgencyFits: unknown,
    whyNow: supported,
    recommendedService: supported,
    recommendedPersona: supported,
    recommendedAngle: supported,
    risks: supported,
    limitations: unknown,
    evidenceRefs: ['201'],
    evidenceHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    engineVersion: 'commercial-thesis-v1',
    ...overrides,
  }
}

describe('Commercial Thesis repository', () => {
  it('persists one immutable generation and evidence atomically', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(thesis_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO commercial_theses')) {
        return queryResult([{ id: '801', thesisGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO commercial_thesis_evidence')) {
        return queryResult([], 1)
      }
      return queryResult()
    })

    await expect(persistCommercialThesis(thesis(), db)).resolves.toEqual({
      thesisId: '801',
      thesisGeneration: 1,
      inserted: true,
      evidenceAttached: 1,
    })
    expect(statements[0]).toBe('BEGIN')
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining('INSERT INTO commercial_thesis_evidence'),
    ]))
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('reconciles exact replay without allocating a generation', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('FROM commercial_theses') && sql.includes('input_hash')) {
        return queryResult([{ id: '801', thesisGeneration: 1 }])
      }
      return queryResult()
    })

    await expect(persistCommercialThesis(thesis(), db)).resolves.toEqual({
      thesisId: '801',
      thesisGeneration: 1,
      inserted: false,
      evidenceAttached: 0,
    })
    expect(statements.some((sql) => sql.includes('MAX(thesis_generation)')))
      .toBe(false)
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('allocates the next generation for a changed source episode', async () => {
    const { db } = createDb(async (sql) => {
      if (sql.includes('SELECT COALESCE(MAX(thesis_generation)')) {
        return queryResult([{ nextGeneration: 2 }])
      }
      if (sql.includes('INSERT INTO commercial_theses')) {
        return queryResult([{ id: '802', thesisGeneration: 2 }])
      }
      return queryResult()
    })

    await expect(persistCommercialThesis(thesis({
      signalEpisodeId: '702',
      signalEpisodeGeneration: 2,
      inputHash: 'd'.repeat(64),
    }), db)).resolves.toMatchObject({
      thesisId: '802',
      thesisGeneration: 2,
      inserted: true,
    })
  })

  it('rejects missing evidence and malformed statement sections before BEGIN', async () => {
    const { db, query } = createDb()
    await expect(persistCommercialThesis(thesis({ evidenceRefs: [] }), db))
      .rejects.toBeInstanceOf(CommercialThesisProvenanceError)
    await expect(persistCommercialThesis(thesis({ whatChanged: [] }), db))
      .rejects.toBeInstanceOf(CommercialThesisProvenanceError)
    expect(query).not.toHaveBeenCalled()
  })

  it('rolls back the generation when evidence attachment fails', async () => {
    const statements: string[] = []
    const { db } = createDb(async (sql) => {
      statements.push(sql)
      if (sql.includes('SELECT COALESCE(MAX(thesis_generation)')) {
        return queryResult([{ nextGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO commercial_theses')) {
        return queryResult([{ id: '801', thesisGeneration: 1 }])
      }
      if (sql.includes('INSERT INTO commercial_thesis_evidence')) {
        throw new Error('evidence source mismatch')
      }
      return queryResult()
    })

    await expect(persistCommercialThesis(thesis(), db))
      .rejects.toThrow('evidence source mismatch')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })
})
