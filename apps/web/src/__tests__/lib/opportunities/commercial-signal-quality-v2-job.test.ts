import {
  CommercialSignalQualityV2ApplyScopeRequiredError,
  runCommercialSignalQualityV2Shadow,
  type CommercialSignalQualityV2ShadowItem,
} from '@/lib/opportunities/commercial-signal-quality-v2-job'
import * as repository from
  '@/lib/opportunities/commercial-signal-quality-v2-repository'
import type { CommercialSignalQualityEngineV2Input } from
  '@/lib/opportunities/commercial-signal-quality-engine-v2'

jest.mock('@/lib/opportunities/commercial-signal-quality-v2-repository', () => ({
  persistCommercialSignalQualityV2: jest.fn(),
}))

function item(): CommercialSignalQualityV2ShadowItem {
  return {
    candidateId: '201',
    organizationId: '301',
    workspaceId: '401',
    clientProfileId: '402',
    validUntil: '2026-09-01T00:00:00.000Z',
    input: engineInput(),
  }
}

function engineInput(): CommercialSignalQualityEngineV2Input {
  const evidence = [{
    evidenceId: '101',
    sourceKind: 'direct' as const,
    sourceFamily: 'career-pages',
    sourceDomain: 'example.ru',
    upstreamOrigin: 'origin:101',
    canonicalUrl: 'https://example.ru/101',
    vacancyFingerprint: 'a'.repeat(64),
    publicationFingerprint: 'p-101',
    organizationDomain: 'example.ru',
    contentFingerprint: 'a'.repeat(64),
    observedAt: '2026-08-08T09:00:00.000Z',
  }, {
    evidenceId: '102',
    sourceKind: 'official' as const,
    sourceFamily: 'corporate-contacts',
    sourceDomain: 'example.ru',
    upstreamOrigin: 'origin:contact',
    canonicalUrl: 'https://example.ru/contact',
    vacancyFingerprint: null,
    publicationFingerprint: null,
    organizationDomain: 'example.ru',
    contentFingerprint: 'b'.repeat(64),
    observedAt: '2026-08-08T09:00:00.000Z',
  }]
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
    hiringNeed: component(0.9),
    hiringFriction: {
      featureVersion: 'hiring-friction-v1',
      frictionLevel: 'high',
      frictionScore: 0.85,
      coverage: 1,
      positiveReasons: [{ code: 'FRICTION', evidenceIds: ['101'] }],
      negativeReasons: [],
      evidenceIds: ['101'],
      componentValues: {},
    },
    agencyFit: component(0.9),
    propensity: {
      featureVersion: 'external-agency-propensity-v2',
      propensityLevel: 'high',
      propensityScore: 0.9,
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
      convergenceScore: 0.85,
      coverage: 1,
      confidence: 0.9,
      independentGroupCount: 1,
      status: 'active',
      components: {
        coOccurrence: 0,
        sequence: 0,
        velocity: 0.8,
        recency: 1,
        contradiction: 0,
      },
      positiveReasons: ['CONVERGENCE'],
      negativeReasons: [],
      eventIds: ['501'],
      evidenceIds: ['101'],
      affirmativeEvidenceIds: ['101'],
      excludedFutureEventIds: [],
    },
    economics: {
      featureVersion: 'commercial-fit-v2',
      economicsFit: 'unknown',
      componentValue: null,
      componentConfidence: 0,
      coverage: 0,
      reasons: ['ECONOMICS_SCOPE_UNKNOWN'],
      evidenceIds: [],
    },
    marketDifficulty: {
      marketDifficulty: 'unknown',
      componentValue: null,
      componentConfidence: 0,
      roleFamily: 'backend',
      seniority: 'senior',
      region: 'moscow',
      evidenceDate: null,
      source: null,
      evidenceIds: [],
    },
    negativeEvidence: {
      featureVersion: 'negative-evidence-v1',
      action: 'none',
      scoreMultiplier: 1,
      confirmedReasons: [],
      heuristicReasons: [],
      unknownReasons: [],
      evidenceIds: [],
      expiredEvidenceIds: [],
      excludedFutureEvidenceIds: [],
    },
    contact: {
      corporateContactPathAvailable: true,
      doNotContact: false,
      conflict: false,
      evidenceIds: ['102'],
    },
    evidence,
  }
}

function component(value: number) {
  return {
    value,
    confidence: 0.9,
    coverage: 1,
    reasonCodes: ['EVIDENCED'],
    evidenceIds: ['101'],
  }
}

describe('Commercial Signal Quality v2 shadow coordinator', () => {
  beforeEach(() => jest.clearAllMocks())

  it('stays dark unless the exact feature flag is true', async () => {
    await expect(runCommercialSignalQualityV2Shadow([item()], {
      env: {},
    })).resolves.toMatchObject({ enabled: false, scanned: 0, built: 0 })
  })

  it('builds in dry-run without persistence by default', async () => {
    const stats = await runCommercialSignalQualityV2Shadow([item()], {
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
    })

    expect(stats).toMatchObject({
      enabled: true,
      dryRun: true,
      scanned: 1,
      built: 1,
      persisted: 0,
      failed: 0,
    })
    expect(repository.persistCommercialSignalQualityV2).not.toHaveBeenCalled()
  })

  it('requires exact workspace and organization scope before apply', async () => {
    await expect(runCommercialSignalQualityV2Shadow([item()], {
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      dryRun: false,
    }, { query: jest.fn() } as never)).rejects.toBeInstanceOf(
      CommercialSignalQualityV2ApplyScopeRequiredError,
    )
  })

  it('persists only matching scoped items', async () => {
    jest.mocked(repository.persistCommercialSignalQualityV2).mockResolvedValue({
      qualitySnapshotId: '601',
      qualityGeneration: 1,
      inserted: true,
      evidenceAttached: 1,
    })
    const stats = await runCommercialSignalQualityV2Shadow([
      item(),
      { ...item(), candidateId: '202', organizationId: '999' },
    ], {
      env: { COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED: 'true' },
      dryRun: false,
      workspaceId: '401',
      organizationId: '301',
    }, { query: jest.fn() } as never)

    expect(stats).toMatchObject({ scanned: 1, built: 1, persisted: 1 })
    expect(repository.persistCommercialSignalQualityV2).toHaveBeenCalledTimes(1)
  })
})
