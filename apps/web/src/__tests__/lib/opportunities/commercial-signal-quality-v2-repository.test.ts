import {
  linkCommercialSignalQualityV2Opportunity,
  persistCommercialSignalQualityV2,
  type CommercialSignalQualityV2Db,
} from '@/lib/opportunities/commercial-signal-quality-v2-repository'
import {
  buildCommercialSignalQualityEngineV2,
  type CommercialSignalQualityEngineV2Input,
} from '@/lib/opportunities/commercial-signal-quality-engine-v2'
import { buildEvidenceIndependence } from
  '@/lib/opportunities/commercial-signal-quality-v2'

function engineInput(): CommercialSignalQualityEngineV2Input {
  return {
    decisionAt: '2026-08-08T10:00:00.000Z',
    decisionSource: 'deterministic',
    componentSources: {
      hiringNeed: 'direct',
      hiringFriction: 'derived_deterministic',
      agencyFit: 'derived_deterministic',
      propensity: 'derived_deterministic',
      convergence: 'derived_deterministic',
      economics: 'derived_deterministic',
      marketDifficulty: 'derived_deterministic',
    },
    currentHiringEvidence: { present: true, evidenceIds: ['101'] },
    hiringNeed: positiveComponent(),
    hiringFriction: {
      featureVersion: 'hiring-friction-v1',
      frictionLevel: 'high',
      frictionScore: 0.8,
      coverage: 1,
      positiveReasons: [{ code: 'FRICTION', evidenceIds: ['101'] }],
      negativeReasons: [],
      evidenceIds: ['101'],
      componentValues: {},
      observationStates: { repost_cycles: 'observed' },
    },
    agencyFit: positiveComponent(),
    propensity: {
      featureVersion: 'external-agency-propensity-v2',
      propensityLevel: 'high',
      propensityScore: 0.8,
      confidence: 0.9,
      coverage: 1,
      actionability: 'eligible',
      reasonCodes: ['PROPENSITY'],
      evidenceIds: ['101'],
      affirmativeEvidenceIds: ['101'],
      componentValues: {},
    },
    convergence: {
      featureVersion: 'signal-convergence-v1',
      convergenceScore: 0.8,
      coverage: 1,
      confidence: 0.9,
      independentGroupCount: 1,
      status: 'active',
      components: { coOccurrence: 0, sequence: 0, velocity: 0.8, recency: 1, contradiction: 0 },
      positiveReasons: ['CONVERGENCE'],
      negativeReasons: [],
      eventIds: ['501'],
      evidenceIds: ['101'],
      affirmativeEvidenceIds: ['101'],
      excludedFutureEventIds: [],
    },
    economics: {
      featureVersion: 'commercial-fit-v2', economicsFit: 'unknown',
      componentValue: null, componentConfidence: 0, coverage: 0,
      reasons: ['ECONOMICS_SCOPE_UNKNOWN'], evidenceIds: [],
    },
    marketDifficulty: {
      marketDifficulty: 'unknown', componentValue: null, componentConfidence: 0,
      roleFamily: 'backend', seniority: 'senior', region: 'moscow',
      evidenceDate: null, source: null, evidenceIds: [],
    },
    negativeEvidence: {
      featureVersion: 'negative-evidence-v1', action: 'none', scoreMultiplier: 1,
      confirmedReasons: [], heuristicReasons: [], unknownReasons: [], evidenceIds: [],
      expiredEvidenceIds: [], excludedFutureEvidenceIds: [],
    },
    contact: { corporateContactPathAvailable: false, doNotContact: false, conflict: false, evidenceIds: [] },
    evidence,
  }
}

function result() {
  return buildCommercialSignalQualityEngineV2(engineInput())
}

function positiveComponent() {
  return {
    value: 0.8,
    confidence: 0.9,
    coverage: 1,
    reasonCodes: ['EVIDENCED'],
    evidenceIds: ['101'],
  }
}

