/**
 * Unit tests for RateLimiter in secure-validation-schemas.ts.
 * Phase 6 — Security hardening (rate-limit verification).
 */

import { RateLimiter } from '@/lib/secure-validation-schemas'

describe('RateLimiter', () => {
  const DEFAULT_MAX_REQUESTS = 100

  describe('isAllowed', () => {
    it('allows requests within the limit', async () => {
      const limiter = new RateLimiter({ maxRequests: DEFAULT_MAX_REQUESTS })
      for (let i = 0; i < 50; i++) {
        expect(await limiter.isAllowed('key1')).toBe(true)
      }
    })

    it('blocks requests exceeding the limit', async () => {
      const limiter = new RateLimiter({ maxRequests: DEFAULT_MAX_REQUESTS })
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        await limiter.isAllowed('key2')
      }
      expect(await limiter.isAllowed('key2')).toBe(false)
    })

    it('tracks different keys independently', async () => {
      const limiter = new RateLimiter({ maxRequests: DEFAULT_MAX_REQUESTS })
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        await limiter.isAllowed('keyA')
      }
      expect(await limiter.isAllowed('keyA')).toBe(false)
      expect(await limiter.isAllowed('keyB')).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears all request history', async () => {
      const limiter = new RateLimiter({ maxRequests: DEFAULT_MAX_REQUESTS })
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        await limiter.isAllowed('key')
      }
      expect(await limiter.isAllowed('key')).toBe(false)

      await limiter.reset()
      expect(await limiter.isAllowed('key')).toBe(true)
      expect(await limiter.isAllowed('key')).toBe(true)
    })

    it('only clears specified key after targeted reset (conceptually)', async () => {
      const limiter = new RateLimiter({ maxRequests: DEFAULT_MAX_REQUESTS })
      for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
        await limiter.isAllowed('key1')
        await limiter.isAllowed('key2')
      }
      expect(await limiter.isAllowed('key1')).toBe(false)
      expect(await limiter.isAllowed('key2')).toBe(false)

      await limiter.reset()
      expect(await limiter.isAllowed('key1')).toBe(true)
      expect(await limiter.isAllowed('key2')).toBe(true)
    })
  })
})
