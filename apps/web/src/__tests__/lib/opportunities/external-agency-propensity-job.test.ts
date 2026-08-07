import type { QueryResult } from 'pg'

jest.mock('@/lib/opportunities/external-agency-propensity-repository', () => ({
  persistExternalAgencyPropensity: jest.fn(),
}))

import {
  buildExternalAgencyPropensityJob,
  ExternalAgencyPropensityApplyScopeRequiredError,
  type ExternalAgencyPropensityJobDb,
} from '@/lib/opportunities/external-agency-propensity-job'
import { persistExternalAgencyPropensity } from '@/lib/opportunities/external-agency-propensity-repository'

const mockedPersist = jest.mocked(persistExternalAgencyPropensity)
const NOW = new Date('2026-08-04T12:00:00.000Z')

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = [],
): QueryResult<Row> {
  return { rowCount: rows.length, rows }
}

type JobQueryImplementation = (
  sql: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>

function createJobDb(
  implementation: JobQueryImplementation = async () => queryResult(),
): { db: ExternalAgencyPropensityJobDb; query: jest.Mock } {
  const query = jest.fn(implementation)
  return {
    db: {
      query: <Row = Record<string, unknown>>(
        sql: string,
        values?: readonly unknown[],
      ) => query(sql, values) as Promise<QueryResult<Row>>,
      release: jest.fn(),
    },
    query,
  }
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: '10',
    workspaceId: '20',
    ownerId: '30',
    clientProfileId: '40',
    commercialThesisId: '801',
    commercialThesisGeneration: 1,
    thesisIdentity: 'a'.repeat(64),
    thesisInputHash: 'b'.repeat(64),
    thesisEvidenceHash: 'c'.repeat(64),
    agencyDnaVersion: 1,
    agencyDnaSnapshotHash: 'd'.repeat(64),
    episodeType: 'vacancy_acceleration',
    episodeIntensity: 0.82,
    episodeLastSeenAt: '2026-08-04T10:00:00.000Z',
    episodeValidUntil: '2026-08-25T10:00:00.000Z',
    roleFamilies: ['backend', 'platform'],
    seniorityDistribution: { senior: 3 },
    evidenceIds: ['201', '202'],
    evidenceSourceFamilies: ['career-pages', 'hh'],
    accountRestriction: null,
    ...overrides,
  }
}

describe('External Agency Propensity v1 job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockResolvedValue({
      propensitySnapshotId: '901',
      propensityGeneration: 1,
      inserted: true,
      evidenceAttached: 2,
    })
  })

  it('stays dark unless its independent flag is exactly true', async () => {
    const { db, query } = createJobDb()
    await expect(buildExternalAgencyPropensityJob({ env: {} }, db))
      .resolves.toMatchObject({ enabled: false, scanned: 0, persisted: 0 })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires explicit workspace and organization before apply mode', async () => {
    const { db } = createJobDb()
    await expect(buildExternalAgencyPropensityJob({
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      organizationId: '10',
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(ExternalAgencyPropensityApplyScopeRequiredError)
    await expect(buildExternalAgencyPropensityJob({
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      workspaceId: '20',
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(ExternalAgencyPropensityApplyScopeRequiredError)
  })

  it('defaults to a bounded tenant-safe dry-run over latest theses', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = []
    const { db } = createJobDb(async (sql, values) => {
      statements.push({ sql, values })
      if (sql.includes('FROM latest_theses thesis')) {
        return queryResult([candidateRow()])
      }
      return queryResult()
    })

    await expect(buildExternalAgencyPropensityJob({
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
      now: NOW,
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      built: 1,
      high: 1,
      persisted: 0,
      failed: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
    const load = statements.find((item) => item.sql.includes('FROM latest_theses thesis'))
    expect(load?.sql).toContain('profile.workspace_id')
    expect(load?.sql).toContain('commercial_thesis_evidence')
    expect(load?.sql).toContain('external_agency_propensity_snapshots')
    expect(load?.values).toEqual(expect.arrayContaining(['20', '10', 10]))
  })

  it('persists only in apply mode and reports exact replay', async () => {
    const { db } = createJobDb(async (sql) => sql.includes('FROM latest_theses thesis')
      ? queryResult([candidateRow()])
      : queryResult())
    mockedPersist.mockResolvedValueOnce({
      propensitySnapshotId: '901',
      propensityGeneration: 1,
      inserted: false,
      evidenceAttached: 0,
    })

    await expect(buildExternalAgencyPropensityJob({
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
      dryRun: false,
      now: NOW,
    }, db)).resolves.toMatchObject({ persisted: 0, replayed: 1, failed: 0 })
    expect(mockedPersist).toHaveBeenCalledTimes(1)
  })

  it('isolates candidate failures and preserves deterministic level counts', async () => {
    const { db } = createJobDb(async (sql) => sql.includes('FROM latest_theses thesis')
      ? queryResult([
        candidateRow({ commercialThesisId: 'bad' }),
        candidateRow({ commercialThesisId: '802', thesisInputHash: 'e'.repeat(64) }),
      ])
      : queryResult())

    await expect(buildExternalAgencyPropensityJob({
      env: { EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
      now: NOW,
    }, db)).resolves.toMatchObject({
      scanned: 2,
      built: 1,
      high: 1,
      failed: 1,
    })
  })
})
