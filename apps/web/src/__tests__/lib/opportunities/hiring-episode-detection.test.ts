import {
  DEFAULT_HIRING_EPISODE_CONFIG,
  HiringEpisodeDetectionService,
  canonicalizeVacancies,
  isEpisodeContinuation,
  isEpisodeInactive,
  type HiringSignalInput,
} from '@/lib/opportunities/hiring-episode-detection'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-26T12:00:00.000Z')

function signal(
  id: string,
  daysAgo: number,
  overrides: Partial<HiringSignalInput> = {},
): HiringSignalInput {
  return {
    id,
    organizationId: '10',
    signalType: 'job_posting',
    title: `Backend developer ${id}`,
    region: 'Москва',
    source: 'hh',
    sourceUrl: `https://example.test/vacancies/${id}`,
    occurredAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    evidenceIds: [],
    ...overrides,
  }
}

describe('HiringEpisodeDetectionService', () => {
  const service = new HiringEpisodeDetectionService()

  it('creates a vacancy_spike from a current window above the historical baseline', () => {
    const signals = [
      signal('old-1', 55),
      signal('old-2', 38),
      signal('new-1', 12),
      signal('new-2', 9),
      signal('new-3', 6),
      signal('new-4', 3),
      signal('new-5', 1),
    ]

    const episodes = service.detectOrganization({
      organizationId: '10',
      signals,
      now: NOW,
    })

    const spike = episodes.find((episode) => episode.episodeType === 'vacancy_spike')
    expect(spike).toBeDefined()
    expect(spike?.vacancyCount).toBe(5)
    expect(spike?.signalIds).toEqual(['new-1', 'new-2', 'new-3', 'new-4', 'new-5'])
    expect(spike?.engineVersion).toBe('hiring-episode-v1')
  })

  it('produces a stable key and evidence hash for identical input regardless of order', () => {
    const signals = [
      signal('old-1', 50),
      signal('new-1', 10, { evidenceIds: ['e-2'] }),
      signal('new-2', 8, { evidenceIds: ['e-1'] }),
      signal('new-3', 6),
      signal('new-4', 4),
    ]

    const first = service.detectOrganization({ organizationId: '10', signals, now: NOW })
    const second = service.detectOrganization({
      organizationId: '10',
      signals: [...signals].reverse(),
      now: NOW,
    })

    expect(second.map((episode) => episode.episodeKey)).toEqual(
      first.map((episode) => episode.episodeKey),
    )
    expect(second.map((episode) => episode.evidenceHash)).toEqual(
      first.map((episode) => episode.evidenceHash),
    )
  })

  it('keeps the same episode identity when the rolling window moves', () => {
    const first = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('first-1', 12),
        signal('first-2', 9),
        signal('first-3', 6),
        signal('first-4', 3),
      ],
    }).find((episode) => episode.episodeType === 'vacancy_spike')
    const laterNow = new Date(NOW.getTime() + 5 * DAY)
    const second = service.detectOrganization({
      organizationId: '10',
      now: laterNow,
      signals: [
        signal('first-3', 6),
        signal('first-4', 3),
        signal('second-1', -2),
        signal('second-2', -4),
      ],
    }).find((episode) => episode.episodeType === 'vacancy_spike')

    expect(first?.episodeIdentity).toBeDefined()
    expect(second?.episodeIdentity).toBe(first?.episodeIdentity)
    expect(first?.episodeIdentity).toMatch(/^10:vacancy_spike:/)
    expect(second?.episodeKey).toBe(first?.episodeKey)
    expect(first?.episodeKey).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('detects a repeated vacancy after a historical gap', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('old', 48, { title: 'Senior Java developer' }),
        signal('new', 2, { title: '  Senior Java Developer  ' }),
      ],
    })

    const repeated = episodes.find((episode) => episode.episodeType === 'repeated_vacancies')
    expect(repeated).toBeDefined()
    expect(repeated?.signalIds).toEqual(['old', 'new'])
  })

  it('detects a repost when the source assigns a new external vacancy id', () => {
    const repeated = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('old', 48, {
          title: 'Senior Java developer',
          externalVacancyId: 'hh-old',
        }),
        signal('new', 2, {
          title: 'Senior Java developer',
          externalVacancyId: 'hh-new',
        }),
      ],
    }).find((episode) => episode.episodeType === 'repeated_vacancies')

    expect(repeated?.episodeIdentity).toBe('10:repeated_vacancies:all')
    expect(repeated?.signalIds).toEqual(['old', 'new'])
  })

  it('detects a deterministic role cluster without ML classification', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('b1', 7, { title: 'Backend developer' }),
        signal('b2', 5, { title: 'Senior backend engineer' }),
        signal('b3', 2, { title: 'Java backend developer' }),
      ],
    })

    const cluster = episodes.find((episode) => episode.episodeType === 'role_cluster')
    expect(cluster?.metadata.roleFamily).toBe('backend')
    expect(cluster?.metadata.episodeDimension).toBe('backend')
    expect(cluster?.vacancyCount).toBe(3)
  })

  it('counts the same canonical vacancy from two publications once', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('hh-java', 7, {
          title: '  Java Developer ',
          source: 'hh',
          sourceUrl: 'https://example.test/jobs/java?utm_source=hh',
        }),
        signal('career-java', 6, {
          title: 'java developer',
          source: 'career-pages',
          sourceUrl: 'https://example.test/jobs/java?ref=careers',
        }),
        signal('node', 4, { title: 'Node.js developer' }),
        signal('python', 2, { title: 'Python developer' }),
      ],
    })

    const cluster = episodes.find((episode) => episode.episodeType === 'role_cluster')
    expect(cluster?.signalIds).toEqual(['hh-java', 'career-java', 'node', 'python'])
    expect(cluster?.vacancyCount).toBe(3)
    expect(cluster?.metadata.publicationCount).toBe(4)
  })

  it('does not collapse a newly reopened role outside the publication window', () => {
    const vacancies = canonicalizeVacancies([
        signal('old-java', 55, { title: 'Java developer', sourceUrl: null }),
        signal('new-java', 2, { title: 'java developer', sourceUrl: null }),
        signal('node', 4, { title: 'Node.js developer' }),
      ])

    expect(vacancies).toHaveLength(3)
  })

  it('does not bridge fallback matches across the publication window', () => {
    const vacancies = canonicalizeVacancies([
      signal('day-40', 40, { title: 'Java developer', sourceUrl: null }),
      signal('day-20', 20, { title: 'java developer', sourceUrl: null }),
      signal('day-0', 0, { title: 'JAVA DEVELOPER', sourceUrl: null }),
    ])

    expect(vacancies).toHaveLength(2)
    expect(vacancies.every((vacancy) => vacancy.publications.length < 3)).toBe(true)
  })

  it('canonicalizes tracking parameters before comparing destination URLs', () => {
    const vacancies = canonicalizeVacancies([
        signal('owned', 5, {
          title: 'Backend developer',
          source: 'career-pages',
          sourceUrl: 'https://jobs.example.test/opening/42?utm_source=careers#apply',
        }),
        signal('platform', 4, {
          title: 'Ведущий разработчик',
          source: 'hh',
          sourceUrl: 'https://jobs.example.test/opening/42?ref=hh',
        }),
        signal('node', 3, { title: 'Node.js developer' }),
        signal('python', 2, { title: 'Python developer' }),
      ])

    expect(vacancies).toHaveLength(3)
    expect(vacancies.find((vacancy) => vacancy.publications.length === 2)).toBeDefined()
  })

  it('keeps one canonical vacancy when a stable external id outlives title changes', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('publication-1', 4, {
          title: 'Senior Backend Developer',
          region: 'Москва',
          externalVacancyId: 'hh-900',
        }),
        signal('publication-2', 2, {
          title: 'Ведущий backend-разработчик',
          region: 'Удалённо',
          externalVacancyId: 'hh-900',
        }),
        signal('other-1', 3),
        signal('other-2', 2),
        signal('other-3', 1),
      ],
    })

    const spike = episodes.find((episode) => episode.episodeType === 'vacancy_spike')
    expect(spike?.vacancyCount).toBe(4)
    expect(spike?.signalIds).toEqual(expect.arrayContaining([
      'publication-1',
      'publication-2',
    ]))
  })

  it('keeps vacancies with the same title and different external ids separate', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('java-1', 7, {
          title: 'Java developer',
          externalVacancyId: '1001',
        }),
        signal('java-2', 5, {
          title: 'java developer',
          externalVacancyId: '1002',
        }),
        signal('java-3', 2, {
          title: 'JAVA DEVELOPER',
          externalVacancyId: '1003',
        }),
      ],
    })

    const cluster = episodes.find((episode) => episode.episodeType === 'role_cluster')
    expect(cluster?.vacancyCount).toBe(3)
  })

  it('keeps case-distinct external ids from the same provider separate', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('case-1', 7, {
          title: 'Java developer',
          externalVacancyId: 'AbC',
        }),
        signal('case-2', 5, {
          title: 'java developer',
          externalVacancyId: 'abc',
        }),
        signal('case-3', 2, {
          title: 'Python developer',
          externalVacancyId: 'python-1',
        }),
      ],
    })

    const cluster = episodes.find((episode) => episode.episodeType === 'role_cluster')
    expect(cluster?.vacancyCount).toBe(3)
  })

  it('transitive vacancy bridge cannot merge conflicting provider ids', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('hh-1001', 7, {
          title: 'Java developer',
          source: 'hh',
          externalVacancyId: '1001',
        }),
        signal('career-java', 6, {
          title: 'Java developer',
          source: 'career-pages',
          externalVacancyId: null,
        }),
        signal('hh-1002', 5, {
          title: 'Java developer',
          source: 'hh',
          externalVacancyId: '1002',
        }),
        signal('node', 3, { title: 'Node.js developer' }),
        signal('python', 1, { title: 'Python developer' }),
      ],
    })

    const cluster = episodes.find((episode) => episode.episodeType === 'role_cluster')
    expect(cluster?.vacancyCount).toBe(4)
    expect(cluster?.signalIds).toEqual(expect.arrayContaining([
      'hh-1001',
      'career-java',
      'hh-1002',
    ]))
  })

  it('detects a new region only relative to real organization history', () => {
    const withHistory = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('history', 45, { region: 'Москва' }),
        signal('kazan-1', 4, { region: 'Казань' }),
        signal('kazan-2', 2, { region: 'Казань' }),
      ],
    })
    const withoutHistory = service.detectOrganization({
      organizationId: '11',
      now: NOW,
      signals: [
        signal('kazan-1', 4, { organizationId: '11', region: 'Казань' }),
        signal('kazan-2', 2, { organizationId: '11', region: 'Казань' }),
      ],
    })

    expect(
      withHistory.some(
        (episode) =>
          episode.episodeType === 'new_region' && episode.metadata.region === 'Казань',
      ),
    ).toBe(true)
    expect(withoutHistory.some((episode) => episode.episodeType === 'new_region')).toBe(false)
  })

  it('detects hiring restart after a configured inactivity period', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('historic', 100),
        signal('restart-1', 3),
        signal('restart-2', 1),
      ],
    })

    expect(episodes.some((episode) => episode.episodeType === 'hiring_restart')).toBe(true)
  })

  it('detects sustained hiring across consecutive periods', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [
        signal('p1-a', 19),
        signal('p1-b', 16),
        signal('p2-a', 12),
        signal('p2-b', 9),
        signal('p3-a', 5),
        signal('p3-b', 2),
      ],
    })

    expect(episodes.some((episode) => episode.episodeType === 'sustained_hiring')).toBe(true)
  })

  it('does not create an active episode from stale signals alone', () => {
    const episodes = service.detectOrganization({
      organizationId: '10',
      now: NOW,
      signals: [signal('old-1', 40), signal('old-2', 35)],
    })

    expect(episodes).toEqual([])
  })

  it('marks an episode inactive only after the configured threshold', () => {
    expect(
      isEpisodeInactive(
        new Date(NOW.getTime() - 31 * DAY).toISOString(),
        NOW,
        DEFAULT_HIRING_EPISODE_CONFIG,
      ),
    ).toBe(true)
    expect(
      isEpisodeInactive(
        new Date(NOW.getTime() - 29 * DAY).toISOString(),
        NOW,
        DEFAULT_HIRING_EPISODE_CONFIG,
      ),
    ).toBe(false)
  })
})

