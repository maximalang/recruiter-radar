/**
 * Tests for the public-preview ICP relevance scorer & ranker.
 *
 * Product contract (see preview-relevance.ts doc-comment):
 * - exclude terms hard-drop an item entirely;
 * - when include terms are given, exact ICP matches surface first;
 * - a niche query NEVER returns an empty preview — fall back to the closest
 *   companies, and report `hasExactMatches: false` so the UI shows honest copy;
 * - axes are clamped to [0, 1]; total ∈ [0, 4].
 *
 * `now` is injected for determinism (Date.now() is otherwise non-deterministic).
 */

import { scorePreviewRelevance, rankPreviewItems } from '@/lib/preview-relevance'
import type { HhDigestItem } from '@/lib/hhDigest'
import type { PublicPreviewInput } from '@/lib/publicProduct'

const NOW = Date.parse('2026-06-14T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString()
}

function makeItem(overrides: Partial<HhDigestItem> = {}): HhDigestItem {
  return {
    rank: 1,
    org_id: 'org-1',
    hh_employer_id: 'hh-1',
    employer_name: 'Acme Tech',
    vacancies_count: 1,
    distinct_vacancy_names_count: 1,
    latest_published_at: daysAgo(3),
    total_score: 2,
    reasons: ['свежие вакансии', 'прямой источник'],
    opener: 'Здравствуйте',
    source_families: ['career-page'],
    evidence_titles: ['Backend-разработчик'],
    candidate_source_keys: ['key-1'],
    location_names: ['Москва'],
    confidence_gate: 'B',
    ...overrides,
  }
}

function emptyInput(overrides: Partial<PublicPreviewInput> = {}): PublicPreviewInput {
  return {
    specialization: '',
    targetCity: '',
    includeKeywords: '',
    excludeKeywords: '',
    dailyDigestLimit: 10,
    ...overrides,
  }
}

describe('scorePreviewRelevance', () => {
  it('keeps every axis within [0, 1] and total within [0, 4]', () => {
    const item = makeItem({
      vacancies_count: 12,
      distinct_vacancy_names_count: 1,
      latest_published_at: daysAgo(0),
      source_families: ['career-page', 'corporate-site', 'registry'],
      evidence_titles: ['a', 'b', 'c'],
    })
    const r = scorePreviewRelevance(item, emptyInput({ specialization: 'backend' }), NOW)

    for (const axis of ['fit', 'intent', 'urgency', 'reachability'] as const) {
      expect(r.signals[axis]).toBeGreaterThanOrEqual(0)
      expect(r.signals[axis]).toBeLessThanOrEqual(1)
    }
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(r.total).toBeLessThanOrEqual(4)
  })

  it('drops an item when an exclude term matches', () => {
    const item = makeItem({ employer_name: 'Госзакупки ФГУП' })
    const r = scorePreviewRelevance(item, emptyInput({ excludeKeywords: 'фгуп' }), NOW)

    expect(r.isExcluded).toBe(true)
    expect(r.signals.fit).toBe(0)
  })

  it('flags an exact match when an include term hits, and full Fit when all dimensions hit', () => {
    const item = makeItem({
      evidence_titles: ['Senior backend-разработчик'],
      location_names: ['Москва'],
    })
    const r = scorePreviewRelevance(
      item,
      emptyInput({ specialization: 'backend', targetCity: 'москва', includeKeywords: 'разработчик' }),
      NOW
    )

    expect(r.isExactMatch).toBe(true)
    expect(r.signals.fit).toBe(1)
  })

  it('treats an item as an exact match when no include terms are provided', () => {
    const r = scorePreviewRelevance(makeItem(), emptyInput(), NOW)
    expect(r.isExactMatch).toBe(true)
  })

  it('rewards fresh, high-volume hiring with higher intent than stale, single openings', () => {
    const fresh = makeItem({
      vacancies_count: 5,
      distinct_vacancy_names_count: 3,
      latest_published_at: daysAgo(2),
    })
    const stale = makeItem({
      vacancies_count: 1,
      distinct_vacancy_names_count: 1,
      latest_published_at: daysAgo(120),
    })

    const freshR = scorePreviewRelevance(fresh, emptyInput(), NOW)
    const staleR = scorePreviewRelevance(stale, emptyInput(), NOW)

    expect(freshR.signals.intent).toBeGreaterThan(staleR.signals.intent)
  })

  it('treats an unparseable publish date as infinitely stale (no freshness bonus)', () => {
    const item = makeItem({
      latest_published_at: 'not-a-date',
      vacancies_count: 1,
      distinct_vacancy_names_count: 1,
    })
    const r = scorePreviewRelevance(item, emptyInput(), NOW)
    // vacancies_count >= 1 → 0.2; no freshness bonus → intent stays at 0.2.
    expect(r.signals.intent).toBeCloseTo(0.2, 5)
  })

  it('gives a stronger reachability signal when a career/corporate surface exists', () => {
    const reachable = makeItem({
      source_families: ['career-page', 'corporate-site'],
      evidence_titles: ['a', 'b'],
    })
    const weak = makeItem({ source_families: ['platform-aggregator'], evidence_titles: [] })

    const reachableR = scorePreviewRelevance(reachable, emptyInput(), NOW)
    const weakR = scorePreviewRelevance(weak, emptyInput(), NOW)

    expect(reachableR.signals.reachability).toBeGreaterThan(weakR.signals.reachability)
  })
})

