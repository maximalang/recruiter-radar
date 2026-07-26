import {
  DEFAULT_HIRING_EPISODE_CONFIG,
  HiringEpisodeDetectionService,
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

    const cluster = episodes.find((episode) => episode.episodeType === 'new_role_cluster')
    expect(cluster?.metadata.roleFamily).toBe('backend')
    expect(cluster?.vacancyCount).toBe(3)
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
