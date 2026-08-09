import {
  CommercialSignalQualityV2ApplyScopeRequiredError,
  CommercialSignalQualityV2ShadowScopeRequiredError,
  runCommercialSignalQualityV2ShadowPipeline,
} from '@/lib/opportunities/commercial-signal-quality-v2-job'
import * as builder from
  '@/lib/opportunities/commercial-signal-quality-v2-input-builder'
import * as engine from
  '@/lib/opportunities/commercial-signal-quality-engine-v2'
import * as repository from
  '@/lib/opportunities/commercial-signal-quality-v2-repository'

jest.mock('@/lib/opportunities/commercial-signal-quality-v2-input-builder', () => ({
  buildCommercialSignalQualityV2Input: jest.fn(),
}))
jest.mock('@/lib/opportunities/commercial-signal-quality-engine-v2', () => ({
  buildCommercialSignalQualityEngineV2: jest.fn(),
}))
jest.mock('@/lib/opportunities/commercial-signal-quality-v2-repository', () => ({
  persistCommercialSignalQualityV2: jest.fn(),
}))

function built(overrides: Record<string, unknown> = {}) {
  return {
    opportunityLineageId: '501',
    candidateId: '201',
    candidateGeneration: 1,
    v3Status: 'qualified_actionable',
    v3QualityScore: 0.8,
    archetypes: ['hard_to_fill'],
    organizationId: '301',
    workspaceId: '401',
    clientProfileId: '402',
    validUntil: '2026-09-01T00:00:00.000Z',
    input: {
      evidence: [],
      hiringFriction: { frictionLevel: 'unknown' },
      convergence: { status: 'review' },
      negativeEvidence: { action: 'none' },
    },
    ...overrides,
  } as never
}

function database(lineages: string[] = []) {
  const query = jest.fn(async (text: string) => {
    if (text.includes('FROM commercial_signal_opportunity_lineage')) {
      return {
        rows: lineages.map((opportunityLineageId) => ({ opportunityLineageId })),
        rowCount: lineages.length,
      }
    }
    return { rows: [], rowCount: 0 }
  })
  return { query }
}

