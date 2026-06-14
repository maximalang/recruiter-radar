/**
 * T6.2 — feedback → reweighting wiring.
 *
 * Closes the broken core loop: LeadScoringService must resolve client
 * overrides (badfit history) ONCE per run and feed them into the FIUR
 * pipeline so that "Мимо"/"Скрыть" feedback lowers future scores for the
 * penalized industry.
 *
 * These tests exercise the WIRING (service → computeClientOverrides →
 * pipeline → computeFiur), not the override math itself (covered by
 * client-overrides.test.ts).
 */
import { describe, it, expect, beforeEach } from '@jest/globals'

// Mock the overrides source so we control badfit history without a DB.
//
// next/jest's SWC transform only hoists `jest.mock` above the imports when
// the factory is self-contained (no reference to an outer variable) AND
// `jest` is the global — importing `jest` from '@jest/globals' disables the
// hoist, so the real module loads first and the mock never intercepts.
// We therefore use the global `jest`, an inline `jest.fn()` factory, and
// recover the mock handle via `jest.mocked` after the import.
jest.mock('@/lib/scoring/client-overrides', () => ({
  computeClientOverrides: jest.fn(),
}))

import { computeClientOverrides } from '@/lib/scoring/client-overrides'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'

const mockComputeClientOverrides = jest.mocked(computeClientOverrides)

function fintechLead(): MultiSourceLead {
  return {
    id: 'lead-fintech',
    companyId: 'org-fintech',
    companyName: 'FintechCorp',
    canonicalCompanyId: 'org-fintech',
    score: 2.5,
    confidence: 'B',
    sources: [
      {
        sourceId: 'career-page',
        sourceName: 'Career Page',
        evidenceType: 'career-page',
        confidence: 0.9,
        rawData: {},
        extractedAt: new Date(),
        relevanceScore: 0.9,
      },
    ],
    signals: [
      {
        companyId: 'org-fintech',
        companyName: 'FintechCorp',
        signalType: 'burst',
        strength: 0.8,
        evidence: ['role:backend engineer'],
        detectedAt: new Date(),
        publishedAt: new Date().toISOString(),
        location: 'Moscow',
      },
    ],
    nextAction: 'outreach',
    reasons: ['Active hiring'],
    detectedAt: new Date(),
    enrichment: {
      companySize: 'medium',
      industry: ['fintech'],
      locations: ['Moscow'],
      hiringVelocity: 3,
      lastHiringActivity: new Date(),
      website: 'https://fintechcorp.ru',
      employeeCount: 150,
      hasCareerPage: true,
      hasContactPath: true,
      careerPageUrl: 'https://fintechcorp.ru/careers',
    },
  } as unknown as MultiSourceLead
}

const AGENCY_PROFILE = {
  industries: ['fintech'],
  locations: ['Moscow'],
  roles: ['backend engineer'],
}

describe('T6.2 — feedback reweighting wiring', () => {
  let service: LeadScoringService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new LeadScoringService()
  })

  it('does not call computeClientOverrides when no clientProfileId', async () => {
    await service.scoreExistingLeads([fintechLead()], {
      agencyProfile: AGENCY_PROFILE,
      minScore: 0.01,
    })
    expect(mockComputeClientOverrides).not.toHaveBeenCalled()
  })

  it('resolves overrides once per run, not once per lead', async () => {
    mockComputeClientOverrides.mockResolvedValue({
      overrides: { industryFitPenalty: { fintech: 0.5 } },
      penalizedIndustries: ['fintech'],
      totalBadfits: 3,
    })

    await service.scoreExistingLeads([fintechLead(), fintechLead(), fintechLead()], {
      agencyProfile: AGENCY_PROFILE,
      minScore: 0.01,
      clientProfileId: '42',
    })

    expect(mockComputeClientOverrides).toHaveBeenCalledTimes(1)
    expect(mockComputeClientOverrides).toHaveBeenCalledWith('42')
  })

  it('lowers FIUR fit for a penalized industry (3+ badfits) vs no feedback', async () => {
    // Baseline: no client profile → no overrides.
    const baseline = await service.scoreExistingLeads([fintechLead()], {
      agencyProfile: AGENCY_PROFILE,
      minScore: 0.01,
    })

    // With feedback: 3 badfits on fintech → 50% industry penalty.
    mockComputeClientOverrides.mockResolvedValue({
      overrides: { industryFitPenalty: { fintech: 0.5 } },
      penalizedIndustries: ['fintech'],
      totalBadfits: 3,
    })
    const reweighted = await service.scoreExistingLeads([fintechLead()], {
      agencyProfile: AGENCY_PROFILE,
      minScore: 0.01,
      clientProfileId: '42',
    })

    expect(reweighted[0].scoringBreakdown.fiur.fit).toBeLessThan(
      baseline[0].scoringBreakdown.fiur.fit
    )
    expect(reweighted[0].finalScore).toBeLessThan(baseline[0].finalScore)
  })

  it('logs the reweighting in scoring reasons', async () => {
    mockComputeClientOverrides.mockResolvedValue({
      overrides: { industryFitPenalty: { fintech: 0.5 } },
      penalizedIndustries: ['fintech'],
      totalBadfits: 3,
    })

    const result = await service.scoreExistingLeads([fintechLead()], {
      agencyProfile: AGENCY_PROFILE,
      minScore: 0.01,
      clientProfileId: '42',
    })

    const fitReasons = result[0].scoringBreakdown.fiur.reasons.fit
    expect(fitReasons.some(r => r.key === 'fit.industry.match.reweighted')).toBe(true)
  })

  it('degrades gracefully when computeClientOverrides throws (no run abort)', async () => {
    mockComputeClientOverrides.mockRejectedValue(new Error('db down'))

    const result = await service.scoreExistingLeads([fintechLead()], {
      agencyProfile: AGENCY_PROFILE,
      minScore: 0.01,
      clientProfileId: '42',
    })

    // Run still produces a scored lead; just without reweighting.
    expect(result.length).toBe(1)
    expect(result[0].scoringBreakdown.fiur.fit).toBeGreaterThan(0)
  })
})
