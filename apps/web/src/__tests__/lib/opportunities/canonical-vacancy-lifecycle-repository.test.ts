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

test('closes an absent target-scoped vacancy only from exact successful target runs after TTL', async () => {
  const calls: Array<{ sql: string; params?: readonly unknown[] }> = []
  const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
    calls.push({ sql, params })
    if (sql.includes('FROM canonical_vacancies_v1')) {
      return { rowCount: 1, rows: [{
        id: '41', vacancyFingerprint: 'a'.repeat(64),
        normalizedRole: 'Java', location: 'Москва', canonicalDestinationUrl: 'https://x.test/11',
        sourceExternalIds: {}, sourceTargetKeys: { 'career-pages': ['target-a'] }, active: true,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        lastSourceSeenAt: '2026-01-01T00:00:00.000Z', closedAt: null,
        reopenedAt: null, reopenedCount: 0, sourceFamilies: ['career-pages'],
        successfulAbsenceObservationIds: [],
      }] }
    }
    if (sql.includes("scope = 'source'")) return { rowCount: 0, rows: [] }
    if (sql.includes("scope = 'target'")) {
      return { rowCount: 2, rows: [
        {
          id: '201', sourceId: 'career-pages', targetKey: 'target-a',
          startedAt: '2026-01-16T00:00:00.000Z', completedAt: '2026-01-16T00:01:00.000Z',
        },
        {
          id: '202', sourceId: 'career-pages', targetKey: 'target-a',
          startedAt: '2026-01-17T00:00:00.000Z', completedAt: '2026-01-17T00:01:00.000Z',
        },
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

test('does not close a vacancy from another target, blocked, throttled, or not-modified observations', async () => {
  const sqlSeen: string[] = []
  const query = jest.fn(async (sql: string) => {
    sqlSeen.push(sql)
    if (sql.includes('FROM canonical_vacancies_v1')) {
      return { rowCount: 1, rows: [{
        id: '41', vacancyFingerprint: 'a'.repeat(64),
        normalizedRole: 'Java', location: 'Москва', canonicalDestinationUrl: 'https://x.test/11',
        sourceExternalIds: {}, sourceTargetKeys: { greenhouse: ['board-a'] }, active: true,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        lastSourceSeenAt: '2026-01-01T00:00:00.000Z', closedAt: null,
        reopenedAt: null, reopenedCount: 0, sourceFamilies: ['greenhouse'],
        successfulAbsenceObservationIds: [],
      }] }
    }
    if (sql.includes("scope = 'source'")) return { rowCount: 0, rows: [] }
    if (sql.includes("scope = 'target'")) {
      return { rowCount: 2, rows: [
        {
          id: '301', sourceId: 'greenhouse', targetKey: 'other-board',
          startedAt: '2026-01-16T00:00:00.000Z', completedAt: '2026-01-16T00:01:00.000Z',
        },
        {
          id: '302', sourceId: 'greenhouse', targetKey: 'other-board',
          startedAt: '2026-01-17T00:00:00.000Z', completedAt: '2026-01-17T00:01:00.000Z',
        },
      ] }
    }
    return { rowCount: 1, rows: [] }
  })

  const result = await persistCanonicalVacancyLifecycle(
    '7', [], new Date('2026-01-17T00:00:00.000Z'), { query } as never,
  )

  expect(result).toMatchObject({ observed: 0, closed: 0 })
  expect(sqlSeen.some((sql) => sql.includes("target_outcome IN ('parsed', 'no-vacancies-present')"))).toBe(true)
  expect(sqlSeen.some((sql) => sql.includes('UPDATE canonical_vacancies_v1'))).toBe(false)
})

test('does not advance last-source-seen when no newer exact target observation exists', async () => {
  const sqlSeen: string[] = []
  const query = jest.fn(async (sql: string) => {
    sqlSeen.push(sql)
    if (sql.includes('FROM canonical_vacancies_v1')) {
      return { rowCount: 1, rows: [{
        id: '41', vacancyFingerprint: 'a'.repeat(64),
        normalizedRole: 'Java', location: 'Москва', canonicalDestinationUrl: 'https://x.test/11',
        sourceExternalIds: { 'career-pages': ['11'] }, sourceTargetKeys: { 'career-pages': ['target-a'] },
        active: true,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-10T00:00:00.000Z',
        lastSourceSeenAt: '2026-01-10T00:00:00.000Z', closedAt: null,
        reopenedAt: null, reopenedCount: 0, sourceFamilies: ['career-pages'],
        successfulAbsenceObservationIds: [],
      }] }
    }
    if (sql.includes("scope = 'source'")) return { rowCount: 0, rows: [] }
    if (sql.includes("scope = 'target'")) {
      return { rowCount: 1, rows: [{
        id: '200', sourceId: 'career-pages', targetKey: 'target-a',
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

test('preserves canonical identity when later publications add new source families', async () => {
  const hhOnly = canonicalizeVacancies([{
    id: '11', organizationId: '7', signalType: 'job_posting', title: 'Java Developer',
    region: 'Москва', source: 'hh', sourceUrl: 'https://jobs.example.ru/java?utm_source=hh',
    externalVacancyId: '100', occurredAt: '2026-01-01T00:00:00.000Z', evidenceIds: ['101'],
  }])[0]
  const expanded = canonicalizeVacancies([
    ...hhOnly.publications,
    {
      id: '12', organizationId: '7', signalType: 'job_posting', title: 'Java Developer',
      region: 'Москва', source: 'superjob', sourceUrl: 'https://jobs.example.ru/java?utm_source=superjob',
      externalVacancyId: '200', occurredAt: '2026-01-02T00:00:00.000Z', evidenceIds: ['102'],
    },
    {
      id: '13', organizationId: '7', signalType: 'job_posting', title: 'Java Developer',
      region: 'Москва', source: 'career-pages', sourceUrl: 'https://jobs.example.ru/java?ref=career',
      externalVacancyId: null, occurredAt: '2026-01-03T00:00:00.000Z', evidenceIds: ['103'],
    },
  ])
  expect(expanded).toHaveLength(1)
  expect(expanded[0].vacancyFingerprint).not.toBe(hhOnly.vacancyFingerprint)

  const calls: Array<{ sql: string; params?: readonly unknown[] }> = []
  const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
    calls.push({ sql, params })
    if (sql.includes('FROM canonical_vacancies_v1')) return { rowCount: 1, rows: [{
      id: '41', vacancyFingerprint: hhOnly.vacancyFingerprint,
      normalizedRole: 'Java Developer', location: 'Москва',
      canonicalDestinationUrl: 'https://jobs.example.ru/java?utm_source=hh',
      sourceExternalIds: { hh: ['100'] }, sourceTargetKeys: {}, active: true,
      firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z',
      lastSourceSeenAt: '2026-01-01T00:00:00.000Z', closedAt: null, reopenedAt: null,
      reopenedCount: 0, sourceFamilies: ['hh'], successfulAbsenceObservationIds: [],
    }] }
    if (sql.includes('FROM source_run_observations')) return { rowCount: 0, rows: [] }
    if (sql.includes('INSERT INTO canonical_vacancies_v1')) return { rowCount: 1, rows: [{ id: '41' }] }
    if (sql.includes('INSERT INTO canonical_vacancy_observations_v1')) return { rowCount: 1, rows: [{ id: '51' }] }
    return { rowCount: 1, rows: [] }
  })

  const result = await persistCanonicalVacancyLifecycle(
    '7', expanded, new Date('2026-01-03T00:00:00.000Z'), { query } as never,
  )

  expect(result).toMatchObject({ observed: 1, opened: 0 })
  const upsert = calls.find((call) => call.sql.includes('INSERT INTO canonical_vacancies_v1'))
  expect(upsert?.params?.[1]).toBe(hhOnly.vacancyFingerprint)
  expect(upsert?.params?.[12]).toEqual(['career-pages', 'hh', 'superjob'])
  expect(JSON.parse(String(upsert?.params?.[13]))).toEqual({
    'career-pages': [], hh: ['100'], superjob: ['200'],
  })
})