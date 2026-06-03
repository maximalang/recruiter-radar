import { chooseEngine, createCrawlerRouter } from '@/lib/sources/crawlers/crawler-router'
import type { CrawlerEngine, CrawlerEngineId, CrawlerResult, CrawlerFetchInput } from '@/lib/sources/crawlers/crawler-contract'

function fakeEngine(id: CrawlerEngineId): CrawlerEngine {
  return {
    id,
    capabilities: {
      rendersJs: id === 'spa',
      bypassesCloudflare: false,
      returnsMarkdown: id === 'llm-markdown',
      supportsPdf: id === 'llm-markdown',
      selfHosted: true,
    },
    async fetch({ url }): Promise<CrawlerResult> {
      return {
        url,
        status: 200,
        html: `<from-${id}>`,
        rawHeaders: {},
        fetchedAt: '2026-05-26T12:00:00.000Z',
        engine: id,
        warnings: [],
      }
    },
  }
}

describe('chooseEngine', () => {
  describe('static is the safe default', () => {
    it('returns static for plain career-page hosts', () => {
      expect(chooseEngine('https://acme.ru/careers')).toBe('static')
      expect(chooseEngine('https://yandex.ru/jobs')).toBe('static')
    })

    it('returns static for unknown / new hosts', () => {
      expect(chooseEngine('https://unknown-host.example/careers')).toBe('static')
    })
  })

  describe('SPA allow-list', () => {
    it('returns spa for greenhouse, lever, ashby, workday, smartrecruiters, jobvite, workable', () => {
      expect(chooseEngine('https://boards.greenhouse.io/acme')).toBe('spa')
      expect(chooseEngine('https://jobs.lever.co/acme')).toBe('spa')
      expect(chooseEngine('https://jobs.ashbyhq.com/acme')).toBe('spa')
      expect(chooseEngine('https://acme.wd1.myworkdayjobs.com/External')).toBe('spa')
      expect(chooseEngine('https://jobs.smartrecruiters.com/Acme')).toBe('spa')
      expect(chooseEngine('https://jobs.jobvite.com/acme')).toBe('spa')
      expect(chooseEngine('https://apply.workable.com/acme')).toBe('spa')
    })

    it('matches subdomains of SPA hosts', () => {
      expect(chooseEngine('https://acme.greenhouse.io/jobs')).toBe('spa')
    })
  })

  describe('hint takes precedence over host detection', () => {
    it('returns the hinted engine even for static hosts', () => {
      expect(chooseEngine('https://acme.ru/careers', 'spa')).toBe('spa')
      expect(chooseEngine('https://acme.ru/news', 'newsroom')).toBe('llm-markdown')
      expect(chooseEngine('https://acme.ru/whitepaper.pdf', 'pdf')).toBe('llm-markdown')
    })

    it('static hint downgrades a SPA host', () => {
      expect(chooseEngine('https://boards.greenhouse.io/acme', 'static')).toBe('static')
    })
  })

  describe('input safety', () => {
    it('returns static for malformed URLs without throwing', () => {
      expect(chooseEngine('not a url')).toBe('static')
      expect(chooseEngine('')).toBe('static')
    })
  })
})

describe('createCrawlerRouter', () => {
  it('dispatches to the engine selected by chooseEngine', async () => {
    const router = createCrawlerRouter({
      static: fakeEngine('static'),
      spa: fakeEngine('spa'),
      'llm-markdown': fakeEngine('llm-markdown'),
    })
    const r1 = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(r1.engine).toBe('static')

    const r2 = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(r2.engine).toBe('spa')
  })

  it('honours an explicit hint', async () => {
    const router = createCrawlerRouter({
      static: fakeEngine('static'),
      spa: fakeEngine('spa'),
      'llm-markdown': fakeEngine('llm-markdown'),
    })
    const r = await router.fetch({
      url: 'https://acme.ru/news',
      options: { hint: 'newsroom' },
    })
    expect(r.engine).toBe('llm-markdown')
  })

  it('falls back to static when the requested engine is not registered', async () => {
    const router = createCrawlerRouter({ static: fakeEngine('static') })
    const r = await router.fetch({ url: 'https://boards.greenhouse.io/acme' })
    expect(r.engine).toBe('static')
    expect(r.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/spa.*not registered/i)]),
    )
  })

  it('throws when no engine can serve the request (no static fallback)', async () => {
    const router = createCrawlerRouter({ spa: fakeEngine('spa') })
    await expect(
      router.fetch({ url: 'https://acme.ru/careers' }),
    ).rejects.toThrow(/no.*engine/i)
  })
})

