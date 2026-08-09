import type { QueryResult } from 'pg'

import {
  buildCommercialSignalQualityV2Input,
  CommercialSignalQualityV2LineageError,
  type CommercialSignalQualityV2InputBuilderDb,
} from '@/lib/opportunities/commercial-signal-quality-v2-input-builder'

function result(rows: Record<string, unknown>[]): QueryResult<Record<string, unknown>> {
  return {
    rowCount: rows.length,
    rows,
  }
}

function lineage(overrides: Record<string, unknown> = {}) {
  return {
    opportunityLineageId: '41',
    candidateId: '31',
    organizationId: '11',
    workspaceId: '21',
    clientProfileId: '22',
    lineageCandidateIdentity: 'a'.repeat(64),
    candidateIdentity: 'a'.repeat(64),
    lineageCandidateGeneration: 3,
    candidateGeneration: 3,
    v3Status: 'qualified_actionable',
    v3QualityScore: 0.8,
    signalEpisodeId: '51',
    signalEpisodeIdentity: 'b'.repeat(64),
    lineageEpisodeGeneration: 4,
    episodeIdentity: 'b'.repeat(64),
    episodeGeneration: 4,
    lineageCreatedAt: '2026-08-09T10:00:00.000Z',
    candidateValidUntil: '2026-08-12T10:00:00.000Z',
    episodeValidUntil: '2026-08-11T10:00:00.000Z',
    qualityComponents: {
      timing: {
        score: 0.82,
        reasons: [{ code: 'CURRENT_HIRING', evidenceIds: ['101'] }],
      },
      agencyFit: {
        score: 0.78,
        reasons: [{ code: 'AGENCY_FIT', evidenceIds: ['101'] }],
      },
      economics: { score: 0, reasons: [] },
    },
    actionabilityComponents: {},
    candidateFeatures: {
      quality: { economicsOutcome: 'unknown' },
      actionability: { corporateContactPathCategories: [] },
    },
    matchId: '61',
    matchGeneration: 5,
    candidateMatchGeneration: 5,
    matchFitScore: 0.78,
    matchCoverage: 1,
    propensityId: '71',
    propensityGeneration: 6,
    candidatePropensityGeneration: 6,
    propensityScore: 0.7,
    propensityLevel: 'medium',
    propensityFeatures: {},
    thesisId: '81',
    thesisGeneration: 7,
    candidateThesisGeneration: 7,
    stateSnapshotId: '91',
    accountRestriction: null,
    ...overrides,
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: '201',
    eventType: 'job_posting',
    occurredAt: '2026-08-08T10:00:00.000Z',
    lastSeenAt: '2026-08-09T09:00:00.000Z',
    confidence: 0.9,
    payload: {},
    evidenceIds: ['101'],
    ...overrides,
  }
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: '101',
    source: 'career-site',
    url: 'https://example.test/careers/1',
    fetchedAt: '2026-08-09T09:00:00.000Z',
    contentHash: 'c'.repeat(64),
    tier: 'direct',
    payloadRef: {
      upstreamOrigin: 'career:vacancy:1',
      vacancyFingerprint: 'vacancy:1',
    },
    matchEvidence: true,
    propensityEvidence: true,
    thesisEvidence: true,
    episodeEvidence: true,
    ...overrides,
  }
}

function dbWith(rows: {
  lineage?: Record<string, unknown>[]
  events?: Record<string, unknown>[]
  evidence?: Record<string, unknown>[]
}) {
  const calls: Array<{ text: string; values?: unknown[] }> = []
  const db: CommercialSignalQualityV2InputBuilderDb = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      if (text.includes('FROM commercial_signal_opportunity_lineage')) {
        return result(rows.lineage ?? [lineage()])
      }
      if (text.includes('FROM signal_episode_events')) {
        return result(rows.events ?? [event()])
      }
      return result(rows.evidence ?? [evidence()])
    }) as CommercialSignalQualityV2InputBuilderDb['query'],
  }
  return { db, calls }
}

