import type { QueryResult } from 'pg'

import {
  buildCommercialSignalQualityV2Input,
  CommercialSignalQualityV2LineageError,
  type CommercialSignalQualityV2InputBuilderDb,
} from '@/lib/opportunities/commercial-signal-quality-v2-input-builder'
import {
  normalizeJobPostingCompanyEvents,
  type CompanyEventSourceRecord,
} from '@/lib/opportunities/company-event-normalization'

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
    stateSnapshotAt: '2026-08-09T08:00:00.000Z',
    stateHiringBaseline: {
      vacancies7d: 2,
      vacancies14d: 4,
      vacancies30d: 8,
      medianHiringVelocityPer7d: 2,
      historyEventCount: 12,
      historyCoverageDays: 90,
      historicalPeriodCount: 5,
      sufficientHistory: true,
      fallbackReason: null,
    },
    stateCurrentHiringVelocity: {
      vacancies7d: 4,
      vacancies14d: 7,
      vacancies30d: 12,
      baselineDeviation14d: 0.75,
      direction: 'up',
    },
    stateRoleDistribution: { current: { engineering: 7 }, baseline: { engineering: 4 } },
    stateSeniorityDistribution: { current: { senior: 5 }, baseline: { senior: 2 } },
    stateRegionDistribution: { current: { Moscow: 7 }, baseline: { Moscow: 4 }, newRegions: [] },
    stateVacancyLifetime: { observedCount: 7, medianDays: 45 },
    stateRepostRate: { supported: true, observedCount: 7, repostCount: 2, rate: 2 / 7 },
    stateRecruitingCapacitySignals: { currentRecruiterVacancies: 1, baselineRecruiterVacancies: 0 },
    stateBusinessChangeSignals: { current30d: {} },
    stateClassification: 'accelerating',
    stateConfidence: 0.88,
    stateFeatureVersion: 'company-state-v1',
    stateEventIds: ['201'],
    stateEvidenceIds: ['101'],
    stateHasFutureEvent: false,
    stateHasFutureEvidence: false,
    stateHasFutureChange: false,
    accountRestriction: null,
    organizationIndustry: 'fintech',
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

function stateChange(overrides: Record<string, unknown> = {}) {
  return {
    changeId: '301',
    changeType: 'hiring_acceleration',
    direction: 'up',
    magnitude: 3,
    baselineDeviation: 0.75,
    confidence: 0.88,
    eventIds: ['201'],
    evidenceIds: ['101'],
    observedAt: '2026-08-09T08:00:00.000Z',
    featureVersion: 'company-state-v1',
    ...overrides,
  }
}

