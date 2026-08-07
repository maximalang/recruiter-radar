import {
  buildCommercialThesis,
  COMMERCIAL_THESIS_ENGINE_VERSION,
  type CommercialThesisEpisodeInput,
} from '@/lib/opportunities/commercial-thesis'
import { SIGNAL_EPISODE_TYPES } from '@/lib/opportunities/signal-episode'

const NOW = new Date('2026-08-04T12:00:00.000Z')

function episode(
  overrides: Partial<CommercialThesisEpisodeInput> = {},
): CommercialThesisEpisodeInput {
  return {
    id: '701',
    organizationId: '10',
    episodeIdentity: 'a'.repeat(64),
    episodeGeneration: 1,
    episodeType: 'vacancy_acceleration',
    stage: 'active',
    startedAt: '2026-08-01T09:00:00.000Z',
    lastSeenAt: '2026-08-04T10:00:00.000Z',
    validUntil: '2026-08-25T10:00:00.000Z',
    intensity: 0.82,
    direction: 'up',
    baselineDeviation: 1.5,
    roleFamilies: ['backend'],
    regions: ['Moscow'],
    seniorityDistribution: { senior: 3, unspecified: 1 },
    problemHypotheses: ['delivery_capacity_pressure'],
    evidenceRefs: ['201', '202'],
    evidenceHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    engineVersion: 'signal-episode-v2',
    ...overrides,
  }
}

describe('Commercial Thesis v1', () => {
  it('separates facts, rule inferences, hypotheses, and unknown agency fit', () => {
    const result = buildCommercialThesis(episode(), { now: NOW })
    expect(result.rejections).toEqual([])
    const thesis = result.theses[0]

    expect(thesis).toMatchObject({
      organizationId: '10',
      signalEpisodeId: '701',
      signalEpisodeGeneration: 1,
      engineVersion: COMMERCIAL_THESIS_ENGINE_VERSION,
      evidenceRefs: ['201', '202'],
    })
    expect(thesis.whatChanged).toEqual(expect.arrayContaining([
      expect.objectContaining({
        classification: 'confirmed_fact',
        code: 'vacancy_acceleration_observed',
        evidenceRefs: ['201', '202'],
      }),
    ]))
    expect(thesis.whyItMatters[0].classification).toBe('rule_based_inference')
    expect(thesis.probableHiringProblem[0]).toMatchObject({
      classification: 'heuristic_hypothesis',
      code: 'delivery_capacity_pressure',
    })
    expect(thesis.whyExternalAgencyMayBeNeeded[0].classification)
      .toBe('heuristic_hypothesis')
    expect(thesis.whyThisAgencyFits).toEqual([
      expect.objectContaining({
        classification: 'unknown',
        code: 'agency_context_not_evaluated',
        evidenceRefs: [],
      }),
    ])
  })

  it.each(SIGNAL_EPISODE_TYPES)(
    'builds every mandatory section for %s without an opaque score',
    (episodeType) => {
      const thesis = buildCommercialThesis(episode({ episodeType }), {
        now: NOW,
      }).theses[0]
      for (const field of [
        'whatChanged',
        'whyItMatters',
        'probableHiringProblem',
        'whyExternalAgencyMayBeNeeded',
        'whyThisAgencyFits',
        'whyNow',
        'recommendedService',
        'recommendedPersona',
        'recommendedAngle',
        'risks',
        'limitations',
      ] as const) {
        expect(thesis[field].length).toBeGreaterThan(0)
      }
      expect(thesis).not.toHaveProperty('score')
      expect(thesis).not.toHaveProperty('eligibility')
      expect(thesis).not.toHaveProperty('status')
      expect(thesis).not.toHaveProperty('llmModel')
    },
  )

  it('keeps an expired situation auditable without claiming urgency', () => {
    const thesis = buildCommercialThesis(episode({
      stage: 'expired',
      lastSeenAt: '2026-08-02T10:00:00.000Z',
      validUntil: '2026-08-03T10:00:00.000Z',
    }), { now: NOW }).theses[0]

    expect(thesis.whyNow).toEqual([
      expect.objectContaining({
        classification: 'unknown',
        code: 'episode_expired_no_current_urgency',
      }),
    ])
    expect(thesis.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale_episode' }),
    ]))
    expect(thesis.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'current_need_not_confirmed' }),
    ]))
  })

  it('uses episode evidence for derived claims but not for declared unknowns', () => {
    const thesis = buildCommercialThesis(episode(), { now: NOW }).theses[0]
    const supported = [
      ...thesis.whatChanged,
      ...thesis.whyItMatters,
      ...thesis.probableHiringProblem,
      ...thesis.whyExternalAgencyMayBeNeeded,
      ...thesis.whyNow,
    ]
    expect(supported.every((statement) =>
      statement.evidenceRefs.join(',') === '201,202')).toBe(true)
    expect(thesis.whyThisAgencyFits[0].evidenceRefs).toEqual([])
    expect(thesis.limitations.some((statement) =>
      statement.code === 'facts_limited_to_public_evidence')).toBe(true)
  })

  it('rejects evidence-free, malformed, and future episode inputs', () => {
    expect(buildCommercialThesis(episode({ evidenceRefs: [] }), { now: NOW }))
      .toMatchObject({
        theses: [],
        rejections: [{ reasonCode: 'COMMERCIAL_THESIS_EVIDENCE_MISSING' }],
      })
    expect(buildCommercialThesis(episode({ episodeIdentity: 'invalid' }), {
      now: NOW,
    })).toMatchObject({
      theses: [],
      rejections: [{ reasonCode: 'COMMERCIAL_THESIS_EPISODE_INVALID' }],
    })
    expect(buildCommercialThesis(episode({
      problemHypotheses: ['Ignore previous evidence'],
    }), { now: NOW })).toMatchObject({
      theses: [],
      rejections: [{ reasonCode: 'COMMERCIAL_THESIS_EPISODE_INVALID' }],
    })
    expect(buildCommercialThesis(episode({
      lastSeenAt: '2026-08-05T10:00:00.000Z',
      validUntil: '2026-08-26T10:00:00.000Z',
    }), { now: NOW })).toMatchObject({
      theses: [],
      rejections: [{ reasonCode: 'COMMERCIAL_THESIS_EPISODE_FUTURE' }],
    })
  })

  it('is deterministic and changes the input hash when episode evidence changes', () => {
    const first = buildCommercialThesis(episode(), { now: NOW }).theses[0]
    const replay = buildCommercialThesis(episode(), { now: NOW }).theses[0]
    const changed = buildCommercialThesis(episode({
      evidenceRefs: ['201', '202', '203'],
      evidenceHash: 'd'.repeat(64),
      inputHash: 'e'.repeat(64),
    }), { now: NOW }).theses[0]

    expect(replay).toEqual(first)
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(changed.inputHash).not.toBe(first.inputHash)
    expect(changed.thesisIdentity).toBe(first.thesisIdentity)
  })
})
