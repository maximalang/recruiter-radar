import { canonicalizeVacancies } from '@/lib/opportunities/hiring-episode-detection'
import { persistCanonicalVacancyLifecycle } from '@/lib/opportunities/canonical-vacancy-lifecycle-repository'

test('persists cross-source copies as one canonical vacancy with two publications', async () => {
  const sqlSeen: string[] = []
  const query = jest.fn(async (sql: string) => {
    sqlSeen.push(sql)
    if (sql.includes('FROM canonical_vacancies_v1')) return { rowCount: 0, rows: [] }
    if (sql.includes('FROM source_run_observations')) return { rowCount: 0, rows: [] }
    if (sql.includes('INSERT INTO canonical_vacancies_v1')) {
      return { rowCount: 1, rows: [{ id: '41' }] }
    }
    if (sql.includes('INSERT INTO canonical_vacancy_observations_v1')) {
      return { rowCount: 1, rows: [{ id: '51' }] }
    }
    return { rowCount: 1, rows: [] }
  })
  const vacancies = canonicalizeVacancies([
    {
      id: '11', organizationId: '7', signalType: 'job_posting',
      title: 'Senior Java Developer', region: 'Москва', source: 'career-pages',
      sourceUrl: 'https://example.ru/jobs/java?utm_source=feed',
      externalVacancyId: null, occurredAt: '2026-01-01T00:00:00.000Z',
      evidenceIds: ['101'],
    },
    {
      id: '12', organizationId: '7', signalType: 'job_posting',
      title: 'Senior Java Developer', region: 'Москва', source: 'smartrecruiters',
      sourceUrl: 'https://example.ru/jobs/java', externalVacancyId: 'java-1',
      occurredAt: '2026-01-02T00:00:00.000Z', evidenceIds: ['102'],
    },
  ])

  const result = await persistCanonicalVacancyLifecycle(
    '7',
    vacancies,
    new Date('2026-01-02T00:00:00.000Z'),
    { query } as never,
  )

  expect(vacancies).toHaveLength(1)
  expect(result).toMatchObject({ observed: 1, opened: 1 })
  expect(sqlSeen.filter((sql) =>
    sql.includes('INSERT INTO canonical_vacancy_publications_v1'))).toHaveLength(2)
  expect(sqlSeen.filter((sql) =>
    sql.includes('INSERT INTO canonical_vacancy_events_v1'))).toHaveLength(1)
})

test('closes an absent vacancy only from distinct successful source runs after TTL', async () => {
  const calls: Array<{ sql: string; params?: readonly unknown[] }> = []
  const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
    calls.push({ sql, params })
    if (sql.includes('FROM canonical_vacancies_v1')) {
      return { rowCount: 1, rows: [{
        id: '41', vacancyFingerprint: 'a'.repeat(64), active: true,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        lastSourceSeenAt: '2026-01-01T00:00:00.000Z', closedAt: null,
        reopenedAt: null, reopenedCount: 0, sourceFamilies: ['career-pages'],
        successfulAbsenceObservationIds: [],
      }] }
    }
    if (sql.includes('FROM source_run_observations')) {
      return { rowCount: 2, rows: [
        { id: '201', sourceId: 'career-pages', completedAt: '2026-01-16T00:00:00.000Z' },
        { id: '202', sourceId: 'career-pages', completedAt: '2026-01-17T00:00:00.000Z' },
      ] }
    }
    if (sql.includes('INSERT INTO canonical_vacancy_observations_v1')) {
      return { rowCount: 1, rows: [{ id: '52' }] }
    }
    return { rowCount: 1, rows: [] }
  })

  const result = await persistCanonicalVacancyLifecycle(
    '7', [], new Date('2026-01-17T00:00:00.000Z'), { query } as never,
  )

  expect(result).toMatchObject({ observed: 1, closed: 1 })
  const update = calls.find((call) => call.sql.includes('UPDATE canonical_vacancies_v1'))
  expect(update?.params?.[1]).toBe(false)
  expect(update?.params?.[3]).toEqual([201, 202])
})

test('does not advance last-source-seen when no newer pipeline observation exists', async () => {
  const sqlSeen: string[] = []
  const query = jest.fn(async (sql: string) => {
    sqlSeen.push(sql)
    if (sql.includes('FROM canonical_vacancies_v1')) {
      return { rowCount: 1, rows: [{
        id: '41', vacancyFingerprint: 'a'.repeat(64), active: true,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-10T00:00:00.000Z',
        lastSourceSeenAt: '2026-01-10T00:00:00.000Z', closedAt: null,
        reopenedAt: null, reopenedCount: 0, sourceFamilies: ['career-pages'],
        successfulAbsenceObservationIds: [],
      }] }
    }
    if (sql.includes('FROM source_run_observations')) {
      return { rowCount: 1, rows: [{
        id: '200', sourceId: 'career-pages',
        startedAt: '2026-01-08T00:00:00.000Z',
        completedAt: '2026-01-08T00:01:00.000Z',
      }] }
    }
    return { rowCount: 1, rows: [] }
  })
  const vacancy = canonicalizeVacancies([{
    id: '11', organizationId: '7', signalType: 'job_posting', title: 'Java',
    region: 'Москва', source: 'career-pages', sourceUrl: 'https://x.test/11',
    externalVacancyId: '11', occurredAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-01-01T00:00:00.000Z', evidenceIds: ['101'],
  }])

  const result = await persistCanonicalVacancyLifecycle(
    '7', vacancy, new Date('2026-01-12T00:00:00.000Z'), { query } as never,
  )

  expect(result.observed).toBe(0)
  expect(sqlSeen.some((sql) => sql.includes('UPDATE canonical_vacancies_v1')))
    .toBe(false)
  expect(sqlSeen.some((sql) => sql.includes('INSERT INTO canonical_vacancies_v1')))
    .toBe(false)
})