/* ------------------------------------------------------------------ */
/*  Circuit breaker + rate limiter                                     */
/* ------------------------------------------------------------------ */

function failingEngine(id: CrawlerEngineId, failCount: number): CrawlerEngine {
  let calls = 0
  return {
    id,
    capabilities: {
      rendersJs: id === 'spa',
      bypassesCloudflare: false,
      returnsMarkdown: id === 'llm-markdown',
      supportsPdf: id === 'llm-markdown',
      selfHosted: true,
    },
    async fetch({ url }: CrawlerFetchInput): Promise<CrawlerResult> {
      calls++
      if (calls <= failCount) {
        throw new Error(`engine ${id} simulated failure #${calls}`)
      }
      return {
        url,
        status: 200,
        html: `<from-${id}-after-recovery>`,
        rawHeaders: {},
        fetchedAt: '2026-05-26T12:00:00.000Z',
        engine: id,
        warnings: [],
      }
    },
  }
}

/**
 * Engine that fails only for URLs containing `failSubstring`, succeeds otherwise.
 */
function selectiveFailingEngine(id: CrawlerEngineId, failSubstring: string, failCount: number): CrawlerEngine {
  const hostCallCounts = new Map<string, number>()
  return {
    id,
    capabilities: {
      rendersJs: id === 'spa',
      bypassesCloudflare: false,
      returnsMarkdown: id === 'llm-markdown',
      supportsPdf: id === 'llm-markdown',
      selfHosted: true,
    },
    async fetch({ url }: CrawlerFetchInput): Promise<CrawlerResult> {
      const host = new URL(url).hostname
      if (host.includes(failSubstring)) {
        const count = (hostCallCounts.get(host) ?? 0) + 1
        hostCallCounts.set(host, count)
        if (count <= failCount) {
          throw new Error(`engine ${id} simulated failure for ${host} #${count}`)
        }
      }
      return {
        url,
        status: 200,
        html: `<from-${id}>`,
        rawHeaders: {},
        fetchedAt: '2026-05-26T12:00:00.000Z',
        engine: id,
        warnings: [],
      }
    },
  }
}

/**
 * Engine that resolves with an HTTP error status (e.g. 500) instead of throwing.
 * Used to verify that the circuit breaker treats HTTP errors as failures.
 */
function httpErrorEngine(id: CrawlerEngineId, errorStatus: number, failCount: number): CrawlerEngine {
  let calls = 0
  return {
    id,
    capabilities: {
      rendersJs: id === 'spa',
      bypassesCloudflare: false,
      returnsMarkdown: id === 'llm-markdown',
      supportsPdf: id === 'llm-markdown',
      selfHosted: true,
    },
    async fetch({ url }: CrawlerFetchInput): Promise<CrawlerResult> {
      calls++
      if (calls <= failCount) {
        return {
          url,
          status: errorStatus,
          html: '',
          rawHeaders: {},
          fetchedAt: '2026-05-26T12:00:00.000Z',
          engine: id,
          warnings: [`server returned ${errorStatus}`],
        }
      }
      return {
        url,
        status: 200,
        html: `<from-${id}-after-recovery>`,
        rawHeaders: {},
        fetchedAt: '2026-05-26T12:00:00.000Z',
        engine: id,
        warnings: [],
      }
    },
  }
}