function dbWith(rows: {
  lineage?: Record<string, unknown>[]
  events?: Record<string, unknown>[]
  evidence?: Record<string, unknown>[]
  stateChanges?: Record<string, unknown>[]
  stateEvidence?: Record<string, unknown>[]
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
      if (text.includes('FROM company_state_changes')) {
        return result(rows.stateChanges ?? [])
      }
      if (text.includes('FROM company_state_snapshot_evidence')) {
        return result(rows.stateEvidence ?? [evidence()])
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

    expect(built.input.hiringFriction.componentValues.repost_cycles)
      .toBeCloseTo(2 / 7, 5)
    expect(built.input.hiringFriction.observationStates.repost_cycles)
      .toBe('unknown')
    expect(built.input.hiringFriction.observationStates.repost_rate)
      .toBe('observed')
  })

  it('loads and preserves the exact persisted Company State lineage', async () => {
    const { db, calls } = dbWith({ stateChanges: [stateChange()] })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.stateLineage).toEqual({
      snapshotId: '91',
      snapshotAt: '2026-08-09T08:00:00.000Z',
      featureVersion: 'company-state-v1',
      stateClassification: 'accelerating',
      stateConfidence: 0.88,
      eventIds: ['201'],
      evidenceIds: ['101'],
      snapshot: {
        hiringBaseline: lineage().stateHiringBaseline,
        currentHiringVelocity: lineage().stateCurrentHiringVelocity,
        roleDistribution: lineage().stateRoleDistribution,
        seniorityDistribution: lineage().stateSeniorityDistribution,
        regionDistribution: lineage().stateRegionDistribution,
        vacancyLifetime: lineage().stateVacancyLifetime,
        repostRate: lineage().stateRepostRate,
        recruitingCapacitySignals: lineage().stateRecruitingCapacitySignals,
        businessChangeSignals: lineage().stateBusinessChangeSignals,
      },
      changes: [stateChange()],
    })
    const stateQuery = calls.find((call) =>
      call.text.includes('state_change.id::TEXT AS "changeId"'))
    expect(stateQuery?.values).toEqual([
      '91', '11', '2026-08-09T10:00:00.000Z',
    ])
    expect(stateQuery?.text).toContain('state_change.snapshot_id = $1')
    expect(stateQuery?.text).not.toMatch(/latest|nearest|freshest|DISTINCT ON/i)
  })

  it('turns exact persisted slowdown into confirmed negative evidence', async () => {
    const slowdown = stateChange({
      changeType: 'hiring_slowdown',
      direction: 'down',
      magnitude: 2,
      baselineDeviation: -0.5,
    })
    const { db } = dbWith({
      lineage: [lineage({
        stateClassification: 'slowing',
        stateCurrentHiringVelocity: {
          vacancies7d: 1,
          vacancies14d: 2,
          vacancies30d: 4,
          baselineDeviation14d: -0.5,
          direction: 'down',
        },
      })],
      stateChanges: [slowdown],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.negativeEvidence.confirmedReasons).toEqual([
      expect.objectContaining({
        code: 'HIRING_SLOWDOWN_CONFIRMED',
        eventIds: ['201'],
        evidenceIds: ['101'],
      }),
    ])
    expect(built.archetypes).toEqual(['freeze_or_slowdown'])
  })

  it('threads persisted Company State observations into Quality features', async () => {
    const { db } = dbWith({ stateChanges: [stateChange()] })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.hiringFriction.observationStates).toMatchObject({
      vacancy_lifetime: 'observed',
      repost_rate: 'observed',
      seniority_complexity: 'observed',
      multi_role_complexity: 'observed',
      hiring_velocity_vs_capacity: 'observed',
      internal_recruiting_capacity: 'unknown',
      regional_difficulty: 'unknown',
    })
    expect(built.input.hiringFriction.componentValues.vacancy_lifetime)
      .toBeCloseTo(1 / 6, 5)
    expect(built.input.hiringFriction.componentValues.repost_rate)
      .toBeCloseTo(2 / 7, 5)
    expect(built.input.hiringFriction.componentValues.seniority_complexity).toBe(1)
    expect(built.input.marketDifficulty).toMatchObject({
      roleFamily: 'engineering',
      seniority: 'senior',
      region: 'moscow',
      marketDifficulty: 'unknown',
    })
  })

  it('keeps unsupported repost rate and insufficient baseline history unknown', async () => {
    const { db } = dbWith({
      lineage: [lineage({
        stateHiringBaseline: {
          ...lineage().stateHiringBaseline,
          sufficientHistory: false,
          fallbackReason: 'insufficient_history',
        },
        stateCurrentHiringVelocity: {
          ...lineage().stateCurrentHiringVelocity,
          baselineDeviation14d: null,
          direction: 'unknown',
        },
        stateRepostRate: {
          supported: false, observedCount: 0, repostCount: 0, rate: 0,
        },
        stateClassification: 'insufficient_history',
      })],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.hiringFriction.observationStates.repost_rate).toBe('unknown')
    expect(built.input.hiringFriction.componentValues.repost_rate).toBeNull()
    expect(built.archetypes).not.toContain('expansion')
    expect(built.archetypes).not.toContain('freeze_or_slowdown')
  })

  it('does not observe a feature from an unregistered source capability', async () => {
    const { db } = dbWith({
      events: [event({
        eventType: 'vacancy_salary_change',
        payload: { salaryChanged: true },
      })],
      evidence: [evidence({ source: 'mystery-feed' })],
      stateEvidence: [evidence({ source: 'mystery-feed' })],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.hiringFriction.observationStates.salary_change)
      .toBe('unknown')
    expect(built.input.hiringFriction.componentValues.salary_change).toBeNull()
  })

  it('uses repeated normalized roles only after the minimum sample', async () => {
    const { db } = dbWith({
      lineage: [lineage({
        stateClassification: 'steady',
        stateCurrentHiringVelocity: {
          vacancies7d: 2,
          vacancies14d: 4,
          vacancies30d: 8,
          baselineDeviation14d: 0,
          direction: 'steady',
        },
        stateRoleDistribution: {
          current: { engineering: 4, unknown: 2 },
          baseline: { engineering: 4 },
        },
      })],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.archetypes).toContain('replacement_turnover')
  })

  it('derives regional expansion from exact state changes without claiming difficulty', async () => {
    const regionalChange = stateChange({
      changeId: '302',
      changeType: 'new_region',
      direction: 'new',
      magnitude: 2,
    })
    const { db } = dbWith({
      lineage: [lineage({
        stateRegionDistribution: {
          current: { Moscow: 5, Kazan: 2 },
          baseline: { Moscow: 4 },
          newRegions: ['Kazan'],
        },
      })],
      stateChanges: [stateChange(), regionalChange],
    })

    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.archetypes).toContain('regional_expansion')
    expect(built.input.hiringFriction.observationStates.regional_difficulty)
      .toBe('unknown')
    expect(built.input.marketDifficulty.marketDifficulty).toBe('unknown')
  })

  it('requires acceleration context before recruiter vacancy implies pressure', async () => {
    const recruiterEvent = event({
      eventType: 'recruiter_vacancy',
      payload: { title: 'Recruiter' },
    })
    const accelerated = dbWith({
      events: [recruiterEvent],
      stateChanges: [stateChange()],
    })
    const noBaseline = dbWith({
      events: [recruiterEvent],
      lineage: [lineage({
        stateClassification: 'insufficient_history',
        stateHiringBaseline: {
          ...lineage().stateHiringBaseline,
          sufficientHistory: false,
          fallbackReason: 'insufficient_history',
        },
        stateCurrentHiringVelocity: {
          ...lineage().stateCurrentHiringVelocity,
          baselineDeviation14d: null,
          direction: 'unknown',
        },
      })],
    })

    const withPressure = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, accelerated.db)
    const contextOnly = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, noBaseline.db)

    expect(withPressure.archetypes).toContain('recruiting_capacity_gap')
    expect(contextOnly.archetypes).not.toContain('recruiting_capacity_gap')
    expect(contextOnly.input.hiringFriction.observationStates
      .internal_recruiting_capacity).toBe('unknown')
  })

  it('fails closed when exact Company State contains future data', async () => {
    const { db, calls } = dbWith({
      lineage: [lineage({ stateHasFutureEvidence: true })],
    })

    await expect(buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)).rejects.toMatchObject({ code: 'QUALITY_LINEAGE_STATE_FUTURE' })
    expect(calls).toHaveLength(1)
  })

  it('preserves the real producer repost contract as observed friction', async () => {
    const source = (
      id: string,
      occurredAt: string,
      evidenceId: string,
    ): CompanyEventSourceRecord => ({
      id,
      organizationId: '11',
      signalType: 'job_posting',
      title: 'Senior Java developer',
      region: 'Moscow',
      source: 'hh',
      sourceUrl: `https://example.test/vacancies/${id}`,
      externalVacancyId: id,
      occurredAt,
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
      evidenceIds: [evidenceId],
      payload: { vacancy_name: 'Senior Java developer' },
    })
    const produced = normalizeJobPostingCompanyEvents([
      source('old-101', '2026-07-10T09:00:00.000Z', '101'),
      source('new-101', '2026-08-02T09:00:00.000Z', '102'),
    ], new Date('2026-08-09T10:00:00.000Z'))
    const repost = produced.events.find((item) => item.eventType === 'vacancy_repost')
    expect(repost).toBeDefined()

    const { db } = dbWith({
      events: [event({
        eventId: '202',
        eventType: 'vacancy_repost',
        payload: repost?.payload,
        evidenceIds: ['101'],
      })],
    })
    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.hiringFriction.observationStates.repost_cycles)
      .toBe('observed')
    expect(built.input.hiringFriction.componentValues.repost_cycles).toBe(0.5)
    expect(built.input.hiringFriction.positiveReasons.map((item) => item.code))
      .toContain('MEANINGFUL_REPOST_CYCLES')
  })

  it('preserves the real producer salary-change contract as observed friction', async () => {
    const source = (
      id: string,
      occurredAt: string,
      salaryMin: number,
      salaryMax: number,
    ): CompanyEventSourceRecord => ({
      id,
      organizationId: '11',
      signalType: 'job_posting',
      title: 'Senior Java developer',
      region: 'Moscow',
      source: 'hh',
      sourceUrl: `https://example.test/vacancies/${id}`,
      externalVacancyId: id,
      occurredAt,
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
      evidenceIds: ['101'],
      payload: {
        vacancy_name: 'Senior Java developer',
        salary_rub_min: salaryMin,
        salary_rub_max: salaryMax,
        salary_currency: 'RUB',
      },
    })
    const produced = normalizeJobPostingCompanyEvents([
      source('old-101', '2026-07-10T09:00:00.000Z', 100_000, 120_000),
      source('new-101', '2026-08-02T09:00:00.000Z', 150_000, 170_000),
    ], new Date('2026-08-09T10:00:00.000Z'))
    const salaryChange = produced.events.find(
      (item) => item.eventType === 'vacancy_salary_change',
    )
    expect(salaryChange).toBeDefined()

    const { db } = dbWith({
      events: [event({
        eventId: '203',
        eventType: 'vacancy_salary_change',
        payload: salaryChange?.payload,
      })],
      evidence: [evidence({ source: 'hh' })],
      stateEvidence: [evidence({ source: 'hh' })],
    })
    const built = await buildCommercialSignalQualityV2Input('41', {
      workspaceId: '21', clientProfileId: '22', organizationId: '11',
    }, db)

    expect(built.input.hiringFriction.observationStates.salary_change)
      .toBe('observed')
    expect(built.input.hiringFriction.componentValues.salary_change).toBe(1)
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
    expect(built.input.propensity.componentValues.procurement_barrier).toBeNull()
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
