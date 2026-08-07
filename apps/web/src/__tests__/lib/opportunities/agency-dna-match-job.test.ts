import type { QueryResult } from 'pg'

jest.mock('@/lib/opportunities/agency-dna-match-repository', () => ({
  persistAgencyDnaMatch: jest.fn(),
}))

import {
  AgencyDnaMatchApplyScopeRequiredError,
  buildAgencyDnaMatchJob,
  type AgencyDnaMatchJobDb,
} from '@/lib/opportunities/agency-dna-match-job'
import { persistAgencyDnaMatch } from '@/lib/opportunities/agency-dna-match-repository'

const mockedPersist = jest.mocked(persistAgencyDnaMatch)

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
): { db: AgencyDnaMatchJobDb; query: jest.Mock } {
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
    propensitySnapshotId: '50',
    propensityGeneration: 2,
    propensityIdentity: 'a'.repeat(64),
    propensityInputHash: 'b'.repeat(64),
    propensityEvidenceHash: 'c'.repeat(64),
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
    evidencedTechnologyQualificationTags: [],
    evidencedEngagementTypes: [],
    remoteStatus: null,
    companySizeBucket: null,
    estimatedFeeMinor: null,
    estimatedOpportunityValueMinor: null,
    agencyDnaVersion: 7,
    agencyDnaSnapshotHash: 'd'.repeat(64),
    agencyDnaSourceSnapshot: {
      profile: { roles: ['data'] },
      accountRestrictions: [],
    },
    specialization: 'data',
    roles: ['data'],
    technologyQualificationTags: [],
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

describe('Agency DNA Match v2 dark job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPersist.mockResolvedValue({
      matchSnapshotId: '901',
      matchGeneration: 1,
      inserted: true,
      evidenceAttached: 2,
    })
  })

  it('stays dark unless its independent flag is exactly true', async () => {
    const { db, query } = createJobDb()

    await expect(buildAgencyDnaMatchJob({ env: {} }, db)).resolves
      .toMatchObject({ enabled: false, scanned: 0, persisted: 0 })
    await expect(buildAgencyDnaMatchJob({
      env: { AGENCY_DNA_MATCH_V2_ENABLED: ' TRUE ' },
    }, db)).resolves.toMatchObject({ enabled: false })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires explicit workspace and organization before apply mode', async () => {
    const { db } = createJobDb()
    await expect(buildAgencyDnaMatchJob({
      env: { AGENCY_DNA_MATCH_V2_ENABLED: 'true' },
      organizationId: '10',
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(AgencyDnaMatchApplyScopeRequiredError)
    await expect(buildAgencyDnaMatchJob({
      env: { AGENCY_DNA_MATCH_V2_ENABLED: 'true' },
      workspaceId: '20',
      dryRun: false,
    }, db)).rejects.toBeInstanceOf(AgencyDnaMatchApplyScopeRequiredError)
  })

  it('previews a bounded tenant-safe build from exact latest propensity', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = []
    const { db } = createJobDb(async (sql, values) => {
      statements.push({ sql, values })
      return sql.includes('FROM latest_propensity propensity')
        ? queryResult([candidateRow()])
        : queryResult()
    })

    await expect(buildAgencyDnaMatchJob({
      env: { AGENCY_DNA_MATCH_V2_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
    }, db)).resolves.toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      built: 1,
      strong: 1,
      persisted: 0,
      failed: 0,
    })
    expect(mockedPersist).not.toHaveBeenCalled()
    const load = statements.find((item) =>
      item.sql.includes('FROM latest_propensity propensity'))
    expect(load?.sql).toContain('agency_dna_full_snapshot(profile)')
    expect(load?.sql).toContain('JOIN signal_episodes episode')
    expect(load?.sql).toContain('JOIN orgs org')
    expect(load?.sql).toContain('agency_dna_match_snapshots')
    expect(load?.values).toEqual(expect.arrayContaining(['20', '10', 10]))
  })

  it('persists only in apply mode and reports exact replay', async () => {
    const { db } = createJobDb(async (sql) =>
      sql.includes('FROM latest_propensity propensity')
        ? queryResult([candidateRow()])
        : queryResult())
    mockedPersist.mockResolvedValueOnce({
      matchSnapshotId: '901',
      matchGeneration: 1,
      inserted: false,
      evidenceAttached: 0,
    })

    await expect(buildAgencyDnaMatchJob({
      env: { AGENCY_DNA_MATCH_V2_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
      dryRun: false,
    }, db)).resolves.toMatchObject({ persisted: 0, replayed: 1, failed: 0 })
    expect(mockedPersist).toHaveBeenCalledTimes(1)
  })

  it('isolates malformed candidates and counts every deterministic level', async () => {
    const { db } = createJobDb(async (sql) =>
      sql.includes('FROM latest_propensity propensity')
        ? queryResult([
          candidateRow({ propensitySnapshotId: 'bad' }),
          candidateRow({ propensitySnapshotId: '51', propensityInputHash: 'e'.repeat(64) }),
        ])
        : queryResult())

    await expect(buildAgencyDnaMatchJob({
      env: { AGENCY_DNA_MATCH_V2_ENABLED: 'true' },
      workspaceId: '20',
      organizationId: '10',
    }, db)).resolves.toMatchObject({
      scanned: 2,
      built: 1,
      strong: 1,
      failed: 1,
    })
  })
})
