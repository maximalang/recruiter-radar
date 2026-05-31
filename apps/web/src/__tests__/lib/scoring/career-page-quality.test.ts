import {
  computeCareerPageQuality,
} from '@/lib/scoring/career-page-quality'
import type { ContactPath } from '@/lib/scoring/contact-paths'

const hrEmail: ContactPath = {
  category: 'hr-email',
  value: 'hr@acme.ru',
  confidence: 'high',
}
const genericEmail: ContactPath = {
  category: 'generic-email',
  value: 'info@acme.ru',
  confidence: 'medium',
}
const phone: ContactPath = {
  category: 'phone',
  value: '+74951234567',
  confidence: 'medium',
}

const fetchedAt = new Date('2026-05-26T00:00:00Z')

describe('computeCareerPageQuality', () => {
  it('returns a 0..1 score with explainable signals and reasons', () => {
    const result = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 5,
      contactPaths: [hrEmail, genericEmail, phone],
      lastModifiedAt: new Date('2026-05-20T00:00:00Z'),
      fetchedAt,
    })

    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.signals.hasPage).toBe(true)
    expect(result.signals.vacancyCount).toBe(5)
    expect(result.signals.hasHrContact).toBe(true)
    expect(result.signals.contactPathCount).toBe(3)
    expect(result.signals.freshnessDays).toBe(6)
    expect(result.signals.isFresh).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('returns score 0 with no signals when input is empty', () => {
    const result = computeCareerPageQuality({})
    expect(result.score).toBe(0)
    expect(result.signals.hasPage).toBe(false)
    expect(result.signals.hasVacancies).toBe(false)
    expect(result.signals.hasHrContact).toBe(false)
    expect(result.signals.contactPathCount).toBe(0)
    expect(result.signals.freshnessDays).toBeNull()
    expect(result.signals.isFresh).toBe(false)
  })

  it('full-quality page (vacancies, HR contact, multiple paths, fresh) approaches 1', () => {
    const result = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 8,
      contactPaths: [hrEmail, genericEmail, phone],
      lastModifiedAt: new Date('2026-05-25T00:00:00Z'),
      fetchedAt,
    })
    expect(result.score).toBeGreaterThanOrEqual(0.95)
  })

  it('penalises stale pages (last-modified > 180 days ago)', () => {
    const fresh = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 3,
      contactPaths: [hrEmail],
      lastModifiedAt: new Date('2026-05-20T00:00:00Z'),
      fetchedAt,
    })
    const stale = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 3,
      contactPaths: [hrEmail],
      lastModifiedAt: new Date('2025-09-01T00:00:00Z'),
      fetchedAt,
    })
    expect(stale.score).toBeLessThan(fresh.score)
    expect(stale.signals.isFresh).toBe(false)
    expect(stale.reasons.some((r) => /stale|fresh|days/i.test(r))).toBe(true)
  })

  it('rewards an HR or careers contact path even when there are no vacancies', () => {
    const withHr = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      contactPaths: [hrEmail],
      fetchedAt,
    })
    const withoutHr = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      contactPaths: [genericEmail],
      fetchedAt,
    })
    expect(withHr.score).toBeGreaterThan(withoutHr.score)
    expect(withHr.signals.hasHrContact).toBe(true)
    expect(withoutHr.signals.hasHrContact).toBe(false)
  })

  it('rewards multiple contact paths over a single one', () => {
    const many = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 2,
      contactPaths: [hrEmail, genericEmail, phone],
      fetchedAt,
    })
    const one = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 2,
      contactPaths: [hrEmail],
      fetchedAt,
    })
    expect(many.score).toBeGreaterThan(one.score)
  })

  it('counts careers-email as HR contact alongside hr-email', () => {
    const result = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      contactPaths: [
        { category: 'careers-email', value: 'careers@acme.ru', confidence: 'high' },
      ],
      fetchedAt,
    })
    expect(result.signals.hasHrContact).toBe(true)
  })

  it('treats missing lastModifiedAt as unknown (not stale, not fresh)', () => {
    const result = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 3,
      contactPaths: [hrEmail],
      fetchedAt,
    })
    expect(result.signals.freshnessDays).toBeNull()
    expect(result.signals.isFresh).toBe(false)
  })

  it('clamps score to [0, 1]', () => {
    const result = computeCareerPageQuality({
      url: 'https://acme.ru/careers',
      vacancyCount: 999,
      contactPaths: [hrEmail, genericEmail, phone, hrEmail, genericEmail],
      lastModifiedAt: fetchedAt,
      fetchedAt,
    })
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })
})