const evidence = [{
  evidenceId: '101',
  sourceKind: 'direct' as const,
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
  it('links an opportunity to one explicit quality snapshot without inference', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ opportunity_lineage_id: '601' }], rowCount: 1,
    })
    await expect(linkCommercialSignalQualityV2Opportunity({
      qualitySnapshotId: '501', opportunityLineageId: '601', candidateId: '201',
      organizationId: '301', workspaceId: '401', clientProfileId: '402',
    }, { query } as never)).resolves.toBeUndefined()
    expect(query.mock.calls[0]?.[0]).toContain(
      'ON CONFLICT (opportunity_lineage_id) DO NOTHING',
    )
    expect(query.mock.calls[0]?.[1]).toEqual([
      '501', '601', '201', '301', '401', '402',
    ])
  })

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
        if (sql.includes('INSERT INTO commercial_signal_quality_opportunity_lineage')) {
          return { rows: [{ opportunity_lineage_id: '601' }], rowCount: 1 } as never
        }
        return { rows: [], rowCount: 0 } as never
      },
    }

    await expect(persistCommercialSignalQualityV2({
      opportunityLineageId: '601',
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      engineInput: engineInput(),
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
      '201', '301', '401', '402',
      'commercial-signal-quality-v2', 'heuristic', 'uncalibrated',
    ]))
    expect(evidenceInsert?.values).toEqual(expect.arrayContaining([
      '501', '201', '301', '401', '402', ['101'],
      ['positive'],
      ['direct'],
      [independenceGroup()], ['EVIDENCE_INDEPENDENT'],
    ]))
    expect(calls.some((call) =>
      call.sql.includes('commercial_signal_quality_opportunity_lineage'))).toBe(true)
    expect(calls.map((call) => call.sql)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/UPDATE commercial_signal_quality/i),
      expect.stringMatching(/DELETE FROM commercial_signal_quality/i),
    ]))
  })

  it('keeps distinct unavailable observation states in the replay hash', async () => {
    const hashes: string[] = []
    const db: CommercialSignalQualityV2Db = {
      async query(sql, values) {
        if (sql.includes('SELECT id::TEXT AS id') &&
          sql.includes('commercial_signal_quality_snapshots')) {
          return { rows: [], rowCount: 0 } as never
        }
        if (sql.includes('MAX(quality_generation)')) {
          return { rows: [{ nextGeneration: 1 }], rowCount: 1 } as never
        }
        if (sql.includes('INSERT INTO commercial_signal_quality_snapshots')) {
          hashes.push(String(values?.[14]))
          return { rows: [{ id: '501', qualityGeneration: 1 }], rowCount: 1 } as never
        }
        if (sql.includes('INSERT INTO commercial_signal_quality_evidence')) {
          return { rows: [], rowCount: 1 } as never
        }
        if (sql.includes('INSERT INTO commercial_signal_quality_opportunity_lineage')) {
          return { rows: [{ opportunity_lineage_id: '601' }], rowCount: 1 } as never
        }
        return { rows: [], rowCount: 0 } as never
      },
    }
    const unknown = engineInput()
    unknown.hiringFriction.observationStates.repost_cycles = 'unknown'
    const notConfigured = engineInput()
    notConfigured.hiringFriction.observationStates.repost_cycles = 'not_configured'

    for (const input of [unknown, notConfigured]) {
      await persistCommercialSignalQualityV2({
        opportunityLineageId: '601',
        candidateId: '201', organizationId: '301', workspaceId: '401',
        clientProfileId: '402', validUntil: '2026-09-01T00:00:00.000Z',
        engineInput: input,
        result: buildCommercialSignalQualityEngineV2(input),
        evidence,
      }, db)
    }

    expect(hashes).toHaveLength(2)
    expect(hashes[0]).not.toBe(hashes[1])
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
        if (sql.includes('INSERT INTO commercial_signal_quality_opportunity_lineage')) {
          return { rows: [{ opportunity_lineage_id: '601' }], rowCount: 1 } as never
        }
        return { rows: [], rowCount: 0 } as never
      },
    }

    const persisted = await persistCommercialSignalQualityV2({
      opportunityLineageId: '601',
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      engineInput: engineInput(),
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
      opportunityLineageId: '601',
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      engineInput: engineInput(),
      result: result(),
      evidence: [],
    }, { query: jest.fn() } as never)).rejects.toThrow(/canonical engine input/i)
  })

  it('rejects contradictory status and actionability before opening a transaction', async () => {
    const contradictory = result()
    contradictory.status = 'blocked'

    await expect(persistCommercialSignalQualityV2({
      opportunityLineageId: '601',
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      engineInput: engineInput(),
      result: contradictory,
      evidence,
    }, { query: jest.fn() } as never)).rejects.toThrow(/canonical engine input/i)
  })

  it('rejects a forged actionable snapshot that bypasses canonical gates', async () => {
    const forged = result()
    forged.status = 'qualified_actionable'
    forged.actionability = 'actionable'
    forged.quality.actionable = true
    forged.quality.criticalCoverage = 0.1

    await expect(persistCommercialSignalQualityV2({
      opportunityLineageId: '601',
      candidateId: '201',
      organizationId: '301',
      workspaceId: '401',
      clientProfileId: '402',
      validUntil: '2026-09-01T00:00:00.000Z',
      engineInput: engineInput(),
      result: forged,
      evidence,
    }, { query: jest.fn() } as never)).rejects.toThrow(/canonical engine input/i)
  })
})

function independenceGroup(): string {
  return buildEvidenceIndependence(
    evidence,
    new Date('2026-08-08T10:00:00.000Z'),
  ).groups[0]!.evidenceIndependenceGroup
}
