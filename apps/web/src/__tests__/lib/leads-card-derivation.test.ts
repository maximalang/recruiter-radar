/**
 * Tests for lead card derivation functions:
 * deriveWhyNow, deriveLawfulContactPath, deriveNegativeSignals
 *
 * Per product concept §Схема карточки лида:
 * - why_now: 1–2 short arguments "почему сейчас"
 * - lawful_contact_path: corporate form / generic HR / career page
 * - negative_signals: why not / risk factors
 */

import type { ScoringReason } from '@/lib/scoring/scoring-reasons'
import {
  deriveWhyNow,
  deriveLawfulContactPath,
  deriveNegativeSignals,
} from '@/lib/leads-data'

/** Helper: create a ScoringReason with minimal boilerplate */
function r(component: ScoringReason['component'], key: string, params?: Record<string, string | number>): ScoringReason {
  return { component, key, params }
}

describe('deriveWhyNow', () => {
  it('returns empty string when no reasons — caller hides the line', () => {
    expect(deriveWhyNow([])).toBe('')
  })

  it('picks urgency/intent reasons over fit reasons', () => {
    const reasons: ScoringReason[] = [
      r('fit', 'fit.industry.match', { industry: 'fintech' }),
      r('urgency', 'urgency.burst', { details: '5 ролей за 7 дней' }),
      r('intent', 'intent.fresh-signals'),
    ]
    const result = deriveWhyNow(reasons)
    // Burst (priority 80) outranks fresh-signals (65); both lead, fit excluded
    expect(result).toContain('Hiring burst')
    expect(result).toContain('Свежие сигналы найма')
    expect(result).not.toContain('fintech')
  })

  it('orders by evidential strength: corroborated direct evidence leads', () => {
    const reasons: ScoringReason[] = [
      r('intent', 'intent.fresh-signals'),
      r('intent', 'intent.direct-evidence.corroborated'),
    ]
    const result = deriveWhyNow(reasons)
    expect(result.indexOf('Прямое подтверждение из независимого источника'))
      .toBeLessThan(result.indexOf('Свежие сигналы найма'))
  })

  it('falls back to first 2 reasons when no urgency/intent', () => {
    const reasons: ScoringReason[] = [
      r('fit', 'fit.industry.match', { industry: 'it' }),
      r('fit', 'fit.size.smb-sweet-spot', { detail: '100 сотрудников' }),
      r('fit', 'fit.location.match'),
    ]
    const result = deriveWhyNow(reasons)
    expect(result).toBe('Индустрия «it» совпадает с ICP; SMB sweet spot (100 сотрудников, 50–500 сотрудников) — оптимальный бюджет для агентства')
  })

  it('renders legacy free-form Russian reasons verbatim, never the [legacy.…] stub', () => {
    // Prod digest rows store reasons as plain Russian strings, not structured
    // ScoringReason objects. deriveWhyNow must surface the human text, not the
    // debug-style bracketed key that used to leak into the lead card.
    const rawReasons = [
      '86 вакансий, включая «Аккредитация специалистов»',
      'Опубликовано 12.07',
    ]
    const result = deriveWhyNow(rawReasons)
    expect(result).toContain('86 вакансий, включая «Аккредитация специалистов»')
    expect(result).not.toMatch(/\[legacy/)
    expect(result).not.toMatch(/^\[/)
  })
})

describe('deriveLawfulContactPath', () => {
  it('returns career-page when career page reason', () => {
    expect(deriveLawfulContactPath([r('reachability', 'reachability.career-page')], ['hh'])).toBe('career-page')
  })

  it('returns corporate-contact when corporate HR reason', () => {
    expect(deriveLawfulContactPath([r('reachability', 'reachability.corporate-contact')], ['hh'])).toBe('corporate-contact')
  })

  it('returns registry-data when egrul-fns source present', () => {
    expect(deriveLawfulContactPath([], ['egrul-fns'])).toBe('registry-data')
  })

  it('returns null when no lawful path found', () => {
    expect(deriveLawfulContactPath([], ['hh'])).toBeNull()
  })
})

describe('deriveNegativeSignals', () => {
  it('flags internal recruiter only signal', () => {
    const result = deriveNegativeSignals({
      reasons: [r('intent', 'intent.internal-recruiter-only')],
      vacanciesCount: 1,
      distinctVacancyNamesCount: 1,
      sourceFamilies: ['hh'],
      confidenceGate: 'B',
    })
    expect(result).toEqual(
      expect.arrayContaining([expect.stringContaining('внутреннего рекрутера')]),
    )
  })

  it('flags low confidence gate C', () => {
    const result = deriveNegativeSignals({
      reasons: [r('fit', 'fit.industry.match', { industry: 'it' })],
      vacanciesCount: 2,
      distinctVacancyNamesCount: 2,
      sourceFamilies: ['hh'],
      confidenceGate: 'C',
    })
    expect(result).toEqual(
      expect.arrayContaining([expect.stringContaining('Низкая уверенность')]),
    )
  })

  it('flags single source', () => {
    const result = deriveNegativeSignals({
      reasons: [],
      vacanciesCount: 1,
      distinctVacancyNamesCount: 1,
      sourceFamilies: ['hh'],
      confidenceGate: 'B',
    })
    expect(result).toEqual(
      expect.arrayContaining([expect.stringContaining('один источник')]),
    )
  })

  it('does NOT flag single source when a direct corporate surface is present', () => {
    // A single career-pages source is a direct hiring surface — calling it
    // "только один источник, нет подтверждения" would be misleading noise.
    const result = deriveNegativeSignals({
      reasons: [r('reachability', 'reachability.career-page')],
      vacanciesCount: 2,
      distinctVacancyNamesCount: 2,
      sourceFamilies: ['career-pages'],
      confidenceGate: 'A',
    })
    expect(result).toEqual([])
  })

  it('flags repost pattern: high vacancies count but low distinct', () => {
    const result = deriveNegativeSignals({
      reasons: [],
      vacanciesCount: 5,
      distinctVacancyNamesCount: 1,
      sourceFamilies: ['hh', 'superjob'],
      confidenceGate: 'A',
    })
    expect(result).toEqual(
      expect.arrayContaining([expect.stringContaining('Повторяющиеся')]),
    )
  })

  it('returns empty for clean lead', () => {
    const result = deriveNegativeSignals({
      reasons: [
        r('fit', 'fit.industry.match', { industry: 'it' }),
        r('intent', 'intent.fresh-signals'),
      ],
      vacanciesCount: 3,
      distinctVacancyNamesCount: 3,
      sourceFamilies: ['hh', 'career-pages'],
      confidenceGate: 'A',
    })
    expect(result).toEqual([])
  })

  it('flags stale signals', () => {
    const result = deriveNegativeSignals({
      reasons: [r('intent', 'intent.stale-signals')],
      vacanciesCount: 2,
      distinctVacancyNamesCount: 2,
      sourceFamilies: ['hh', 'career-pages'],
      confidenceGate: 'B',
    })
    expect(result).toEqual(
      expect.arrayContaining([expect.stringContaining('Устаревшие')]),
    )
  })
})
