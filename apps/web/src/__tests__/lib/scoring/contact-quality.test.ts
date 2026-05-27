import {
  computeContactQuality,
} from '@/lib/scoring/contact-quality'
import type { ContactPath } from '@/lib/scoring/contact-paths'

const hr: ContactPath = { category: 'hr-email', value: 'hr@acme.ru', confidence: 'high' }
const careers: ContactPath = {
  category: 'careers-email',
  value: 'careers@acme.ru',
  confidence: 'high',
}
const generic: ContactPath = {
  category: 'generic-email',
  value: 'info@acme.ru',
  confidence: 'medium',
}
const personal: ContactPath = {
  category: 'personal-email',
  value: 'ivan.petrov@acme.ru',
  confidence: 'low',
}
const phone: ContactPath = { category: 'phone', value: '+74951234567', confidence: 'medium' }
const form: ContactPath = {
  category: 'contact-form',
  value: 'https://acme.ru/contact',
  confidence: 'medium',
}
const tg: ContactPath = { category: 'telegram', value: 'https://t.me/acme_hr', confidence: 'medium' }

describe('computeContactQuality', () => {
  describe('contract', () => {
    it('returns score 0 / tier "none" with no paths', () => {
      const result = computeContactQuality([])
      expect(result.score).toBe(0)
      expect(result.tier).toBe('none')
      expect(result.diversity).toBe(0)
      expect(result.hasHrChannel).toBe(false)
    })

    it('returns score in [0, 1]', () => {
      const result = computeContactQuality([hr, careers, phone, form, tg])
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
    })
  })

  describe('HR channel reward', () => {
    it('hr-email path materially boosts score over a generic email only', () => {
      const withHr = computeContactQuality([hr])
      const withoutHr = computeContactQuality([generic])
      expect(withHr.score).toBeGreaterThan(withoutHr.score)
      expect(withHr.hasHrChannel).toBe(true)
      expect(withoutHr.hasHrChannel).toBe(false)
    })

    it('careers-email is treated as an HR channel', () => {
      const result = computeContactQuality([careers])
      expect(result.hasHrChannel).toBe(true)
    })
  })

  describe('diversity reward', () => {
    it('rewards multiple distinct channel categories over a single category', () => {
      const many = computeContactQuality([hr, phone, form])
      const one = computeContactQuality([hr])
      expect(many.score).toBeGreaterThan(one.score)
      expect(many.diversity).toBe(3)
    })

    it('does not double-count duplicates of the same category', () => {
      const result = computeContactQuality([hr, hr, hr])
      expect(result.diversity).toBe(1)
    })
  })

  describe('personal-email penalty', () => {
    it('personal-only contacts score worse than HR-only', () => {
      const personalOnly = computeContactQuality([personal])
      const hrOnly = computeContactQuality([hr])
      expect(personalOnly.score).toBeLessThan(hrOnly.score)
    })

    it('a personal email surfaces a privacy-risk reason', () => {
      const result = computeContactQuality([personal])
      expect(result.reasons.some((r) => /personal|privacy|risk/i.test(r))).toBe(true)
    })
  })

  describe('tier classification', () => {
    it('rich, multi-channel companies with an HR channel reach tier "rich"', () => {
      const result = computeContactQuality([hr, careers, phone, form, tg])
      expect(result.tier).toBe('rich')
    })

    it('a single generic email maps to tier "weak"', () => {
      const result = computeContactQuality([generic])
      expect(result.tier).toBe('weak')
    })

    it('a single HR mailbox without other channels maps to tier "ok"', () => {
      const result = computeContactQuality([hr])
      expect(result.tier).toBe('ok')
    })
  })

  describe('reasons', () => {
    it('mentions HR channel availability when present', () => {
      const result = computeContactQuality([hr, phone])
      expect(result.reasons.some((r) => /hr|career/i.test(r))).toBe(true)
    })

    it('mentions diversity in reasons when 2+ categories present', () => {
      const result = computeContactQuality([hr, phone, form])
      expect(result.reasons.some((r) => /channel|chann|diverse|paths/i.test(r))).toBe(true)
    })
  })
})
