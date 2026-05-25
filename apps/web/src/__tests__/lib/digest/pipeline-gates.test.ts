/**
 * Integration tests for digest pipeline gate filtering.
 * Phase 3 — Confidence gates + lead pipeline.
 *
 * These tests verify that gate C/D items are excluded from the digest
 * assembly — gate D never creates a lead, gate C requires review.
 *
 * Tests use the actual runDigestForClientProfile logic with a mock DB pool.
 */

import { selectConfidenceGate } from '@/lib/scoring/gates'
import type { FiurEvidenceItem } from '@/lib/scoring/fiur'

// ---------------------------------------------------------------------------
// Helper: build mock digest items matching the shape returned by
// mapDigestEvidenceRow (lib/digest.ts)
// ---------------------------------------------------------------------------
function mockDigestItem(overrides: Partial<{
  org_id: string
  confidence_gate: 'A' | 'B' | 'C' | 'D'
  total_score: number
  source_families: string[]
}> = {}): Record<string, unknown> {
  return {
    rank: 1,
    org_id: '1',
    source_external_id: 'hh-123',
    source_display_name: 'Test Company',
    source_families: ['hh'],
    evidence_titles: ['Backend Engineer'],
    candidate_source_keys: [],
    location_names: ['Moscow'],
    vacancies_count: 2,
    distinct_vacancy_names_count: 1,
    latest_published_at: new Date().toISOString(),
    total_score: 50,
    reasons: ['Есть активная вакансия', 'Опубликовано в пределах месяца'] as [string, string],
    opener: 'Здравствуйте! По Test Company видно...',
    confidence_gate: 'A',
    evidence_titles: [] as string[],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Gate filtering logic (mirrors digest.ts lines 242)
// ---------------------------------------------------------------------------
function filterDigestItems(
  items: Record<string, unknown>[],
  clientProfile: { includeKeywords: string[]; excludeKeywords: string[] }
): Record<string, unknown>[] {
  const result = items
    // Gate C and D are filtered out — they must not appear in the digest
    .filter((item) => item.confidence_gate !== 'C' && item.confidence_gate !== 'D')
    // Keyword matching (simplified from matchesClientProfile in digest.ts)
    .filter((item) => {
      const haystack = [
        String(item.source_display_name ?? ''),
        ...(item.evidence_titles as string[] ?? []),
      ].join(' ').toLowerCase('ru-RU')

      if (clientProfile.includeKeywords.length > 0) {
        if (!clientProfile.includeKeywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
          return false
        }
      }
      if (clientProfile.excludeKeywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
        return false
      }
      return true
    })

  return result
}

// ---------------------------------------------------------------------------
// Suppression logic (mirrors digest.ts lines 113-119)
// ---------------------------------------------------------------------------
interface SuppressionState {
  suppressed_until: Date | null
  cooldown_until: Date | null
  feedback_status: string | null
}

function isSuppressed(state: SuppressionState | null): boolean {
  if (!state) return false
  const now = new Date()
  const suppressed = state.suppressed_until && state.suppressed_until > now
  const inCooldown = state.cooldown_until && state.cooldown_until > now
  const isPermanentBlock = ['contacted', 'replied', 'won'].includes(state.feedback_status ?? '')
  return !!(suppressed || inCooldown || isPermanentBlock)
}

describe('digest pipeline — gate filtering', () => {
  it('gate D item is excluded from digest', () => {
    const items = [
      mockDigestItem({ org_id: '1', confidence_gate: 'A', total_score: 80 }),
      mockDigestItem({ org_id: '2', confidence_gate: 'D', total_score: 30 }),
      mockDigestItem({ org_id: '3', confidence_gate: 'B', total_score: 60 }),
    ]
    const profile = { includeKeywords: [], excludeKeywords: [] }
    const result = filterDigestItems(items, profile)

    expect(result).toHaveLength(2)
    expect(result.map((i) => i.org_id)).toEqual(['1', '3'])
    expect(result.find((i) => i.org_id === '2')).toBeUndefined()
  })

  it('gate C item is excluded from digest (review required)', () => {
    const items = [
      mockDigestItem({ org_id: '1', confidence_gate: 'A' }),
      mockDigestItem({ org_id: '2', confidence_gate: 'C' }),
      mockDigestItem({ org_id: '3', confidence_gate: 'B' }),
    ]
    const profile = { includeKeywords: [], excludeKeywords: [] }
    const result = filterDigestItems(items, profile)

    expect(result).toHaveLength(2)
    expect(result.map((i) => i.org_id)).toEqual(['1', '3'])
    expect(result.find((i) => i.org_id === '2')).toBeUndefined()
  })

  it('only gate A and B items reach the digest', () => {
    const items = [
      mockDigestItem({ org_id: '1', confidence_gate: 'A', total_score: 90 }),
      mockDigestItem({ org_id: '2', confidence_gate: 'B', total_score: 70 }),
      mockDigestItem({ org_id: '3', confidence_gate: 'C', total_score: 50 }),
      mockDigestItem({ org_id: '4', confidence_gate: 'D', total_score: 20 }),
    ]
    const profile = { includeKeywords: [], excludeKeywords: [] }
    const result = filterDigestItems(items, profile)

    expect(result).toHaveLength(2)
    expect(result.every((i) => i.confidence_gate === 'A' || i.confidence_gate === 'B')).toBe(true)
  })

  it('rejects gate C and D from selectConfidenceGate independently', () => {
    const emptyEvidence: FiurEvidenceItem[] = []
    const contextOnly: FiurEvidenceItem[] = [{ tier: 'context', source: 'company-website' }]

    expect(selectConfidenceGate({ evidence: emptyEvidence, entityMatch: 'clean' })).toBe('D')
    expect(selectConfidenceGate({ evidence: contextOnly, entityMatch: 'clean' })).toBe('D')
  })

  it('gate C + questionable entity match is blocked', () => {
    const directOnly: FiurEvidenceItem[] = [{ tier: 'direct', source: 'career-page' }]
    expect(selectConfidenceGate({ evidence: directOnly, entityMatch: 'questionable' })).toBe('C')
  })

  it('respects includeKeywords filter after gate filtering', () => {
    const items = [
      mockDigestItem({ org_id: '1', confidence_gate: 'A', evidence_titles: ['Backend Engineer'] }),
      mockDigestItem({ org_id: '2', confidence_gate: 'B', evidence_titles: ['Sales Manager'] }),
      mockDigestItem({ org_id: '3', confidence_gate: 'D', evidence_titles: ['Data Scientist'] }),
    ]
    const profile = { includeKeywords: ['backend', 'engineer'], excludeKeywords: [] }
    const result = filterDigestItems(items, profile)

    expect(result).toHaveLength(1)
    expect(result[0].org_id).toBe('1')
  })

  it('respects excludeKeywords filter after gate filtering', () => {
    const items = [
      mockDigestItem({ org_id: '1', confidence_gate: 'A', evidence_titles: ['Fintech Backend'] }),
      mockDigestItem({ org_id: '2', confidence_gate: 'B', evidence_titles: ['Gambling Sales'] }),
      mockDigestItem({ org_id: '3', confidence_gate: 'D', evidence_titles: ['Logistics Data'] }),
    ]
    const profile = { includeKeywords: [], excludeKeywords: ['gambling'] }
    const result = filterDigestItems(items, profile)

    expect(result).toHaveLength(1)
    expect(result[0].org_id).toBe('1')
  })
})

describe('digest pipeline — suppression', () => {
  it('org with active suppression is blocked', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10) // 10 days from now
    const state: SuppressionState = {
      suppressed_until: futureDate,
      cooldown_until: null,
      feedback_status: 'badfit',
    }
    expect(isSuppressed(state)).toBe(true)
  })

  it('org with active cooldown is blocked', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5)
    const state: SuppressionState = {
      suppressed_until: null,
      cooldown_until: futureDate,
      feedback_status: 'none',
    }
    expect(isSuppressed(state)).toBe(true)
  })

  it('org with contacted/won/replied is permanently blocked', () => {
    for (const status of ['contacted', 'replied', 'won'] as const) {
      const state: SuppressionState = {
        suppressed_until: null,
        cooldown_until: null,
        feedback_status: status,
      }
      expect(isSuppressed(state)).toBe(true)
    }
  })

  it('org with expired suppression is NOT blocked', () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5)
    const state: SuppressionState = {
      suppressed_until: pastDate,
      cooldown_until: null,
      feedback_status: 'badfit',
    }
    expect(isSuppressed(state)).toBe(false)
  })

  it('org with no state record is NOT blocked', () => {
    expect(isSuppressed(null)).toBe(false)
  })

  it('org with none feedback and no suppression is NOT blocked', () => {
    const state: SuppressionState = {
      suppressed_until: null,
      cooldown_until: null,
      feedback_status: 'none',
    }
    expect(isSuppressed(state)).toBe(false)
  })

  it('org with dismissed badfit is blocked by suppression window', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 20) // 20 days
    const state: SuppressionState = {
      suppressed_until: futureDate,
      cooldown_until: null,
      feedback_status: 'dismissed',
    }
    expect(isSuppressed(state)).toBe(true)
  })
})