describe('rankPreviewItems', () => {
  it('drops excluded items entirely', () => {
    const items = [
      makeItem({ org_id: 'keep', employer_name: 'Acme Tech' }),
      makeItem({ org_id: 'drop', employer_name: 'Госзакупки ФГУП' }),
    ]
    const { ranked } = rankPreviewItems(items, emptyInput({ excludeKeywords: 'фгуп' }), {
      limit: 10,
      now: NOW,
    })

    expect(ranked.map((e) => e.item.org_id)).toEqual(['keep'])
  })

  it('surfaces exact matches first and reports hasExactMatches=true', () => {
    const items = [
      makeItem({ org_id: 'other', employer_name: 'Retail Co', evidence_titles: ['Продавец'] }),
      makeItem({ org_id: 'match', employer_name: 'Dev Co', evidence_titles: ['Backend-разработчик'] }),
    ]
    const { ranked, hasExactMatches } = rankPreviewItems(
      items,
      emptyInput({ specialization: 'backend' }),
      { limit: 10, now: NOW }
    )

    expect(hasExactMatches).toBe(true)
    expect(ranked.every((e) => e.relevance.isExactMatch)).toBe(true)
    expect(ranked.map((e) => e.item.org_id)).toEqual(['match'])
  })

  it('falls back to closest companies (never empty) and reports hasExactMatches=false', () => {
    const items = [
      makeItem({ org_id: 'a', employer_name: 'Retail Co', evidence_titles: ['Продавец'] }),
      makeItem({ org_id: 'b', employer_name: 'Logistics Co', evidence_titles: ['Водитель'] }),
    ]
    const { ranked, hasExactMatches } = rankPreviewItems(
      items,
      emptyInput({ specialization: 'нейрохирург' }),
      { limit: 10, now: NOW }
    )

    expect(hasExactMatches).toBe(false)
    expect(ranked.length).toBe(2) // populated, not empty
  })

  it('sorts by total relevance descending', () => {
    const strong = makeItem({
      org_id: 'strong',
      vacancies_count: 6,
      distinct_vacancy_names_count: 3,
      latest_published_at: daysAgo(1),
      source_families: ['career-page', 'corporate-site'],
      evidence_titles: ['a', 'b'],
    })
    const weak = makeItem({
      org_id: 'weak',
      vacancies_count: 1,
      distinct_vacancy_names_count: 1,
      latest_published_at: daysAgo(200),
      source_families: ['platform-aggregator'],
      evidence_titles: [],
    })
    const { ranked } = rankPreviewItems([weak, strong], emptyInput(), { limit: 10, now: NOW })

    expect(ranked.map((e) => e.item.org_id)).toEqual(['strong', 'weak'])
  })

  it('respects the limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem({ org_id: `org-${i}` }))
    const { ranked } = rankPreviewItems(items, emptyInput(), { limit: 2, now: NOW })
    expect(ranked.length).toBe(2)
  })
})
