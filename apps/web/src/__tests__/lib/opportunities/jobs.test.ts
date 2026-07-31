import {
  backfillOpportunitiesJob,
  buildOpportunitiesJob,
  detectHiringEpisodesJob,
  expireOpportunitiesJob,
} from '@/lib/opportunities/jobs'

type OpportunityJobDb = NonNullable<Parameters<typeof buildOpportunitiesJob>[1]>

function dbWithQuery(handler: (sql: string, params?: readonly unknown[]) => {
  rowCount: number
  rows: unknown[]
}) {
  const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
      try {
        return handler(sql, params)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('Unexpected SQL:')) {
          throw error
        }
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rowCount: 1, rows: [{ locked: true }] }
        }
        if (
          sql.includes('FROM hiring_episodes') &&
          sql.includes('episode_identity') &&
          sql.includes('FOR UPDATE')
        ) {
          return { rowCount: 0, rows: [] }
        }
        if (sql.includes('DELETE FROM hiring_episode_evidence')) {
          return { rowCount: 0, rows: [] }
        }
        if (
          sql.includes('ARRAY_AGG(signal_id::TEXT') &&
          sql.includes('FROM hiring_episode_evidence')
        ) {
          return {
            rowCount: 1,
            rows: [{ signalIds: ['1', '2', '3', '4'], evidenceIds: [] }],
          }
        }
        if (
          sql.includes('FROM opportunities') &&
          sql.includes('input_hash') &&
          sql.includes('FOR UPDATE')
        ) {
          return { rowCount: 0, rows: [] }
        }
        if (
          sql.includes('FROM client_episode_state') &&
          sql.includes('FOR UPDATE')
        ) {
          return { rowCount: 0, rows: [] }
        }
        if (
          sql.includes('UPDATE hiring_episodes') &&
          sql.includes('episode_identity <> ALL')
        ) {
          return { rowCount: 0, rows: [] }
        }
        throw error
      }
    })
  return { query } as { query: typeof query } & OpportunityJobDb
}

function buildRow(
  clientProfileId: string,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date('2026-07-26T09:00:00.000Z')
  return {
    ownerId: clientProfileId === '8' ? '7' : '17',
    clientProfileId,
    organizationId: '10',
    hiringEpisodeId: '20',
    organizationName: 'Пример',
    organizationDomain: 'example.test',
    organizationWebsiteUrl: 'https://example.test',
    organizationCareerPageUrl: 'https://example.test/careers',
    organizationCountry: 'Россия',
    organizationIndustry: null,
    organizationCity: 'Москва',
    episodeType: 'vacancy_spike',
    episodeKey: 'vacancy_spike:all:2026-07-20',
    episodeIdentity: 'f'.repeat(64),
    episodeGeneration: 1,
    episodeTitle: 'Компания ускорила найм',
    episodeSummary: 'За последние 14 дней опубликовано 8 вакансий.',
    episodeStartedAt: '2026-07-15T09:00:00.000Z',
    episodeLastSeenAt: '2026-07-25T09:00:00.000Z',
    signalCount: 4,
    vacancyCount: 4,
    strengthScore: 0.85,
    freshnessScore: 0.95,
    evidenceHash: 'a'.repeat(64),
    engineVersion: 'hiring-episode-v1',
    episodeMetadata: {
      baselineCount: 1,
      currentCount: 4,
      growthMultiplier: 4,
      roleFamilies: ['backend'],
    },
    signalIds: ['1', '2', '3', '4'],
    evidenceIds: ['11'],
    signals: [1, 2, 3, 4].map((id) => ({
      id: String(id),
      title: 'Backend developer',
      region: 'Москва',
      occurredAt: new Date(now.getTime() - id * 24 * 60 * 60 * 1000).toISOString(),
      tier: 'direct',
    })),
    evidence: [{ id: '11', source: 'career-pages', tier: 'direct' }],
    digestCandidateId: `30${clientProfileId}`,
    digestPayload: {
      confidenceGate: 'A',
      contactPaths: [],
    },
    digestReasons: [],
    sourceFamilies: ['career-pages'],
    agencyName: `Агентство ${clientProfileId}`,
    targetCity: 'Москва',
    specialization: 'IT recruitment',
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    contactPolicy: 'corporate_only',
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    hiringMode: 'auto',
    ...overrides,
  }
}

