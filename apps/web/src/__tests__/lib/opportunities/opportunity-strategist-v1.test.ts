import {
  OpportunityStrategistV1,
  type OpportunityStrategistInput,
} from '@/lib/opportunities/opportunity-strategist-v1'
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
  signalIds: ['101'],
  evidenceIds: ['201'],
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
    agencyFit: {
      score: 0.8,
      reasons: [{
        code: 'ROLE_MATCH',
        message: 'Backend входит в специализацию агентства.',
        evidenceIds: [],
        basis: 'profile',
      }],
    },
    hiringIntent: { score: 0.9, reasons: [] },
    externalSupportNeed: {
      score: 0.85,
      reasons: [{
        code: 'VACANCY_SPIKE',
        message: 'Темп найма заметно вырос относительно baseline.',
        evidenceIds: ['101', '201'],
        basis: 'evidence',
      }],
    },
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

const INPUT: OpportunityStrategistInput = {
  organizationName: 'Пример',
  episode: EPISODE,
  score: SCORE,
  agency: {
    specialization: 'Java и backend',
    matchedRoleFamilies: ['backend'],
    matchedIndustries: ['it'],
    matchedRegions: ['Москва'],
    hiringMode: 'specialist',
    organizationCompanySizeBucket: 'medium',
    caseStudies: [{
      roleFamilies: ['backend'],
      industries: ['it'],
      companySizeBucket: 'medium',
      region: 'Москва',
      hiringModes: ['specialist'],
      publicSafeDescription: 'Подбор backend-команды для продуктовой IT-компании.',
    }],
  },
}

describe('OpportunityStrategistV1', () => {
  it('builds every deterministic conclusion with evidence IDs or an explicit heuristic basis', () => {
    const strategist = new OpportunityStrategistV1()
    const first = strategist.build(INPUT)
    const second = strategist.build(INPUT)

    expect(second).toEqual(first)
    expect(first.version).toBe('opportunity-strategist-v1')
    expect(first).toEqual(expect.objectContaining({
      whatChanged: expect.any(Object),
      whyNow: expect.any(Object),
      problemHypothesis: expect.any(Object),
      agencyFitExplanation: expect.any(Object),
      externalSupportNeedExplanation: expect.any(Object),
      recommendedPersona: expect.any(Object),
      recommendedAngle: expect.any(Object),
      recommendedCaseStudy: expect.any(Object),
      recommendedNextAction: expect.any(Object),
      riskSignals: expect.any(Array),
      limitations: expect.any(Array),
    }))

    const conclusions = [
      first.whatChanged,
      first.whyNow,
      first.problemHypothesis,
      first.agencyFitExplanation,
      first.externalSupportNeedExplanation,
      first.recommendedPersona,
      first.recommendedAngle,
      first.recommendedCaseStudy,
      first.recommendedNextAction,
      ...first.riskSignals,
      ...first.limitations,
    ]
    for (const conclusion of conclusions) {
      expect(conclusion.text.trim()).not.toBe('')
      if (conclusion.basis === 'evidence') {
        expect(conclusion.supportingEvidenceIds.length).toBeGreaterThan(0)
      } else {
        expect(conclusion.basis).toBe('heuristic')
        expect(conclusion.supportingEvidenceIds).toEqual([])
      }
    }
    expect(first.whatChanged.supportingEvidenceIds).toEqual(['101', '201'])
    expect(first.externalSupportNeedExplanation.supportingEvidenceIds)
      .toEqual(['101', '201'])
  })

  it('recommends only an exact structural case match across all five dimensions', () => {
    const strategist = new OpportunityStrategistV1()
    const matched = strategist.build(INPUT)
    const wrongMode = strategist.build({
      ...INPUT,
      agency: {
        ...INPUT.agency,
        caseStudies: INPUT.agency.caseStudies.map((item) => ({
          ...item,
          hiringModes: ['executive'],
        })),
      },
    })

    expect(matched.recommendedCaseStudy.text).toContain('backend-команды')
    expect(wrongMode.recommendedCaseStudy.text).toMatch(/не найден|нет подтверждённого/i)
    expect(wrongMode.recommendedCaseStudy.text).not.toContain('backend-команды')
  })

  it('uses role functions only and never invents commercial certainty or contact data', () => {
    const brief = new OpportunityStrategistV1().build(INPUT)
    const copy = JSON.stringify(brief).toLocaleLowerCase('ru-RU')

    expect(brief.recommendedPersona.text).toMatch(
      /Head of Recruitment|HRD|CTO|руководитель коммерческого направления/,
    )
    expect(copy).not.toContain('есть бюджет')
    expect(copy).not.toContain('готова работать с агентством')
    expect(copy).not.toContain('гарантированно')
    expect(copy).not.toContain('вероятность сделки')
    expect(copy).not.toContain('@')
    expect(copy).not.toMatch(/\+7\d/)
  })

  it('fails closed on case matching when a structural dimension is unknown', () => {
    const brief = new OpportunityStrategistV1().build({
      ...INPUT,
      agency: {
        ...INPUT.agency,
        organizationCompanySizeBucket: null,
      },
    })

    expect(brief.recommendedCaseStudy.text).toMatch(/не найден|нет подтверждённого/i)
    expect(brief.limitations.some((item) =>
      item.text.toLocaleLowerCase('ru-RU').includes('размер'),
    )).toBe(true)
  })
})
