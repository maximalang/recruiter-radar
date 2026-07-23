/**
 * Tests for scoring correctness — T2.1, T2.2, T2.3
 *
 * T2.1: qualityMetrics computed from real data (not hardcoded 1s)
 * T2.2: recentSignals boost only when signal.timestamp is recent
 * T2.3: real vacancy publishedAt and location from HiringSignal
 */

import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import type { MultiSourceLead, EvidenceSource } from '@/lib/lead-discovery/multi-source-lead-generator'
import type { HiringSignal } from '@/lib/lead-discovery/hiring-pattern-detector'

// Mock the generator so we control the input
jest.mock('@/lib/lead-discovery/multi-source-lead-generator', () => ({
  MultiSourceLeadGenerator: jest.fn().mockImplementation(() => ({
    generateLeads: jest.fn().mockResolvedValue([]),
  })),
}))

const service = new LeadScoringService()

// ============================================================
// T2.1: qualityMetrics from real data
// ============================================================
describe('T2.1: qualityMetrics computed from real data', () => {
  it('completeness < 1 when enrichment is sparse', () => {
    const lead: MultiSourceLead = {
      id: 'lead-1',
      companyId: 'co-1',
      companyName: 'SparseCorp',
      score: 2.5,
      confidence: 'B',
      sources: [{
        sourceId: 'hh',
        sourceName: 'hh.ru',
        evidenceType: 'vacancy',
        confidence: 0.7,
        extractedAt: new Date(),
        relevanceScore: 0.7,
      }],
      signals: [],
      nextAction: 'review',
      reasons: [],
      detectedAt: new Date(),
      enrichment: {
        companySize: 'medium',
        // No industry, locations, website, employeeCount, etc.
      },
    }
    const metrics = service.computeQualityMetrics(lead)
    expect(metrics.completeness).toBeLessThan(1)
  })

  it('completeness = 1 when all enrichment fields are filled', () => {
    const lead: MultiSourceLead = {
      id: 'lead-2',
      companyId: 'co-2',
      companyName: 'FullCorp',
      score: 3.0,
      confidence: 'A',
      sources: [
        { sourceId: 'career-pages', sourceName: 'Career page', evidenceType: 'career-page', confidence: 0.9, extractedAt: new Date(), relevanceScore: 0.9 },
        { sourceId: 'hh', sourceName: 'hh.ru', evidenceType: 'vacancy', confidence: 0.7, extractedAt: new Date(), relevanceScore: 0.7 },
        { sourceId: 'rabota-rossii', sourceName: 'Работа России', evidenceType: 'vacancy', confidence: 0.6, extractedAt: new Date(), relevanceScore: 0.6 },
      ],
      signals: [],
      nextAction: 'outreach',
      reasons: [],
      detectedAt: new Date(),
      enrichment: {
        companySize: 'large',
        industry: ['IT', 'Fintech'],
        locations: ['Москва', 'Санкт-Петербург'],
        hiringVelocity: 0.8,
        lastHiringActivity: new Date(),
        website: 'https://fullcorp.ru',
        employeeCount: 500,
        hasCareerPage: true,
        hasContactPath: true,
        careerPageUrl: 'https://fullcorp.ru/careers',
        contactEmail: 'hr@fullcorp.ru',
        contactPhone: '+74951234567',
      },
    }
    const metrics = service.computeQualityMetrics(lead)
    expect(metrics.completeness).toBe(1)
    expect(metrics.reliability).toBe(1) // 3 sources / 3
  })

  it('reliability < 1 with single source', () => {
    const lead: MultiSourceLead = {
      id: 'lead-3',
      companyId: 'co-3',
      companyName: 'OneSourceCorp',
      score: 2.0,
      confidence: 'C',
      sources: [{
        sourceId: 'hh',
        sourceName: 'hh.ru',
        evidenceType: 'vacancy',
        confidence: 0.7,
        extractedAt: new Date(),
        relevanceScore: 0.7,
      }],
      signals: [],
      nextAction: 'enrich-contacts',
      reasons: [],
      detectedAt: new Date(),
      enrichment: { companySize: 'small' },
    }
    const metrics = service.computeQualityMetrics(lead)
    expect(metrics.reliability).toBeLessThan(1)
  })
})

// ============================================================
// T2.2: recentSignals boost only with real timestamps
// ============================================================
describe('T2.2: recentSignals boost uses signal.timestamp', () => {
  it('signal with old timestamp → no boost counted as recent', () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    const signals: HiringSignal[] = [
      { companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.8, evidence: [], detectedAt: new Date(), timestamp: oldDate },
      { companyId: 'c1', companyName: 'X', signalType: 'fresh', strength: 0.7, evidence: [], detectedAt: new Date(), timestamp: oldDate },
      { companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.6, evidence: [], detectedAt: new Date(), timestamp: oldDate },
    ]
    const recent = service.countRecentSignals(signals)
    expect(recent).toBe(0)
  })

  it('signal with recent timestamp (< 7 days) → counted as recent', () => {
    const freshDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
    const signals: HiringSignal[] = [
      { companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.8, evidence: [], detectedAt: new Date(), timestamp: freshDate },
      { companyId: 'c1', companyName: 'X', signalType: 'fresh', strength: 0.7, evidence: [], detectedAt: new Date(), timestamp: freshDate },
      { companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.6, evidence: [], detectedAt: new Date(), timestamp: freshDate },
    ]
    const recent = service.countRecentSignals(signals)
    expect(recent).toBe(3)
  })

  it('signal without timestamp → not counted as recent (safe fallback)', () => {
    const signals: HiringSignal[] = [
      { companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.8, evidence: [], detectedAt: new Date() },
      { companyId: 'c1', companyName: 'X', signalType: 'fresh', strength: 0.7, evidence: [], detectedAt: new Date() },
      { companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.6, evidence: [], detectedAt: new Date() },
    ]
    const recent = service.countRecentSignals(signals)
    expect(recent).toBe(0)
  })
})

// ============================================================
// T2.3: Real vacancy data from HiringSignal
// ============================================================
describe('T2.3: vacancy publishedAt and location from HiringSignal', () => {
  it('uses signal.publishedAt for vacancy date', () => {
    const signals: HiringSignal[] = [
      {
        companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.8,
        evidence: [], detectedAt: new Date(),
        publishedAt: '2026-05-20T10:00:00Z', location: 'Москва',
      },
    ]
    const vacancies = service.convertSignalsToVacancies(signals)
    expect(vacancies[0].publishedAt).toBe('2026-05-20T10:00:00Z')
    expect(vacancies[0].location).toBe('Москва')
  })

  it('falls back to detectedAt when publishedAt absent', () => {
    const detectedAt = new Date('2026-05-15T12:00:00Z')
    const signals: HiringSignal[] = [
      {
        companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.8,
        evidence: [], detectedAt,
      },
    ]
    const vacancies = service.convertSignalsToVacancies(signals)
    expect(vacancies[0].publishedAt).toBe(detectedAt.toISOString())
  })

  it('falls back to empty location when location absent', () => {
    const signals: HiringSignal[] = [
      {
        companyId: 'c1', companyName: 'X', signalType: 'burst', strength: 0.8,
        evidence: [], detectedAt: new Date(),
        publishedAt: '2026-05-20T10:00:00Z',
      },
    ]
    const vacancies = service.convertSignalsToVacancies(signals)
    expect(vacancies[0].location).toBe('')
  })
})