describe('circuit breaker', () => {
  it('opens circuit after consecutive failures on the same host', async () => {
    const engine = failingEngine('static', 10) // always fails
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 3, resetMs: 60_000 },
      retry: { enabled: false },
    })

    // First 3 failures pass through to the engine
    for (let i = 0; i < 3; i++) {
      await expect(router.fetch({ url: 'https://acme.ru/careers' }))
        .rejects.toThrow(/simulated failure/)
    }

    // 4th request — circuit is open, engine is NOT called, we get a 503 result
    const result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/circuit.*open/i)]),
    )
    expect(result.html).toBeUndefined()
  })

  it('does not open circuit for a different host', async () => {
    const engine = failingEngine('static', 10)
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 60_000 },
      retry: { enabled: false },
    })

    // Break circuit on acme.ru
    for (let i = 0; i < 2; i++) {
      await expect(router.fetch({ url: 'https://acme.ru/careers' }))
        .rejects.toThrow(/simulated failure/)
    }

    // other-site.ru should still work through the engine (and fail with the engine error)
    await expect(router.fetch({ url: 'https://other-site.ru/careers' }))
      .rejects.toThrow(/simulated failure/)
  })

  it('resets circuit after resetMs (half-open → closed on success)', async () => {
    jest.useFakeTimers()
    const engine = failingEngine('static', 2) // fails 2 times then recovers
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 5_000 },
      retry: { enabled: false },
    })

    // Trigger 2 failures → circuit opens
    for (let i = 0; i < 2; i++) {
      await expect(router.fetch({ url: 'https://acme.ru/careers' }))
        .rejects.toThrow(/simulated failure/)
    }

    // Circuit is open — immediate 503
    let result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)

    // Advance past resetMs → circuit transitions to half-open
    jest.advanceTimersByTime(5_001)

    // Half-open lets one probe through → engine has recovered (call #3 succeeds) → circuit closes
    result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(200)
    expect(result.html).toBe('<from-static-after-recovery>')

    // Circuit is now closed — subsequent requests go through normally
    result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(200)

    jest.useRealTimers()
  })

  it('re-closes circuit if half-open request also fails', async () => {
    jest.useFakeTimers()
    const engine = failingEngine('static', 100) // always fails
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 5_000 },
      retry: { enabled: false },
    })

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(router.fetch({ url: 'https://acme.ru/careers' }))
        .rejects.toThrow(/simulated failure/)
    }

    // Circuit is open → 503
    let result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)

    // Advance past resetMs → half-open
    jest.advanceTimersByTime(5_001)

    // Half-open probe → engine still fails → circuit re-opens (throws, NOT 503)
    await expect(router.fetch({ url: 'https://acme.ru/careers' }))
      .rejects.toThrow(/simulated failure/)

    // Circuit is open again → 503
    result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)

    jest.useRealTimers()
  })

  it('opens circuit when engine returns HTTP error status (not only exceptions)', async () => {
    const engine = httpErrorEngine('static', 500, 10) // always returns 500
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 3, resetMs: 60_000 },
    })

    // First 3 requests return 500 from the engine — circuit breaker should count these as failures
    for (let i = 0; i < 3; i++) {
      const r = await router.fetch({ url: 'https://acme.ru/careers' })
      expect(r.status).toBe(500)
    }

    // 4th request — circuit is open, engine is NOT called, we get 503
    const result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/circuit.*open/i)]),
    )
  })

  it('closes circuit after recovery from HTTP error status', async () => {
    jest.useFakeTimers()
    const engine = httpErrorEngine('static', 500, 2) // returns 500 twice then recovers
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 5_000 },
      retry: { enabled: false },
    })

    // Trigger 2 HTTP errors → circuit opens
    for (let i = 0; i < 2; i++) {
      const r = await router.fetch({ url: 'https://acme.ru/careers' })
      expect(r.status).toBe(500)
    }

    // Circuit is open — 503
    let result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)

    // Advance past resetMs → half-open
    jest.advanceTimersByTime(5_001)

    // Half-open probe → engine returns 200 (recovered) → circuit closes
    result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(200)

    // Circuit is closed — subsequent requests go through normally
    result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(200)

    jest.useRealTimers()
  })

  it('treats 4xx client errors as failures for circuit breaker', async () => {
    const engine = httpErrorEngine('static', 403, 10) // always returns 403
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 60_000 },
    })

    // 2 requests return 403 → circuit opens
    for (let i = 0; i < 2; i++) {
      const r = await router.fetch({ url: 'https://acme.ru/careers' })
      expect(r.status).toBe(403)
    }

    // 3rd request — circuit is open → 503
    const result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)
  })

  it('does NOT open circuit for HTTP 200 responses', async () => {
    const engine = fakeEngine('static') // always returns 200
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 60_000 },
    })

    // Many successful requests — circuit should stay closed
    for (let i = 0; i < 10; i++) {
      const r = await router.fetch({ url: 'https://acme.ru/careers' })
      expect(r.status).toBe(200)
    }
  })

  it('only lets one probe through in half-open state; concurrent requests get 503', async () => {
    // Mock Date.now to control circuit breaker timing
    const realNow = Date.now()
    let now = realNow
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)

    let calls = 0
    let resolveProbe: (() => void) | null = null
    const probePromise = new Promise<void>(r => { resolveProbe = r })

    const engine: CrawlerEngine = {
      id: 'static',
      capabilities: {
        rendersJs: false,
        bypassesCloudflare: false,
        returnsMarkdown: false,
        supportsPdf: false,
        selfHosted: true,
      },
      async fetch({ url }): Promise<CrawlerResult> {
        calls++
        // First call: throw to trigger circuit open
        if (calls === 1) {
          throw new Error('initial failure')
        }
        // Second call (the probe in half-open): succeed slowly
        if (calls === 2) {
          await probePromise
        }
        return {
          url,
          status: 200,
          html: '<ok>',
          rawHeaders: {},
          fetchedAt: '2026-05-26T12:00:00.000Z',
          engine: 'static',
          warnings: [],
        }
      },
    }

    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 1, resetMs: 5_000 },
      retry: { enabled: false },
    })

    // Trigger circuit open — first call throws
    await expect(router.fetch({ url: 'https://acme.ru/careers' }))
      .rejects.toThrow(/initial failure/)

    // Circuit is open → 503
    let result = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(result.status).toBe(503)

    // Advance past resetMs → circuit transitions to half-open
    now = realNow + 5_001
    dateSpy.mockImplementation(() => now)

    // Fire 3 concurrent requests while half-open.
    // Only the FIRST should be the probe; the other 2 should get 503 immediately.
    const probe = router.fetch({ url: 'https://acme.ru/careers' })
    const concurrent1 = router.fetch({ url: 'https://acme.ru/careers' })
    const concurrent2 = router.fetch({ url: 'https://acme.ru/careers' })

    // The concurrent requests should get 503 (not passed to engine)
    const [r1, r2] = await Promise.all([concurrent1, concurrent2])
    expect(r1.status).toBe(503)
    expect(r2.status).toBe(503)

    // Now resolve the probe
    resolveProbe!()
    const probeResult = await probe
    expect(probeResult.status).toBe(200)

    // After probe success, circuit is closed — new requests go through
    const afterResult = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(afterResult.status).toBe(200)

    // Engine should have been called exactly 3 times:
    // 1x initial failure + 1x probe + 1x post-closure
    expect(calls).toBe(3)

    dateSpy.mockRestore()
  })
})