describe('episode continuation boundary', () => {
  it('uses the newest candidate evidence rather than its historical window start', () => {
    const latest = {
      status: 'active' as const,
      lastSeenAt: '2026-05-01T00:00:00.000Z',
    }

    expect(
      isEpisodeContinuation(latest, '2026-05-25T00:00:00.000Z'),
    ).toBe(true)
    expect(
      isEpisodeContinuation(latest, '2026-06-01T00:00:00.000Z'),
    ).toBe(false)
  })

  it('does not continue a closed episode or one with invalid timestamps', () => {
    expect(
      isEpisodeContinuation(
        { status: 'closed', lastSeenAt: '2026-05-01T00:00:00.000Z' },
        '2026-05-02T00:00:00.000Z',
      ),
    ).toBe(false)
    expect(
      isEpisodeContinuation(
        { status: 'active', lastSeenAt: 'invalid' },
        '2026-05-02T00:00:00.000Z',
      ),
    ).toBe(false)
  })

  it('allows bounded evidence contraction but rejects an unbounded stale candidate', () => {
    const latest = {
      status: 'active' as const,
      lastSeenAt: '2026-05-25T00:00:00.000Z',
    }

    expect(
      isEpisodeContinuation(latest, '2026-05-20T00:00:00.000Z'),
    ).toBe(true)
    expect(
      isEpisodeContinuation(latest, '2025-05-20T00:00:00.000Z'),
    ).toBe(false)
  })
})
