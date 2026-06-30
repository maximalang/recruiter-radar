/**
 * Tests for the shared score-display module — the single place that converts the
 * raw persisted `total_score` (~200–390) into user-facing signal strength.
 *
 * Pins the conversion contract so the three surfaces (web bar/gauge, Telegram
 * card, hiring-intent filter) can never drift back to mis-reading the raw score.
 */

import {
  toSignalStrength,
  scorePercent,
  scoreTone,
  scoreBand,
  scoreLevelLabel,
  formatSignalStrength,
  RAW_SCORE_MAX,
  SIGNAL_STRENGTH_MAX,
} from '@/lib/scoring/score-display'

describe('toSignalStrength', () => {
  it('divides the raw score by 100 onto the [0,4] scale', () => {
    expect(toSignalStrength(320)).toBeCloseTo(3.2)
    expect(toSignalStrength(200)).toBeCloseTo(2.0)
    expect(toSignalStrength(290)).toBeCloseTo(2.9)
  })

  it('clamps to [0, SIGNAL_STRENGTH_MAX]', () => {
    expect(toSignalStrength(500)).toBe(SIGNAL_STRENGTH_MAX)
    expect(toSignalStrength(-10)).toBe(0)
  })

  it('treats null / undefined / NaN as 0', () => {
    expect(toSignalStrength(null)).toBe(0)
    expect(toSignalStrength(undefined)).toBe(0)
    expect(toSignalStrength(Number.NaN)).toBe(0)
  })
})

describe('scorePercent', () => {
  it('is a percent of the raw ceiling, not the [0,4] scale', () => {
    expect(scorePercent(RAW_SCORE_MAX)).toBe(100)
    expect(scorePercent(200)).toBe(50)
    expect(scorePercent(0)).toBe(0)
  })

  it('clamps and handles missing values', () => {
    expect(scorePercent(99999)).toBe(100)
    expect(scorePercent(null)).toBe(0)
  })

  it('does NOT saturate at 100% for a typical mid lead (the old max=50 bug)', () => {
    // A platform-aggregation lead (~210) used to render at 100% under max=50.
    expect(scorePercent(210)).toBeLessThan(100)
  })
})

describe('scoreTone', () => {
  it('maps strength >=3 success, >=2 warning, else danger', () => {
    expect(scoreTone(300)).toBe('success')
    expect(scoreTone(250)).toBe('warning')
    expect(scoreTone(150)).toBe('danger')
  })
})

describe('scoreBand', () => {
  it('labels a direct-hiring lead (≥3.0) hot', () => {
    expect(scoreBand(350)).toMatchObject({ label: 'Горячий', tone: 'success' })
  })
  it('labels a platform-aggregation lead ([2,3)) warm', () => {
    expect(scoreBand(240)).toMatchObject({ label: 'Тёплый', tone: 'warning' })
  })
  it('labels a weak lead (<2) cold', () => {
    expect(scoreBand(120)).toMatchObject({ label: 'Холодный', tone: 'danger' })
  })
  it('does not print the raw integer as if it were [0,4]', () => {
    // Regression: a raw 247 must never read as "Горячий 247.0".
    expect(formatSignalStrength(247)).toBe('2.5')
    expect(scoreBand(247).label).toBe('Тёплый')
  })
})

describe('scoreLevelLabel', () => {
  it('returns the Russian level for the tone', () => {
    expect(scoreLevelLabel(300)).toBe('Высокий')
    expect(scoreLevelLabel(250)).toBe('Средний')
    expect(scoreLevelLabel(100)).toBe('Низкий')
  })
})

describe('formatSignalStrength', () => {
  it('one decimal, em dash for missing', () => {
    expect(formatSignalStrength(320)).toBe('3.2')
    expect(formatSignalStrength(null)).toBe('—')
  })
})
