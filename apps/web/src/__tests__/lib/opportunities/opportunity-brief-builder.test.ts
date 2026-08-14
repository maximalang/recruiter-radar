import { OpportunityBriefBuilder } from '@/lib/opportunities/opportunity-brief-builder'
import type { HiringEpisodeCandidate } from '@/lib/opportunities/hiring-episode-detection'
import type { OpportunityScoreResult } from '@/lib/opportunities/opportunity-scoring'

const EPISODE: HiringEpisodeCandidate = {
  organizationId: '10',
  episodeType: 'vacancy_spike',
  episodeKey: 'vacancy_spike:backend:2026-07-20',
  episodeIdentity: 'f'.repeat(64),
  episodeGeneration: 1,
  title: 'Компания ускорила найм backend-разработчиков',
  summary: 'За последние 14 дней компания открыла 8 технических вакансий.',
  startedAt: '2026-07-15T00:00:00.000Z',
  lastSeenAt: '2026-07-25T00:00:00.000Z',
  signalCount: 8,
  vacancyCount: 8,
  strengthScore: 0.9,
  freshnessScore: 0.95,
  evidenceHash: 'a'.repeat(64),
  engineVersion: 'hiring-episode-v1',
  signalIds: ['s-1'],
  evidenceIds: ['e-1'],
  metadata: {
    activeWindowDays: 14,
    currentCount: 8,
    baselineCount: 3,
    growthMultiplier: 2.67,
    roleFamily: 'backend',
    repeatedVacancyCount: 2,
  },
}

const SCORE = {
  components: {
    agencyFit: { score: 0.8, reasons: [] },
    hiringIntent: { score: 0.9, reasons: [] },
    externalSupportNeed: { score: 0.85, reasons: [] },
    timing: { score: 0.9, reasons: [] },
    reachability: { score: 0.7, reasons: [] },
    confidence: { score: 0.9, reasons: [] },
  },
  opportunityScore: 0.84,
  confidenceGate: 'A',
  status: 'new',
  isMorningBriefEligible: true,
  scoringVersion: 'opportunity-v1',
} satisfies OpportunityScoreResult

const AGENCY = {
  agencyName: 'Агентство',
  specialization: 'Java и backend',
  hiringMode: 'specialist',
  matchedRoles: ['Java', 'Backend'],
  matchedIndustries: [],
  matchedRegions: ['Москва'],
  includeKeywords: ['java'],
  relevantFitReasons: ['Роли входят в специализацию агентства.'],
}

describe('OpportunityBriefBuilder', () => {
  it('builds deterministic cautious copy only from supplied facts', () => {
    const builder = new OpportunityBriefBuilder()
    const first = builder.build({
      organizationName: 'Пример',
      episode: EPISODE,
      score: SCORE,
      agency: AGENCY,
    })
    const second = builder.build({
      organizationName: 'Пример',
      episode: EPISODE,
      score: SCORE,
      agency: AGENCY,
    })

    expect(second).toEqual(first)
    expect(first.title).toBe('Пример ускорила найм backend-разработчиков')
    expect(first.whyNow).toContain('8')
    expect(first.whyNow).toContain('14')
    expect(first.whyNow).toContain('2,67')
    expect(first.problemHypothesis).toMatch(/есть признаки|может указывать/i)
    expect(first.recommendedAction).toMatch(/корпоративн/i)
    expect(first.agencyFitExplanation).toMatch(/Java|backend/i)
  })

  it('does not claim an agency mandate, budget, decision maker identity, or invented contact', () => {
    const brief = new OpportunityBriefBuilder().build({
      organizationName: 'Пример',
      episode: EPISODE,
      score: SCORE,
      agency: AGENCY,
    })
    const copy = Object.values(brief).join(' ').toLowerCase()

    expect(copy).not.toContain('ищет агентство')
    expect(copy).not.toContain('точно')
    expect(copy).not.toContain('бюджет')
    expect(copy).not.toContain('@')
    expect(copy).not.toMatch(/\+7\d/)
  })

  it('adds an exact temporal delta to why-now when hiring evidence already exists', () => {
    const brief = new OpportunityBriefBuilder().build({
      organizationName: 'Пример',
      episode: {
        ...EPISODE,
        metadata: {
          ...EPISODE.metadata,
          temporalContext: {
            events: [], activeVacancyCount: 27, vacancyDeltas: { '14': 15 },
            strongestAcceleration: {
              windowDays: 14, previous: 12, current: 27, change: 15,
            },
            newlyOpenedRoles: [], closedRoles: [], reopenedRoles: [],
            evidenceIds: ['e-1'],
          },
        },
      },
      score: SCORE,
      agency: AGENCY,
    })

    expect(brief.whyNow).toContain('с 12 до 27')
    expect(brief.whyNow).toContain('+15')
  })

  it('uses an evidence-safe fallback when an optional metric is absent', () => {
    const brief = new OpportunityBriefBuilder().build({
      organizationName: 'Пример',
      episode: {
        ...EPISODE,
        episodeType: 'hiring_restart',
        vacancyCount: 2,
        metadata: {},
      },
      score: SCORE,
      agency: AGENCY,
    })

    expect(brief.whyNow).toContain('возобновила найм')
    expect(brief.whyNow).not.toContain('undefined')
    expect(brief.whyNow).not.toContain('NaN')
  })
})
