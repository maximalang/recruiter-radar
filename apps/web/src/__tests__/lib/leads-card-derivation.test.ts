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

import type { ScoringReason } from '@/lib/scoring/scoring-reasons'
import {
  deriveWhyNow,
  deriveBestAngle,
  deriveLawfulContactPath,
  deriveNegativeSignals,
} from '@/lib/leads-data'

/** Helper: create a ScoringReason with minimal boilerplate */
function r(component: ScoringReason['component'], key: string, params?: Record<string, string | number>): ScoringReason {
  return { component, key, params }
}

describe('deriveWhyNow', () => {
  it('returns default when no reasons', () => {
    expect(deriveWhyNow([])).toBe('Повод для контакта есть сейчас')
  })

  it('picks urgency/intent reasons over fit reasons', () => {
    const reasons: ScoringReason[] = [
      r('fit', 'fit.industry.match', { industry: 'fintech' }),
      r('urgency', 'urgency.burst', { details: '5 ролей за 7 дней' }),
      r('intent', 'intent.fresh-signals'),
    ]
    const result = deriveWhyNow(reasons)
    expect(result).toContain('Hiring burst')
    expect(result).toContain('Свежие сигналы найма')
    expect(result).not.toContain('fintech')
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
})

describe('deriveBestAngle', () => {
  it('returns expansion angle when new region signal', () => {
    const result = deriveBestAngle(
      [r('fit', 'fit.location.outside', { location: 'Казань' })],
      'contact them',
    )
    expect(result).toContain('новый регион')
  })

  it('returns hard-to-fill angle when scarce role', () => {
    const result = deriveBestAngle(
      [r('urgency', 'urgency.hard-to-fill', { count: 2 })],
      'contact them',
    )
    expect(result).toContain('дефицитную роль')
  })

  it('returns multi-function angle when non-tech mix', () => {
    const result = deriveBestAngle(
      [r('intent', 'intent.non-tech-mix', { nonTech: 3, total: 5 })],
      'contact them',
    )
    expect(result).toContain('Несколько открытых ролей')
  })

  it('returns career page angle when career page available', () => {
    const result = deriveBestAngle(
      [r('reachability', 'reachability.career-page')],
      'contact them',
    )
    expect(result).toContain('карьерная страница')
  })

  it('falls back to opener', () => {
    const result = deriveBestAngle([r('fit', 'fit.industry.match', { industry: 'it' })], 'Short sync call about hiring')
    expect(result).toBe('Short sync call about hiring')
  })

  it('falls back to career-pages source family when no reason key matches', () => {
    const result = deriveBestAngle([r('fit', 'fit.industry.match', { industry: 'it' })], '', ['career-pages'])
    expect(result).toBe('Карьерная страница — прямой путь к HR')
  })

  it('falls back to egrul-fns source family when no reason key matches', () => {
    const result = deriveBestAngle([], '', ['egrul-fns'])
    expect(result).toBe('Данные реестра — можно найти контакт через официальный сайт')
  })

  it('falls back to fedresurs source family when no reason key matches', () => {
    const result = deriveBestAngle([], '', ['fedresurs'])
    expect(result).toBe('Данные реестра — можно найти контакт через официальный сайт')
  })

  it('falls back to multi-source when 2+ families present', () => {
    const result = deriveBestAngle([], '', ['hh', 'superjob'])
    expect(result).toBe('Несколько независимых источников подтверждают найм')
  })

  it('falls back to hh-only source family', () => {
    const result = deriveBestAngle([], '', ['hh'])
    expect(result).toBe('Активные вакансии на HeadHunter — можно заходить с релевантной ролью')
  })

  it('source-family fallback is skipped when reasons already matched', () => {
    const result = deriveBestAngle(
      [r('urgency', 'urgency.hard-to-fill')],
      '',
      ['career-pages', 'hh'],
    )
    expect(result).toBe('Закрыть дефицитную роль, пока внутренний поиск не растянулся')
  })

  it('opener takes precedence over source-family fallback', () => {
    const result = deriveBestAngle([r('fit', 'fit.industry.match', { industry: 'it' })], 'Use our custom opener', ['career-pages'])
    expect(result).toBe('Use our custom opener')
  })

  it('default fallback when no reasons, no opener, no source families', () => {
    expect(deriveBestAngle([], '')).toBe('Короткий созвон, чтобы сверить задачи по найму')
  })

  it('works with legacy string[] reasons and source families', () => {
    // career-pages takes priority over multi-source heuristic
    const result = deriveBestAngle(['Вакансия в IT'], '', ['hh', 'career-pages'])
    expect(result).toBe('Карьерная страница — прямой путь к HR')
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
