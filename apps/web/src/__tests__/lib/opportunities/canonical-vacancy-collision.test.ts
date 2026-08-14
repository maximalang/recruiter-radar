import {
  canonicalizeVacancies,
  type HiringSignalInput,
} from '@/lib/opportunities/hiring-episode-detection'

function vacancy(overrides: Partial<HiringSignalInput>): HiringSignalInput {
  return {
    id: 'signal-1',
    organizationId: '42',
    signalType: 'job_posting',
    title: 'Менеджер по продажам',
    region: 'Москва',
    source: 'hh',
    sourceUrl: 'https://company.example/jobs/sales',
    externalVacancyId: '1',
    occurredAt: '2026-08-14T08:00:00.000Z',
    evidenceIds: ['evidence-1'],
    ...overrides,
  }
}

describe('canonical vacancy collision safety', () => {
  test('HH + SuperJob strong IDs merge when the canonical vacancy URL corroborates one physical vacancy', () => {
    const canonical = canonicalizeVacancies([
      vacancy({
        id: 'hh-publication',
        source: 'hh',
        sourceUrl: 'https://company.example/jobs/sales?utm_source=hh',
        externalVacancyId: '1',
      }),
      vacancy({
        id: 'sj-publication',
        source: 'superjob',
        sourceUrl: 'https://company.example/jobs/sales',
        externalVacancyId: '2',
        occurredAt: '2026-08-14T09:00:00.000Z',
        evidenceIds: ['evidence-2'],
      }),
    ])

    expect(canonical).toHaveLength(1)
    expect(canonical[0].publications.map((publication) => publication.id).sort())
      .toEqual(['hh-publication', 'sj-publication'])
  })

  test('HH + SuperJob distinct strong identities do not merge on title/location/time alone', () => {
    const canonical = canonicalizeVacancies([
      vacancy({
        id: 'hh-vacancy-a',
        source: 'hh',
        sourceUrl: 'https://hh.example/vacancy/1',
        externalVacancyId: '1',
      }),
      vacancy({
        id: 'sj-vacancy-b',
        source: 'superjob',
        sourceUrl: 'https://superjob.example/vakansii/2',
        externalVacancyId: '2',
        occurredAt: '2026-08-14T09:00:00.000Z',
        evidenceIds: ['evidence-2'],
      }),
    ])

    expect(canonical).toHaveLength(2)
    expect(canonical.map((item) => item.publications.map((publication) => publication.id)))
      .toEqual(expect.arrayContaining([['hh-vacancy-a'], ['sj-vacancy-b']]))
  })

  test('a weak intermediary cannot transitively collapse two distinct strong provider identities', () => {
    const canonical = canonicalizeVacancies([
      vacancy({
        id: 'hh-strong',
        source: 'hh',
        sourceUrl: 'https://hh.example/vacancy/1',
        externalVacancyId: '1',
      }),
      vacancy({
        id: 'career-weak',
        source: 'career-pages',
        sourceUrl: null,
        externalVacancyId: null,
        occurredAt: '2026-08-14T08:30:00.000Z',
        evidenceIds: ['evidence-weak'],
      }),
      vacancy({
        id: 'sj-strong',
        source: 'superjob',
        sourceUrl: 'https://superjob.example/vakansii/2',
        externalVacancyId: '2',
        occurredAt: '2026-08-14T09:00:00.000Z',
        evidenceIds: ['evidence-2'],
      }),
    ])

    expect(canonical).toHaveLength(2)
    expect(canonical.flatMap((item) => item.publications.map((publication) => publication.id)).sort())
      .toEqual(['career-weak', 'hh-strong', 'sj-strong'])
    expect(canonical.some((item) =>
      item.publications.some((publication) => publication.id === 'hh-strong') &&
      item.publications.some((publication) => publication.id === 'sj-strong')))
      .toBe(false)
  })
})
