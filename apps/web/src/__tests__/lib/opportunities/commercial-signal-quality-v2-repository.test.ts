import {
  persistCommercialSignalQualityV2,
  type CommercialSignalQualityV2Db,
} from '@/lib/opportunities/commercial-signal-quality-v2-repository'
import type { CommercialSignalQualityEngineV2Result } from
  '@/lib/opportunities/commercial-signal-quality-engine-v2'

function result(): CommercialSignalQualityEngineV2Result {
  return {
    engineVersion: 'commercial-signal-quality-engine-v2',
    featureVersions: {
      quality: 'commercial-signal-quality-v2',
      friction: 'hiring-friction-v1',
      propensity: 'external-agency-propensity-v2',
      convergence: 'signal-convergence-v1',
      economics: 'commercial-fit-v2',
      negativeEvidence: 'negative-evidence-v1',
    },
    quality: {
      qualityScore: 0.82,
      qualityCoverage: 0.9,
      qualityConfidence: 0.85,
      criticalCoverage: 0.9,
      actionable: true,
      reasonCodes: ['QUALITY_EVIDENCED'],
      evidenceIds: ['101'],
    },
    status: 'qualified_actionable',
    actionability: 'actionable',
    reasonCodes: ['QUALITY_EVIDENCED'],
    evidenceIds: ['101'],
    independence: {
      groups: [{
        evidenceIndependenceGroup: 'a'.repeat(64),
        evidenceIds: ['101'],
        sourceFamilies: ['career-pages'],
        sourceDomains: ['example.ru'],
        reasonCodes: ['EVIDENCE_INDEPENDENT'],
      }],
      independentGroupCount: 1,
      coverage: 1,
      confidence: 0.5,
      reasonCodes: ['EVIDENCE_INDEPENDENT'],
      excludedFutureEvidenceIds: [],
    },
    components: {
      hiring_need: {
        value: 0.9,
        confidence: 0.9,
        coverage: 1,
        reasonCodes: ['HIRING_NEED_EVIDENCED'],
        evidenceIds: ['101'],
      },
    } as never,
    modelType: 'heuristic',
    calibrationStatus: 'uncalibrated',
  }
}

const evidence = [{
  evidenceId: '101',
  sourceFamily: 'career-pages',
  sourceDomain: 'example.ru',
  upstreamOrigin: 'ats:example:101',
  canonicalUrl: 'https://example.ru/101',
  vacancyFingerprint: 'vacancy-101',
  publicationFingerprint: 'publication-101',
  organizationDomain: 'example.ru',
  contentFingerprint: 'b'.repeat(64),
  observedAt: '2026-08-08T09:00:00.000Z',
}]

describe('Commercial Signal Quality v2 repository', () => {
  it('persists one append-only generation with exact candidate and evidence lineage', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    const db: CommercialSignalQualityV2Db = {
      async query(sql, values) {
        calls.push({ sql, values })
        if (sql.includes('SELECT id::TEXT AS id') &&
          sql.includes('commercial_signal_quality_snapshots')) {
          return { rows: [], rowCount: 0 } as never
        }
        if (sql.includes('MAX(quality_generation)')) {
          return { rows: [{ nextGeneration: 1 }], rowCount: 1 } as never
        }
        if (sql.includes('INSERT INTO commercial_signal_quality_snapshots')) {
          return { rows: [{ id: '501', qualityGeneration: 1 }], rowCount: 1 } as never
        }
        if (sql.includes('INSERT INTO commercial_signal_quality_evidence')) {
          return { rows: [], rowCount: 1 } as never
        }
        return { rows: [], rowCount: 0 } as never
      },
    }

    await expect(persistCommercialSignalQualityV2({
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      result: result(),
      evidence,
    }, db)).resolves.toEqual({
      qualitySnapshotId: '501',
      qualityGeneration: 1,
      inserted: true,
      evidenceAttached: 1,
    })

    const snapshotInsert = calls.find((call) =>
      call.sql.includes('INSERT INTO commercial_signal_quality_snapshots'))
    const evidenceInsert = calls.find((call) =>
      call.sql.includes('INSERT INTO commercial_signal_quality_evidence'))
    expect(snapshotInsert?.values).toEqual(expect.arrayContaining([
      '201', '301', '401', '402', 0.82, 0.9, 0.85,
      'commercial-signal-quality-v2', 'heuristic', 'uncalibrated',
    ]))
    expect(evidenceInsert?.values).toEqual(expect.arrayContaining([
      '501', '201', '301', '401', '402', ['101'],
      ['a'.repeat(64)], ['EVIDENCE_INDEPENDENT'],
    ]))
    expect(calls.map((call) => call.sql)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/UPDATE commercial_signal_quality/i),
      expect.stringMatching(/DELETE FROM commercial_signal_quality/i),
    ]))
  })

  it('returns an exact replay without creating another generation', async () => {
    const calls: string[] = []
    const db: CommercialSignalQualityV2Db = {
      async query(sql) {
        calls.push(sql)
        if (sql.includes('SELECT id::TEXT AS id') &&
          sql.includes('commercial_signal_quality_snapshots')) {
          return {
            rows: [{ id: '501', qualityGeneration: 3 }],
            rowCount: 1,
          } as never
        }
        return { rows: [], rowCount: 0 } as never
      },
    }

    const persisted = await persistCommercialSignalQualityV2({
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      result: result(),
      evidence,
    }, db)

    expect(persisted).toEqual({
      qualitySnapshotId: '501',
      qualityGeneration: 3,
      inserted: false,
      evidenceAttached: 0,
    })
    expect(calls.some((sql) =>
      sql.includes('INSERT INTO commercial_signal_quality_snapshots'))).toBe(false)
  })

  it('rejects persistence when exact evidence provenance is incomplete', async () => {
    await expect(persistCommercialSignalQualityV2({
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      result: result(),
      evidence: [],
    }, { query: jest.fn() } as never)).rejects.toThrow(/lineage/i)
  })

  it('rejects contradictory status and actionability before opening a transaction', async () => {
    const contradictory = result()
    contradictory.status = 'blocked'

    await expect(persistCommercialSignalQualityV2({
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      result: contradictory,
      evidence,
    }, { query: jest.fn() } as never)).rejects.toThrow(/inconsistent/i)
  })
})