describe('Commercial Signal Quality v2 exact-lineage input builder', () => {
  it('builds from exact persisted ids without latest/freshest/nearest shortcuts', async () => {
    const { db, calls } = dbWith({})

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21',
      clientProfileId: '22',
      organizationId: '11',
    }, db)

    expect(built).toMatchObject({
      opportunityLineageId: '41',
      candidateId: '31',
      candidateGeneration: 3,
      v3Status: 'qualified_actionable',
      v3QualityScore: 0.8,
      workspaceId: '21',
      clientProfileId: '22',
      organizationId: '11',
      validUntil: '2026-08-11T10:00:00.000Z',
    })
    expect(built.input.currentHiringEvidence).toEqual({
      present: true,
      evidenceIds: ['101'],
    })
    expect(built.input.hiringFriction.observationStates.repost_cycles)
      .toBe('unknown')
    expect(built.input.economics).toMatchObject({
      economicsFit: 'unknown', componentValue: null, coverage: 0,
    })
    expect(built.input.evidence.map((item) => item.evidenceId)).toEqual(['101'])

    const lineageQuery = calls[0]!
    expect(lineageQuery.values).toEqual(['41', '21', '22', '11'])
    expect(lineageQuery.text).toContain('lineage.id = $1')
    expect(lineageQuery.text).toContain('candidate.id = lineage.candidate_id')
    expect(lineageQuery.text).not.toMatch(/DISTINCT ON|\bMAX\s*\(|nearest|freshest/i)
    const evidenceQuery = calls.find((call) =>
      call.text.includes('FROM opportunity_candidate_evidence'))
    expect(evidenceQuery?.values).toEqual([
      '31', '11', '21', '22', '2026-08-09T10:00:00.000Z',
      '61', '71', '81', '51',
    ])
  })

  it('fails closed when exact lineage is absent or belongs to another scope', async () => {
    const { db } = dbWith({ lineage: [] })

    await expect(buildCommercialSignalQualityV2Input('41', {
      workspaceId: '999',
      clientProfileId: '22',
      organizationId: '11',
    }, db)).rejects.toMatchObject<Partial<CommercialSignalQualityV2LineageError>>({
      code: 'QUALITY_LINEAGE_NOT_FOUND_OR_SCOPE_MISMATCH',
    })
  })

  it.each([
    [
      { candidateGeneration: 4 },
      'QUALITY_LINEAGE_CANDIDATE_STALE',
    ],
    [
      { candidateIdentity: 'f'.repeat(64) },
      'QUALITY_LINEAGE_CANDIDATE_STALE',
    ],
    [
      { episodeGeneration: 5 },
      'QUALITY_LINEAGE_EPISODE_STALE',
    ],
    [
      { matchGeneration: 6 },
      'QUALITY_LINEAGE_MATCH_STALE',
    ],
    [
      { propensityGeneration: 7 },
      'QUALITY_LINEAGE_PROPENSITY_STALE',
    ],
    [
      { thesisGeneration: 8 },
      'QUALITY_LINEAGE_THESIS_STALE',
    ],
  ])('rejects stale exact generation %#', async (override, code) => {
    const { db, calls } = dbWith({ lineage: [lineage(override)] })

    await expect(buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21',
      clientProfileId: '22',
    }, db)).rejects.toMatchObject({ code })
    expect(calls).toHaveLength(1)
  })

  it('does not count an absent repost observation as coverage', async () => {
    const { db } = dbWith({ events: [event()] })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21',
      clientProfileId: '22',
    }, db)

    expect(built.input.hiringFriction.componentValues.repost_cycles).toBeNull()
    expect(built.input.hiringFriction.observationStates.repost_cycles)
      .toBe('unknown')
  })

  it('keeps an insufficient upstream propensity unavailable', async () => {
    const { db } = dbWith({
      lineage: [lineage({ propensityLevel: 'insufficient_evidence' })],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22',
    }, db)

    expect(built.input.propensity.componentValues.external_support_plausibility)
      .toBeNull()
  })

  it('does not launder corroboration tier into current official hiring evidence', async () => {
    const { db } = dbWith({ evidence: [evidence({ tier: 'corroboration' })] })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22',
    }, db)

    expect(built.input.currentHiringEvidence).toEqual({
      present: false, evidenceIds: [],
    })
    expect(built.input.evidence.every((item) =>
      item.sourceKind !== 'official')).toBe(true)
  })

  it('threads observed evergreen evidence into propensity demotion', async () => {
    const { db } = dbWith({
      events: [event({ payload: { evergreen: true } })],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22',
    }, db)

    expect(built.input.hiringFriction.observationStates.evergreen_role)
      .toBe('observed')
    expect(built.input.propensity.reasonCodes)
      .toContain('ARCHETYPE_EVERGREEN_DEMOTION')
  })
})