describe('rate limiter', () => {
  it('rejects requests exceeding maxRequestsPerHostPerMinute', async () => {
    const engine = fakeEngine('static')
    const router = createCrawlerRouter({ static: engine }, {
      rateLimiter: { maxRequestsPerHostPerMinute: 3 },
    })

    // First 3 should succeed
    for (let i = 0; i < 3; i++) {
      const r = await router.fetch({ url: 'https://acme.ru/careers' })
      expect(r.status).toBe(200)
    }

    // 4th is rate-limited
    const r = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(r.status).toBe(429)
    expect(r.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/rate.?limit/i)]),
    )
  })

  it('rate-limits per host independently', async () => {
    const engine = fakeEngine('static')
    const router = createCrawlerRouter({ static: engine }, {
      rateLimiter: { maxRequestsPerHostPerMinute: 2 },
    })

    // Use up acme.ru quota
    for (let i = 0; i < 2; i++) {
      await router.fetch({ url: 'https://acme.ru/careers' })
    }

    // acme.ru is rate-limited
    const r1 = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(r1.status).toBe(429)

    // other-site.ru still works
    const r2 = await router.fetch({ url: 'https://other-site.ru/careers' })
    expect(r2.status).toBe(200)
  })

  it('circuit breaker and rate limiter work together', async () => {
    const engine = selectiveFailingEngine('static', 'acme.ru', 100)
    const router = createCrawlerRouter({ static: engine }, {
      circuitBreaker: { failureThreshold: 2, resetMs: 60_000 },
      rateLimiter: { maxRequestsPerHostPerMinute: 10 },
      retry: { enabled: false },
    })

    // Open circuit on acme.ru
    for (let i = 0; i < 2; i++) {
      await expect(router.fetch({ url: 'https://acme.ru/careers' }))
        .rejects.toThrow(/simulated failure/)
    }

    // Circuit takes precedence — 503, not 429
    const r = await router.fetch({ url: 'https://acme.ru/careers' })
    expect(r.status).toBe(503)

    // Different host — engine succeeds, rate limiter applies
    for (let i = 0; i < 10; i++) {
      const ri = await router.fetch({ url: 'https://other-site.ru/jobs' })
      expect(ri.status).toBe(200)
    }
    const r2 = await router.fetch({ url: 'https://other-site.ru/jobs' })
    expect(r2.status).toBe(429)
  })
})