describe('Commercial Signal Quality v2 exact-lineage shadow pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(builder.buildCommercialSignalQualityV2Input)
      .mockResolvedValue(built())
    jest.mocked(engine.buildCommercialSignalQualityEngineV2)
      .mockReturnValue({
        status: 'review',
        quality: { qualityCoverage: 0, qualityConfidence: 0 },
        components: {},
        actionabilityIndependence: { coverage: 0 },
      } as never)
    jest.mocked(repository.persistCommercialSignalQualityV2).mockResolvedValue({
      qualitySnapshotId: '601',
      qualityGeneration: 1,
      inserted: true,
      evidenceAttached: 0,
    })
  })

  it('stays dark unless the exact feature flag is true', async () => {
    await expect(runCommercialSignalQualityV2ShadowPipeline({ env: {} }))
      .resolves.toMatchObject({ enabled: false, scanned: 0, built: 0 })
  })

  it('requires tenant and profile scope for persisted-lineage runs', async () => {
    await expect(runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      workspaceId: '401',
    }, database() as never)).rejects.toBeInstanceOf(
      CommercialSignalQualityV2ShadowScopeRequiredError,
    )
  })

  it('requires organization scope before apply', async () => {
    await expect(runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      dryRun: false,
      workspaceId: '401',
      clientProfileId: '402',
    }, database() as never)).rejects.toBeInstanceOf(
      CommercialSignalQualityV2ApplyScopeRequiredError,
    )
  })

  it('bounds dry runs, sets a timeout, and skips already-linked lineages', async () => {
    const db = database()
    const stats = await runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      workspaceId: '401',
      clientProfileId: '402',
      batchSize: 1_000,
    }, db as never)

    expect(stats).toMatchObject({ enabled: true, dryRun: true, scanned: 0 })
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("set_config('statement_timeout'"),
      ['5000ms'],
    )
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/NOT EXISTS[\s\S]+quality_lineage\.opportunity_lineage_id/),
      ['401', '402', null, null, 100],
    )
    expect(db.query).toHaveBeenCalledWith('RESET statement_timeout')
  })

  it('returns a non-mutating cursor so dry-run can inspect later batches', async () => {
    const db = database(['501'])
    const stats = await runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      workspaceId: '401',
      clientProfileId: '402',
      afterLineageId: '500',
    }, db as never)

    expect(stats.nextCursor).toBe('501')
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/lineage\.id > COALESCE\(\$4::BIGINT, 0\)/),
      ['401', '402', null, '500', 25],
    )
    expect(repository.persistCommercialSignalQualityV2).not.toHaveBeenCalled()
  })

  it('builds and persists only the exact scoped lineage', async () => {
    const db = database(['501'])
    const stats = await runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      dryRun: false,
      workspaceId: '401',
      clientProfileId: '402',
      organizationId: '301',
    }, db as never)

    expect(stats).toMatchObject({ scanned: 1, built: 1, persisted: 1, failed: 0 })
    expect(builder.buildCommercialSignalQualityV2Input).toHaveBeenCalledWith(
      '501',
      { workspaceId: '401', clientProfileId: '402', organizationId: '301' },
      expect.anything(),
    )
    expect(repository.persistCommercialSignalQualityV2).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityLineageId: '501',
        workspaceId: '401',
        clientProfileId: '402',
        organizationId: '301',
      }),
      expect.anything(),
    )
  })

  it('exposes only aggregate, PII-free quality telemetry', async () => {
    jest.mocked(engine.buildCommercialSignalQualityEngineV2).mockReturnValue({
      status: 'review',
      quality: {
        qualityCoverage: 0.6,
        qualityConfidence: 0.4,
      },
      components: {
        hiring_need: { value: 0.7, coverage: 1 },
        hiring_friction: { value: null, coverage: 0 },
        agency_fit: { value: 0.8, coverage: 1 },
        external_agency_propensity: { value: 0.5, coverage: 0.5 },
        signal_convergence: { value: 0.4, coverage: 0.5 },
      },
      actionabilityIndependence: { coverage: 0.5 },
    } as never)
    jest.mocked(builder.buildCommercialSignalQualityV2Input)
      .mockResolvedValue(built({
        input: {
          evidence: [],
          hiringFriction: { frictionLevel: 'medium' },
          convergence: { status: 'active' },
          negativeEvidence: { action: 'reduce' },
        },
      }))

    const stats = await runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      workspaceId: '401',
      clientProfileId: '402',
    }, database(['501']) as never)

    expect(stats.telemetry).toEqual({
      v3ToV2: { promoted: 0, demoted: 1, unchanged: 0 },
      qualityCoverage: { low: 0, medium: 1, high: 0 },
      qualityConfidence: { low: 1, medium: 0, high: 0 },
      missingCriticalDimensions: { hiring_friction: 1 },
      frictionLevels: { medium: 1 },
      archetypes: { hard_to_fill: 1 },
      convergenceStatuses: { active: 1 },
      negativeActions: { reduce: 1 },
      independentOriginRatio: { low: 0, medium: 1, high: 0 },
    })
    expect(JSON.stringify(stats.telemetry)).not.toMatch(/candidate|organization|evidence/i)
  })

  it('rejects a builder result from another profile before persistence', async () => {
    jest.mocked(builder.buildCommercialSignalQualityV2Input)
      .mockResolvedValue(built({ clientProfileId: '999' }))
    const stats = await runCommercialSignalQualityV2ShadowPipeline({
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      dryRun: false,
      workspaceId: '401',
      clientProfileId: '402',
      organizationId: '301',
    }, database(['501']) as never)

    expect(stats).toMatchObject({ scanned: 1, built: 0, failed: 1 })
    expect(repository.persistCommercialSignalQualityV2).not.toHaveBeenCalled()
  })
})
