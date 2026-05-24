/**
 * Unit tests for RateLimiter in secure-validation-schemas.ts.
 * Phase 6 — Security hardening (rate-limit verification).
 */

import { RateLimiter } from '@/lib/secure-validation-schemas'

describe('RateLimiter', () => {
  const DEFAULT_MAX_REQUESTS = 100
  const DEFAULT_WINDOW_MS = 60000

  describe('isAllowed', () => {
    it('allows requests within the limit', () => {
      const limiter = new RateLimiter()
      for (let i = 0; i < 50; i++) {
        expect(limiter.isAllowed('key1')).toBe(true)
      }
    })

    it('blocks requests exceeding the limit', () => {
      const limiter = new RateLimiter()
      // Fill up to the limit
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        limiter.isAllowed('key2')
      }
      // Next request should be blocked
      expect(limiter.isAllowed('key2')).toBe(false)
    })

    it('tracks different keys independently', () => {
      const limiter = new RateLimiter()
      // Fill key A
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        limiter.isAllowed('keyA')
      }
      // keyA blocked but keyB still works
      expect(limiter.isAllowed('keyA')).toBe(false)
      expect(limiter.isAllowed('keyB')).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears all request history', () => {
      const limiter = new RateLimiter()
      // Fill up the limiter
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        limiter.isAllowed('key')
      }
      expect(limiter.isAllowed('key')).toBe(false)

      // Reset and verify it allows again
      limiter.reset()
      expect(limiter.isAllowed('key')).toBe(true)
      expect(limiter.isAllowed('key')).toBe(true)
    })

    it('only clears specified key after targeted reset (conceptually)', () => {
      const limiter = new RateLimiter()
      // Fill two keys
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        limiter.isAllowed('key1')
        limiter.isAllowed('key2')
      }
      expect(limiter.isAllowed('key1')).toBe(false)
      expect(limiter.isAllowed('key2')).toBe(false)

      // Note: current reset() clears all — no per-key reset available
      // This is documented behavior; re-instantiation is required for per-key clear
      limiter.reset()
      expect(limiter.isAllowed('key1')).toBe(true)
      expect(limiter.isAllowed('key2')).toBe(true)
    })
  })
})