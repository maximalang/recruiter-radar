/**
 * Tests for lead card derivation functions:
 * deriveWhyNow, deriveBestAngle, deriveLawfulContactPath, deriveNegativeSignals
 *
 * Per product concept §Схема карточки лида:
 * - why_now: 1–2 short arguments "почему сейчас"
 * - best_angle: наилучший угол контакта
 * - lawful_contact_path: corporate form / generic HR / career page
 * - negative_signals: why not / risk factors
 */

import {
  deriveWhyNow,
  deriveBestAngle,
  deriveLawfulContactPath,
  deriveNegativeSignals,
} from '@/lib/leads-data'

describe('deriveWhyNow', () => {
  it('returns default when no reasons', () => {
    expect(deriveWhyNow([])).toBe('Повод для контакта есть сейчас')
  })

  it('picks urgency/intent reasons over fit reasons', () => {
    const reasons = [
      'industry "fintech" matches ICP',
      'hiring burst detected — 5 roles in 7 days',
      'fresh hiring signals (≤ a few weeks old)',
    ]
    const result = deriveWhyNow(reasons)
    expect(result).toContain('burst')
    expect(result).toContain('fresh')
    expect(result).not.toContain('industry')
  })

  it('falls back to first 2 reasons when no urgency/intent', () => {
    const reasons = ['industry "it" matches ICP', 'SMB sweet spot', 'location matches ICP']
    const result = deriveWhyNow(reasons)
    expect(result).toBe('industry "it" matches ICP; SMB sweet spot')
  })
})

describe('deriveBestAngle', () => {
  it('returns expansion angle when new region signal', () => {
    const result = deriveBestAngle(
      ['new region expansion', 'multiple open roles'],
      'contact them',
    )
    expect(result).toContain('новый регион')
  })

  it('returns hard-to-fill angle when scarce role', () => {
    const result = deriveBestAngle(
      ['2 hard-to-fill role(s) raise urgency'],
      'contact them',
    )
    expect(result).toContain('дефицитную роль')
  })

  it('returns multi-function angle when non-tech mix', () => {
    const result = deriveBestAngle(
      ['non-tech role mix (3/5) — outsourcing-likely roles'],
      'contact them',
    )
    expect(result).toContain('Несколько открытых ролей')
  })

  it('returns career page angle when career page available', () => {
    const result = deriveBestAngle(
      ['career page available — direct hiring contact path'],
      'contact them',
    )
    expect(result).toContain('карьерная страница')
  })

  it('falls back to opener', () => {
    const result = deriveBestAngle(['industry matches ICP'], 'Short sync call about hiring')
    expect(result).toBe('Short sync call about hiring')
  })
})

describe('deriveLawfulContactPath', () => {
  it('returns career-page when career page reason', () => {
    expect(deriveLawfulContactPath(['career page available'], ['hh'])).toBe('career-page')
  })

  it('returns corporate-contact when corporate HR reason', () => {
    expect(deriveLawfulContactPath(['corporate HR/contact path available'], ['hh'])).toBe('corporate-contact')
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
      reasons: ['only internal recruiter vacancies — does not count'],
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
      reasons: ['some reason'],
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
      reasons: ['industry matches ICP', 'fresh hiring signals'],
      vacanciesCount: 3,
      distinctVacancyNamesCount: 3,
      sourceFamilies: ['hh', 'career-pages'],
      confidenceGate: 'A',
    })
    expect(result).toEqual([])
  })

  it('flags stale signals', () => {
    const result = deriveNegativeSignals({
      reasons: ['hiring signals are stale (older than ~60 days)'],
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
