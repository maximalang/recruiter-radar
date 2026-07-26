import {
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

describe('opportunity background jobs', () => {
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
      if (sql.includes('SELECT DISTINCT org_id')) {
        return { rowCount: 1, rows: [{ organizationId: '10' }] }
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
      if (sql.includes('SELECT DISTINCT org_id')) {
        return { rowCount: 1, rows: [{ organizationId: '10' }] }
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
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await detectHiringEpisodesJob({ enabled: true, now }, db)

    expect(result.updated).toBeGreaterThan(0)
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episodes')))
      .toContain('ON CONFLICT (organization_id, episode_key, engine_version)')
    expect(sqlSeen.find((sql) => sql.includes('INSERT INTO hiring_episode_evidence')))
      .toContain('ON CONFLICT')
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
})