describe('opportunity background jobs', () => {
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalCanaryOwners = process.env.OPPORTUNITY_CANARY_OWNER_IDS

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
    if (originalCanaryOwners === undefined) {
      delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    } else {
      process.env.OPPORTUNITY_CANARY_OWNER_IDS = originalCanaryOwners
    }
  })

  it('is fully dark behind the feature flag and performs no database work', async () => {
    const db = dbWithQuery(() => ({ rowCount: 0, rows: [] }))

    const detected = await detectHiringEpisodesJob({ enabled: false }, db)
    const built = await buildOpportunitiesJob({ enabled: false }, db)
    const expired = await expireOpportunitiesJob({ enabled: false }, db)

    expect(detected.enabled).toBe(false)
    expect(built.enabled).toBe(false)
    expect(expired.enabled).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('keeps global jobs disabled when only the owner canary is enabled', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'
    const db = dbWithQuery(() => ({ rowCount: 0, rows: [] }))

    const detected = await detectHiringEpisodesJob({}, db)
    const built = await buildOpportunitiesJob({}, db)
    const expired = await expireOpportunitiesJob({}, db)

    expect(detected.enabled).toBe(false)
    expect(built.enabled).toBe(false)
    expect(expired.enabled).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('detects episodes in dry-run mode without issuing a write query', async () => {
    const now = new Date('2026-07-26T09:00:00.000Z')
    const db = dbWithQuery((sql) => {
      if (sql.includes('MAX(s.updated_at)')) {
        return {
          rowCount: 1,
          rows: [{
            organizationId: '10',
            lastSignalId: '4',
            lastSignalUpdatedAt: now.toISOString(),
          }],
        }
      }
      if (sql.includes('FROM signals s')) {
        return {
          rowCount: 4,
          rows: [1, 2, 3, 4].map((day, index) => ({
            id: String(index + 1),
            organizationId: '10',
            signalType: 'job_posting',
            title: `Backend developer ${index + 1}`,
            region: 'Москва',
            source: 'career-pages',
            sourceUrl: `https://example.test/jobs/${index + 1}`,
            occurredAt: new Date(now.getTime() - day * 24 * 60 * 60 * 1000).toISOString(),
            evidenceIds: [],
          })),
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await detectHiringEpisodesJob(
      { enabled: true, dryRun: true, now },
      db,
    )

    expect(result.scanned).toBe(1)
    expect(result.created).toBeGreaterThan(0)
    expect(db.query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO hiring_episodes'),
    )).toBe(false)
  })

  it('reconciles episode evidence and checkpoint in one transaction', async () => {
    const now = new Date('2026-07-26T09:00:00.000Z')
    const sqlSeen: string[] = []
    const db = dbWithQuery((sql) => {
      sqlSeen.push(sql)
      if (sql.includes('MAX(s.updated_at)')) {
        return {
          rowCount: 1,
          rows: [{
            organizationId: '10',
            lastSignalId: '4',
            lastSignalUpdatedAt: now.toISOString(),
          }],
        }
      }
      if (sql.includes('FROM signals s')) {
        return {
          rowCount: 4,
          rows: [1, 2, 3, 4].map((day, index) => ({
            id: String(index + 1),
            organizationId: '10',
            signalType: 'job_posting',
            title: `Backend developer ${index + 1}`,
            region: 'Москва',
            source: 'career-pages',
            sourceUrl: `https://example.test/jobs/${index + 1}`,
            occurredAt: new Date(now.getTime() - day * 24 * 60 * 60 * 1000).toISOString(),
            evidenceIds: [],
          })),
        }
      }
      if (sql.includes('INSERT INTO hiring_episodes')) {
        return { rowCount: 1, rows: [{ id: '20', inserted: true }] }
      }
      if (sql.includes('INSERT INTO hiring_episode_evidence')) {
        return { rowCount: 4, rows: [] }
      }
      if (sql.includes('INSERT INTO hiring_episode_detection_state')) {
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await detectHiringEpisodesJob({ enabled: true, now }, db)

    expect(result.created).toBeGreaterThan(0)
    expect(result.reconciled).toBeGreaterThan(0)
    expect(sqlSeen).toContain('BEGIN')
    expect(sqlSeen).toContain('COMMIT')
    expect(sqlSeen.some((sql) =>
      sql.includes('DELETE FROM hiring_episode_evidence'),
    )).toBe(true)
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episodes')))
      .toContain('episode_identity')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episode_evidence')))
      .toContain('ON CONFLICT')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episode_detection_state')))
      .toContain('ON CONFLICT')
  })

  it('episode started_at never moves forward and last_seen_at never moves backward', async () => {
    const now = new Date('2026-07-26T09:00:00.000Z')
    const continuationUpdates: string[] = []
    const db = dbWithQuery((sql) => {
      if (sql.includes('MAX(s.updated_at)')) {
        return {
          rowCount: 1,
          rows: [{
            organizationId: '10',
            lastSignalId: '4',
            lastSignalUpdatedAt: now.toISOString(),
            inputFingerprint: 'a'.repeat(32),
          }],
        }
      }
      if (sql.includes('FROM signals s')) {
        return {
          rowCount: 4,
          rows: [1, 2, 3, 4].map((day, index) => ({
            id: String(index + 1),
            organizationId: '10',
            signalType: 'job_posting',
            title: `Backend developer ${index + 1}`,
            region: 'Москва',
            source: 'career-pages',
            sourceUrl: `https://example.test/jobs/${index + 1}`,
            occurredAt: new Date(now.getTime() - day * 24 * 60 * 60 * 1000).toISOString(),
            evidenceIds: [],
          })),
        }
      }
      if (
        sql.includes('FROM hiring_episodes') &&
        sql.includes('episode_identity') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '20',
            status: 'active',
            lastSeenAt: '2026-07-25T09:00:00.000Z',
            episodeGeneration: 1,
          }],
        }
      }
      if (
        sql.includes('UPDATE hiring_episodes') &&
        sql.includes('title = $2') &&
        sql.includes('RETURNING')
      ) {
        continuationUpdates.push(sql)
        return { rowCount: 1, rows: [{ id: '20', inserted: false }] }
      }
      if (sql.includes('INSERT INTO hiring_episode_evidence')) {
        return { rowCount: 4, rows: [] }
      }
      if (sql.includes('INSERT INTO hiring_episode_detection_state')) {
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await detectHiringEpisodesJob({ enabled: true, now }, db)

    expect(result.continued).toBeGreaterThan(0)
    expect(continuationUpdates).not.toHaveLength(0)
    for (const sql of continuationUpdates) {
      expect(sql).toContain('LEAST(hiring_episodes.started_at, $4::timestamptz)')
      expect(sql).toContain('GREATEST(hiring_episodes.last_seen_at, $5::timestamptz)')
    }
  })

  it('closes missing active identities only through the inactivity policy', async () => {
    const sqlSeen: string[] = []
    const now = new Date('2026-07-26T09:00:00.000Z')
    const db = dbWithQuery((sql) => {
      sqlSeen.push(sql)
      if (sql.includes('MAX(s.updated_at)')) {
        return {
          rowCount: 1,
          rows: [{
            organizationId: '10',
            lastSignalId: '1',
            lastSignalUpdatedAt: now.toISOString(),
            inputFingerprint: 'a'.repeat(32),
          }],
        }
      }
      if (sql.includes('FROM signals s')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('episode_identity <> ALL')) {
        return { rowCount: 1, rows: [{ id: '20' }] }
      }
      if (sql.includes('INSERT INTO hiring_episode_detection_state')) {
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await detectHiringEpisodesJob({ enabled: true, now }, db)

    expect(result.skipped).toBe(1)
    expect(result.updated).toBe(1)
    expect(sqlSeen).toContain('BEGIN')
    expect(sqlSeen).toContain('COMMIT')
  })

  it('quarantines a failed detection organization so later batches can progress', async () => {
    const now = new Date('2026-07-26T09:00:00.000Z')
    const sqlSeen: string[] = []
    const db = dbWithQuery((sql) => {
      sqlSeen.push(sql)
      if (sql.includes('MAX(s.updated_at)')) {
        return {
          rowCount: 1,
          rows: [{
            organizationId: '10',
            lastSignalId: '4',
            lastSignalUpdatedAt: now.toISOString(),
          }],
        }
      }
      if (sql.includes('FROM signals s')) {
        throw new Error('poison organization')
      }
      if (sql.includes('INSERT INTO hiring_episode_detection_state')) {
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await detectHiringEpisodesJob(
      { enabled: true, batchSize: 1, now },
      db,
    )

    expect(result.failed).toBe(1)
    expect(sqlSeen.find((sql) => sql.includes('MAX(s.updated_at)')))
      .toContain('state.next_retry_at')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episode_detection_state')))
      .toContain("INTERVAL '5 minutes'")
  })

  it('previews expiration in dry-run mode without updating state', async () => {
    const db = dbWithQuery((sql) => {
      if (sql.includes('SELECT COUNT(*)')) {
        return { rowCount: 1, rows: [{ count: '3' }] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await expireOpportunitiesJob(
      { enabled: true, dryRun: true },
      db,
    )

    expect(result.expired).toBe(3)
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE')))
      .toBe(false)
  })

  it('selects automatic resume candidates from active outcome projection only', async () => {
    const db = dbWithQuery((sql) => {
      if (
        sql.includes('UPDATE hiring_episodes') &&
        sql.includes("SET status = 'closed'")
      ) {
        return { rowCount: 0, rows: [] }
      }
      if (
        sql.includes('FROM opportunities o') &&
        sql.includes('AS "snoozedUntil"')
      ) {
        expect(sql).toContain('LEFT JOIN opportunity_outcome_state outcome_state')
        expect(sql).toContain(
          'COALESCE(\n         outcome_state.snoozed_until',
        )
        expect(sql).toContain(") = 'snoozed'")
        expect(sql).toContain("NOT IN ('won', 'lost', 'dismissed')")
        expect(sql).toContain('o.superseded_at IS NULL')
        expect(sql).toContain("he.status = 'active'")
        return { rowCount: 0, rows: [] }
      }
      if (
        sql.includes('UPDATE opportunities o') &&
        sql.includes("SET status = 'expired'")
      ) {
        expect(sql).toContain(
          "outcome_state.workflow_state = 'snoozed'",
        )
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await expireOpportunitiesJob(
      { enabled: true, now: new Date('2026-07-28T09:00:00.000Z') },
      db,
    )

    expect(result.resumed).toBe(0)
    expect(result.resumeLatencyMsTotal).toBe(0)
    expect(result.resumeLatencyMsMax).toBe(0)
  })

  it('creates independent opportunities for two profiles and excludes up-to-date rows', async () => {
    const insertParams: Array<readonly unknown[]> = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        expect(sql).toContain('run.status = \'completed\'')
        expect(sql).toContain('dc.created_at >= he.last_seen_at')
        expect(sql).toContain('dc.created_at >= cp.updated_at')
        expect(sql).toContain('LEFT JOIN evidence_items source_evidence')
        expect(sql).toMatch(
          /dc\.source_families\s+\?\s+COALESCE\(\s*source_signal\.source,\s*source_evidence\.source\s*\)/,
        )
        expect(sql).toContain('build_failure.next_retry_at')
        expect(sql).not.toContain('CROSS JOIN client_profiles')
        expect(sql).toContain(
          '(build_failure.next_retry_at IS NOT NULL) ASC',
        )
        expect(sql).toContain('NOT EXISTS')
        return {
          rowCount: 2,
          rows: [buildRow('8'), buildRow('18')],
        }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        insertParams.push(params ?? [])
        return {
          rowCount: 1,
          rows: [{ id: String(100 + insertParams.length), inserted: true }],
        }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob({ enabled: true }, db)

    expect(result.created).toBe(2)
    expect(insertParams.map((params) => params[1])).toEqual(['8', '18'])
  })

  it('mentions only agency roles that match the episode vacancies', async () => {
    let opportunityParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', { roles: ['Backend', 'Sales'] })],
        }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        opportunityParams = params ?? []
        return { rowCount: 1, rows: [{ id: '100', inserted: true }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await buildOpportunitiesJob({ enabled: true }, db)

    const metadata = JSON.parse(String(opportunityParams[22]))
    expect(metadata.agencyFitExplanation).toContain('Backend')
    expect(metadata.agencyFitExplanation).not.toContain('Sales')
    expect(metadata.analyticsCohort).toEqual({
      clientProfileId: '8',
      clientProfileVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      agencyDnaVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      hiringMode: 'auto',
      specialization: 'IT recruitment',
      matchedRoleFamilies: ['backend'],
      matchedIndustries: [],
      matchedRegions: ['москва'],
      organizationSizeBucket: 'unknown',
      episodeType: 'vacancy_spike',
      confidenceGate: 'A',
      scoreBucket: expect.stringMatching(/^(?:0-9|[1-9]0-[1-9]9|100)$/),
      externalSupportNeedBucket: expect.stringMatching(/^(?:low|medium|high)$/),
      sourceFamilies: ['career-pages'],
      scoringVersion: 'opportunity-v1',
    })
  })

  it('gives a vacancy keyword exclusion priority over strong hiring intent', async () => {
    let opportunityParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            excludeKeywords: ['курьер'],
            signals: [{
              id: '1',
              title: 'Курьер',
              region: 'Москва',
              occurredAt: '2026-07-25T09:00:00.000Z',
              tier: 'direct',
            }],
          })],
        }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        opportunityParams = params ?? []
        return { rowCount: 1, rows: [{ id: '100', inserted: true }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await buildOpportunitiesJob({ enabled: true }, db)

    expect(opportunityParams[4]).toBe('dismissed')
    const metadata = JSON.parse(String(opportunityParams[22]))
    expect(metadata.morningBriefEligible).toBe(false)
    expect(metadata).not.toHaveProperty('contactPaths')
  })

  it('skips an unchanged build input without touching updated_at', async () => {
    let inputHash: string | null = null
    let selectionCount = 0
    let insertCount = 0
    let updateCount = 0
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        selectionCount += 1
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentInputHash: selectionCount === 1 ? null : inputHash,
            currentOpportunityId: selectionCount === 1 ? null : '100',
            currentScoringVersion: selectionCount === 1 ? null : 'opportunity-v1',
            ...(selectionCount === 3
              ? { signals: [{
                id: '1',
                title: 'Changed backend vacancy',
                region: 'Москва',
                occurredAt: '2026-07-25T09:00:00.000Z',
                tier: 'direct',
              }] }
              : {}),
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        if (selectionCount === 1) return { rowCount: 0, rows: [] }
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            inputHash,
            scoringVersion: 'opportunity-v1',
            status: 'new',
          }],
        }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        insertCount += 1
        inputHash = String(params?.[29])
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('UPDATE opportunities') && sql.includes('owner_id = $2')) {
        updateCount += 1
        inputHash = String(params?.[30])
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const first = await buildOpportunitiesJob({ enabled: true }, db)
    const second = await buildOpportunitiesJob({ enabled: true }, db)
    const third = await buildOpportunitiesJob({ enabled: true }, db)

    expect(first.created).toBe(1)
    expect(second.skippedUnchanged).toBe(1)
    expect(third.updated).toBe(1)
    expect(insertCount).toBe(1)
    expect(updateCount).toBe(1)
  })

  it('semantic input hash ignores provenance database ids', async () => {
    let selectionCount = 0
    let storedInputHash: string | null = null
    let updateCount = 0
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        selectionCount += 1
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            digestCandidateId: selectionCount === 1 ? '301' : '999',
            organizationId: selectionCount === 1 ? '10' : '910',
            hiringEpisodeId: selectionCount === 1 ? '20' : '920',
            episodeKey: selectionCount === 1 ? 'row-key-20' : 'row-key-920',
            episodeIdentity: selectionCount === 1 ? 'identity-20' : 'identity-920',
            evidenceHash: selectionCount === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
            episodeMetadata: {
              baselineCount: 1,
              currentCount: 4,
              growthMultiplier: 4,
              roleFamilies: ['backend'],
              canonicalVacancyFingerprints: selectionCount === 1
                ? ['fallback-org-10']
                : ['fallback-org-910'],
            },
            signalIds: selectionCount === 1 ? ['1', '2'] : ['901', '902'],
            evidenceIds: selectionCount === 1 ? ['11'] : ['911'],
            signals: selectionCount === 1
              ? [
                  { id: '1', title: 'Backend developer', region: 'Москва', occurredAt: '2026-07-25T09:00:00.000Z', tier: 'direct' },
                  { id: '2', title: 'Backend developer', region: 'Москва', occurredAt: '2026-07-24T09:00:00.000Z', tier: 'direct' },
                ]
              : [
                  { id: '901', title: 'Backend developer', region: 'Москва', occurredAt: '2026-07-25T09:00:00.000Z', tier: 'direct' },
                  { id: '902', title: 'Backend developer', region: 'Москва', occurredAt: '2026-07-24T09:00:00.000Z', tier: 'direct' },
                ],
            evidence: [{
              id: selectionCount === 1 ? '11' : '911',
              source: 'career-pages',
              tier: 'direct',
            }],
            digestPayload: {
              confidenceGate: 'A',
              contactPaths: [],
              corroborated_org_ids: selectionCount === 1 ? ['10'] : ['910'],
              corroboration_key: selectionCount === 1 ? 'org:10' : 'org:910',
              corroboration_key_type: 'org_id',
              is_cross_source_corroborated: false,
            },
            currentOpportunityId: selectionCount === 1 ? null : '100',
            currentInputHash: selectionCount === 1 ? null : storedInputHash,
            currentScoringVersion: selectionCount === 1 ? null : 'opportunity-v1',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return selectionCount === 1
          ? { rowCount: 0, rows: [] }
          : {
            rowCount: 1,
            rows: [{
              id: '100',
              inputHash: storedInputHash,
              scoringVersion: 'opportunity-v1',
              status: 'new',
            }],
          }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        storedInputHash = String(params?.[29])
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('UPDATE opportunities') && sql.includes('owner_id = $2')) {
        updateCount += 1
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const first = await buildOpportunitiesJob({ enabled: true }, db)
    const second = await buildOpportunitiesJob({ enabled: true }, db)

    expect(first.created).toBe(1)
    expect(second.skippedUnchanged).toBe(1)
    expect(updateCount).toBe(0)
  })

  it('does not revive an elapsed snooze during scoring supersession', async () => {
    const elapsedSnooze = '2026-08-02T09:00:00.000Z'
    let deletedElapsedState = false
    let insertedParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: '100',
            currentInputHash: '0'.repeat(64),
            currentScoringVersion: 'opportunity-v1',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            inputHash: '0'.repeat(64),
            scoringVersion: 'opportunity-v1',
            status: 'snoozed',
          }],
        }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ status: 'snoozed', suppressedUntil: elapsedSnooze }],
        }
      }
      if (sql.includes('DELETE FROM client_episode_state')) {
        deletedElapsedState = true
        return { rowCount: 1, rows: [] }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('scoring_version = $3') &&
        sql.includes('superseded_at IS NOT NULL')
      ) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('SET superseded_at = NOW()')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        insertedParams = params ?? []
        return { rowCount: 1, rows: [{ id: '101' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob({
      enabled: true,
      scoringVersion: 'opportunity-v2',
      now: new Date('2026-08-03T09:00:00.000Z'),
    }, db)

    expect(result.created).toBe(1)
    expect(deletedElapsedState).toBe(true)
    expect(insertedParams).not.toContain('snoozed')
    expect(insertedParams).not.toContain(elapsedSnooze)
  })

  it('preserves the resumed commercial stage during an outcome-enabled rebuild', async () => {
    const originalFlag = process.env.OPPORTUNITY_OUTCOMES_ENABLED
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    const resumeNow = new Date(Date.now() - 60_000)
    const elapsedSnooze = new Date(
      resumeNow.getTime() - 1_000,
    ).toISOString()
    const contactedAt = new Date(
      resumeNow.getTime() - 86_400_000,
    ).toISOString()
    let updatedParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: '100',
            currentInputHash: '0'.repeat(64),
            currentScoringVersion: 'opportunity-v1',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            inputHash: '0'.repeat(64),
            scoringVersion: 'opportunity-v1',
            status: 'snoozed',
            snoozedUntil: elapsedSnooze,
          }],
        }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ status: 'snoozed', suppressedUntil: elapsedSnooze }],
        }
      }
      if (sql.includes('JOIN hiring_episodes he') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            ownerId: '7',
            clientProfileId: '8',
            organizationId: '10',
            hiringEpisodeId: '20',
            status: 'snoozed',
            supersededAt: null,
            validUntil: '2026-08-30T09:00:00.000Z',
            scoringVersion: 'opportunity-v1',
            confidenceGate: 'A',
            opportunityScore: 0.8,
            externalSupportNeedScore: 0.7,
            episodeType: 'vacancy_spike',
            episodeStatus: 'active',
          }],
        }
      }
      if (
        sql.includes('FROM opportunity_outcome_events') &&
        sql.includes('payload_hash')
      ) {
        return { rowCount: 0, rows: [] }
      }
      if (
        sql.includes('FROM opportunity_outcome_state') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            commercialStage: 'contacted',
            currentStage: 'contacted',
            workflowState: 'snoozed',
            snoozedUntil: elapsedSnooze,
            lastEventId: '90',
            lastEventAt: elapsedSnooze,
            lastStageEventId: '80',
            lastStageEventAt: contactedAt,
            firstShownAt: null,
            firstOpenedAt: null,
            acceptedAt: '2026-07-30T09:00:00.000Z',
            contactedAt,
            repliedAt: null,
            meetingAt: null,
            proposalAt: null,
            wonAt: null,
            lostAt: null,
            dismissReasonCode: null,
            lostReasonCode: null,
            dealValueMinor: null,
            currency: null,
          }],
        }
      }
      if (sql.includes('ARRAY_AGG(DISTINCT source_family')) {
        return { rowCount: 1, rows: [{ sourceFamilies: [] }] }
      }
      if (sql.includes('INSERT INTO opportunity_outcome_events')) {
        return {
          rowCount: 1,
          rows: [{
            id: '91',
            recordedAt: resumeNow.toISOString(),
          }],
        }
      }
      if (sql.includes('INSERT INTO opportunity_outcome_state')) {
        return { rowCount: 1, rows: [] }
      }
      if (
        sql.includes('UPDATE opportunities') &&
        sql.includes('SET\n       status = $1')
      ) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('INSERT INTO client_episode_state')) {
        return { rowCount: 1, rows: [] }
      }
      if (
        sql.includes('UPDATE opportunities') &&
        sql.includes('owner_id = $2')
      ) {
        updatedParams = params ?? []
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    try {
      const result = await buildOpportunitiesJob({
        enabled: true,
        now: resumeNow,
      }, db)
      expect(result.updated).toBe(1)
      expect(updatedParams[5]).toBe('contacted')
      expect(updatedParams[31]).toBeNull()
    } finally {
      if (originalFlag === undefined) {
        delete process.env.OPPORTUNITY_OUTCOMES_ENABLED
      } else {
        process.env.OPPORTUNITY_OUTCOMES_ENABLED = originalFlag
      }
    }
  })

  it('clears an elapsed snooze even when the semantic input is unchanged', async () => {
    const elapsedSnooze = '2026-08-02T09:00:00.000Z'
    let selectionCount = 0
    let storedInputHash: string | null = null
    let deletedElapsedState = false
    let updatedParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        selectionCount += 1
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: selectionCount === 1 ? null : '100',
            currentInputHash: selectionCount === 1 ? null : storedInputHash,
            currentScoringVersion: selectionCount === 1 ? null : 'opportunity-v1',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return selectionCount === 1
          ? { rowCount: 0, rows: [] }
          : {
            rowCount: 1,
            rows: [{
              id: '100',
              inputHash: storedInputHash,
              scoringVersion: 'opportunity-v1',
              status: 'snoozed',
            }],
          }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return selectionCount === 1
          ? { rowCount: 0, rows: [] }
          : {
            rowCount: 1,
            rows: [{ status: 'snoozed', suppressedUntil: elapsedSnooze }],
          }
      }
      if (sql.includes('DELETE FROM client_episode_state')) {
        deletedElapsedState = true
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        storedInputHash = String(params?.[29])
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('UPDATE opportunities') && sql.includes('owner_id = $2')) {
        updatedParams = params ?? []
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const first = await buildOpportunitiesJob({
      enabled: true,
      now: new Date('2026-08-01T09:00:00.000Z'),
    }, db)
    const second = await buildOpportunitiesJob({
      enabled: true,
      now: new Date('2026-08-03T09:00:00.000Z'),
    }, db)

    expect(first.created).toBe(1)
    expect(second.updated).toBe(1)
    expect(second.skippedUnchanged).toBe(0)
    expect(deletedElapsedState).toBe(true)
    expect(updatedParams[5]).not.toBe('snoozed')
    expect(updatedParams[31]).toBeNull()
  })

  it('snooze deadline survives scoring supersession', async () => {
    const sqlSeen: string[] = []
    const snoozedUntil = '2026-08-02T09:00:00.000Z'
    let storedParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      sqlSeen.push(sql)
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: '100',
            currentInputHash: '0'.repeat(64),
            currentScoringVersion: 'opportunity-v1',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            inputHash: '0'.repeat(64),
            scoringVersion: 'opportunity-v1',
            status: 'snoozed',
          }],
        }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ status: 'snoozed', suppressedUntil: snoozedUntil }],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('scoring_version = $3') &&
        sql.includes('superseded_at IS NOT NULL')
      ) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('SET superseded_at = NOW()')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        storedParams = params ?? []
        return { rowCount: 1, rows: [{ id: '101' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob(
      { enabled: true, scoringVersion: 'opportunity-v2' },
      db,
    )

    expect(result.created).toBe(1)
    expect(result.superseded).toBe(1)
    expect(sqlSeen.some((sql) => sql.includes('SET superseded_at = NOW()'))).toBe(true)
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO opportunities')))
      .toContain('snoozed_until')
    expect(storedParams).toContain(snoozedUntil)
    expect(sqlSeen.find((sql) =>
      sql.includes('FROM opportunities') && sql.includes('input_hash'),
    )).toContain('owner_id = $3')
    expect(sqlSeen.find((sql) =>
      sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE'),
    )).toContain('owner_id = $3')
    expect(sqlSeen.find((sql) => sql.includes('SET superseded_at = NOW()')))
      .toContain('owner_id = $2')
  })

  it('repairs an orphaned future snooze before scoring supersession', async () => {
    const snoozedUntil = '2026-08-02T09:00:00.000Z'
    let repairedStateParams: readonly unknown[] = []
    let storedParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: '100',
            currentInputHash: '0'.repeat(64),
            currentScoringVersion: 'opportunity-v1',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            inputHash: '0'.repeat(64),
            scoringVersion: 'opportunity-v1',
            status: 'snoozed',
            snoozedUntil,
          }],
        }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('INSERT INTO client_episode_state')) {
        repairedStateParams = params ?? []
        return { rowCount: 1, rows: [] }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('scoring_version = $3') &&
        sql.includes('superseded_at IS NOT NULL')
      ) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('SET superseded_at = NOW()')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        storedParams = params ?? []
        return { rowCount: 1, rows: [{ id: '101' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob(
      { enabled: true, scoringVersion: 'opportunity-v2' },
      db,
    )

    expect(result.created).toBe(1)
    expect(result.superseded).toBe(1)
    expect(repairedStateParams).toEqual(['8', '7', '20', '10', snoozedUntil])
    expect(storedParams).toContain(snoozedUntil)
  })

  it('snooze deadline survives scoring rollback', async () => {
    const snoozedUntil = '2026-08-03T09:00:00.000Z'
    let restoredOpportunityId: string | null = null
    let restoredSql = ''
    let restoredParams: readonly unknown[] = []
    let insertCount = 0
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: '101',
            currentInputHash: '0'.repeat(64),
            currentScoringVersion: 'opportunity-v2',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '101',
            inputHash: '0'.repeat(64),
            scoringVersion: 'opportunity-v2',
            status: 'snoozed',
          }],
        }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ status: 'snoozed', suppressedUntil: snoozedUntil }],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('scoring_version = $3') &&
        sql.includes('superseded_at IS NOT NULL')
      ) {
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('SET superseded_at = NOW()')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('UPDATE opportunities') && sql.includes('owner_id = $2')) {
        restoredOpportunityId = String(params?.[0])
        restoredSql = sql
        restoredParams = params ?? []
        return { rowCount: 1, rows: [{ id: restoredOpportunityId }] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        insertCount += 1
        return { rowCount: 1, rows: [{ id: '102' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob(
      { enabled: true, scoringVersion: 'opportunity-v1' },
      db,
    )

    expect(result.created).toBe(0)
    expect(result.updated).toBe(1)
    expect(result.superseded).toBe(1)
    expect(restoredOpportunityId).toBe('100')
    expect(insertCount).toBe(0)
    expect(restoredSql).toContain('snoozed_until')
    expect(restoredParams).toContain(snoozedUntil)
  })

  it('re-reads locked episode state before persisting a concurrently contacted opportunity', async () => {
    let storedStatus: unknown = null
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('WITH latest_candidates AS')) {
        return {
          rowCount: 1,
          rows: [buildRow('8', {
            currentOpportunityId: '100',
            currentInputHash: '0'.repeat(64),
            currentScoringVersion: 'opportunity-v1',
            episodeStateStatus: 'accepted',
          })],
        }
      }
      if (
        sql.includes('FROM opportunities') &&
        sql.includes('input_hash') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            id: '100',
            inputHash: '0'.repeat(64),
            scoringVersion: 'opportunity-v1',
            status: 'contacted',
          }],
        }
      }
      if (sql.includes('FROM client_episode_state') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{ status: 'contacted' }] }
      }
      if (sql.includes('UPDATE opportunities') && sql.includes('owner_id = $2')) {
        storedStatus = params?.[5]
        return { rowCount: 1, rows: [{ id: '100' }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob({ enabled: true }, db)

    expect(result.updated).toBe(1)
    expect(storedStatus).toBe('contacted')
  })

  it('quarantines a failed build pair so later bounded runs can progress', async () => {
    const sqlSeen: string[] = []
    const db = dbWithQuery((sql) => {
      sqlSeen.push(sql)
      if (sql.includes('WITH latest_candidates AS')) {
        return { rowCount: 1, rows: [buildRow('8')] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        throw new Error('poison row')
      }
      if (sql.includes('INSERT INTO opportunity_build_failures')) {
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await buildOpportunitiesJob(
      { enabled: true, batchSize: 1 },
      db,
    )

    expect(result.failed).toBe(1)
    expect(sqlSeen.find((sql) => sql.includes('WITH latest_candidates AS')))
      .toContain('build_failure.next_retry_at')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO opportunity_build_failures')))
      .toContain("INTERVAL '5 minutes'")
  })

  it('previews first-run backfill inside a rollback-only transaction', async () => {
    const now = new Date('2026-07-26T09:00:00.000Z')
    const sqlSeen: string[] = []
    const db = dbWithQuery((sql) => {
      sqlSeen.push(sql)
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('MAX(s.updated_at)')) {
        return {
          rowCount: 1,
          rows: [{
            organizationId: '10',
            lastSignalId: '4',
            lastSignalUpdatedAt: now.toISOString(),
          }],
        }
      }
      if (sql.includes('FROM signals s')) {
        return {
          rowCount: 4,
          rows: [1, 2, 3, 4].map((day, index) => ({
            id: String(index + 1),
            organizationId: '10',
            signalType: 'job_posting',
            title: `Backend developer ${index + 1}`,
            region: 'Москва',
            source: 'career-pages',
            sourceUrl: `https://example.test/jobs/${index + 1}`,
            occurredAt: new Date(
              now.getTime() - day * 24 * 60 * 60 * 1000,
            ).toISOString(),
            evidenceIds: [],
          })),
        }
      }
      if (sql.includes('INSERT INTO hiring_episodes')) {
        return { rowCount: 1, rows: [{ id: '20', inserted: true }] }
      }
      if (sql.includes('INSERT INTO hiring_episode_evidence')) {
        return { rowCount: 4, rows: [] }
      }
      if (sql.includes('INSERT INTO hiring_episode_detection_state')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('WITH latest_candidates AS')) {
        return { rowCount: 1, rows: [buildRow('8')] }
      }
      if (sql.includes('INSERT INTO opportunities')) {
        return { rowCount: 1, rows: [{ id: '100', inserted: true }] }
      }
      if (sql.includes('DELETE FROM opportunity_build_failures')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await backfillOpportunitiesJob(
      { enabled: true, dryRun: true, now },
      db,
    )

    expect(result.detection.dryRun).toBe(true)
    expect(result.detection.created).toBeGreaterThan(0)
    expect(result.opportunities.dryRun).toBe(true)
    expect(result.opportunities.created).toBe(1)
    expect(sqlSeen[0]).toBe('BEGIN')
    expect(sqlSeen.at(-1)).toBe('ROLLBACK')
    expect(sqlSeen).not.toContain('COMMIT')
  })
})
