import {
  backfillOpportunitiesJob,
  buildOpportunitiesJob,
  detectHiringEpisodesJob,
  expireOpportunitiesJob,
} from '@/lib/opportunities/jobs'

function dbWithQuery(handler: (sql: string, params?: readonly unknown[]) => {
  rowCount: number
  rows: unknown[]
}) {
  return {
    query: jest.fn(async (sql: string, params?: readonly unknown[]) =>
      handler(sql, params)),
  }
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

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
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

  it('uses conflict-safe episode writes and can be replayed', async () => {
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

    expect(result.updated).toBeGreaterThan(0)
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episodes')))
      .toContain('ON CONFLICT (organization_id, episode_key, engine_version)')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episode_evidence')))
      .toContain('ON CONFLICT')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episode_detection_state')))
      .toContain('ON CONFLICT')
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

  it('creates independent opportunities for two profiles and excludes up-to-date rows', async () => {
    const insertParams: readonly unknown[][] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('FROM hiring_episodes he')) {
        expect(sql).toContain('run.status = \'completed\'')
        expect(sql).toContain('candidate.created_at >= he.last_seen_at')
        expect(sql).toContain('candidate.created_at >= cp.updated_at')
        expect(sql).toContain('dc.source_families ? source_signal.source')
        expect(sql).toContain('build_failure.next_retry_at')
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

  it('gives a vacancy keyword exclusion priority over strong hiring intent', async () => {
    let opportunityParams: readonly unknown[] = []
    const db = dbWithQuery((sql, params) => {
      if (sql.includes('FROM hiring_episodes he')) {
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

  it('quarantines a failed build pair so later bounded runs can progress', async () => {
    const sqlSeen: string[] = []
    const db = dbWithQuery((sql) => {
      sqlSeen.push(sql)
      if (sql.includes('FROM hiring_episodes he')) {
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
    expect(sqlSeen.find((sql) => sql.includes('FROM hiring_episodes he')))
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
      if (sql.includes('FROM hiring_episodes he')) {
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
