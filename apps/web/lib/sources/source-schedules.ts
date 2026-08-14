import type { SourceId } from './source-registry'

export interface SourceSchedule {
  expectedRefreshIntervalMs: number
  hostKey: string
  perHostConcurrency: number
  /** Unified crawlers own health for their hosted-ATS adapters. */
  healthSourceId?: SourceId
}

const HOUR = 60 * 60 * 1_000
const DAY = 24 * HOUR

/**
 * Explicit operating cadence for every registered source. Keeping this map
 * exhaustive makes a newly registered source fail type-check until its load,
 * freshness, and host-sharing policy are chosen deliberately.
 */
export const SOURCE_SCHEDULES: Record<SourceId, SourceSchedule> = {
  hh: { expectedRefreshIntervalMs: HOUR, hostKey: 'api.hh.ru', perHostConcurrency: 1 },
  superjob: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'api.superjob.ru', perHostConcurrency: 1 },
  'habr-career': { expectedRefreshIntervalMs: DAY, hostKey: 'snapshot:habr-career', perHostConcurrency: 1 },
  'linkedin-company-pages': { expectedRefreshIntervalMs: DAY, hostKey: 'snapshot:linkedin', perHostConcurrency: 1 },
  'career-pages': { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1 },
  greenhouse: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1, healthSourceId: 'career-pages' },
  lever: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1, healthSourceId: 'career-pages' },
  ashby: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1, healthSourceId: 'career-pages' },
  recruitee: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1, healthSourceId: 'career-pages' },
  workable: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1, healthSourceId: 'career-pages' },
  smartrecruiters: { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1, healthSourceId: 'career-pages' },
  'egrul-fns': { expectedRefreshIntervalMs: 7 * DAY, hostKey: 'snapshot:fns', perHostConcurrency: 1 },
  'rabota-rossii': { expectedRefreshIntervalMs: 6 * HOUR, hostKey: 'trudvsem.ru', perHostConcurrency: 1 },
  'company-site': { expectedRefreshIntervalMs: 12 * HOUR, hostKey: 'company-public-web', perHostConcurrency: 1 },
  'funding-business-signals': { expectedRefreshIntervalMs: DAY, hostKey: 'api.gdeltproject.org', perHostConcurrency: 1 },
  fedresurs: { expectedRefreshIntervalMs: DAY, hostKey: 'snapshot:fedresurs', perHostConcurrency: 1 },
  'transparent-business-fns': { expectedRefreshIntervalMs: 7 * DAY, hostKey: 'snapshot:fns', perHostConcurrency: 1 },
  'company-newsrooms': { expectedRefreshIntervalMs: DAY, hostKey: 'company-public-web', perHostConcurrency: 1 },
  'industry-media': { expectedRefreshIntervalMs: DAY, hostKey: 'public-rss', perHostConcurrency: 2 },
  'github-company-org': { expectedRefreshIntervalMs: 18 * HOUR, hostKey: 'api.github.com', perHostConcurrency: 1 },
  'youtube-company-channels': { expectedRefreshIntervalMs: DAY, hostKey: 'youtube.googleapis.com', perHostConcurrency: 1 },
  'telegram-company-channels': { expectedRefreshIntervalMs: 3 * HOUR, hostKey: 'telegram-mtproto', perHostConcurrency: 1 },
  'fns-open-data': { expectedRefreshIntervalMs: 7 * DAY, hostKey: 'snapshot:fns', perHostConcurrency: 1 },
  'government-procurement': { expectedRefreshIntervalMs: DAY, hostKey: 'snapshot:eis', perHostConcurrency: 1 },
  'cbr-registry': { expectedRefreshIntervalMs: 7 * DAY, hostKey: 'cbr.ru', perHostConcurrency: 1 },
  'rosstat-open-data': { expectedRefreshIntervalMs: 7 * DAY, hostKey: 'snapshot:rosstat', perHostConcurrency: 1 },
  'rospatent-open-data': { expectedRefreshIntervalMs: 7 * DAY, hostKey: 'snapshot:rospatent', perHostConcurrency: 1 },
}

export function getSourceSchedule(source: SourceId): SourceSchedule {
  return SOURCE_SCHEDULES[source]
}
